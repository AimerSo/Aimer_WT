# -*- coding: utf-8 -*-
"""
开机自启动管理模组：负责 Windows 开机自启动设置。

功能特性:
- 设置/取消开机自启动
- 支持静默启动（只显示托盘）
- 注册表操作

错误处理策略:
- 注册表操作使用 try-except 捕获异常
- 所有操作记录完整的错误上下文
"""
import os
import sys
import winreg
from pathlib import Path
from typing import Optional

from utils.logger import get_logger

log = get_logger(__name__)

# 注册表路径
REGISTRY_KEY = r"Software\Microsoft\Windows\CurrentVersion\Run"
REGISTRY_APP_NAME = "AimerWT"


class AutostartManager:
    """
    开机自启动管理器：管理 Windows 开机自启动设置。
    
    属性:
        _app_name: 注册表中显示的应用名称
        _registry_key: 注册表键路径
    """

    def __init__(self, app_name: str = REGISTRY_APP_NAME):
        """
        初始化 AutostartManager。
        
        Args:
            app_name: 注册表中显示的应用名称
        """
        self._app_name = app_name
        self._registry_key = REGISTRY_KEY

    def _get_executable_path(self, silent: bool = False) -> str:
        """
        获取可执行文件路径。
        
        Args:
            silent: 是否静默启动（只显示托盘）
            
        Returns:
            可执行文件完整路径，包含参数
        """
        if getattr(sys, 'frozen', False):
            # 打包后的 exe
            exe_path = sys.executable
        else:
            # 开发环境，使用 main.py
            exe_path = f'"{sys.executable}" "{Path(__file__).parent.parent / "main.py"}"'
            if silent:
                exe_path += ' --silent'
            return exe_path

        # 打包环境，添加参数
        if silent:
            return f'"{exe_path}" --silent'
        return f'"{exe_path}"'

    def is_enabled(self) -> bool:
        """
        检查开机自启动是否已启用。
        
        Returns:
            是否已启用
        """
        try:
            with winreg.OpenKey(winreg.HKEY_CURRENT_USER, self._registry_key, 0, winreg.KEY_READ) as key:
                try:
                    value, _ = winreg.QueryValueEx(key, self._app_name)
                    return value is not None and value != ""
                except FileNotFoundError:
                    return False
        except Exception as e:
            log.error(f"检查开机自启动状态失败: {e}")
            return False

    def enable(self, silent: bool = True) -> bool:
        """
        启用开机自启动。
        
        Args:
            silent: 是否静默启动（只显示托盘，不显示主窗口）
            
        Returns:
            是否设置成功
        """
        try:
            exe_path = self._get_executable_path(silent)
            
            with winreg.OpenKey(winreg.HKEY_CURRENT_USER, self._registry_key, 0, winreg.KEY_WRITE) as key:
                winreg.SetValueEx(key, self._app_name, 0, winreg.REG_SZ, exe_path)
            
            mode_str = "静默模式" if silent else "正常模式"
            log.info(f"已启用开机自启动 ({mode_str})")
            return True
            
        except PermissionError as e:
            log.error(f"启用开机自启动失败（权限不足）: {e}")
            return False
        except Exception as e:
            log.error(f"启用开机自启动失败: {e}")
            return False

    def disable(self) -> bool:
        """
        禁用开机自启动。
        
        Returns:
            是否禁用成功
        """
        try:
            with winreg.OpenKey(winreg.HKEY_CURRENT_USER, self._registry_key, 0, winreg.KEY_WRITE) as key:
                try:
                    winreg.DeleteValue(key, self._app_name)
                    log.info("已禁用开机自启动")
                    return True
                except FileNotFoundError:
                    # 本来就不存在
                    return True
                    
        except PermissionError as e:
            log.error(f"禁用开机自启动失败（权限不足）: {e}")
            return False
        except Exception as e:
            log.error(f"禁用开机自启动失败: {e}")
            return False

    def toggle(self, enabled: bool, silent: bool = True) -> bool:
        """
        切换开机自启动状态。
        
        Args:
            enabled: 是否启用
            silent: 是否静默启动
            
        Returns:
            操作是否成功
        """
        if enabled:
            return self.enable(silent)
        else:
            return self.disable()

    def get_current_value(self) -> Optional[str]:
        """
        获取当前注册表值。
        
        Returns:
            注册表值，如果不存在返回 None
        """
        try:
            with winreg.OpenKey(winreg.HKEY_CURRENT_USER, self._registry_key, 0, winreg.KEY_READ) as key:
                try:
                    value, _ = winreg.QueryValueEx(key, self._app_name)
                    return value
                except FileNotFoundError:
                    return None
        except Exception as e:
            log.error(f"获取开机自启动值失败: {e}")
            return None

    def is_silent_mode(self) -> bool:
        """
        检查当前是否是静默启动模式。
        
        Returns:
            是否是静默模式
        """
        value = self.get_current_value()
        if value is None:
            return False
        return '--silent' in value or '--tray-only' in value


# 全局自启动管理器实例
autostart_manager = AutostartManager()
