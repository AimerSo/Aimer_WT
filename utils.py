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