#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
日志工具模块
============

基于 loguru 实现的日志系统，提供灵活的日志配置和输出功能。
自动适配开发环境和打包环境，解决 PyInstaller 打包后的日志问题。
"""

import os
import sys
from loguru import logger


def get_app_dir():
    """获取应用程序所在目录"""
    if getattr(sys, 'frozen', False):
        return os.path.dirname(sys.executable)
    else:
        # 开发环境：向上到包根目录
        return os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def get_user_data_dir():
    """获取用户数据存储目录"""
    if sys.platform == 'win32':
        app_data = os.environ.get('APPDATA', os.path.expanduser('~'))
        return os.path.join(app_data, 'WeChatSpider')
    elif sys.platform == 'darwin':
        return os.path.join(os.path.expanduser('~'), 'Library', 'Application Support', 'WeChatSpider')
    else:
        return os.path.join(os.path.expanduser('~'), '.local', 'share', 'WeChatSpider')


def setup_logger(log_file=None, log_level="INFO"):
    """配置并初始化日志记录器"""
    logger.remove()

    if sys.stderr is not None:
        logger.add(
            sys.stderr,
            format="<green>{time:YYYY-MM-DD HH:mm:ss}</green> | <level>{level: <8}</level> | <cyan>{name}</cyan>:<cyan>{function}</cyan>:<cyan>{line}</cyan> - <level>{message}</level>",
            level=log_level
        )

    if getattr(sys, 'frozen', False):
        user_data_dir = get_user_data_dir()
        default_log_file = os.path.join(user_data_dir, 'logs', 'app.log')
        log_dir = os.path.dirname(default_log_file)

        if not os.path.exists(log_dir):
            os.makedirs(log_dir, exist_ok=True)

        logger.add(
            default_log_file,
            rotation="10 MB",
            retention="1 week",
            format="{time:YYYY-MM-DD HH:mm:ss} | {level: <8} | {name}:{function}:{line} - {message}",
            level=log_level,
            encoding="utf-8"
        )

    if log_file:
        log_dir = os.path.dirname(log_file)
        if log_dir and not os.path.exists(log_dir):
            os.makedirs(log_dir)

        logger.add(
            log_file,
            rotation="10 MB",
            retention="1 week",
            format="{time:YYYY-MM-DD HH:mm:ss} | {level: <8} | {name}:{function}:{line} - {message}",
            level=log_level,
            encoding="utf-8"
        )

    return logger


# 模块加载时自动初始化默认日志配置
logger = setup_logger()
