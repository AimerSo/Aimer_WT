# -*- coding: utf-8 -*-
"""
工具模组：提供跨平台的应用路径获取等通用函数。

此模组不依赖任何其他应用模组（如 logger），以避免循环 import。
"""
import os
import sys
import platform
from pathlib import Path
from logging import getLogger

log = getLogger(__name__)


def get_docs_data_dir() -> Path:
    """
    获取应用数据存储目录（跨平台支援）。
    - Windows: ~/Documents/Aimer_WT
    - Linux: ~/.config/Aimer_WT
    - macOS: ~/Library/Application Support/Aimer_WT
    
    Returns:
        Path: 应用数据目录路径
    """
    system = platform.system()

    if system == "Windows":
        # Windows: 用户文档目录
        try:
            import ctypes.wintypes
            buf = ctypes.create_unicode_buffer(ctypes.wintypes.MAX_PATH)
            # CSIDL_PERSONAL = 5 (My Documents), SHGFP_TYPE_CURRENT = 0
            ctypes.windll.shell32.SHGetFolderPathW(None, 5, None, 0, buf)
            if buf.value:
                return Path(buf.value) / "Aimer_WT"
        except Exception as e:
            log.error(f"获取 Windows 文档目录时发生错误: {e}")
            pass
        # 回退到 Documents 目录
        return Path.home() / "Documents" / "Aimer_WT"
    elif system == "Darwin":
        # macOS: Application Support 目录
        return Path.home() / "Library" / "Application Support" / "Aimer_WT"
    else:
        # Linux/其他: 使用 XDG_CONFIG_HOME 或 ~/.config
        xdg_config = os.environ.get("XDG_CONFIG_HOME")
        if xdg_config:
            return Path(xdg_config) / "Aimer_WT"
        else:
            return Path.home() / ".config" / "Aimer_WT"


def get_app_data_dir() -> Path:
    """
    獲取程式目前的路徑
    """
    if getattr(sys, 'frozen', False):
        return Path(sys.executable).parent
    else:
        return Path(__file__).parent


# ==================== 多编码兼容工具 ====================

# 常用编码列表（按优先级排序）
COMMON_ENCODINGS = [
    "utf-8",
    "utf-8-sig",  # 带 BOM 的 UTF-8
    "gbk",        # 简体中文 Windows
    "gb2312",     # 简体中文旧版
    "gb18030",    # 简体中文完整
    "big5",       # 繁体中文台湾/香港
    "big5-hkscs", # 繁体中文香港扩展
    "shift_jis",  # 日文
    "euc-jp",     # 日文
    "euc-kr",     # 韩文
    "cp1252",     # 西欧
    "latin1",     # 西欧回退
    "cp437",      # 美国 OEM
]


def detect_encoding(data: bytes) -> str:
    """
    检测字节数据的编码格式。
    
    Args:
        data: 字节数据
        
    Returns:
        检测到的编码名称，失败则返回 "utf-8"
    """
    # 首先检查 BOM
    if data.startswith(b"\xef\xbb\xbf"):
        return "utf-8-sig"
    if data.startswith(b"\xff\xfe"):
        return "utf-16-le"
    if data.startswith(b"\xfe\xff"):
        return "utf-16-be"
    
    # 尝试常用编码
    for encoding in COMMON_ENCODINGS:
        try:
            data.decode(encoding)
            return encoding
        except (UnicodeDecodeError, LookupError):
            continue
    
    # 最终回退
    return "utf-8"


def read_text_file(file_path: Path | str, encoding: str | None = None) -> str:
    """
    读取文本文件，自动检测编码。
    
    支持多地区编码：UTF-8、GBK、Big5、Shift_JIS 等。
    
    Args:
        file_path: 文件路径
        encoding: 指定编码（None 则自动检测）
        
    Returns:
        文件内容字符串
        
    Raises:
        FileNotFoundError: 文件不存在
        UnicodeDecodeError: 所有编码都无法解码
        
    使用示例:
        content = read_text_file("config.txt")
        content = read_text_file("config.txt", encoding="gbk")
    """
    file_path = Path(file_path)
    
    if not file_path.exists():
        raise FileNotFoundError(f"文件不存在: {file_path}")
    
    raw_data = file_path.read_bytes()
    
    if not raw_data:
        return ""
    
    # 如果指定了编码，直接使用
    if encoding:
        return raw_data.decode(encoding, errors="replace")
    
    # 自动检测编码
    detected = detect_encoding(raw_data)
    return raw_data.decode(detected, errors="replace")


def write_text_file(
    file_path: Path | str, 
    content: str, 
    encoding: str = "utf-8",
    with_bom: bool = False
) -> None:
    """
    写入文本文件，默认使用 UTF-8 编码。
    
    Args:
        file_path: 文件路径
        content: 要写入的内容
        encoding: 编码格式（默认 UTF-8）
        with_bom: 是否添加 UTF-8 BOM（某些 Windows 程序需要）
        
    使用示例:
        write_text_file("config.txt", "内容")
        write_text_file("config.txt", "内容", encoding="gbk")
        write_text_file("config.txt", "内容", with_bom=True)  # Excel 兼容
    """
    file_path = Path(file_path)
    file_path.parent.mkdir(parents=True, exist_ok=True)
    
    if with_bom and encoding.lower() == "utf-8":
        encoding = "utf-8-sig"
    
    file_path.write_text(content, encoding=encoding, errors="replace")


def safe_filename(filename: str, replacement: str = "_") -> str:
    """
    将文件名中的非法字符替换为安全字符。
    支持多语言文件名（中文、日文、韩文等）。
    
    Args:
        filename: 原始文件名
        replacement: 替换字符
        
    Returns:
        安全的文件名
    """
    # Windows 非法字符
    illegal_chars = '<>:"/\\|?*'
    
    for char in illegal_chars:
        filename = filename.replace(char, replacement)
    
    # 移除控制字符
    filename = "".join(char for char in filename if ord(char) >= 32)
    
    # 处理保留名称（Windows）
    reserved = {"CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4",
                "COM5", "COM6", "COM7", "COM8", "COM9", "LPT1", "LPT2",
                "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9"}
    
    name_upper = filename.upper()
    if name_upper in reserved or any(name_upper.startswith(r + ".") for r in reserved):
        filename = f"{replacement}{filename}"
    
    # 处理空格和点号结尾
    filename = filename.rstrip(". ")
    
    # 空文件名处理
    if not filename:
        filename = "unnamed"
    
    return filename
