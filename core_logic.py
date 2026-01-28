# -*- coding: utf-8 -*-
"""
核心逻辑模块：游戏目录校验、自动定位、语音包安装与还原。

功能定位:
- 提供与 War Thunder 安装目录相关的核心操作，包括：校验游戏根目录、自动搜索路径、将语音包文件复制到 sound/mod、更新 config.blk 的 enable_mod 字段、还原纯净状态。

输入输出:
- 输入: 游戏路径字符串、语音包库目录路径、安装文件夹选择列表、前端进度回调。
- 输出: 校验/搜索结果（字符串或布尔状态）、通过日志回调输出执行过程信息。
- 外部资源/依赖:
  - 文件/目录: <game_root>/config.blk（读写）、<game_root>/config.blk.backup（写）、<game_root>/sound/mod（读写/清空）
  - 系统能力: Windows 注册表（SteamPath）、文件系统复制/删除、线程
  - 其他模块: ManifestManager（安装清单读写与冲突追踪）

实现逻辑:
- 1) 校验或定位 game_root。
- 2) 根据安装选择构建待复制文件清单并复制到 sound/mod。
- 3) 更新 config.blk 中 enable_mod 开关，必要时进行备份与回滚。
- 4) 还原时清空 sound/mod 子项并关闭 enable_mod，同时清空安装清单。

业务关联:
- 上游: 由 main.py 的桥接层 API 调用，触发来源为前端页面操作（路径选择、自动搜索、安装、还原）。
- 下游: 影响游戏目录中的 sound/mod 内容与 config.blk 开关，影响前端日志与进度展示。
"""
import os
import shutil
import threading
#import winreg
import re
import stat
from pathlib import Path
from datetime import datetime
from typing import List
import json

# 引入安装清单管理器
from manifest_manager import ManifestManager


