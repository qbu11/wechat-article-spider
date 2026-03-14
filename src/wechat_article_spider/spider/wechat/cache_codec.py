#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
登录凭证编解码模块
==================

实现登录信息（token + cookies）的编码和解码功能，
用于在用户之间分享登录凭证，避免重复扫码登录。

应用场景:
    - 团队成员共享登录状态
    - 在不同设备间迁移登录信息
    - 备份和恢复登录凭证

编码流程:
    JSON 序列化 -> zlib 压缩 -> CRC32 校验 -> Base64 编码 -> 添加版本前缀

解码流程:
    验证前缀 -> Base64 解码 -> CRC32 校验 -> zlib 解压 -> JSON 反序列化

安全说明:
    - 编码后的字符串包含完整的登录凭证，请妥善保管
    - 凭证有时效性，过期后需要重新获取
    - 建议仅在可信环境中分享

技术规格:
    - 压缩: zlib DEFLATE (level=9)
    - 编码: URL-safe Base64 (无填充)
    - 校验: CRC32 (4 字节，大端序)
    - 版本: WC01 (WeChat Cache v01)
"""

import json
import zlib
import base64
import struct
import os
from typing import Dict, Any, Tuple, Optional
from datetime import datetime

# 导入日志模块
from wechat_article_spider.spider.log.utils import logger

# 导入路径工具函数
from wechat_article_spider.spider.wechat.paths import get_wechat_cache_file

# ============================================================================
# 常量定义
# ============================================================================

# 编码版本前缀，用于标识编码格式版本
# 格式: WC + 版本号 (2位)
# WC = WeChat Cache
CODEC_VERSION_PREFIX = "WC01"

# 默认缓存文件路径（使用用户数据目录，避免权限问题）
DEFAULT_CACHE_FILE = get_wechat_cache_file()

# 必需的 JSON 字段
REQUIRED_FIELDS = ['token', 'cookies', 'timestamp']

# 必需的 Cookie 字段（核心字段，缺少会导致功能异常）
REQUIRED_COOKIE_FIELDS = ['slave_sid', 'slave_user', 'data_ticket']


# ============================================================================
# 错误类定义
# ============================================================================

class CacheCodecError(Exception):
    """缓存编解码基础异常类"""
    pass


class EncodeError(CacheCodecError):
    """编码错误"""
    pass


class DecodeError(CacheCodecError):
    """解码错误"""
    pass


class ValidationError(CacheCodecError):
    """数据验证错误"""
    pass


class ChecksumError(DecodeError):
    """校验码错误"""
    pass


class VersionError(DecodeError):
    """版本不兼容错误"""
    pass


# ============================================================================
# 核心编解码函数
# ============================================================================

def encode_cache_data(data: Dict[str, Any]) -> str:
    """
    将缓存数据编码为可分享的字符串
    
    编码算法流程:
        1. JSON 序列化 -> UTF-8 字节流
        2. zlib 压缩 (level=9, 最高压缩率)
        3. 计算 CRC32 校验码
        4. 拼接: 压缩数据 + 校验码(4字节, 大端序)
        5. Base64 URL 安全编码 (无填充)
        6. 添加版本前缀
    
    Args:
        data: 缓存数据字典，必须包含 token, cookies, timestamp 字段
        
    Returns:
        str: 编码后的字符串，格式为 "WC01" + Base64编码数据
        
    Raises:
        EncodeError: 编码过程中发生错误
        ValidationError: 数据验证失败
        
    Example:
        >>> data = {"token": "123", "cookies": {...}, "timestamp": 1234567890.0}
        >>> encoded = encode_cache_data(data)
        >>> print(encoded[:4])  # 输出: WC01
    """
    try:
        # 步骤1: 验证输入数据结构
        _validate_cache_data(data)
        
        # 步骤2: JSON 序列化
        # 使用 separators 去除多余空格，减小体积
        # ensure_ascii=False 保留中文字符的原始编码
        json_str = json.dumps(data, ensure_ascii=False, separators=(',', ':'))
        json_bytes = json_str.encode('utf-8')
        
        logger.debug(f"JSON 序列化完成，原始大小: {len(json_bytes)} 字节")
        
        # 步骤3: zlib 压缩
        # level=9 表示最高压缩级别，牺牲速度换取更小体积
        compressed = zlib.compress(json_bytes, level=9)
        
        logger.debug(f"压缩完成，压缩后大小: {len(compressed)} 字节, "
                    f"压缩率: {len(compressed)/len(json_bytes)*100:.1f}%")
        
        # 步骤4: 计算 CRC32 校验码
        # 使用 & 0xffffffff 确保结果为无符号32位整数
        checksum = zlib.crc32(compressed) & 0xffffffff
        
        # 步骤5: 将校验码打包为4字节大端序
        # '>I' = 大端序无符号32位整数
        checksum_bytes = struct.pack('>I', checksum)
        
        # 步骤6: 拼接压缩数据和校验码
        payload = compressed + checksum_bytes
        
        # 步骤7: Base64 URL 安全编码
        # 使用 urlsafe_b64encode 避免 +/ 字符，便于 URL 传输
        # 移除末尾的 = 填充字符，进一步减小体积
        b64_encoded = base64.urlsafe_b64encode(payload).decode('ascii')
        b64_encoded = b64_encoded.rstrip('=')
        
        # 步骤8: 添加版本前缀
        result = CODEC_VERSION_PREFIX + b64_encoded
        
        logger.info(f"编码成功，最终字符串长度: {len(result)} 字符")
        
        return result
        
    except ValidationError:
        raise
    except Exception as e:
        raise EncodeError(f"编码失败: {str(e)}") from e


def decode_cache_data(encoded_str: str) -> Dict[str, Any]:
    """
    将编码字符串解码为缓存数据
    
    解码算法流程:
        1. 验证并移除版本前缀
        2. 补齐 Base64 填充字符
        3. Base64 URL 安全解码
        4. 分离压缩数据和校验码
        5. 验证 CRC32 校验码
        6. zlib 解压缩
        7. JSON 反序列化
        8. 验证数据结构完整性
    
    Args:
        encoded_str: 编码后的字符串
        
    Returns:
        Dict[str, Any]: 解码后的缓存数据字典
        
    Raises:
        DecodeError: 解码过程中发生错误
        VersionError: 版本不兼容
        ChecksumError: 校验码验证失败
        ValidationError: 数据结构验证失败
        
    Example:
        >>> encoded = "WC01eJy..."
        >>> data = decode_cache_data(encoded)
        >>> print(data['token'])
    """
    try:
        # 步骤1: 清理输入字符串
        encoded_str = encoded_str.strip()
        
        if not encoded_str:
            raise DecodeError("输入字符串为空")
        
        # 步骤2: 验证版本前缀
        if not encoded_str.startswith(CODEC_VERSION_PREFIX):
            # 检查是否是其他版本
            if encoded_str.startswith("WC"):
                version = encoded_str[:4]
                raise VersionError(f"不支持的编码版本: {version}，当前支持: {CODEC_VERSION_PREFIX}")
            raise DecodeError("无效的编码格式：缺少版本前缀")
        
        # 步骤3: 移除版本前缀
        b64_data = encoded_str[len(CODEC_VERSION_PREFIX):]
        
        if not b64_data:
            raise DecodeError("编码数据为空")
        
        # 步骤4: 补齐 Base64 填充字符
        # Base64 编码长度必须是4的倍数
        padding_needed = (4 - len(b64_data) % 4) % 4
        b64_data += '=' * padding_needed
        
        # 步骤5: Base64 解码
        try:
            payload = base64.urlsafe_b64decode(b64_data)
        except Exception as e:
            raise DecodeError(f"Base64 解码失败: {str(e)}")
        
        # 步骤6: 验证数据长度（至少需要4字节校验码）
        if len(payload) < 5:
            raise DecodeError("数据长度不足，可能已损坏")
        
        # 步骤7: 分离压缩数据和校验码
        compressed = payload[:-4]
        checksum_bytes = payload[-4:]
        
        # 步骤8: 解析校验码
        stored_checksum = struct.unpack('>I', checksum_bytes)[0]
        
        # 步骤9: 验证校验码
        calculated_checksum = zlib.crc32(compressed) & 0xffffffff
        
        if stored_checksum != calculated_checksum:
            raise ChecksumError(
                f"校验码验证失败：数据可能已损坏或被篡改\n"
                f"期望: {stored_checksum:08X}, 实际: {calculated_checksum:08X}"
            )
        
        logger.debug("校验码验证通过")
        
        # 步骤10: zlib 解压缩
        try:
            json_bytes = zlib.decompress(compressed)
        except zlib.error as e:
            raise DecodeError(f"解压缩失败: {str(e)}")
        
        # 步骤11: JSON 反序列化
        try:
            json_str = json_bytes.decode('utf-8')
            data = json.loads(json_str)
        except (UnicodeDecodeError, json.JSONDecodeError) as e:
            raise DecodeError(f"JSON 解析失败: {str(e)}")
        
        # 步骤12: 验证数据结构
        _validate_cache_data(data)
        
        logger.info("解码成功，数据结构验证通过")
        
        return data
        
    except (DecodeError, ValidationError, VersionError, ChecksumError):
        raise
    except Exception as e:
        raise DecodeError(f"解码失败: {str(e)}") from e


# ============================================================================
# 数据验证函数
# ============================================================================

def _validate_cache_data(data: Dict[str, Any]) -> None:
    """
    验证缓存数据结构的完整性
    
    检查项目:
        1. 数据类型必须是字典
        2. 必须包含所有必需字段 (token, cookies, timestamp)
        3. token 必须是非空字符串
        4. cookies 必须是非空字典
        5. timestamp 必须是数字类型
        6. cookies 中必须包含核心字段
    
    Args:
        data: 待验证的数据字典
        
    Raises:
        ValidationError: 验证失败时抛出，包含详细错误信息
    """
    # 检查数据类型
    if not isinstance(data, dict):
        raise ValidationError(f"数据类型错误：期望字典，实际为 {type(data).__name__}")
    
    # 检查必需字段
    missing_fields = [field for field in REQUIRED_FIELDS if field not in data]
    if missing_fields:
        raise ValidationError(f"缺少必需字段: {', '.join(missing_fields)}")
    
    # 验证 token
    token = data.get('token')
    if not isinstance(token, str) or not token.strip():
        raise ValidationError("token 必须是非空字符串")
    
    # 验证 cookies
    cookies = data.get('cookies')
    if not isinstance(cookies, dict):
        raise ValidationError(f"cookies 类型错误：期望字典，实际为 {type(cookies).__name__}")
    
    if not cookies:
        raise ValidationError("cookies 不能为空")
    
    # 检查核心 cookie 字段
    missing_cookies = [field for field in REQUIRED_COOKIE_FIELDS if field not in cookies]
    if missing_cookies:
        logger.warning(f"缺少部分核心 Cookie 字段: {', '.join(missing_cookies)}，可能影响功能")
    
    # 验证 timestamp
    timestamp = data.get('timestamp')
    if not isinstance(timestamp, (int, float)):
        raise ValidationError(f"timestamp 类型错误：期望数字，实际为 {type(timestamp).__name__}")


def validate_encoded_string(encoded_str: str) -> Tuple[bool, str]:
    """
    验证编码字符串的有效性（不执行完整解码）
    
    快速检查:
        1. 字符串非空
        2. 版本前缀正确
        3. Base64 格式有效
        4. 数据长度合理
    
    Args:
        encoded_str: 待验证的编码字符串
        
    Returns:
        Tuple[bool, str]: (是否有效, 错误信息或成功提示)
        
    Example:
        >>> is_valid, message = validate_encoded_string("WC01...")
        >>> if is_valid:
        ...     print("格式有效")
    """
    try:
        encoded_str = encoded_str.strip()
        
        if not encoded_str:
            return False, "字符串为空"
        
        if not encoded_str.startswith(CODEC_VERSION_PREFIX):
            if encoded_str.startswith("WC"):
                return False, f"版本不兼容: {encoded_str[:4]}"
            return False, "格式无效：缺少版本标识"
        
        b64_data = encoded_str[len(CODEC_VERSION_PREFIX):]
        
        if len(b64_data) < 10:
            return False, "数据长度不足"
        
        # 尝试 Base64 解码
        padding_needed = (4 - len(b64_data) % 4) % 4
        b64_data += '=' * padding_needed
        
        try:
            payload = base64.urlsafe_b64decode(b64_data)
            if len(payload) < 5:
                return False, "数据内容不完整"
        except Exception:
            return False, "Base64 格式无效"
        
        return True, "格式验证通过"
        
    except Exception as e:
        return False, f"验证失败: {str(e)}"


# ============================================================================
# 文件操作函数
# ============================================================================

def encode_cache_file(cache_file: str = DEFAULT_CACHE_FILE) -> str:
    """
    读取缓存文件并编码为分享字符串
    
    Args:
        cache_file: 缓存文件路径，默认为 'wechat_cache.json'
        
    Returns:
        str: 编码后的字符串
        
    Raises:
        FileNotFoundError: 缓存文件不存在
        EncodeError: 编码失败
        ValidationError: 数据验证失败
    """
    if not os.path.exists(cache_file):
        raise FileNotFoundError(f"缓存文件不存在: {cache_file}")
    
    try:
        with open(cache_file, 'r', encoding='utf-8') as f:
            data = json.load(f)
        
        logger.info(f"已读取缓存文件: {cache_file}")
        return encode_cache_data(data)
        
    except json.JSONDecodeError as e:
        raise EncodeError(f"缓存文件 JSON 格式错误: {str(e)}")
    except Exception as e:
        raise EncodeError(f"读取缓存文件失败: {str(e)}")


def decode_to_cache_file(encoded_str: str, cache_file: str = DEFAULT_CACHE_FILE, 
                         backup: bool = True) -> Dict[str, Any]:
    """
    解码字符串并写入缓存文件
    
    Args:
        encoded_str: 编码后的字符串
        cache_file: 目标缓存文件路径，默认为 'wechat_cache.json'
        backup: 是否备份已存在的缓存文件，默认为 True
        
    Returns:
        Dict[str, Any]: 解码后的数据字典
        
    Raises:
        DecodeError: 解码失败
        ValidationError: 数据验证失败
        IOError: 文件写入失败
    """
    # 解码数据
    data = decode_cache_data(encoded_str)
    
    # 备份已存在的文件
    if backup and os.path.exists(cache_file):
        backup_file = f"{cache_file}.backup"
        try:
            import shutil
            shutil.copy2(cache_file, backup_file)
            logger.info(f"已备份原缓存文件到: {backup_file}")
        except Exception as e:
            logger.warning(f"备份缓存文件失败: {e}")
    
    # 写入新数据
    try:
        with open(cache_file, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        
        logger.success(f"缓存数据已写入: {cache_file}")
        return data
        
    except Exception as e:
        raise IOError(f"写入缓存文件失败: {str(e)}")


# ============================================================================
# 辅助函数
# ============================================================================

def get_cache_info(data: Dict[str, Any]) -> Dict[str, Any]:
    """
    获取缓存数据的摘要信息
    
    Args:
        data: 缓存数据字典
        
    Returns:
        Dict[str, Any]: 包含摘要信息的字典
    """
    try:
        timestamp = data.get('timestamp', 0)
        cache_time = datetime.fromtimestamp(timestamp)
        
        return {
            'token_preview': data.get('token', '')[:6] + '...' if data.get('token') else None,
            'cookie_count': len(data.get('cookies', {})),
            'cache_time': cache_time.strftime('%Y-%m-%d %H:%M:%S'),
            'timestamp': timestamp
        }
    except Exception:
        return {
            'token_preview': None,
            'cookie_count': 0,
            'cache_time': '未知',
            'timestamp': 0
        }


def estimate_encoded_size(data: Dict[str, Any]) -> int:
    """
    估算编码后的字符串长度
    
    Args:
        data: 缓存数据字典
        
    Returns:
        int: 估算的字符串长度
    """
    try:
        json_str = json.dumps(data, ensure_ascii=False, separators=(',', ':'))
        json_bytes = json_str.encode('utf-8')
        # 压缩后大约为原始大小的 30-50%，Base64 编码会增加约 33%
        estimated = int(len(json_bytes) * 0.4 * 1.33) + len(CODEC_VERSION_PREFIX)
        return estimated
    except Exception:
        return 0


# ============================================================================
# 命令行接口
# ============================================================================

def main():
    """命令行入口函数"""
    import argparse
    
    parser = argparse.ArgumentParser(
        description='微信缓存编解码工具',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog='''
示例:
  编码缓存文件:
    python cache_codec.py encode
    python cache_codec.py encode -f custom_cache.json
    
  解码字符串:
    python cache_codec.py decode "WC01..."
    python cache_codec.py decode "WC01..." -o output.json
    
  验证字符串:
    python cache_codec.py validate "WC01..."
        '''
    )
    
    subparsers = parser.add_subparsers(dest='command', help='可用命令')
    
    # 编码命令
    encode_parser = subparsers.add_parser('encode', help='编码缓存文件')
    encode_parser.add_argument('-f', '--file', default=DEFAULT_CACHE_FILE,
                               help=f'缓存文件路径 (默认: {DEFAULT_CACHE_FILE})')
    
    # 解码命令
    decode_parser = subparsers.add_parser('decode', help='解码字符串')
    decode_parser.add_argument('string', help='编码后的字符串')
    decode_parser.add_argument('-o', '--output', default=DEFAULT_CACHE_FILE,
                               help=f'输出文件路径 (默认: {DEFAULT_CACHE_FILE})')
    decode_parser.add_argument('--no-backup', action='store_true',
                               help='不备份已存在的缓存文件')
    
    # 验证命令
    validate_parser = subparsers.add_parser('validate', help='验证编码字符串')
    validate_parser.add_argument('string', help='待验证的字符串')
    
    args = parser.parse_args()
    
    if args.command == 'encode':
        try:
            result = encode_cache_file(args.file)
            print("\n编码成功！")
            print(f"字符串长度: {len(result)} 字符")
            print("\n" + "=" * 60)
            print(result)
            print("=" * 60)
        except Exception as e:
            print(f"\n编码失败: {e}")
            return 1
            
    elif args.command == 'decode':
        try:
            data = decode_to_cache_file(args.string, args.output, 
                                        backup=not args.no_backup)
            info = get_cache_info(data)
            print("\n解码成功！")
            print(f"Token: {info['token_preview']}")
            print(f"Cookie 数量: {info['cookie_count']}")
            print(f"缓存时间: {info['cache_time']}")
            print(f"已保存到: {args.output}")
        except Exception as e:
            print(f"\n解码失败: {e}")
            return 1
            
    elif args.command == 'validate':
        is_valid, message = validate_encoded_string(args.string)
        if is_valid:
            print(f"\n✓ {message}")
            # 尝试完整解码以获取更多信息
            try:
                data = decode_cache_data(args.string)
                info = get_cache_info(data)
                print(f"  Token: {info['token_preview']}")
                print(f"  Cookie 数量: {info['cookie_count']}")
                print(f"  缓存时间: {info['cache_time']}")
            except Exception:
                pass
        else:
            print(f"\n✗ {message}")
            return 1
    else:
        parser.print_help()
        return 1
    
    return 0


if __name__ == '__main__':
    exit(main())