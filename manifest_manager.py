# -*- coding: utf-8 -*-
"""
安装清单管理模块：记录语音包安装占用的文件名并提供冲突检测。

功能定位:
- 将“文件名 -> 所属语音包”与“语音包 -> 安装文件名列表”持久化到游戏目录，供安装前冲突检查与安装后记录使用。

输入输出:
- 输入: 游戏根目录、语音包名称、待安装文件名列表、已安装文件名列表。
- 输出: 冲突列表、清单文件写入结果（通过文件系统副作用体现）。
- 外部资源/依赖:
  - 文件: <game_root>/sound/mod/.manifest.json（读写/删除）

实现逻辑:
- 1) 初始化时加载 .manifest.json；读取失败时使用空清单结构。
- 2) 冲突检测使用 file_map 对文件名进行所有权查询。
- 3) 安装记录写入 installed_mods 与 file_map，并落盘保存。
- 4) 还原或卸载时按语音包维度移除记录或清空整个清单。

业务关联:
- 上游: core_logic.py 在安装/还原流程中调用；main.py 在安装前冲突检查中调用。
- 下游: 为安装流程提供冲突提示与历史记录基础数据。
"""

import json
import os
from pathlib import Path
from datetime import datetime

class ManifestManager:
    """
    功能定位:
    - 管理语音包安装清单文件，提供加载、保存、冲突检测与记录维护。

    输入输出:
    - 输入: game_root（游戏根目录）。
    - 输出: self.manifest（内存中的清单结构），以及对 .manifest.json 的读写。
    - 外部资源/依赖: <game_root>/sound/mod/.manifest.json。

    实现逻辑:
    - self.manifest 结构:
      - installed_mods: dict[str, {"files": list[str], "install_time": str}]
      - file_map: dict[str, str]，file_name -> mod_name

    业务关联:
    - 上游: 安装/还原流程创建并调用该对象。
    - 下游: 冲突检测与安装记录依赖该对象提供的数据。
    """
    
    def __init__(self, game_root):
        """
        功能定位:
        - 绑定游戏根目录并加载清单文件到内存。

        输入输出:
        - 参数:
          - game_root: str | Path，游戏根目录路径。
        - 返回: None
        - 外部资源/依赖:
          - 文件: <game_root>/sound/mod/.manifest.json（读取）

        实现逻辑:
        - 1) 规范化 game_root 为 Path。
        - 2) 生成 manifest_file 路径。
        - 3) 调用 _load_manifest 读取清单内容。

        业务关联:
        - 上游: core_logic.validate_game_path 校验通过后初始化。
        - 下游: 安装记录与冲突检测均使用本实例的 manifest。
        """
        self.game_root = Path(game_root)
        self.manifest_file = self.game_root / "sound" / "mod" / ".manifest.json"
        self.manifest = self._load_manifest()
    
    def _load_manifest(self):
        """
        功能定位:
        - 从 manifest_file 读取清单数据到内存。

        输入输出:
        - 参数: 无
        - 返回:
          - dict，清单数据结构；读取失败时返回空结构。
        - 外部资源/依赖:
          - 文件: self.manifest_file（读取）

        实现逻辑:
        - 1) 若文件存在则尝试 json.load。
        - 2) 读取或解析失败时返回空清单结构。

        业务关联:
        - 上游: __init__。
        - 下游: check_conflicts/record_installation/remove_mod_record 等方法使用该结构。
        """
        if self.manifest_file.exists():
            try:
                with open(self.manifest_file, 'r', encoding='utf-8') as f:
                    return json.load(f)
            except Exception:
                return {"installed_mods": {}, "file_map": {}}
        return {"installed_mods": {}, "file_map": {}}
    
    def _save_manifest(self):
        """
        功能定位:
        - 将内存中的 self.manifest 持久化写入 manifest_file。

        输入输出:
        - 参数: 无
        - 返回: None
        - 外部资源/依赖:
          - 目录: self.manifest_file.parent（必要时创建）
          - 文件: self.manifest_file（写入）

        实现逻辑:
        - 1) 确保父目录存在。
        - 2) 以 UTF-8 编码写入 JSON（缩进 2，保持中文可读）。

        业务关联:
        - 上游: record_installation/remove_mod_record/clear_manifest。
        - 下游: 为后续冲突检测与状态恢复提供落盘数据。
        """
        try:
            self.manifest_file.parent.mkdir(parents=True, exist_ok=True)
            with open(self.manifest_file, 'w', encoding='utf-8') as f:
                json.dump(self.manifest, f, indent=2, ensure_ascii=False)
        except Exception as e:
            print(f"无法保存清单文件: {e}")
    
    def check_conflicts(self, mod_name, files_to_install):
        """
        功能定位:
        - 对待安装文件名列表进行所有权查询，返回与当前安装目标不一致的占用记录。

        输入输出:
        - 参数:
          - mod_name: str，准备安装的语音包名称。
          - files_to_install: list[str]，准备写入到 sound/mod 的目标文件名列表。
        - 返回:
          - list[dict]，冲突信息列表；元素结构:
            - file: str，发生冲突的文件名
            - existing_mod: str，清单中记录的当前所有者语音包
            - new_mod: str，本次准备安装的语音包
        - 外部资源/依赖: self.manifest（内存结构）

        实现逻辑:
        - 1) 遍历 files_to_install。
        - 2) 若 file_name 存在于 file_map 且 existing_mod != mod_name，则记录为冲突。
        - 3) 返回冲突列表。

        业务关联:
        - 上游: main.py 在安装前调用以提示用户可能的覆盖关系。
        - 下游: 前端根据返回列表展示冲突明细并决定是否继续安装。
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
        return conflicts
    
    def record_installation(self, mod_name, installed_files):
        """
        功能定位:
        - 将某个语音包的安装结果写入清单（安装文件名列表与文件所有权映射）。

        输入输出:
        - 参数:
          - mod_name: str，语音包名称。
          - installed_files: list[str]，本次安装写入到 sound/mod 的目标文件名列表。
        - 返回: None
        - 外部资源/依赖:
          - 文件: self.manifest_file（写入）

        实现逻辑:
        - 1) 写入 installed_mods[mod_name]，包含 files 与 install_time。
        - 2) 将 installed_files 中每个 file_name 写入 file_map[file_name]=mod_name。
        - 3) 调用 _save_manifest 落盘保存。

        业务关联:
        - 上游: core_logic.install_from_library 在复制完成后调用。
        - 下游: 为后续冲突检测与还原清理提供依据。
        """
        self.manifest["installed_mods"][mod_name] = {
            "files": installed_files,
            "install_time": datetime.now().isoformat()
        }
        
        # 更新文件名所有权映射（file_name -> mod_name）
        for file_name in installed_files:
            self.manifest["file_map"][file_name] = mod_name
        
        self._save_manifest()
    
    def remove_mod_record(self, mod_name):
        """
        功能定位:
        - 按语音包维度移除清单记录，用于卸载或还原流程中的记录清理。

        输入输出:
        - 参数:
          - mod_name: str，目标语音包名称。
        - 返回: None
        - 外部资源/依赖:
          - 文件: self.manifest_file（写入）

        实现逻辑:
        - 1) 从 installed_mods 取出该语音包记录的 files 列表。
        - 2) 对每个 file_name，仅当 file_map[file_name] 仍等于 mod_name 时才删除映射。
        - 3) 删除 installed_mods[mod_name] 并落盘保存。

        业务关联:
        - 上游: 卸载语音包或还原纯净流程。
        - 下游: 避免冲突检测仍引用已移除语音包的记录。
        """
        if mod_name in self.manifest["installed_mods"]:
            files = self.manifest["installed_mods"][mod_name].get("files", [])
            
            # 仅在所有权仍指向当前语音包时，移除 file_map 映射
            for file_name in files:
                if self.manifest["file_map"].get(file_name) == mod_name:
                    del self.manifest["file_map"][file_name]
            
            del self.manifest["installed_mods"][mod_name]
            self._save_manifest()
            
    def clear_manifest(self):
        """
        功能定位:
        - 清空内存中的清单结构，并尝试删除清单文件。

        输入输出:
        - 参数: 无
        - 返回: None
        - 外部资源/依赖:
          - 文件: self.manifest_file（删除）

        实现逻辑:
        - 1) 重置 self.manifest 为初始空结构。
        - 2) 若 manifest_file 存在则尝试删除。

        业务关联:
        - 上游: core_logic.restore_game 还原纯净流程调用。
        - 下游: 后续安装将从空清单开始记录。
        """
        self.manifest = {"installed_mods": {}, "file_map": {}}
        if self.manifest_file.exists():
            try:
                self.manifest_file.unlink()
            except:
                pass
