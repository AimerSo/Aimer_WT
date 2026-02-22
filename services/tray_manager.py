from __future__ import annotations
# -*- coding: utf-8 -*-
"""
系统托盘管理模组：负责系统托盘图标和菜单管理。

功能特性:
- 系统托盘图标显示
- 托盘右键菜单
- 窗口最小化到托盘
- 托盘点击恢复窗口

错误处理策略:
- 托盘相关操作使用 try-except 捕获异常
- 所有操作记录完整的错误上下文
"""
import os
import sys
import threading
from pathlib import Path
from typing import Callable, Optional

try:
    import pystray
    from PIL import Image, ImageDraw
    PYSTRAY_AVAILABLE = True
except ImportError:
    PYSTRAY_AVAILABLE = False
    pystray = None
    Image = None
    ImageDraw = None

from utils.logger import get_logger

log = get_logger(__name__)


class TrayManager:
    """
    系统托盘管理器：管理托盘图标和菜单。
    
    属性:
        _icon: pystray 图标实例
        _window: pywebview 窗口实例
        _on_show: 显示窗口回调
        _on_exit: 退出程序回调
        _menu_items: 自定义菜单项列表
    """

    def __init__(self):
        """初始化 TrayManager。"""
        self._icon: Optional[pystray.Icon] = None
        self._window = None
        self._on_show: Optional[Callable] = None
        self._on_exit: Optional[Callable] = None
        self._menu_items: list = []
        self._lock = threading.Lock()

    def is_available(self) -> bool:
        """检查托盘功能是否可用。"""
        return PYSTRAY_AVAILABLE

    def setup(self, window, on_show: Callable, on_exit: Callable, 
              menu_items: Optional[list] = None) -> bool:
        """
        设置托盘管理器。
        
        Args:
            window: pywebview 窗口实例
            on_show: 显示窗口回调函数
            on_exit: 退出程序回调函数
            menu_items: 可选的自定义菜单项列表
            
        Returns:
            是否设置成功
        """
        if not self.is_available():
            log.warning("pystray 不可用，托盘功能无法启用")
            return False

        with self._lock:
            self._window = window
            self._on_show = on_show
            self._on_exit = on_exit
            self._menu_items = menu_items or []

        return True

    def create_icon_image(self, width: int = 64, height: int = 64):
        """
        创建托盘图标图片。
        
        Args:
            width: 图标宽度
            height: 图标高度
            
        Returns:
            PIL Image 对象，如果 PIL 不可用则返回 None
        """
        if Image is None or ImageDraw is None:
            log.warning("PIL 不可用，无法创建托盘图标")
            return None
        
        # 创建一个简单的橙色圆形图标
        image = Image.new('RGBA', (width, height), (0, 0, 0, 0))
        dc = ImageDraw.Draw(image)
        
        # 绘制橙色圆形背景
        margin = 4
        dc.ellipse(
            [margin, margin, width - margin, height - margin],
            fill=(255, 153, 0, 255)  # 橙色
        )
        
        # 绘制白色字母 "A"
        try:
            from PIL import ImageFont
            font_size = int(height * 0.5)
            font = ImageFont.truetype("arial.ttf", font_size)
        except:
            font = ImageFont.load_default()
        
        # 计算文字位置使其居中
        bbox = dc.textbbox((0, 0), "A", font=font)
        text_width = bbox[2] - bbox[0]
        text_height = bbox[3] - bbox[1]
        x = (width - text_width) / 2
        y = (height - text_height) / 2 - 2
        
        dc.text((x, y), "A", fill=(255, 255, 255, 255), font=font)
        
        return image

    def _create_menu(self) -> pystray.Menu:
        """创建托盘菜单。"""
        menu_items = []
        
        # 显示窗口
        menu_items.append(pystray.MenuItem(
            "显示窗口",
            self._on_show_clicked,
            default=True  # 双击托盘图标触发
        ))
        
        menu_items.append(pystray.Menu.SEPARATOR)
        
        # 添加自定义菜单项
        for item in self._menu_items:
            if item.get('separator'):
                menu_items.append(pystray.Menu.SEPARATOR)
            else:
                menu_items.append(pystray.MenuItem(
                    item['text'],
                    item['callback'],
                    checked=item.get('checked'),
                    radio=item.get('radio')
                ))
        
        if self._menu_items:
            menu_items.append(pystray.Menu.SEPARATOR)
        
        # 退出程序
        menu_items.append(pystray.MenuItem(
            "退出",
            self._on_exit_clicked
        ))
        
        return pystray.Menu(*menu_items)

    def _on_show_clicked(self, icon, item):
        """处理显示窗口菜单点击。"""
        if self._on_show:
            try:
                self._on_show()
            except Exception as e:
                log.error(f"托盘显示窗口回调失败: {e}")

    def _on_exit_clicked(self, icon, item):
        """处理退出菜单点击。"""
        self.stop()
        if self._on_exit:
            try:
                self._on_exit()
            except Exception as e:
                log.error(f"托盘退出回调失败: {e}")

    def start(self) -> bool:
        """
        启动托盘图标。
        
        Returns:
            是否启动成功
        """
        if not self.is_available():
            return False

        with self._lock:
            if self._icon is not None:
                return True  # 已经启动

            try:
                self._icon = pystray.Icon(
                    "aimer_wt",
                    self.create_icon_image(),
                    "AimerWT - 战争雷霆一键更换语音包",
                    self._create_menu()
                )
                
                # 在后台线程运行托盘
                self._icon.run_detached()
                log.info("系统托盘已启动")
                return True
                
            except Exception as e:
                log.error(f"启动系统托盘失败: {e}")
                self._icon = None
                return False

    def stop(self):
        """停止托盘图标。"""
        with self._lock:
            if self._icon is not None:
                try:
                    self._icon.stop()
                    log.info("系统托盘已停止")
                except Exception as e:
                    log.error(f"停止系统托盘失败: {e}")
                finally:
                    self._icon = None

    def notify(self, title: str, message: str, duration: int = 3):
        """
        显示托盘通知。
        
        Args:
            title: 通知标题
            message: 通知内容
            duration: 显示时长（秒）
        """
        if not self.is_available() or self._icon is None:
            return

        try:
            self._icon.notify(message, title)
        except Exception as e:
            log.error(f"显示托盘通知失败: {e}")

    def is_running(self) -> bool:
        """检查托盘是否正在运行。"""
        with self._lock:
            return self._icon is not None


# 全局托盘管理器实例
tray_manager = TrayManager()
