"""
toolbox_page.py  ——  作者端 v1 工具箱后端服务
功能：图片转 WebP（支持批量、质量设置、保存路径选择 / 替换原文件）
依赖：Pillow（已在 requirements.txt 中）
"""

from __future__ import annotations

import base64
import io
import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Any


# ---------- 支持的源格式 ----------
SUPPORTED_EXTS = {".png", ".jpg", ".jpeg", ".bmp", ".gif", ".tiff", ".tif", ".webp"}

# ---------- webp quality 范围 ----------
QUALITY_MIN = 1
QUALITY_MAX = 100
QUALITY_DEFAULT = 85


def _norm_quality(q: Any) -> int:
    try:
        q = int(q)
    except (TypeError, ValueError):
        q = QUALITY_DEFAULT
    return max(QUALITY_MIN, min(QUALITY_MAX, q))


def _is_supported(path: Path) -> bool:
    return path.suffix.lower() in SUPPORTED_EXTS


def _open_folder_in_explorer(folder: str) -> None:
    """在资源管理器中打开目录（Windows）"""
    try:
        if sys.platform == "win32":
            subprocess.Popen(["explorer", str(folder)])
        elif sys.platform == "darwin":
            subprocess.Popen(["open", str(folder)])
        else:
            subprocess.Popen(["xdg-open", str(folder)])
    except Exception:
        pass


def _convert_single(
    src: Path,
    dst: Path,
    quality: int,
    lossless: bool,
) -> dict:
    """转换单个文件，返回结果字典"""
    from PIL import Image  # 延迟导入，防止未安装时崩溃

    try:
        with Image.open(src) as img:
            # 处理调色板/RGBA透明度
            if img.mode in ("P", "PA"):
                img = img.convert("RGBA")
            elif img.mode not in ("RGB", "RGBA", "L", "LA"):
                img = img.convert("RGBA")

            save_kwargs: dict = {
                "format": "WEBP",
                "quality": quality,
                "lossless": lossless,
            }
            if img.mode == "RGBA":
                save_kwargs["method"] = 6
            dst.parent.mkdir(parents=True, exist_ok=True)
            img.save(dst, **save_kwargs)

        src_kb = src.stat().st_size / 1024
        dst_kb = dst.stat().st_size / 1024
        ratio = (1 - dst_kb / src_kb) * 100 if src_kb > 0 else 0
        return {
            "ok": True,
            "src": str(src),
            "dst": str(dst),
            "src_kb": round(src_kb, 1),
            "dst_kb": round(dst_kb, 1),
            "ratio": round(ratio, 1),
            "name": src.name,
        }
    except Exception as e:
        return {
            "ok": False,
            "src": str(src),
            "dst": "",
            "src_kb": 0,
            "dst_kb": 0,
            "ratio": 0,
            "name": src.name,
            "error": str(e),
        }


class ToolboxService:
    """工具箱服务，被 AppApi 持有"""

    def __init__(self) -> None:
        pass

    # ------------------------------------------------------------------
    # 公共 API（由 AppApi 转发给前端 pywebview js_api）
    # ------------------------------------------------------------------

    def convert_images_to_webp(self, payload: dict) -> dict:
        """
        批量转换图片为 WebP。

        payload 字段：
            files        : list[str]  —— 源文件绝对路径列表
            quality      : int        —— 1~100，默认 85
            lossless     : bool       —— 是否无损，默认 False
            save_mode    : str        —— "replace" | "beside" | "folder"
            output_folder: str        —— save_mode=="folder" 时的目标目录
        """
        files: list[str] = list(payload.get("files") or [])
        quality = _norm_quality(payload.get("quality", QUALITY_DEFAULT))
        lossless = bool(payload.get("lossless", False))
        save_mode = str(payload.get("save_mode", "beside")).strip()
        output_folder = str(payload.get("output_folder", "")).strip()

        if not files:
            return {"success": False, "msg": "未选择任何文件", "results": []}

        results = []
        for f in files:
            src = Path(f)
            if not src.exists() or not src.is_file():
                results.append({
                    "ok": False,
                    "src": f,
                    "dst": "",
                    "src_kb": 0,
                    "dst_kb": 0,
                    "ratio": 0,
                    "name": src.name,
                    "error": "文件不存在",
                })
                continue
            if not _is_supported(src):
                results.append({
                    "ok": False,
                    "src": f,
                    "dst": "",
                    "src_kb": 0,
                    "dst_kb": 0,
                    "ratio": 0,
                    "name": src.name,
                    "error": f"不支持的格式：{src.suffix}",
                })
                continue

            if save_mode == "replace":
                dst = src.with_suffix(".webp")
            elif save_mode == "folder":
                folder = Path(output_folder) if output_folder else src.parent
                dst = folder / (src.stem + ".webp")
            else:  # beside
                dst = src.parent / (src.stem + ".webp")

            result = _convert_single(src, dst, quality, lossless)

            # 替换模式：转换成功后删除原文件（若与 dst 不同）
            if save_mode == "replace" and result["ok"]:
                if src.suffix.lower() != ".webp":
                    try:
                        src.unlink()
                        result["replaced"] = True
                    except Exception as del_err:
                        result["replace_warn"] = str(del_err)

            results.append(result)

        success_cnt = sum(1 for r in results if r["ok"])
        fail_cnt = len(results) - success_cnt
        return {
            "success": True,
            "total": len(results),
            "success_cnt": success_cnt,
            "fail_cnt": fail_cnt,
            "results": results,
        }

    def open_output_folder(self, folder_path: str) -> dict:
        """打开输出目录"""
        folder = Path(folder_path)
        if not folder.exists():
            return {"success": False, "msg": "目录不存在"}
        _open_folder_in_explorer(str(folder))
        return {"success": True}

    def get_image_preview(self, file_path: str, max_size: int = 220) -> dict:
        """
        读取图片并返回缩略图 data URL（base64），用于前端预览。
        max_size: 缩略图最长边像素
        """
        try:
            from PIL import Image
            src = Path(file_path)
            if not src.exists() or not _is_supported(src):
                return {"success": False, "data_url": ""}
            with Image.open(src) as img:
                img.thumbnail((max_size, max_size), Image.LANCZOS)
                buf = io.BytesIO()
                fmt = "PNG" if img.mode == "RGBA" else "JPEG"
                img.save(buf, format=fmt, quality=80)
                b64 = base64.b64encode(buf.getvalue()).decode("ascii")
                mime = "image/png" if fmt == "PNG" else "image/jpeg"
            return {"success": True, "data_url": f"data:{mime};base64,{b64}"}
        except Exception as e:
            return {"success": False, "data_url": "", "error": str(e)}

    def select_output_folder(self) -> dict:
        """
        调用系统文件夹选择对话框（pywebview），返回选中路径。
        注意：需要在调用侧通过 window 对象调用，这里只提供路径格式化。
        """
        # 前端通过 pywebview create_file_dialog 处理，此处不需要实现
        return {"success": False, "msg": "请使用前端文件对话框"}
