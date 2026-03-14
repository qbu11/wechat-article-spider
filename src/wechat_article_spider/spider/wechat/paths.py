#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
路径工具模块（无 GUI 依赖）
===========================

提供缓存文件、输出目录等路径的获取函数。
"""

import os
import sys


def get_app_data_dir() -> str:
    """获取应用数据目录（跨平台）"""
    if sys.platform == 'win32':
        app_data = os.environ.get('LOCALAPPDATA', '')
        if not app_data:
            app_data = os.path.join(os.environ.get('USERPROFILE', ''), 'AppData', 'Local')
    elif sys.platform == 'darwin':
        home = os.environ.get('HOME', os.path.expanduser('~'))
        app_data = os.path.join(home, 'Library', 'Application Support')
    else:
        home = os.environ.get('HOME', os.path.expanduser('~'))
        app_data = os.path.join(home, '.local', 'share')

    data_dir = os.path.join(app_data, 'WeChatSpider')
    try:
        os.makedirs(data_dir, exist_ok=True)
    except OSError:
        data_dir = os.path.abspath('.')
    return data_dir


def get_cache_file_path(filename: str) -> str:
    """获取缓存文件的完整路径"""
    return os.path.join(get_app_data_dir(), filename)


def get_wechat_cache_file() -> str:
    """获取微信缓存文件路径"""
    return get_cache_file_path('wechat_cache.json')


def get_account_history_file() -> str:
    """获取公众号历史记录文件路径"""
    return get_cache_file_path('account_history.json')


def get_default_output_dir() -> str:
    """获取默认输出目录"""
    if sys.platform == 'win32':
        user_home = os.environ.get('USERPROFILE', '')
        if not user_home:
            home_drive = os.environ.get('HOMEDRIVE', 'C:')
            home_path = os.environ.get('HOMEPATH', '\\Users\\Default')
            user_home = home_drive + home_path
    else:
        user_home = os.environ.get('HOME', os.path.expanduser('~'))

    output_dir = os.path.join(user_home, 'WeChatSpider')
    try:
        os.makedirs(output_dir, exist_ok=True)
    except OSError:
        output_dir = os.path.abspath('results')
        os.makedirs(output_dir, exist_ok=True)
    return output_dir


DEFAULT_OUTPUT_DIR = get_default_output_dir()
