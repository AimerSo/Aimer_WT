# -*- coding: utf-8 -*-
"""
炮镜资源管理模块：负责 UserSights 的路径设置、扫描、导入、重命名与封面处理。

功能定位:
- 管理用户指定的 UserSights 目录，并扫描其中的炮镜文件夹以生成前端展示数据。
- 将用户提供的炮镜 ZIP 解压导入到 UserSights，支持覆盖导入与进度回调。
- 提供炮镜文件夹重命名与封面（preview.png）更新能力。
- 自动搜索 War Thunder 的 UserSights 路径，支持多 UID 选择。

输入输出:
- 输入: UserSights 路径、炮镜 ZIP 路径、封面 base64 数据、重命名参数、进度回调。
- 输出: 炮镜列表字典、导入结果字典、对 UserSights 目录结构与 preview.png 的写入副作用。
- 外部资源/依赖:
  - 目录: UserSights（读写）
  - 文件: 炮镜目录内的 .blk 文件（扫描计数）、preview.png（写入）
  - 系统能力: zipfile 解压、文件系统读写、os.startfile

实现逻辑:
- 1) set_usersights_path 负责校验并持久化当前工作目录（由上层配置管理模块保存）。
- 2) scan_sights 遍历目录并统计 .blk 文件数量，选择预览图或默认封面生成 data URL。
- 3) import_sights_zip 解压到临时目录后整理为目标目录结构，并对压缩包成员路径与扩展名做约束校验。
- 4) discover_usersights_paths 自动搜索系统中所有可能的 UserSights 路径。

业务关联:
- 上游: main.py 的桥接层 API 暴露该能力给前端页面。
- 下游: 前端用于展示炮镜库、执行导入、改名与封面更新。
"""
import base64
import os
import platform
import shutil
import zipfile
from pathlib import Path
from logger import get_logger

log = get_logger(__name__)


