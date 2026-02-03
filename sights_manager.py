# -*- coding: utf-8 -*-
"""
炮镜资源管理模组：负责 UserSights 的路径设置、扫描、导入、重命名与封面处理。

功能定位:
- 管理用户指定的 UserSights 目录，并扫描其中的炮镜文件夹以生成前端展示数据。
- 将用户提供的炮镜 ZIP 解压导入到 UserSights，支援复盖导入与进度回调。
- 提供炮镜文件夹重命名与封面（preview.png）更新能力。
- 自动搜索 War Thunder 的 UserSights 路径，支援多 UID 选择。

输入输出:
- 输入: UserSights 路径、炮镜 ZIP 路径、封面 base64 数据、重命名参数、进度回调。
- 输出: 炮镜列表字典、导入结果字典、对 UserSights 目录结构与 preview.png 的写入副作用。
- 外部资源/依赖:
  - 目录: UserSights（读写）
  - 文件: 炮镜目录内的 .blk 文件（扫描计数）、preview.png（写入）
  - 系统能力: zipfile 解压、文件系统读写、os.startfile

错误处理策略:
- 文件操作使用具体的异常类型（PermissionError、FileNotFoundError 等）
- 压缩包解压支援路径安全校验
- 所有操作记录完整的错误上下文
"""
import base64
import os
import platform
import shutil
import subprocess
import zipfile
from pathlib import Path
from typing import Callable, Any
from logger import get_logger

log = get_logger(__name__)


class SightsManagerError(Exception):
    """炮镜管理器相关错误的基类。"""
    pass


class SightsPathError(SightsManagerError):
    """UserSights 路径相关错误。"""
    pass


class SightsImportError(SightsManagerError):
    """炮镜导入相关错误。"""
    pass


