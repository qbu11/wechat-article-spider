"""
微信公众号爬虫核心模块
"""

from .wechat import WeChatSpiderLogin, WeChatScraper, BatchWeChatScraper
from .log import setup_logger, logger

__all__ = [
    'WeChatSpiderLogin',
    'WeChatScraper',
    'BatchWeChatScraper',
    'setup_logger',
    'logger'
]

__version__ = '3.8.0'
