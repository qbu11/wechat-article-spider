#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
路径工具模块（无 GUI 依赖）
===========================

提供缓存文件、输出目录等路径的获取函数。
"""

import os
import sys
import tempfile
from pathlib import Path
from typing import Any

import json


PRIVATE_DIR_MODE = 0o700
PRIVATE_FILE_MODE = 0o600


def _chmod_best_effort(path: str, mode: int) -> None:
    """Apply least-privilege permissions where the platform supports chmod."""
    try:
        os.chmod(path, mode)
    except OSError:
        # Windows ACLs are not faithfully represented by POSIX modes. The
        # installer is responsible for applying a user-only ACL there.
        pass


def ensure_private_directory(path: str, *, harden_existing: bool = True) -> str:
    """Create a private directory without unexpectedly chmod-ing custom parents."""
    existed = os.path.isdir(path)
    os.makedirs(path, mode=PRIVATE_DIR_MODE, exist_ok=True)
    if harden_existing or not existed:
        _chmod_best_effort(path, PRIVATE_DIR_MODE)
    return path


def secure_json_write(path: str, data: Any) -> None:
    """Atomically write sensitive JSON with owner-only permissions.

    The temporary file is created in the destination directory so ``replace``
    remains atomic. No credential bytes are ever written to a broadly readable
    default-mode file.
    """
    destination = Path(path)
    # A caller may intentionally place a custom cache inside a project folder;
    # do not change permissions of an existing parent we do not own.
    ensure_private_directory(str(destination.parent), harden_existing=False)
    fd, temp_path = tempfile.mkstemp(
        prefix=f".{destination.name}.", suffix=".tmp", dir=str(destination.parent)
    )
    try:
        _chmod_best_effort(temp_path, PRIVATE_FILE_MODE)
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            fd = -1
            json.dump(data, handle, ensure_ascii=False, indent=2)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp_path, destination)
        _chmod_best_effort(str(destination), PRIVATE_FILE_MODE)
    finally:
        if fd >= 0:
            os.close(fd)
        try:
            os.remove(temp_path)
        except FileNotFoundError:
            pass


def harden_private_file(path: str) -> None:
    """Tighten permissions of a legacy credential file after discovery."""
    if os.path.isfile(path):
        _chmod_best_effort(path, PRIVATE_FILE_MODE)


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
        ensure_private_directory(data_dir)
    except OSError as exc:
        # Never fall back to the current working directory for credentials: it
        # may be a shared checkout, CI workspace, or web-served directory.
        raise RuntimeError(f"无法创建私有应用数据目录: {data_dir}") from exc
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
