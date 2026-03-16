# -*- coding: utf-8 -*-
"""
核心业务逻辑模组：提供与 War Thunder 安装目录相关的核心操作。

功能包括：
- 校验游戏根目录
- 自动搜索路径
- 将语音包文件複製到 sound/mod
- 更新 config.blk 的 enable_mod 字段
- 还原纯淨状态

错误处理策略:
- 所有 I/O 操作使用具体的异常类型
- 关键操作支援回滚
- 异常信息记录完整的上下文
"""
import os
import shutil
import threading
import sys
import platform
try:
    import winreg
except ImportError:
    winreg = None
import re
import stat
import json
import time
from pathlib import Path
from typing import List, Callable

# 引入安装清单管理器
from services.manifest_manager import ManifestManager
from utils.logger import get_logger

log = get_logger(__name__)


class CoreServiceError(Exception):
    """CoreService 相关错误的基类。"""
    pass


class GamePathError(CoreServiceError):
    """游戏路径相关错误。"""
    pass


class InstallError(CoreServiceError):
    """安装过程错误。"""
    pass


class ConfigUpdateError(CoreServiceError):
    """配置更新错误。"""
    pass

class CoreService:
    """
    核心服务类：管理 War Thunder 游戏目录的语音包操作。
    
    属性:
        game_root: 游戏根目录路径
        manifest_mgr: 安装清单管理器
    """
    
    def __init__(self):
        """初始化 CoreService 实例。"""
        self.game_root: Path | None = None
        # 安装清单管理器在 validate_game_path 校验通过后初始化
        self.manifest_mgr: ManifestManager | None = None

    def validate_game_path(self, path_str: str) -> tuple[bool, str]:
        """
        校验用户提供的游戏根目录是否为可操作的 War Thunder 安装目录。
        
        Args:
            path_str: 待校验的路径字符串
            
        Returns:
            tuple[bool, str]: (是否有效, 错误/成功讯息)
        """
        if not path_str:
            log.warning("游戏路径校验失败: 路径为空")
            return False, "路径为空"
        
        path = Path(path_str)
        
        if not path.exists():
            log.warning(f"游戏路径校验失败: 路径不存在 - {path}")
            return False, "路径不存在"
        
        if not path.is_dir():
            log.warning(f"游戏路径校验失败: 不是目录 - {path}")
            return False, "路径不是目录"
        
        valid_markers = ["config.blk", "beac_wt_mlauncher.exe", "gaijin_downloader.exe"]
        has_marker = any((path / marker).exists() for marker in valid_markers)
        if not has_marker:
            log.warning(f"游戏路径校验失败: 缺少有效标识文件 - {path}")
            return False, "缺少游戏标识文件"
        
        self.game_root = path
        # 初始化安装清单管理器（用于记录本次安装文件与冲突检测）
        # 只在第一次或游戏路径改变时重新初始化
        try:
            if self.manifest_mgr is None or self.manifest_mgr.game_root != self.game_root:
                log.info(f"[MANIFEST] 创建新的 ManifestManager 实例")
                self.manifest_mgr = ManifestManager(self.game_root)
                log.info("已初始化清单管理器")
            else:
                log.info(f"[MANIFEST] 重新加载清单数据（游戏路径未变）")
                # 重新加载清单以获取最新数据
                self.manifest_mgr.manifest = self.manifest_mgr._load_manifest()
                log.info("已重新加载清单数据")
            log.info(f"游戏路径校验成功: {path}")
        except Exception as e:
            log.error(f"初始化清单管理器失败: {e}")
            # 清单管理器失败不阻止继续操作
        
        return True, "校验通过"

    def start_search_thread(self, callback: Callable[[str | None], None]) -> None:
        """
        以后台线程执行 auto_detect_game_path，并在完成后回调返回结果。
        
        Args:
            callback: 搜索完成后的回调函数，参数为找到的路径或 None
        """
        def run():
            try:
                path = self.auto_detect_game_path()
                if callback:
                    callback(path)
            except Exception as e:
                log.error(f"自动搜索游戏路径线程异常: {e}")
                if callback:
                    callback(None)

        t = threading.Thread(target=run, name="GamePathSearch")
        t.daemon = True
        t.start()

    def get_windows_game_paths(self) -> str | None:
        """
        在本机上自动定位 War Thunder 安装目录。
        支持 Windows
        
        搜索顺序:
        1. 注册表 (仅 Windows)
        2. 常见默认路径
        3. 全盘/用户目录扫描
        
        Returns:
            找到的游戏路径，未找到则返回 None
        """

        system = platform.system()
        log.info(f"[SEARCH] 开始自动搜索游戏路径... (系统: {system})")
        
        # 1. Windows: 尝试从 Steam 注册表读取
        if winreg:
            try:
                key = winreg.OpenKey(winreg.HKEY_CURRENT_USER, r"Software\Valve\Steam")
                steam_path_str, _ = winreg.QueryValueEx(key, "SteamPath")
                winreg.CloseKey(key)
                
                steam_path = Path(steam_path_str)
                # 注册表记录的是 Steam 路径，拼接游戏路径
                p = steam_path / "steamapps" / "common" / "War Thunder"
                if self._check_is_wt_dir(p):
                    log.info(f"[FOUND] 通过注册表找到路径: {p}")
                    return str(p)
            except Exception as e:
                log.debug(f"读取 Steam 注册表失败/跳过: {e}")

        # 2. 检查各平台常见固定路径及多驱动器常见位置
        possible_paths = []
        home = Path.home()
        
        # 生成候选驱动器列表
        drives = [f"{c}:\\" for c in "CDEFGHIJK"]
        accessible_drives = [d for d in drives if os.path.exists(d)]
        
        # Windows 下常见的 War Thunder 路径模式
        common_patterns = [
            r"Program Files (x86)\Steam\steamapps\common\War Thunder",
            r"Program Files\Steam\steamapps\common\War Thunder",
            r"SteamLibrary\steamapps\common\War Thunder",
            r"Steam\steamapps\common\War Thunder",
            r"Games\War Thunder",
            r"WarThunder", # 无空格
            r"War Thunder"
        ]
        
        # 组合驱动器和模式
        for d in accessible_drives:
            for pattern in common_patterns:
                possible_paths.append(Path(d) / pattern)
        
        # 添加 LocalAppData (官方启动器默认安装位置)
        local_app_data = os.environ.get('LOCALAPPDATA')
        if local_app_data:
            possible_paths.append(Path(local_app_data) / "WarThunder")

        for p_str in possible_paths:
            path = Path(p_str)
            if self._check_is_wt_dir(path):
                log.info(f"[FOUND] 常见路径检测命中: {path}")
                return str(path)

        # 3. 广度扫描 (使用 re 匹配)
        log.info("[SEARCH] 进入广度扫描模式...")
        # 优化匹配模式：
        # - ^...$: 完整匹配文件夹名
        # - War 与 Thunder 之间允许：空白(\s)、下划线(_)、横线(-) 或什么都没有
        # - re.IGNORECASE: 忽略大小写
        wt_pattern = re.compile(r'^War[\s\-_]*Thunder$', re.IGNORECASE)
        
        search_roots = []
        exclude_dirs = set()

        drives = [f"{c}:\\" for c in "CDEFGHIJK"]
        search_roots = [d for d in drives if os.path.exists(d)]
        exclude_dirs = {
            "Windows", "ProgramData", "Recycle.Bin", "System Volume Information", 
            "Documents and Settings", "AppData"
        }

        for root_dir in search_roots:
            if not os.path.exists(root_dir):
                continue
            
            log.info(f"正在扫描目录: {root_dir}")
            try:
                for root, dirs, _ in os.walk(root_dir):
                    # 剪枝：移除不需要扫描的目录
                    # Windows 下排除以 $ 开头的系统隐藏目录
                    dirs[:] = [
                        d for d in dirs 
                        if d not in exclude_dirs 
                        and not d.startswith('$')
                    ]
                    
                    for d in dirs:
                        if wt_pattern.match(d):
                            full_path = Path(root) / d
                            # 二次确认是有效的游戏目录
                            if self._check_is_wt_dir(full_path):
                                log.info(f"[FOUND] 扫描找到路径: {full_path}")
                                return str(full_path)
            except Exception as e:
                log.debug(f"扫描目录 {root_dir} 异常: {e}")
                continue
        
        log.warning("[FAIL] 未自动找到游戏路径。")
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
        """

        log.info("[SEARCH] 开始检索 Linux Steam 库...")
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
                    log.warning(f"解析 VDF 失败: {e}")

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
        """

        if sys.platform == "win32":
            return self.get_windows_game_paths()
        elif sys.platform == "linux":
            return self.get_linux_game_paths()

    def _check_is_wt_dir(self, path: Path) -> bool:
        """
        判定一个目录是否满足 War Thunder 根目录的最小特徵。
        
        Args:
            path: 待检查的路径
            
        Returns:
            是否为有效的 WT 目录
        """
        try:
            path = Path(path)
            if not (path.exists() and path.is_dir()):
                return False
            valid_markers = ["config.blk", "beac_wt_mlauncher.exe", "gaijin_downloader.exe"]
            return any((path / marker).exists() for marker in valid_markers)
        except Exception:
            return False

    def _is_safe_deletion_path(self, target_path: Path) -> bool:
        """
        校验待删除路径是否位于 <game_root>/sound/mod 目录内部，避免越界删除。
        
        Args:
            target_path: 待检查的路径
            
        Returns:
            是否为安全的删除路径
        """
        if not self.game_root:
            return False
        try:
            mod_dir = (self.game_root / "sound" / "mod").resolve()
            tp = Path(target_path).resolve()
            common = os.path.commonpath([str(tp), str(mod_dir)])
            return common == str(mod_dir) and str(tp) != str(mod_dir)
        except ValueError:
            # commonpath 在路径不在同一驱动器时会抛出 ValueError
            return False
        except Exception as e:
            log.debug(f"路径安全检查异常: {e}")
            return False

    def _remove_path(self, path_obj: Path) -> None:
        """
        删除文件或目录（包含只读文件的处理），用于清理 sound/mod 下的子项。
        
        Args:
            path_obj: 待删除的路径
            
        Raises:
            PermissionError: 权限不足
            OSError: 其他文件系统错误
        """
        p = Path(path_obj)
        
        def _handle_readonly(func, path, exc_info):
            """处理只读文件的错误回调。"""
            try:
                os.chmod(path, stat.S_IWRITE)
                func(path)
            except Exception as e:
                log.warning(f"处理只读文件失败: {path} - {e}")
                raise
        
        try:
            if p.is_file() or p.is_symlink():
                try:
                    p.unlink()
                except PermissionError:
                    os.chmod(p, stat.S_IWRITE)
                    p.unlink()
            elif p.is_dir():
                shutil.rmtree(p, onerror=_handle_readonly)
        except Exception as e:
            log.error(f"删除路径失败: {p} - {type(e).__name__}: {e}")
            raise

    def get_installed_mods(self) -> List[str]:
        """
        获取已安装的 mod 列表（只返回有实际文件的语音包）。

        Returns:
            已安装的 mod ID 列表
        """
        if not self.manifest_mgr:
            log.debug("清单管理器未初始化，返回空列表")
            return []

        try:
            manifest_file = self.manifest_mgr.manifest_file
            if not manifest_file.exists():
                log.debug("[GET_INSTALLED] 清单文件不存在")
                return []

            with open(manifest_file, "r", encoding="utf-8") as f:
                _mods = json.load(f)

            _installed_mods = _mods.get("installed_mods", {})
            if not _installed_mods:
                log.debug("[GET_INSTALLED] 清单中没有已安装的 mods")
                return []

            # 只返回有实际文件的语音包
            mod_list = [
                mod_name for mod_name, mod_info in _installed_mods.items()
                if mod_info.get("files") and len(mod_info.get("files", [])) > 0
            ]

            return mod_list

        except FileNotFoundError:
            log.debug(f"清单文件不存在: {self.manifest_mgr.manifest_file}")
            return []
        except json.JSONDecodeError as e:
            log.error(f"读取已安装 mods 失败，文件解析错误: {e}")
            return []
        except Exception as e:
            log.error(f"读取已安装 mods 失败: {type(e).__name__}: {e}")
            return []

    # --- 核心：安装逻辑 (V2.2 - 文件夹直拷) ---
    def install_from_library(
        self, 
        source_mod_path: Path, 
        install_list: List[str] | None = None, 
        progress_callback: Callable[[int, str], None] | None = None
    ) -> bool:
        """
        将语音包库中的文件複製到游戏目录 <game_root>/sound/mod，并更新 config.blk 以启用 mod。
        
        Args:
            source_mod_path: 语音包源目录路径
            install_list: 待安装的文件夹相对路径列表
            progress_callback: 进度回调函数 (百分比, 讯息)
            
        Returns:
            是否安装成功
        """
        try:
            log.info(f"[INSTALL] 准备安装: {source_mod_path.name}")

            if progress_callback:
                progress_callback(5, f"准备安装: {source_mod_path.name}")

            if not self.game_root:
                raise GamePathError("未设置游戏路径")

            game_sound_dir = self.game_root / "sound"
            game_mod_dir = game_sound_dir / "mod"

            # 1. 确保目录存在 (不再删除旧文件)
            try:
                if not game_mod_dir.exists():
                    game_mod_dir.mkdir(parents=True, exist_ok=True)
                    log.info("[INIT] 创建 mod 文件夹...")
                else:
                    log.info("[MERGE] 检测到 mod 文件夹，准备覆盖安装...")
            except PermissionError as e:
                raise InstallError(f"无法创建 mod 目录（权限不足）: {e}")
            except OSError as e:
                raise InstallError(f"无法创建 mod 目录: {e}")

            if progress_callback:
                progress_callback(10, "扫描待安装文件...")

            # 2. 複製文件
            log.info("[COPY] 正在複製选中文件夹的内容...")

            if not install_list or len(install_list) == 0:
                log.warning("未选择任何文件夹，跳过安装。")
                if progress_callback:
                    progress_callback(100, "未选择文件")
                return False

            # 统计总文件数
            total_files_to_copy = len(install_list)

            if total_files_to_copy == 0:
                log.warning("未找到任何可安装的文件。")
                if progress_callback:
                    progress_callback(100, "没有文件")
                return False

            if progress_callback:
                progress_callback(15, f"共 {total_files_to_copy} 个文件待安装")

            total_files = 0
            failed_files = 0
            failed_list = []
            # 收集本次安装的目标文件名，用于写入安装清单
            installed_files_record = []

            # 进度计算：10% 预检，15-95% 複製文件，95-100% 更新配置
            copy_progress_start = 15
            copy_progress_end = 95
            last_progress_update = time.monotonic()

            for idx, file_rel_path in enumerate(install_list):
                try:
                    # 构建源文件和目标文件路径
                    src_file = source_mod_path / file_rel_path

                    # 目标文件只使用文件名，不保留目录结构
                    dest_file = game_mod_dir / Path(file_rel_path).name

                    if not src_file.exists():
                        log.warning(f"[WARN] 源文件不存在: {file_rel_path}")
                        continue
                    shutil.copy2(src_file, dest_file)
                    total_files += 1
                    installed_files_record.append(dest_file.name)

                    # 更新进度 (限制更新频率，避免 UI 卡顿)
                    now = time.monotonic()
                    if progress_callback and (now - last_progress_update >= 0.1 or idx == len(install_list) - 1):
                        progress = copy_progress_start + (idx + 1) / total_files_to_copy * (
                                copy_progress_end - copy_progress_start)
                        # 文件名截断显示
                        fname = src_file.name
                        if len(fname) > 20:
                            fname = fname[:17] + "..."
                        progress_callback(int(progress), f"複製: {fname}")
                        last_progress_update = now

                except PermissionError as e:
                    log.warning(f"複製文件 {src_file.name} 失败（权限不足）: {e}")
                    failed_files += 1
                    failed_list.append(src_file.name)
                except OSError as e:
                    log.warning(f"複製文件 {src_file.name} 失败: {e}")
                    failed_files += 1
                    failed_list.append(src_file.name)
                except Exception as e:
                    log.warning(f"複製文件 {src_file.name} 失败: {type(e).__name__}: {e}")
                    failed_files += 1
                    failed_list.append(src_file.name)

            log.info(f"已成功安装 {total_files} 个文件，失败 {failed_files} 个")

            if total_files == 0:
                log.error("所有文件复制均失败，安装未生效")
                if progress_callback:
                    progress_callback(100, "安装失败：无文件成功复制")
                return {"success": False, "total": 0, "failed": failed_files, "failed_list": failed_list}

            # 写入安装清单记录（mod -> 文件名列表）
            if self.manifest_mgr and total_files > 0:
                try:
                    self.manifest_mgr.record_installation(source_mod_path.name, installed_files_record)
                    log.info("已更新安装清单记录")
                except Exception as e:
                    log.warning(f"更新清单失败: {e}")

            if progress_callback:
                progress_callback(95, "更新游戏配置...")

            # 3. 更新配置
            self._update_config_blk()

            if progress_callback:
                progress_callback(100, "安装完成")

            log.info(f"[SUCCESS] [DONE] 安装完成！本次覆盖/新增 {total_files} 个文件。")
            return {"success": True, "total": total_files, "failed": failed_files, "failed_list": failed_list}

        except (GamePathError, InstallError) as e:
            log.error(f"安装过程错误: {e}")
            if progress_callback:
                progress_callback(100, "安装失败")
            return {"success": False, "total": 0, "failed": 0, "failed_list": [], "error": str(e)}
        except Exception as e:
            log.error(f"安装过程严重错误: {type(e).__name__}: {e}")
            log.exception("安装异常详情")
            if progress_callback:
                progress_callback(100, "安装失败")
            return {"success": False, "total": 0, "failed": 0, "failed_list": [], "error": str(e)}

    def uninstall_mod(self, mod_name: str) -> dict:
        """
        卸载指定语音包的已安装文件（从游戏目录删除，但保留库文件）。

        Args:
            mod_name: 语音包名称

        Returns:
            包含操作结果的字典
        """
        try:
            if not self.game_root:
                raise GamePathError("未设置游戏路径")

            if not self.manifest_mgr:
                raise InstallError("清单管理器未初始化")

            # 获取已安装的文件列表
            installed_files = self.manifest_mgr.get_installed_files(mod_name)
            if not installed_files:
                log.warning(f"语音包 {mod_name} 未安装或无安装记录")
                return {"success": False, "msg": "该语音包未安装", "removed": 0}

            mod_dir = self.game_root / "sound" / "mod"
            removed_count = 0
            failed_files = []

            log.info(f"[UNINSTALL] 开始卸载语音包: {mod_name}")

            # 删除已安装的文件
            for file_name in installed_files:
                file_path = mod_dir / file_name
                if file_path.exists():
                    try:
                        if not self._is_safe_deletion_path(file_path):
                            log.warning(f"🚫 [安全拦截] 拒绝删除保护文件: {file_path}")
                            failed_files.append(file_name)
                            continue

                        file_path.unlink()
                        removed_count += 1
                        log.debug(f"已删除: {file_name}")
                    except Exception as e:
                        log.warning(f"删除文件失败 {file_name}: {e}")
                        failed_files.append(file_name)

            # 清理安装记录
            self.manifest_mgr.remove_mod_record(mod_name)

            log.info(f"[SUCCESS] 卸载完成: {mod_name}，已删除 {removed_count} 个文件")

            return {
                "success": True,
                "msg": f"已卸载 {removed_count} 个文件",
                "removed": removed_count,
                "failed": failed_files
            }

        except (GamePathError, InstallError) as e:
            log.error(f"卸载失败: {e}")
            return {"success": False, "msg": str(e), "removed": 0}
        except Exception as e:
            log.error(f"卸载失败: {type(e).__name__}: {e}")
            log.exception("卸载异常详情")
            return {"success": False, "msg": f"卸载失败: {e}", "removed": 0}

    def uninstall_mod_modules(self, mod_name: str, module_patterns: list[str]) -> dict:
        """
        按模块卸载语音包的特定文件。

        Args:
            mod_name: 语音包名称
            module_patterns: 模块文件名模式列表，如 ["_crew_dialogs_ground_", "_tank_"]

        Returns:
            包含操作结果的字典
        """
        try:
            if not self.game_root:
                raise GamePathError("未设置游戏路径")

            if not self.manifest_mgr:
                raise InstallError("清单管理器未初始化")

            # 获取已安装的文件列表
            installed_files = self.manifest_mgr.get_installed_files(mod_name)
            if not installed_files:
                log.warning(f"语音包 {mod_name} 未安装或无安装记录")
                return {"success": False, "msg": "该语音包未安装", "removed": 0}

            mod_dir = self.game_root / "sound" / "mod"
            removed_count = 0
            failed_files = []
            remaining_files = []

            log.info(f"开始按模块卸载: {mod_name}, 模块: {module_patterns}")

            # 筛选需要删除的文件
            for file_name in installed_files:
                should_remove = False
                for pattern in module_patterns:
                    if pattern.lower() in file_name.lower():
                        should_remove = True
                        break

                if should_remove:
                    file_path = mod_dir / file_name
                    if file_path.exists():
                        try:
                            if not self._is_safe_deletion_path(file_path):
                                log.warning(f"🚫 [安全拦截] 拒绝删除保护文件: {file_path}")
                                failed_files.append(file_name)
                                remaining_files.append(file_name)
                                continue

                            file_path.unlink()
                            removed_count += 1
                            log.debug(f"已删除: {file_name}")
                        except Exception as e:
                            log.warning(f"删除文件失败 {file_name}: {e}")
                            failed_files.append(file_name)
                            remaining_files.append(file_name)
                    else:
                        log.debug(f"文件不存在，跳过: {file_name}")
                else:
                    remaining_files.append(file_name)

            # 更新安装记录
            if remaining_files:
                # 还有剩余文件，使用 update_mod_files 替换文件列表（不是合并）
                self.manifest_mgr.update_mod_files(mod_name, remaining_files)
                log.info(f"已更新安装记录，剩余 {len(remaining_files)} 个文件")
            else:
                # 所有文件都被删除，移除记录
                self.manifest_mgr.remove_mod_record(mod_name)
                log.info(f"所有文件已删除，已移除安装记录")

            log.info(f"[SUCCESS] 模块卸载完成: {mod_name}，已删除 {removed_count} 个文件")

            return {
                "success": True,
                "msg": f"已卸载 {removed_count} 个模块文件",
                "removed": removed_count,
                "remaining": len(remaining_files),
                "failed": failed_files
            }

        except (GamePathError, InstallError) as e:
            log.error(f"模块卸载失败: {e}")
            return {"success": False, "msg": str(e), "removed": 0}
        except Exception as e:
            log.error(f"模块卸载失败: {type(e).__name__}: {e}")
            log.exception("模块卸载异常详情")
            return {"success": False, "msg": f"模块卸载失败: {e}", "removed": 0}

    def restore_game(self) -> bool:
        """
        将游戏目录恢復为未加载语音包的状态。

        操作包括：
        - 清空 sound/mod 下的子项
        - 关闭 config.blk 的 enable_mod
        - 清空安装清单

        Returns:
            是否还原成功
        """
        try:
            log.info("[RESTORE] 正在还原纯淨模式...")
            
            if not self.game_root:
                raise GamePathError("未设置游戏路径")

            mod_dir = self.game_root / "sound" / "mod"
            
            if mod_dir.exists():
                log.info("[CLEAN] 正在清空 mod 文件夹内容...")
                # 遍历并删除文件夹内的所有内容，但不删除文件夹本身
                for item in mod_dir.iterdir():
                    try:
                        # 删除前进行边界校验，确保删除目标位于 sound/mod 目录内部
                        if not self._is_safe_deletion_path(item):
                            log.warning(f"🚫 [安全拦截] 拒绝删除保护文件: {item}")
                            continue

                        self._remove_path(item)
                    except PermissionError as e:
                        log.warning(f"无法删除 {item.name}（权限不足）: {e}")
                    except OSError as e:
                        log.warning(f"无法删除 {item.name}: {e}")
            
            # 清空安装清单记录
            if self.manifest_mgr:
                try:
                    self.manifest_mgr.clear_manifest()
                except Exception as e:
                    log.warning(f"清空清单失败: {e}")

            self._disable_config_mod()
            log.info("[SUCCESS] 还原成功！所有 Mod 已清空，配置文件已重置。")
            return True
            
        except GamePathError as e:
            log.error(f"还原失败: {e}")
            return False
        except Exception as e:
            log.error(f"还原失败: {type(e).__name__}: {e}")
            log.exception("还原异常详情")
            return False

    def _update_config_blk(self) -> bool:
        """
        在 <game_root>/config.blk 中启用 enable_mod:b=yes。
        
        必要时创建备份并在失败时回滚。
        
        Returns:
            是否更新成功
        """
        config = self.game_root / "config.blk"
        backup = self.game_root / "config.blk.backup"
        
        try:
            # 创建备份文件（用于写入失败或校验失败时回滚）
            if config.exists():
                try:
                    shutil.copy2(config, backup)
                    log.info("已创建配置文件备份")
                except PermissionError as e:
                    log.warning(f"创建备份失败（权限不足，将尝试继续）: {e}")
                except OSError as e:
                    log.warning(f"创建备份失败（将尝试继续）: {e}")

            with open(config, 'r', encoding='utf-8', errors='ignore') as f:
                content = f.read()
        except FileNotFoundError:
            log.error("配置文件不存在")
            return False
        except PermissionError as e:
            log.error(f"读取配置文件失败（权限不足）: {e}")
            return False
        except Exception as e:
            log.error(f"读取配置文件失败: {type(e).__name__}: {e}")
            return False

        # 检查是否已经开启 enable_mod
        if "enable_mod:b=yes" in content:
            log.info("Mod 权限已激活，无需更新")
            return True

        new_content = content
        
        # 若存在 enable_mod:b=no，则替换为 enable_mod:b=yes
        if "enable_mod:b=no" in content:
            new_content = content.replace("enable_mod:b=no", "enable_mod:b=yes")
            log.info("检测到 Mod 被禁用，正在启用...")
        
        # 若未出现 enable_mod 字段，则在 sound{...} 块起始处插入 enable_mod:b=yes
        else:
            # 匹配 sound { 或 sound{，不区分大小写
            pattern = re.compile(r'(sound\s*\{)', re.IGNORECASE)
            if pattern.search(content):
                # 在 sound{ 后面插入换行和 enable_mod:b=yes
                new_content = pattern.sub(r'\1\n  enable_mod:b=yes', content, count=1)
                log.info("添加 enable_mod 字段...")
            else:
                log.warning("未找到 sound{} 配置块，无法自动修改 config.blk")
                return False

        if new_content != content:
            try:
                with open(config, 'w', encoding='utf-8') as f:
                    f.write(new_content)
                log.info("[SUCCESS] 配置文件已更新 (Config Updated)")
                
                # 写入后读取并校验结果
                with open(config, 'r', encoding='utf-8', errors='ignore') as f:
                    verify_content = f.read()
                    
                if "enable_mod:b=yes" in verify_content:
                    log.info("[SUCCESS] 验证成功：Mod 权限已激活 [OK]")
                    return True
                else:
                    log.error("验证失败：虽然写入成功但未检测到激活项，请检查文件是否被只读或被锁定！")
                    # 校验失败时尝试回滚到备份内容
                    self._rollback_config(backup, config)
                    return False

            except PermissionError as e:
                log.error(f"写入配置文件失败（权限不足）: {e}")
                log.warning("提示：请检查 config.blk 是否被设置为[只读]，或者游戏是否正在运行导致文件被佔用。")
                self._rollback_config(backup, config)
                return False
            except OSError as e:
                log.error(f"写入配置文件失败: {e}")
                self._rollback_config(backup, config)
                return False
            except Exception as e:
                log.error(f"写入配置文件失败: {type(e).__name__}: {e}")
                self._rollback_config(backup, config)
                return False
        
        return True

    def _rollback_config(self, backup: Path, config: Path) -> None:
        """
        回滚配置文件到备份版本。
        
        Args:
            backup: 备份文件路径
            config: 配置文件路径
        """
        if backup.exists():
            try:
                shutil.copy2(backup, config)
                log.warning("已自动回滚配置文件")
            except Exception as restore_error:
                log.error(f"回滚失败: {restore_error}")

    def _disable_config_mod(self) -> bool:
        """
        将 <game_root>/config.blk 中 enable_mod:b=yes 替换为 enable_mod:b=no。
        
        Returns:
            是否禁用成功
        """
        config = self.game_root / "config.blk"
        
        try:
            with open(config, 'r', encoding='utf-8', errors='ignore') as f:
                content = f.read()
        except FileNotFoundError:
            log.error("配置文件不存在")
            return False
        except PermissionError as e:
            log.error(f"读取配置文件失败（权限不足）: {e}")
            return False
        except Exception as e:
            log.error(f"读取配置文件失败: {type(e).__name__}: {e}")
            return False

        new_c = content.replace("enable_mod:b=yes", "enable_mod:b=no")
        
        try:
            with open(config, 'w', encoding='utf-8') as f:
                f.write(new_c)
            log.info("配置文件已还原")
            return True
        except PermissionError as e:
            log.error(f"写入配置文件失败（权限不足）: {e}")
            return False
        except OSError as e:
            log.error(f"写入配置文件失败: {e}")
            return False
        except Exception as e:
            log.error(f"写入配置文件失败: {type(e).__name__}: {e}")
            return False
