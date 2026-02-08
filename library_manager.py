# -*- coding: utf-8 -*-
"""
语音包库管理模组：负责语音包库目录结构、压缩包导入解压、元数据读取与标籤推断。

功能特性:
- 语音包库目录管理
- ZIP/RAR 压缩包导入与解压
- 语音包元数据读取与智能标籤推断
- 密码保护压缩包支援
- 磁盘空间检查

错误处理策略:
- 压缩包相关使用专门的异常类
- 文件操作使用具体的异常类型
- 所有操作记录完整的错误上下文
"""
import os
import sys
import platform
import shutil
import subprocess
import time
import zipfile
import json
import re
from collections import Counter
from pathlib import Path
from typing import Callable, Any
from logger import get_logger
from utils import get_app_data_dir
from wt_sound import VoiceType, Country

log = get_logger(__name__)

# 定义标准文件夹名称
DIR_PENDING = "WT待解压区"
DIR_LIBRARY = "WT语音包库"


# 定义压缩包相关异常类
class ArchiveError(Exception):
    """压缩包相关错误的基类。"""
    pass


class ArchivePasswordRequired(ArchiveError):
    """压缩包需要密码。"""
    pass


class ArchivePasswordIncorrect(ArchiveError):
    """密码错误。"""
    pass


class ArchivePasswordCanceled(ArchiveError):
    """用户取消输入密码。"""
    pass


class ArchiveExtractionError(ArchiveError):
    """解压过程错误。"""
    pass


class DiskSpaceError(Exception):
    """磁盘空间不足。"""
    pass


