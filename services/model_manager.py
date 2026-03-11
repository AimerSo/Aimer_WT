# -*- coding: utf-8 -*-
"""
模型库管理模组：负责模型库目录结构管理与文件操作。

功能特性:
- 模型库目录管理
- 自动创建模型库目录
- 扫描模型列表（子目录枚举）
- 重命名模型文件夹
- 更新模型封面（base64 数据写入）

错误处理策略:
- 文件操作使用具体的异常类型
- 所有操作记录完整的错误上下文
"""
import base64
import os
import platform
import subprocess
import time
from pathlib import Path
from utils.logger import get_logger
from utils.utils import get_app_data_dir

log = get_logger(__name__)

# 定义标准文件夹名称
DIR_RESOURCE_ROOT = "../AimerWT资源库"
DIR_MODEL_LIBRARY = f"{DIR_RESOURCE_ROOT}/WT模型库"

# 封面文件名
COVER_FILENAME = "cover.png"
# 支持的封面搜索名称列表（按优先级）
COVER_SEARCH_NAMES = ["cover.png", "cover.jpg", "preview.png", "preview.jpg"]
# 支持以图片扩展名匹配的后备方案
IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp"}


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

        # 支援自定义路径，若未提供则使用预设值
        if model_library_dir and Path(model_library_dir).exists():
            self.model_library_dir = Path(model_library_dir)
        else:
            self.model_library_dir = self.root_dir / DIR_MODEL_LIBRARY

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
                pass
            else:
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

    # ==================== 列表扫描 ====================

    def scan_items(self) -> list[dict]:
        """
        扫描模型库目录，枚举所有子文件夹，返回前端展示用列表。

        Returns:
            列表，每项包含 name / path / size_bytes / cover_url / date 字段
        """
        lib_dir = self.model_library_dir
        if not lib_dir.exists() or not lib_dir.is_dir():
            return []

        items: list[dict] = []
        try:
            for entry in sorted(lib_dir.iterdir(), key=lambda p: p.name.lower()):
                if not entry.is_dir():
                    continue
                if entry.name.startswith("."):
                    continue

                size_bytes = self._get_dir_size_fast(entry)
                cover_url = self._find_cover_data_url(entry)
                mtime = self._get_dir_mtime(entry)

                items.append({
                    "name": entry.name,
                    "path": str(entry),
                    "size_bytes": size_bytes,
                    "cover_url": cover_url,
                    "cover_is_default": not bool(cover_url),
                    "date": mtime,
                })
        except PermissionError as e:
            log.error(f"扫描模型库目录权限不足: {e}")
        except OSError as e:
            log.error(f"扫描模型库目录失败: {e}")

        return items

    # ==================== 重命名 ====================

    def rename_item(self, old_name: str, new_name: str) -> bool:
        """
        重命名模型库中的子文件夹。

        Args:
            old_name: 原文件夹名称
            new_name: 新文件夹名称

        Returns:
            是否重命名成功
        """
        invalid_chars = set('\\/:*?"<>|')
        if any(c in invalid_chars for c in new_name):
            raise ValueError(f"名称包含非法字符: {new_name}")

        new_name = new_name.strip()
        if not new_name:
            raise ValueError("名称不能为空")

        old_path = self.model_library_dir / old_name
        new_path = self.model_library_dir / new_name

        if not old_path.exists():
            raise FileNotFoundError(f"原文件夹不存在: {old_name}")
        if new_path.exists():
            raise FileExistsError(f"目标名称已存在: {new_name}")

        try:
            old_path.rename(new_path)
            log.info(f"模型重命名成功: {old_name} -> {new_name}")
            return True
        except OSError as e:
            log.error(f"模型重命名失败: {e}")
            raise

    # ==================== 封面更新 ====================

    def update_cover_data(self, item_name: str, data_url: str) -> bool:
        """
        将前端传入的 base64 图片数据写入为 cover.png，作为模型封面。

        Args:
            item_name: 模型文件夹名称
            data_url: base64 编码的图片数据 URL

        Returns:
            是否更新成功
        """
        item_dir = self.model_library_dir / item_name
        if not item_dir.exists() or not item_dir.is_dir():
            raise FileNotFoundError(f"模型文件夹不存在: {item_name}")

        if "," in data_url:
            raw_data = data_url.split(",", 1)[1]
        else:
            raw_data = data_url

        try:
            img_bytes = base64.b64decode(raw_data)
        except Exception as e:
            raise ValueError(f"base64 解码失败: {e}")

        cover_path = item_dir / COVER_FILENAME
        try:
            cover_path.write_bytes(img_bytes)
            log.info(f"模型封面已更新: {item_name}")
            return True
        except OSError as e:
            log.error(f"模型封面写入失败: {e}")
            raise

    # ==================== 内部工具方法 ====================

    def _get_dir_size_fast(self, dir_path: Path, max_files: int = 500) -> int:
        """统计目录大小，限制遍历文件数量防止卡顿。"""
        total = 0
        count = 0
        try:
            for entry in dir_path.rglob("*"):
                if entry.is_file():
                    total += entry.stat().st_size
                    count += 1
                    if count >= max_files:
                        break
        except (PermissionError, OSError):
            pass
        return total

    def _find_cover_data_url(self, dir_path: Path) -> str:
        """
        在目录中查找封面图片，编码为 data URL 返回。
        查找顺序: cover.png > cover.jpg > preview.png > preview.jpg > 任意图片
        """
        for name in COVER_SEARCH_NAMES:
            cover = dir_path / name
            if cover.exists() and cover.is_file():
                return self._to_data_url(cover)

        try:
            for entry in dir_path.iterdir():
                if entry.is_file() and entry.suffix.lower() in IMAGE_EXTENSIONS:
                    return self._to_data_url(entry)
        except (PermissionError, OSError):
            pass

        return ""

    def _to_data_url(self, file_path: Path) -> str:
        """将图片文件编码为 data URL。"""
        try:
            data = file_path.read_bytes()
            suffix = file_path.suffix.lower()
            mime_map = {
                ".png": "image/png",
                ".jpg": "image/jpeg",
                ".jpeg": "image/jpeg",
                ".gif": "image/gif",
                ".bmp": "image/bmp",
                ".webp": "image/webp",
            }
            mime = mime_map.get(suffix, "image/png")
            b64 = base64.b64encode(data).decode("ascii")
            return f"data:{mime};base64,{b64}"
        except Exception:
            return ""

    def _get_dir_mtime(self, dir_path: Path) -> str:
        """获取目录修改日期，格式 YYYY-MM-DD。"""
        try:
            mtime = dir_path.stat().st_mtime
            return time.strftime("%Y-%m-%d", time.localtime(mtime))
        except Exception:
            return ""
