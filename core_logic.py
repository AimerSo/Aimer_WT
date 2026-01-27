# -*- coding: utf-8 -*-
# core_logic.py - 游戏交互核心 (V2.1 - 支持模块化安装)
import os
import shutil
import threading
#import winreg
import re
import stat
from pathlib import Path
from datetime import datetime

# [P2 修复] 引入清单管理器
from manifest_manager import ManifestManager

class CoreService:
    def __init__(self):
        self.game_root = None
        self.logger_callback = None
        # ManifestManager 将在 validate_game_path 成功后初始化
        self.manifest_mgr = None

    def validate_game_path(self, path_str):
        if not path_str: return False, "路径为空"
        path = Path(path_str)
        if not path.exists(): return False, "路径不存在"
        if not (path / "config.blk").exists(): return False, "缺少 config.blk"
        self.game_root = path
        # [P2 修复] 初始化清单管理器
        self.manifest_mgr = ManifestManager(self.game_root)
        return True, "校验通过"

    def set_callbacks(self, log_cb):
        self.logger_callback = log_cb

    def log(self, message, level="INFO"):
        timestamp = datetime.now().strftime("%H:%M:%S")
        full_msg = f"[{timestamp}] [{level}] {message}"
        print(full_msg)
        if self.logger_callback:
            self.logger_callback(full_msg)

    def start_search_thread(self, callback):
        def run():
            path = self.auto_detect_game_path()
            if callback: callback(path)
        t = threading.Thread(target=run)
        t.daemon = True
        t.start()

    
    def get_windows_game_paths(self):
        import winreg
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
        import sys
        if sys.platform == "win32":
            return self.get_windows_game_paths()
        elif sys.platform == "linux":
            return self.get_linux_game_paths()

    def _check_is_wt_dir(self, path):
        path = Path(path)
        return path.exists() and (path / "config.blk").exists()

    def _is_safe_deletion_path(self, target_path):
        if not self.game_root:
            return False
        try:
            mod_dir = (self.game_root / "sound" / "mod").resolve()
            tp = Path(target_path).resolve()
            return os.path.commonpath([str(tp), str(mod_dir)]) == str(mod_dir) and str(tp) != str(mod_dir)
        except Exception:
            return False
    
    def _remove_path(self, path_obj):
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

    # --- 核心：安装逻辑 (V2.2 - 文件夹直拷) ---
    def install_from_library(self, source_mod_path, install_list=None, progress_callback=None):
        """
        source_mod_path: 语音包源目录
        install_list: list of strings (即 script.js 传来的 folder paths)
        progress_callback: 进度回调函数 (progress, message)
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
            # [P2 修复] 收集本次安装的所有文件名，用于记录清单
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
                        progress = copy_progress_start + (idx + 1) / total_files_to_copy * (copy_progress_end - copy_progress_start)
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

            # [P2 修复] 更新清单记录
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
            # 不抛出异常，避免前端炸裂，已记录日志

    def restore_game(self):
        try:
            self.log("正在还原纯净模式...", "RESTORE")
            if not self.game_root: raise Exception("未设置游戏路径")
            
            mod_dir = self.game_root / "sound" / "mod"
            if mod_dir.exists():
                self.log("正在清空 mod 文件夹内容...", "CLEAN")
                # 遍历并删除文件夹内的所有内容，但不删除文件夹本身
                for item in mod_dir.iterdir():
                    try:
                        # [安全检查] 再次确认每个要删除的子项
                        if not self._is_safe_deletion_path(item):
                            self.log(f"🚫 [安全拦截] 拒绝删除保护文件: {item}", "WARN")
                            continue

                        self._remove_path(item)
                    except Exception as e:
                        self.log(f"无法删除 {item.name}: {e}", "WARN")
            
            # [P2 修复] 清空清单记录
            if self.manifest_mgr:
                self.manifest_mgr.clear_manifest()
                
            self._disable_config_mod()
            self.log("还原成功！所有 Mod 已清空，配置文件已重置。", "SUCCESS")
        except Exception as e:
            self.log(f"还原失败: {e}", "ERROR")

    def _update_config_blk(self):
        config = self.game_root / "config.blk"
        backup = self.game_root / "config.blk.backup" # [P1 修复] 备份文件路径
        
        try:
            # [P1 修复] 1. 创建备份
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

        # [修复] 使用正则更加智能地修改 config.blk
        # 1. 检查是否已经开启
        if "enable_mod:b=yes" in content:
            return

        new_content = content
        
        # 2. 如果是 enable_mod:b=no，直接替换为 yes
        if "enable_mod:b=no" in content:
            new_content = content.replace("enable_mod:b=no", "enable_mod:b=yes")
            self.log("检测到 Mod 被禁用，正在启用...", "INFO")
        
        # 3. 如果完全没有这个字段，则在 sound{ ... } 内部插入
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
                
                # [新增] 写入后二次检查验证
                with open(config, 'r', encoding='utf-8', errors='ignore') as f:
                    verify_content = f.read()
                if "enable_mod:b=yes" in verify_content:
                    self.log("验证成功：Mod 权限已激活 [OK]", "SUCCESS")
                else:
                    self.log("验证失败：虽然写入成功但未检测到激活项，请检查文件是否被只读或被锁定！", "ERROR")
                    # [P1 修复] 验证失败，尝试回滚
                    if backup.exists():
                        try:
                            shutil.copy2(backup, config)
                            self.log("已自动回滚配置文件", "WARN")
                        except Exception as restore_error:
                            self.log(f"回滚失败: {restore_error}", "ERROR")
                    
            except Exception as e:
                self.log(f"写入配置文件失败: {e}", "ERROR")
                self.log("提示：请检查 config.blk 是否被设置为[只读]，或者游戏是否正在运行导致文件被占用。", "WARN")
                # [P1 修复] 写入异常，尝试回滚
                if backup.exists():
                    try:
                        shutil.copy2(backup, config)
                        self.log("已自动回滚配置文件", "WARN")
                    except Exception as restore_error:
                        self.log(f"回滚失败: {restore_error}", "ERROR")

    def _disable_config_mod(self):
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
