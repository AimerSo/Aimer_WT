# -*- coding: utf-8 -*-
"""
语音包库管理模块：负责语音包库目录结构、压缩包导入解压、元数据读取与标签推断。

功能定位:
- 管理两个工作目录：待解压区与语音包库。
- 将用户提供的 ZIP/RAR 导入并解压为语音包文件夹。
- 读取语音包元数据（info.json 及兼容形态），生成前端展示所需的数据结构。
- 基于 .bank 文件名规则推断语音包能力标签与可安装文件夹列表。

输入输出:
- 输入: 压缩包路径、语音包名称、回调函数、密码提供器、目标国家缩写等。
- 输出: 语音包列表、语音包详情字典、导入结果（通过目录与文件落盘体现）、日志回调输出。
- 外部资源/依赖:
  - 目录: WT待解压区、WT语音包库（均位于 APP_ROOT 下）
  - 文件: 语音包目录下的 info.json/cover.* 与各类 .bank 文件
  - 系统能力: 7-Zip 可执行文件（用于 rar 与部分 zip 解压）、文件系统读写、os.startfile

实现逻辑:
- 1) 初始化时计算 APP_ROOT，并确保待解压区与语音包库目录存在。
- 2) 导入时为每个压缩包创建目标目录并解压；若遇到加密压缩包，则通过 password_provider 获取密码重试。
- 3) 读取详情时合并作者元数据与基于文件规则推断的标签，并计算大小、封面与可安装文件夹列表。

业务关联:
- 上游: main.py 的桥接层调用该模块完成导入/扫描/详情读取。
- 下游: 输出的语音包详情被前端用于渲染语音包卡片、安装选择与标签展示。
"""
import os
import sys
import shutil
import subprocess
import zipfile
import json
import re
import platform
import subprocess
from collections import Counter
from pathlib import Path
from logger import get_logger

log = get_logger(__name__)

# 定义标准文件夹名称
DIR_PENDING = "WT待解压区"
DIR_LIBRARY = "WT语音包库"

