# -*- coding: utf-8 -*-
"""
工具模组：提供跨平台的应用路径获取等通用函数。

此模组不依赖任何其他应用模组（如 logger），以避免循环 import。
"""
import os
import platform
from pathlib import Path


def get_app_data_dir() -> Path:
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
