#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
微信公众号爬虫工具函数
====================

提供爬虫核心功能所需的底层工具函数，包括 HTTP 请求封装、
HTML 内容解析、数据格式转换等。
"""

import requests
import random
import time
import os
import csv
from dataclasses import dataclass
from datetime import datetime
from typing import Optional

from tqdm import tqdm
import bs4
from markdownify import MarkdownConverter

from wechat_article_spider.spider.log.utils import logger


class ImageBlockConverter(MarkdownConverter):
    """自定义 Markdown 转换器，重写图片处理逻辑"""

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
    """将 BeautifulSoup 对象转换为 Markdown 文本"""
    return ImageBlockConverter(**options).convert_soup(soup)


def get_fakid(headers, tok, query):
    """搜索公众号并获取 fakeid"""
    url = 'https://mp.weixin.qq.com/cgi-bin/searchbiz'
    data = {
        'action': 'search_biz',
        'scene': 1,
        'begin': 0,
        'count': 10,
        'query': query,
        'token': tok,
        'lang': 'zh_CN',
        'f': 'json',
        'ajax': '1',
    }

    r = requests.get(url, headers=headers, params=data)
    dic = r.json()

    if not isinstance(dic.get('list'), list):
        base = dic.get('base_resp') or {}
        message = base.get('err_msg') or base.get('errmsg') or 'unknown'
        logger.warning(f"公众号搜索接口未返回列表: ret={base.get('ret')}, message={message}")
        return []

    wpub_list = [
        {
            'wpub_name': item['nickname'],
            'wpub_fakid': item['fakeid']
        }
        for item in dic['list']
    ]

    return wpub_list


def get_articles_list(page_num, start_page, fakeid, token, headers):
    """分页获取公众号的历史文章列表"""
    url = 'https://mp.weixin.qq.com/cgi-bin/appmsg'
    title = []
    link = []
    update_time = []

    with tqdm(total=page_num) as pbar:
        for i in range(page_num):
            data = {
                'action': 'list_ex',
                'begin': start_page + i*5,
                'count': '5',
                'fakeid': fakeid,
                'type': '9',
                'query': '',
                'token': token,
                'lang': 'zh_CN',
                'f': 'json',
                'ajax': '1',
            }

            time.sleep(random.randint(1, 2))

            r = requests.get(url, headers=headers, params=data)
            dic = r.json()

            logger.info(f"API响应状态: {r.status_code}")
            if 'base_resp' in dic:
                logger.info(f"base_resp: {dic['base_resp']}")
            logger.info(f"app_msg_cnt: {dic.get('app_msg_cnt', 'N/A')}, 本页文章数: {len(dic.get('app_msg_list', []))}")

            if 'app_msg_list' not in dic:
                logger.warning(f"未找到文章列表, 响应为: {dic}")
                break

            for item in dic['app_msg_list']:
                title.append(item['title'])
                link.append(item['link'])
                update_time.append(item['update_time'])

            pbar.update(1)

    return title, link, update_time


def _preprocess_lazy_images(soup):
    """预处理微信文章中的懒加载图片"""
    for img in soup.find_all('img'):
        src = img.get('src', '')
        data_src = img.get('data-src', '')

        if data_src and (not src or 'data:image/svg' in src or 'pic_blank' in src):
            img['src'] = data_src
            logger.debug(f"替换懒加载图片: {data_src[:50]}...")


def _extract_fallback_content(soup, content_ele):
    """备用内容提取方法"""
    content_parts = []

    title_ele = soup.select_one('.rich_media_title, #activity-name, h1')
    if title_ele and title_ele.get_text(strip=True):
        content_parts.append(f"# {title_ele.get_text(strip=True)}\n")

    if content_ele:
        text_content = content_ele.get_text(separator='\n', strip=True)
        if text_content:
            content_parts.append(f"\n{text_content}\n")

    if content_ele:
        images = content_ele.find_all('img')
        if images:
            content_parts.append("\n## 图片\n")
            for i, img in enumerate(images, 1):
                src = img.get('src') or img.get('data-src') or ''
                alt = img.get('alt') or f'图片{i}'
                if src and 'mmbiz.qpic.cn' in src and 'data:image' not in src:
                    content_parts.append(f"\n![{alt}]({src})\n")

    return ''.join(content_parts) if content_parts else None


@dataclass(frozen=True)
class ArticleParseResult:
    """Stable parser result used by the Node migration golden fixtures."""

    status: str
    article_type: str
    content: str = ""
    error: Optional[str] = None


CONTENT_SELECTORS = [
    ".rich_media_content",
    "#js_content",
    "#js_image_content",
    ".image_content",
    "#js_image_desc",
    ".share_notice",
    ".swiper_item_img",
    "#img_swiper_content",
    ".share_media_swiper_content",
    ".img_swiper_area",
    "#js_video_content",
    ".video_content",
    ".rich_media_video",
    ".rich_media_area_primary",
    ".rich_media_area_primary_inner",
    "#js_article_content",
    "#js_content_container",
    "#page-content",
    ".rich_media_inner",
    ".rich_media_wrp",
    "article",
    ".article",
    "#article",
]

PAGE_STATE_MARKERS = {
    "blocked": (
        "环境异常",
        "完成验证后即可继续访问",
        "访问过于频繁",
        "操作频繁",
    ),
    "expired": (
        "该内容已被发布者删除",
        "此内容因违规无法查看",
        "该内容已被发布者删除或屏蔽",
        "内容已过期",
    ),
}


def _extract_video_article_content(soup, content_ele):
    """Preserve readable copy and public media links from a video article."""
    content_parts = []
    title = soup.select_one('.rich_media_title, #activity-name, h1')
    if title and title.get_text(strip=True):
        content_parts.append(f"# {title.get_text(strip=True)}\n")

    if content_ele:
        converted = md(content_ele, keep_inline_images_in=["section", "span"])
        if converted.strip():
            content_parts.append(f"\n{converted.strip()}\n")

    seen = set()
    for element in soup.select(
        'video[src], video[data-src], iframe[src], iframe[data-src], mp-video[src]'
    ):
        source = element.get('data-src') or element.get('src') or ''
        source = _decode_html_entities(source.strip())
        if source.startswith(('https://', 'http://')) and source not in seen:
            seen.add(source)
            content_parts.append(f"\n[视频]({source})\n")
    return ''.join(content_parts).strip()


def parse_article_html(html_text):
    """Parse a captured WeChat page without performing network requests.

    ``status`` distinguishes genuine article content from access-control and
    removed-content pages, preventing agents from indexing an error page as an
    article. The function is intentionally deterministic for golden fixtures.
    """
    soup = bs4.BeautifulSoup(html_text or "", 'lxml')
    page_text = soup.get_text(" ", strip=True)
    has_article_container = bool(
        soup.select('.rich_media_content, #js_content, #js_image_content, #js_video_content')
    )
    looks_like_error_page = bool(
        soup.select('.weui-msg, .weui_msg, #js_error_msg, .page_msg')
    ) or not has_article_container
    if looks_like_error_page:
        for status, markers in PAGE_STATE_MARKERS.items():
            if any(marker in page_text for marker in markers):
                message = "页面访问受限" if status == "blocked" else "文章已删除、屏蔽或过期"
                return ArticleParseResult(status=status, article_type="unavailable", error=message)

    _preprocess_lazy_images(soup)
    body_classes = soup.body.get('class', []) if soup.body else []
    is_image_article = 'page_share_img' in body_classes or bool(
        soup.select('.swiper_item, .swiper_item_img, .share_media_swiper')
    )
    is_video_article = bool(
        soup.select('#js_video_content, .video_content, .rich_media_video, video, mp-video')
    )

    if is_image_article:
        content = _extract_image_article_content(soup) or ""
        if len(content.strip()) >= 10:
            return ArticleParseResult("ok", "image", content.strip())

    content_ele = None
    for selector in CONTENT_SELECTORS:
        matches = soup.select(selector)
        if matches:
            content_ele = matches[0]
            logger.debug(f"使用选择器 '{selector}' 匹配到内容元素")
            break

    if is_video_article:
        content = _extract_video_article_content(soup, content_ele)
        if len(content.strip()) >= 10:
            return ArticleParseResult("ok", "video", content.strip())

    content = ""
    if content_ele:
        content = md(content_ele, keep_inline_images_in=["section", "span"])
        if len(content.strip()) < 10:
            fallback = _extract_fallback_content(soup, content_ele)
            if fallback and len(fallback.strip()) > len(content.strip()):
                content = fallback

    if len(content.strip()) >= 10:
        return ArticleParseResult("ok", "normal", content.strip())

    content = _extract_all_text_content(soup)
    if len(content.strip()) >= 10:
        return ArticleParseResult("ok", "normal", content.strip())
    return ArticleParseResult(
        status="empty",
        article_type="unknown",
        error="未找到有效文章内容",
    )


def get_article_content(url, headers, max_retries=3, retry_delay=2):
    """获取文章正文内容并转换为 Markdown"""
    for attempt in range(max_retries):
        try:
            response = requests.get(url, headers=headers, timeout=30)
            if response.status_code != 200:
                logger.warning(f"请求失败，状态码: {response.status_code}，尝试 {attempt + 1}/{max_retries}")
                if attempt < max_retries - 1:
                    time.sleep(retry_delay)
                    continue
                return f"请求失败，状态码: {response.status_code}"

            result = parse_article_html(response.text)
            if result.status == "ok":
                logger.info(f"成功获取{result.article_type}文章内容，长度: {len(result.content)} 字符")
                return result.content
            if result.status in ("blocked", "expired"):
                logger.warning(result.error)
                return f"获取文章内容失败: {result.error}"

            if attempt < max_retries - 1:
                logger.warning(f"内容为空或过短，可能页面未完全加载，{retry_delay}秒后重试 ({attempt + 1}/{max_retries})")
                time.sleep(retry_delay)
                retry_delay = min(retry_delay * 1.5, 10)
            else:
                logger.warning(f"重试{max_retries}次后仍无法获取有效内容，URL: {url}")
                return ""

        except requests.exceptions.Timeout:
            logger.warning(f"请求超时，尝试 {attempt + 1}/{max_retries}")
            if attempt < max_retries - 1:
                time.sleep(retry_delay)
            else:
                return "获取文章内容失败: 请求超时"
        except requests.exceptions.RequestException as e:
            logger.warning(f"请求异常: {e}，尝试 {attempt + 1}/{max_retries}")
            if attempt < max_retries - 1:
                time.sleep(retry_delay)
            else:
                return f"获取文章内容失败: {str(e)}"
        except Exception as e:
            logger.error(f"获取文章内容时发生异常: {e}")
            return f"获取文章内容失败: {str(e)}"

    return ""


def _extract_all_text_content(soup):
    """最后的兜底方法：提取页面所有可见文本"""
    content_parts = []

    title_ele = soup.select_one('.rich_media_title, #activity-name, h1')
    if title_ele and title_ele.get_text(strip=True):
        content_parts.append(f"# {title_ele.get_text(strip=True)}\n")

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

    images = soup.select('img[data-src], img[src*="mmbiz.qpic.cn"]')
    if images:
        content_parts.append("\n## 图片\n")
        for i, img in enumerate(images[:20], 1):
            src = img.get('data-src') or img.get('src') or ''
            if src and 'mmbiz.qpic.cn' in src and 'data:image' not in src:
                alt = img.get('alt') or f'图片{i}'
                content_parts.append(f"\n![{alt}]({src})\n")

    return ''.join(content_parts) if content_parts else ""


def _decode_html_entities(text):
    """解码 HTML 实体和 JavaScript 转义字符"""
    import html
    if not text:
        return text

    text = html.unescape(text)

    import re
    def replace_hex_escape(match):
        hex_val = match.group(1)
        try:
            return chr(int(hex_val, 16))
        except:
            return match.group(0)

    text = re.sub(r'\\x([0-9a-fA-F]{2})', replace_hex_escape, text)
    text = html.unescape(text)

    return text


def _extract_image_article_content(soup):
    """提取图片类型文章的内容"""
    content_parts = []
    seen_urls = set()

    def add_image(src, alt=''):
        nonlocal seen_urls
        if not src:
            return
        src = _decode_html_entities(src)
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

    # 3. 从 JavaScript 变量中提取图片
    import re
    import json as json_module
    js_images_found = False
    for script in soup.find_all('script'):
        script_text = script.string or ''
        if 'picture_page_info_list' in script_text:
            match = re.search(r'var\s+picture_page_info_list\s*=\s*(\[[\s\S]*?\]);', script_text)
            if match:
                try:
                    json_str = match.group(1)
                    json_str = _decode_html_entities(json_str)
                    pic_list = json_module.loads(json_str)

                    if pic_list:
                        content_parts.append("\n## 图片内容\n")
                        for pic_info in pic_list:
                            cdn_url = pic_info.get('cdn_url', '')
                            if cdn_url:
                                cdn_url = _decode_html_entities(cdn_url)
                                add_image(cdn_url)
                        js_images_found = True
                except (json_module.JSONDecodeError, Exception) as e:
                    logger.debug(f"解析 picture_page_info_list 失败: {e}")

    # 4. 如果JS方法没找到图片，尝试从 swiper_item 容器提取
    if not js_images_found or len(seen_urls) == 0:
        swiper_items = soup.select('.swiper_item[data-src], div[data-src*="mmbiz.qpic.cn"]')
        if swiper_items:
            if not js_images_found:
                content_parts.append("\n## 图片内容\n")
            for item in swiper_items:
                src = item.get('data-src', '')
                if src:
                    add_image(src)

        swiper_images = soup.select('.swiper_item_img img')
        if swiper_images:
            if not js_images_found and len(seen_urls) == 0:
                content_parts.append("\n## 图片内容\n")
            for img in swiper_images:
                src = img.get('src') or img.get('data-src') or ''
                alt = img.get('alt') or ''
                add_image(src, alt)

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

    # 5. 通用兜底方法
    if len(seen_urls) == 0:
        logger.info("使用通用兜底方法提取所有微信图片")
        content_parts.append("\n## 图片内容\n")

        all_images = soup.find_all('img')
        for img in all_images:
            src = img.get('src') or img.get('data-src') or img.get('data-original') or ''
            alt = img.get('alt') or ''
            if src:
                add_image(src, alt)

        elements_with_data_src = soup.find_all(attrs={'data-src': True})
        for ele in elements_with_data_src:
            src = ele.get('data-src', '')
            if src:
                add_image(src)

        import re as regex_module
        elements_with_style = soup.find_all(style=True)
        for ele in elements_with_style:
            style = ele.get('style', '')
            bg_matches = regex_module.findall(r'url\(["\']?(https?://mmbiz\.qpic\.cn[^"\')\s]+)["\']?\)', style)
            for bg_url in bg_matches:
                add_image(bg_url)

    # 6. 提取话题标签
    topic_links = soup.select('.wx_topic_link')
    if topic_links:
        topics = []
        for link in topic_links:
            topic_text = link.get_text(strip=True)
            if topic_text:
                topic_text = _decode_html_entities(topic_text)
                topic_text = re.sub(r'<[^>]+>', '', topic_text)
                if topic_text and not topic_text.startswith('<'):
                    topics.append(topic_text)
        if topics:
            content_parts.append(f"\n**话题标签**: {' '.join(topics)}\n")

    return ''.join(content_parts) if content_parts else None


def get_timestamp(update_time):
    """将 UNIX 时间戳转换为可读的日期时间字符串"""
    try:
        dt = datetime.fromtimestamp(int(update_time))
        return dt.strftime('%Y-%m-%d %H:%M:%S')
    except Exception as e:
        return f"时间戳转换失败: {str(e)}"


def format_time(timestamp):
    """格式化时间戳"""
    try:
        dt = datetime.fromtimestamp(int(timestamp))
        return dt.strftime('%Y-%m-%d %H:%M:%S')
    except:
        return ''


def filter_by_keywords(articles, keywords, field='title'):
    """根据关键词过滤文章列表"""
    if not keywords:
        return articles

    filtered = []
    for article in articles:
        if field not in article:
            continue

        content = article[field].lower()
        if any(keyword.lower() in content for keyword in keywords):
            filtered.append(article)

    return filtered


def save_to_csv(data, filename, fieldnames=None):
    """将数据保存到 CSV 文件"""
    if not data:
        return False

    if not fieldnames:
        if isinstance(data[0], dict):
            fieldnames = list(data[0].keys())
        else:
            logger.error(f"保存CSV失败: 未提供字段名且无法自动获取")
            return False

    try:
        os.makedirs(os.path.dirname(filename) or '.', exist_ok=True)

        with open(filename, 'w', encoding='utf-8-sig', newline='') as f:
            writer = csv.DictWriter(f, fieldnames=fieldnames)
            writer.writeheader()
            writer.writerows(data)

        logger.info(f"数据已保存到: {filename}")
        return True
    except Exception as e:
        logger.error(f"保存CSV失败: {str(e)}")
        return False


def mkdir(path):
    """创建目录（如果不存在）"""
    path = path.strip()

    if not path or os.path.exists(path):
        logger.info(f"{path} 目录已存在")
        return True

    os.makedirs(path)
    logger.info(f"{path} 创建成功")
    return True
