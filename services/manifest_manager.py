# -*- coding: utf-8 -*-
"""
安装清单管理模组：持久化管理语音包安装记录。

功能包括：
- 维护「文件名 -> 所属语音包」映射
- 维护「语音包 -> 安装文件名列表」记录
- 提供安装前冲突检查能力
- 支援安装记录的添加与清理

数据存储于游戏目录的 sound/mod/.manifest.json
"""
import json
from pathlib import Path
from datetime import datetime
from typing import Any
from utils.logger import get_logger

log = get_logger(__name__)


class ManifestError(Exception):
    """清单相关错误的基类。"""
    pass


class ManifestLoadError(ManifestError):
    """清单加载失败。"""
    pass


class ManifestSaveError(ManifestError):
    """清单保存失败。"""
    pass


class ManifestManager:
    """
    管理语音包安装清单文件，提供加载、保存、冲突检测与记录维护。
    
    属性:
        game_root: 游戏根目录
        manifest_file: 清单文件路径
        manifest: 清单数据字典
    """
    
    # 清单数据结构模板
    EMPTY_MANIFEST = {"installed_mods": {}, "file_map": {}}
    
    def __init__(self, game_root: Path | str):
        """
        绑定游戏根目录并加载清单文件到内存。
        
        Args:
            game_root: 游戏根目录路径
        """
        self.game_root = Path(game_root)
        self.manifest_file = self.game_root / "sound" / "mod" / ".manifest.json"
        self.manifest = self._load_manifest()
        log.debug(f"清单管理器已初始化: {self.manifest_file}")
    
    def _load_manifest(self) -> dict[str, Any]:
        """
        从 manifest_file 读取清单数据到内存。

        Returns:
            清单数据字典
        """
        if not self.manifest_file.exists():
            log.debug("[MANIFEST] 清单文件不存在，使用空清单")
            return {"installed_mods": {}, "file_map": {}}

        try:
            with open(self.manifest_file, 'r', encoding='utf-8') as f:
                data = json.load(f)

            # 验证数据结构
            if not isinstance(data, dict):
                log.warning("[MANIFEST] 清单文件格式无效，使用空清单")
                return {"installed_mods": {}, "file_map": {}}

            # 确保必要的键存在
            if "installed_mods" not in data:
                data["installed_mods"] = {}
            if "file_map" not in data:
                data["file_map"] = {}

            return data

        except json.JSONDecodeError as e:
            log.error(f"[MANIFEST] 清单文件 JSON 解析失败: {e}")
            return {"installed_mods": {}, "file_map": {}}
        except PermissionError as e:
            log.error(f"[MANIFEST] 读取清单文件失败（权限不足）: {e}")
            return {"installed_mods": {}, "file_map": {}}
        except Exception as e:
            log.error(f"[MANIFEST] 读取清单文件失败: {type(e).__name__}: {e}")
            return {"installed_mods": {}, "file_map": {}}
    
    def _save_manifest(self) -> bool:
        """
        将内存中的 self.manifest 持久化写入 manifest_file。

        Returns:
            是否保存成功
        """
        try:
            # 确保目录存在
            self.manifest_file.parent.mkdir(parents=True, exist_ok=True)

            # 先写入临时文件
            temp_file = self.manifest_file.with_suffix('.tmp')
            with open(temp_file, 'w', encoding='utf-8') as f:
                json.dump(self.manifest, f, indent=2, ensure_ascii=False)

            # 重命名为正式文件（原子操作）
            temp_file.replace(self.manifest_file)
            return True

        except PermissionError as e:
            log.warning(f"无法保存清单文件（权限不足）: {e}")
            return False
        except OSError as e:
            log.warning(f"无法保存清单文件: {e}")
            return False
        except Exception as e:
            log.warning(f"无法保存清单文件: {type(e).__name__}: {e}")
            return False
    
    def check_conflicts(self, mod_name: str, files_to_install: list[str]) -> list[dict[str, str]]:
        """
        对待安装文件名列表进行所有权查询，返回与当前安装目标不一致的佔用记录。
        
        Args:
            mod_name: 待安装的语音包名称
            files_to_install: 待安装的文件名列表
            
        Returns:
            冲突记录列表，每项包含 file, existing_mod, new_mod
        """
        conflicts = []
        file_map = self.manifest.get("file_map", {})
        
        for file_name in files_to_install:
            if file_name in file_map:
                existing_mod = file_map[file_name]
                if existing_mod != mod_name:
                    conflicts.append({
                        "file": file_name,
                        "existing_mod": existing_mod,
                        "new_mod": mod_name
                    })
        
        if conflicts:
            log.info(f"检测到 {len(conflicts)} 个文件冲突")
        
        return conflicts
    
    def record_installation(self, mod_name: str, installed_files: list[str]) -> bool:
        """
        将某个语音包的安装结果写入清单（安装文件名列表与文件所有权映射）。
        如果该语音包已有记录，则追加新文件而不是覆盖。

        Args:
            mod_name: 语音包名称
            installed_files: 已安装的文件名列表

        Returns:
            是否记录成功
        """
        try:
            # 如果该语音包已有记录，追加新文件
            if mod_name in self.manifest["installed_mods"]:
                existing_files = set(self.manifest["installed_mods"][mod_name].get("files", []))
                new_files = set(installed_files)
                # 合并文件列表（去重）
                merged_files = list(existing_files | new_files)

                self.manifest["installed_mods"][mod_name] = {
                    "files": merged_files,
                    "install_time": datetime.now().isoformat()
                }
            else:
                # 新语音包，直接记录
                self.manifest["installed_mods"][mod_name] = {
                    "files": installed_files,
                    "install_time": datetime.now().isoformat()
                }

            # 更新文件名所有权映射（file_name -> mod_name）
            # 如果文件之前属于其他语音包，需要从旧语音包的记录中移除
            for file_name in installed_files:
                old_owner = self.manifest["file_map"].get(file_name)
                if old_owner and old_owner != mod_name:
                    # 文件被新语音包接管，从旧语音包的记录中移除
                    if old_owner in self.manifest["installed_mods"]:
                        old_files = self.manifest["installed_mods"][old_owner].get("files", [])
                        if file_name in old_files:
                            old_files.remove(file_name)
                            self.manifest["installed_mods"][old_owner]["files"] = old_files

                # 更新所有权
                self.manifest["file_map"][file_name] = mod_name

            success = self._save_manifest()
            if success:
                log.info(f"已记录安装: {mod_name} (总计 {len(self.manifest['installed_mods'][mod_name]['files'])} 个文件)")
            return success

        except Exception as e:
            log.error(f"记录安装失败: {type(e).__name__}: {e}")
            return False
    
    def remove_mod_record(self, mod_name: str) -> bool:
        """
        按语音包维度移除清单记录，用于卸载或还原流程中的记录清理。
        
        Args:
            mod_name: 语音包名称
            
        Returns:
            是否移除成功
        """
        if mod_name not in self.manifest["installed_mods"]:
            log.debug(f"语音包 {mod_name} 不在清单中")
            return True
        
        try:
            files = self.manifest["installed_mods"][mod_name].get("files", [])
            
            # 仅在所有权仍指向当前语音包时，移除 file_map 映射
            for file_name in files:
                if self.manifest["file_map"].get(file_name) == mod_name:
                    del self.manifest["file_map"][file_name]
            
            del self.manifest["installed_mods"][mod_name]
            
            success = self._save_manifest()
            if success:
                log.info(f"已移除安装记录: {mod_name}")
            return success
            
        except Exception as e:
            log.error(f"移除安装记录失败: {type(e).__name__}: {e}")
            return False
            
    def update_mod_files(self, mod_name: str, file_list: list[str]) -> bool:
        """
        直接替换指定语音包的文件列表（不是合并）。
        用于模块卸载等需要精确控制文件列表的场景。

        Args:
            mod_name: 语音包名称
            file_list: 新的文件列表

        Returns:
            是否更新成功
        """
        try:
            if mod_name not in self.manifest["installed_mods"]:
                log.warning(f"语音包 {mod_name} 不在清单中，无法更新")
                return False

            # 获取旧文件列表
            old_files = set(self.manifest["installed_mods"][mod_name].get("files", []))
            new_files = set(file_list)

            # 找出被移除的文件
            removed_files = old_files - new_files

            # 更新文件列表
            self.manifest["installed_mods"][mod_name]["files"] = file_list
            self.manifest["installed_mods"][mod_name]["install_time"] = datetime.now().isoformat()

            # 清理被移除文件的所有权映射
            for file_name in removed_files:
                if self.manifest["file_map"].get(file_name) == mod_name:
                    del self.manifest["file_map"][file_name]
                    log.debug(f"[MANIFEST] 已清理文件所有权: {file_name}")

            # 更新新文件的所有权映射
            for file_name in new_files:
                old_owner = self.manifest["file_map"].get(file_name)
                if old_owner and old_owner != mod_name:
                    # 文件被当前语音包接管，从旧语音包的记录中移除
                    if old_owner in self.manifest["installed_mods"]:
                        old_owner_files = self.manifest["installed_mods"][old_owner].get("files", [])
                        if file_name in old_owner_files:
                            old_owner_files.remove(file_name)
                            self.manifest["installed_mods"][old_owner]["files"] = old_owner_files

                self.manifest["file_map"][file_name] = mod_name

            success = self._save_manifest()
            if success:
                log.info(f"已更新文件列表: {mod_name} (现有 {len(file_list)} 个文件)")
            return success

        except Exception as e:
            log.error(f"更新文件列表失败: {type(e).__name__}: {e}")
            return False

    def get_installed_files(self, mod_name: str) -> list[str]:
        """
        获取指定语音包已安装的文件列表。

        Args:
            mod_name: 语音包名称

        Returns:
            已安装的文件名列表
        """
        if mod_name not in self.manifest["installed_mods"]:
            return []

        return self.manifest["installed_mods"][mod_name].get("files", [])

    def get_all_installed_mods(self) -> dict[str, dict]:
        """
        获取所有已安装的语音包信息。

        Returns:
            字典，键为语音包名称，值为安装信息（files, install_time）
        """
        return self.manifest.get("installed_mods", {}).copy()

    def clear_manifest(self) -> bool:
        """
        清空内存中的清单结构，并尝试删除清单文件。

        Returns:
            是否清空成功
        """
        self.manifest = {"installed_mods": {}, "file_map": {}}

        if self.manifest_file.exists():
            try:
                self.manifest_file.unlink()
                log.info("已删除清单文件")
                return True
            except PermissionError as e:
                log.warning(f"删除清单文件失败（权限不足）: {e}")
                return False
            except OSError as e:
                log.warning(f"删除清单文件失败: {e}")
                return False

        return True
