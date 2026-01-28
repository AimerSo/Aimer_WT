# -*- coding: utf-8 -*-
"""
涂装资源管理模块：负责 UserSkins 的扫描、导入、重命名与封面处理。

功能定位:
- 扫描游戏目录下的 UserSkins 文件夹，生成前端展示所需的涂装列表数据。
- 将用户提供的涂装 ZIP 解压导入到 UserSkins，支持覆盖导入与进度回调。
- 提供涂装文件夹重命名与封面（preview.png）更新能力。

输入输出:
- 输入: 游戏根目录、涂装 ZIP 路径、封面图片路径或 base64 数据、重命名参数、回调函数。
- 输出: 涂装列表字典、导入结果字典、对 UserSkins 目录结构与 preview.png 的写入副作用。
- 外部资源/依赖:
  - 目录: <game_path>/UserSkins（读写）
  - 文件: 涂装目录内的纹理/配置文件与 preview.png（写入）
  - 系统能力: zipfile 解压、文件系统读写

实现逻辑:
- 1) 扫描时按文件夹遍历，统计文件数量/体积并选择封面图。
- 2) 导入时先校验 ZIP 内容扩展名，再解压到临时目录并整理为目标目录结构。
- 3) 通过缓存减少重复扫描，发生导入/重命名/封面更新后失效缓存。

业务关联:
- 上游: main.py 的桥接层 API 将该能力暴露给前端。
- 下游: 前端用于展示涂装列表、执行导入与管理操作。
"""
import base64
import os
import shutil
import zipfile
import base64
from pathlib import Path


