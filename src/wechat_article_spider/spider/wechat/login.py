#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
微信公众平台登录模块 (DrissionPage 版本)
==========================================

实现微信公众平台的自动化登录流程，获取爬虫运行所需的认证信息。
使用 DrissionPage 替代 Selenium，支持：
    - 接管已打开的 Chrome 浏览器（通过 9222 端口）
    - 创建新的 Chrome 浏览器并暴露调试端口
    - 与 Chrome DevTools MCP 共享浏览器实例

工作流程:
    1. 优先接管已存在的 Chrome（9222 端口）
    2. 若不存在则创建新的 Chrome 并暴露调试端口
    3. 等待用户扫码登录
    4. 提取 token 和 cookie 并缓存

缓存策略:
    - 登录信息保存在用户数据目录，避免权限问题
    - 默认缓存有效期 4 天（微信 token 通常 4-7 天过期）
    - 每次使用前自动验证缓存是否仍然有效
    - 支持手动清除缓存强制重新登录

优势:
    - 无需下载 chromedriver（版本无关）
    - 可与 Chrome DevTools MCP 共享浏览器
    - 性能更好，启动更快
    - 代码更简洁

依赖:
    - DrissionPage: 浏览器自动化
    - requests: HTTP 请求（用于验证 token）
"""

import json
import os
import random
import time
import platform
import tempfile
import shutil
import subprocess
import re
from datetime import datetime, timedelta
from urllib.parse import parse_qs, urlparse

from DrissionPage import ChromiumPage, ChromiumOptions
import requests

from wechat_article_spider.spider.log.utils import logger
from wechat_article_spider.spider.wechat.paths import get_wechat_cache_file

# 缓存文件路径（存储在用户数据目录）
CACHE_FILE = get_wechat_cache_file()

# 缓存有效期：4 天（微信 token 一般 4-7 天过期）
CACHE_EXPIRE_HOURS = 24 * 4

# Chrome 调试端口（与 Chrome DevTools MCP 共享）
CHROME_DEBUG_PORT = 9222


def cookies_to_dict(raw_cookies):
    """Normalize DrissionPage cookie containers across API versions."""
    if isinstance(raw_cookies, dict):
        return raw_cookies
    normalized = {}
    for cookie in raw_cookies or []:
        if not isinstance(cookie, dict):
            continue
        name = cookie.get('name')
        if name:
            normalized[name] = cookie.get('value', '')
    return normalized


def authenticated_home_url(url):
    """Recognize a logged-in WeChat backend page without exposing its token."""
    parsed = urlparse(url)
    token = parse_qs(parsed.query).get('token', [])
    return (
        parsed.scheme == 'https'
        and parsed.hostname == 'mp.weixin.qq.com'
        and bool(token and token[0])
        and 'loginpage' not in parsed.path
    )


class WeChatSpiderLogin:
    """
    微信公众平台登录管理器 (DrissionPage 版本)

    负责处理登录认证的完整生命周期，包括：
    - 缓存的读取、验证和保存
    - 浏览器的接管或创建（支持与 MCP 共享）
    - 登录流程的执行和监控
    - 资源的清理和释放

    Attributes:
        token: 访问令牌，用于 API 请求认证
        cookies: 会话 cookie 字典
        cache_file: 缓存文件路径
        cache_expire_hours: 缓存过期时间（小时）
        page: DrissionPage ChromiumPage 实例
        temp_user_data_dir: 临时用户数据目录
        debug_port: Chrome 调试端口

    Example:
        >>> login = WeChatSpiderLogin()
        >>> if login.login():
        ...     token = login.get_token()
        ...     headers = login.get_headers()
        ...     # 使用 token 和 headers 进行爬取
    """

    def __init__(self, cache_file=CACHE_FILE, debug_port=CHROME_DEBUG_PORT):
        """
        初始化登录管理器

        Args:
            cache_file: 缓存文件路径，默认使用用户数据目录下的文件
            debug_port: Chrome 调试端口，默认 9222（与 MCP 共享）
        """
        self.token = None
        self.cookies = None
        self.cache_file = cache_file
        self.cache_expire_hours = CACHE_EXPIRE_HOURS
        self.page = None
        self.temp_user_data_dir = None
        self.debug_port = debug_port
        self._created_browser = False  # 标记是否由本实例创建浏览器

    def save_cache(self):
        """保存登录信息到缓存文件"""
        if self.token and self.cookies:
            cache_data = {
                'token': self.token,
                'cookies': self.cookies,
                'timestamp': datetime.now().timestamp()
            }
            try:
                with open(self.cache_file, 'w', encoding='utf-8') as f:
                    json.dump(cache_data, f, ensure_ascii=False, indent=2)
                logger.success(f"登录信息已保存到缓存文件 {self.cache_file}")
                return True
            except Exception as e:
                logger.error(f"保存缓存失败: {e}")
                return False
        return False

    def load_cache(self):
        """从缓存文件加载登录信息"""
        if not os.path.exists(self.cache_file):
            logger.info("缓存文件不存在，需要重新登录")
            return False

        try:
            with open(self.cache_file, 'r', encoding='utf-8') as f:
                cache_data = json.load(f)

            cache_time = datetime.fromtimestamp(cache_data['timestamp'])
            current_time = datetime.now()
            hours_diff = (current_time - cache_time).total_seconds() / 3600

            if hours_diff > self.cache_expire_hours:
                logger.info(f"缓存已过期（{hours_diff:.1f}小时前），需要重新登录")
                return False

            self.token = cache_data['token']
            self.cookies = cache_data['cookies']
            logger.info(f"从缓存加载登录信息（{hours_diff:.1f}小时前保存）")
            return True

        except Exception as e:
            logger.error(f"读取缓存失败: {e}，需要重新登录")
            return False

    def validate_cache(self):
        """验证缓存的登录信息是否仍然有效"""
        if not self.token or not self.cookies:
            return False

        try:
            headers = {
                "HOST": "mp.weixin.qq.com",
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/107.0.0.0 Safari/537.36"
            }

            test_url = 'https://mp.weixin.qq.com/cgi-bin/searchbiz'
            test_params = {
                'action': 'search_biz',
                'token': self.token,
                'lang': 'zh_CN',
                'f': 'json',
                'ajax': '1',
                'random': random.random(),
                'query': '量子位',
                'begin': '0',
                'count': '1',
            }

            response = requests.get(
                test_url,
                cookies=self.cookies,
                headers=headers,
                params=test_params,
                timeout=10
            )
            response.raise_for_status()

            result = response.json()

            if 'base_resp' in result:
                if result['base_resp']['ret'] == 0:
                    logger.success("缓存的登录信息验证有效")
                    return True
                elif result['base_resp']['ret'] in (-6, 200013):
                    logger.warning("缓存的token已失效")
                    return False
                elif result['base_resp']['ret'] == 200002:
                    # Some mini-program backend accounts no longer allow the
                    # legacy searchbiz probe. Validate the authenticated home
                    # page so a healthy cache does not trigger another scan.
                    home = requests.get(
                        'https://mp.weixin.qq.com/wxamp/home/guide',
                        cookies=self.cookies,
                        headers=headers,
                        params={'token': self.token, 'lang': 'zh_CN'},
                        timeout=10,
                    )
                    if home.status_code == 200 and authenticated_home_url(home.url):
                        logger.success("缓存登录态有效；旧搜索接口当前不可用")
                        return True
                    logger.warning("登录主页验证失败")
                    return False
                else:
                    logger.warning(f"验证失败: {result['base_resp'].get('err_msg', '未知错误')}")
                    return False
            else:
                logger.warning("验证响应格式异常")
                return False

        except Exception as e:
            logger.error(f"验证缓存时发生错误: {e}")
            return False

    def clear_cache(self):
        """清除本地缓存文件"""
        try:
            if os.path.exists(self.cache_file):
                os.remove(self.cache_file)
                logger.info("缓存已清除")
            return True
        except Exception as e:
            logger.error(f"清除缓存失败: {e}")
            return False

    def _setup_chrome_options(self):
        """
        配置 Chrome 浏览器启动选项

        设置各种 Chrome 参数以优化爬虫场景下的表现：
        - 使用临时用户数据目录，避免影响用户的 Chrome 配置
        - 暴露调试端口，让 Chrome DevTools MCP 可以连接
        - 禁用不必要的功能以提升性能
        - 隐藏自动化特征以降低被检测风险

        Returns:
            ChromiumOptions: 配置好的选项对象
        """
        co = ChromiumOptions()

        # 创建临时目录保存用户数据
        self.temp_user_data_dir = tempfile.mkdtemp()
        co.set_user_data_path(self.temp_user_data_dir)

        # 设置调试端口（关键：让 MCP 可以连接）
        co.set_local_port(self.debug_port)
        co.set_argument('--remote-allow-origins=*')

        # 性能优化
        co.no_imgs(True)  # 不加载图片（可选，提升速度）
        co.set_argument('--disable-extensions')
        co.set_argument('--disable-plugins')
        co.set_argument('--disable-software-rasterizer')
        co.set_argument('--disable-gpu')
        co.set_argument('--no-sandbox')
        co.set_argument('--disable-dev-shm-usage')

        # 页面缩放
        co.set_argument('--force-device-scale-factor=0.9')

        # 隐藏自动化特征
        co.set_argument('--disable-blink-features=AutomationControlled')

        # 自定义用户代理
        co.set_user_agent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/107.0.0.0 Safari/537.36')

        return co

    def _connect_to_browser(self):
        """
        连接到 Chrome 浏览器

        优先级：
        1. 尝试接管已存在的 Chrome（通过调试端口）
        2. 若不存在则创建新的 Chrome

        Returns:
            ChromiumPage: 浏览器页面对象，失败返回 None
        """
        # 方案1: 尝试接管已存在的 Chrome
        logger.info(f"尝试接管已存在的 Chrome (端口 {self.debug_port})...")
        try:
            page = ChromiumPage(addr_or_opts=f'127.0.0.1:{self.debug_port}')
            logger.success("成功接管已存在的 Chrome 浏览器")
            self._created_browser = False
            return page
        except Exception as e:
            logger.debug(f"无法接管现有浏览器: {e}")

        # 方案2: 创建新的 Chrome
        logger.info("未找到现有浏览器，创建新的 Chrome 实例...")
        try:
            co = self._setup_chrome_options()
            page = ChromiumPage(addr_or_opts=co)
            logger.success("成功创建新的 Chrome 浏览器")
            self._created_browser = True
            return page
        except Exception as e:
            logger.error(f"创建浏览器失败: {e}")
            return None

    def _cleanup_chrome_processes(self):
        """
        清理 Chrome 进程（仅当由本实例创建时）

        注意：如果有其他程序（如 MCP）正在使用浏览器，不应该强制关闭
        """
        if not self._created_browser:
            logger.debug("浏览器非本实例创建，跳过进程清理")
            return

        try:
            system = platform.system()
            if system == "Windows":
                subprocess.run(["taskkill", "/F", "/IM", "chrome.exe", "/T"],
                              stderr=subprocess.DEVNULL, stdout=subprocess.DEVNULL)
            elif system in ("Linux", "Darwin"):
                subprocess.run(["pkill", "-f", "chrome"],
                              stderr=subprocess.DEVNULL, stdout=subprocess.DEVNULL)
            logger.debug("残留浏览器进程已清理")
        except Exception as e:
            logger.warning(f"清理Chrome进程时出现警告: {e}")

    def _cleanup_temp_files(self):
        """清理临时用户数据目录（仅当由本实例创建时）"""
        if not self._created_browser:
            return

        if self.temp_user_data_dir and os.path.exists(self.temp_user_data_dir):
            try:
                shutil.rmtree(self.temp_user_data_dir, ignore_errors=True)
                logger.debug("临时用户数据目录已清理")
            except Exception as e:
                logger.warning(f"清理临时目录时出现警告: {e}")

    def login(self):
        """执行登录流程"""
        logger.info("\n" + "="*60)
        logger.info("开始登录微信公众号平台...")
        logger.info("="*60)

        if self.load_cache() and self.validate_cache():
            logger.success("使用有效的缓存登录信息")
            return True
        else:
            logger.info("缓存无效或不存在，需要重新扫码登录")
            self.clear_cache()

        # 不再强制清理进程，因为可能正在与其他程序共享
        # self._cleanup_chrome_processes()

        try:
            logger.info("正在连接/启动 Chrome 浏览器...")

            self.page = self._connect_to_browser()
            if not self.page:
                logger.error("浏览器连接/启动失败")
                return False

            logger.info("正在访问微信公众号平台...")
            self.page.get('https://mp.weixin.qq.com/')
            logger.success("页面加载完成")

            logger.info("请在浏览器窗口中扫码登录...")
            logger.info("等待登录完成（最长等待5分钟）...")

            # 等待 URL 包含 token
            start_time = time.time()
            timeout = 300  # 5 分钟

            while time.time() - start_time < timeout:
                current_url = self.page.url
                if 'token=' in current_url:
                    logger.success("检测到登录成功！正在获取登录信息...")
                    break
                time.sleep(1)
            else:
                logger.error("登录超时（5分钟内未检测到登录成功）")
                return False

            token_match = re.search(r'token=(\d+)', current_url)
            if token_match:
                self.token = token_match.group(1)
                logger.success("Token获取成功")
            else:
                logger.error("无法从URL中提取token")
                return False

            # 获取 cookies
            raw_cookies = self.page.cookies()
            self.cookies = cookies_to_dict(raw_cookies)
            logger.success(f"Cookies获取成功，共{len(self.cookies)}个")

            if self.save_cache():
                logger.success("登录信息已保存到缓存")

            logger.success("登录完成！")
            return True

        except Exception as e:
            logger.error(f"登录过程中出现错误: {e}")
            return False

        finally:
            # 关闭浏览器（仅当由本实例创建时）
            if self.page and self._created_browser:
                try:
                    self.page.quit()
                    logger.debug("浏览器已关闭")
                except:
                    pass

            self._cleanup_chrome_processes()
            self._cleanup_temp_files()

    def check_login_status(self):
        """获取当前登录状态的详细信息"""
        if self.load_cache() and self.validate_cache():
            try:
                with open(self.cache_file, 'r', encoding='utf-8') as f:
                    cache_data = json.load(f)
                cache_time = datetime.fromtimestamp(cache_data['timestamp'])
                expire_time = cache_time + timedelta(hours=self.cache_expire_hours)
                hours_since_login = (datetime.now() - cache_time).total_seconds() / 3600
                hours_until_expire = (expire_time - datetime.now()).total_seconds() / 3600

                return {
                    'isLoggedIn': True,
                    'loginTime': cache_time.strftime('%Y-%m-%d %H:%M:%S'),
                    'expireTime': expire_time.strftime('%Y-%m-%d %H:%M:%S'),
                    'hoursSinceLogin': round(hours_since_login, 1),
                    'hoursUntilExpire': round(hours_until_expire, 1),
                    'tokenPresent': bool(self.token),
                    'message': f'已登录 {round(hours_since_login, 1)} 小时'
                }
            except:
                pass

        return {
            'isLoggedIn': False,
            'message': '未登录或登录已过期'
        }

    def logout(self):
        """退出登录并清理所有相关资源"""
        logger.info("正在退出登录...")
        self.clear_cache()
        self.token = None
        self.cookies = None
        self._cleanup_chrome_processes()
        self._cleanup_temp_files()
        logger.success("退出登录完成")
        return True

    def get_token(self):
        """获取访问令牌"""
        if not self.token and not (self.load_cache() and self.validate_cache()):
            return None
        return self.token

    def get_cookies(self):
        """获取 cookie 字典"""
        if not self.cookies and not (self.load_cache() and self.validate_cache()):
            return None
        return self.cookies

    def get_cookie_string(self):
        """获取 HTTP 请求头格式的 cookie 字符串"""
        cookies = self.get_cookies()
        if not cookies:
            return None
        return '; '.join([f"{key}={value}" for key, value in cookies.items()])

    def get_headers(self):
        """获取完整的 HTTP 请求头"""
        cookie_string = self.get_cookie_string()
        if not cookie_string:
            return None
        return {
            "cookie": cookie_string,
            "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/104.0.0.0 Safari/537.36"
        }

    def is_logged_in(self):
        """快速检查是否处于登录状态"""
        return self.check_login_status()['isLoggedIn']


def quick_login():
    """快速登录便捷函数"""
    login_manager = WeChatSpiderLogin()
    if login_manager.login():
        return (
            login_manager.get_token(),
            login_manager.get_cookies(),
            login_manager.get_headers()
        )
    return (None, None, None)


def check_login():
    """检查登录状态便捷函数"""
    login_manager = WeChatSpiderLogin()
    return login_manager.check_login_status()