class SightsManager:
    # 面向 UserSights 目录的资源管理器，封装扫描、导入与文件操作能力。
    def __init__(self, log_callback=None):
        # 保留 log_callback 以維持向後兼容，但內部使用統一 logger
        self._log_callback = log_callback
        self._usersights_path = None
        self._cache = None

    def _log(self, message, level="INFO"):
        """統一日誌輸出到 logger.py"""
        tag = str(level or "INFO").upper()
        msg = str(message)

        # 統一前綴：避免重複疊加
        if tag != "INFO" and not msg.startswith(f"[{tag}]"):
            msg = f"[{tag}] {msg}"

        if tag in {"WARN", "WARNING"}:
            log.warning(msg)
        elif tag in {"ERROR"}:
            log.error(msg)
        else:
            log.info(msg)

    def discover_usersights_paths(self):
        """
        自动搜索系统中所有可能的 War Thunder UserSights 路径。
        
        官方路径格式：
        - Windows: Documents/My Games/WarThunder/Saves/<UID>/production/UserSights
        - Linux: ~/.config/WarThunder/Saves/<UID>/production/UserSights
        - macOS: ~/My Games/WarThunder/Saves/<UID>/production/UserSights
        
        返回:
            list[dict]: 包含 uid, path, exists 的列表
        """
        results = []
        system = platform.system()
        
        # 根据平台确定基础路径
        possible_bases = []
        
        if system == "Windows":
            # Windows 官方路径
            possible_bases.append(Path.home() / "Documents" / "My Games" / "WarThunder" / "Saves")
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
        found_uids = set()  # 用于去重
        
        for base_path in possible_bases:
            if not base_path.exists():
                continue
            
            try:
                # 遍历 Saves 目录下的所有 UID 文件夹
                for uid_dir in base_path.iterdir():
                    if not uid_dir.is_dir():
                        continue
                    
                    uid = uid_dir.name
                    
                    # 跳过已处理的 UID
                    if uid in found_uids:
                        continue
                    
                    # 构建 UserSights 路径
                    usersights_path = uid_dir / "production" / "UserSights"
                    
                    results.append({
                        "uid": uid,
                        "path": str(usersights_path),
                        "exists": usersights_path.exists()
                    })
                    found_uids.add(uid)
            except Exception as e:
                self._log(f"搜索 {base_path} 失败: {e}", "ERROR")
        
        if not results:
            self._log(f"未找到任何 War Thunder Saves 目录", "INFO")
        
        # 按 UID 排序
        results.sort(key=lambda x: x["uid"])
        return results
    
    def select_uid_path(self, uid: str):
        """
        根据 UID 选择并设置对应的 UserSights 路径。
        如果路径不存在，会自动创建。
        
        参数:
            uid: 用户 UID
            
        返回:
            str: 设置后的 UserSights 路径
        """
        discovered = self.discover_usersights_paths()
        
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
                self._log(f"已创建 UserSights 目录: {path}", "INFO")
            except Exception as e:
                raise ValueError(f"无法创建 UserSights 目录: {e}")
        
        # 设置路径
        self.set_usersights_path(path)
        return str(path)
    
    def set_usersights_path(self, path: str | Path):
        # 设置并校验 UserSights 工作目录路径。
        path = Path(path)
        if not path.exists():
            try:
                path.mkdir(parents=True, exist_ok=True)
                self._log(f"[INFO] 已创建 UserSights 文件夹: {path}", "INFO")
            except Exception as e:
                raise ValueError(f"无法创建 User Sights 文件夹: {e}")
        
        if not path.is_dir():
            raise ValueError("选择的路径不是文件夹")
        
        self._usersights_path = path
        self._cache = None
        return True
    
    def get_usersights_path(self):
        # 获取当前设置的 UserSights 目录路径。
        return self._usersights_path
    
    def scan_sights(self, force_refresh=False, default_cover_path: Path | None = None):
        # 扫描 UserSights 目录下的炮镜文件夹并生成前端展示用列表数据。
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
                for fp in item.rglob('*'):
                    if fp.is_file() and fp.suffix.lower() == '.blk':
                        blk_files.append(fp)
                
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
        except Exception as e:
            self._log(f"[ERROR] 扫描炮镜失败: {e}", "ERROR")
        
        result = {
            'exists': True,
            'path': str(self._usersights_path),
            'items': sorted(sights, key=lambda x: x['name'].lower())
        }
        self._cache = result
        return result

    def rename_sight(self, old_name: str, new_name: str):
        # 在 UserSights 目录内安全重命名炮镜文件夹。
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
            return True
        except OSError as e:
            raise OSError(f"重命名失败: {e}")

    def update_sight_cover_data(self, sight_name: str, data_url: str):
        # 将前端传入的 base64 图片数据写入为 preview.png，作为炮镜封面。
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
        except Exception as e:
            raise ValueError(f"图片数据解析失败: {e}")

        dst = sight_dir / "preview.png"
        try:
            with open(dst, "wb") as f:
                f.write(raw)
            self._cache = None
            return True
        except Exception as e:
            raise Exception(f"封面更新失败: {e}")

    def _find_preview_image(self, dir_path: Path):
        # 在炮镜目录中查找可用的预览图文件。
        candidates = []
        for pat in ("preview.*", "icon.*", "*.jpg", "*.jpeg", "*.png", "*.webp"):
            candidates.extend(dir_path.glob(pat))

        for p in candidates:
            if p.is_file() and p.suffix.lower() in (".jpg", ".jpeg", ".png", ".webp"):
                return p
        return None

    def _to_data_url(self, file_path: Path):
        # 将图片文件读取并编码为 data URL，供前端直接展示。
        ext = file_path.suffix.lower().replace(".", "")
        if ext == "jpg":
            ext = "jpeg"
        try:
            with open(file_path, "rb") as f:
                b64 = base64.b64encode(f.read()).decode("utf-8")
            return f"data:image/{ext};base64,{b64}"
        except Exception:
            return ""
    
    def open_usersights_folder(self):
        # 打开当前设置的 UserSights 目录。
        if self._usersights_path and self._usersights_path.exists():
            try:
                os.startfile(str(self._usersights_path))
            except Exception as e:
                self._log(f"[ERROR] 打开文件夹失败: {e}", "ERROR")
        else:
            raise ValueError("UserSights 路径未设置或不存在")

    def import_sights_zip(
        self,
        zip_path: str | Path,
        progress_callback=None,
        overwrite: bool = False,
    ):
        # 将炮镜 ZIP 解压导入到 UserSights，并根据压缩包结构决定目标目录命名策略。
        if not self._usersights_path or not self._usersights_path.exists():
            raise ValueError("请先设置有效的 UserSights 路径")

        zip_path = Path(zip_path)
        if not zip_path.exists() or zip_path.suffix.lower() != ".zip":
            raise ValueError("请选择有效的 .zip 文件")

        usersights_dir = self._usersights_path
        usersights_dir.mkdir(parents=True, exist_ok=True)

        blocked_ext = {
            ".exe",
            ".dll",
            ".bat",
            ".cmd",
            ".ps1",
            ".vbs",
            ".js",
            ".jar",
            ".msi",
            ".com",
        }

        tmp_dir = usersights_dir / f".__tmp_extract__{zip_path.stem}"
        if tmp_dir.exists():
            shutil.rmtree(tmp_dir)
        tmp_dir.mkdir(parents=True, exist_ok=True)

        def _is_within(base_dir: Path, target: Path) -> bool:
            # 判断目标路径是否位于指定基准目录内部（含目录自身）。
            try:
                base = base_dir.resolve()
                t = target.resolve()
                return base == t or str(t).startswith(str(base) + os.sep)
            except Exception:
                return False

        try:
            if progress_callback:
                progress_callback(1, f"准备解压到 UserSights: {zip_path.name}")

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
                        raise ValueError(f"检测到不允许的文件类型: {filename}")

                    target_path = (tmp_dir / filename)
                    if not _is_within(tmp_dir, target_path):
                        raise ValueError(f"压缩包路径不安全: {filename}")

                    target_path.parent.mkdir(parents=True, exist_ok=True)
                    with zf.open(m, "r") as src, open(target_path, "wb") as dst:
                        shutil.copyfileobj(src, dst, length=1024 * 1024)

                    extracted += 1
                    if progress_callback:
                        pct = 2 + int((extracted / total) * 90)
                        progress_callback(pct, f"解压中: {Path(filename).name}")

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
                    shutil.rmtree(target_dir)
                shutil.move(str(inner_dir), str(target_dir))
            else:
                target_dir = usersights_dir / zip_path.stem
                if target_dir.exists():
                    if not overwrite:
                        raise FileExistsError(f"已存在同名炮镜文件夹: {zip_path.stem}")
                    shutil.rmtree(target_dir)
                target_dir.mkdir(parents=True, exist_ok=True)
                for child in top_level:
                    shutil.move(str(child), str(target_dir / child.name))

            if progress_callback:
                progress_callback(98, "完成整理")
        finally:
            try:
                shutil.rmtree(tmp_dir)
            except Exception:
                pass

        if progress_callback:
            progress_callback(100, "导入完成")

        self._cache = None
        return {"ok": True, "target_dir": str(target_dir)}
