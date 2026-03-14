#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
异步爬虫工具模块
================

基于 aiohttp 实现的异步 HTTP 请求功能，通过协程实现真正的
并发请求，相比多线程方案有更低的资源消耗和更高的吞吐量。

核心组件:
    AsyncWeChatClient - 异步微信 API 客户端
    
功能列表:
    - 异步搜索公众号
    - 异步获取文章列表（支持分页并发）
    - 异步获取文章内容（支持批量并发）
    - 自动请求频率控制
    - 失败重试机制

性能优势:
    - 单线程处理大量并发请求
    - 内存占用低于多线程方案
    - I/O 等待时间可被充分利用
    - 支持细粒度的并发控制

使用示例:
    async with AsyncWeChatClient(token, headers) as client:
        results = await client.search_account('人民日报')
        articles = await client.get_articles_list(fakeid, max_pages=10)
"""

import aiohttp
import asyncio
import random
from datetime import datetime
from typing import List, Dict, Tuple, Optional, Any

import bs4
from markdownify import MarkdownConverter

from wechat_article_spider.spider.log.utils import logger


class ImageBlockConverter(MarkdownConverter):
    """
    自定义 Markdown 转换器
    
    重写图片转换逻辑，优先使用 data-src 属性，
    并在图片前后添加换行以提升可读性。
    """
    def convert_img(self, el, text, parent_tags):
        alt = el.attrs.get('alt', None) or ''
        src = el.attrs.get('src', None) or ''
        if not src:
            src = el.attrs.get('data-src', None) or ''
        title = el.attrs.get('title', None) or ''
        title_part = ' "%s"' % title.replace('"', r'\"') if title else ''
        if ('_inline' in parent_tags
                and el.parent.name not in self.options['keep_inline_images_in']):
            return alt
        return '\n![%s](%s%s)\n' % (alt, src, title_part)


def md(soup, **options):
    """将BeautifulSoup对象转换为Markdown"""
    return ImageBlockConverter(**options).convert_soup(soup)


def _preprocess_lazy_images(soup):
    """
    预处理懒加载图片，将data-src复制到src
    
    Args:
        soup: BeautifulSoup对象
    """
    for img in soup.find_all('img'):
        # 检查src是否是占位符（SVG或空）
        src = img.get('src', '')
        data_src = img.get('data-src', '')
        
        # 如果src是SVG占位符或为空，且data-src有值，则替换
        if data_src and (not src or 'data:image/svg' in src or 'pic_blank' in src):
            img['src'] = data_src


def _decode_html_entities(text):
    """
    解码HTML实体和转义字符
    
    Args:
        text: 包含HTML实体的文本
        
    Returns:
        str: 解码后的文本
    """
    import html
    import re
    if not text:
        return text
    
    # 解码HTML实体（如 &amp; -> &, &lt; -> <）
    text = html.unescape(text)
    
    # 处理双重转义的情况（如 \x26lt; -> &lt; -> <）
    # 先处理 \x26 这种十六进制转义
    def replace_hex_escape(match):
        hex_val = match.group(1)
        try:
            return chr(int(hex_val, 16))
        except:
            return match.group(0)
    
    text = re.sub(r'\\x([0-9a-fA-F]{2})', replace_hex_escape, text)
    
    # 再次解码HTML实体（处理双重转义后的结果）
    text = html.unescape(text)
    
    return text


def _extract_fallback_content(soup, content_ele):
    """
    备用内容提取方法，当Markdown转换失败时使用
    
    Args:
        soup: BeautifulSoup对象
        content_ele: 内容元素
        
    Returns:
        str: 提取的内容（Markdown格式）
    """
    content_parts = []
    
    # 1. 提取标题
    title_ele = soup.select_one('.rich_media_title, #activity-name, h1')
    if title_ele and title_ele.get_text(strip=True):
        title_text = _decode_html_entities(title_ele.get_text(strip=True))
        content_parts.append(f"# {title_text}\n")
    
    # 2. 提取文本内容
    if content_ele:
        text_content = content_ele.get_text(separator='\n', strip=True)
        if text_content:
            text_content = _decode_html_entities(text_content)
            content_parts.append(f"\n{text_content}\n")
    
    # 3. 提取所有图片
    if content_ele:
        images = content_ele.find_all('img')
        if images:
            content_parts.append("\n## 图片\n")
            for i, img in enumerate(images, 1):
                src = img.get('src') or img.get('data-src') or ''
                alt = img.get('alt') or f'图片{i}'
                # 过滤掉占位符图片
                if src and 'mmbiz.qpic.cn' in src and 'data:image' not in src:
                    src = _decode_html_entities(src)
                    content_parts.append(f"\n![{alt}]({src})\n")
    
    return ''.join(content_parts) if content_parts else None


def format_time(timestamp: int) -> str:
    """格式化时间戳"""
    try:
        dt = datetime.fromtimestamp(int(timestamp))
        return dt.strftime('%Y-%m-%d %H:%M:%S')
    except:
        return ''


class AsyncWeChatClient:
    """
    异步微信公众号 API 客户端
    
    封装与微信公众平台 API 的异步交互，支持并发控制和请求频率限制。
    使用 async with 语法自动管理 HTTP 会话的生命周期。
    
    Attributes:
        token: 访问令牌
        headers: HTTP 请求头
        max_concurrent: 最大并发请求数
        request_delay: 请求间隔范围
    
    Example:
        async with AsyncWeChatClient(token, headers, max_concurrent=5) as client:
            accounts = await client.search_account('人民日报')
            articles = await client.get_articles_list(fakeid)
    """
    
    def __init__(self, token: str, headers: Dict[str, str],
                 max_concurrent: int = 10,
                 request_delay: Tuple[float, float] = (0.5, 1.5)):
        """
        初始化异步客户端
        
        Args:
            token: 微信公众平台访问令牌
            headers: HTTP 请求头，需包含有效的 cookie
            max_concurrent: 最大并发请求数，控制同时进行的请求数量
            request_delay: 请求间隔范围（最小值, 最大值），单位秒
        """
        self.token = token
        self.headers = headers
        self.max_concurrent = max_concurrent
        self.request_delay = request_delay
        self._semaphore = asyncio.Semaphore(max_concurrent)
        self._session: Optional[aiohttp.ClientSession] = None
    
    async def __aenter__(self):
        """异步上下文管理器入口"""
        self._session = aiohttp.ClientSession(headers=self.headers)
        return self
    
    async def __aexit__(self, exc_type, exc_val, exc_tb):
        """异步上下文管理器出口"""
        if self._session:
            await self._session.close()
    
    async def _delay(self):
        """随机延迟，避免请求过快"""
        delay = random.uniform(*self.request_delay)
        await asyncio.sleep(delay)
    
    async def search_account(self, query: str) -> List[Dict[str, str]]:
        """
        异步搜索公众号
        
        Args:
            query: 公众号名称关键词
            
        Returns:
            list: 包含匹配公众号信息的字典列表
        """
        url = 'https://mp.weixin.qq.com/cgi-bin/searchbiz'
        params = {
            'action': 'search_biz',
            'scene': 1,
            'begin': 0,
            'count': 10,
            'query': query,
            'token': self.token,
            'lang': 'zh_CN',
            'f': 'json',
            'ajax': '1',
        }
        
        async with self._semaphore:
            try:
                async with self._session.get(url, params=params) as response:
                    data = await response.json()
                    
                    wpub_list = [
                        {
                            'wpub_name': item['nickname'],
                            'wpub_fakid': item['fakeid']
                        }
                        for item in data.get('list', [])
                    ]
                    
                    await self._delay()
                    return wpub_list
                    
            except Exception as e:
                logger.error(f"搜索公众号失败: {e}")
                return []
    
    async def get_articles_page(self, fakeid: str, start: int = 0) -> List[Dict[str, Any]]:
        """
        异步获取单页文章列表
        
        Args:
            fakeid: 公众号的fakeid
            start: 起始位置
            
        Returns:
            list: 文章信息列表
        """
        url = 'https://mp.weixin.qq.com/cgi-bin/appmsg'
        params = {
            'action': 'list_ex',
            'begin': start,
            'count': '5',
            'fakeid': fakeid,
            'type': '9',
            'query': '',
            'token': self.token,
            'lang': 'zh_CN',
            'f': 'json',
            'ajax': '1',
        }
        
        async with self._semaphore:
            try:
                async with self._session.get(url, params=params) as response:
                    data = await response.json()
                    
                    articles = []
                    for item in data.get('app_msg_list', []):
                        articles.append({
                            'title': item['title'],
                            'link': item['link'],
                            'update_time': item['update_time']
                        })
                    
                    await self._delay()
                    return articles
                    
            except Exception as e:
                logger.error(f"获取文章列表失败 (start={start}): {e}")
                return []
    
    async def get_articles_list(self, fakeid: str, max_pages: int = 10,
                                progress_callback=None) -> List[Dict[str, Any]]:
        """
        异步获取多页文章列表（并发）
        
        Args:
            fakeid: 公众号的fakeid
            max_pages: 最大页数
            progress_callback: 进度回调函数 (current, total)
            
        Returns:
            list: 所有文章信息列表
        """
        # 创建所有页面的任务
        tasks = []
        for page in range(max_pages):
            start = page * 5
            tasks.append(self.get_articles_page(fakeid, start))
        
        # 并发执行所有任务
        all_articles = []
        results = await asyncio.gather(*tasks, return_exceptions=True)
        
        for i, result in enumerate(results):
            if isinstance(result, Exception):
                logger.error(f"获取第{i+1}页失败: {result}")
                continue
            
            if not result:  # 空页面，可能已到末尾
                break
                
            all_articles.extend(result)
            
            if progress_callback:
                progress_callback(i + 1, max_pages)
        
        return all_articles
    
    async def get_article_content(self, url: str, max_retries: int = 3) -> str:
        """
        异步获取单篇文章内容，支持重试机制
        
        Args:
            url: 文章链接
            max_retries: 最大重试次数，默认3次
            
        Returns:
            str: 文章内容（Markdown格式）
        """
        # 定义多个可能的内容选择器，按优先级排序
        # 支持普通图文文章、图片类文章、视频类文章等多种类型
        CONTENT_SELECTORS = [
            # === 普通图文文章 ===
            ".rich_media_content",           # 标准文章内容（最常见）
            "#js_content",                   # 标准文章内容（ID选择器）
            
            # === 图片类文章（page_share_img）===
            "#js_image_content",             # 图片类文章主容器
            ".image_content",                # 图片类文章内容区
            "#js_image_desc",                # 图片类文章描述
            ".share_notice",                 # 图片类文章分享提示
            
            # === 图片轮播组件 ===
            ".swiper_item_img",              # 轮播图片项
            "#img_swiper_content",           # 轮播内容容器
            ".share_media_swiper_content",   # 轮播媒体内容
            ".img_swiper_area",              # 轮播区域
            
            # === 视频类文章 ===
            "#js_video_content",             # 视频类文章内容
            ".video_content",                # 视频内容区
            ".rich_media_video",             # 视频媒体区
            
            # === 其他内容区域 ===
            ".rich_media_area_primary",      # 主要内容区域
            ".rich_media_area_primary_inner",# 主要内容区域内部
            "#js_article_content",           # 文章内容容器
            "#js_content_container",         # 内容容器
            
            # === 备用选择器 ===
            "#page-content",                 # 页面内容
            ".rich_media_inner",             # 富媒体内部
            ".rich_media_wrp",               # 富媒体包装
            "article",                       # HTML5 article标签
            ".article",                      # 文章类
            "#article",                      # 文章ID
        ]
        
        # 内容有效性检测的最小长度阈值
        MIN_CONTENT_LENGTH = 10
        retry_delay = 2.0  # 初始重试延迟（秒）
        
        for attempt in range(max_retries):
            async with self._semaphore:
                try:
                    # 设置超时
                    timeout = aiohttp.ClientTimeout(total=30)
                    async with self._session.get(url, timeout=timeout) as response:
                        if response.status != 200:
                            logger.warning(f"请求失败，状态码: {response.status}，尝试 {attempt + 1}/{max_retries}")
                            if attempt < max_retries - 1:
                                await asyncio.sleep(retry_delay)
                                retry_delay = min(retry_delay * 1.5, 10)
                                continue
                            return f"请求失败，状态码: {response.status}"
                        
                        html = await response.text()
                        soup = bs4.BeautifulSoup(html, 'lxml')
                        
                        # 预处理懒加载图片
                        _preprocess_lazy_images(soup)
                        
                        # 检测文章类型
                        body_classes = soup.body.get('class', []) if soup.body else []
                        is_image_article = 'page_share_img' in body_classes
                        
                        # 检测是否有图片轮播组件（swiper）
                        has_swiper = bool(soup.select('.swiper_item, .swiper_item_img, .share_media_swiper'))
                        
                        if is_image_article or has_swiper:
                            logger.info(f"检测到图片类型文章（page_share_img={is_image_article}, swiper={has_swiper}），使用特殊处理")
                            content = self._extract_image_article_content(soup)
                            if content and len(content.strip()) >= MIN_CONTENT_LENGTH:
                                await self._delay()
                                return content
                        
                        # 尝试多个选择器
                        content_ele = None
                        used_selector = None
                        for selector in CONTENT_SELECTORS:
                            content_ele = soup.select(selector)
                            if content_ele:
                                used_selector = selector
                                logger.debug(f"使用选择器 '{selector}' 匹配到内容元素")
                                break
                        
                        content = ""
                        if content_ele:
                            content = md(content_ele[0], keep_inline_images_in=["section", "span"])
                            
                            # 验证内容是否有效（去除空白后长度大于阈值）
                            content_stripped = content.strip()
                            if len(content_stripped) < MIN_CONTENT_LENGTH:
                                logger.warning(f"Markdown转换后内容过短({len(content_stripped)}字符)，尝试备用提取方法")
                                fallback_content = _extract_fallback_content(soup, content_ele[0])
                                if fallback_content and len(fallback_content.strip()) > len(content_stripped):
                                    content = fallback_content
                                    logger.info("使用备用提取方法成功获取内容")
                        
                        # 检查内容是否有效
                        if content and len(content.strip()) >= MIN_CONTENT_LENGTH:
                            logger.info(f"成功获取文章内容，长度: {len(content.strip())} 字符")
                            await self._delay()
                            return content
                        
                        # 内容为空或过短，可能是页面未完全加载，进行重试
                        if attempt < max_retries - 1:
                            logger.warning(f"内容为空或过短，可能页面未完全加载，{retry_delay}秒后重试 ({attempt + 1}/{max_retries})")
                            await asyncio.sleep(retry_delay)
                            # 增加重试延迟，给页面更多加载时间
                            retry_delay = min(retry_delay * 1.5, 10)
                        else:
                            # 最后一次尝试，返回已获取的内容（即使为空）
                            logger.warning(f"重试{max_retries}次后仍无法获取有效内容，URL: {url}")
                            if not content:
                                # 尝试最后的备用方法：提取所有文本
                                content = self._extract_all_text_content(soup)
                            await self._delay()
                            return content
                        
                except asyncio.TimeoutError:
                    logger.warning(f"请求超时，尝试 {attempt + 1}/{max_retries}")
                    if attempt < max_retries - 1:
                        await asyncio.sleep(retry_delay)
                        retry_delay = min(retry_delay * 1.5, 10)
                    else:
                        return "获取文章内容失败: 请求超时"
                except aiohttp.ClientError as e:
                    logger.warning(f"请求异常: {e}，尝试 {attempt + 1}/{max_retries}")
                    if attempt < max_retries - 1:
                        await asyncio.sleep(retry_delay)
                        retry_delay = min(retry_delay * 1.5, 10)
                    else:
                        return f"获取文章内容失败: {str(e)}"
                except Exception as e:
                    logger.error(f"获取文章内容时发生异常: {e}")
                    return f"获取文章内容失败: {str(e)}"
        
        return ""
    
    def _extract_all_text_content(self, soup) -> str:
        """
        最后的备用方法：提取页面所有可见文本内容
        
        Args:
            soup: BeautifulSoup对象
            
        Returns:
            str: 提取的文本内容
        """
        content_parts = []
        
        # 尝试获取标题
        title_ele = soup.select_one('.rich_media_title, #activity-name, h1')
        if title_ele and title_ele.get_text(strip=True):
            content_parts.append(f"# {title_ele.get_text(strip=True)}\n")
        
        # 尝试获取主要内容区域的文本
        main_content_selectors = [
            '.rich_media_content',
            '#js_content',
            '.rich_media_area_primary',
            'article',
            '.article-content'
        ]
        
        for selector in main_content_selectors:
            ele = soup.select_one(selector)
            if ele:
                text = ele.get_text(separator='\n', strip=True)
                if text and len(text) > 20:
                    content_parts.append(f"\n{text}\n")
                    break
        
        # 提取所有图片
        images = soup.select('img[data-src], img[src*="mmbiz.qpic.cn"]')
        if images:
            content_parts.append("\n## 图片\n")
            for i, img in enumerate(images[:20], 1):  # 限制最多20张图片
                src = img.get('data-src') or img.get('src') or ''
                if src and 'mmbiz.qpic.cn' in src and 'data:image' not in src:
                    alt = img.get('alt') or f'图片{i}'
                    content_parts.append(f"\n![{alt}]({src})\n")
        
        return ''.join(content_parts) if content_parts else ""
    
    def _extract_image_article_content(self, soup) -> str:
        """
        提取图片类型文章的内容
        
        Args:
            soup: BeautifulSoup对象
            
        Returns:
            str: 提取的内容（Markdown格式）
        """
        import re
        import json
        
        content_parts = []
        seen_urls = set()  # 用于去重
        
        def add_image(src, alt=''):
            """添加图片到内容列表"""
            nonlocal seen_urls
            if not src:
                return
            # 解码URL中的HTML实体
            src = _decode_html_entities(src)
            # 标准化URL用于去重
            base_url = src.split('?')[0] if '?' in src else src
            if base_url in seen_urls:
                return
            if 'mmbiz.qpic.cn' not in src:
                return
            if 'pic_blank' in src or 'data:image' in src:
                return
            seen_urls.add(base_url)
            alt = alt or f'图片{len(seen_urls)}'
            content_parts.append(f"\n![{alt}]({src})\n")
        
        def extract_url_from_jsdecode(text):
            """
            从 JsDecode('url') 格式中提取 URL
            
            Args:
                text: 可能包含 JsDecode 的文本
                
            Returns:
                str: 提取的 URL，如果没有则返回原文本
            """
            # 匹配 JsDecode('...') 或 JsDecode("...")
            match = re.search(r"JsDecode\(['\"]([^'\"]+)['\"]\)", text)
            if match:
                url = match.group(1)
                # 解码 JavaScript 转义字符（如 \x26 -> &）
                url = _decode_html_entities(url)
                return url
            return text
        
        # 1. 提取标题
        title_selectors = ['.rich_media_title', '#activity-name', '#js_image_content h1', 'h1']
        for selector in title_selectors:
            title_ele = soup.select_one(selector)
            if title_ele and title_ele.get_text(strip=True):
                title_text = _decode_html_entities(title_ele.get_text(strip=True))
                content_parts.append(f"# {title_text}\n")
                break
        
        # 2. 提取描述/摘要
        desc_selectors = ['#js_image_desc', '.share_notice', 'meta[name="description"]']
        for selector in desc_selectors:
            if selector.startswith('meta'):
                desc_ele = soup.select_one(selector)
                if desc_ele and desc_ele.get('content'):
                    desc_text = _decode_html_entities(desc_ele.get('content'))
                    content_parts.append(f"\n{desc_text}\n")
                    break
            else:
                desc_ele = soup.select_one(selector)
                if desc_ele and desc_ele.get_text(strip=True):
                    desc_text = _decode_html_entities(desc_ele.get_text(strip=True))
                    content_parts.append(f"\n{desc_text}\n")
                    break
        
        # 3. 从 JavaScript 变量中提取图片（最可靠的方法）
        js_images_found = False
        for script in soup.find_all('script'):
            script_text = script.string or ''
            if 'picture_page_info_list' in script_text:
                # 方法3a: 直接使用正则表达式提取 cdn_url（处理 JsDecode 包装的情况）
                # 这是最可靠的方法，因为它不依赖于 JSON 解析
                cdn_url_pattern = r"cdn_url:\s*(?:JsDecode\(['\"]([^'\"]+)['\"]\)|['\"]([^'\"]+)['\"])"
                cdn_matches = re.findall(cdn_url_pattern, script_text)
                
                if cdn_matches:
                    content_parts.append("\n## 图片内容\n")
                    for match_tuple in cdn_matches:
                        # match_tuple 是 (jsdecode_url, direct_url) 的元组
                        cdn_url = match_tuple[0] or match_tuple[1]
                        if cdn_url:
                            # 解码 URL 中的转义字符和 HTML 实体
                            cdn_url = _decode_html_entities(cdn_url)
                            add_image(cdn_url)
                    js_images_found = True
                    logger.info(f"从 picture_page_info_list 使用正则提取到 {len(cdn_matches)} 张图片")
                else:
                    # 方法3b: 尝试标准 JSON 解析（作为备用）
                    match = re.search(r'var\s+picture_page_info_list\s*=\s*(\[[\s\S]*?\])\s*;', script_text)
                    if not match:
                        match = re.search(r'var\s+picture_page_info_list\s*=\s*(\[.*\])', script_text, re.DOTALL)
                    
                    if match:
                        try:
                            json_str = match.group(1)
                            # 先解码 HTML 实体（如 &amp; -> &）
                            json_str = _decode_html_entities(json_str)
                            # 尝试解析 JSON
                            pic_list = json.loads(json_str)
                            
                            if pic_list:
                                content_parts.append("\n## 图片内容\n")
                                for pic_info in pic_list:
                                    cdn_url = pic_info.get('cdn_url', '')
                                    if cdn_url:
                                        # 再次解码 URL 中的 HTML 实体
                                        cdn_url = _decode_html_entities(cdn_url)
                                        add_image(cdn_url)
                                js_images_found = True
                                logger.info(f"从 picture_page_info_list JSON 解析提取到 {len(pic_list)} 张图片")
                        except json.JSONDecodeError as e:
                            logger.warning(f"JSON 解析失败: {e}，尝试修复 JSON 字符串")
                            # 尝试修复常见的 JSON 问题
                            try:
                                # 移除可能的尾部逗号
                                json_str_fixed = re.sub(r',\s*\]', ']', json_str)
                                json_str_fixed = re.sub(r',\s*\}', '}', json_str_fixed)
                                pic_list = json.loads(json_str_fixed)
                                
                                if pic_list:
                                    content_parts.append("\n## 图片内容\n")
                                    for pic_info in pic_list:
                                        cdn_url = pic_info.get('cdn_url', '')
                                        if cdn_url:
                                            cdn_url = _decode_html_entities(cdn_url)
                                            add_image(cdn_url)
                                    js_images_found = True
                                    logger.info(f"修复 JSON 后从 picture_page_info_list 提取到 {len(pic_list)} 张图片")
                            except Exception as e2:
                                logger.debug(f"修复 JSON 后仍然解析失败: {e2}")
                        except Exception as e:
                            logger.debug(f"解析 picture_page_info_list 失败: {e}")
        
        # 4. 如果JS方法没找到图片，尝试从 swiper_item 容器的 data-src 属性提取
        if not js_images_found or len(seen_urls) == 0:
            # 方法4a: 从 swiper_item 容器的 data-src 属性提取（新的HTML结构）
            swiper_items = soup.select('.swiper_item[data-src], div[data-src*="mmbiz.qpic.cn"]')
            if swiper_items:
                if not js_images_found:
                    content_parts.append("\n## 图片内容\n")
                for item in swiper_items:
                    src = item.get('data-src', '')
                    if src:
                        add_image(src)
            
            # 方法4b: 从 swiper_item_img 内的 img 标签提取
            swiper_images = soup.select('.swiper_item_img img')
            if swiper_images:
                if not js_images_found and len(seen_urls) == 0:
                    content_parts.append("\n## 图片内容\n")
                for img in swiper_images:
                    src = img.get('src') or img.get('data-src') or ''
                    alt = img.get('alt') or ''
                    add_image(src, alt)
            
            # 方法4c: 从其他图片容器提取
            if len(seen_urls) == 0:
                other_selectors = [
                    '#js_image_content img',
                    '.image_content img',
                    '.wx_img_swiper img',
                    '.img_swiper_wrp img'
                ]
                for selector in other_selectors:
                    images = soup.select(selector)
                    if images:
                        if len(seen_urls) == 0:
                            content_parts.append("\n## 图片内容\n")
                        for img in images:
                            src = img.get('src') or img.get('data-src') or ''
                            alt = img.get('alt') or ''
                            add_image(src, alt)
                        if len(seen_urls) > 0:
                            break
        
        # 5. 通用兜底方法：提取所有 mmbiz.qpic.cn 域名的图片
        # 这是最后的保障，确保不会遗漏任何图片
        if len(seen_urls) == 0:
            logger.info("使用通用兜底方法提取所有微信图片")
            content_parts.append("\n## 图片内容\n")
            
            # 方法5a: 提取所有带有 mmbiz.qpic.cn 的 img 标签
            all_images = soup.find_all('img')
            for img in all_images:
                # 尝试从多个属性获取图片URL
                src = img.get('src') or img.get('data-src') or img.get('data-original') or ''
                alt = img.get('alt') or ''
                if src:
                    add_image(src, alt)
            
            # 方法5b: 提取所有带有 data-src 属性且包含 mmbiz.qpic.cn 的元素（不仅仅是img）
            elements_with_data_src = soup.find_all(attrs={'data-src': True})
            for ele in elements_with_data_src:
                src = ele.get('data-src', '')
                if src:
                    add_image(src)
            
            # 方法5c: 从 style 属性中提取背景图片URL
            elements_with_style = soup.find_all(style=True)
            for ele in elements_with_style:
                style = ele.get('style', '')
                # 匹配 background-image: url(...) 或 background: url(...)
                bg_matches = re.findall(r'url\(["\']?(https?://mmbiz\.qpic\.cn[^"\')\s]+)["\']?\)', style)
                for bg_url in bg_matches:
                    add_image(bg_url)
        
        # 6. 提取话题标签（清理HTML标签）
        topic_links = soup.select('.wx_topic_link')
        if topic_links:
            topics = []
            for link in topic_links:
                topic_text = link.get_text(strip=True)
                if topic_text:
                    # 清理话题文本
                    topic_text = _decode_html_entities(topic_text)
                    # 移除可能残留的HTML标签
                    topic_text = re.sub(r'<[^>]+>', '', topic_text)
                    if topic_text and not topic_text.startswith('<'):
                        topics.append(topic_text)
            if topics:
                content_parts.append(f"\n**话题标签**: {' '.join(topics)}\n")
        
        return ''.join(content_parts) if content_parts else None
    
    async def get_articles_content_batch(self, articles: List[Dict[str, Any]],
                                         progress_callback=None) -> List[Dict[str, Any]]:
        """
        异步批量获取文章内容（并发）
        
        Args:
            articles: 文章列表，每篇需包含'link'字段
            progress_callback: 进度回调函数 (current, total, message)
            
        Returns:
            list: 更新了content字段的文章列表
        """
        total = len(articles)
        
        async def fetch_content(index: int, article: Dict[str, Any]) -> Dict[str, Any]:
            content = await self.get_article_content(article['link'])
            article['content'] = content
            
            if progress_callback:
                progress_callback(index + 1, total, f"正在获取第 {index+1}/{total} 篇文章内容")
            
            return article
        
        # 创建所有任务
        tasks = [fetch_content(i, article) for i, article in enumerate(articles)]
        
        # 并发执行
        results = await asyncio.gather(*tasks, return_exceptions=True)
        
        # 处理结果
        updated_articles = []
        for i, result in enumerate(results):
            if isinstance(result, Exception):
                logger.error(f"获取文章内容失败: {result}")
                articles[i]['content'] = f"获取失败: {str(result)}"
                updated_articles.append(articles[i])
            else:
                updated_articles.append(result)
        
        return updated_articles


async def async_scrape_account(token: str, headers: Dict[str, str],
                               account_name: str, max_pages: int = 10,
                               include_content: bool = False,
                               max_concurrent: int = 5,
                               progress_callback=None,
                               content_progress_callback=None) -> List[Dict[str, Any]]:
    """
    异步爬取单个公众号的文章
    
    Args:
        token: 访问token
        headers: 请求头
        account_name: 公众号名称
        max_pages: 最大页数
        include_content: 是否获取文章内容
        max_concurrent: 最大并发数
        progress_callback: 文章列表进度回调
        content_progress_callback: 内容获取进度回调
        
    Returns:
        list: 文章列表
    """
    async with AsyncWeChatClient(token, headers, max_concurrent=max_concurrent) as client:
        # 搜索公众号
        search_results = await client.search_account(account_name)
        if not search_results:
            logger.error(f"未找到公众号: {account_name}")
            return []
        
        fakeid = search_results[0]['wpub_fakid']
        
        # 获取文章列表
        articles = await client.get_articles_list(fakeid, max_pages, progress_callback)
        
        # 添加公众号名称和格式化时间
        for article in articles:
            article['name'] = account_name
            article['publish_timestamp'] = article['update_time']
            article['publish_time'] = format_time(article['update_time'])
            article['content'] = ''
        
        # 获取文章内容
        if include_content and articles:
            articles = await client.get_articles_content_batch(articles, content_progress_callback)
        
        return articles


async def async_scrape_accounts_batch(token: str, headers: Dict[str, str],
                                      accounts: List[str], max_pages: int = 10,
                                      include_content: bool = False,
                                      max_concurrent_accounts: int = 3,
                                      max_concurrent_requests: int = 5,
                                      account_callback=None,
                                      progress_callback=None) -> List[Dict[str, Any]]:
    """
    异步批量爬取多个公众号的文章
    
    Args:
        token: 访问token
        headers: 请求头
        accounts: 公众号名称列表
        max_pages: 每个公众号的最大页数
        include_content: 是否获取文章内容
        max_concurrent_accounts: 最大并发公众号数
        max_concurrent_requests: 每个公众号的最大并发请求数
        account_callback: 公众号状态回调 (account_name, status, message)
        progress_callback: 总体进度回调 (article_count, message)
        
    Returns:
        list: 所有文章列表
    """
    semaphore = asyncio.Semaphore(max_concurrent_accounts)
    all_articles = []
    lock = asyncio.Lock()
    
    async def scrape_single(account_name: str):
        async with semaphore:
            if account_callback:
                account_callback(account_name, 'processing', '正在处理...')
            
            try:
                articles = await async_scrape_account(
                    token, headers, account_name, max_pages,
                    include_content, max_concurrent_requests
                )
                
                async with lock:
                    all_articles.extend(articles)
                    if progress_callback:
                        progress_callback(len(all_articles), f"已获取 {len(all_articles)} 篇文章")
                
                if account_callback:
                    account_callback(account_name, 'completed', f"完成，获得 {len(articles)} 篇文章")
                
                return articles
                
            except Exception as e:
                error_msg = f"处理失败: {str(e)}"
                if account_callback:
                    account_callback(account_name, 'error', error_msg)
                logger.error(f"{account_name}: {error_msg}")
                return []
    
    # 并发爬取所有公众号
    tasks = [scrape_single(account) for account in accounts]
    await asyncio.gather(*tasks, return_exceptions=True)
    
    return all_articles


def run_async_scrape(token: str, headers: Dict[str, str],
                     accounts: List[str], max_pages: int = 10,
                     include_content: bool = False,
                     max_concurrent_accounts: int = 3,
                     max_concurrent_requests: int = 5,
                     account_callback=None,
                     progress_callback=None) -> List[Dict[str, Any]]:
    """
    同步包装器 - 在新的事件循环中运行异步爬取
    
    这个函数可以在非异步环境（如QThread）中调用
    
    Args:
        token: 访问token
        headers: 请求头
        accounts: 公众号名称列表
        max_pages: 每个公众号的最大页数
        include_content: 是否获取文章内容
        max_concurrent_accounts: 最大并发公众号数
        max_concurrent_requests: 每个公众号的最大并发请求数
        account_callback: 公众号状态回调
        progress_callback: 总体进度回调
        
    Returns:
        list: 所有文章列表
    """
    # 创建新的事件循环
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    
    try:
        result = loop.run_until_complete(
            async_scrape_accounts_batch(
                token, headers, accounts, max_pages,
                include_content, max_concurrent_accounts,
                max_concurrent_requests, account_callback,
                progress_callback
            )
        )
        return result
    finally:
        loop.close()