from __future__ import annotations

import base64
import hashlib
import io
import json
import os
import random
import re
import shutil
import stat
import subprocess
import sys
import threading
import time
import zipfile
from collections import defaultdict
from pathlib import Path
from typing import Any

from services.bank_preview_service import BankPreviewService
from wt.wt_sound import Country, VoiceType

SUPPORTED_INFO_KEYS = [
    "title",
    "author",
    "version",
    "date",
    "note",
    "full_desc",
    "version_note",
    "link_bilibili",
    "link_qq_group",
    "link_wtlive",
    "link_liker",
    "link_feedback",
    "link_video",
    "tags",
    "language",
    "preview_use_random_bank",
    "preview_audio_files",
    "related_voicepacks",
]

BANK_NAME_PATTERNS = [
    "*（AimerWT）.bank",
    "*(AimerWT).bank",
    "*（AimerWT_JSON）.bank",
    "*(AimerWT_JSON).bank",
]

MAX_PREVIEW_AUDIO_COUNT = 3
MAX_RELATED_PACK_COUNT = 2
MAX_RELATED_DESC_LENGTH = 50
ALLOWED_AUDIO_EXTS = {"mp3", "wav"}
ALLOWED_IMAGE_EXTS = {"png", "jpg", "jpeg", "webp", "bmp", "gif", "svg"}
EXPORT_CONFIG_EXTS = {".json"}
EXPORT_IMAGE_EXTS = {f".{ext}" for ext in ALLOWED_IMAGE_EXTS}
EXPORT_MODE_FULL = "full"
EXPORT_MODE_SPLIT = "split"


class LibraryManager:
    def __init__(self, pending_dir: str, library_dir: str):
        self.pending_dir = Path(pending_dir)
        self.library_dir = Path(library_dir)
        self._details_cache: dict[str, dict[str, Any]] = {}
        self._scan_cache: list[str] | None = None
        self._last_scan_mtime = 0.0

    def scan_library(self) -> list[str]:
        base = self.library_dir
        try:
            mtime = base.stat().st_mtime
        except Exception:
            mtime = 0.0

        if self._scan_cache is not None and mtime <= self._last_scan_mtime:
            return list(self._scan_cache)

        names: list[str] = []
        if base.exists():
            try:
                for item in base.iterdir():
                    if item.is_dir():
                        names.append(item.name)
            except Exception:
                names = []

        names.sort(key=lambda x: x.lower())
        self._scan_cache = names
        self._last_scan_mtime = mtime
        return list(names)

    def get_mod_details(self, mod_name: str) -> dict[str, Any]:
        key = str(mod_name or "").strip()
        if key in self._details_cache:
            return dict(self._details_cache[key])

        pack_dir = self.library_dir / key
        info: dict[str, Any] = {}
        info_file = self._find_info_file(pack_dir)
        if info_file:
            info = self._load_json_with_fallback(info_file) or {}

        cover_path = self._find_cover(pack_dir)
        size_bytes = self._calc_folder_size(pack_dir)
        size_str = self._format_size(size_bytes)

        preview_audio_files = info.get("preview_audio_files") or []
        details = {
            "title": str(info.get("title") or key),
            "author": str(info.get("author") or ""),
            "version": str(info.get("version") or "1.0"),
            "date": str(info.get("date") or ""),
            "note": str(info.get("note") or ""),
            "full_desc": str(info.get("full_desc") or info.get("note") or ""),
            "version_note": info.get("version_note") or [],
            "link_bilibili": str(info.get("link_bilibili") or ""),
            "link_qq_group": str(info.get("link_qq_group") or ""),
            "link_wtlive": str(info.get("link_wtlive") or ""),
            "link_liker": str(info.get("link_liker") or ""),
            "link_feedback": str(info.get("link_feedback") or ""),
            "link_video": str(info.get("link_video") or ""),
            "tags": info.get("tags") or [],
            "language": info.get("language") or [],
            "preview_use_random_bank": self._normalize_preview_use_random_bank(
                info.get("preview_use_random_bank"),
                preview_audio_files,
            ),
            "preview_audio_files": preview_audio_files,
            "files": self._detect_mod_files(pack_dir),
            "related_voicepacks": info.get("related_voicepacks") or [],
            "size_str": size_str,
            "cover_path": str(cover_path) if cover_path else "",
        }

        self._details_cache[key] = details
        return dict(details)

    @staticmethod
    def _normalize_preview_use_random_bank(raw: Any, preview_audio_files: Any = None) -> bool:
        if isinstance(raw, bool):
            return raw
        if isinstance(raw, (int, float)):
            return bool(raw)
        text = str(raw or "").strip().lower()
        if text in {"1", "true", "yes", "on", "random"}:
            return True
        if text in {"0", "false", "no", "off", "manual"}:
            return False
        return not bool(preview_audio_files)

    def _get_v_type_cls(self, v_type):
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

    def _detect_mod_files(self, mod_dir: Path) -> list[dict[str, Any]]:
        type_groups: dict[str, dict[str, Any]] = {}
        try:
            all_files_set = set(mod_dir.rglob("*.bank"))
            all_files_set.update(mod_dir.rglob("*.BANK"))
            for f in all_files_set:
                if not f.is_file():
                    continue
                try:
                    rel_path_str = f.relative_to(mod_dir).as_posix()
                except ValueError:
                    continue

                matched = self.match_voice_type(f.name.lower())
                if not matched:
                    continue
                v_type, v_country, _ = matched
                type_key = v_type.code
                if type_key not in type_groups:
                    type_groups[type_key] = {
                        "type": v_type.tag,
                        "code": v_type.code,
                        "cls": self._get_v_type_cls(v_type),
                        "files": [],
                        "count": 0,
                        "langs": set(),
                    }
                type_groups[type_key]["files"].append(rel_path_str)
                type_groups[type_key]["count"] += 1
                if v_country:
                    type_groups[type_key]["langs"].add(v_country.code)
        except Exception:
            return []

        rows = []
        for group in type_groups.values():
            group["merged_langs"] = sorted(list(group["langs"]))
            del group["langs"]
            rows.append(group)
        return sorted(rows, key=lambda x: str(x.get("type") or ""))

    @staticmethod
    def match_voice_type(filename_lower):
        base_name = filename_lower
        if base_name.endswith(".assets.bank"):
            base_name = base_name.replace(".assets.bank", "")
        elif base_name.endswith(".bank"):
            base_name = base_name.replace(".bank", "")
        else:
            return None

        if base_name.startswith("_"):
            base_name = base_name[1:]

        if base_name == "preview" or base_name.startswith("preview_") or base_name.startswith("audition_preview"):
            return VoiceType.PREVIEW, None, base_name

        detected_country = None
        sorted_countries = sorted(list(Country), key=lambda x: len(x.code), reverse=True)
        for country in sorted_countries:
            if base_name.endswith("_" + country.code):
                base_name = base_name.rsplit("_", 1)[0]
                detected_country = country
                break

        for v_type in VoiceType:
            if not v_type.tag:
                continue
            if base_name == v_type.code or base_name == "_" + v_type.code:
                return v_type, detected_country, base_name

        for v_type in VoiceType:
            if not v_type.tag:
                continue
            if v_type.code in base_name:
                return v_type, detected_country, base_name

        return None

    def _find_info_file(self, pack_dir: Path) -> Path | None:
        if not pack_dir.exists():
            return None

        candidates = [
            pack_dir / "info.json",
            pack_dir / "info" / "info.json",
        ]

        try:
            for pattern in BANK_NAME_PATTERNS:
                candidates.extend(list(pack_dir.glob(pattern)))
            if (pack_dir / "info").exists():
                for pattern in BANK_NAME_PATTERNS:
                    candidates.extend(list((pack_dir / "info").glob(pattern)))
        except Exception:
            pass

        for cand in candidates:
            if cand.exists() and cand.is_file():
                return cand

        try:
            info_jsons = [p for p in pack_dir.rglob("info.json") if p.is_file()]
            info_jsons.sort(key=lambda p: len(p.parts))
            if info_jsons:
                return info_jsons[0]
        except Exception:
            return None

        return None

    def _find_cover(self, pack_dir: Path) -> Path | None:
        if not pack_dir.exists():
            return None

        exts = ["png", "jpg", "jpeg", "webp", "bmp", "gif", "svg"]
        for ext in exts:
            cand = pack_dir / f"cover.{ext}"
            if cand.exists() and cand.is_file():
                return cand

        try:
            for ext in exts:
                for cand in pack_dir.rglob(f"cover.{ext}"):
                    if cand.exists() and cand.is_file():
                        return cand
        except Exception:
            return None

        return None

    def _calc_folder_size(self, base: Path) -> int:
        if not base.exists():
            return 0

        total = 0
        try:
            for p in base.rglob("*"):
                try:
                    if p.is_file():
                        total += p.stat().st_size
                except Exception:
                    continue
        except Exception:
            return 0

        return total

    def _format_size(self, size: int) -> str:
        if size <= 0:
            return "<1 MB"

        mb = size / (1024 * 1024)
        if mb < 1:
            return "<1 MB"
        if mb < 100:
            return f"{mb:.2f} MB"
        if mb < 1024:
            return f"{mb:.1f} MB"
        gb = mb / 1024
        return f"{gb:.2f} GB"

    def _load_json_with_fallback(self, file_path: Path) -> dict[str, Any] | None:
        try:
            raw = Path(file_path).read_bytes()
        except Exception:
            return None

        for enc in ("utf-8", "utf-8-sig", "gbk"):
            try:
                text = raw.decode(enc)
                data = json.loads(text)
                if isinstance(data, dict):
                    return data
                return {}
            except Exception:
                continue

        try:
            text = raw.decode("utf-8", errors="ignore")
            data = json.loads(text)
            if isinstance(data, dict):
                return data
            return {}
        except Exception:
            return None


