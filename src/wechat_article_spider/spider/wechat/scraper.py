#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
微信公众号爬虫核心模块
====================

实现文章爬取的核心逻辑，提供三种爬取器：
- WeChatScraper: 基础爬虫，适合单公众号爬取
- BatchWeChatScraper: 批量爬虫，支持多线程
- AsyncBatchWeChatScraper: 异步批量爬虫，最高性能

设计原则:
    - 模块独立：不依赖 GUI，可作为库单独使用
    - 回调驱动：通过回调函数报告进度和状态
    - 容错设计：单个失败不影响整体任务
    - 可配置性：支持自定义各种参数

使用场景:
    - 单公众号爬取：使用 WeChatScraper
    - 多公众号顺序爬取：使用 BatchWeChatScraper（单线程）
    - 多公众号并发爬取：使用 BatchWeChatScraper（多线程）
    - 高性能批量爬取：使用 AsyncBatchWeChatScraper

回调事件:
    - progress: 页面爬取进度
    - article_progress: 文章数量进度
    - content_progress: 内容获取进度
    - account_status: 公众号处理状态
    - batch_completed: 批量任务完成
    - error: 错误发生
"""

import json
import os
import csv
import random
import time
import threading
import asyncio
from datetime import datetime, date, timedelta
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import List, Dict, Any, Optional, Callable

from wechat_article_spider.spider.log.utils import logger
from wechat_article_spider.spider.wechat.utils import get_fakid, get_articles_list, get_article_content, format_time


class WeChatScraper:
    """
    微信公众号基础爬虫类
    
    提供单个公众号的爬取功能，包括搜索公众号、获取文章列表、
    获取文章内容等。是其他爬虫类的基础组件。
    
    Attributes:
        token: 访问令牌
        headers: HTTP 请求头
        request_delay: 请求间隔范围（秒）
        callbacks: 回调函数字典
    """
    
    def __init__(self, token=None, headers=None):
        """
        初始化爬虫实例
        
        Args:
            token: 微信公众平台访问令牌
            headers: HTTP 请求头，需包含有效的 cookie
        """
        self.token = token
        self.headers = headers
        
        # 请求间隔范围（秒）
        self.request_delay = (1, 3)
        
        # 回调函数
        self.callbacks = {
            'progress': None,
            'error': None,
            'complete': None,
            'status': None
        }
    
    def set_token(self, token):
        """设置token"""
        self.token = token
    
    def set_headers(self, headers):
        """设置请求头"""
        self.headers = headers
    
    def set_callback(self, event_type, callback_func):
        """
        设置回调函数
        
        Args:
            event_type: 事件类型（progress/error/complete/status）
            callback_func: 回调函数
        """
        if event_type in self.callbacks:
            self.callbacks[event_type] = callback_func
    
    def search_account(self, query):
        """
        搜索公众号
        
        Args:
            query: 公众号名称关键词
            
        Returns:
            list: 匹配的公众号列表
        """
        if not self.token or not self.headers:
            self._trigger_error("未设置token或headers")
            return []
        
        try:
            return get_fakid(self.headers, self.token, query)
        except Exception as e:
            self._trigger_error(f"搜索公众号失败: {e}")
            return []
    
    def get_account_articles(self, account_name, fakeid=None, max_pages=10):
        """
        获取公众号文章列表
        
        Args:
            account_name: 公众号名称
            fakeid: 公众号fakeid，如果为None则自动搜索
            max_pages: 最大页数限制
            
        Returns:
            list: 文章信息列表
        """
        if not self.token or not self.headers:
            self._trigger_error("未设置token或headers")
            return []
        
        try:
            # 如果未提供fakeid，则尝试搜索获取
            if not fakeid:
                search_results = self.search_account(account_name)
                if not search_results:
                    self._trigger_error(f"未找到公众号: {account_name}")
                    return []
                
                fakeid = search_results[0]['wpub_fakid']
            
            self._trigger_status(account_name, "fetching", f"正在获取文章列表...")
            
            all_articles = []
            page_start = 0
            
            for page in range(max_pages):
                self._trigger_progress(page, max_pages)
                
                # 获取一页文章
                titles, links, update_times = get_articles_list(
                    page_num=1, 
                    start_page=page_start,
                    fakeid=fakeid,
                    token=self.token,
                    headers=self.headers
                )
                
                if not titles:
                    break  # 没有更多文章
                
                # 构建文章信息
                for title, link, update_time in zip(titles, links, update_times):
                    article = {
                        'name': account_name,
                        'title': title,
                        'link': link,
                        'publish_timestamp': int(update_time),
                        'publish_time': format_time(update_time),
                        'digest': '',  # 稍后可能会获取
                        'content': ''  # 稍后可能会获取
                    }
                    all_articles.append(article)
                
                page_start += 5
                
                # 请求间延迟
                delay = random.uniform(*self.request_delay)
                time.sleep(delay)
            
            self._trigger_status(account_name, "fetched", f"获取到 {len(all_articles)} 篇文章")
            self._trigger_progress(max_pages, max_pages)
            
            return all_articles
            
        except Exception as e:
            self._trigger_error(f"获取文章列表失败: {e}")
            return []
    
    def get_article_content_by_url(self, article):
        """
        获取单篇文章内容
        
        Args:
            article: 包含link的文章信息字典
            
        Returns:
            dict: 更新后的文章字典
        """
        if not self.headers:
            return article
        
        try:
            url = article['link']
            content = get_article_content(url, self.headers)
            article['content'] = content
            return article
        except Exception as e:
            logger.error(f"获取文章内容失败: {e}")
            article['content'] = f"获取内容失败: {str(e)}"
            return article
    
    def filter_articles_by_date(self, articles, start_date=None, end_date=None):
        """
        按日期范围过滤文章
        
        Args:
            articles: 文章列表
            start_date: 开始日期，格式为YYYY-MM-DD或datetime.date对象
            end_date: 结束日期，格式为YYYY-MM-DD或datetime.date对象
            
        Returns:
            list: 过滤后的文章列表
        """
        if not start_date and not end_date:
            return articles
        
        # 解析日期
        if isinstance(start_date, str):
            start_date = datetime.strptime(start_date, '%Y-%m-%d').date()
        if isinstance(end_date, str):
            end_date = datetime.strptime(end_date, '%Y-%m-%d').date()
        
        logger.info(f"日期过滤范围: {start_date} 至 {end_date}")
        
        filtered_articles = []
        for article in articles:
            timestamp = article.get('publish_timestamp', 0)
            if timestamp:
                article_date = datetime.fromtimestamp(int(timestamp)).date()
                
                if start_date and article_date < start_date:
                    continue
                if end_date and article_date > end_date:
                    continue
                    
                filtered_articles.append(article)
        
        # 如果过滤后为空，显示文章的实际日期范围
        if articles and not filtered_articles:
            dates = []
            for article in articles:
                ts = article.get('publish_timestamp', 0)
                if ts:
                    dates.append(datetime.fromtimestamp(int(ts)).date())
            if dates:
                logger.warning(f"日期过滤后为0篇！文章实际日期范围: {min(dates)} 至 {max(dates)}")
        
        logger.info(f"日期过滤: {len(articles)} -> {len(filtered_articles)} 篇")
        return filtered_articles
    
    def save_articles_to_csv(self, articles, filename):
        """
        保存文章到CSV文件
        
        Args:
            articles: 文章列表
            filename: 文件名
            
        Returns:
            bool: 保存是否成功
        """
        if not articles:
            return False
        
        try:
            # 确保目录存在
            os.makedirs(os.path.dirname(os.path.abspath(filename)), exist_ok=True)
            
            with open(filename, 'w', newline='', encoding='utf-8-sig') as f:
                writer = csv.writer(f)
                
                # 写入标题行
                writer.writerow(['公众号', '标题', '发布时间', '链接', '内容'])
                
                # 写入数据行
                for article in articles:
                    writer.writerow([
                        article['name'],
                        article['title'],
                        article.get('publish_time', ''),
                        article['link'],
                        article.get('content', '')
                    ])
                    
            return True
            
        except Exception as e:
            logger.error(f"保存CSV失败: {e}")
            return False
    
    def _trigger_progress(self, current, total):
        """触发进度回调"""
        if self.callbacks['progress']:
            self.callbacks['progress'](current, total)
    
    def _trigger_error(self, error_msg):
        """触发错误回调"""
        if self.callbacks['error']:
            self.callbacks['error'](error_msg)
        else:
            logger.error(f"错误: {error_msg}")
    
    def _trigger_complete(self, result):
        """触发完成回调"""
        if self.callbacks['complete']:
            self.callbacks['complete'](result)
    
    def _trigger_status(self, account_name, status, message):
        """触发状态回调"""
        if self.callbacks['status']:
            self.callbacks['status'](account_name, status, message)
        else:
            logger.info(f"{account_name}: {message}")


class BatchWeChatScraper:
    """
    批量爬取管理器（同步版本）
    
    管理多个公众号的批量爬取任务，支持顺序执行和多线程并发。
    提供丰富的回调接口用于监控爬取进度。
    
    特性:
        - 支持单线程顺序爬取和多线程并发爬取
        - 自动处理公众号间的请求间隔
        - 单个公众号失败不影响其他任务
        - 支持中途取消
        - 支持正文关键词过滤
    
    Attributes:
        scraper: 内部使用的 WeChatScraper 实例
        is_cancelled: 取消标志
        default_config: 默认配置字典
        callbacks: 回调函数字典
        total_articles_count: 已爬取文章总数
    """
    
    def __init__(self):
        """初始化批量爬取管理器"""
        self.scraper = WeChatScraper()
        self.is_cancelled = False
        
        # 默认配置
        self.default_config = {
            'max_pages_per_account': 10,
            'request_interval': 10,
            'account_interval': (15, 30),
            'use_threading': False,
            'max_workers': 3,
            'include_content': False,
            'content_keyword_filter': ''   # 正文关键词过滤
        }
        
        # 回调函数
        self.callbacks = {
            'progress_updated': None,
            'account_status': None,
            'batch_completed': None,
            'error_occurred': None,
            'article_progress': None,  # 文章进度回调 (count, message)
            'content_progress': None   # 内容获取进度回调 (current, total, message) - 真实百分比
        }
        
        # 文章计数
        self.total_articles_count = 0
    
    def set_callback(self, event_type, callback_func):
        """
        设置回调函数
        
        Args:
            event_type: 事件类型
            callback_func: 回调函数
        """
        if event_type in self.callbacks:
            self.callbacks[event_type] = callback_func
    
    def cancel_batch_scrape(self):
        """取消批量爬取"""
        self.is_cancelled = True
    
    def start_batch_scrape(self, config):
        """
        开始批量爬取
        
        Args:
            config: 爬取配置，包含以下字段:
                - accounts: 公众号列表
                - start_date: 开始日期
                - end_date: 结束日期
                - token: 访问token
                - headers: 请求头
                - output_file: 输出文件（可选）
                - 其他配置参数（见default_config）
                
        Returns:
            list: 爬取的文章列表
        """
        # 合并默认配置
        for key, value in self.default_config.items():
            if key not in config:
                config[key] = value
        
        # 设置token和headers
        self.scraper.set_token(config['token'])
        self.scraper.set_headers(config['headers'])
        
        # 重置状态
        self.is_cancelled = False
        
        # 解析日期
        try:
            start_date = datetime.strptime(config['start_date'], '%Y-%m-%d').date()
            end_date = datetime.strptime(config['end_date'], '%Y-%m-%d').date()
        except:
            self._trigger_error("系统", "日期格式错误，应为YYYY-MM-DD")
            return []
        
        if start_date > end_date:
            self._trigger_error("系统", "开始日期不能晚于结束日期")
            return []
        
        accounts = config['accounts']
        total_accounts = len(accounts)
        
        # 决定使用何种方式爬取
        if config.get('use_threading', False) and total_accounts > 1:
            # 多线程爬取
            all_articles = self._process_accounts_threaded(config, accounts, start_date, end_date)
        else:
            # 单线程顺序爬取
            all_articles = self._process_accounts_sequential(config, accounts, start_date, end_date)
        
        # 保存结果到CSV
        if not self.is_cancelled:
            output_file = config.get('output_file')
            if output_file:
                self.scraper.save_articles_to_csv(all_articles, output_file)
            
            # 触发完成回调
            self._trigger_batch_completed(len(all_articles))
        
        return all_articles
    
    def _process_accounts_sequential(self, config, accounts, start_date, end_date):
        """
        顺序处理公众号
        
        Args:
            config: 爬取配置
            accounts: 公众号列表
            start_date: 开始日期
            end_date: 结束日期
            
        Returns:
            list: 爬取的文章列表
        """
        all_articles = []
        total_accounts = len(accounts)
        self.total_articles_count = 0  # 重置文章计数
        
        for i, account in enumerate(accounts):
            if self.is_cancelled:
                break
                
            self._trigger_account_status(account, "processing", f"正在处理 ({i+1}/{total_accounts})")
            
            try:
                # 爬取单个公众号
                articles = self._scrape_single_account(config, account, start_date, end_date)
                all_articles.extend(articles)
                self.total_articles_count = len(all_articles)
                
                # 更新文章进度
                self._trigger_article_progress(len(all_articles), f"已获取 {len(all_articles)} 篇文章")
                
                self._trigger_account_status(account, "completed", f"完成，获得 {len(articles)} 篇文章")
                
                # 账号间延迟
                if i < total_accounts - 1:
                    interval_range = config.get('account_interval', (15, 30))
                    delay = random.uniform(*interval_range)
                    time.sleep(delay)
                    
            except Exception as e:
                error_msg = f"处理失败: {str(e)}"
                self._trigger_account_status(account, "error", error_msg)
                self._trigger_error(account, error_msg)
                continue
        
        return all_articles
    
    def _process_accounts_threaded(self, config, accounts, start_date, end_date):
        """
        多线程处理公众号
        
        Args:
            config: 爬取配置
            accounts: 公众号列表
            start_date: 开始日期
            end_date: 结束日期
            
        Returns:
            list: 爬取的文章列表
        """
        all_articles = []
        total_accounts = len(accounts)
        max_workers = min(config.get('max_workers', 3), total_accounts)
        self.total_articles_count = 0  # 重置文章计数
        lock = threading.Lock()
        
        # 创建线程池
        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            # 提交任务
            future_to_account = {
                executor.submit(self._scrape_single_account, config, account, start_date, end_date): account 
                for account in accounts
            }
            
            # 处理结果
            for future in as_completed(future_to_account):
                account = future_to_account[future]
                
                try:
                    articles = future.result()
                    with lock:
                        all_articles.extend(articles)
                        self.total_articles_count = len(all_articles)
                    
                    # 更新文章进度
                    self._trigger_article_progress(len(all_articles), f"已获取 {len(all_articles)} 篇文章")
                    
                    self._trigger_account_status(
                        account, "completed", f"完成，获得 {len(articles)} 篇文章"
                    )
                    
                except Exception as e:
                    error_msg = f"处理失败: {str(e)}"
                    self._trigger_account_status(account, "error", error_msg)
                    self._trigger_error(account, error_msg)
                
                if self.is_cancelled:
                    break
        
        return all_articles
    
    def _scrape_single_account(self, config, account_name, start_date, end_date):
        """
        爬取单个公众号
        
        Args:
            config: 爬取配置
            account_name: 公众号名称
            start_date: 开始日期
            end_date: 结束日期
            
        Returns:
            list: 爬取的文章列表
        """
        self._trigger_account_status(account_name, "searching", "正在搜索公众号...")
        self._trigger_article_progress(self.total_articles_count, f"正在搜索: {account_name}")
        
        # 获取公众号fakeid
        search_results = self.scraper.search_account(account_name)
        if not search_results:
            raise Exception(f"未找到公众号: {account_name}")
        
        fakeid = search_results[0]['wpub_fakid']
        
        # 设置请求间隔
        self.scraper.request_delay = (1, config.get('request_interval', 60) / 10)
        
        # 获取文章列表
        self._trigger_account_status(account_name, "fetching", "正在获取文章列表...")
        max_pages = config.get('max_pages_per_account', 100)
        
        # 使用自定义方法获取文章，以便实时更新进度
        all_articles = self._get_articles_with_progress(account_name, fakeid, max_pages, config)
        
        # 按日期过滤
        self._trigger_account_status(account_name, "filtering", "正在按日期过滤文章...")
        articles_in_range = self.scraper.filter_articles_by_date(all_articles, start_date, end_date)
        
        self._trigger_article_progress(
            self.total_articles_count + len(articles_in_range), 
            f"{account_name}: 过滤后 {len(articles_in_range)} 篇文章"
        )
        
        # 获取文章内容
        if config.get('include_content', False) and articles_in_range:
            total_content = len(articles_in_range)
            self._trigger_account_status(account_name, "content", f"正在获取 {total_content} 篇文章的内容...")
            
            for i, article in enumerate(articles_in_range):
                if self.is_cancelled:
                    break
                
                # 使用真实进度回调
                self._trigger_content_progress(
                    i + 1, total_content,
                    f"{account_name}: 正在获取第 {i+1}/{total_content} 篇文章内容"
                )
                    
                try:
                    # 获取内容
                    article = self.scraper.get_article_content_by_url(article)
                    
                    # 请求间延迟
                    if i < len(articles_in_range) - 1:
                        delay = random.uniform(1, config.get('request_interval', 60) / 10)
                        time.sleep(delay)
                        
                except Exception as e:
                    logger.error(f"获取文章内容失败: {e}")
                    continue
            
            # 正文关键词过滤
            content_keyword_filter = config.get('content_keyword_filter', '')
            if content_keyword_filter:
                self._trigger_account_status(
                    account_name, "filtering",
                    f"正在按关键词 '{content_keyword_filter}' 过滤正文..."
                )
                articles_before_filter = len(articles_in_range)
                articles_in_range = self._filter_articles_by_keyword(
                    articles_in_range, content_keyword_filter
                )
                articles_after_filter = len(articles_in_range)
                filtered_out = articles_before_filter - articles_after_filter
                
                self._trigger_article_progress(
                    self.total_articles_count - filtered_out + len(articles_in_range),
                    f"{account_name}: 关键词过滤后 {articles_after_filter} 篇文章 (过滤掉 {filtered_out} 篇)"
                )
        
        return articles_in_range
    
    def _get_articles_with_progress(self, account_name, fakeid, max_pages, config):
        """获取文章列表并实时更新进度"""
        from wechat_article_spider.spider.wechat.utils import get_articles_list, format_time
        
        all_articles = []
        page_start = 0
        
        for page in range(max_pages):
            if self.is_cancelled:
                break
            
            self._trigger_article_progress(
                self.total_articles_count + len(all_articles),
                f"{account_name}: 正在获取第 {page+1} 页，已获取 {len(all_articles)} 篇"
            )
            
            # 获取一页文章
            titles, links, update_times = get_articles_list(
                page_num=1, 
                start_page=page_start,
                fakeid=fakeid,
                token=config['token'],
                headers=config['headers']
            )
            
            if not titles:
                break  # 没有更多文章
            
            # 构建文章信息
            for title, link, update_time in zip(titles, links, update_times):
                article = {
                    'name': account_name,
                    'title': title,
                    'link': link,
                    'publish_timestamp': int(update_time),
                    'publish_time': format_time(update_time),
                    'digest': '',
                    'content': ''
                }
                all_articles.append(article)
            
            page_start += 5
            
            # 请求间延迟
            delay = random.uniform(1, config.get('request_interval', 60) / 10)
            time.sleep(delay)
        
        self._trigger_article_progress(
            self.total_articles_count + len(all_articles),
            f"{account_name}: 获取到 {len(all_articles)} 篇文章"
        )
        
        return all_articles
    
    def _trigger_progress_updated(self, current, total):
        """触发进度更新回调"""
        if self.callbacks['progress_updated']:
            self.callbacks['progress_updated'](current, total)
    
    def _trigger_article_progress(self, article_count, message):
        """触发文章进度回调"""
        if self.callbacks['article_progress']:
            self.callbacks['article_progress'](article_count, message)
    
    def _trigger_content_progress(self, current, total, message):
        """触发内容获取进度回调 - 真实百分比"""
        if self.callbacks['content_progress']:
            self.callbacks['content_progress'](current, total, message)
    
    def _trigger_account_status(self, account_name, status, message):
        """触发账号状态回调"""
        if self.callbacks['account_status']:
            self.callbacks['account_status'](account_name, status, message)
        else:
            logger.info(f"{account_name}: {message}")
    
    def _trigger_batch_completed(self, total_articles):
        """触发批次完成回调"""
        if self.callbacks['batch_completed']:
            self.callbacks['batch_completed'](total_articles)
    
    def _trigger_error(self, account_name, error_message):
        """触发错误回调"""
        if self.callbacks['error']:
            self.callbacks['error'](account_name, error_message)
        else:
            logger.error(f"错误 - {account_name}: {error_message}")
    
    def _filter_articles_by_keyword(self, articles, keyword):
        """按正文关键词过滤文章
        
        Args:
            articles: 文章列表
            keyword: 关键词
            
        Returns:
            list: 过滤后的文章列表（正文包含关键词的文章）
        """
        if not keyword:
            return articles
        
        keyword_lower = keyword.lower()
        filtered = []
        for article in articles:
            content = article.get('content', '')
            # 检查正文是否包含关键词（不区分大小写）
            if content and keyword_lower in content.lower():
                filtered.append(article)
        
        logger.info(f"正文关键词过滤: {len(articles)} -> {len(filtered)} 篇 (关键词: {keyword})")
        return filtered


class AsyncBatchWeChatScraper:
    """
    异步批量爬取管理器
    
    基于 asyncio 和 aiohttp 实现的高性能爬虫，通过异步 I/O
    实现真正的并发请求，效率远高于多线程版本。
    
    特性:
        - 异步 HTTP 请求，高并发低资源占用
        - 可配置的并发公众号数和请求数
        - 自动回退到同步模式（aiohttp 不可用时）
        - 支持中途取消并返回已爬取数据
    
    适用场景:
        - 大量公众号的批量爬取
        - 对爬取速度有较高要求
        - 服务器资源有限的环境
    
    Attributes:
        is_cancelled: 取消标志
        default_config: 默认配置
        callbacks: 回调函数字典
        total_articles_count: 已爬取文章总数
        collected_articles: 已收集的文章列表
    """
    
    def __init__(self):
        """初始化异步批量爬取管理器"""
        self.is_cancelled = False
        
        # 默认配置
        self.default_config = {
            'max_pages_per_account': 10,
            'request_interval': 10,
            'max_concurrent_accounts': 3,  # 最大并发公众号数
            'max_concurrent_requests': 5,  # 每个公众号的最大并发请求数
            'include_content': False,
            'content_keyword_filter': ''   # 正文关键词过滤
        }
        
        # 回调函数
        self.callbacks = {
            'progress_updated': None,
            'account_status': None,
            'batch_completed': None,
            'error_occurred': None,
            'article_progress': None,
            'content_progress': None
        }
        
        # 文章计数
        self.total_articles_count = 0
        
        # 已爬取的文章列表（用于取消时返回部分结果）
        self.collected_articles = []
    
    def set_callback(self, event_type: str, callback_func: Callable):
        """设置回调函数"""
        if event_type in self.callbacks:
            self.callbacks[event_type] = callback_func
    
    def cancel_batch_scrape(self):
        """取消批量爬取"""
        self.is_cancelled = True
    
    def start_batch_scrape(self, config: Dict[str, Any]) -> List[Dict[str, Any]]:
        """
        开始异步批量爬取
        
        Args:
            config: 爬取配置
                
        Returns:
            list: 爬取的文章列表
        """
        # 合并默认配置
        for key, value in self.default_config.items():
            if key not in config:
                config[key] = value
        
        # 重置状态
        self.is_cancelled = False
        self.total_articles_count = 0
        self.collected_articles = []  # 重置已收集的文章
        
        # 解析日期
        try:
            start_date = datetime.strptime(config['start_date'], '%Y-%m-%d').date()
            end_date = datetime.strptime(config['end_date'], '%Y-%m-%d').date()
        except:
            self._trigger_error("系统", "日期格式错误，应为YYYY-MM-DD")
            return []
        
        if start_date > end_date:
            self._trigger_error("系统", "开始日期不能晚于结束日期")
            return []
        
        # 导入异步模块
        try:
            from wechat_article_spider.spider.wechat.async_utils import AsyncWeChatClient, format_time as async_format_time
        except ImportError as e:
            logger.error(f"无法导入异步模块: {e}")
            logger.info("回退到同步模式...")
            # 回退到同步爬取
            sync_scraper = BatchWeChatScraper()
            for event_type, callback in self.callbacks.items():
                if callback:
                    sync_scraper.set_callback(event_type, callback)
            return sync_scraper.start_batch_scrape(config)
        
        # 创建新的事件循环并运行异步爬取
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        
        try:
            all_articles = loop.run_until_complete(
                self._async_scrape_all(config, start_date, end_date)
            )
            
            # 保存结果到CSV
            if not self.is_cancelled:
                output_file = config.get('output_file')
                if output_file and all_articles:
                    self._save_articles_to_csv(all_articles, output_file)
                
                # 触发完成回调
                self._trigger_batch_completed(len(all_articles))
            
            return all_articles
            
        finally:
            loop.close()
    
    async def _async_scrape_all(self, config: Dict[str, Any],
                                start_date: date, end_date: date) -> List[Dict[str, Any]]:
        """
        异步爬取所有公众号
        
        Args:
            config: 爬取配置
            start_date: 开始日期
            end_date: 结束日期
            
        Returns:
            list: 所有文章列表
        """
        from wechat_article_spider.spider.wechat.async_utils import AsyncWeChatClient, format_time as async_format_time
        
        accounts = config['accounts']
        token = config['token']
        headers = config['headers']
        max_pages = config.get('max_pages_per_account', 10)
        include_content = config.get('include_content', False)
        content_keyword_filter = config.get('content_keyword_filter', '')  # 正文关键词过滤
        max_concurrent_accounts = config.get('max_concurrent_accounts', 3)
        max_concurrent_requests = config.get('max_concurrent_requests', 5)
        
        # 控制并发的信号量
        account_semaphore = asyncio.Semaphore(max_concurrent_accounts)
        all_articles = []
        lock = asyncio.Lock()
        
        # 引用self以便在内部函数中访问
        scraper_self = self
        
        async def scrape_single_account(account_name: str) -> List[Dict[str, Any]]:
            """爬取单个公众号"""
            async with account_semaphore:
                if self.is_cancelled:
                    return []
                
                self._trigger_account_status(account_name, "processing", "正在处理...")
                
                try:
                    async with AsyncWeChatClient(
                        token, headers,
                        max_concurrent=max_concurrent_requests,
                        request_delay=(0.5, config.get('request_interval', 10) / 10)
                    ) as client:
                        # 搜索公众号
                        self._trigger_account_status(account_name, "searching", "正在搜索公众号...")
                        search_results = await client.search_account(account_name)
                        
                        if not search_results:
                            raise Exception(f"未找到公众号: {account_name}")
                        
                        fakeid = search_results[0]['wpub_fakid']
                        
                        # 获取文章列表
                        self._trigger_account_status(account_name, "fetching", "正在获取文章列表...")
                        
                        def page_progress(current, total):
                            self._trigger_article_progress(
                                self.total_articles_count,
                                f"{account_name}: 正在获取第 {current}/{total} 页"
                            )
                        
                        articles = await client.get_articles_list(fakeid, max_pages, page_progress)
                        
                        # 添加公众号名称和格式化时间
                        for article in articles:
                            article['name'] = account_name
                            article['publish_timestamp'] = article.get('update_time', 0)
                            article['publish_time'] = async_format_time(article.get('update_time', 0))
                            article['content'] = ''
                        
                        # 按日期过滤
                        self._trigger_account_status(account_name, "filtering", "正在按日期过滤...")
                        articles_in_range = self._filter_articles_by_date(articles, start_date, end_date)
                        
                        # 更新总计数并保存已爬取的文章
                        async with lock:
                            scraper_self.total_articles_count += len(articles_in_range)
                            scraper_self.collected_articles.extend(articles_in_range)
                        
                        self._trigger_article_progress(
                            self.total_articles_count,
                            f"{account_name}: 过滤后 {len(articles_in_range)} 篇文章"
                        )
                        
                        # 获取文章内容
                        if include_content and articles_in_range:
                            self._trigger_account_status(
                                account_name, "content",
                                f"正在获取 {len(articles_in_range)} 篇文章的内容..."
                            )
                            
                            def content_progress(current, total, message):
                                self._trigger_content_progress(current, total, message)
                            
                            articles_in_range = await client.get_articles_content_batch(
                                articles_in_range, content_progress
                            )
                            
                            # 正文关键词过滤
                            if content_keyword_filter:
                                self._trigger_account_status(
                                    account_name, "filtering",
                                    f"正在按关键词 '{content_keyword_filter}' 过滤正文..."
                                )
                                articles_before_filter = len(articles_in_range)
                                articles_in_range = self._filter_articles_by_keyword(
                                    articles_in_range, content_keyword_filter
                                )
                                articles_after_filter = len(articles_in_range)
                                
                                # 更新计数（减去被过滤掉的文章）
                                filtered_out = articles_before_filter - articles_after_filter
                                async with lock:
                                    scraper_self.total_articles_count -= filtered_out
                                    # 更新已收集的文章列表（移除被过滤的）
                                    scraper_self.collected_articles = [
                                        a for a in scraper_self.collected_articles
                                        if a.get('name') != account_name or a in articles_in_range
                                    ]
                                
                                self._trigger_article_progress(
                                    self.total_articles_count,
                                    f"{account_name}: 关键词过滤后 {articles_after_filter} 篇文章 (过滤掉 {filtered_out} 篇)"
                                )
                        
                        self._trigger_account_status(
                            account_name, "completed",
                            f"完成，获得 {len(articles_in_range)} 篇文章"
                        )
                        
                        return articles_in_range
                        
                except Exception as e:
                    error_msg = f"处理失败: {str(e)}"
                    self._trigger_account_status(account_name, "error", error_msg)
                    self._trigger_error(account_name, error_msg)
                    return []
        
        # 并发爬取所有公众号
        tasks = [scrape_single_account(account) for account in accounts]
        results = await asyncio.gather(*tasks, return_exceptions=True)
        
        # 收集结果
        for result in results:
            if isinstance(result, Exception):
                logger.error(f"爬取异常: {result}")
                continue
            if result:
                all_articles.extend(result)
        
        return all_articles
    
    def _filter_articles_by_date(self, articles: List[Dict],
                                  start_date: date, end_date: date) -> List[Dict]:
        """按日期范围过滤文章"""
        filtered = []
        for article in articles:
            timestamp = article.get('publish_timestamp', 0)
            if timestamp:
                try:
                    article_date = datetime.fromtimestamp(int(timestamp)).date()
                    if start_date <= article_date <= end_date:
                        filtered.append(article)
                except:
                    continue
        return filtered
    
    def _filter_articles_by_keyword(self, articles: List[Dict], keyword: str) -> List[Dict]:
        """按正文关键词过滤文章
        
        Args:
            articles: 文章列表
            keyword: 关键词
            
        Returns:
            list: 过滤后的文章列表（正文包含关键词的文章）
        """
        if not keyword:
            return articles
        
        keyword_lower = keyword.lower()
        filtered = []
        for article in articles:
            content = article.get('content', '')
            # 检查正文是否包含关键词（不区分大小写）
            if content and keyword_lower in content.lower():
                filtered.append(article)
        
        logger.info(f"正文关键词过滤: {len(articles)} -> {len(filtered)} 篇 (关键词: {keyword})")
        return filtered
    
    def _save_articles_to_csv(self, articles: List[Dict], filename: str) -> bool:
        """保存文章到CSV文件"""
        if not articles:
            return False
        
        try:
            os.makedirs(os.path.dirname(os.path.abspath(filename)), exist_ok=True)
            
            with open(filename, 'w', newline='', encoding='utf-8-sig') as f:
                writer = csv.writer(f)
                writer.writerow(['公众号', '标题', '发布时间', '链接', '内容'])
                
                for article in articles:
                    writer.writerow([
                        article.get('name', ''),
                        article.get('title', ''),
                        article.get('publish_time', ''),
                        article.get('link', ''),
                        article.get('content', '')
                    ])
            
            return True
        except Exception as e:
            logger.error(f"保存CSV失败: {e}")
            return False
    
    def _trigger_article_progress(self, article_count: int, message: str):
        """触发文章进度回调"""
        if self.callbacks['article_progress']:
            self.callbacks['article_progress'](article_count, message)
    
    def _trigger_content_progress(self, current: int, total: int, message: str):
        """触发内容获取进度回调"""
        if self.callbacks['content_progress']:
            self.callbacks['content_progress'](current, total, message)
    
    def _trigger_account_status(self, account_name: str, status: str, message: str):
        """触发账号状态回调"""
        if self.callbacks['account_status']:
            self.callbacks['account_status'](account_name, status, message)
        else:
            logger.info(f"{account_name}: {message}")
    
    def _trigger_batch_completed(self, total_articles: int):
        """触发批次完成回调"""
        if self.callbacks['batch_completed']:
            self.callbacks['batch_completed'](total_articles)
    
    def _trigger_error(self, account_name: str, error_message: str):
        """触发错误回调"""
        if self.callbacks['error_occurred']:
            self.callbacks['error_occurred'](account_name, error_message)
        else:
            logger.error(f"错误 - {account_name}: {error_message}")
    
    def get_collected_articles(self) -> List[Dict[str, Any]]:
        """获取已爬取的文章列表（用于取消时返回部分结果）"""
        return self.collected_articles.copy()