class CoreService:
    """
    功能定位:
    - 封装对游戏安装目录的核心读写操作，作为后端桥接层的业务执行单元。

    输入输出:
    - 输入: 游戏路径（字符串）、语音包目录（Path）、安装选择（list[str]）、回调函数。
    - 输出: 通过返回值表达校验结果；通过 logger_callback 推送过程日志。
    - 外部资源/依赖: 文件系统、Windows 注册表、ManifestManager。

    实现逻辑:
    - 维护 game_root 与 manifest_mgr 状态。
    - 提供安装/还原等方法，内部统一使用 log() 输出过程信息。

    业务关联:
    - 上游: main.py 的 AppApi 调用。
    - 下游: 写入游戏目录与清单文件，供冲突检测与前端展示使用。
    """
    def __init__(self):
        self.game_root = None
        self.logger_callback = None
        # 安装清单管理器在 validate_game_path 校验通过后初始化
        self.manifest_mgr = None

    def validate_game_path(self, path_str):
        """
        功能定位:
        - 校验用户提供的游戏根目录是否为可操作的 War Thunder 安装目录。

        输入输出:
        - 参数:
          - path_str: str | None，候选游戏根目录路径字符串（来自配置或用户选择）。
        - 返回:
          - tuple[bool, str]，(是否通过校验, 失败原因或通过描述)。
        - 外部资源/依赖:
          - 文件: <path_str>/config.blk（存在性检查）
          - 其他模块: ManifestManager（初始化）

        实现逻辑:
        - 1) 检查 path_str 非空。
        - 2) 转换为 Path 并检查目录存在。
        - 3) 检查根目录下是否存在 config.blk。
        - 4) 设置 game_root，并初始化 manifest_mgr。

        业务关联:
        - 上游: 前端路径选择、自动搜索完成后写入配置前调用；安装/还原前调用。
        - 下游: 初始化清单管理器，使冲突检测与安装记录可用。
        """
        if not path_str: return False, "路径为空"
        path = Path(path_str)
        if not path.exists(): return False, "路径不存在"
        if not (path / "config.blk").exists(): return False, "缺少 config.blk"
        self.game_root = path
        # 初始化安装清单管理器（用于记录本次安装文件与冲突检测）
        self.manifest_mgr = ManifestManager(self.game_root)
        return True, "校验通过"

    def set_callbacks(self, log_cb):
        """
        功能定位:
        - 注册日志输出回调，用于把后端执行过程推送到调用方（通常是桥接层）。

        输入输出:
        - 参数:
          - log_cb: Callable[[str], None]，接收字符串日志的回调。
        - 返回: None
        - 外部资源/依赖: 无

        实现逻辑:
        - 保存回调引用，供 log() 调用。

        业务关联:
        - 上游: main.py 在初始化 CoreService 后设置。
        - 下游: install/restore/search 等方法的日志输出都会进入该回调。
        """
        self.logger_callback = log_cb

    def log(self, message, level="INFO"):
        """
        功能定位:
        - 统一生成带时间与级别前缀的日志行，并输出到控制台与回调。

        输入输出:
        - 参数:
          - message: str，日志正文。
          - level: str，日志级别标签（如 INFO/WARN/ERROR/SEARCH 等）。
        - 返回: None
        - 外部资源/依赖: 标准输出、logger_callback（若存在）。

        实现逻辑:
        - 1) 生成时间戳与级别前缀。
        - 2) print 输出到控制台。
        - 3) 若存在 logger_callback，转发完整日志行。

        业务关联:
        - 上游: 本类各方法调用。
        - 下游: 由 main.py 转发到前端日志面板与文件日志。
        """
        timestamp = datetime.now().strftime("%H:%M:%S")
        full_msg = f"[{timestamp}] [{level}] {message}"
        print(full_msg)
        if self.logger_callback:
            self.logger_callback(full_msg)

    def start_search_thread(self, callback):
        """
        功能定位:
        - 以后台线程执行 auto_detect_game_path，并在完成后回调返回结果。

        输入输出:
        - 参数:
          - callback: Callable[[str | None], None]，接收搜索到的路径字符串（或 None）。
        - 返回: None
        - 外部资源/依赖: threading

        实现逻辑:
        - 1) 在线程函数中调用 auto_detect_game_path 获取结果。
        - 2) 若 callback 存在则传入结果。
        - 3) 启动 daemon 线程，不阻塞调用方。

        业务关联:
        - 上游: bridge 层/前端触发自动搜索时可用。
        - 下游: 结果通常用于写入配置并刷新前端路径状态。
        """
        def run():
            path = self.auto_detect_game_path()
            if callback: callback(path)

        t = threading.Thread(target=run)
        t.daemon = True
        t.start()

    
    def get_windows_game_paths(self):
        import winreg
        """
        功能定位:
        - 在Windows主机上自动定位 War Thunder 安装目录。

        输入输出:
        - 参数: 无
        - 返回:
          - str | None，找到则返回游戏根目录路径字符串，否则返回 None。
        - 外部资源/依赖:
          - Windows 注册表: HKCU\\Software\\Valve\\Steam 的 SteamPath
          - 文件系统: 常见路径与盘符遍历

        实现逻辑:
        - 1) 尝试从 SteamPath 推导 steamapps/common/War Thunder 并校验。
        - 2) 若失败，遍历预设盘符与常见安装子路径并校验。
        - 3) 找到即返回，否则返回 None。

        业务关联:
        - 上游: 前端“自动搜索”触发。
        - 下游: 搜索结果用于调用 validate_game_path 并写入配置。
        """
        self.log("开始全盘搜索游戏路径...", "SEARCH")
        try:
            key = winreg.OpenKey(winreg.HKEY_CURRENT_USER, r"Software\Valve\Steam")
            steam_path_str, _ = winreg.QueryValueEx(key, "SteamPath")
            steam_path = Path(steam_path_str)
            potential_steam_paths = [steam_path / "steamapps" / "common" / "War Thunder"]
            for p in potential_steam_paths:
                if self._check_is_wt_dir(p):
                    self.log(f"通过注册表找到路径: {p}", "FOUND")
                    return str(p)
        except Exception:
            pass

        drives = [f"{c}:\\" for c in "CDEFGHIJK"]
        common_subdirs = [
            r"Program Files (x86)\Steam\steamapps\common\War Thunder",
            r"Program Files\Steam\steamapps\common\War Thunder",
            r"SteamLibrary\steamapps\common\War Thunder",
            r"Games\War Thunder",
            r"War Thunder"
        ]

        for drive in drives:
            if not os.path.exists(drive): continue
            for subdir in common_subdirs:
                full_path = Path(drive) / subdir
                if self._check_is_wt_dir(full_path):
                    self.log(f"全盘扫描找到路径: {full_path}", "FOUND")
                    return str(full_path)
        self.log("未自动找到游戏路径。", "FAIL")
        return None

    def get_linux_game_paths(self):
        """
        功能定位:
        - 在Linux主机上自动定位 War Thunder 安装目录。

        输入输出:
        - 参数: 无
        - 返回:
          - str | None，找到则返回游戏根目录路径字符串，否则返回 None。
        - 外部资源/依赖:
          - 标准 Steam 库路径（如 ～/.local/share/Steam/steamapps/common/War Thunder）
          - Flatpak 或其他常见安装位置（若适用）

        实现逻辑:
        - 1) 尝试从 steam_roots 获取 libraryfolders.vdf
        - 2) 从 libraryfolders.vdf 中读取战雷游戏路径
        - 3) 找到即返回，否则返回 None。

        业务关联:
        - 上游: 前端“自动搜索”触发。
        - 下游: 搜索结果用于调用 validate_game_path 并写入配置。
        """

        self.log("开始检索 Linux Steam 库...", "SEARCH")
        paths = set()
        
        # 1. 常见的 Steam 安装位置 (包括 Flatpak)
        steam_roots = [
            Path.home() / ".local/share/Steam",
            Path.home() / ".steam/steam",
            Path.home() / ".var/app/com.valvesoftware.Steam/.local/share/Steam",
        ]
        
        for root in [r for r in steam_roots if r.exists()]:
            paths.add(str(root)) # 添加根目录本身作为备选
            vdf_path = root / "config" / "libraryfolders.vdf"
            if vdf_path.exists():
                try:
                    with open(vdf_path, 'r', encoding='utf-8') as f:
                        content = f.read()
                        # 提取所有库路径
                        found = re.findall(r'"path"\s+"([^"]+)"', content)
                        paths.update(found)
                except Exception as e:
                    self.log(f"解析 VDF 失败: {e}", "WARN")

        # 2. 验证路径
        for base_path in paths:
            # Linux 下 Steam 默认文件夹名通常带空格
            full_path = Path(base_path) / "steamapps/common/War Thunder"
            if self._check_is_wt_dir(full_path):
                return str(full_path) # 找到第一个就返回
                
        return None

    def auto_detect_game_path(self):
        """
        功能定位:
        - 在本机上自动定位 War Thunder 安装目录(跨平台支持)。

        输入输出:
        - 参数: 无
        - 返回:
          - str | None，找到则返回游戏根目录路径字符串，否则返回 None。
       
        实现逻辑:
        - 1) 根据当前操作系统（Windows / Linux）分发至对应检测方法。
        - 2) 各平台分别尝试：
            - 从 Steam 安装路径推导 War Thunder 目录并校验；
            - 遍历预设的常见安装路径进行存在性检查。
        - 3) 任一平台方法一旦找到有效路径即返回；若均未找到，返回 None。

        业务关联:
        - 上游: 前端“自动搜索”触发。
        - 下游: 搜索结果用于调用 validate_game_path 并写入配置。
        """

        import sys
        if sys.platform == "win32":
            return self.get_windows_game_paths()
        elif sys.platform == "linux":
            return self.get_linux_game_paths()

    def _check_is_wt_dir(self, path):
        """
        功能定位:
        - 判定一个目录是否满足 War Thunder 根目录的最小特征。

        输入输出:
        - 参数:
          - path: str | Path，候选目录。
        - 返回:
          - bool，存在且包含 config.blk 时返回 True。
        - 外部资源/依赖: 文件系统

        实现逻辑:
        - 转换为 Path，检查目录存在且包含 config.blk。

        业务关联:
        - 上游: auto_detect_game_path 的候选路径校验。
        - 下游: 影响自动搜索结果。
        """
        path = Path(path)
        return path.exists() and (path / "config.blk").exists()

    def _is_safe_deletion_path(self, target_path):
        """
        功能定位:
        - 校验待删除路径是否位于 <game_root>/sound/mod 目录内部，避免越界删除。

        输入输出:
        - 参数:
          - target_path: str | Path，待删除目标路径。
        - 返回:
          - bool，目标位于 mod_dir 子路径且不是 mod_dir 本身时为 True。
        - 外部资源/依赖: 文件系统、self.game_root

        实现逻辑:
        - 1) resolve 得到绝对路径。
        - 2) 使用 commonpath 判断 target_path 是否在 mod_dir 下。
        - 3) 排除 mod_dir 本身，确保只删除子项。

        业务关联:
        - 上游: restore_game 清理 sound/mod 内容。
        - 下游: 限定删除范围，降低误删风险。
        """
        if not self.game_root:
            return False
        try:
            mod_dir = (self.game_root / "sound" / "mod").resolve()
            tp = Path(target_path).resolve()
            return os.path.commonpath([str(tp), str(mod_dir)]) == str(mod_dir) and str(tp) != str(mod_dir)
        except Exception:
            return False

    def _remove_path(self, path_obj):
        """
        功能定位:
        - 删除文件或目录（包含只读文件的处理），用于清理 sound/mod 下的子项。

        输入输出:
        - 参数:
          - path_obj: str | Path，目标路径。
        - 返回: None
        - 外部资源/依赖: 文件系统、stat（处理只读属性）

        实现逻辑:
        - 1) 若为文件/符号链接，优先 unlink；PermissionError 时尝试 chmod 可写后再删。
        - 2) 若为目录，使用 shutil.rmtree；onerror 回调中尝试 chmod 可写后重试。
        - 3) 删除失败时抛出异常给调用方处理。

        业务关联:
        - 上游: restore_game。
        - 下游: 实际移除游戏 mod 文件。
        """
        p = Path(path_obj)
        try:
            if p.is_file() or p.is_symlink():
                try:
                    p.unlink()
                    return
                except PermissionError:
                    try:
                        os.chmod(p, stat.S_IWRITE)
                    except Exception:
                        pass
                    p.unlink()
                    return
            if p.is_dir():
                def _onerror(func, path, exc_info):
                    try:
                        os.chmod(path, stat.S_IWRITE)
                    except Exception:
                        pass
                    func(path)

                shutil.rmtree(p, onerror=_onerror)
        except Exception as e:
            raise e

    def get_installed_mods(self) -> List[str]:
        try:
            with open(self.manifest_mgr.manifest_file, "r", encoding="utf-8") as f:
                _mods = json.loads(f.read())
                _installed_mods = _mods.get("installed_mods", {})
                if not _installed_mods:
                    return []
                else:
                    self.log(f"已读取 {len(_installed_mods)} 个mods", "INFO")
                    return [mod_id for mod_id in _installed_mods.keys()]
        except FileNotFoundError:
            self.log(f"读取已安装mods失败，文件不存在：{self.manifest_mgr.manifest_file}", "ERROR")
        except json.decoder.JSONDecodeError:
            self.log(f"读取已安装mods失败，文件解析错误：{self.manifest_mgr.manifest_file}", "ERROR")

    # --- 核心：安装逻辑 (V2.2 - 文件夹直拷) ---
    def install_from_library(self, source_mod_path, install_list=None, progress_callback=None):
        """
        功能定位:
        - 将语音包库中的文件复制到游戏目录 <game_root>/sound/mod，并更新 config.blk 以启用 mod。

        输入输出:
        - 参数:
          - source_mod_path: Path，语音包源目录（语音包库中某个 mod 文件夹）。
          - install_list: list[str] | None，待安装的相对文件夹列表；特殊值 "根目录" 表示直接使用 source_mod_path。
          - progress_callback: Callable[[int, str], None] | None，用于向调用方推送进度百分比与提示信息。
        - 返回: None
        - 外部资源/依赖:
          - 目录: <game_root>/sound/mod（创建/写入）
          - 文件: <game_root>/config.blk（写入 enable_mod）、.manifest.json（安装清单写入）

        实现逻辑:
        - 1) 校验 game_root 已设置。
        - 2) 确保 <game_root>/sound/mod 目录存在。
        - 3) 遍历 install_list，将待复制文件整理为 files_info（源文件、目标文件、来源文件夹标识）。
        - 4) 逐文件执行 copy2，并按节流策略更新 progress_callback。
        - 5) 将本次复制到的目标文件名列表写入安装清单。
        - 6) 调用 _update_config_blk 写入 enable_mod:b=yes。

        业务关联:
        - 上游: main.py 的安装 API 在用户确认安装后调用。
        - 下游: 影响游戏 sound/mod 内容与 config.blk 的 mod 开关，供前端展示与冲突检测使用。
        """
        import time
        try:
            self.log(f"准备安装: {source_mod_path.name}", "INSTALL")

            if progress_callback:
                progress_callback(5, f"准备安装: {source_mod_path.name}")

            if not self.game_root:
                raise Exception("未设置游戏路径")

            game_sound_dir = self.game_root / "sound"
            game_mod_dir = game_sound_dir / "mod"

            # 1. 确保目录存在 (不再删除旧文件)
            if not game_mod_dir.exists():
                game_mod_dir.mkdir(parents=True, exist_ok=True)
                self.log("创建 mod 文件夹...", "INIT")
            else:
                self.log("检测到 mod 文件夹，准备覆盖安装...", "MERGE")

            if progress_callback:
                progress_callback(10, "扫描待安装文件...")

            # 2. 复制文件
            self.log("正在复制选中文件夹的内容...", "COPY")

            if not install_list or len(install_list) == 0:
                self.log("未选择任何文件夹，跳过安装。", "WARN")
                if progress_callback:
                    progress_callback(100, "未选择文件")
                return

            # 首先统计总文件数，用于计算真实进度
            total_files_to_copy = 0
            files_info = []  # [(src_file, dest_file, folder_rel_path), ...]

            for folder_rel_path in install_list:
                src_dir = None
                if folder_rel_path == "根目录":
                    src_dir = source_mod_path
                else:
                    src_dir = source_mod_path / folder_rel_path

                if not src_dir.exists():
                    self.log(f"[WARN] 找不到源文件夹: {folder_rel_path}", "WARN")
                    continue

                for root, dirs, files in os.walk(src_dir):
                    for file in files:
                        src_file = Path(root) / file
                        dest_file = game_mod_dir / file
                        files_info.append((src_file, dest_file, folder_rel_path))
                        total_files_to_copy += 1

            if total_files_to_copy == 0:
                self.log("未找到任何可安装的文件。", "WARN")
                if progress_callback:
                    progress_callback(100, "没有文件")
                return

            if progress_callback:
                progress_callback(15, f"共 {total_files_to_copy} 个文件待安装")

            total_files = 0
            # 收集本次安装的目标文件名，用于写入安装清单
            installed_files_record = []
            folder_files_count = {}  # 用于统计每个文件夹的文件数

            # 进度计算：10% 预检，15-95% 复制文件，95-100% 更新配置
            copy_progress_start = 15
            copy_progress_end = 95
            last_progress_update = time.monotonic()

            for idx, (src_file, dest_file, folder_rel_path) in enumerate(files_info):
                try:
                    shutil.copy2(src_file, dest_file)
                    total_files += 1
                    installed_files_record.append(dest_file.name)

                    # 统计每个文件夹的文件数
                    if folder_rel_path not in folder_files_count:
                        folder_files_count[folder_rel_path] = 0
                    folder_files_count[folder_rel_path] += 1

                    # 更新进度 (限制更新频率，避免 UI 卡顿)
                    now = time.monotonic()
                    if progress_callback and (now - last_progress_update >= 0.1 or idx == len(files_info) - 1):
                        progress = copy_progress_start + (idx + 1) / total_files_to_copy * (
                                copy_progress_end - copy_progress_start)
                        # 文件名截断显示
                        fname = src_file.name
                        if len(fname) > 20:
                            fname = fname[:17] + "..."
                        progress_callback(int(progress), f"复制: {fname}")
                        last_progress_update = now

                except Exception as e:
                    self.log(f"  复制文件 {src_file.name} 失败: {e}", "WARN")

            # 输出每个文件夹的统计
            for folder_path, count in folder_files_count.items():
                self.log(f"[OK] 已合并导入 [{folder_path}] ({count} 个文件)", "INFO")

            # 写入安装清单记录（mod -> 文件名列表）
            if self.manifest_mgr and total_files > 0:
                try:
                    self.manifest_mgr.record_installation(source_mod_path.name, installed_files_record)
                    self.log("已更新安装清单记录", "INFO")
                except Exception as e:
                    self.log(f"更新清单失败: {e}", "WARN")

            if progress_callback:
                progress_callback(95, "更新游戏配置...")

            # 3. 更新配置
            self._update_config_blk()

            if progress_callback:
                progress_callback(100, "安装完成")

            self.log(f"[DONE] 安装完成！本次覆盖/新增 {total_files} 个文件。", "SUCCESS")

        except Exception as e:
            self.log(f"[ERROR] 安装过程严重错误: {e}", "ERROR")
            if progress_callback:
                progress_callback(100, "安装失败")
            # 不向上抛出异常；由日志与回调向调用方传达失败信息

    def restore_game(self):
        """
        功能定位:
        - 将游戏目录恢复为未加载语音包的状态：清空 sound/mod 下的子项，关闭 config.blk 的 enable_mod，并清空安装清单。

        输入输出:
        - 参数: 无
        - 返回: None
        - 外部资源/依赖:
          - 目录: <game_root>/sound/mod（遍历并删除子项）
          - 文件: <game_root>/config.blk（写入 enable_mod:b=no）、.manifest.json（删除或重置）

        实现逻辑:
        - 1) 校验 game_root 已设置。
        - 2) 遍历 mod_dir 的子项，对每个子项执行删除边界校验并删除。
        - 3) 清空安装清单记录。
        - 4) 调用 _disable_config_mod 将 enable_mod 置为 no。

        业务关联:
        - 上游: 前端“还原纯净”操作触发。
        - 下游: 影响游戏加载 mod 的开关与 mod 文件目录内容，供后续安装与冲突检测使用。
        """
        try:
            self.log("正在还原纯净模式...", "RESTORE")
            if not self.game_root: raise Exception("未设置游戏路径")

            mod_dir = self.game_root / "sound" / "mod"
            if mod_dir.exists():
                self.log("正在清空 mod 文件夹内容...", "CLEAN")
                # 遍历并删除文件夹内的所有内容，但不删除文件夹本身
                for item in mod_dir.iterdir():
                    try:
                        # 删除前进行边界校验，确保删除目标位于 sound/mod 目录内部
                        if not self._is_safe_deletion_path(item):
                            self.log(f"🚫 [安全拦截] 拒绝删除保护文件: {item}", "WARN")
                            continue

                        self._remove_path(item)
                    except Exception as e:
                        self.log(f"无法删除 {item.name}: {e}", "WARN")
            
            # 清空安装清单记录
            if self.manifest_mgr:
                self.manifest_mgr.clear_manifest()

            self._disable_config_mod()
            self.log("还原成功！所有 Mod 已清空，配置文件已重置。", "SUCCESS")
        except Exception as e:
            self.log(f"还原失败: {e}", "ERROR")

    def _update_config_blk(self):
        """
        功能定位:
        - 在 <game_root>/config.blk 中启用 enable_mod:b=yes；必要时创建备份并在失败时回滚。

        输入输出:
        - 参数: 无
        - 返回: None
        - 外部资源/依赖:
          - 文件: <game_root>/config.blk（读写）、<game_root>/config.blk.backup（写/读）

        实现逻辑:
        - 1) 生成备份路径并尽力复制备份文件。
        - 2) 读取 config.blk 全文，若已包含 enable_mod:b=yes 则直接返回。
        - 3) 若包含 enable_mod:b=no，替换为 yes；否则在 sound{ 块起始处插入 enable_mod:b=yes。
        - 4) 写回文件后重新读取校验；校验失败时使用备份回滚（若存在）。

        业务关联:
        - 上游: install_from_library 完成文件复制后调用。
        - 下游: 影响游戏是否加载 sound/mod 中的内容。
        """
        config = self.game_root / "config.blk"
        backup = self.game_root / "config.blk.backup"
        
        try:
            # 创建备份文件（用于写入失败或校验失败时回滚）
            if config.exists():
                try:
                    shutil.copy2(config, backup)
                    self.log("已创建配置文件备份", "INFO")
                except Exception as e:
                    self.log(f"创建备份失败 (将尝试继续): {e}", "WARN")

            with open(config, 'r', encoding='utf-8', errors='ignore') as f:
                content = f.read()
        except Exception as e:
            self.log(f"读取配置文件失败: {e}", "ERROR")
            return

        # 检查是否已经开启 enable_mod
        if "enable_mod:b=yes" in content:
            return

        new_content = content
        
        # 若存在 enable_mod:b=no，则替换为 enable_mod:b=yes
        if "enable_mod:b=no" in content:
            new_content = content.replace("enable_mod:b=no", "enable_mod:b=yes")
            self.log("检测到 Mod 被禁用，正在启用...", "INFO")
        
        # 若未出现 enable_mod 字段，则在 sound{...} 块起始处插入 enable_mod:b=yes
        else:
            # 匹配 sound { 或 sound{，不区分大小写
            pattern = re.compile(r'(sound\s*\{)', re.IGNORECASE)
            if pattern.search(content):
                # 在 sound{ 后面插入换行和 enable_mod:b=yes
                new_content = pattern.sub(r'\1\n  enable_mod:b=yes', content, count=1)
                self.log("添加 enable_mod 字段...", "INFO")
            else:
                self.log("[WARN] 未找到 sound{} 配置块，无法自动修改 config.blk", "WARN")
                return

        if new_content != content:
            try:
                with open(config, 'w', encoding='utf-8') as f:
                    f.write(new_content)
                self.log("配置文件已更新 (Config Updated)", "SUCCESS")
                
                # 写入后读取并校验结果
                with open(config, 'r', encoding='utf-8', errors='ignore') as f:
                    verify_content = f.read()
                if "enable_mod:b=yes" in verify_content:
                    self.log("验证成功：Mod 权限已激活 [OK]", "SUCCESS")
                else:
                    self.log("验证失败：虽然写入成功但未检测到激活项，请检查文件是否被只读或被锁定！", "ERROR")
                    # 校验失败时尝试回滚到备份内容
                    if backup.exists():
                        try:
                            shutil.copy2(backup, config)
                            self.log("已自动回滚配置文件", "WARN")
                        except Exception as restore_error:
                            self.log(f"回滚失败: {restore_error}", "ERROR")

            except Exception as e:
                self.log(f"写入配置文件失败: {e}", "ERROR")
                self.log("提示：请检查 config.blk 是否被设置为[只读]，或者游戏是否正在运行导致文件被占用。", "WARN")
                # 写入异常时尝试回滚到备份内容
                if backup.exists():
                    try:
                        shutil.copy2(backup, config)
                        self.log("已自动回滚配置文件", "WARN")
                    except Exception as restore_error:
                        self.log(f"回滚失败: {restore_error}", "ERROR")

    def _disable_config_mod(self):
        """
        功能定位:
        - 将 <game_root>/config.blk 中 enable_mod:b=yes 替换为 enable_mod:b=no。

        输入输出:
        - 参数: 无
        - 返回: None
        - 外部资源/依赖: 文件 <game_root>/config.blk（读写）

        实现逻辑:
        - 读取全文并执行字符串替换后写回。

        业务关联:
        - 上游: restore_game 调用。
        - 下游: 影响游戏是否加载 mod 内容。
        """
        config = self.game_root / "config.blk"
        try:
            with open(config, 'r', encoding='utf-8', errors='ignore') as f:
                content = f.read()
        except Exception as e:
            self.log(f"读取配置文件失败: {e}", "ERROR")
            return

        new_c = content.replace("enable_mod:b=yes", "enable_mod:b=no")
        try:
            with open(config, 'w', encoding='utf-8') as f:
                f.write(new_c)
            self.log("配置文件已还原", "INFO")
        except Exception as e:
            self.log(f"写入配置文件失败: {e}", "ERROR")