class SkinsManager:
    """
    功能定位:
    - 面向 UserSkins 目录的资源管理器，封装扫描、导入与文件操作能力。

    输入输出:
    - 输入: 游戏根目录、ZIP 文件路径、封面数据、回调函数等。
    - 输出: 供前端渲染的数据结构与对文件系统的变更。
    - 外部资源/依赖: <game_path>/UserSkins。

    实现逻辑:
    - 使用 _cache 缓存上次扫描结果；force_refresh 或资源变更时清空缓存。

    业务关联:
    - 上游: main.py 调用。
    - 下游: 影响前端涂装页面展示与交互。
    """
    def __init__(self, log_callback=None):
        """
        功能定位:
        - 初始化涂装管理器并设置日志回调与缓存。

        输入输出:
        - 参数:
          - log_callback: Callable[[str, str], None] | None，日志回调（message, level）。
        - 返回: None
        - 外部资源/依赖: 无

        实现逻辑:
        - 若未提供 log_callback，则使用空函数作为默认实现。
        - 初始化扫描缓存为 None。

        业务关联:
        - 上游: main.py 创建管理器实例。
        - 下游: 扫描/导入过程会使用该回调输出日志（若提供）。
        """
        self._log = log_callback or (lambda *_args, **_kwargs: None)
        self._cache = None


    def get_userskins_dir(self, game_path: str | Path) -> Path:
        """
        功能定位:
        - 计算指定游戏目录下 UserSkins 的绝对路径。

        输入输出:
        - 参数:
          - game_path: str | Path，游戏根目录路径。
        - 返回:
          - Path，UserSkins 目录路径（不保证存在）。
        - 外部资源/依赖: 无

        实现逻辑:
        - 将 game_path 转为字符串后构造 Path，并拼接子目录 UserSkins。

        业务关联:
        - 上游: scan_userskins/import_skin_zip 等方法调用。
        - 下游: 用于确定扫描与写入的目标目录。
        """
        return Path(str(game_path)) / "UserSkins"

    def scan_userskins(self, game_path: str | Path, default_cover_path: Path | None = None, force_refresh: bool = False):
        """
        功能定位:
        - 扫描 UserSkins 目录下的涂装文件夹，并生成前端展示用的列表数据。

        输入输出:
        - 参数:
          - game_path: str | Path，游戏根目录路径。
          - default_cover_path: Path | None，默认封面图片路径（在未找到预览图时使用）。
          - force_refresh: bool，是否强制重新扫描（忽略缓存）。
        - 返回:
          - dict，包含：
            - exists: bool，UserSkins 是否存在
            - path: str，UserSkins 目录字符串
            - items: list[dict]，每个条目包含 name/path/size_bytes/file_count/cover_url/cover_is_default
        - 外部资源/依赖:
          - 目录: <game_path>/UserSkins（遍历）
          - 文件: 预览图（读取为 data URL）

        实现逻辑:
        - 1) 若命中缓存且路径未变化且仍存在，则直接返回缓存。
        - 2) 遍历 UserSkins 下的一级目录作为涂装条目。
        - 3) 对每个条目计算大小与文件数，选择预览图或默认封面并转为 data URL。
        - 4) 生成结果并写入缓存。

        业务关联:
        - 上游: 前端打开涂装页或刷新列表时调用。
        - 下游: 返回的数据用于前端卡片渲染与统计展示。
        """
        if not force_refresh and self._cache is not None:
             if self._cache.get("path") == str(self.get_userskins_dir(game_path)) and Path(self._cache["path"]).exists():
                 return self._cache

        userskins_dir = self.get_userskins_dir(game_path)
        if not userskins_dir.exists():
            return {"exists": False, "path": str(userskins_dir), "items": []}

        items = []
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

            items.append(
                {
                    "name": entry.name,
                    "path": str(entry),
                    "size_bytes": size_bytes,
                    "file_count": file_count,
                    "cover_url": cover_url,
                    "cover_is_default": cover_is_default,
                }
            )

        result = {"exists": True, "path": str(userskins_dir), "items": items, "valid": True}
        self._cache = result
        return result

    def import_skin_zip(
        self,
        zip_path: str | Path,
        game_path: str | Path,
        progress_callback=None,
        overwrite: bool = False,
    ):
        """
        功能定位:
        - 将涂装 ZIP 解压导入到 UserSkins，并整理为目标目录结构。

        输入输出:
        - 参数:
          - zip_path: str | Path，涂装 ZIP 文件路径（仅支持 .zip）。
          - game_path: str | Path，游戏根目录路径。
          - progress_callback: Callable[[int, str], None] | None，进度回调。
          - overwrite: bool，目标目录已存在时是否覆盖。
        - 返回:
          - dict，包含 ok 与 target_dir（目标目录字符串）。
        - 外部资源/依赖:
          - 目录: <game_path>/UserSkins（写入）
          - 文件: ZIP 内容写入到目标目录及 preview.png（可能由用户后续更新）

        实现逻辑:
        - 1) 校验 ZIP 文件存在与扩展名。
        - 2) 遍历 ZIP 成员，校验仅包含允许扩展名（.dds/.blk/.tga）。
        - 3) 创建临时解压目录并执行安全解压（含路径边界校验）。
        - 4) 将解压内容整理到目标目录：若只有一个顶层文件夹则合并其内容，否则保持多项结构。
        - 5) 清理临时目录，失效扫描缓存。

        业务关联:
        - 上游: 前端“导入涂装”触发并调用后端 API。
        - 下游: 导入完成后前端刷新列表以展示新增涂装。
        """
        zip_path = Path(zip_path)
        if not zip_path.exists() or zip_path.suffix.lower() != ".zip":
            raise ValueError("请选择有效的 .zip 文件")

        # 仅允许导入涂装相关文件扩展名
        ALLOWED_EXTENSIONS = {'.dds', '.blk', '.tga'}
        invalid_files = []
        
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
        userskins_dir.mkdir(parents=True, exist_ok=True)

        target_name = zip_path.stem
        target_dir = userskins_dir / target_name
        if target_dir.exists():
            if not overwrite:
                raise FileExistsError(f"已存在同名涂装文件夹: {target_name}")
            shutil.rmtree(target_dir)

        self._check_disk_space(zip_path, userskins_dir)

        tmp_dir = userskins_dir / f".__tmp_extract__{target_name}"
        if tmp_dir.exists():
            shutil.rmtree(tmp_dir)
        tmp_dir.mkdir(parents=True, exist_ok=True)

        try:
            if progress_callback:
                progress_callback(1, f"准备解压到 UserSkins: {zip_path.name}")

            self._extract_zip_safely(zip_path, tmp_dir, progress_callback=progress_callback, base_progress=2, share_progress=85)

            top_level = [p for p in tmp_dir.iterdir() if p.name not in ("__MACOSX",) and p.name != "desktop.ini"]
            if len(top_level) == 1 and top_level[0].is_dir():
                inner_dir = top_level[0]
                target_dir.mkdir(parents=True, exist_ok=True)
                self._move_tree(inner_dir, target_dir)
            else:
                target_dir.mkdir(parents=True, exist_ok=True)
                for child in top_level:
                    self._move_tree(child, target_dir / child.name)

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

    def rename_skin(self, game_path: str | Path, old_name: str, new_name: str):
        """
        功能定位:
        - 在 UserSkins 目录内安全重命名涂装文件夹。

        输入输出:
        - 参数:
          - game_path: str | Path，游戏根目录路径。
          - old_name: str，原文件夹名。
          - new_name: str，新文件夹名。
        - 返回:
          - bool，重命名成功返回 True。
        - 外部资源/依赖:
          - 目录: <game_path>/UserSkins（读写）

        实现逻辑:
        - 1) 校验源目录存在与新名称合法性（长度与非法字符）。
        - 2) 校验目标目录不存在。
        - 3) 执行重命名，并失效缓存。

        业务关联:
        - 上游: 前端涂装管理操作触发。
        - 下游: 前端刷新列表后展示新名称。
        """
        import re
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
            return True
        except OSError as e:
            raise OSError(f"重命名失败: {e}")

    def update_skin_cover(self, game_path: str | Path, skin_name: str, img_path: str):
        """
        功能定位:
        - 将指定图片复制为涂装目录的标准封面文件 preview.png。

        输入输出:
        - 参数:
          - game_path: str | Path，游戏根目录路径。
          - skin_name: str，涂装文件夹名。
          - img_path: str，源图片文件路径。
        - 返回:
          - bool，成功返回 True。
        - 外部资源/依赖:
          - 文件: <UserSkins>/<skin_name>/preview.png（写入）

        实现逻辑:
        - 校验涂装目录与源图片存在，将图片 copy2 到 preview.png，并失效缓存。

        业务关联:
        - 上游: 前端更换涂装封面操作触发。
        - 下游: 前端刷新列表后封面展示更新。
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
            return True
        except Exception as e:
            raise Exception(f"封面更新失败: {e}")

    def update_skin_cover_data(self, game_path: str | Path, skin_name: str, data_url: str):
        """
        功能定位:
        - 将前端传入的 base64 图片数据写入为 preview.png，作为涂装封面。

        输入输出:
        - 参数:
          - game_path: str | Path，游戏根目录路径。
          - skin_name: str，涂装文件夹名。
          - data_url: str，形如 data:image/<type>;base64,<data> 的字符串。
        - 返回:
          - bool，成功返回 True。
        - 外部资源/依赖:
          - 文件: <UserSkins>/<skin_name>/preview.png（写入）

        实现逻辑:
        - 1) 校验 data_url 格式并解码 base64。
        - 2) 写入 preview.png 并失效缓存。

        业务关联:
        - 上游: 前端裁剪/上传封面后调用。
        - 下游: 前端刷新列表后封面展示更新。
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
        except Exception as e:
            raise ValueError(f"图片数据解析失败: {e}")

        dst = skin_dir / "preview.png"
        try:
            with open(dst, "wb") as f:
                f.write(raw)
            self._cache = None
            return True
        except Exception as e:
            raise Exception(f"封面更新失败: {e}")


    def _get_dir_size_and_count(self, dir_path: Path):
        """
        功能定位:
        - 统计目录内所有文件的总大小与文件数量。

        输入输出:
        - 参数:
          - dir_path: Path，目标目录路径。
        - 返回:
          - tuple[int, int]，(总字节数, 文件数量)。
        - 外部资源/依赖: 文件系统遍历

        实现逻辑:
        - 使用 os.walk 递归遍历文件并累加大小与计数。

        业务关联:
        - 上游: scan_userskins。
        - 下游: 用于前端展示占用空间与文件数量。
        """
        total = 0
        count = 0
        for root, _dirs, files in os.walk(dir_path):
            for f in files:
                fp = Path(root) / f
                try:
                    total += fp.stat().st_size
                except Exception:
                    pass
                count += 1
        return total, count

    def _find_preview_image(self, dir_path: Path):
        """
        功能定位:
        - 在涂装目录中查找可用的预览图文件。

        输入输出:
        - 参数:
          - dir_path: Path，涂装目录路径。
        - 返回:
          - Path | None，找到则返回图片路径，否则为 None。
        - 外部资源/依赖: 文件系统 glob

        实现逻辑:
        - 按候选模式（preview/icon/常见图片扩展名）搜索并返回首个匹配文件。

        业务关联:
        - 上游: scan_userskins。
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
        - 上游: scan_userskins。
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

    def _check_disk_space(self, zip_path: Path, target_dir: Path):
        """
        功能定位:
        - 基于 ZIP 文件大小估算解压所需空间，并与目标盘剩余空间进行比较。

        输入输出:
        - 参数:
          - zip_path: Path，ZIP 文件路径。
          - target_dir: Path，目标目录（用于确定盘符）。
        - 返回: None（空间不足时抛出异常）
        - 外部资源/依赖: shutil.disk_usage

        实现逻辑:
        - 以压缩包大小估算解压后体积，并乘以安全系数作为 required。
        - 若 free < required 则抛出“磁盘空间不足”异常；其他异常写日志并继续。

        业务关联:
        - 上游: import_skin_zip。
        - 下游: 降低导入过程中磁盘空间不足导致的失败概率。
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
                raise Exception(f"磁盘空间不足 (可用 {free_mb:.0f}MB, 需要 {req_mb:.0f}MB)")
        except Exception as e:
            if "磁盘空间不足" in str(e):
                raise
            self._log(f"[WARN] 涂装解压磁盘空间检查失败（已跳过）: {e}", "WARN")

    def _extract_zip_safely(self, zip_path: Path, target_dir: Path, progress_callback=None, base_progress=0, share_progress=100):
        """
        功能定位:
        - 将 ZIP 内容解压到临时目录，并执行路径边界校验与进度回调更新。

        输入输出:
        - 参数:
          - zip_path: Path，ZIP 文件路径。
          - target_dir: Path，临时解压目录。
          - progress_callback: Callable[[int, str], None] | None，进度回调。
          - base_progress/share_progress: 进度区间参数。
        - 返回: None
        - 外部资源/依赖: zipfile、文件系统写入

        实现逻辑:
        - 1) 遍历成员列表并按节流策略更新 progress_callback。
        - 2) 对每个成员执行 resolve 后的“必须位于 target_root 内部”校验。
        - 3) 对文件成员按块写入到目标路径。

        业务关联:
        - 上游: import_skin_zip。
        - 下游: 生成临时目录结构，后续再整理到最终涂装目录。
        """
        import time

        target_root = Path(target_dir).resolve()
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
                    except Exception:
                        pass

            for idx, member in enumerate(file_list):
                if idx % 50 == 0:
                    time.sleep(0.001)

                try:
                    filename = member.filename.encode("cp437").decode("utf-8")
                except Exception:
                    try:
                        filename = member.filename.encode("cp437").decode("gbk")
                    except Exception:
                        filename = member.filename

                if "__MACOSX" in filename or "desktop.ini" in filename:
                    continue

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

                full_target_path = (target_dir / filename).resolve()
                try:
                    is_inside = os.path.commonpath([str(full_target_path), str(target_root)]) == str(target_root)
                except Exception:
                    is_inside = False
                if not is_inside:
                    self._log(f"[WARN] 拦截恶意路径穿越文件: {filename}", "WARN")
                    continue

                target_path = target_dir / filename
                if member.is_dir():
                    target_path.mkdir(parents=True, exist_ok=True)
                    continue

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

    def _move_tree(self, src: Path, dst: Path):
        """
        功能定位:
        - 将文件或目录从 src 移动到 dst，并在目标已存在时做合并式移动。

        输入输出:
        - 参数:
          - src: Path，源路径。
          - dst: Path，目标路径。
        - 返回: None
        - 外部资源/依赖: 文件系统移动与目录创建

        实现逻辑:
        - 若 src 为目录且 dst 已存在，则递归移动子项并尝试删除空目录。
        - 否则直接 shutil.move；对文件目标若存在则先删除后移动。

        业务关联:
        - 上游: import_skin_zip 在整理解压结果到目标目录时调用。
        - 下游: 决定最终涂装目录结构与文件合并方式。
        """
        if src.is_dir():
            if dst.exists():
                for child in src.iterdir():
                    self._move_tree(child, dst / child.name)
                try:
                    src.rmdir()
                except Exception:
                    pass
                return

            shutil.move(str(src), str(dst))
            return

        dst.parent.mkdir(parents=True, exist_ok=True)
        if dst.exists():
            try:
                dst.unlink()
            except Exception:
                pass
        shutil.move(str(src), str(dst))