class AuthorVoicepackService:
    def __init__(self, app_base_dir: Path, web_dir: Path):
        self.app_base_dir = Path(app_base_dir)
        self.web_dir = Path(web_dir)

        self.workspace_dir = self.app_base_dir / "AimerWT作者端"
        self.library_dir = self.workspace_dir / "语音包库"
        self.pending_dir = self.workspace_dir / "待解压区"

        self.workspace_dir.mkdir(parents=True, exist_ok=True)
        self.library_dir.mkdir(parents=True, exist_ok=True)
        self.pending_dir.mkdir(parents=True, exist_ok=True)

        self._lib_mgr = LibraryManager(pending_dir=str(self.pending_dir), library_dir=str(self.library_dir))
        self._default_cover = self.web_dir / "assets" / "card_image.png"
        preview_base_dir = self.app_base_dir.parent if (self.app_base_dir.parent / "tools").exists() else self.app_base_dir
        self._bank_preview_mgr = BankPreviewService(preview_base_dir)
        self._window = None
        self._audition_items_cache: dict[str, dict[str, Any]] = {}
        self._audition_scan_lock = threading.Lock()

    def set_window(self, window) -> None:
        self._window = window

    def get_workspace_info(self) -> dict[str, str]:
        return {
            "workspace_dir": str(self.workspace_dir),
            "library_dir": str(self.library_dir),
            "pending_dir": str(self.pending_dir),
        }

    def list_voicepacks(self, query: str = "") -> list[dict[str, Any]]:
        mods = self._lib_mgr.scan_library()
        q = str(query or "").strip().lower()
        rows: list[dict[str, Any]] = []

        for mod in mods:
            if q and q not in mod.lower():
                continue

            self._invalidate_cache(mod)
            details = self._lib_mgr.get_mod_details(mod)
            pack_dir = self._pack_dir(mod)
            info_file = self._find_info_file(pack_dir)

            cover_path = details.get("cover_path")
            if not cover_path or not os.path.exists(cover_path):
                cover_path = str(self._default_cover) if self._default_cover.exists() else ""

            rows.append({
                "name": mod,
                "title": str(details.get("title") or mod),
                "author": str(details.get("author") or "未知作者"),
                "version": str(details.get("version") or "1.0"),
                "date": str(details.get("date") or ""),
                "size_str": str(details.get("size_str") or "<1 MB"),
                "has_info": bool(info_file),
                "has_cover": bool(details.get("cover_path")),
                "info_file": str(info_file) if info_file else "",
                "cover_url": self._to_data_url(Path(cover_path)) if cover_path else "",
            })

        rows.sort(key=lambda x: x["name"].lower())
        return rows

    def create_voicepack_folder(self, folder_name: str) -> dict[str, Any]:
        safe_name = self._validate_pack_name(folder_name)
        target = self._pack_dir(safe_name)
        if target.exists():
            return {"success": False, "msg": "语音包文件夹已存在"}
        target.mkdir(parents=True, exist_ok=False)
        self._invalidate_cache()
        return {"success": True, "name": safe_name}

    def rename_voicepack_folder(self, old_name: str, new_name: str) -> dict[str, Any]:
        old_safe = self._validate_pack_name(old_name)
        new_safe = self._validate_pack_name(new_name)

        old_dir = self._pack_dir(old_safe)
        new_dir = self._pack_dir(new_safe)

        if not old_dir.exists():
            return {"success": False, "msg": "原语音包文件夹不存在"}
        if new_dir.exists():
            return {"success": False, "msg": "目标名称已存在"}

        old_dir.rename(new_dir)
        self._invalidate_cache()
        return {"success": True, "name": new_safe}

    def rename_voicepack_title(self, folder_name: str, new_title: str) -> dict[str, Any]:
        safe_name = self._validate_pack_name(folder_name)
        title = str(new_title or "").strip()
        if not title:
            return {"success": False, "msg": "语音包名称不能为空"}

        pack_dir = self._pack_dir(safe_name)
        if not pack_dir.exists():
            return {"success": False, "msg": "语音包文件夹不存在"}

        details = self._lib_mgr.get_mod_details(safe_name)
        info_file = self._find_info_file(pack_dir) or (pack_dir / "info.json")
        raw_payload = self._lib_mgr._load_json_with_fallback(info_file) or {}
        raw_payload["title"] = title
        normalized = self._normalize_payload(raw_payload, details, safe_name)
        normalized = self._persist_info_media_assets(pack_dir, normalized)
        self._write_info_json(pack_dir / "info.json", normalized)

        self._invalidate_cache(safe_name)
        return {"success": True, "name": safe_name, "title": title}

    def delete_voicepack_folder(self, folder_name: str) -> dict[str, Any]:
        safe_name = self._validate_pack_name(folder_name)
        target = self._pack_dir(safe_name)

        if not target.exists():
            return {"success": False, "msg": "语音包文件夹不存在"}

        self._remove_tree_safely(target)
        self._invalidate_cache()
        return {"success": True}

    def load_voicepack_for_edit(self, folder_name: str) -> dict[str, Any]:
        safe_name = self._validate_pack_name(folder_name)
        pack_dir = self._pack_dir(safe_name)
        if not pack_dir.exists():
            return {"success": False, "msg": "语音包文件夹不存在"}

        details = self._lib_mgr.get_mod_details(safe_name)
        info_file = self._find_info_file(pack_dir)

        created = False
        if not info_file:
            info_file = pack_dir / "info.json"
            payload = self._build_default_info_payload(safe_name, details)
            self._write_info_json(info_file, payload)
            created = True
        else:
            raw = self._lib_mgr._load_json_with_fallback(info_file) or {}
            payload = self._normalize_payload(raw, details, safe_name)
            self._write_info_json(info_file, payload)

        self._invalidate_cache(safe_name)
        refreshed = self._lib_mgr.get_mod_details(safe_name)
        raw_after = self._lib_mgr._load_json_with_fallback(info_file) or {}
        mod_data = self._normalize_payload(raw_after, refreshed, safe_name)

        if refreshed.get("cover_path"):
            mod_data["cover_url"] = self._to_data_url(Path(str(refreshed.get("cover_path") or "")))
        elif self._default_cover.exists():
            mod_data["cover_url"] = self._to_data_url(self._default_cover)
        else:
            mod_data["cover_url"] = ""

        mod_data["size_str"] = str(refreshed.get("size_str") or mod_data.get("size_str") or "<1 MB")
        mod_data["date"] = str(mod_data.get("date") or refreshed.get("date") or "")
        mod_data = self._hydrate_editor_media_payload(pack_dir, mod_data)

        return {
            "success": True,
            "mod_name": safe_name,
            "created": created,
            "info_file": str(info_file),
            "mod_data": mod_data,
        }

    def save_voicepack_info(self, folder_name: str, payload: dict[str, Any]) -> dict[str, Any]:
        safe_name = self._validate_pack_name(folder_name)
        pack_dir = self._pack_dir(safe_name)
        if not pack_dir.exists():
            return {"success": False, "msg": "语音包文件夹不存在"}

        current = self._lib_mgr.get_mod_details(safe_name)
        normalized = self._normalize_payload(payload or {}, current, safe_name)

        cover_data = str((payload or {}).get("cover_url") or "").strip()
        if cover_data.startswith("data:image/"):
            self._write_cover_from_data_url(pack_dir, cover_data)
        normalized = self._persist_info_media_assets(pack_dir, normalized)

        info_file = pack_dir / "info.json"
        self._write_info_json(info_file, normalized)

        self._invalidate_cache(safe_name)
        refreshed = self._lib_mgr.get_mod_details(safe_name)
        return {
            "success": True,
            "msg": "保存成功",
            "mod_name": safe_name,
            "size_str": str(refreshed.get("size_str") or "<1 MB"),
            "date": str(refreshed.get("date") or normalized.get("date") or ""),
        }

    def open_voicepack_library(self) -> dict[str, Any]:
        try:
            self._open_folder_cross_platform(self.library_dir)
            return {"success": True}
        except Exception as e:
            return {"success": False, "msg": str(e)}

    def open_voicepack_item(self, folder_name: str) -> dict[str, Any]:
        safe_name = self._validate_pack_name(folder_name)
        target = self._pack_dir(safe_name)
        if not target.exists():
            return {"success": False, "msg": "语音包文件夹不存在"}

        try:
            self._open_folder_cross_platform(target)
            return {"success": True}
        except Exception as e:
            return {"success": False, "msg": str(e)}

    def export_voicepack_bank(
        self,
        folder_name: str,
        package_name: str = "",
        export_mode: str = EXPORT_MODE_FULL,
    ) -> dict[str, Any]:
        safe_name = self._validate_pack_name(folder_name)
        pack_dir = self._pack_dir(safe_name)
        if not pack_dir.exists():
            return {"success": False, "msg": "语音包文件夹不存在"}

        details = self._lib_mgr.get_mod_details(safe_name)
        info_file = self._find_info_file(pack_dir) or (pack_dir / "info.json")
        raw_payload = self._lib_mgr._load_json_with_fallback(info_file) or {}
        normalized = self._normalize_payload(raw_payload, details, safe_name)
        normalized = self._persist_info_media_assets(pack_dir, normalized)
        self._write_info_json(pack_dir / "info.json", normalized)

        export_mode = self._normalize_export_mode(export_mode)
        out_name = self._normalize_export_bank_name(package_name or safe_name)
        package_files, external_files = self._collect_export_files(pack_dir, export_mode)

        if export_mode == EXPORT_MODE_SPLIT:
            export_dir = self._next_available_dir(self.pending_dir / safe_name)
            export_dir.mkdir(parents=True, exist_ok=False)
            out_path = export_dir / out_name
        else:
            export_dir = None
            out_path = self._next_available_path(self.pending_dir / out_name)

        temp_zip = out_path.with_suffix(".tmp.zip")

        try:
            with zipfile.ZipFile(temp_zip, "w", compression=zipfile.ZIP_DEFLATED) as zf:
                for file_path, arcname in package_files:
                    zf.write(file_path, arcname=arcname)
                if export_mode == EXPORT_MODE_FULL:
                    self._append_preview_bank_alias_entries(zf, pack_dir, normalized)
            os.replace(str(temp_zip), str(out_path))
            if export_mode == EXPORT_MODE_SPLIT and export_dir is not None:
                self._copy_export_files(pack_dir, export_dir, external_files)
        except Exception as e:
            try:
                if temp_zip.exists():
                    temp_zip.unlink()
            except Exception:
                pass
            if export_mode == EXPORT_MODE_SPLIT and export_dir is not None:
                self._remove_tree_safely(export_dir)
            return {"success": False, "msg": str(e)}

        result = {
            "success": True,
            "output_file": str(out_path),
            "file_name": out_path.name,
            "export_mode": export_mode,
        }
        if export_dir is not None:
            result["output_dir"] = str(export_dir)
            result["folder_name"] = export_dir.name
        return result

    def import_voicepack_bank(self, file_name: str, data_url: str) -> dict[str, Any]:
        raw_name = str(file_name or "").strip()
        if not raw_name:
            return {"success": False, "msg": "文件名不能为空"}
        if not self._has_aimerwt_marker(raw_name):
            return {"success": False, "msg": "文件名必须带 (AimerWT) 标记"}

        raw_bytes = self._decode_data_url_bytes(data_url)
        if raw_bytes is None:
            return {"success": False, "msg": "文件内容无效"}

        pack_name = self._extract_pack_name_from_bank(raw_name)
        try:
            safe_name = self._validate_pack_name(pack_name)
        except Exception as e:
            return {"success": False, "msg": str(e)}

        target = self._pack_dir(safe_name)
        if target.exists():
            return {"success": False, "msg": "同名语音包已存在"}
        target.mkdir(parents=True, exist_ok=False)

        try:
            with zipfile.ZipFile(io.BytesIO(raw_bytes), "r") as zf:
                self._extract_zip_safely(zf, target)
        except Exception as e:
            self._remove_tree_safely(target)
            return {"success": False, "msg": f"导入失败: {e}"}

        self._invalidate_cache()
        return {"success": True, "name": safe_name}

    @staticmethod
    def _resolve_mod_relative_path(mod_dir: Path, rel_path: str):
        rel = str(rel_path or "").replace("\\", "/").strip()
        if not rel:
            return None
        try:
            base = Path(mod_dir).resolve()
            target = (base / rel).resolve()
            target.relative_to(base)
            return target
        except Exception:
            return None

    @staticmethod
    def _get_mod_audition_cache_signature(mod_dir: Path) -> str:
        base = Path(mod_dir)
        rows = []
        try:
            if base.exists() and base.is_dir():
                for p in sorted(base.rglob("*.bank"), key=lambda x: str(x).lower()):
                    try:
                        if not p.is_file():
                            continue
                        rel = p.relative_to(base).as_posix().lower()
                        st = p.stat()
                        rows.append(f"{rel}|{st.st_mtime_ns}|{st.st_size}")
                    except Exception:
                        continue
        except Exception:
            pass
        if not rows:
            try:
                st = base.stat()
                rows.append(f"dir|{st.st_mtime_ns}|{st.st_size}")
            except Exception:
                rows.append("dir|0|0")
        return hashlib.sha1("\n".join(rows).encode("utf-8")).hexdigest()

    def _get_mod_audition_items(self, mod_id: str, progress_cb=None):
        mod_dir = self._pack_dir(mod_id)
        if not mod_dir.exists() or not mod_dir.is_dir():
            return None, {"success": False, "msg": "语音包不存在"}

        mod_sig = self._get_mod_audition_cache_signature(mod_dir)
        cached = self._audition_items_cache.get(mod_id)
        if cached and cached.get("sig") == mod_sig:
            return cached.get("items", []), None

        details = self._lib_mgr.get_mod_details(mod_id)
        groups = details.get("files") or []

        rel_to_type = {}
        for g in groups:
            t_code = str(g.get("code") or "").strip().lower()
            t_name = str(g.get("type") or "").strip() or t_code
            t_cls = str(g.get("cls") or "").strip()
            for rel in g.get("files", []):
                rp = str(rel).replace("\\", "/").strip()
                if rp:
                    rel_to_type[rp] = {"code": t_code, "name": t_name, "cls": t_cls}

        candidates = []
        for rel, t in rel_to_type.items():
            lp = rel.lower()
            if not lp.endswith(".bank"):
                continue
            if "/info/" in lp or lp.startswith("info/"):
                continue
            if lp.endswith("masterbank.bank"):
                continue
            candidates.append((rel, t))

        candidates = sorted(candidates, key=lambda x: (0 if x[0].lower().endswith(".assets.bank") else 1, x[0]))
        if not candidates:
            return None, {"success": False, "msg": "未找到可试听的 bank 文件"}

        all_items = []
        total_candidates = len(candidates)
        for idx, (rel, type_info) in enumerate(candidates, start=1):
            p = self._resolve_mod_relative_path(mod_dir, rel)
            if progress_cb and p is not None:
                progress = int(5 + (idx / max(1, total_candidates)) * 90)
                progress_cb(progress, f"正在扫描 {p.name} ({idx}/{total_candidates})")
            if p is None or not p.exists() or not p.is_file():
                continue
            if not self._bank_preview_mgr.is_supported_bank(p):
                continue
            try:
                streams = self._bank_preview_mgr.list_streams(p)
            except Exception:
                continue

            for s in streams:
                all_items.append(
                    {
                        "bank_rel": rel,
                        "bank_file": p.name,
                        "chunk_index": s.get("chunk_index"),
                        "stream_index": s.get("stream_index"),
                        "name": s.get("name") or f"stream_{s.get('stream_index')}",
                        "duration_sec": s.get("duration_sec") or 0.0,
                        "voice_type_code": type_info.get("code") or "unknown",
                        "voice_type_name": type_info.get("name") or "未分类",
                        "voice_type_cls": type_info.get("cls") or "default",
                    }
                )

        if not all_items:
            return None, {"success": False, "msg": "未解析到可试听语音，文件不正确"}

        self._audition_items_cache[mod_id] = {"sig": mod_sig, "items": all_items}
        return all_items, None

    @staticmethod
    def _build_audition_categories(items):
        grouped = defaultdict(lambda: {"code": "", "name": "", "cls": "default", "count": 0})
        for it in items:
            code = it.get("voice_type_code") or "unknown"
            row = grouped[code]
            row["code"] = code
            row["name"] = it.get("voice_type_name") or code
            row["cls"] = it.get("voice_type_cls") or "default"
            row["count"] += 1
        return sorted(grouped.values(), key=lambda x: x["name"])

    def _emit_audition_scan_update(self, mod_id: str):
        if not self._window:
            return
        try:
            with self._audition_scan_lock:
                state = dict(self._audition_items_cache.get(mod_id, {}))
            items = list(state.get("items", []))
            categories = self._build_audition_categories(items)
            payload = {
                "running": bool(state.get("running", False)),
                "done": bool(state.get("complete", False)),
                "paused": bool(state.get("paused", False)),
                "progress": int(state.get("progress", 0)),
                "message": str(state.get("message", "") or ""),
                "count": len(items),
                "category_count": len(categories),
                "categories": categories,
                "error": str(state.get("error", "") or ""),
            }
            mod_js = json.dumps(str(mod_id), ensure_ascii=False)
            payload_js = json.dumps(payload, ensure_ascii=False)
            self._window.evaluate_js(
                f"if(window.app && app.onAuditionScanUpdate) app.onAuditionScanUpdate({mod_js}, {payload_js})"
            )
        except Exception:
            pass

    def start_mod_audition_scan(self, mod_name):
        mod_id = self._validate_pack_name(mod_name)
        mod_dir = self._pack_dir(mod_id)
        if not mod_dir.exists() or not mod_dir.is_dir():
            return {"success": False, "msg": "语音包不存在"}

        mod_sig = self._get_mod_audition_cache_signature(mod_dir)
        need_emit = False
        with self._audition_scan_lock:
            state = self._audition_items_cache.get(mod_id)
            if state and state.get("sig") == mod_sig:
                if state.get("running"):
                    if state.get("paused"):
                        state["paused"] = False
                        state["message"] = "继续解析中..."
                        self._audition_items_cache[mod_id] = state
                        need_emit = True
                    return {"success": True, "running": True}
                if state.get("complete"):
                    need_emit = True
                    result = {"success": True, "running": False}
                else:
                    result = None
            else:
                result = None

            if result is None:
                self._audition_items_cache[mod_id] = {
                    "sig": mod_sig,
                    "items": [],
                    "running": True,
                    "complete": False,
                    "paused": False,
                    "progress": 1,
                    "message": "正在准备解析...",
                    "error": "",
                }
                need_emit = True
                result = {"success": True, "running": True}

        if need_emit:
            self._emit_audition_scan_update(mod_id)
        if result.get("running") is False:
            return result

        def _worker():
            try:
                details = self._lib_mgr.get_mod_details(mod_id)
                groups = details.get("files") or []
                rel_to_type = {}
                for g in groups:
                    t_code = str(g.get("code") or "").strip().lower()
                    t_name = str(g.get("type") or "").strip() or t_code
                    t_cls = str(g.get("cls") or "").strip()
                    for rel in g.get("files", []):
                        rp = str(rel).replace("\\", "/").strip()
                        if rp:
                            rel_to_type[rp] = {"code": t_code, "name": t_name, "cls": t_cls}

                candidates = []
                for rel, t in rel_to_type.items():
                    lp = rel.lower()
                    if not lp.endswith(".bank"):
                        continue
                    if "/info/" in lp or lp.startswith("info/"):
                        continue
                    if lp.endswith("masterbank.bank"):
                        continue
                    candidates.append((rel, t))
                candidates = sorted(candidates, key=lambda x: (0 if x[0].lower().endswith(".assets.bank") else 1, x[0]))
                total = len(candidates)
                if total <= 0:
                    with self._audition_scan_lock:
                        st = self._audition_items_cache.get(mod_id, {})
                        st.update({"running": False, "complete": True, "progress": 100, "message": "未找到可试听语音", "error": "未找到可试听的 bank 文件"})
                        self._audition_items_cache[mod_id] = st
                    self._emit_audition_scan_update(mod_id)
                    return

                parsed_items = []
                for idx, (rel, type_info) in enumerate(candidates, start=1):
                    while True:
                        with self._audition_scan_lock:
                            paused = bool(self._audition_items_cache.get(mod_id, {}).get("paused", False))
                            running = bool(self._audition_items_cache.get(mod_id, {}).get("running", False))
                        if not running:
                            return
                        if not paused:
                            break
                        with self._audition_scan_lock:
                            st = self._audition_items_cache.get(mod_id, {})
                            st.update({"message": "解析已暂停"})
                            self._audition_items_cache[mod_id] = st
                        self._emit_audition_scan_update(mod_id)
                        time.sleep(0.2)

                    p = self._resolve_mod_relative_path(mod_dir, rel)
                    progress = int(5 + (idx / max(1, total)) * 90)
                    if p is None or not p.exists() or not p.is_file() or not self._bank_preview_mgr.is_supported_bank(p):
                        with self._audition_scan_lock:
                            st = self._audition_items_cache.get(mod_id, {})
                            st.update({"items": parsed_items, "progress": progress, "message": f"跳过 {(p.name if p else rel)} ({idx}/{total})"})
                            self._audition_items_cache[mod_id] = st
                        self._emit_audition_scan_update(mod_id)
                        continue
                    try:
                        streams = self._bank_preview_mgr.list_streams(p)
                    except Exception:
                        streams = []

                    for s in streams:
                        parsed_items.append(
                            {
                                "bank_rel": rel,
                                "bank_file": p.name,
                                "chunk_index": s.get("chunk_index"),
                                "stream_index": s.get("stream_index"),
                                "name": s.get("name") or f"stream_{s.get('stream_index')}",
                                "duration_sec": s.get("duration_sec") or 0.0,
                                "voice_type_code": type_info.get("code") or "unknown",
                                "voice_type_name": type_info.get("name") or "未分类",
                                "voice_type_cls": type_info.get("cls") or "default",
                            }
                        )
                    with self._audition_scan_lock:
                        st = self._audition_items_cache.get(mod_id, {})
                        st.update(
                            {
                                "items": parsed_items,
                                "progress": progress,
                                "message": f"已解析 {idx}/{total} 个 bank，累计 {len(parsed_items)} 条语音",
                            }
                        )
                        self._audition_items_cache[mod_id] = st
                    self._emit_audition_scan_update(mod_id)

                with self._audition_scan_lock:
                    st = self._audition_items_cache.get(mod_id, {})
                    err = "" if parsed_items else "未解析到可试听语音，文件不正确"
                    st.update(
                        {
                            "items": parsed_items,
                            "running": False,
                            "complete": True,
                            "progress": 100,
                            "message": f"解析完成，共 {len(parsed_items)} 条语音",
                            "error": err,
                        }
                    )
                    self._audition_items_cache[mod_id] = st
                self._emit_audition_scan_update(mod_id)
            except Exception as e:
                with self._audition_scan_lock:
                    st = self._audition_items_cache.get(mod_id, {})
                    st.update({"running": False, "complete": True, "progress": 100, "message": "解析失败", "error": str(e)})
                    self._audition_items_cache[mod_id] = st
                self._emit_audition_scan_update(mod_id)

        threading.Thread(target=_worker, daemon=True).start()
        return {"success": True, "running": True}

    def set_mod_audition_scan_paused(self, mod_name, paused):
        mod_id = self._validate_pack_name(mod_name)
        with self._audition_scan_lock:
            st = self._audition_items_cache.get(mod_id)
            if not st:
                return {"success": False, "msg": "当前没有解析任务"}
            if st.get("complete"):
                return {"success": False, "msg": "解析已完成"}
            st["paused"] = bool(paused)
            st["message"] = "解析已暂停" if paused else "继续解析中..."
            self._audition_items_cache[mod_id] = st
        self._emit_audition_scan_update(mod_id)
        return {"success": True, "paused": bool(paused)}

    def stop_mod_audition_scan(self, mod_name):
        mod_id = self._validate_pack_name(mod_name)
        with self._audition_scan_lock:
            st = self._audition_items_cache.get(mod_id)
            if not st:
                return {"success": True, "stopped": False}
            st["running"] = False
            st["paused"] = False
            if not st.get("complete"):
                st["complete"] = True
                st["message"] = "已停止解析"
            self._audition_items_cache[mod_id] = st
        self._emit_audition_scan_update(mod_id)
        return {"success": True, "stopped": True}

    def get_mod_audition_categories_snapshot(self, mod_name):
        mod_id = self._validate_pack_name(mod_name)
        with self._audition_scan_lock:
            st = dict(self._audition_items_cache.get(mod_id, {}))
        items = list(st.get("items", []))
        categories = self._build_audition_categories(items)
        return {
            "success": True,
            "running": bool(st.get("running", False)),
            "done": bool(st.get("complete", False)),
            "paused": bool(st.get("paused", False)),
            "progress": int(st.get("progress", 0)),
            "message": str(st.get("message", "") or ""),
            "count": len(items),
            "category_count": len(categories),
            "categories": categories,
            "error": str(st.get("error", "") or ""),
        }

    def list_mod_audition_items_by_type(self, mod_name, voice_type_code):
        mod_id = self._validate_pack_name(mod_name)
        vt_code = str(voice_type_code or "").strip().lower()
        if not vt_code:
            return {"success": False, "msg": "参数不完整"}
        with self._audition_scan_lock:
            st = dict(self._audition_items_cache.get(mod_id, {}))
        items = list(st.get("items", []))
        if not items:
            if st.get("running"):
                return {"success": False, "msg": "该语音包仍在解析中，请稍后再试"}
            return {"success": False, "msg": "暂无可试听语音，请先开始解析"}

        pool = [it for it in items if str(it.get("voice_type_code") or "").lower() == vt_code]
        if not pool:
            return {"success": False, "msg": "该分类暂无可手动选择的语音"}
        pool = sorted(
            pool,
            key=lambda x: (
                str(x.get("name") or ""),
                str(x.get("bank_file") or ""),
                int(x.get("chunk_index") or 0),
                int(x.get("stream_index") or 0),
            ),
        )
        out_items = []
        for i, it in enumerate(pool, start=1):
            out_items.append(
                {
                    "id": f"{it.get('bank_rel')}|{it.get('chunk_index')}|{it.get('stream_index')}",
                    "index": i,
                    "name": it.get("name") or f"stream_{it.get('stream_index')}",
                    "duration_sec": it.get("duration_sec") or 0.0,
                    "bank_file": it.get("bank_file") or "",
                    "bank_rel": it.get("bank_rel") or "",
                    "chunk_index": int(it.get("chunk_index") or 0),
                    "stream_index": int(it.get("stream_index") or 0),
                }
            )
        return {"success": True, "count": len(out_items), "items": out_items}

    def audition_mod_random_by_type(self, mod_name, voice_type_code, max_seconds=12):
        try:
            mod_id = self._validate_pack_name(mod_name)
            vt_code = str(voice_type_code or "").strip().lower()
            if not vt_code:
                return {"success": False, "msg": "参数不完整"}

            with self._audition_scan_lock:
                st = dict(self._audition_items_cache.get(mod_id, {}))
            all_items = list(st.get("items", []))
            if not all_items:
                if st.get("running"):
                    return {"success": False, "msg": "该语音包仍在解析中，请稍后再试"}
                return {"success": False, "msg": "暂无可试听语音，请先开始解析"}

            pool = [it for it in all_items if str(it.get("voice_type_code") or "").lower() == vt_code]
            if not pool:
                return {"success": False, "msg": "该分类暂无可试听语音"}

            selected = random.choice(pool)
            sec = int(max_seconds) if max_seconds else 12
            sec = max(3, min(30, sec))
            mod_dir = self._pack_dir(mod_id)
            bank_path = self._resolve_mod_relative_path(mod_dir, selected.get("bank_rel") or "")
            if bank_path is None:
                return {"success": False, "msg": "参数不正确"}
            if not bank_path.exists() or not bank_path.is_file():
                return {"success": False, "msg": "bank 文件不存在"}

            ci = int(selected.get("chunk_index") or 0)
            si = int(selected.get("stream_index") or 0)
            audio_url = self._bank_preview_mgr.create_preview_data_url_for_stream(
                bank_path, chunk_index=ci, stream_index=si, max_seconds=sec
            )
            return {
                "success": True,
                "audio_url": audio_url,
                "voice_type_code": vt_code,
                "voice_type_name": selected.get("voice_type_name") or vt_code,
                "picked_name": selected.get("name") or f"stream_{si}",
                "bank_file": selected.get("bank_file") or bank_path.name,
                "seconds": sec,
            }
        except ValueError:
            return {"success": False, "msg": "文件不正确"}
        except RuntimeError as e:
            return {"success": False, "msg": str(e).strip() or "试听失败"}
        except Exception:
            return {"success": False, "msg": "试听失败"}

    def audition_mod_stream(self, mod_name, bank_rel, chunk_index, stream_index, max_seconds=12):
        try:
            mod_id = self._validate_pack_name(mod_name)
            rel = str(bank_rel or "").replace("\\", "/").strip()
            if not rel:
                return {"success": False, "msg": "参数不完整"}
            mod_dir = self._pack_dir(mod_id)
            bank_path = self._resolve_mod_relative_path(mod_dir, rel)
            if bank_path is None:
                return {"success": False, "msg": "参数不正确"}
            if not bank_path.exists() or not bank_path.is_file():
                return {"success": False, "msg": "bank 文件不存在"}
            try:
                ci = int(chunk_index)
                si = int(stream_index)
            except Exception:
                return {"success": False, "msg": "参数不正确"}
            sec = int(max_seconds) if max_seconds else 12
            sec = max(3, min(30, sec))
            audio_url = self._bank_preview_mgr.create_preview_data_url_for_stream(
                bank_path, chunk_index=ci, stream_index=si, max_seconds=sec
            )
            return {
                "success": True,
                "audio_url": audio_url,
                "bank_file": bank_path.name,
                "chunk_index": ci,
                "stream_index": si,
                "seconds": sec,
            }
        except ValueError:
            return {"success": False, "msg": "文件不正确"}
        except RuntimeError as e:
            return {"success": False, "msg": str(e).strip() or "试听失败"}
        except Exception:
            return {"success": False, "msg": "试听失败"}

    def audition_mod_preview_audio(self, mod_name, preview_index):
        try:
            mod_id = self._validate_pack_name(mod_name)
            idx = int(preview_index)
            details = self._lib_mgr.get_mod_details(mod_id)
            preview_items = details.get("preview_audio_files") or []
            if idx < 0 or idx >= len(preview_items):
                return {"success": False, "msg": "试听条目不存在"}
            item = preview_items[idx] or {}
            file_path = self._resolve_mod_relative_path(self._pack_dir(mod_id), item.get("source_file") or "")
            if file_path is None:
                return {"success": False, "msg": "参数不正确"}
            if not file_path.exists() or not file_path.is_file():
                return {"success": False, "msg": "试听文件不存在"}
            audio_url = self._read_audio_file_to_data_url(file_path)
            if not audio_url:
                return {"success": False, "msg": "试听文件格式不支持"}
            return {
                "success": True,
                "audio_url": audio_url,
                "preview_name": str(item.get("display_name") or file_path.stem),
                "source_name": str(item.get("source_name") or file_path.name),
            }
        except Exception:
            return {"success": False, "msg": "试听失败"}

    @staticmethod
    def _read_audio_file_to_data_url(file_path):
        try:
            p = Path(file_path)
            ext = p.suffix.lower().lstrip(".")
            mime_map = {"mp3": "audio/mpeg", "wav": "audio/wav"}
            mime = mime_map.get(ext)
            if not mime:
                return ""
            raw = p.read_bytes()
            b64 = base64.b64encode(raw).decode("utf-8")
            return f"data:{mime};base64,{b64}"
        except Exception:
            return ""

    def clear_audition_cache(self, mod_name=None):
        try:
            removed = self._bank_preview_mgr.clear_cache()
            return {"success": True, "removed": int(removed)}
        except Exception:
            return {"success": False, "msg": "清理试听缓存失败"}

    def _build_default_info_payload(self, mod_name: str, details: dict[str, Any]) -> dict[str, Any]:
        seed = {
            "title": str(details.get("title") or mod_name),
            "author": str(details.get("author") or ""),
            "version": self._normalize_version(details.get("version") or "1.0"),
            "date": str(details.get("date") or ""),
            "note": str(details.get("note") or ""),
            "full_desc": str(details.get("full_desc") or details.get("note") or ""),
            "version_note": details.get("version_note")
            or [{"version": self._normalize_version(details.get("version") or "1.0"), "note": ""}],
            "link_bilibili": str(details.get("link_bilibili") or ""),
            "link_qq_group": str(details.get("link_qq_group") or ""),
            "link_wtlive": str(details.get("link_wtlive") or ""),
            "link_liker": str(details.get("link_liker") or ""),
            "link_feedback": str(details.get("link_feedback") or ""),
            "link_video": str(details.get("link_video") or ""),
            "tags": details.get("tags") or [],
            "language": details.get("language") or [],
            "preview_use_random_bank": details.get("preview_use_random_bank"),
            "preview_audio_files": details.get("preview_audio_files") or [],
            "related_voicepacks": details.get("related_voicepacks") or [],
        }
        return self._normalize_payload(seed, details, mod_name)

    def _normalize_payload(self, payload: dict[str, Any], details: dict[str, Any], mod_name: str) -> dict[str, Any]:
        data = dict(payload or {})
        normalized: dict[str, Any] = {
            "title": str(data.get("title") or details.get("title") or mod_name).strip() or mod_name,
            "author": str(data.get("author") or details.get("author") or "").strip(),
            "version": self._normalize_version(data.get("version") or details.get("version") or "1.0"),
            "date": str(data.get("date") or details.get("date") or "").strip(),
            "note": str(data.get("note") or details.get("note") or "").strip(),
            "full_desc": str(data.get("full_desc") or details.get("full_desc") or data.get("note") or "").strip(),
            "version_note": self._normalize_version_notes(
                data.get("version_note"), data.get("version") or details.get("version") or "1.0"
            ),
            "link_bilibili": self._normalize_link(data.get("link_bilibili") or details.get("link_bilibili") or ""),
            "link_qq_group": self._normalize_link(data.get("link_qq_group") or details.get("link_qq_group") or ""),
            "link_wtlive": self._normalize_link(data.get("link_wtlive") or details.get("link_wtlive") or ""),
            "link_liker": self._normalize_link(data.get("link_liker") or details.get("link_liker") or ""),
            "link_feedback": self._normalize_link(data.get("link_feedback") or details.get("link_feedback") or ""),
            "link_video": self._normalize_link(data.get("link_video") or details.get("link_video") or ""),
            "tags": self._normalize_text_list(data.get("tags") or details.get("tags") or []),
            "language": self._normalize_text_list(data.get("language") or details.get("language") or [], max_items=3),
            "preview_use_random_bank": self._normalize_preview_use_random_bank(
                data.get("preview_use_random_bank"),
                details.get("preview_use_random_bank"),
                data.get("preview_audio_files") or details.get("preview_audio_files") or [],
            ),
            "preview_audio_files": self._normalize_preview_audio_items(data.get("preview_audio_files") or []),
            "related_voicepacks": self._normalize_related_voicepacks(data.get("related_voicepacks") or []),
        }

        if not normalized["tags"]:
            normalized["tags"] = ["陆战"]

        return {k: normalized[k] for k in SUPPORTED_INFO_KEYS}

    def _normalize_text_list(self, raw: Any, max_items: int | None = None) -> list[str]:
        if isinstance(raw, str):
            items = [x.strip() for x in re.split(r"[,\n，、；;]+", raw) if x.strip()]
        elif isinstance(raw, list):
            items = [str(x).strip() for x in raw if str(x).strip()]
        else:
            items = []

        unique: list[str] = []
        for item in items:
            if item not in unique:
                unique.append(item)

        if max_items is not None:
            unique = unique[:max_items]

        return unique

    def _normalize_version_notes(self, raw: Any, fallback_version: str) -> list[dict[str, str]]:
        notes: list[dict[str, str]] = []

        if isinstance(raw, list):
            for item in raw:
                if not isinstance(item, dict):
                    continue
                version = self._normalize_version(item.get("version") or fallback_version)
                note = str(item.get("note") or "").strip()
                if version or note:
                    notes.append({"version": version, "note": note})
        elif isinstance(raw, str):
            txt = raw.strip()
            if txt:
                notes.append({"version": self._normalize_version(fallback_version), "note": txt})

        if not notes:
            notes = [{"version": self._normalize_version(fallback_version), "note": ""}]

        return notes

    def _normalize_preview_audio_items(
        self,
        raw: Any,
        owner: str = "main",
        related_index: int = 0,
    ) -> list[dict[str, str]]:
        items = raw if isinstance(raw, list) else []
        out: list[dict[str, str]] = []
        for idx, item in enumerate(items[:MAX_PREVIEW_AUDIO_COUNT], start=1):
            if not isinstance(item, dict):
                continue
            display_name = str(item.get("display_name") or "").strip() or f"试听音频{idx}"
            source_name = str(item.get("source_name") or "").strip()
            source_file = str(item.get("source_file") or "").strip().replace("\\", "/")
            audio_data_url = str(item.get("audio_data_url") or "").strip()
            ext = self._normalize_audio_ext(item.get("ext"), source_name, source_file, audio_data_url)

            if owner == "main":
                output_bank_name = self._build_main_preview_bank_name(display_name, idx)
                canonical_source = self._build_main_preview_source_path(idx, ext)
            else:
                output_bank_name = self._build_related_preview_bank_name(related_index, display_name, idx)
                canonical_source = self._build_related_preview_source_path(related_index, idx, ext)

            row = {
                "display_name": display_name,
                "source_name": source_name or Path(source_file or canonical_source).name,
                "source_file": canonical_source,
                "output_bank_name": output_bank_name,
                "ext": ext,
            }
            if source_file and source_file != canonical_source:
                row["_legacy_source_file"] = source_file
            if audio_data_url.startswith("data:audio/"):
                row["audio_data_url"] = audio_data_url
            out.append(row)
        return out

    def _normalize_preview_use_random_bank(self, raw: Any, fallback: Any, preview_audio_files: Any) -> bool:
        if isinstance(raw, bool):
            return raw
        if isinstance(raw, (int, float)):
            return bool(raw)
        text = str(raw or "").strip().lower()
        if text in {"1", "true", "yes", "on", "random"}:
            return True
        if text in {"0", "false", "no", "off", "manual"}:
            return False
        if isinstance(fallback, bool):
            return fallback
        if isinstance(fallback, (int, float)):
            return bool(fallback)
        fallback_text = str(fallback or "").strip().lower()
        if fallback_text in {"1", "true", "yes", "on", "random"}:
            return True
        if fallback_text in {"0", "false", "no", "off", "manual"}:
            return False
        return not bool(preview_audio_files)

    def _normalize_related_voicepacks(self, raw: Any) -> list[dict[str, Any]]:
        rows = raw if isinstance(raw, list) else []
        out: list[dict[str, Any]] = []
        for idx, item in enumerate(rows[:MAX_RELATED_PACK_COUNT], start=1):
            if not isinstance(item, dict):
                continue
            name = str(item.get("name") or "").strip() or f"关联语音包{idx}"
            desc = str(item.get("description") or "").strip()[:MAX_RELATED_DESC_LENGTH]
            link = self._normalize_link(item.get("link") or "")
            avatar_url = str(item.get("avatar_url") or "").strip()
            avatar_file = str(item.get("avatar_file") or "").strip().replace("\\", "/")
            avatar_ext = self._normalize_image_ext(avatar_file, avatar_url)
            canonical_avatar_file = self._build_related_avatar_path(idx, avatar_ext)

            row: dict[str, Any] = {
                "name": name,
                "description": desc,
                "link": link,
                "avatar_file": canonical_avatar_file,
                "preview_audio_files": self._normalize_preview_audio_items(
                    item.get("preview_audio_files") or [], owner="related", related_index=idx
                ),
            }
            if avatar_file and avatar_file != canonical_avatar_file:
                row["_legacy_avatar_file"] = avatar_file
            if avatar_url.startswith("data:image/"):
                row["avatar_url"] = avatar_url
            out.append(row)
        return out

    def _normalize_audio_ext(self, ext: Any, source_name: str, source_file: str, data_url: str) -> str:
        candidate = str(ext or "").strip().lower().lstrip(".")
        if candidate not in ALLOWED_AUDIO_EXTS:
            for raw in (source_name, source_file):
                c = Path(str(raw or "")).suffix.lower().lstrip(".")
                if c in ALLOWED_AUDIO_EXTS:
                    candidate = c
                    break
        if candidate not in ALLOWED_AUDIO_EXTS and str(data_url or "").startswith("data:audio/"):
            m = re.match(r"^data:audio/([a-zA-Z0-9+.-]+);base64,", str(data_url), re.IGNORECASE)
            if m:
                mime_ext = m.group(1).lower()
                if mime_ext in {"mpeg", "mp3"}:
                    candidate = "mp3"
                elif mime_ext in {"wav", "x-wav", "wave"}:
                    candidate = "wav"
        if candidate not in ALLOWED_AUDIO_EXTS:
            candidate = "mp3"
        return candidate

    def _normalize_image_ext(self, source_file: str, data_url: str) -> str:
        ext = Path(str(source_file or "")).suffix.lower().lstrip(".")
        if ext in ALLOWED_IMAGE_EXTS:
            return ext
        if str(data_url or "").startswith("data:image/"):
            m = re.match(r"^data:image/([a-zA-Z0-9+.-]+);base64,", str(data_url), re.IGNORECASE)
            if m:
                mime_ext = m.group(1).lower()
                ext_map = {"jpeg": "jpg", "pjpeg": "jpg", "svg+xml": "svg"}
                mapped = ext_map.get(mime_ext, mime_ext)
                if mapped in ALLOWED_IMAGE_EXTS:
                    return mapped
        return "png"

    def _build_main_preview_source_path(self, index: int, ext: str) -> str:
        return f"_preview_assets/main_preview_{index:02d}.{ext}"

    def _build_related_preview_source_path(self, related_index: int, index: int, ext: str) -> str:
        return f"_preview_assets/related_{related_index:02d}_preview_{index:02d}.{ext}"

    def _build_related_avatar_path(self, related_index: int, ext: str) -> str:
        return f"_preview_assets/related_{related_index:02d}_avatar.{ext}"

    def _build_main_preview_bank_name(self, display_name: str, index: int) -> str:
        _ = display_name
        return f"AimerWT_Main_Preview_{index:02d}.bank"

    def _build_related_preview_bank_name(self, related_index: int, display_name: str, index: int) -> str:
        _ = display_name
        return f"AimerWT_Related_{related_index:02d}_Preview_{index:02d}.bank"

    def _normalize_version(self, value: Any) -> str:
        version = str(value or "1.0").strip()
        if version.lower().startswith("v"):
            version = version[1:]
        return version or "1.0"

    def _normalize_link(self, value: Any) -> str:
        link = str(value or "").strip()
        if not link:
            return ""
        if re.match(r"^https?://", link, re.IGNORECASE):
            return link
        return ""

    def _write_info_json(self, file_path: Path, payload: dict[str, Any]) -> None:
        file_path.parent.mkdir(parents=True, exist_ok=True)
        with open(file_path, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, indent=2)

    def _write_cover_from_data_url(self, pack_dir: Path, data_url: str) -> None:
        m = re.match(r"^data:image/([a-zA-Z0-9+.-]+);base64,(.+)$", data_url, re.DOTALL)
        if not m:
            return

        ext = m.group(1).lower()
        b64 = m.group(2)
        ext_map = {"jpeg": "jpg", "pjpeg": "jpg", "svg+xml": "svg"}
        ext = ext_map.get(ext, ext)
        if ext not in {"png", "jpg", "jpeg", "webp", "bmp", "gif", "svg"}:
            ext = "png"

        raw = base64.b64decode(b64)

        for old in ["cover.png", "cover.jpg", "cover.jpeg", "cover.webp", "cover.bmp", "cover.gif", "cover.svg"]:
            old_file = pack_dir / old
            if old_file.exists():
                try:
                    old_file.unlink()
                except Exception:
                    pass

        out = pack_dir / f"cover.{ext}"
        with open(out, "wb") as f:
            f.write(raw)

    def _persist_info_media_assets(self, pack_dir: Path, payload: dict[str, Any]) -> dict[str, Any]:
        data = json.loads(json.dumps(payload or {}, ensure_ascii=False))
        assets_dir = pack_dir / "_preview_assets"
        assets_dir.mkdir(parents=True, exist_ok=True)

        for item in data.get("preview_audio_files") or []:
            src_rel = str(item.get("source_file") or "").strip().replace("\\", "/")
            legacy_rel = str(item.get("_legacy_source_file") or "").strip().replace("\\", "/")
            audio_data_url = str(item.get("audio_data_url") or "").strip()
            if audio_data_url.startswith("data:audio/") and src_rel:
                self._write_data_url_file(pack_dir / src_rel, audio_data_url)
            elif src_rel and legacy_rel and src_rel != legacy_rel:
                self._copy_legacy_file_if_needed(pack_dir, legacy_rel, src_rel)

        for related in data.get("related_voicepacks") or []:
            avatar_rel = str(related.get("avatar_file") or "").strip().replace("\\", "/")
            legacy_avatar_rel = str(related.get("_legacy_avatar_file") or "").strip().replace("\\", "/")
            avatar_data_url = str(related.get("avatar_url") or "").strip()
            if avatar_data_url.startswith("data:image/") and avatar_rel:
                self._write_data_url_file(pack_dir / avatar_rel, avatar_data_url)
            elif avatar_rel and legacy_avatar_rel and avatar_rel != legacy_avatar_rel:
                self._copy_legacy_file_if_needed(pack_dir, legacy_avatar_rel, avatar_rel)

            for item in related.get("preview_audio_files") or []:
                src_rel = str(item.get("source_file") or "").strip().replace("\\", "/")
                legacy_rel = str(item.get("_legacy_source_file") or "").strip().replace("\\", "/")
                audio_data_url = str(item.get("audio_data_url") or "").strip()
                if audio_data_url.startswith("data:audio/") and src_rel:
                    self._write_data_url_file(pack_dir / src_rel, audio_data_url)
                elif src_rel and legacy_rel and src_rel != legacy_rel:
                    self._copy_legacy_file_if_needed(pack_dir, legacy_rel, src_rel)

        return self._strip_transient_media_fields(data)

    def _write_data_url_file(self, file_path: Path, data_url: str) -> None:
        m = re.match(r"^data:([a-zA-Z0-9+./-]+);base64,(.+)$", str(data_url or ""), re.DOTALL)
        if not m:
            return
        raw = base64.b64decode(m.group(2))
        file_path.parent.mkdir(parents=True, exist_ok=True)
        with open(file_path, "wb") as f:
            f.write(raw)

    def _strip_transient_media_fields(self, payload: dict[str, Any]) -> dict[str, Any]:
        data = json.loads(json.dumps(payload or {}, ensure_ascii=False))
        for item in data.get("preview_audio_files") or []:
            item.pop("audio_data_url", None)
            item.pop("_legacy_source_file", None)
        for related in data.get("related_voicepacks") or []:
            related.pop("avatar_url", None)
            related.pop("_legacy_avatar_file", None)
            for item in related.get("preview_audio_files") or []:
                item.pop("audio_data_url", None)
                item.pop("_legacy_source_file", None)
        return data

    def _hydrate_editor_media_payload(self, pack_dir: Path, payload: dict[str, Any]) -> dict[str, Any]:
        data = json.loads(json.dumps(payload or {}, ensure_ascii=False))
        for related in data.get("related_voicepacks") or []:
            avatar_rel = str(related.get("avatar_file") or "").strip()
            if avatar_rel:
                avatar_data = self._read_file_to_data_url(pack_dir / avatar_rel)
                if avatar_data:
                    related["avatar_url"] = avatar_data
        return data

    def _read_file_to_data_url(self, file_path: Path) -> str:
        try:
            p = Path(file_path)
            if not p.exists() or not p.is_file():
                return ""
            ext = p.suffix.lower().lstrip(".")
            mime_map = {
                "png": "image/png",
                "jpg": "image/jpeg",
                "jpeg": "image/jpeg",
                "webp": "image/webp",
                "bmp": "image/bmp",
                "gif": "image/gif",
                "svg": "image/svg+xml",
            }
            mime = mime_map.get(ext)
            if not mime:
                return ""
            raw = p.read_bytes()
            b64 = base64.b64encode(raw).decode("utf-8")
            return f"data:{mime};base64,{b64}"
        except Exception:
            return ""

    def _append_preview_bank_alias_entries(
        self,
        zf: zipfile.ZipFile,
        pack_dir: Path,
        payload: dict[str, Any],
    ) -> None:
        used_names: set[str] = set()
        base = pack_dir.resolve()
        for item in payload.get("preview_audio_files") or []:
            source_file = str(item.get("source_file") or "").strip()
            output_bank = str(item.get("output_bank_name") or "").strip()
            if not source_file or not output_bank:
                continue
            src = (pack_dir / source_file).resolve()
            if not str(src).lower().startswith(str(base).lower()):
                continue
            if not src.exists() or not src.is_file():
                continue
            alias = output_bank
            if alias in used_names:
                alias = self._next_dup_name(alias, used_names)
            used_names.add(alias)
            zf.write(src, arcname=f"preview_audio/{alias}")

        for related in payload.get("related_voicepacks") or []:
            for item in related.get("preview_audio_files") or []:
                source_file = str(item.get("source_file") or "").strip()
                output_bank = str(item.get("output_bank_name") or "").strip()
                if not source_file or not output_bank:
                    continue
                src = (pack_dir / source_file).resolve()
                if not str(src).lower().startswith(str(base).lower()):
                    continue
                if not src.exists() or not src.is_file():
                    continue
                alias = output_bank
                if alias in used_names:
                    alias = self._next_dup_name(alias, used_names)
                used_names.add(alias)
                zf.write(src, arcname=f"preview_audio/{alias}")

    def _copy_legacy_file_if_needed(self, pack_dir: Path, legacy_rel: str, target_rel: str) -> None:
        src = self._resolve_pack_relative_path(pack_dir, legacy_rel)
        dst = self._resolve_pack_relative_path(pack_dir, target_rel)
        if not src or not dst:
            return
        if not src.exists() or not src.is_file():
            return
        if dst.exists():
            return
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(src, dst)

    def _resolve_pack_relative_path(self, pack_dir: Path, rel_path: str) -> Path | None:
        rel = str(rel_path or "").strip().replace("\\", "/")
        if not rel:
            return None
        base = pack_dir.resolve()
        target = (pack_dir / rel).resolve()
        if not str(target).lower().startswith(str(base).lower()):
            return None
        return target

    def _next_dup_name(self, file_name: str, used: set[str]) -> str:
        stem = Path(file_name).stem
        suffix = Path(file_name).suffix
        idx = 2
        cand = file_name
        while cand in used:
            cand = f"{stem}_{idx}{suffix}"
            idx += 1
        return cand

    def _normalize_export_bank_name(self, raw_name: str) -> str:
        name = str(raw_name or "").strip()
        name = re.sub(r"\.(zip|bank)$", "", name, flags=re.IGNORECASE).strip()
        name = re.sub(r"[（(]\s*AimerWT(?:_JSON)?\s*[）)]", "", name, flags=re.IGNORECASE).strip()
        safe = self._validate_pack_name(name or "voicepack")
        return f"{safe}(AimerWT).bank"

    def _normalize_export_mode(self, raw_mode: str) -> str:
        mode = str(raw_mode or "").strip().lower()
        if mode == EXPORT_MODE_SPLIT:
            return EXPORT_MODE_SPLIT
        return EXPORT_MODE_FULL

    def _collect_export_files(
        self,
        pack_dir: Path,
        export_mode: str,
    ) -> tuple[list[tuple[Path, str]], list[tuple[Path, str]]]:
        package_files: list[tuple[Path, str]] = []
        external_files: list[tuple[Path, str]] = []

        for file_path in pack_dir.rglob("*"):
            if not file_path.is_file():
                continue
            arcname = file_path.relative_to(pack_dir).as_posix()
            if export_mode == EXPORT_MODE_FULL or self._should_include_in_split_bank(file_path):
                package_files.append((file_path, arcname))
            else:
                external_files.append((file_path, arcname))

        return package_files, external_files

    def _should_include_in_split_bank(self, file_path: Path) -> bool:
        ext = file_path.suffix.lower()
        return ext in EXPORT_CONFIG_EXTS or ext in EXPORT_IMAGE_EXTS

    def _copy_export_files(
        self,
        pack_dir: Path,
        export_dir: Path,
        files: list[tuple[Path, str]],
    ) -> None:
        base = pack_dir.resolve()
        for file_path, rel_path in files:
            src = file_path.resolve()
            if not str(src).lower().startswith(str(base).lower()):
                continue
            dst = export_dir / rel_path
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src, dst)

    def _next_available_path(self, path: Path) -> Path:
        if not path.exists():
            return path
        stem = path.stem
        suffix = path.suffix
        idx = 2
        while True:
            cand = path.with_name(f"{stem}_{idx}{suffix}")
            if not cand.exists():
                return cand
            idx += 1

    def _next_available_dir(self, path: Path) -> Path:
        if not path.exists():
            return path
        stem = path.name
        idx = 2
        while True:
            cand = path.with_name(f"{stem}_{idx}")
            if not cand.exists():
                return cand
            idx += 1

    def _has_aimerwt_marker(self, file_name: str) -> bool:
        return bool(re.search(r"[（(]\s*AimerWT(?:_JSON)?\s*[）)]", str(file_name or ""), flags=re.IGNORECASE))

    def _extract_pack_name_from_bank(self, file_name: str) -> str:
        stem = Path(str(file_name or "").strip()).stem
        stem = re.sub(r"[（(]\s*AimerWT(?:_JSON)?\s*[）)]", "", stem, flags=re.IGNORECASE).strip()
        return stem or "imported_voicepack"

    def _decode_data_url_bytes(self, data_url: str) -> bytes | None:
        raw = str(data_url or "").strip()
        m = re.match(r"^data:[^;]+;base64,(.+)$", raw, flags=re.DOTALL)
        if not m:
            return None
        try:
            return base64.b64decode(m.group(1))
        except Exception:
            return None

    def _extract_zip_safely(self, zf: zipfile.ZipFile, target_dir: Path) -> None:
        base = target_dir.resolve()
        for member in zf.infolist():
            name = str(member.filename or "").replace("\\", "/")
            if not name or name.endswith("/"):
                continue
            safe_rel = Path(name)
            dest = (base / safe_rel).resolve()
            if not str(dest).lower().startswith(str(base).lower()):
                raise ValueError("zip contains invalid path traversal")
            dest.parent.mkdir(parents=True, exist_ok=True)
            with zf.open(member, "r") as src, open(dest, "wb") as out:
                shutil.copyfileobj(src, out)

    def _find_info_file(self, pack_dir: Path) -> Path | None:
        candidates = [
            pack_dir / "info.json",
            pack_dir / "info" / "info.json",
        ]

        try:
            for pattern in BANK_NAME_PATTERNS:
                candidates.extend(list(pack_dir.glob(pattern)))
            if (pack_dir / "info").exists():
                for pattern in BANK_NAME_PATTERNS:
                    candidates.extend(list((pack_dir / "info").glob(pattern)))
        except Exception:
            pass

        for cand in candidates:
            if cand.exists() and cand.is_file():
                return cand

        try:
            info_jsons = [p for p in pack_dir.rglob("info.json") if p.is_file()]
            info_jsons.sort(key=lambda p: len(p.parts))
            if info_jsons:
                return info_jsons[0]
        except Exception:
            pass

        return None

    def _pack_dir(self, folder_name: str) -> Path:
        base = self.library_dir.resolve()
        target = (base / folder_name).resolve()
        if not str(target).lower().startswith(str(base).lower()):
            raise ValueError("非法路径")
        return target

    def _validate_pack_name(self, name: str) -> str:
        val = str(name or "").strip()
        if not val:
            raise ValueError("名称不能为空")
        if val in {".", ".."}:
            raise ValueError("名称非法")
        if any(ch in val for ch in ['\\', '/', ':', '*', '?', '"', '<', '>', '|']):
            raise ValueError("名称包含非法字符")
        return val

    def _to_data_url(self, image_path: Path) -> str:
        try:
            p = Path(image_path)
            if not p.exists() or not p.is_file():
                return ""

            ext = p.suffix.lower().replace(".", "")
            if ext == "jpg":
                ext = "jpeg"
            if ext == "svg":
                ext = "svg+xml"

            raw = p.read_bytes()
            b64 = base64.b64encode(raw).decode("utf-8")
            return f"data:image/{ext};base64,{b64}"
        except Exception:
            return ""

    def _open_folder_cross_platform(self, path: Path) -> None:
        p = str(path)
        if os.name == "nt":
            os.startfile(p)
            return
        if sys.platform == "darwin":
            subprocess.Popen(["open", p])
            return
        subprocess.Popen(["xdg-open", p])

    def _remove_tree_safely(self, path: Path) -> None:
        if not path.exists():
            return

        last_exc: Exception | None = None
        for _ in range(4):
            try:
                self._clear_readonly(path)
                for p in path.rglob("*"):
                    self._clear_readonly(p)
                shutil.rmtree(path)
                if not path.exists():
                    return
            except Exception as e:
                last_exc = e
            time.sleep(0.12)

        # Final fallback: manual deep delete with strict existence check.
        try:
            if path.exists():
                items = sorted(path.rglob("*"), key=lambda p: len(p.parts), reverse=True)
                for p in items:
                    try:
                        self._clear_readonly(p)
                        if p.is_file() or p.is_symlink():
                            p.unlink()
                        elif p.is_dir():
                            p.rmdir()
                    except Exception:
                        continue
                self._clear_readonly(path)
                if path.exists():
                    path.rmdir()
        except Exception as e:
            last_exc = e

        if path.exists():
            if last_exc:
                raise last_exc
            raise OSError(f"failed to remove folder: {path}")

    def _clear_readonly(self, path: Path) -> None:
        try:
            mode = path.stat().st_mode
            if not (mode & stat.S_IWRITE):
                path.chmod(mode | stat.S_IWRITE)
        except Exception:
            pass

    def _invalidate_cache(self, mod_name: str | None = None) -> None:
        try:
            if mod_name:
                cache = getattr(self._lib_mgr, "_details_cache", None)
                if isinstance(cache, dict):
                    cache.pop(mod_name, None)
            else:
                cache = getattr(self._lib_mgr, "_details_cache", None)
                if isinstance(cache, dict):
                    cache.clear()
            if hasattr(self._lib_mgr, "_scan_cache"):
                self._lib_mgr._scan_cache = None
            if hasattr(self._lib_mgr, "_last_scan_mtime"):
                self._lib_mgr._last_scan_mtime = 0
        except Exception:
            pass