class LibraryManager:
    """
    语音包库管理器：管理待解压区与语音包库的文件操作。
    
    属性:
        root_dir: 应用数据根目录
        pending_dir: 待解压区目录
        library_dir: 语音包库目录
    """

    SUPPORTED_EXTENSIONS = (".zip", ".rar", ".7z", ".tar", ".gz", ".bz2", ".xz", ".tgz", ".tbz2")

    def __init__(self, pending_dir: str | None = None,
                 library_dir: str | None = None):
        """初始化 LibraryManager。"""
        self.root_dir = get_app_data_dir()
        self._details_cache = {} # 缓存单个 mod 的详情
        self._scan_cache = None   # 缓存整个扫描结果
        self._last_scan_mtime = 0

        # 初始化待解压区与语音包库目录路径
        # 支援自定义路径，若未提供则使用预设值
        if pending_dir and Path(pending_dir).exists():
            self.pending_dir = Path(pending_dir)
        else:
            self.pending_dir = self.root_dir / DIR_PENDING

        if library_dir and Path(library_dir).exists():
            self.library_dir = Path(library_dir)
        else:
            self.library_dir = self.root_dir / DIR_LIBRARY

        # 确保目录存在
        self._ensure_dirs()

    def update_paths(self, pending_dir: str | None = None,
                     library_dir: str | None = None) -> dict[str, bool]:
        """
        动态更新待解压区和语音包库路径。
        
        Args:
            pending_dir: 新的待解压区路径
            library_dir: 新的语音包库路径
            
        Returns:
            包含更新结果的字典 {'pending_updated': bool, 'library_updated': bool}
        """
        result = {'pending_updated': False, 'library_updated': False}

        def _norm_path(path: Path) -> str:
            try:
                resolved = path.resolve(strict=False)
            except Exception:
                resolved = path
            return os.path.normcase(os.path.normpath(str(resolved)))

        if pending_dir:
            new_path = Path(pending_dir)
            if _norm_path(new_path) == _norm_path(self.pending_dir):
                # 路径未变更：避免重复日志
                pass
            else:
                # 确保目录存在或可创建
                if not new_path.exists():
                    try:
                        new_path.mkdir(parents=True, exist_ok=True)
                        log.info(f"已创建待解压区目录: {new_path}")
                    except PermissionError as e:
                        log.error(f"无法创建待解压区目录（权限不足）: {e}")
                        return result
                    except OSError as e:
                        log.error(f"无法创建待解压区目录: {e}")
                        return result
                self.pending_dir = new_path
                result['pending_updated'] = True
                log.info(f"待解压区路径已更新: {new_path}")

        if library_dir:
            new_path = Path(library_dir)
            if _norm_path(new_path) == _norm_path(self.library_dir):
                # 路径未变更：避免重复日志
                pass
            else:
                # 确保目录存在或可创建
                if not new_path.exists():
                    try:
                        new_path.mkdir(parents=True, exist_ok=True)
                        log.info(f"已创建语音包库目录: {new_path}")
                    except PermissionError as e:
                        log.error(f"无法创建语音包库目录（权限不足）: {e}")
                        return result
                    except OSError as e:
                        log.error(f"无法创建语音包库目录: {e}")
                        return result
                self.library_dir = new_path
                result['library_updated'] = True
                log.info(f"语音包库路径已更新: {new_path}")

        return result

    def get_current_paths(self) -> dict[str, str]:
        """
        返回当前的待解压区和语音包库路径。
        
        Returns:
            包含各路径的字典
        """
        return {
            'pending_dir': str(self.pending_dir),
            'library_dir': str(self.library_dir),
            'default_pending_dir': str(self.root_dir / DIR_PENDING),
            'default_library_dir': str(self.root_dir / DIR_LIBRARY)
        }

    def _load_json_with_fallback(self, file_path: Path) -> dict | None:
        """
        按编码回退策略读取 JSON 文件并解析为 Python 对象。
        
        Args:
            file_path: JSON 文件路径
            
        Returns:
            解析后的字典，失败则返回 None
        """
        encodings = ["utf-8-sig", "utf-8", "cp950", "big5", "gbk"]
        last_error = None

        for enc in encodings:
            try:
                with open(file_path, "r", encoding=enc) as f:
                    return json.load(f)
            except UnicodeDecodeError:
                continue
            except json.JSONDecodeError as e:
                last_error = e
                log.debug(f"JSON 解析失败 (编码: {enc}): {e}")
                continue
            except Exception as e:
                last_error = e
                continue

        if last_error:
            log.warning(f"无法读取 JSON 文件 {file_path}: {last_error}")
        return None

    def _ensure_dirs(self) -> None:
        """确保待解压区与语音包库目录存在。"""
        for dir_path, dir_name in [(self.pending_dir, "待解压区"), (self.library_dir, "语音包库")]:
            if not dir_path.exists():
                try:
                    dir_path.mkdir(parents=True)
                    log.info(f"已创建{dir_name}目录: {dir_path}")
                except PermissionError as e:
                    log.error(f"创建{dir_name}目录失败（权限不足）: {e}")
                except OSError as e:
                    log.error(f"创建{dir_name}目录失败: {e}")

    def log(self, message: str, level: str = "INFO") -> None:
        """
        统一日誌输出方法。
        
        Args:
            message: 日誌讯息
            level: 日誌级别
        """
        tag = str(level or "INFO").upper()
        msg = str(message)

        # 统一前缀：避免重複叠加
        if tag != "INFO" and not msg.startswith(f"[{tag}]"):
            msg = f"[{tag}] {msg}"

        if tag in {"WARN", "WARNING"}:
            log.warning(msg)
        elif tag in {"ERROR"}:
            log.error(msg)
        else:
            # INFO / SUCCESS / UNZIP / ... 都走 INFO
            log.info(msg)

    def _open_folder_cross_platform(self, path: Path) -> None:
        """
        跨平台打开文件夹。
        
        Args:
            path: 文件夹路径
        """
        try:
            path_str = str(path)
            system = platform.system()

            if system == "Windows":
                os.startfile(path_str)
            elif system == "Darwin":  # macOS
                subprocess.Popen(["open", path_str])
            else:  # Linux
                subprocess.Popen(["xdg-open", path_str])
        except FileNotFoundError as e:
            self.log(f"无法打开文件夹（路径不存在）: {e}", "ERROR")
        except PermissionError as e:
            self.log(f"无法打开文件夹（权限不足）: {e}", "ERROR")
        except Exception as e:
            self.log(f"无法打开文件夹: {type(e).__name__}: {e}", "ERROR")

    def open_pending_folder(self) -> None:
        """打开待解压区目录，供用户手动放入压缩包。"""
        self._open_folder_cross_platform(self.pending_dir)

    def open_library_folder(self) -> None:
        """打开语音包库目录，供用户查看已导入的语音包文件夹。"""
        self._open_folder_cross_platform(self.library_dir)

    def scan_library(self) -> list[str]:
        """
        扫描语音包库目录下的语音包文件夹列表。
        """
        try:
            if not self.library_dir.exists():
                return []
            
            # 检查目录修改时间
            current_mtime = self.library_dir.stat().st_mtime
            if self._scan_cache is not None and self._last_scan_mtime == current_mtime:
                return self._scan_cache

            mods = []
            for item in self.library_dir.iterdir():
                if item.is_dir():
                    mods.append(item.name)
            
            self._scan_cache = mods
            self._last_scan_mtime = current_mtime
            return mods
        except Exception as e:
            log.error(f"扫描语音包库失败: {e}")
            return []

    def scan_pending(self) -> list[Path]:
        """
        扫描待解压区中的 ZIP/RAR 文件列表。
        
        Returns:
            压缩包文件路径列表
        """
        archives = []
        try:
            if self.pending_dir.exists():
                for item in self.pending_dir.iterdir():
                    if item.suffix.lower() in self.SUPPORTED_EXTENSIONS:
                        archives.append(item)
        except PermissionError as e:
            log.error(f"扫描待解压区失败（权限不足）: {e}")
        except Exception as e:
            log.error(f"扫描待解压区失败: {type(e).__name__}: {e}")
        return archives

    def _normalize_wtlive_compat_files(self, mod_dir: Path) -> None:
        """
        规范化语音包目录中的元数据与封面文件命名。
        
        生成工具可直接读取的 info.json 与 cover.png。
        
        Args:
            mod_dir: 语音包目录路径
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
                    except PermissionError:
                        log.debug(f"无法访问目录: {d}")
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
                        log.debug(f"已重命名 {src.name} -> info.json")
                    except PermissionError as e:
                        log.warning(f"重命名 info 文件失败（权限不足）: {e}")
                    except OSError as e:
                        log.warning(f"重命名 info 文件失败: {e}")

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
                        log.debug(f"已重命名 {cover_src.name} -> cover.png")
                    except PermissionError as e:
                        log.warning(f"重命名封面文件失败（权限不足）: {e}")
                    except OSError as e:
                        log.warning(f"重命名封面文件失败: {e}")
        except Exception as e:
            log.warning(f"规范化语音包文件失败: {type(e).__name__}: {e}")

    def get_mod_details(self, mod_name: str) -> dict[str, Any]:
        """
        读取语音包的元数据与资源信息，生成前端展示所需的详情字典。
        """
        mod_dir = self.library_dir / mod_name
        
        try:
            current_mtime = mod_dir.stat().st_mtime
        except Exception:
            current_mtime = 0
            
        cached = self._details_cache.get(mod_name)
        if cached and cached.get("_mtime") == current_mtime:
            return cached

        self._normalize_wtlive_compat_files(mod_dir)

        # 1. 默认数据
        # 尝试获取文件夹修改时间作为默认日期
        try:
            mtime = os.path.getmtime(mod_dir)
            default_date = time.strftime("%Y-%m-%d", time.localtime(mtime))
        except OSError:
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
            "tags": [],  # 存储标籤列表 ["tank", "radio"]
            "language": [],  # 存储语言列表 ["中", "美"]
            "size_str": "0 MB",
            "cover_path": None,
            "capabilities": {}  # 兼容前端旧逻辑
        }

        # 2. 读取 info.json (支援 WTLive 伪装格式)
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
        except PermissionError as e:
            log.warning(f"扫描 info 文件失败（权限不足）: {e}")
        except Exception as e:
            log.warning(f"Glob 搜索出错: {type(e).__name__}: {e}")

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
                    for key in ["title", "author", "version", "date", "note", "link_bilibili", "link_wtlive",
                                "link_video", "tags", "language"]:
                        if key in data:
                            details[key] = data[key]
                else:
                    log.warning(f"读取 info 文件失败 ({found_info_file.name})")
            except Exception as e:
                log.warning(f"读取 info.json 失败: {e}")

        # 文件详情 (按类型分类)
        # 这一步会同时检测文件类型和语言
        details["files"] = self._detect_mod_files(mod_dir)

        # 收集自动检测到的标签和语言
        detected_tags = set()
        detected_langs = set()
        
        if details["files"]:
            for group in details["files"]:
                # type 是 VoiceType.tag (如 "陆战语音")
                t = group.get("type")
                if t:
                    detected_tags.add(t)
                
                langs = group.get("merged_langs", [])
                for l in langs:
                    detected_langs.add(l)

        # 合并标签：以 info.json 为主，补充自动检测到的
        combined_tags = list(details["tags"])
        for t in detected_tags:
            if t not in combined_tags:
                combined_tags.append(t)
        details["tags"] = combined_tags

        # 合并语言：如果 info.json 没写，或者写的是"未识别"，则使用自动检测结果
        if not details["language"] or details["language"] == ["未识别"]:
            if detected_langs:
                # 按常用语排序或保持扫描顺序
                details["language"] = sorted(list(detected_langs))
            else:
                details["language"] = ["未识别"]
        else:
            # 如果已有，补充检测到的新语言
            for l in detected_langs:
                if l not in details["language"]:
                    details["language"].append(l)

        # 将 tags 映射为前端使用的 capabilities 键
        for t in details["tags"]:
            tl = t.lower()
            if any(k in tl for k in ["tank", "ground", "陆战"]):
                details["capabilities"]["tank"] = True
            if any(k in tl for k in ["air", "aircraft", "空战", "座舱"]):
                details["capabilities"]["air"] = True
            if any(k in tl for k in ["naval", "ships", "海战"]):
                details["capabilities"]["naval"] = True
            if any(k in tl for k in ["radio", "无线电", "status", "局势", "对话"]):
                details["capabilities"]["radio"] = True
            if any(k in tl for k in ["missile", "导弹", "武器", "guns", "weapons"]):
                details["capabilities"]["missile"] = True
            if any(k in tl for k in ["music", "音乐"]):
                details["capabilities"]["music"] = True
            if any(k in tl for k in ["noise", "降噪", "主音库", "masterbank"]):
                details["capabilities"]["noise"] = True
            if any(k in tl for k in ["pilot", "飞行员", "infantry", "步兵"]):
                details["capabilities"]["pilot"] = True
            
            if t in ["tank", "air", "naval", "radio", "status", "missile", "music", "noise", "pilot"]:
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
                    log.info(f"[AutoFix] 已将 {bank_path.name} 恢复为 {new_path.name}")
                except Exception as e:
                    log.warning(f"重命名封面失败: {e}")

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

        # 7. 文件详情 (按类型分类)
        details["files"] = self._detect_mod_files(mod_dir)

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

        # 存入缓存
        details["_mtime"] = current_mtime
        self._details_cache[mod_name] = details
        return details

    def _detect_smart_tags(self, mod_dir):
        # 基于语音包目录内 .bank 文件的命名规则推断功能标签（tags）。
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

    def _get_v_type_cls(self, v_type):
        """将 VoiceType 映射到前端 CSS 类名"""
        if not v_type:
            return "default"
        code = v_type.code.lower()
        tag = (v_type.tag or "").lower()
        
        if any(k in code or k in tag for k in ["ground", "tank", "陆战"]):
            return "tank"
        if any(k in code or k in tag for k in ["air", "aircraft", "空战", "座舱"]):
            return "air"
        if any(k in code or k in tag for k in ["naval", "ships", "海战"]):
            return "naval"
        if any(k in code or k in tag for k in ["radio", "common", "dialogs", "无线电", "对话"]):
            return "radio"
        if any(k in code or k in tag for k in ["missile", "guns", "weapons", "导弹", "武器"]):
            return "missile"
        if any(k in code or k in tag for k in ["music", "音乐"]):
            return "music"
        if any(k in code or k in tag for k in ["noise", "masterbank", "降噪"]):
            return "noise"
        if any(k in code or k in tag for k in ["pilot", "飞行员", "infantry", "步兵"]):
            return "pilot"
        return "default"

    def _detect_mod_files(self, mod_dir):
        """
        递归扫描 .bank 文件,按语音类型分类返回文件列表，并识别语言。
        返回格式: [{"type": "陆战语音", "code": "crew_dialogs_ground", "cls": "tank", "files": [...], ...}, ...]
        """
        type_groups = {}

        try:
            # 查找所有 .bank 文件
            all_files_set = set(mod_dir.rglob("*.bank"))
            all_files_set.update(mod_dir.rglob("*.BANK"))
            all_files = list(all_files_set)

            for f in all_files:
                if not f.is_file():
                    continue

                filename = f.name.lower()
                try:
                    rel_path = f.relative_to(mod_dir)
                    rel_path_str = str(rel_path).replace("\\", "/")
                except ValueError:
                    continue

                # 匹配语音类型及语言信息
                matched_data = self.match_voice_type(filename)

                if matched_data:
                    v_type, v_country, _ = matched_data
                    type_key = v_type.code
                    
                    if type_key not in type_groups:
                        type_groups[type_key] = {
                            "type": v_type.tag,
                            "code": v_type.code,
                            "cls": self._get_v_type_cls(v_type), # 增加颜色类名
                            "files": [],
                            "count": 0,
                            "langs": set() 
                        }

                    type_groups[type_key]["files"].append(rel_path_str)
                    type_groups[type_key]["count"] += 1
                    if v_country:
                        lang_name = self._map_lang_code(v_country.code)
                        type_groups[type_key]["langs"].add(lang_name)
        except Exception as e:
            log.error(f"扫描模块化文件出错: {e}")

        # 转换为最终格式
        final_list = []
        for g in type_groups.values():
            g["merged_langs"] = sorted(list(g["langs"]))
            del g["langs"]
            final_list.append(g)

        return sorted(final_list, key=lambda x: x["type"])

    @staticmethod
    def match_voice_type(filename_lower):
        """
        匹配文件名对应的语音类型和语言
        返回: (VoiceType, Country or None, base_name) 或 None
        """
        base_name = filename_lower
        if base_name.endswith('.assets.bank'):
            base_name = base_name.replace('.assets.bank', '')
        elif base_name.endswith('.bank'):
            base_name = base_name.replace('.bank', '')
        else:
            return None
            
        if base_name.startswith('_'):
            base_name = base_name[1:]

        detected_country = None
        # 按照 code 长度倒序排列，优先识别长后缀
        sorted_countries = sorted(list(Country), key=lambda x: len(x.code), reverse=True)
        
        for country in sorted_countries:
            if base_name.endswith('_' + country.code):
                base_name = base_name.rsplit('_', 1)[0]
                detected_country = country
                break

        for v_type in VoiceType:
            if not v_type.tag:
                continue
            
            # 全等匹配或带下划线的前缀匹配
            if base_name == v_type.code or base_name == "_" + v_type.code:
                return v_type, detected_country, base_name
            
        # 兜底：模糊匹配
        for v_type in VoiceType:
            if not v_type.tag:
                continue
            if v_type.code in base_name:
                return v_type, detected_country, base_name
                
        return None

    def _get_dir_size_str(self, path):
        """计算文件夹大小并格式化（优化版本）"""
        total_size = 0
        try:
            # 优化：限制遍历深度和文件数量，避免大目录卡死
            file_count = 0
            max_files = 5000  # 最多统计5000个文件
            max_depth = 10  # 最多遍历10层深度

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

    def _is_safe_path(self, path, base_dir):
        # 校验路径是否位于指定基准目录内，用于限制删除/移动等文件操作的作用范围。
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

    def _extract_with_7z(self, archive_path, target_dir, progress_callback=None, base_progress=0, share_progress=100,
                         password=None):
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

    def _extract_archive_with_password(self, archive_path, target_dir, progress_callback=None, base_progress=0,
                                       share_progress=100, password_provider=None):
        password = None
        while True:
            try:
                if archive_path.suffix.lower() == ".zip":
                    try:
                        self._extract_zip_safely(archive_path, target_dir, progress_callback, base_progress,
                                                 share_progress, password=password)
                    except (NotImplementedError, RuntimeError) as e:
                        msg = str(e).lower()
                        if "compression method is not supported" in msg:
                            self._extract_with_7z(archive_path, target_dir, progress_callback, base_progress,
                                                  share_progress, password=password)
                        else:
                            raise
                elif archive_path.suffix.lower() in (".rar", ".7z", ".tar", ".gz", ".bz2", ".xz", ".tgz", ".tbz2"):
                    self._extract_with_7z(archive_path, target_dir, progress_callback, base_progress, share_progress,
                                          password=password)
                else:
                    raise Exception(f"不支持的压缩格式: {archive_path.suffix}")
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
        if zip_path.suffix.lower() not in self.SUPPORTED_EXTENSIONS:
            ext_list = ", ".join(self.SUPPORTED_EXTENSIONS)
            raise ValueError(f"不支持的文件格式。支持的格式: {ext_list}")

        # 磁盘空间估算与校验
        try:
            zip_size = os.path.getsize(zip_path)
            # 估算解压后大小 (通常是压缩包的 2-3 倍，这里保守估计 3 倍)
            estimated_size = zip_size * 3
            # 需要至少 2 倍的估算空间作为安全余量 (解压过程可能产生临时文件)
            required_space = estimated_size * 2

            target_drive = Path(self.library_dir).anchor  # 获取盘符 (如 C:\)
            if not target_drive: target_drive = self.library_dir

            total, used, free = shutil.disk_usage(target_drive)

            if free < required_space:
                free_mb = free / (1024 * 1024)
                required_mb = required_space / (1024 * 1024)
                self.log(f"磁盘空间不足! 可用: {free_mb:.0f}MB, 需要: {required_mb:.0f}MB", "ERROR")
                raise Exception(f"磁盘空间不足 (需 {required_mb:.0f}MB)")

        except Exception as e:
            if "磁盘空间不足" in str(e):
                raise e  # 重新抛出给上层处理
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
                try:
                    shutil.rmtree(target_dir)
                except:
                    pass
            raise
        except Exception as e:
            self.log(f"[ERROR] 导入失败: {e}", "ERROR")
            if target_dir.exists():
                try:
                    shutil.rmtree(target_dir)
                except:
                    pass
            raise

    def unzip_zips_to_library(self, progress_callback=None, password_provider=None):
        # 批量导入待解压区中的 ZIP/RAR 文件到语音包库，并通过回调输出总体进度。
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
                    try:
                        shutil.rmtree(target_dir)
                    except:
                        pass
                if progress_callback:
                    progress_callback(base_progress + share_progress, f"跳过: {mod_name}")
                skipped_count += 1
            except Exception as e:
                self.log(f"[ERROR] 解压 {zip_file.name} 失败: {e}", "ERROR")
                if target_dir.exists():
                    try:
                        shutil.rmtree(target_dir)
                    except:
                        pass

        self.log(f"[INFO] 解压完成: 成功 {success_count}, 跳过 {skipped_count}", "INFO")
        if progress_callback: progress_callback(100, "全部完成")

    def _extract_zip_safely(self, zip_path, target_dir, progress_callback=None, base_progress=0, share_progress=100,
                            password=None):
        # 解压 ZIP 文件到目标目录，并提供进度回调与路径边界校验。
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
                        filename = member.filename.encode('cp437').decode('gbk')
                    except:
                        try:
                            filename = member.filename.encode('cp437').decode('cp950')
                        except:
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
        # 从语音包库中复制“陆战/无线电”国籍语音文件到游戏 sound/mod，并将文件名中的国家缩写替换为目标缩写。
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