class LibraryManager:
    def __init__(self):
        # 使用用户文档文件夹 Aimer_WT 作为根目录
        """
        功能定位:
        - 初始化语音包库管理器，确定工作目录并确保必要目录存在。

        输入输出:
        - 参数:
          - log_callback: Callable[[str, str], None]，日志回调（message, level）。
        - 返回: None
        - 外部资源/依赖:
          - 目录: WT待解压区、WT语音包库（创建）

        实现逻辑:
        - 1) 选择 root_dir（frozen: sys.executable 同级；非 frozen: 源码目录）。
        - 2) 拼接 pending_dir 与 library_dir。
        - 3) 调用 _ensure_dirs 创建目录。

        业务关联:
        - 上游: main.py 在启动时创建。
        - 下游: 导入、扫描、详情读取等方法依赖 pending_dir 与 library_dir。
        """
        self.root_dir = Path.home() / "Documents" / "Aimer_WT"
        
        # 也可以保留原逻辑作为备份，或者直接覆盖
        # if getattr(sys, 'frozen', False):
        #     application_path = Path(sys.executable).parent
        # else:
        #     application_path = Path(__file__).parent
            
        self.pending_dir = self.root_dir / DIR_PENDING
        self.library_dir = self.root_dir / DIR_LIBRARY
        
        self._ensure_dirs()

    def _load_json_with_fallback(self, file_path):
        """
        功能定位:
        - 按编码回退策略读取 JSON 文件并解析为 Python 对象。

        输入输出:
        - 参数:
          - file_path: str | Path，目标文件路径。
        - 返回:
          - dict | list | None，解析成功返回对象，失败返回 None。
        - 外部资源/依赖: 文件 file_path（读取）

        实现逻辑:
        - 依次尝试 encodings 列表中的编码读取并 json.load。

        业务关联:
        - 上游: get_mod_details。
        - 下游: 为元数据读取提供编码兼容。
        """
        encodings = ["utf-8-sig", "utf-8", "cp950", "big5", "gbk"]
        for enc in encodings:
            try:
                with open(file_path, "r", encoding=enc) as f:
                    return json.load(f)
            except Exception:
                continue
        return None

    def _ensure_dirs(self):
        """
        功能定位:
        - 确保待解压区与语音包库目录存在。

        输入输出:
        - 参数: 无
        - 返回: None
        - 外部资源/依赖: 文件系统（目录创建）

        实现逻辑:
        - 若目录不存在则创建，不做递归扫描或清理。

        业务关联:
        - 上游: __init__。
        - 下游: scan_pending/scan_library/unzip_* 等方法依赖目录存在。
        """
        if not self.pending_dir.exists():
            self.pending_dir.mkdir(parents=True)
        if not self.library_dir.exists():
            self.library_dir.mkdir(parents=True)

    def log(self, message, level="INFO"):
        tag = str(level or "INFO").upper()
        msg = str(message)

        # 统一前缀：避免重复叠加
        if tag != "INFO" and not msg.startswith(f"[{tag}]"):
            msg = f"[{tag}] {msg}"

        if tag in {"WARN", "WARNING"}:
            log.warning(msg)
        elif tag in {"ERROR"}:
            log.error(msg)
        else:
            # INFO / SUCCESS / UNZIP / ... 都走 INFO
            log.info(msg)

    def _open_folder_cross_platform(self, path):
        """Cross-platform folder opener"""
        try:
            path = str(path)
            if platform.system() == "Windows":
                os.startfile(path)
            elif platform.system() == "Darwin":  # macOS
                subprocess.Popen(["open", path])
            else:  # Linux
                subprocess.Popen(["xdg-open", path])
        except Exception as e:
            self.log(f"无法打开文件夹: {e}", "ERROR")

    def open_pending_folder(self):
        """
        功能定位:
        - 打开待解压区目录，供用户手动放入压缩包。

        输入输出:
        - 参数: 无
        - 返回: None
        - 外部资源/依赖: os.startfile（Windows）

        实现逻辑:
        - 调用 os.startfile 打开 pending_dir。

        业务关联:
        - 上游: 前端“打开待解压区”操作。
        - 下游: 用户在该目录放入 ZIP/RAR 后可触发导入流程。
        """
        self._open_folder_cross_platform(self.pending_dir)

    def open_library_folder(self):
        """
        功能定位:
        - 打开语音包库目录，供用户查看已导入的语音包文件夹。

        输入输出:
        - 参数: 无
        - 返回: None
        - 外部资源/依赖: os.startfile（Windows）

        实现逻辑:
        - 调用 os.startfile 打开 library_dir。

        业务关联:
        - 上游: 前端“打开语音包库”操作。
        - 下游: 用户可查看/手动管理语音包目录结构。
        """
        self._open_folder_cross_platform(self.library_dir)

    def scan_library(self):
        """
        功能定位:
        - 扫描语音包库目录下的语音包文件夹列表。

        输入输出:
        - 参数: 无
        - 返回: list[str]，语音包文件夹名列表。
        - 外部资源/依赖: self.library_dir（目录遍历）

        实现逻辑:
        - 遍历 library_dir 下的一级子项，收集其中的目录名称。

        业务关联:
        - 上游: main.py 获取语音包库列表时调用。
        - 下游: 前端根据返回值进一步读取每个语音包的详情并渲染列表。
        """
        mods = []
        if self.library_dir.exists():
            for item in self.library_dir.iterdir():
                if item.is_dir():
                    mods.append(item.name)
        return mods

    def scan_pending(self):
        """
        功能定位:
        - 扫描待解压区中的 ZIP/RAR 文件列表。

        输入输出:
        - 参数: 无
        - 返回: list[Path]，待处理压缩文件路径列表。
        - 外部资源/依赖: self.pending_dir（目录遍历）

        实现逻辑:
        - 遍历 pending_dir 下的一级子项，筛选扩展名为 .zip 或 .rar 的文件。

        业务关联:
        - 上游: unzip_zips_to_library 调用以获取待导入文件清单。
        - 下游: 作为批量导入的输入。
        """
        archives = []
        if self.pending_dir.exists():
            for item in self.pending_dir.iterdir():
                if item.suffix.lower() in (".zip", ".rar"):
                    archives.append(item)
        return archives

    def _normalize_wtlive_compat_files(self, mod_dir: Path):
        """
        功能定位:
        - 规范化语音包目录中的元数据与封面文件命名，生成工具可直接读取的 info.json 与 cover.png。

        输入输出:
        - 参数:
          - mod_dir: Path，语音包目录路径。
        - 返回: None
        - 外部资源/依赖:
          - 文件: <mod_dir>/info.json、<mod_dir>/cover.png（创建/移动）
          - 候选来源: info.bank、*AimerWT*.bank、cover.bank（位于根目录或 info 子目录）

        实现逻辑:
        - 1) 若 info.json 不存在，按候选列表查找可用 .bank 文件并移动为 info.json。
        - 2) 若 cover.(png/jpg/jpeg) 不存在，查找 cover.bank 并移动为 cover.png。

        业务关联:
        - 上游: 解压导入完成后调用；get_mod_details 读取元数据前调用。
        - 下游: 保证前端展示字段（标题/作者/封面等）可被统一读取。
        """
        try:
            mod_dir = Path(mod_dir)
            if not mod_dir.exists() or not mod_dir.is_dir():
                return

            info_dir = mod_dir / "info"

            info_json_path = mod_dir / "info.json"
            if not info_json_path.exists():
                info_sources = []
                for d in [mod_dir, info_dir]:
                    if not d.exists() or not d.is_dir():
                        continue

                    cand = d / "info.bank"
                    if cand.exists() and cand.is_file():
                        info_sources.append(cand)

                    try:
                        for f in d.iterdir():
                            if not f.is_file():
                                continue
                            if f.suffix.lower() != ".bank":
                                continue
                            if "aimerwt" in f.name.lower():
                                info_sources.append(f)
                    except Exception:
                        pass
                if not info_sources:
                    try:
                        for f in mod_dir.rglob("*.bank"):
                            if not f.is_file():
                                continue
                            if "aimerwt" in f.name.lower():
                                info_sources.append(f)
                                break
                    except Exception:
                        pass

                src = next((p for p in info_sources if p.exists()), None)
                if src:
                    try:
                        shutil.move(str(src), str(info_json_path))
                    except Exception:
                        pass

            cover_exists = any((mod_dir / f"cover{ext}").exists() for ext in [".png", ".jpg", ".jpeg"])
            if not cover_exists:
                cover_dst = mod_dir / "cover.png"
                cover_src = None
                for d in [mod_dir, info_dir]:
                    cand = d / "cover.bank"
                    if cand.exists() and cand.is_file():
                        cover_src = cand
                        break
                if cover_src is None:
                    try:
                        for f in mod_dir.rglob("cover.bank"):
                            if f.is_file():
                                cover_src = f
                                break
                    except Exception:
                        pass
                if cover_src and not cover_dst.exists():
                    try:
                        shutil.move(str(cover_src), str(cover_dst))
                    except Exception:
                        pass
        except Exception:
            return

    def get_mod_details(self, mod_name):
        """
        功能定位:
        - 读取语音包的元数据与资源信息，生成前端展示所需的详情字典。

        输入输出:
        - 参数:
          - mod_name: str，语音包目录名（位于 self.library_dir 下）。
        - 返回:
          - dict，语音包详情；包含标题/作者/版本/日期/链接/标签/语言/大小/封面路径/能力映射/可安装文件夹列表等字段。
        - 外部资源/依赖:
          - 目录: <library_dir>/<mod_name>
          - 文件: info.json（及兼容形态）、cover.*、目录下的 .bank 文件

        实现逻辑:
        - 1) 对语音包目录执行命名规范化（info.json、cover.png）。
        - 2) 构造默认详情结构，并按候选优先级读取元数据文件覆盖默认值。
        - 3) 基于文件名规则推断 tags，并与作者 tags 合并去重；语言字段仅来自作者元数据，缺失则标记为“未识别”。
        - 4) 将 tags 映射为 capabilities，计算目录大小，扫描封面与可安装文件夹列表。

        业务关联:
        - 上游: main.py 获取语音包列表时逐项调用。
        - 下游: 前端使用返回字段渲染卡片、标签与安装选择界面。
        """
        import time
        mod_dir = self.library_dir / mod_name
        info_file = mod_dir / "info.json"
        self._normalize_wtlive_compat_files(mod_dir)
        
        # 1. 默认数据
        # 尝试获取文件夹修改时间作为默认日期
        try:
            mtime = os.path.getmtime(mod_dir)
            default_date = time.strftime("%Y-%m-%d", time.localtime(mtime))
        except:
            default_date = "2026-01-07"

        details = {
            "title": mod_name,
            "author": "未知作者",
            "version": "1.0",
            "date": default_date,
            "note": "无详细介绍",
            "link_bilibili": "",
            "link_wtlive": "",
            "link_video": "",
            "tags": [],      # 存储标签列表 ["tank", "radio"]
            "language": [],  # 存储语言列表 ["中", "美"]
            "size_str": "0 MB",
            "cover_path": None,
            "capabilities": {} # 兼容前端旧逻辑
        }

        # 2. 读取 info.json (支持 WTLive 伪装格式)
        # 逻辑: info.json > info/info.json > *（AimerWT）.bank > info/*（AimerWT）.bank
        info_candidates = []
        
        # (1) 标准 info.json
        info_candidates.append(mod_dir / "info.json")
        info_candidates.append(mod_dir / "info" / "info.json")
        
        # (2) 伪装的 .bank 文件 (检测 （AimerWT） 字样)
        try:
            info_candidates.extend(list(mod_dir.glob("*（AimerWT）.bank")))
            info_candidates.extend(list(mod_dir.glob("*(AimerWT).bank")))
            if (mod_dir / "info").exists():
                info_candidates.extend(list((mod_dir / "info").glob("*（AimerWT）.bank")))
                info_candidates.extend(list((mod_dir / "info").glob("*(AimerWT).bank")))
        except Exception as e:
            print(f"Glob 搜索出错: {e}")

        found_info_file = None
        for cand in info_candidates:
            if cand and cand.exists():
                found_info_file = cand
                break
        if not found_info_file:
            try:
                info_jsons = [p for p in mod_dir.rglob("info.json") if p.is_file()]
                info_jsons.sort(key=lambda p: len(p.parts))
                if info_jsons:
                    found_info_file = info_jsons[0]
                else:
                    aimer_banks = [p for p in mod_dir.rglob("*.bank") if p.is_file() and "aimerwt" in p.name.lower()]
                    aimer_banks.sort(key=lambda p: len(p.parts))
                    if aimer_banks:
                        found_info_file = aimer_banks[0]
            except Exception:
                pass
        
        if found_info_file:
            try:
                data = self._load_json_with_fallback(found_info_file)
                if isinstance(data, dict):
                    for key in ["title", "author", "version", "date", "note", "link_bilibili", "link_wtlive", "link_video", "tags", "language"]:
                        if key in data:
                            details[key] = data[key]
                else:
                    print(f"读取 info 文件失败 ({found_info_file.name})")
            except Exception as e:
                log.warning(f"读取 info.json 失败: {e}")

        # 基于文件规则推断 tags（仅推断功能标签；language 不进行推断）
        detected_tags = self._detect_smart_tags(mod_dir)
        if detected_tags:
            combined_tags = []
            for t in list(details["tags"]) + list(detected_tags):
                if t not in combined_tags:
                    combined_tags.append(t)
            details["tags"] = combined_tags
            
        # 如果作者没写语言，则显示"未识别"
        if not details["language"]:
            details["language"] = ["未识别"]

        # 将 tags 映射为前端使用的 capabilities 键
        cap_map = {
            "tank": "tank", "陆战": "tank", "ground": "tank",
            "air": "air", "空战": "air", "aircraft": "air",
            "naval": "naval", "海战": "naval",
            "radio": "radio", "无线电": "radio", "无线电/局势": "radio",
            "status": "status", "局势播报": "radio",
            "missile": "missile", "导弹音效": "missile",
            "music": "music", "音乐包": "music",
            "noise": "noise", "降噪包": "noise",
            "pilot": "pilot", "飞行员语音": "pilot"
        }
        for t in details["tags"]:
            if t in cap_map:
                details["capabilities"][cap_map[t]] = True
            elif t in ["tank", "air", "naval", "radio", "status", "missile", "music", "noise", "pilot"]:
                 details["capabilities"][t] = True

        # 5. 计算大小
        details["size_str"] = self._get_dir_size_str(mod_dir)

        # 检测封面文件（包含对 cover.bank 的兼容处理）
        potential_cover_banks = [
            mod_dir / "cover.bank",
            mod_dir / "info" / "cover.bank"
        ]
        
        for bank_path in potential_cover_banks:
            if bank_path.exists():
                # 将 cover.bank 统一为 cover.png 以便前端按固定文件名读取
                new_path = bank_path.with_suffix(".png")
                try:
                    bank_path.rename(new_path)
                    print(f"[AutoFix] 已将 {bank_path.name} 恢复为 {new_path.name}")
                except Exception as e:
                    print(f"重命名封面失败: {e}")

        # 扫描封面 (支持根目录和 info 子目录)
        search_dirs = [mod_dir, mod_dir / "info"]
        found_cover = False
        
        for d in search_dirs:
            if found_cover: break
            if not d.exists(): continue
            
            for img_ext in [".png", ".jpg", ".jpeg"]:
                img_path = d / f"cover{img_ext}"
                if img_path.exists():
                    details["cover_path"] = str(img_path)
                    found_cover = True
                    break
        
        # 7. 文件夹详情
        details["folders"] = self._detect_mod_folders(mod_dir)
        
        # 对特定语音包名称提供固定展示字段，用于界面展示数据覆盖
        if mod_name == "Aimer":
            details.update({
                "author": "Aimer",
                "size_str": "520 MB",
                "version": "v2.53",
                "note": "这是一个用于测试 UI 布局的专用模组。它包含了超长的文字介绍来测试省略号功能是否正常，鼠标悬停时应该能看到完整内容。同时它点亮了所有图标以检测布局美感。",
                "link_bilibili": "https://www.bilibili.com",
                "link_wtlive": "https://live.warthunder.com",
                "link_video": "https://www.youtube.com",
                "folders": ["陆战语音", "空战语音", "超长文件夹名称测试", "海战", "无线电"],
                "language": ["中", "美", "俄"],
                "capabilities": {"tank": True, "air": True, "naval": True, "radio": True}
            })
        
        return details

    def _detect_smart_tags(self, mod_dir):
        """
        功能定位:
        - 基于语音包目录内 .bank 文件的命名规则推断功能标签（tags）。

        输入输出:
        - 参数:
          - mod_dir: Path，语音包目录路径。
        - 返回:
          - list[str]，推断得到的标签列表（去重后转为列表）。
        - 外部资源/依赖:
          - 文件: <mod_dir>/**/*.bank（目录递归扫描）

        实现逻辑:
        - 1) 遍历 mod_dir 下的所有 .bank 文件并统一为小写文件名。
        - 2) 按规则匹配文件名并加入对应标签：
           - 陆战: _crew_dialogs_ground_<code>.assets.bank 或 crew_dialogs_ground.assets.bank
           - 无线电/局势: _crew_dialogs_common_<code>.assets.bank 或 crew_dialogs_common.assets.bank
           - 空战: aircraft_gui.assets.bank（仅此文件名触发）
           - 导弹音效: aircraft_common.assets.bank / aircraft_effects.assets.bank / aircraft_guns.assets.bank / aircraft_guns.bank
           - 音乐包: 文件名包含 aircraft_music
           - 其他: 依据固定名单标记 noise/pilot 等标签

        业务关联:
        - 上游: get_mod_details 在作者 tags 缺失或不完整时调用以补充展示标签。
        - 下游: tags 映射为 capabilities，影响前端卡片图标与筛选展示。
        """
        detected_tags = set()
        
        try:
            # 遍历所有 .bank 文件
            for f in mod_dir.rglob("*.bank"):
                if not f.is_file(): continue
                name = f.name.lower()
                if name in [
                    "crew_dialogs_common.assets.bank",
                    "crew_dialogs_common.bank",
                    "crew_dialogs_ground.assets.bank",
                    "crew_dialogs_ground.bank",
                    "crew_dialogs_naval.assets.bank",
                    "crew_dialogs_naval.bank",
                    "masterbank.assets.bank",
                    "masterbank.bank"
                ]:
                    detected_tags.add("noise")
                if re.match(r'dialogs_chat_[a-z0-9]+\.bank$', name):
                    detected_tags.add("pilot")
                
                # 1. 陆战
                # 匹配: _crew_dialogs_ground_cn.assets.bank
                m_ground = re.match(r'(_)?crew_dialogs_ground_([a-z0-9]+)\.assets\.bank', name)
                if m_ground:
                    detected_tags.add("tank")
                    continue
                # 兼容无后缀
                if "crew_dialogs_ground.assets.bank" in name:
                    detected_tags.add("tank")
                    continue
                    
                # 2. 无线电/局势 (合并原来的无线电和局势播报)
                m_radio = re.match(r'(_)?crew_dialogs_common_([a-z0-9]+)\.assets\.bank', name)
                if m_radio:
                    detected_tags.add("radio")
                    continue
                if "crew_dialogs_common.assets.bank" in name:
                    detected_tags.add("radio")
                    continue
                    
                # 3. 空战 (仅检测 aircraft_gui.assets.bank)
                if name == "aircraft_gui.assets.bank":
                    detected_tags.add("air")
                    continue
                
                # 4. 导弹音效 (检测多个文件)
                if name in ["aircraft_common.assets.bank", "aircraft_effects.assets.bank", 
                           "aircraft_guns.assets.bank", "aircraft_guns.bank"]:
                    detected_tags.add("missile")
                    continue
                
                # 5. 音乐包 (检测带有 aircraft_music 字样的文件)
                if "aircraft_music" in name:
                    detected_tags.add("music")
                    continue
                    
        except Exception as e:
            log.warning(f"智能检测出错: {e}")
            
        return list(detected_tags)

    def _map_lang_code(self, code):
        """映射语言代码到 UI 显示字符"""
        mapping = {
            "zh": "中", "cn": "中", "chs": "中",
            "en": "美", "us": "美", "uk": "美",
            "ru": "俄",
            "de": "德",
            "jp": "日", "ja": "日",
            "fr": "法",
            "it": "意",
            "se": "瑞",
            "il": "以"
        }
        return mapping.get(code, code.upper())


    def _detect_mod_folders(self, mod_dir):
        """
        递归扫描 .bank 文件，返回它们所在的上一级文件夹名称（相对路径）
        去除重复，并按名称排序
        """
        folders_map = {}
        try:
            # 查找所有 .bank 文件 (不区分大小写，但 glob 通常区分，所以写两次或用正则)
            # Windows 下 glob 通常不区分大小写，但为了保险
            all_files = list(mod_dir.rglob("*.bank")) + list(mod_dir.rglob("*.BANK"))
            
            for f in all_files:
                if f.is_file():
                    parent = f.parent
                    try:
                        # 获取相对于 mod_dir 的路径
                        rel_path = parent.relative_to(mod_dir)
                        path_str = str(rel_path).replace("\\", "/") # 统一使用正斜杠
                        
                        if path_str not in folders_map:
                            folder_type = self._determine_folder_type(parent)
                            folders_map[path_str] = {
                                "path": path_str if path_str != "." else "根目录",
                                "type": folder_type,
                                "label": path_str if path_str != "." else "根目录"
                            }
                    except ValueError:
                        continue
        except Exception as e:
            log.warning(f"扫描文件夹出错: {e}")
        
        return sorted(list(folders_map.values()), key=lambda x: x["path"])

    def _determine_folder_type(self, folder_path):
        """
        根据文件夹内的文件名判断文件夹类型
        优先级: 陆战 > 无线电 > 空战 > 默认
        """
        try:
            # 获取文件夹下所有文件名
            filenames = [f.name for f in folder_path.iterdir() if f.is_file()]
            
            # 1. 陆战语音: _crew_dialogs_ground_<国家缩写>.assets.bank
            # 兼容: crew_dialogs_ground.assets.bank (无前缀/后缀)
            for name in filenames:
                if re.match(r'(_)?crew_dialogs_ground.*\.assets\.bank', name, re.IGNORECASE):
                    return "ground"
            
            # 2. 无线电语音: _crew_dialogs_common_<国家缩写>.assets.bank
            # 兼容: crew_dialogs_common.assets.bank
            for name in filenames:
                if re.match(r'(_)?crew_dialogs_common.*\.assets\.bank', name, re.IGNORECASE):
                    return "radio"
            
            # 3. 空战音效: aircraft_guns.assets.bank 或 aircraft_gui.assets.bank
            for name in filenames:
                if re.match(r'aircraft_guns\.assets\.bank', name, re.IGNORECASE) or \
                   re.match(r'aircraft_gui\.assets\.bank', name, re.IGNORECASE):
                    return "aircraft"
            
            return "folder"
            
        except Exception:
            return "folder"

    def _detect_mod_capabilities(self, mod_dir):
        """[已废弃] 旧的检测逻辑"""
        return {}

    def _get_dir_size_str(self, path):
        """计算文件夹大小并格式化（优化版本）"""
        total_size = 0
        try:
            # 优化：限制遍历深度和文件数量，避免大目录卡死
            file_count = 0
            max_files = 5000  # 最多统计5000个文件
            max_depth = 10    # 最多遍历10层深度
            
            for dirpath, dirnames, filenames in os.walk(path):
                # 检查深度
                rel_path = os.path.relpath(dirpath, path)
                depth = rel_path.count(os.sep) if rel_path != '.' else 0
                if depth > max_depth:
                    continue
                
                for f in filenames:
                    if file_count >= max_files:
                        # 达到上限，返回估算值
                        mb_size = total_size / (1024 * 1024)
                        return f"~{int(mb_size)} MB+"
                    
                    fp = os.path.join(dirpath, f)
                    if not os.path.islink(fp):
                        try:
                            total_size += os.path.getsize(fp)
                        except:
                            pass
                    file_count += 1
        except Exception as e:
            log.warning(f"计算目录大小失败: {e}")
            return "未知"
        
        mb_size = total_size / (1024 * 1024)
        if mb_size < 1:
            return "<1 MB"
        return f"{int(mb_size)} MB"

    def _detect_mod_capabilities(self, mod_dir):
        """
        功能定位:
        - 兼容旧版接口签名的占位实现。

        输入输出:
        - 参数:
          - mod_dir: Path，语音包目录路径（未使用）。
        - 返回:
          - dict，空字典。
        - 外部资源/依赖: 无

        实现逻辑:
        - 返回空结构以保持调用方兼容。

        业务关联:
        - 上游: 可能存在的旧调用路径。
        - 下游: 不参与当前能力推断逻辑。
        """
        return {}

    def _is_safe_path(self, path, base_dir):
        """
        功能定位:
        - 校验路径是否位于指定基准目录内，用于限制删除/移动等文件操作的作用范围。

        输入输出:
        - 参数:
          - path: str | Path，目标路径。
          - base_dir: str | Path，允许操作的基准目录。
        - 返回:
          - bool，位于基准目录内且不命中受保护目录时返回 True。
        - 外部资源/依赖: 文件系统路径解析

        实现逻辑:
        - 1) resolve 得到绝对路径并统一为字符串。
        - 2) 对部分受保护路径进行直接拒绝（如系统目录与根目录）。
        - 3) 若目标位于 C: 盘，要求必须位于 base_dir 内。
        - 4) 对所有盘符执行“是否以 base_dir 为前缀”的包含关系判断。

        业务关联:
        - 上游: 用于文件操作前的边界校验。
        - 下游: 降低对非预期目录执行删除/覆盖的风险。
        """
        try:
            abs_path = Path(path).resolve()
            abs_base = Path(base_dir).resolve()
            path_str = str(abs_path).lower()

            # 1. 绝对禁止删除系统根目录或关键系统目录
            forbidden_roots = [
                "c:\\", "c:/", "c:\\windows", "c:\\program files", "c:\\program files (x86)", "c:\\users",
                "/", "/bin", "/boot", "/dev", "/etc", "/home", "/lib", "/lib64", "/media", "/mnt", "/opt",
                "/proc", "/root", "/run", "/sbin", "/srv", "/sys", "/tmp", "/usr", "/var"
            ]
            if path_str in forbidden_roots:
                return False

            # 2. 如果路径在 C 盘(Windows)，必须在 base_dir 白名单内
            if platform.system() == "Windows" and abs_path.drive.lower() == "c:":
                if not str(abs_path).startswith(str(abs_base)):
                    return False
            
            # 3. Linux/Mac 基础保护 (不允许操作 / 根目录)
            if platform.system() != "Windows":
                 if str(abs_path) == "/":
                     return False

            # 4. 基础检查：是否在 base_dir 内部
            # 兼容大小写不敏感系统(Windows/macOS) 和 敏感系统(Linux)
            if platform.system() == "Windows":
                 return str(abs_path).lower().startswith(str(abs_base).lower())
            else:
                 return str(abs_path).startswith(str(abs_base))
        except:
            return False

    def _find_7z(self):
        return (
            shutil.which("7z")
            or shutil.which("7z.exe")
            or shutil.which("7za")
            or shutil.which("7za.exe")
            or shutil.which("7zr")
            or shutil.which("7zr.exe")
        )

    def _run_7z(self, args):
        result = subprocess.run(
            args,
            capture_output=True,
            text=True,
            errors="ignore",
        )
        output = (result.stdout or "") + "\n" + (result.stderr or "")
        return result.returncode, output

    def _extract_with_7z(self, archive_path, target_dir, progress_callback=None, base_progress=0, share_progress=100, password=None):
        seven_zip = self._find_7z()
        if not seven_zip:
            raise Exception("未检测到 7z 解压组件，请安装 7-Zip 后重试")

        if progress_callback:
            try:
                progress_callback(int(base_progress), f"开始解压: {Path(archive_path).name}")
            except Exception:
                pass

        password_arg = f"-p{password or ''}"
        args = [
            seven_zip,
            "x",
            "-y",
            password_arg,
            f"-o{str(target_dir)}",
            str(archive_path),
        ]
        code, output = self._run_7z(args)
        if code != 0:
            lower = output.lower()
            if "password" in lower or "wrong password" in lower or "incorrect" in lower or "encrypted" in lower:
                if password:
                    raise ArchivePasswordIncorrect("密码错误")
                raise ArchivePasswordRequired("需要密码")
            raise Exception(output.strip() or "解压失败")

        if progress_callback:
            try:
                progress_callback(int(base_progress + share_progress), f"解压完成: {Path(archive_path).name}")
            except Exception:
                pass

    def _extract_archive_with_password(self, archive_path, target_dir, progress_callback=None, base_progress=0, share_progress=100, password_provider=None):
        password = None
        while True:
            try:
                if archive_path.suffix.lower() == ".zip":
                    try:
                        self._extract_zip_safely(archive_path, target_dir, progress_callback, base_progress, share_progress, password=password)
                    except (NotImplementedError, RuntimeError) as e:
                        msg = str(e).lower()
                        if "compression method is not supported" in msg:
                            self._extract_with_7z(archive_path, target_dir, progress_callback, base_progress, share_progress, password=password)
                        else:
                            raise
                elif archive_path.suffix.lower() == ".rar":
                    self._extract_with_7z(archive_path, target_dir, progress_callback, base_progress, share_progress, password=password)
                else:
                    raise Exception("不支持的压缩格式")
                return
            except ArchivePasswordRequired:
                if not password_provider:
                    raise
                password = password_provider(archive_path, "required")
                if password is None:
                    raise ArchivePasswordCanceled("用户取消输入密码")
            except ArchivePasswordIncorrect:
                try:
                    self.log("密码错误，请重试", "WARN")
                except Exception:
                    pass
                if not password_provider:
                    raise
                password = password_provider(archive_path, "incorrect")
                if password is None:
                    raise ArchivePasswordCanceled("用户取消输入密码")

    def unzip_single_zip(self, zip_path, progress_callback=None, password_provider=None):
        """
        功能定位:
        - 将单个 ZIP/RAR 压缩包解压导入到语音包库目录（以压缩包文件名作为语音包目录名）。

        输入输出:
        - 参数:
          - zip_path: str | Path，压缩包路径（.zip/.rar）。
          - progress_callback: Callable[[int, str], None] | None，进度回调。
          - password_provider: Callable[[Path, str], str | None] | None，密码提供器；reason 取值 required/incorrect。
        - 返回: None
        - 外部资源/依赖:
          - 目录: self.library_dir（写入目标语音包目录）
          - 系统能力: zipfile 或 7z 可执行文件

        实现逻辑:
        - 1) 校验文件存在且扩展名合法。
        - 2) 执行磁盘空间估算与校验（不足时抛出异常）。
        - 3) 目标目录已存在则跳过导入。
        - 4) 创建目标目录并调用 _extract_archive_with_password 解压。
        - 5) 解压完成后执行命名规范化（info.json、cover.png）。

        业务关联:
        - 上游: main.py 的“导入选中压缩包”流程。
        - 下游: 新增语音包目录会被 scan_library/get_mod_details 识别并展示。
        """
        zip_path = Path(zip_path)

        if not zip_path.exists():
            self.log(f"文件不存在: {zip_path}", "ERROR")
            return
        if zip_path.suffix.lower() not in (".zip", ".rar"):
            raise ValueError("请选择有效的 .zip 或 .rar 文件")

        # 磁盘空间估算与校验
        try:
            zip_size = os.path.getsize(zip_path)
            # 估算解压后大小 (通常是压缩包的 2-3 倍，这里保守估计 3 倍)
            estimated_size = zip_size * 3
            # 需要至少 2 倍的估算空间作为安全余量 (解压过程可能产生临时文件)
            required_space = estimated_size * 2
            
            target_drive = Path(self.library_dir).anchor # 获取盘符 (如 C:\)
            if not target_drive: target_drive = self.library_dir
            
            import shutil
            total, used, free = shutil.disk_usage(target_drive)
            
            if free < required_space:
                free_mb = free / (1024 * 1024)
                required_mb = required_space / (1024 * 1024)
                self.log(f"磁盘空间不足! 可用: {free_mb:.0f}MB, 需要: {required_mb:.0f}MB", "ERROR")
                raise Exception(f"磁盘空间不足 (需 {required_mb:.0f}MB)")
                
        except Exception as e:
            if "磁盘空间不足" in str(e):
                raise e # 重新抛出给上层处理
            self.log(f"磁盘空间检查失败 (跳过检查): {e}", "WARN")

        mod_name = zip_path.stem
        target_dir = self.library_dir / mod_name
        
        if target_dir.exists():
            self.log(f"[SKIPPED] 跳过重复: {mod_name} (库中已存在)", "WARN")
            self.log("提示: 如果想重新导入，请先删除库中的同名文件夹。", "INFO")
            if progress_callback: progress_callback(100, "跳过重复文件")
            return
        
        try:
            target_dir.mkdir()
            self.log(f"[UNZIP] 正在导入: {zip_path.name}", "UNZIP")

            self._extract_archive_with_password(
                zip_path,
                target_dir,
                progress_callback,
                0,
                100,
                password_provider=password_provider,
            )
            self._normalize_wtlive_compat_files(target_dir)
            self.log(f"[SUCCESS] 导入成功: {mod_name}", "SUCCESS")
        except ArchivePasswordCanceled:
            self.log("[WARN] 已取消输入密码，导入已终止", "WARN")
            if target_dir.exists():
                try: shutil.rmtree(target_dir)
                except: pass
            raise
        except Exception as e:
            self.log(f"[ERROR] 导入失败: {e}", "ERROR")
            if target_dir.exists():
                try: shutil.rmtree(target_dir)
                except: pass
            raise

    def unzip_zips_to_library(self, progress_callback=None, password_provider=None):
        """
        功能定位:
        - 批量导入待解压区中的 ZIP/RAR 文件到语音包库，并通过回调输出总体进度。

        输入输出:
        - 参数:
          - progress_callback: Callable[[int, str], None] | None，总体进度回调。
          - password_provider: Callable[[Path, str], str | None] | None，密码提供器。
        - 返回: None
        - 外部资源/依赖:
          - 目录: self.pending_dir（读取压缩包列表）、self.library_dir（写入解压结果）

        实现逻辑:
        - 1) scan_pending 获取待处理压缩包列表；为空则直接返回。
        - 2) 对每个压缩包计算其进度区间（base_progress/share_progress）。
        - 3) 若目标目录已存在则记录为跳过；否则创建目录并解压导入。
        - 4) 对每个成功导入的语音包执行命名规范化。

        业务关联:
        - 上游: main.py 的“批量导入”流程。
        - 下游: 导入完成后前端刷新语音包库列表以展示新内容。
        """
        zips = self.scan_pending()
        if not zips:
            self.log("待解压区没有 ZIP/RAR 文件。", "WARN")
            if progress_callback: progress_callback(100, "没有文件")
            return

        total = len(zips)
        self.log(f"发现 {total} 个待解压文件...", "INFO")
        
        success_count = 0
        skipped_count = 0
        
        for idx, zip_file in enumerate(zips):
            try:
                mod_name = zip_file.stem
                target_dir = self.library_dir / mod_name
                
                # 计算总体进度区间
                base_progress = (idx / total) * 100
                share_progress = (1 / total) * 100
                
                if target_dir.exists():
                    self.log(f"[SKIPPED] 跳过重复: {mod_name}", "WARN")
                    skipped_count += 1
                    if progress_callback:
                        progress_callback(base_progress + share_progress, f"跳过: {mod_name}")
                    continue
                
                target_dir.mkdir()
                self.log(f"[UNZIP] 正在解压 ({idx + 1}/{total}): {zip_file.name}", "UNZIP")

                self._extract_archive_with_password(
                    zip_file,
                    target_dir,
                    progress_callback,
                    base_progress,
                    share_progress,
                    password_provider=password_provider,
                )
                self._normalize_wtlive_compat_files(target_dir)
                
                success_count += 1
                self.log(f"[SUCCESS] 解压成功: {mod_name}", "SUCCESS")
            except ArchivePasswordCanceled:
                self.log(f"[WARN] 已取消输入密码，跳过: {zip_file.name}", "WARN")
                if target_dir.exists():
                    try: shutil.rmtree(target_dir)
                    except: pass
                if progress_callback:
                    progress_callback(base_progress + share_progress, f"跳过: {mod_name}")
                skipped_count += 1
            except Exception as e:
                self.log(f"[ERROR] 解压 {zip_file.name} 失败: {e}", "ERROR")
                if target_dir.exists():
                    try: shutil.rmtree(target_dir)
                    except: pass

        self.log(f"[INFO] 解压完成: 成功 {success_count}, 跳过 {skipped_count}", "INFO")
        if progress_callback: progress_callback(100, "全部完成")

    def _extract_zip_safely(self, zip_path, target_dir, progress_callback=None, base_progress=0, share_progress=100, password=None):
        """
        功能定位:
        - 解压 ZIP 文件到目标目录，并提供进度回调与路径边界校验。

        输入输出:
        - 参数:
          - zip_path: Path，ZIP 文件路径。
          - target_dir: Path，目标解压目录。
          - progress_callback: Callable[[int, str], None] | None，进度回调。
          - base_progress: float|int，该 ZIP 在总体进度中的起始百分比。
          - share_progress: float|int，该 ZIP 在总体进度中的占比。
          - password: str | None，ZIP 密码（若需要）。
        - 返回: None
        - 外部资源/依赖:
          - 文件系统: 创建目录并写入解压文件
          - zipfile: 读取 ZIP 成员并按块写入

        实现逻辑:
        - 1) 读取成员列表并计算总文件数/总字节数（用于进度估算）。
        - 2) 逐成员解码文件名并过滤无效项（如 __MACOSX、desktop.ini）。
        - 3) 将目标路径 resolve 后校验必须位于 target_root 内，否则跳过该成员。
        - 4) 对文件成员按块写入，同时更新 extracted_bytes 并节流更新进度。

        业务关联:
        - 上游: _extract_archive_with_password 在处理 .zip 时调用。
        - 下游: 生成语音包库目录结构，供后续扫描与元数据读取。
        """
        import time
        target_root = Path(target_dir).resolve()
        with zipfile.ZipFile(zip_path, 'r') as zf:
            file_list = zf.infolist()
            total_files = len(file_list)
            last_update = 0.0
            extracted_bytes = 0
            total_bytes = 0
            if progress_callback:
                try:
                    progress_callback(int(base_progress), f"开始解压: {Path(zip_path).name}")
                except Exception:
                    pass
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
                    filename = member.filename.encode('cp437').decode('utf-8')
                except:
                    try:
                        filename = member.filename.encode('cp437').decode('cp950')
                    except:
                        try:
                            filename = member.filename.encode('cp437').decode('gbk')
                        except:
                            filename = member.filename

                if "__MACOSX" in filename or "desktop.ini" in filename: continue
                
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
                
                # 路径边界校验：目标路径必须位于 target_dir 内部
                full_target_path = (target_dir / filename).resolve()
                try:
                    is_inside = os.path.commonpath([str(full_target_path), str(target_root)]) == str(target_root)
                except Exception:
                    is_inside = False
                if not is_inside:
                     self.log(f"[WARN] 拦截恶意路径穿越文件: {filename}", "WARN")
                     continue

                target_path = target_dir / filename
                if member.is_dir():
                    target_path.mkdir(parents=True, exist_ok=True)
                else:
                    target_path.parent.mkdir(parents=True, exist_ok=True)
                    if member.flag_bits & 0x1 and not password:
                        raise ArchivePasswordRequired("ZIP 需要密码")
                    pwd = password.encode("utf-8") if password else None
                    try:
                        source_file = zf.open(member, pwd=pwd)
                    except RuntimeError as e:
                        msg = str(e).lower()
                        if "password" in msg:
                            if password:
                                raise ArchivePasswordIncorrect("ZIP 密码错误")
                            raise ArchivePasswordRequired("ZIP 需要密码")
                        raise
                    except Exception:
                        raise
                    with source_file as source, open(target_path, "wb") as target:
                        chunk_size = 8192  # 8KB chunks
                        while True:
                            chunk = source.read(chunk_size)
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
                                progress_callback(int(current_percent), f"解压中: {fname}")
                                last_update = now
            
            if progress_callback:
                progress_callback(int(base_progress + share_progress), "解压完成")

    def copy_country_files(self, mod_name, game_path, country_code, include_ground=True, include_radio=True):
        """
        功能定位:
        - 从语音包库中复制“陆战/无线电”国籍语音文件到游戏 sound/mod，并将文件名中的国家缩写替换为目标缩写。

        输入输出:
        - 参数:
          - mod_name: str，语音包目录名（位于 self.library_dir 下）。
          - game_path: str | Path，游戏根目录路径。
          - country_code: str，目标国家缩写（2-10 位小写字母，且不允许为 zh）。
          - include_ground: bool，是否复制陆战相关文件对。
          - include_radio: bool，是否复制无线电/局势相关文件对。
        - 返回:
          - dict，包含 created/skipped/missing 三个列表：
            - created: 本次新创建的目标文件名
            - skipped: 已存在而跳过的目标文件名
            - missing: 未在语音包中找到的来源模式描述（如 _crew_dialogs_ground_*.assets.bank）
        - 外部资源/依赖:
          - 目录: <game_root>/sound/mod（写入）
          - 目录: <library_dir>/<mod_name>（读取）

        实现逻辑:
        - 1) 校验 country_code 格式与 game_path、mod_dir 的存在性。
        - 2) 在 mod_dir 中按正则匹配查找 source 文件（允许可选国家后缀）。
        - 3) 将 source 复制到 game_mod_dir，并按 prefix + country_code 生成目标文件名。
        - 4) 对已存在目标文件记录为 skipped；对未找到来源文件记录为 missing。

        业务关联:
        - 上游: main.py 暴露给前端的“复制国籍文件”功能入口。
        - 下游: 生成的新文件将影响游戏加载的语音资源集合。
        """
        code = str(country_code or "").strip().lower()
        if not code or not re.match(r"^[a-z]{2,10}$", code):
            raise ValueError("国家缩写不合法")
        if code == "zh":
            raise ValueError("目标国家缩写不能为 zh")
        game_root = Path(game_path or "")
        if not game_root.exists():
            raise FileNotFoundError("游戏路径无效")
        game_mod_dir = game_root / "sound" / "mod"
        game_mod_dir.mkdir(parents=True, exist_ok=True)
        mod_dir = self.library_dir / mod_name
        if not mod_dir.exists():
            raise FileNotFoundError("语音包不存在")

        created = []
        skipped = []
        missing = []

        def _find_source(prefix, suffix):
            matches = []
            prefix_clean = prefix.lstrip("_")
            pattern = re.compile(
                rf"^_?{re.escape(prefix_clean)}([a-z]{{2,10}})?{re.escape(suffix)}$",
                re.IGNORECASE,
            )
            for p in mod_dir.rglob("*"):
                if p.is_file() and pattern.match(p.name):
                    matches.append(p)
            if not matches:
                return None
            return sorted(matches, key=lambda x: str(x))[0]

        def _copy_pair(prefix):
            src_assets_name = f"{prefix}*.assets.bank"
            src_bank_name = f"{prefix}*.bank"
            src_assets = _find_source(prefix, ".assets.bank")
            src_bank = _find_source(prefix, ".bank")

            if src_assets:
                dst_assets = game_mod_dir / f"{prefix}{code}.assets.bank"
                if dst_assets.exists():
                    skipped.append(dst_assets.name)
                else:
                    shutil.copy2(src_assets, dst_assets)
                    created.append(dst_assets.name)
            else:
                missing.append(src_assets_name)

            if src_bank:
                dst_bank = game_mod_dir / f"{prefix}{code}.bank"
                if dst_bank.exists():
                    skipped.append(dst_bank.name)
                else:
                    shutil.copy2(src_bank, dst_bank)
                    created.append(dst_bank.name)
            else:
                missing.append(src_bank_name)

        if include_ground:
            _copy_pair("_crew_dialogs_ground_")
        if include_radio:
            _copy_pair("_crew_dialogs_common_")

        return {
            "created": created,
            "skipped": skipped,
            "missing": missing,
        }
