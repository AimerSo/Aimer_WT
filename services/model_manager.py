# -*- coding: utf-8 -*-
"""
模型库管理模组：负责模型库目录结构管理。

功能特性:
- 模型库目录管理
- 自动创建模型库目录

错误处理策略:
- 文件操作使用具体的异常类型
- 所有操作记录完整的错误上下文
"""
import os
import platform
import subprocess
from pathlib import Path
from typing import Any
from utils.logger import get_logger
from utils.utils import get_app_data_dir

log = get_logger(__name__)

# 定义标准文件夹名称
DIR_MODEL_LIBRARY = "../WT模型库"


class ModelManager:
    """
    模型库管理器：管理模型库的文件操作。
    
    属性:
        root_dir: 应用数据根目录
        model_library_dir: 模型库目录
    """

    def __init__(self, model_library_dir: str | None = None):
        """初始化 ModelManager。"""
        self.root_dir = get_app_data_dir()

        # 初始化模型库目录路径
        # 支援自定义路径，若未提供则使用预设值
        if model_library_dir and Path(model_library_dir).exists():
            self.model_library_dir = Path(model_library_dir)
        else:
            self.model_library_dir = self.root_dir / DIR_MODEL_LIBRARY

        # 确保目录存在
        self._ensure_dirs()

    def update_paths(self, model_library_dir: str | None = None) -> dict[str, bool]:
        """
        动态更新模型库路径。
        
        Args:
            model_library_dir: 新的模型库路径
            
        Returns:
            包含更新结果的字典 {'model_library_updated': bool}
        """
        result = {'model_library_updated': False}

        def _norm_path(path: Path) -> str:
            try:
                resolved = path.resolve(strict=False)
            except Exception:
                resolved = path
            return os.path.normcase(os.path.normpath(str(resolved)))

        if model_library_dir:
            new_path = Path(model_library_dir)
            if _norm_path(new_path) == _norm_path(self.model_library_dir):
                # 路径未变更：避免重复日志
                pass
            else:
                # 确保目录存在或可创建
                if not new_path.exists():
                    try:
                        new_path.mkdir(parents=True, exist_ok=True)
                        log.info(f"已创建模型库目录: {new_path}")
                    except PermissionError as e:
                        log.error(f"无法创建模型库目录（权限不足）: {e}")
                        return result
                    except OSError as e:
                        log.error(f"无法创建模型库目录: {e}")
                        return result
                self.model_library_dir = new_path
                result['model_library_updated'] = True
                log.info(f"模型库路径已更新: {new_path}")

        return result

    def _ensure_dirs(self) -> None:
        """确保模型库目录存在。"""
        for dir_path, dir_name in [(self.model_library_dir, "模型库")]:
            if not dir_path.exists():
                try:
                    dir_path.mkdir(parents=True)
                    log.info(f"已创建{dir_name}目录: {dir_path}")
                except PermissionError as e:
                    log.error(f"创建{dir_name}目录失败（权限不足）: {e}")
                except OSError as e:
                    log.error(f"创建{dir_name}目录失败: {e}")

    def _open_folder_cross_platform(self, path: Path) -> None:
        """跨平台打开文件夹。"""
        try:
            if platform.system() == "Windows":
                os.startfile(str(path))
            elif platform.system() == "Darwin":
                subprocess.Popen(["open", str(path)])
            else:
                subprocess.Popen(["xdg-open", str(path)])
        except Exception as e:
            log.error(f"打开文件夹失败: {e}")

    def open_model_library_folder(self) -> None:
        """打开模型库目录。"""
        self._open_folder_cross_platform(self.model_library_dir)

    def get_model_library_path(self) -> str:
        """获取模型库路径。"""
        return str(self.model_library_dir)
