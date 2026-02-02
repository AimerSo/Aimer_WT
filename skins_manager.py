# -*- coding: utf-8 -*-
"""
涂装资源管理模组：负责 UserSkins 的扫描、导入、重命名与封面处理。

功能定位:
- 扫描游戏目录下的 UserSkins 文件夹，生成前端展示数据。
- 支援从 ZIP 导入涂装，包含文件类型校验与磁盘空间检查。
- 提供涂装重命名与封面更新功能。

输入输出:
- 输入: 游戏路径、涂装 ZIP 路径、封面图片数据、重命名参数。
- 输出: 涂装列表字典、导入结果字典、对 UserSkins 目录结构的写入副作用。

错误处理策略:
- 文件操作使用具体的异常类型（PermissionError、FileNotFoundError 等）
- ZIP 解压支援路径安全校验和文件类型白名单
- 所有操作记录完整的错误上下文
"""
import base64
import os
import re
import shutil
import time
import zipfile
from pathlib import Path
from typing import Callable, Any

from logger import get_logger

log = get_logger(__name__)


class SkinsManagerError(Exception):
    """涂装管理器相关错误的基类。"""
    pass


class SkinsImportError(SkinsManagerError):
    """涂装导入过程错误。"""
    pass


class DiskSpaceError(SkinsManagerError):
    """磁盘空间不足错误。"""
    pass


