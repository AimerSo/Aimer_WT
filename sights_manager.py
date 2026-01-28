# -*- coding: utf-8 -*-
"""
炮镜资源管理模块：负责 UserSights 的路径设置、扫描、导入、重命名与封面处理。

功能定位:
- 管理用户指定的 UserSights 目录，并扫描其中的炮镜文件夹以生成前端展示数据。
- 将用户提供的炮镜 ZIP 解压导入到 UserSights，支持覆盖导入与进度回调。
- 提供炮镜文件夹重命名与封面（preview.png）更新能力。

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

业务关联:
- 上游: main.py 的桥接层 API 暴露该能力给前端页面。
- 下游: 前端用于展示炮镜库、执行导入、改名与封面更新。
"""
import base64
import os
import shutil
import zipfile
from pathlib import Path


class SightsManager:
    """
    功能定位:
    - 面向 UserSights 目录的资源管理器，封装扫描、导入与文件操作能力。

    输入输出:
    - 输入: UserSights 路径、ZIP 文件路径、封面数据、回调函数等。
    - 输出: 供前端渲染的数据结构与对文件系统的变更。
    - 外部资源/依赖: UserSights 目录。

    实现逻辑:
    - 使用 _cache 缓存上次扫描结果；force_refresh 或资源变更时清空缓存。

    业务关联:
    - 上游: main.py 创建实例并调用。
    - 下游: 影响前端炮镜页面展示与交互。
    """
    
    def __init__(self, log_callback=None):
        """
        功能定位:
        - 初始化炮镜管理器并设置日志回调与缓存。

        输入输出:
        - 参数:
          - log_callback: Callable[[str, str], None] | None，日志回调（message, level）。
        - 返回: None
        - 外部资源/依赖: 无

        实现逻辑:
        - 若未提供 log_callback，则使用空函数作为默认实现。
        - 初始化用户路径与扫描缓存为 None。

        业务关联:
        - 上游: main.py 创建管理器实例。
        - 下游: 扫描/导入过程会使用该回调输出日志（若提供）。
        """
        self._log = log_callback or (lambda *_: None)
        self._usersights_path = None
        self._cache = None

    
    def set_usersights_path(self, path: str | Path):
        """
        功能定位:
        - 设置并校验 UserSights 工作目录路径。

        输入输出:
        - 参数:
          - path: str | Path，UserSights 目录路径。
        - 返回:
          - bool，设置成功返回 True。
        - 外部资源/依赖:
          - 目录: path（不存在时创建）

        实现逻辑:
        - 1) 将参数转为 Path。
        - 2) 若目录不存在则尝试创建。
        - 3) 校验目标为目录，写入 _usersights_path 并清空缓存。

        业务关联:
        - 上游: 前端选择炮镜路径或启动时从配置恢复路径。
        - 下游: scan_sights/import_sights_zip 等方法依赖该路径。
        """
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
        """
        功能定位:
        - 获取当前设置的 UserSights 目录路径。

        输入输出:
        - 参数: 无
        - 返回:
          - Path | None，当前 UserSights 路径；未设置时为 None。
        - 外部资源/依赖: 无

        实现逻辑:
        - 直接返回 _usersights_path。

        业务关联:
        - 上游: main.py 初始化前端状态或调试输出时调用。
        - 下游: 供其他逻辑判断路径是否可用。
        """
        return self._usersights_path
    
    def scan_sights(self, force_refresh=False, default_cover_path: Path | None = None):
        """
        功能定位:
        - 扫描 UserSights 目录下的炮镜文件夹并生成前端展示用列表数据。

        输入输出:
        - 参数:
          - force_refresh: bool，是否强制重新扫描（忽略缓存）。
          - default_cover_path: Path | None，默认封面图片路径（未找到预览图时使用）。
        - 返回:
          - dict，包含：
            - exists: bool，UserSights 是否存在且可访问
            - path: str，UserSights 目录字符串
            - items: list[dict]，每个条目包含 name/path/file_count/cover_url/cover_is_default
        - 外部资源/依赖:
          - 目录: UserSights（遍历）
          - 文件: 目录内 .blk 文件（用于计数）、预览图（读取为 data URL）

        实现逻辑:
        - 1) 若路径未设置或不存在，返回 exists=False 的空结果。
        - 2) 若命中缓存且路径未变化且仍存在，则直接返回缓存。
        - 3) 遍历一级子目录作为炮镜条目，递归统计 .blk 文件数量。
        - 4) 选择预览图或默认封面并转为 data URL。
        - 5) 生成结果并写入缓存。

        业务关联:
        - 上游: 前端打开炮镜页或刷新列表时调用。
        - 下游: 前端使用 items 渲染预览网格与统计信息。
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
        """
        功能定位:
        - 在 UserSights 目录内安全重命名炮镜文件夹。

        输入输出:
        - 参数:
          - old_name: str，原文件夹名。
          - new_name: str，新文件夹名。
        - 返回:
          - bool，重命名成功返回 True。
        - 外部资源/依赖:
          - 目录: UserSights（读写）

        实现逻辑:
        - 1) 校验 UserSights 已设置且存在。
        - 2) 校验源目录存在与新名称合法性（长度与非法字符）。
        - 3) 校验目标目录不存在。
        - 4) 执行重命名并清空缓存。

        业务关联:
        - 上游: 前端炮镜管理操作触发。
        - 下游: 前端刷新列表后展示新名称。
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
            return True
        except OSError as e:
            raise OSError(f"重命名失败: {e}")

    def update_sight_cover_data(self, sight_name: str, data_url: str):
        """
        功能定位:
        - 将前端传入的 base64 图片数据写入为 preview.png，作为炮镜封面。

        输入输出:
        - 参数:
          - sight_name: str，炮镜文件夹名。
          - data_url: str，形如 data:image/<type>;base64,<data> 的字符串。
        - 返回:
          - bool，成功返回 True。
        - 外部资源/依赖:
          - 文件: <UserSights>/<sight_name>/preview.png（写入）

        实现逻辑:
        - 1) 校验 UserSights 路径与目标目录存在。
        - 2) 校验 data_url 格式并解码 base64。
        - 3) 写入 preview.png 并清空缓存。

        业务关联:
        - 上游: 前端裁剪/上传封面后调用。
        - 下游: 前端刷新列表后封面展示更新。
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
        """
        功能定位:
        - 在炮镜目录中查找可用的预览图文件。

        输入输出:
        - 参数:
          - dir_path: Path，炮镜目录路径。
        - 返回:
          - Path | None，找到则返回图片路径，否则为 None。
        - 外部资源/依赖: 文件系统 glob

        实现逻辑:
        - 按候选模式（preview/icon/常见图片扩展名）搜索并返回首个匹配文件。

        业务关联:
        - 上游: scan_sights。
        - 下游: 用于生成 cover_url（data URL）。
        """
        candidates = []
        for pat in ("preview.*", "icon.*", "*.jpg", "*.jpeg", "*.png", "*.webp"):
            candidates.extend(dir_path.glob(pat))

        for p in candidates:
            if p.is_file() and p.suffix.lower() in (".jpg", ".jpeg", ".png", ".webp"):
                return p
        return None

    def _to_data_url(self, file_path: Path):
        """
        功能定位:
        - 将图片文件读取并编码为 data URL，供前端直接展示。

        输入输出:
        - 参数:
          - file_path: Path，图片文件路径。
        - 返回:
          - str，data:image/<ext>;base64,<data>；读取失败返回空字符串。
        - 外部资源/依赖: 文件系统读取、base64 编码

        实现逻辑:
        - 读取文件字节并 base64 编码，按扩展名推导 MIME 子类型。

        业务关联:
        - 上游: scan_sights。
        - 下游: 前端直接将 cover_url 作为 img src 使用。
        """
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
        """
        功能定位:
        - 打开当前设置的 UserSights 目录。

        输入输出:
        - 参数: 无
        - 返回: None
        - 外部资源/依赖: os.startfile（Windows）

        实现逻辑:
        - 若路径存在则调用 os.startfile 打开目录，否则抛出异常。

        业务关联:
        - 上游: 前端“打开 UserSights”按钮触发。
        - 下游: 便于用户手动查看与管理文件结构。
        """
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
        """
        功能定位:
        - 将炮镜 ZIP 解压导入到 UserSights，并根据压缩包结构决定目标目录命名策略。

        输入输出:
        - 参数:
          - zip_path: str | Path，炮镜 ZIP 文件路径（仅支持 .zip）。
          - progress_callback: Callable[[int, str], None] | None，进度回调。
          - overwrite: bool，目标目录已存在时是否覆盖。
        - 返回:
          - dict，包含 ok 与 target_dir（目标目录字符串）。
        - 外部资源/依赖:
          - 目录: UserSights（写入）
          - 临时目录: <UserSights>/.__tmp_extract__<zip_stem>（写入并清理）

        实现逻辑:
        - 1) 校验 UserSights 已设置且存在，校验 zip_path 合法。
        - 2) 在临时目录中逐文件解压成员，并限制成员扩展名不属于 blocked_ext。
        - 3) 校验解压目标路径必须位于临时目录内部，避免生成临时目录外的文件。
        - 4) 解压完成后统计临时目录顶层条目：
           - 若只有一个顶层目录，则使用该目录名作为最终目标目录名。
           - 否则使用 ZIP stem 作为最终目标目录名，并将顶层内容移动进去。
        - 5) 清理临时目录并清空缓存。

        业务关联:
        - 上游: 前端“导入炮镜”触发并调用后端 API。
        - 下游: 导入完成后前端刷新列表以展示新增炮镜。
        """
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
            """
            功能定位:
            - 判断目标路径是否位于指定基准目录内部（含目录自身）。

            输入输出:
            - 参数:
              - base_dir: Path，基准目录。
              - target: Path，目标路径。
            - 返回:
              - bool，位于基准目录内返回 True。
            - 外部资源/依赖: 路径解析

            实现逻辑:
            - resolve 后比较前缀关系。

            业务关联:
            - 上游: import_sights_zip 解压成员写入前调用。
            - 下游: 限制临时解压写入范围。
            """
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
