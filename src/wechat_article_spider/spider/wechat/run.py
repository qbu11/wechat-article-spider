#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
爬虫运行器模块
==============

提供爬虫功能的高层封装，简化常见的爬取操作。
可以作为库导入使用，也可以通过命令行调用。

主要功能:
    - login: 执行登录流程
    - search_account: 搜索公众号
    - scrape_single_account: 爬取单个公众号
    - batch_scrape: 批量爬取多个公众号

设计目的:
    将登录、爬取、保存等步骤整合为简单的函数调用，
    降低使用门槛，适合快速开发和脚本调用。

使用示例:
    # 作为模块使用
    from wechat_article_spider.spider.wechat.run import WeChatSpiderRunner
    
    runner = WeChatSpiderRunner()
    runner.login()
    runner.scrape_single_account('人民日报', pages=5)
    
    # 使用便捷函数
    from wechat_article_spider.spider.wechat.run import login, scrape_account
    
    login()
    scrape_account('人民日报', pages=5, include_content=True)
"""

import os
import sys
import time
import json
from datetime import datetime, timedelta

from wechat_article_spider.spider.log.utils import logger
from .login import WeChatSpiderLogin, quick_login
from .scraper import WeChatScraper, BatchWeChatScraper
from wechat_article_spider.spider.wechat.paths import DEFAULT_OUTPUT_DIR


class WeChatSpiderRunner:
    """
    微信爬虫运行器
    
    封装爬虫的完整工作流程，提供简洁的 API 接口。
    内部管理登录状态，自动处理认证和会话维护。
    
    Attributes:
        login_manager: 登录管理器实例
    """
    
    def __init__(self):
        """初始化运行器，创建登录管理器"""
        self.login_manager = WeChatSpiderLogin()
    
    def login(self):
        """
        执行登录流程
        
        调用登录管理器进行扫码登录，成功后 token 和 cookie
        会被缓存，后续操作可直接使用。
        
        Returns:
            bool: 登录成功返回 True
        """
        logger.info("正在登录微信公众平台...")
        token, cookies, headers = quick_login()
        
        if not token or not cookies or not headers:
            logger.error("登录失败")
            return False
        
        logger.success(f"登录成功！")
        logger.debug(f"Token: {token[:8]}...{token[-4:]}")
        logger.debug(f"Cookie: {len(headers['cookie'])} 个字符")
        logger.info("登录信息已保存到缓存文件")
        
        return True
    
    def search_account(self, name, output_file=None):
        """
        搜索公众号
        
        Args:
            name: 公众号名称关键词
            output_file: 结果保存路径（可选）
        
        Returns:
            list: 匹配的公众号列表，未找到返回 None
        """
        logger.info(f"搜索公众号: {name}")
        
        # 检查登录状态
        if not self.login_manager.is_logged_in():
            logger.error("未登录或登录已过期，请先登录")
            return None
        
        token = self.login_manager.get_token()
        headers = self.login_manager.get_headers()
        
        # 创建爬虫实例
        scraper = WeChatScraper(token, headers)
        
        # 搜索公众号
        results = scraper.search_account(name)
        
        if not results:
            logger.warning(f"未找到匹配的公众号: {name}")
            return None
        
        logger.info(f"找到 {len(results)} 个匹配的公众号:")
        for i, account in enumerate(results):
            logger.info(f"{i+1}. {account['wpub_name']} (fakeid: {account['wpub_fakid']})")
        
        # 保存结果
        if output_file:
            with open(output_file, 'w', encoding='utf-8') as f:
                json.dump(results, f, ensure_ascii=False, indent=2)
            logger.info(f"搜索结果已保存到: {output_file}")
        
        return results
    
    def scrape_single_account(self, name, pages=10, days=30, include_content=False,
                              interval=10, output_file=None):
        """
        爬取单个公众号的文章
        
        Args:
            name: 公众号名称
            pages: 最大爬取页数（每页 5 篇）
            days: 时间范围（最近 N 天）
            include_content: 是否获取文章正文
            interval: 请求间隔（秒）
            output_file: 输出文件路径
        
        Returns:
            bool: 爬取成功返回 True
        """
        logger.info(f"爬取公众号: {name}")
        
        # 检查登录状态
        if not self.login_manager.is_logged_in():
            logger.error("未登录或登录已过期，请先登录")
            return False
        
        token = self.login_manager.get_token()
        headers = self.login_manager.get_headers()
        
        # 创建爬虫实例
        scraper = WeChatScraper(token, headers)
        
        # 搜索公众号
        logger.info(f"搜索公众号: {name}")
        results = scraper.search_account(name)
        
        if not results:
            logger.warning(f"未找到匹配的公众号: {name}")
            return False
        
        # 使用第一个匹配结果
        account = results[0]
        logger.info(f"使用公众号: {account['wpub_name']} (fakeid: {account['wpub_fakid']})")
        
        # 进度回调
        def progress_callback(current, total):
            logger.info(f"进度: {current}/{total} 页")
        
        scraper.set_callback('progress', progress_callback)
        
        # 获取文章列表
        logger.info(f"获取文章列表，最大 {pages} 页...")
        articles = scraper.get_account_articles(
            account['wpub_name'],
            account['wpub_fakid'],
            pages
        )
        
        logger.info(f"获取到 {len(articles)} 篇文章")
        
        # 按日期过滤
        if days:
            end_date = datetime.now().date()
            start_date = end_date - timedelta(days=days)
            
            logger.info(f"过滤日期范围: {start_date} 至 {end_date}")
            filtered_articles = scraper.filter_articles_by_date(articles, start_date, end_date)
            logger.info(f"过滤后剩余 {len(filtered_articles)} 篇文章")
        else:
            filtered_articles = articles
        
        # 获取文章内容
        if include_content:
            logger.info("获取文章内容...")
            for i, article in enumerate(filtered_articles):
                logger.info(f"获取第 {i+1}/{len(filtered_articles)} 篇文章内容...")
                article = scraper.get_article_content_by_url(article)
                
                # 请求间隔，避免被限制
                if i < len(filtered_articles) - 1:
                    time.sleep(interval)
        
        # 保存结果到CSV
        if output_file:
            output_path = output_file
        else:
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            output_path = f"{account['wpub_name']}_{timestamp}.csv"
        
        logger.info(f"保存结果到: {output_path}")
        success = scraper.save_articles_to_csv(filtered_articles, output_path)
        
        if success:
            logger.success(f"成功保存 {len(filtered_articles)} 篇文章")
            return True
        else:
            logger.error("保存失败")
            return False

    def batch_scrape(self, accounts_file, pages=10, days=30, include_content=False,
                    interval=10, threads=3, output_dir=None):
        """
        批量爬取多个公众号
        
        从文件读取公众号列表，支持多种分隔符格式。
        
        Args:
            accounts_file: 公众号列表文件路径
            pages: 每个号的最大页数
            days: 时间范围（最近 N 天）
            include_content: 是否获取正文
            interval: 请求间隔（秒）
            threads: 并发线程数
            output_dir: 输出目录
        
        Returns:
            bool: 爬取成功返回 True
        """
        logger.info(f"批量爬取公众号，输入文件: {accounts_file}")
        
        # 读取公众号列表
        try:
            with open(accounts_file, 'r', encoding='utf-8') as f:
                content = f.read()
                
            # 支持多种分隔符：换行、逗号、分号
            import re
            accounts = re.split(r'[\n\r,;，；、\s\t|]+', content.strip())
            accounts = [acc.strip() for acc in accounts if acc.strip()]
        except Exception as e:
            logger.error(f"读取公众号列表失败: {str(e)}")
            return False
        
        if not accounts:
            logger.warning("公众号列表为空")
            return False
        
        logger.info(f"共读取 {len(accounts)} 个公众号")
        
        # 检查登录状态
        if not self.login_manager.is_logged_in():
            logger.error("未登录或登录已过期，请先登录")
            return False
        
        token = self.login_manager.get_token()
        headers = self.login_manager.get_headers()
        
        # 创建批量爬虫实例
        batch_scraper = BatchWeChatScraper()
        
        # 设置回调函数
        def progress_callback(current, total):
            logger.info(f"进度: {current}/{total} 公众号")
        
        def account_status_callback(account_name, status, message):
            if status == 'start':
                logger.info(f"开始爬取: {account_name}")
            elif status == 'done':
                logger.info(f"完成爬取: {account_name}, {message}")
            elif status == 'skip':
                logger.warning(f"跳过爬取: {account_name}, {message}")
        
        def batch_completed_callback(total_articles):
            logger.success(f"批量爬取完成，总共获取 {total_articles} 篇文章")
        
        def error_callback(account_name, error_message):
            logger.error(f"爬取出错: {account_name}, {error_message}")
        
        batch_scraper.set_callback('progress_updated', progress_callback)
        batch_scraper.set_callback('account_status', account_status_callback)
        batch_scraper.set_callback('batch_completed', batch_completed_callback)
        batch_scraper.set_callback('error_occurred', error_callback)
        
        # 计算时间范围
        end_date = datetime.now().date()
        start_date = end_date - timedelta(days=days)
        
        # 确保输出目录存在
        output_dir = output_dir or DEFAULT_OUTPUT_DIR
        os.makedirs(output_dir, exist_ok=True)
        
        # 准备配置
        config = {
            'accounts': accounts,
            'start_date': start_date.strftime('%Y-%m-%d'),
            'end_date': end_date.strftime('%Y-%m-%d'),
            'token': token,
            'headers': headers,
            'max_pages_per_account': pages,
            'request_interval': interval,
            'use_threading': threads > 1,
            'max_workers': threads,
            'include_content': include_content,
            'output_file': os.path.join(output_dir, f"wechat_articles.csv")
        }
        
        # 开始爬取
        logger.info("\n开始批量爬取...")
        logger.info(f"时间范围: {start_date} 至 {end_date}")
        logger.info(f"每个公众号最多爬取 {pages} 页")
        logger.info(f"请求间隔: {interval} 秒")
        
        start_time = time.time()
        articles = batch_scraper.start_batch_scrape(config)
        end_time = time.time()
        
        logger.info(f"\n爬取完成，耗时 {end_time - start_time:.2f} 秒")
        logger.info(f"共获取 {len(articles)} 篇文章，已保存到 {config['output_file']}")
        
        return True


# 便捷函数 - 保持向后兼容
def login():
    """
    登录便捷函数
    
    创建运行器并执行登录，适合一次性使用。
    
    Returns:
        bool: 登录成功返回 True
    """
    runner = WeChatSpiderRunner()
    return runner.login()


def search(name, output_file=None):
    """
    搜索公众号便捷函数
    
    Args:
        name: 搜索关键词
        output_file: 结果保存路径
    
    Returns:
        list: 匹配的公众号列表
    """
    runner = WeChatSpiderRunner()
    return runner.search_account(name, output_file)


def scrape_account(name, pages=10, days=30, include_content=False, interval=10, output_file=None):
    """
    爬取单个公众号便捷函数
    
    Args:
        name: 公众号名称
        pages: 最大页数
        days: 时间范围
        include_content: 是否获取正文
        interval: 请求间隔
        output_file: 输出路径
    
    Returns:
        bool: 成功返回 True
    """
    runner = WeChatSpiderRunner()
    return runner.scrape_single_account(name, pages=pages, days=days, include_content=include_content,
                                        interval=interval, output_file=output_file)


def batch_scrape(accounts_file, pages=10, days=30, include_content=False, interval=10, threads=3, output_dir=None):
    """
    批量爬取便捷函数
    
    Args:
        accounts_file: 公众号列表文件
        pages: 每号最大页数
        days: 时间范围
        include_content: 是否获取正文
        interval: 请求间隔
        threads: 线程数
        output_dir: 输出目录
    
    Returns:
        bool: 成功返回 True
    """
    runner = WeChatSpiderRunner()
    return runner.batch_scrape(accounts_file, pages=pages, days=days, include_content=include_content,
                               interval=interval, threads=threads, output_dir=output_dir)