class SkinsManager:
    """
    UserSkins 目录的资源管理器，封装扫描、导入与文件操作能力。
    
    属性:
        _cache: 扫描结果缓存
    """
    
    def __init__(self):
        """
        初始化 SkinsManager。
        """
        self._cache: dict | None = None

    def get_userskins_dir(self, game_path: str | Path) -> Path:
        """
        计算指定游戏目录下 UserSkins 的绝对路径。
        
        Args:
            game_path: 游戏安装路径
            
        Returns:
            UserSkins 目录路径
        """
        return Path(str(game_path)) / "UserSkins"

    def scan_userskins(
        self, 
        game_path: str | Path, 
        default_cover_path: Path | None = None, 
        force_refresh: bool = False
    ) -> dict[str, Any]:
        """
        扫描 UserSkins 目录下的涂装文件夹，并生成前端展示用的列表数据。
        
        Args:
            game_path: 游戏安装路径
            default_cover_path: 默认封面路径
            force_refresh: 是否强制刷新缓存
            
        Returns:
            包含 exists, path, items, valid 的字典
        """
        userskins_dir = self.get_userskins_dir(game_path)
        
        if not force_refresh and self._cache is not None:
            if self._cache.get("path") == str(userskins_dir) and Path(self._cache["path"]).exists():
                return self._cache

        if not userskins_dir.exists():
            return {"exists": False, "path": str(userskins_dir), "items": []}

        items = []
        try:
            for entry in sorted(userskins_dir.iterdir(), key=lambda p: p.name.lower()):
                if not entry.is_dir():
                    continue

                size_bytes, file_count = self._get_dir_size_and_count(entry)
                preview_path = self._find_preview_image(entry)
                cover_url = ""
                cover_is_default = False
                if preview_path:
                    cover_url = self._to_data_url(preview_path)
                elif default_cover_path and default_cover_path.exists():
                    cover_url = self._to_data_url(default_cover_path)
                    cover_is_default = True

                items.append({
                    "name": entry.name,
                    "path": str(entry),
                    "size_bytes": size_bytes,
                    "file_count": file_count,
                    "cover_url": cover_url,
                    "cover_is_default": cover_is_default,
                })
        except PermissionError as e:
            log.error(f"扫描涂装失败（权限不足）: {e}")
        except OSError as e:
            log.error(f"扫描涂装失败: {e}")

        result = {"exists": True, "path": str(userskins_dir), "items": items, "valid": True}
        self._cache = result
        return result

    def import_skin_zip(
        self,
        zip_path: str | Path,
        game_path: str | Path,
        progress_callback: Callable[[int, str], None] | None = None,
        overwrite: bool = False,
    ) -> dict[str, Any]:
        """
        将涂装 ZIP 解压导入到 UserSkins，并整理为目标目录结构。
        
        Args:
            zip_path: ZIP 文件路径
            game_path: 游戏安装路径
            progress_callback: 进度回调函数 (percentage, message)
            overwrite: 是否复盖同名文件夹
            
        Returns:
            包含 ok 和 target_dir 的字典
            
        Raises:
            ValueError: 文件无效或包含非法文件类型
            FileExistsError: 目标文件夹已存在且未允许复盖
            DiskSpaceError: 磁盘空间不足
            SkinsImportError: 导入过程失败
        """
        zip_path = Path(zip_path)
        if not zip_path.exists():
            raise ValueError(f"ZIP 文件不存在: {zip_path}")
        if zip_path.suffix.lower() != ".zip":
            raise ValueError("请选择有效的 .zip 文件")

        # 仅允许导入涂装相关文件扩展名
        ALLOWED_EXTENSIONS = {'.dds', '.blk', '.tga'}
        invalid_files = []
        
        try:
            with zipfile.ZipFile(zip_path, 'r') as zf:
                for member in zf.infolist():
                    if member.is_dir():
                        continue
                    filename = member.filename
                    if '__MACOSX' in filename or 'desktop.ini' in filename.lower():
                        continue
                    
                    ext = Path(filename).suffix.lower()
                    if ext and ext not in ALLOWED_EXTENSIONS:
                        invalid_files.append(filename)
        except zipfile.BadZipFile as e:
            raise ValueError(f"无效的 ZIP 文件: {e}")
        
        if invalid_files:
            file_list = '\n'.join(f'  • {f}' for f in invalid_files[:10])
            if len(invalid_files) > 10:
                file_list += f'\n  ... 还有 {len(invalid_files) - 10} 个文件'
            
            raise ValueError(
                f"❌ 检测到不允许的文件类型！\n\n"
                f"涂装包只允许包含以下文件类型：\n"
                f"  ✓ .dds (纹理文件)\n"
                f"  ✓ .blk (配置文件)\n"
                f"  ✓ .tga (纹理文件)\n\n"
                f"但在压缩包中发现了以下非法文件：\n{file_list}\n\n"
                f"💡 提示：请检查压缩包内容，确保只包含涂装相关文件。"
            )

        userskins_dir = self.get_userskins_dir(game_path)
        try:
            userskins_dir.mkdir(parents=True, exist_ok=True)
        except PermissionError as e:
            raise SkinsImportError(f"无法创建 UserSkins 目录（权限不足）: {e}")
        except OSError as e:
            raise SkinsImportError(f"无法创建 UserSkins 目录: {e}")

        target_name = zip_path.stem
        target_dir = userskins_dir / target_name
        if target_dir.exists():
            if not overwrite:
                raise FileExistsError(f"已存在同名涂装文件夹: {target_name}")
            try:
                shutil.rmtree(target_dir)
            except PermissionError as e:
                raise SkinsImportError(f"无法移除现有文件夹（权限不足）: {e}")
            except OSError as e:
                raise SkinsImportError(f"无法移除现有文件夹: {e}")

        self._check_disk_space(zip_path, userskins_dir)

        tmp_dir = userskins_dir / f".__tmp_extract__{target_name}"
        if tmp_dir.exists():
            try:
                shutil.rmtree(tmp_dir)
            except OSError as e:
                log.error(f"清理临时目录失败: {e}")
        
        try:
            tmp_dir.mkdir(parents=True, exist_ok=True)
        except OSError as e:
            raise SkinsImportError(f"无法创建临时目录: {e}")

        try:
            if progress_callback:
                progress_callback(1, f"准备解压到 UserSkins: {zip_path.name}")

            self._extract_zip_safely(
                zip_path, tmp_dir, 
                progress_callback=progress_callback, 
                base_progress=2, share_progress=85
            )

            top_level = [
                p for p in tmp_dir.iterdir() 
                if p.name not in ("__MACOSX",) and p.name != "desktop.ini"
            ]
            
            if len(top_level) == 1 and top_level[0].is_dir():
                inner_dir = top_level[0]
                try:
                    target_dir.mkdir(parents=True, exist_ok=True)
                    self._move_tree(inner_dir, target_dir)
                except OSError as e:
                    raise SkinsImportError(f"整理文件失败: {e}")
            else:
                try:
                    target_dir.mkdir(parents=True, exist_ok=True)
                    for child in top_level:
                        self._move_tree(child, target_dir / child.name)
                except OSError as e:
                    raise SkinsImportError(f"整理文件失败: {e}")

            if progress_callback:
                progress_callback(98, "完成整理")
        finally:
            # 清理临时目录
            try:
                if tmp_dir.exists():
                    shutil.rmtree(tmp_dir)
            except OSError as e:
                log.error(f"清理临时目录失败: {e}")

        if progress_callback:
            progress_callback(100, "导入完成")

        self._cache = None
        log.info(f"涂装导入成功: {target_dir}")
        return {"ok": True, "target_dir": str(target_dir)}

    def rename_skin(self, game_path: str | Path, old_name: str, new_name: str) -> bool:
        """
        在 UserSkins 目录内安全重命名涂装文件夹。
        
        Args:
            game_path: 游戏安装路径
            old_name: 原文件夹名称
            new_name: 新文件夹名称
            
        Returns:
            是否重命名成功
            
        Raises:
            FileNotFoundError: 源文件夹不存在
            ValueError: 名称不合法
            FileExistsError: 目标名称已存在
            OSError: 重命名操作失败
        """
        userskins_dir = self.get_userskins_dir(game_path)
        old_dir = userskins_dir / old_name
        new_dir = userskins_dir / new_name

        if not old_dir.exists():
            raise FileNotFoundError(f"找不到源文件夹: {old_name}")
        
        if not new_name or len(new_name) > 255:
            raise ValueError("名称长度不合法")
        
        if re.search(r'[<>:"/\\|?*]', new_name):
            raise ValueError('名称包含非法字符 (不能包含 < > : " / \\ | ? *)')

        if new_dir.exists():
            raise FileExistsError(f"目标名称已存在: {new_name}")

        try:
            old_dir.rename(new_dir)
            self._cache = None
            log.info(f"已重命名涂装: {old_name} -> {new_name}")
            return True
        except PermissionError as e:
            raise OSError(f"重命名失败（权限不足）: {e}")
        except OSError as e:
            raise OSError(f"重命名失败: {e}")

    def update_skin_cover(self, game_path: str | Path, skin_name: str, img_path: str) -> bool:
        """
        将指定图片複製为涂装目录的标准封面文件 preview.png。
        
        Args:
            game_path: 游戏安装路径
            skin_name: 涂装文件夹名称
            img_path: 来源图片路径
            
        Returns:
            是否更新成功
            
        Raises:
            FileNotFoundError: 涂装文件夹或图片文件不存在
            SkinsManagerError: 封面更新失败
        """
        userskins_dir = self.get_userskins_dir(game_path)
        skin_dir = userskins_dir / skin_name
        
        if not skin_dir.exists():
            raise FileNotFoundError("涂装文件夹不存在")
            
        if not os.path.exists(img_path):
            raise FileNotFoundError("图片文件不存在")
        
        # 统一封面文件名为 preview.png
        dst = skin_dir / "preview.png"
        
        try:
            shutil.copy2(img_path, dst)
            self._cache = None
            log.info(f"已更新涂装封面: {skin_name}")
            return True
        except PermissionError as e:
            raise SkinsManagerError(f"封面更新失败（权限不足）: {e}")
        except OSError as e:
            raise SkinsManagerError(f"封面更新失败: {e}")

    def update_skin_cover_data(self, game_path: str | Path, skin_name: str, data_url: str) -> bool:
        """
        将前端传入的 base64 图片数据写入为 preview.png，作为涂装封面。
        
        Args:
            game_path: 游戏安装路径
            skin_name: 涂装文件夹名称
            data_url: base64 编码的图片数据 URL
            
        Returns:
            是否更新成功
            
        Raises:
            FileNotFoundError: 涂装文件夹不存在
            ValueError: 数据格式错误
            SkinsManagerError: 封面更新失败
        """
        userskins_dir = self.get_userskins_dir(game_path)
        skin_dir = userskins_dir / skin_name

        if not skin_dir.exists():
            raise FileNotFoundError("涂装文件夹不存在")

        data_url = str(data_url or "")
        if ";base64," not in data_url:
            raise ValueError("图片数据格式错误")

        _prefix, b64 = data_url.split(";base64,", 1)
        try:
            raw = base64.b64decode(b64)
        except (ValueError, TypeError) as e:
            raise ValueError(f"图片数据解析失败: {e}")

        dst = skin_dir / "preview.png"
        try:
            with open(dst, "wb") as f:
                f.write(raw)
            self._cache = None
            log.info(f"已更新涂装封面: {skin_name}")
            return True
        except PermissionError as e:
            raise SkinsManagerError(f"封面更新失败（权限不足）: {e}")
        except OSError as e:
            raise SkinsManagerError(f"封面更新失败: {e}")


    def _get_dir_size_and_count(self, dir_path: Path) -> tuple[int, int]:
        """
        统计目录内所有文件的总大小与文件数量。
        
        Args:
            dir_path: 目录路径
            
        Returns:
            (总大小字节数, 文件数量)
        """
        total = 0
        count = 0
        try:
            for root, _dirs, files in os.walk(dir_path):
                for f in files:
                    fp = Path(root) / f
                    try:
                        total += fp.stat().st_size
                    except (OSError, PermissionError):
                        pass
                    count += 1
        except (OSError, PermissionError) as e:
            log.warning(f"统计目录大小失败 {dir_path}: {e}")
        return total, count

    def _find_preview_image(self, dir_path: Path) -> Path | None:
        """
        在涂装目录中查找可用的预览图文件。
        
        Args:
            dir_path: 涂装目录路径
            
        Returns:
            预览图路径或 None
        """
        candidates = []
        for pat in ("preview.*", "icon.*", "*.jpg", "*.jpeg", "*.png", "*.webp"):
            try:
                candidates.extend(dir_path.glob(pat))
            except OSError:
                continue

        for p in candidates:
            if p.is_file() and p.suffix.lower() in (".jpg", ".jpeg", ".png", ".webp"):
                return p
        return None

    def _to_data_url(self, file_path: Path) -> str:
        """
        将图片文件读取并编码为 data URL，供前端直接展示。
        
        Args:
            file_path: 图片文件路径
            
        Returns:
            data URL 字符串，失败时返回空字符串
        """
        ext = file_path.suffix.lower().replace(".", "")
        if ext == "jpg":
            ext = "jpeg"
        try:
            with open(file_path, "rb") as f:
                b64 = base64.b64encode(f.read()).decode("utf-8")
            return f"data:image/{ext};base64,{b64}"
        except (OSError, PermissionError) as e:
            log.error(f"读取图片失败 {file_path}: {e}")
            return ""

    def _check_disk_space(self, zip_path: Path, target_dir: Path) -> None:
        """
        基于 ZIP 文件大小估算解压所需空间，并与目标盘剩余空间进行比较。
        
        Args:
            zip_path: ZIP 文件路径
            target_dir: 目标目录路径
            
        Raises:
            DiskSpaceError: 磁盘空间不足
        """
        try:
            zip_size = zip_path.stat().st_size
            estimated = zip_size * 3
            required = estimated * 2

            drive = Path(target_dir).anchor
            if not drive:
                drive = str(target_dir)

            total, used, free = shutil.disk_usage(drive)
            if free < required:
                free_mb = free / (1024 * 1024)
                req_mb = required / (1024 * 1024)
                raise DiskSpaceError(f"磁盘空间不足 (可用 {free_mb:.0f}MB, 需要 {req_mb:.0f}MB)")
        except DiskSpaceError:
            raise
        except OSError as e:
            log.warning(f"磁盘空间检查失败（已跳过）: {e}")

    def _extract_zip_safely(
        self, 
        zip_path: Path, 
        target_dir: Path, 
        progress_callback: Callable[[int, str], None] | None = None, 
        base_progress: int = 0, 
        share_progress: int = 100
    ) -> None:
        """
        将 ZIP 内容解压到临时目录，并执行路径边界校验与进度回调更新。
        
        Args:
            zip_path: ZIP 文件路径
            target_dir: 目标目录
            progress_callback: 进度回调函数
            base_progress: 基础进度百分比
            share_progress: 分配的进度百分比范围
            
        Raises:
            SkinsImportError: 解压过程失败
        """
        target_root = Path(target_dir).resolve()
        
        try:
            with zipfile.ZipFile(zip_path, "r") as zf:
                file_list = zf.infolist()
                total_files = len(file_list)
                last_update = 0.0
                extracted_bytes = 0
                total_bytes = 0

                if total_files > 0:
                    for m in file_list:
                        if m.is_dir():
                            continue
                        name = m.filename
                        if "__MACOSX" in name or "desktop.ini" in name:
                            continue
                        try:
                            total_bytes += int(getattr(m, "file_size", 0) or 0)
                        except (ValueError, TypeError):
                            pass

                for idx, member in enumerate(file_list):
                    if idx % 50 == 0:
                        time.sleep(0.001)

                    # 处理文件名编码
                    try:
                        filename = member.filename.encode("cp437").decode("utf-8")
                    except (UnicodeDecodeError, UnicodeEncodeError):
                        try:
                            filename = member.filename.encode("cp437").decode("gbk")
                        except (UnicodeDecodeError, UnicodeEncodeError):
                            filename = member.filename

                    if "__MACOSX" in filename or "desktop.ini" in filename:
                        continue

                    # 更新进度
                    now = time.monotonic()
                    should_push = (idx == 0) or (idx % 10 == 0) or (idx == total_files - 1)
                    if progress_callback and total_files > 0 and should_push and (now - last_update) >= 0.05:
                        ratio = idx / total_files
                        current_percent = base_progress + ratio * share_progress
                        fname = filename
                        if len(fname) > 25:
                            fname = "..." + fname[-25:]
                        try:
                            progress_callback(int(current_percent), f"解压中: {fname}")
                        except Exception:
                            pass
                        last_update = now

                    # 路径安全校验
                    full_target_path = (target_dir / filename).resolve()
                    try:
                        is_inside = os.path.commonpath([str(full_target_path), str(target_root)]) == str(target_root)
                    except ValueError:
                        is_inside = False
                    if not is_inside:
                        log.warning(f"拦截恶意路径穿越文件: {filename}")
                        continue

                    target_path = target_dir / filename
                    if member.is_dir():
                        try:
                            target_path.mkdir(parents=True, exist_ok=True)
                        except OSError as e:
                            log.warning(f"创建目录失败 {filename}: {e}")
                        continue

                    try:
                        target_path.parent.mkdir(parents=True, exist_ok=True)
                        with zf.open(member) as source, open(target_path, "wb") as target:
                            while True:
                                chunk = source.read(8192)
                                if not chunk:
                                    break
                                target.write(chunk)
                                if total_bytes > 0:
                                    extracted_bytes += len(chunk)

                                now = time.monotonic()
                                if progress_callback and total_files > 0 and (now - last_update) >= 0.2:
                                    if total_bytes > 0:
                                        ratio = extracted_bytes / total_bytes
                                    else:
                                        ratio = idx / total_files
                                    current_percent = base_progress + ratio * share_progress
                                    fname = filename
                                    if len(fname) > 25:
                                        fname = "..." + fname[-25:]
                                    try:
                                        progress_callback(int(current_percent), f"解压中: {fname}")
                                    except Exception:
                                        pass
                                    last_update = now
                    except PermissionError as e:
                        raise SkinsImportError(f"解压文件失败（权限不足）: {filename}: {e}")
                    except OSError as e:
                        raise SkinsImportError(f"解压文件失败: {filename}: {e}")
                        
        except zipfile.BadZipFile as e:
            raise SkinsImportError(f"无效的 ZIP 文件: {e}")
        except zipfile.LargeZipFile as e:
            raise SkinsImportError(f"ZIP 文件过大: {e}")

    def _move_tree(self, src: Path, dst: Path) -> None:
        """
        将文件或目录从 src 移动到 dst，并在目标已存在时做合併式移动。
        
        Args:
            src: 源路径
            dst: 目标路径
        """
        if src.is_dir():
            if dst.exists():
                for child in src.iterdir():
                    self._move_tree(child, dst / child.name)
                try:
                    src.rmdir()
                except OSError:
                    pass
                return

            try:
                shutil.move(str(src), str(dst))
            except OSError as e:
                log.error(f"移动目录失败 {src}: {e}")
            return

        try:
            dst.parent.mkdir(parents=True, exist_ok=True)
            if dst.exists():
                try:
                    dst.unlink()
                except OSError:
                    pass
            shutil.move(str(src), str(dst))
        except OSError as e:
            log.error(f"移动文件失败 {src}: {e}")