class SightsManager:
    """
    面向 UserSights 目录的资源管理器，封装扫描、导入与文件操作能力。
    
    属性:
        _usersights_path: 当前设置的 UserSights 路径
        _cache: 扫描结果缓存
    """
    
    def __init__(self):
        """
        初始化 SightsManager。
        """
        self._usersights_path: Path | None = None
        self._cache: dict | None = None

    def discover_usersights_paths(self, configured_sights_path: str | None = None) -> list[dict[str, Any]]:
        """
        自动搜索系统中所有可能的 War Thunder UserSights 路径。

        官方路径格式：
        - Windows: Documents/My Games/WarThunder/Saves/<UID>/production/UserSights
        - Linux: ~/.config/WarThunder/Saves/<UID>/production/UserSights
        - macOS: ~/My Games/WarThunder/Saves/<UID>/production/UserSights
        Args:
            configured_sights_path: 用户配置的炮镜路径（可选）
        Returns:
            包含 uid, path, exists 的列表
        """
        results = []
        system = platform.system()
        
        # 根据平台确定基础路径
        possible_bases = []
        # 从配置路径推导 Saves 基础目录
        if configured_sights_path:
            try:
                p = Path(str(configured_sights_path)).expanduser()

                if p.is_dir():
                    if p.name.lower() == "saves":
                        possible_bases.append(p)
                    else:
                        for child_name in ("Saves", "saves"):
                            cand = p / child_name
                            if cand.exists() and cand.is_dir():
                                possible_bases.append(cand)
                                break

                    if p.name.lower() == "usersights" and p.parent.name.lower() == "production":
                        try:
                            base = p.parents[2]
                            if base.exists() and base.is_dir():
                                possible_bases.append(base)
                        except Exception:
                            pass

                    try:
                        checked = 0
                        for child in p.iterdir():
                            if not child.is_dir():
                                continue
                            checked += 1
                            if (child / "production").exists():
                                possible_bases.append(p)
                                break
                            if checked >= 10:
                                break
                    except Exception:
                        pass

                for cand in [p] + list(p.parents):
                    if cand.name.lower() == "saves":
                        possible_bases.append(cand)
                        break
            except Exception as e:
                log.debug(f"解析配置炮镜路径失败，略过: {e}")

        if system == "Windows":
            # Windows 官方路径
            docs_dir = None
            try:
                import ctypes.wintypes
                buf = ctypes.create_unicode_buffer(ctypes.wintypes.MAX_PATH)
                # CSIDL_PERSONAL = 5 (My Documents), SHGFP_TYPE_CURRENT = 0
                if ctypes.windll.shell32.SHGetFolderPathW(None, 5, None, 0, buf) != 0:
                    raise OSError("无法通过 Windows API 获取文档路径")

                if not buf.value:
                    raise OSError("获取到的 Windows 文档路径为空")
                     
                docs_dir = Path(buf.value)
            except Exception as e:
                log.warning(f"获取 Windows 文档目录失败，略过默认搜索路径: {e}")

            if not docs_dir:
                docs_dir = Path.home() / "Documents"

            possible_bases.append(docs_dir / "My Games" / "WarThunder" / "Saves")
        elif system == "Darwin":
            # macOS 官方路径
            possible_bases.append(Path.home() / "My Games" / "WarThunder" / "Saves")
            # 备选：Documents 下
            possible_bases.append(Path.home() / "Documents" / "My Games" / "WarThunder" / "Saves")
        else:
            # Linux 官方原生路径
            possible_bases.append(Path.home() / ".config" / "WarThunder" / "Saves")
            # Linux - Wine/Proton 路径（Steam）
            possible_bases.append(
                Path.home() / ".local" / "share" / "Steam" / "steamapps" / "compatdata" / "236390" / "pfx" / "drive_c" / "users" / "steamuser" / "Documents" / "My Games" / "WarThunder" / "Saves"
            )
            # 备选：Documents 下
            possible_bases.append(Path.home() / "Documents" / "My Games" / "WarThunder" / "Saves")
        
        # 搜索所有可能的基础路径
        uid_map = set()
        seen_bases = set()
        
        for base_path in possible_bases:
            try:
                base_key = str(base_path.resolve())
            except Exception:
                base_key = str(base_path)

            if base_key in seen_bases:
                continue
            seen_bases.add(base_key)

            if not base_path.exists():
                continue
            
            try:
                # 遍历 Saves 目录下的所有 UID 文件夹
                for uid_dir in base_path.iterdir():
                    if not uid_dir.is_dir():
                        continue
                    
                    uid = uid_dir.name
                    
                    # 跳过已处理的 UID
                    if uid in uid_map:
                        continue
                    
                    # 构建 UserSights 路径
                    usersights_path = uid_dir / "production" / "UserSights"
                    
                    results.append({
                        "uid": uid,
                        "path": str(usersights_path),
                        "exists": usersights_path.exists()
                    })
                    uid_map.add(uid)
                    
            except PermissionError as e:
                log.error(f"搜索 {base_path} 失败（权限不足）: {e}")
            except Exception as e:
                log.error(f"搜索 {base_path} 失败: {type(e).__name__}: {e}")
        
        if not results:
            log.info("未找到任何 War Thunder Saves 目录")
        
        # 按 UID 排序
        results.sort(key=lambda x: x["uid"])
        return results
    
    def select_uid_path(self, uid: str, configured_sights_path: str | None = None) -> str:
        """
        根据 UID 选择并设置对应的 UserSights 路径。
        如果路径不存在，会自动创建。
        
        Args:
            uid: 用户 UID
            
        Returns:
            设置后的 UserSights 路径
            
        Raises:
            ValueError: 找不到指定的 UID
            SightsPathError: 无法创建目录
        """
        discovered = self.discover_usersights_paths(configured_sights_path=configured_sights_path)
        
        # 查找匹配的 UID
        target = None
        for item in discovered:
            if item["uid"] == uid:
                target = item
                break
        
        if not target:
            raise ValueError(f"未找到 UID: {uid}")
        
        path = Path(target["path"])
        
        # 如果路径不存在，创建它
        if not path.exists():
            try:
                path.mkdir(parents=True, exist_ok=True)
                log.info(f"已创建 UserSights 目录: {path}")
            except PermissionError as e:
                raise SightsPathError(f"无法创建 UserSights 目录（权限不足）: {e}")
            except OSError as e:
                raise SightsPathError(f"无法创建 UserSights 目录: {e}")
        
        # 设置路径
        self.set_usersights_path(path)
        return str(path)
    
    def set_usersights_path(self, path: str | Path) -> bool:
        """
        设置并校验 UserSights 工作目录路径。
        
        Args:
            path: UserSights 路径
            
        Returns:
            是否设置成功
            
        Raises:
            ValueError: 路径无效
            SightsPathError: 无法创建目录
        """
        path = Path(path)
        
        if not path.exists():
            try:
                path.mkdir(parents=True, exist_ok=True)
                log.info(f"已创建 UserSights 文件夹: {path}")
            except PermissionError as e:
                raise SightsPathError(f"无法创建 UserSights 文件夹（权限不足）: {e}")
            except OSError as e:
                raise SightsPathError(f"无法创建 UserSights 文件夹: {e}")
        
        if not path.is_dir():
            raise ValueError("选择的路径不是文件夹")
        
        self._usersights_path = path
        self._cache = None
        log.info(f"UserSights 路径已设置: {path}")
        return True
    
    def get_usersights_path(self) -> Path | None:
        """
        获取当前设置的 UserSights 目录路径。
        
        Returns:
            UserSights 路径或 None
        """
        return self._usersights_path
    
    def scan_sights(self, force_refresh: bool = False, 
                    default_cover_path: Path | None = None) -> dict[str, Any]:
        """
        扫描 UserSights 目录下的炮镜文件夹并生成前端展示用列表数据。
        
        Args:
            force_refresh: 是否强制刷新缓存
            default_cover_path: 默认封面路径
            
        Returns:
            包含 exists, path, items 的字典
        """
        if not self._usersights_path or not self._usersights_path.exists():
            return {'exists': False, 'path': '', 'items': []}

        if not force_refresh and self._cache is not None:
            if self._cache.get("path") == str(self._usersights_path) and Path(self._cache["path"]).exists():
                return self._cache

        sights = []
        try:
            for item in self._usersights_path.iterdir():
                if not item.is_dir():
                    continue
                
                # 统计目录内的 .blk 文件数量
                blk_files = []
                try:
                    for fp in item.rglob('*'):
                        if fp.is_file() and fp.suffix.lower() == '.blk':
                            blk_files.append(fp)
                except PermissionError:
                    log.warning(f"无法访问目录 {item.name}（权限不足）")
                    continue
                
                preview_path = self._find_preview_image(item)
                cover_url = ""
                cover_is_default = False
                if preview_path:
                    cover_url = self._to_data_url(preview_path)
                elif default_cover_path and default_cover_path.exists():
                    cover_url = self._to_data_url(default_cover_path)
                    cover_is_default = True

                sights.append({
                    'name': item.name,
                    'path': str(item),
                    'file_count': len(blk_files),
                    'cover_url': cover_url,
                    'cover_is_default': cover_is_default,
                })
        except PermissionError as e:
            log.error(f"扫描炮镜失败（权限不足）: {e}")
        except OSError as e:
            log.error(f"扫描炮镜失败（系统错误）: {e}")
        
        result = {
            'exists': True,
            'path': str(self._usersights_path),
            'items': sorted(sights, key=lambda x: x['name'].lower())
        }
        self._cache = result
        return result

    def rename_sight(self, old_name: str, new_name: str) -> bool:
        """
        在 UserSights 目录内安全重命名炮镜文件夹。
        
        Args:
            old_name: 原文件夹名称
            new_name: 新文件夹名称
            
        Returns:
            是否重命名成功
            
        Raises:
            ValueError: 路径未设置或名称不合法
            FileNotFoundError: 源文件夹不存在
            FileExistsError: 目标名称已存在
            OSError: 重命名操作失败
        """
        import re
        usersights_dir = self._usersights_path
        if not usersights_dir or not usersights_dir.exists():
            raise ValueError("UserSights 路径未设置或不存在")

        old_dir = usersights_dir / old_name
        new_dir = usersights_dir / new_name

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
            log.info(f"已重命名炮镜: {old_name} -> {new_name}")
            return True
        except PermissionError as e:
            raise OSError(f"重命名失败（权限不足）: {e}")
        except OSError as e:
            raise OSError(f"重命名失败: {e}")

    def update_sight_cover_data(self, sight_name: str, data_url: str) -> bool:
        """
        将前端传入的 base64 图片数据写入为 preview.png，作为炮镜封面。
        
        Args:
            sight_name: 炮镜文件夹名称
            data_url: base64 编码的图片数据 URL
            
        Returns:
            是否更新成功
            
        Raises:
            ValueError: 路径未设置或数据格式错误
            FileNotFoundError: 炮镜文件夹不存在
            SightsManagerError: 封面更新失败
        """
        usersights_dir = self._usersights_path
        if not usersights_dir or not usersights_dir.exists():
            raise ValueError("UserSights 路径未设置或不存在")

        sight_dir = usersights_dir / sight_name
        if not sight_dir.exists():
            raise FileNotFoundError("炮镜文件夹不存在")

        data_url = str(data_url or "")
        if ";base64," not in data_url:
            raise ValueError("图片数据格式错误")

        _prefix, b64 = data_url.split(";base64,", 1)
        try:
            raw = base64.b64decode(b64)
        except (ValueError, TypeError) as e:
            raise ValueError(f"图片数据解析失败: {e}")

        dst = sight_dir / "preview.png"
        try:
            with open(dst, "wb") as f:
                f.write(raw)
            self._cache = None
            log.info(f"已更新炮镜封面: {sight_name}")
            return True
        except PermissionError as e:
            raise SightsManagerError(f"封面更新失败（权限不足）: {e}")
        except OSError as e:
            raise SightsManagerError(f"封面更新失败: {e}")

    def _find_preview_image(self, dir_path: Path) -> Path | None:
        """
        在炮镜目录中查找可用的预览图文件。
        
        Args:
            dir_path: 炮镜目录路径
            
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
            log.warning(f"读取图片失败 {file_path}: {e}")
            return ""
    
    def open_usersights_folder(self) -> bool:
        """
        打开当前设置的 UserSights 目录。
        
        Returns:
            是否成功打开
            
        Raises:
            ValueError: 路径未设置或不存在
        """
        if not self._usersights_path or not self._usersights_path.exists():
            raise ValueError("UserSights 路径未设置或不存在")
        
        try:
            system = platform.system()
            if system == "Windows":
                os.startfile(str(self._usersights_path))
            elif system == "Darwin":
                subprocess.run(["open", str(self._usersights_path)], check=True)
            else:
                subprocess.run(["xdg-open", str(self._usersights_path)], check=True)
            return True
        except FileNotFoundError as e:
            log.error(f"打开文件夹失败（找不到启动器）: {e}")
            return False
        except subprocess.CalledProcessError as e:
            log.error(f"打开文件夹失败: {e}")
            return False
        except OSError as e:
            log.error(f"打开文件夹失败: {e}")
            return False

    def import_sights_zip(
        self,
        zip_path: str | Path,
        progress_callback: Callable[[int, str], None] | None = None,
        overwrite: bool = False,
    ) -> dict[str, Any]:
        """
        将炮镜 ZIP 解压导入到 UserSights，并根据压缩包结构决定目标目录命名策略。
        
        Args:
            zip_path: ZIP 文件路径
            progress_callback: 进度回调函数 (percentage, message)
            overwrite: 是否复盖同名文件夹
            
        Returns:
            包含 ok 和 target_dir 的字典
            
        Raises:
            ValueError: 路径未设置或文件无效
            FileExistsError: 目标文件夹已存在且未允许复盖
            SightsImportError: 导入过程失败
        """
        if not self._usersights_path or not self._usersights_path.exists():
            raise ValueError("请先设置有效的 UserSights 路径")

        zip_path = Path(zip_path)
        if not zip_path.exists():
            raise ValueError(f"ZIP 文件不存在: {zip_path}")
        if zip_path.suffix.lower() != ".zip":
            raise ValueError("请选择有效的 .zip 文件")

        usersights_dir = self._usersights_path
        try:
            usersights_dir.mkdir(parents=True, exist_ok=True)
        except PermissionError as e:
            raise SightsImportError(f"无法创建目标目录（权限不足）: {e}")
        except OSError as e:
            raise SightsImportError(f"无法创建目标目录: {e}")

        blocked_ext = {
            ".exe", ".dll", ".bat", ".cmd", ".ps1", 
            ".vbs", ".js", ".jar", ".msi", ".com",
        }

        tmp_dir = usersights_dir / f".__tmp_extract__{zip_path.stem}"
        if tmp_dir.exists():
            try:
                shutil.rmtree(tmp_dir)
            except OSError as e:
                log.warning(f"清理临时目录失败: {e}")
        
        try:
            tmp_dir.mkdir(parents=True, exist_ok=True)
        except OSError as e:
            raise SightsImportError(f"无法创建临时目录: {e}")

        def _is_within(base_dir: Path, target: Path) -> bool:
            """判断目标路径是否位于指定基准目录内部。"""
            try:
                base = base_dir.resolve()
                t = target.resolve()
                return base == t or str(t).startswith(str(base) + os.sep)
            except (OSError, ValueError):
                return False

        target_dir: Path | None = None
        
        try:
            if progress_callback:
                progress_callback(1, f"准备解压到 UserSights: {zip_path.name}")

            try:
                with zipfile.ZipFile(zip_path, "r") as zf:
                    members = [m for m in zf.infolist() if not m.is_dir()]
                    total = max(len(members), 1)
                    extracted = 0

                    for m in members:
                        filename = m.filename
                        if not filename or "__MACOSX" in filename or "desktop.ini" in filename.lower():
                            continue
                        if filename.endswith("/"):
                            continue

                        ext = Path(filename).suffix.lower()
                        if ext in blocked_ext:
                            raise SightsImportError(f"检测到不允许的文件类型: {filename}")

                        target_path = tmp_dir / filename
                        if not _is_within(tmp_dir, target_path):
                            raise SightsImportError(f"压缩包路径不安全（路径遍历）: {filename}")

                        try:
                            target_path.parent.mkdir(parents=True, exist_ok=True)
                            with zf.open(m, "r") as src, open(target_path, "wb") as dst:
                                shutil.copyfileobj(src, dst, length=1024 * 1024)
                        except PermissionError as e:
                            raise SightsImportError(f"解压失败（权限不足）: {filename}: {e}")
                        except OSError as e:
                            raise SightsImportError(f"解压失败: {filename}: {e}")

                        extracted += 1
                        if progress_callback:
                            pct = 2 + int((extracted / total) * 90)
                            progress_callback(pct, f"解压中: {Path(filename).name}")
                            
            except zipfile.BadZipFile as e:
                raise SightsImportError(f"无效的 ZIP 文件: {e}")
            except zipfile.LargeZipFile as e:
                raise SightsImportError(f"ZIP 文件过大: {e}")

            top_level = [
                p
                for p in tmp_dir.iterdir()
                if p.name not in ("__MACOSX",) and p.name.lower() != "desktop.ini"
            ]

            if len(top_level) == 1 and top_level[0].is_dir():
                inner_dir = top_level[0]
                target_dir = usersights_dir / inner_dir.name
                if target_dir.exists():
                    if not overwrite:
                        raise FileExistsError(f"已存在同名炮镜文件夹: {inner_dir.name}")
                    try:
                        shutil.rmtree(target_dir)
                    except OSError as e:
                        raise SightsImportError(f"无法移除现有文件夹: {e}")
                try:
                    shutil.move(str(inner_dir), str(target_dir))
                except OSError as e:
                    raise SightsImportError(f"移动文件夹失败: {e}")
            else:
                target_dir = usersights_dir / zip_path.stem
                if target_dir.exists():
                    if not overwrite:
                        raise FileExistsError(f"已存在同名炮镜文件夹: {zip_path.stem}")
                    try:
                        shutil.rmtree(target_dir)
                    except OSError as e:
                        raise SightsImportError(f"无法移除现有文件夹: {e}")
                try:
                    target_dir.mkdir(parents=True, exist_ok=True)
                    for child in top_level:
                        shutil.move(str(child), str(target_dir / child.name))
                except OSError as e:
                    raise SightsImportError(f"整理文件失败: {e}")

            if progress_callback:
                progress_callback(98, "完成整理")
                
        finally:
            # 清理临时目录
            try:
                if tmp_dir.exists():
                    shutil.rmtree(tmp_dir)
            except OSError as e:
                log.warning(f"清理临时目录失败: {e}")

        if progress_callback:
            progress_callback(100, "导入完成")

        self._cache = None
        log.info(f"炮镜导入成功: {target_dir}")
        return {"ok": True, "target_dir": str(target_dir)}
