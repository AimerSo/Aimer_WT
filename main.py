# 主程序入口与桌面桥接逻辑
# -*- coding: utf-8 -*-
import argparse
import base64
import csv
import copy
import hashlib
import itertools
import json
import os
import random
import re
import shutil
import sys
import tempfile
import threading
import time
import platform
import subprocess
import zipfile

# ==================== 控制台编码设置（已移至 utils.logger）====================
# 详细逻辑请参考 utils/logger.py 中的 _setup_console_encoding 函数


try:
    import webview
except Exception as _e:
    webview = None
    _WEBVIEW_IMPORT_ERROR = _e

from pathlib import Path
from collections import defaultdict
from services.config_manager import ConfigManager
from services.core_logic import CoreService
from services.library_manager import ArchivePasswordCanceled, LibraryManager
from utils.logger import setup_logger, get_logger, set_ui_callback
from services.sights_manager import SightsManager
from services.skins_manager import SkinsManager
from services.task_manager import TaskManager
from services.model_manager import ModelManager
from services.hangar_manager import HangarManager
from services.bank_preview_service import BankPreviewService
from services.tray_manager import tray_manager
from services.autostart_manager import autostart_manager
from services.telemetry_manager import (
    build_client_auth_headers,
    get_client_device_token,
    get_hwid,
    get_telemetry_connection_status,
    get_telemetry_manager,
    get_user_seq_id,
    init_telemetry,
    resolve_related_endpoint,
    resolve_client_auth_secret,
    resolve_service_base_url,
    submit_feedback,
)
from utils.utils import get_docs_data_dir
try:
    from services.theme_unlock import ThemeUnlockService
except Exception:
    ThemeUnlockService = None
from utils.custom_text_processor import extract_prefix_group
from utils.custom_text_importer import (
    extract_archive,
    detect_import_mode,
    match_csv_to_standard,
    find_csv_files_recursive,
    find_blk_files_recursive,
    extract_csv_references_from_blk,
    merge_csv_files,
)
from wt.wt_text import (
    load_csv_rows_with_fallback,
    list_lang_csv_files,
    list_lang_csv_files_with_status,
    sanitize_csv_file_name,
)

APP_VERSION = "3.0.0"
AGREEMENT_VERSION = "2026-01-10"
DEFAULT_PENDING_DIR_NAME = "待解压区"
DEFAULT_RESOURCE_ROOT_DIR_NAME = "AimerWT资源库"
DEFAULT_VOICE_LIBRARY_DIR_NAME = "WT语音包库"

# 资源目录定位：打包环境使用 _MEIPASS，开发环境使用源码目录
if getattr(sys, "frozen", False):
    BASE_DIR = Path(sys._MEIPASS)
else:
    BASE_DIR = Path(__file__).parent
WEB_DIR = BASE_DIR / "web"

log = get_logger(__name__)


class _ThemeUnlockFallbackService:
    """GitHub 公开版缺少口令模块时的降级实现。"""

    def __init__(self, config_manager):
        self._cfg_mgr = config_manager

    def is_hidden_theme(self, filename: str) -> bool:
        return False

    def is_theme_accessible(self, filename: str) -> bool:
        return True

    def filter_theme_list(self, theme_list: list[dict]) -> list[dict]:
        return theme_list

    def get_accessible_active_theme(self, filename: str) -> str:
        filename = str(filename or "default.json")
        theme_path = WEB_DIR / "themes" / filename
        return filename if theme_path.exists() else "default.json"

    def redeem_theme_code(self, code: str) -> dict:
        return {"success": False, "message": "GitHub版本不支持，请使用分发版本。"}

    def unlock_theme_by_name(self, filename: str) -> dict:
        filename = str(filename or "").strip()
        if not filename:
            return {"success": False, "message": "缺少主题文件名"}

        theme_path = WEB_DIR / "themes" / filename
        if not theme_path.exists():
            return {"success": False, "message": f"主题文件不存在: {filename}"}

        # 公开版没有隐藏主题模块时，允许已存在的主题平滑通过，避免服务端兑换成功后客户端报错。
        self._cfg_mgr.set_active_theme(filename)
        return {
            "success": True,
            "already_unlocked": True,
            "theme_file": filename,
            "message": "主题已可用",
        }

    def reset_unlocked_themes(self) -> bool:
        return self._cfg_mgr.set_unlocked_themes([])


def _is_localization_blk_modified_for_export(lang_dir: Path) -> bool:
    """
    判断 localization.blk 是否为“已修改”状态：
    1) 若存在 localization.blk.AimerWT.backup，则与当前内容比较；
    2) 若无 backup，则检测是否包含 %lang/aimerWT/*.csv 引用。
    """
    localization_blk = lang_dir / "localization.blk"
    if not localization_blk.exists() or not localization_blk.is_file():
        return False

    backup_blk = lang_dir / "localization.blk.AimerWT.backup"
    try:
        current_content = localization_blk.read_text(encoding="utf-8", errors="ignore")
    except Exception:
        return False

    if backup_blk.exists() and backup_blk.is_file():
        try:
            backup_content = backup_blk.read_text(encoding="utf-8", errors="ignore")
            return current_content != backup_content
        except Exception:
            pass

    return bool(re.search(r"%lang/aimerWT/[^\"\r\n]+?\.csv", current_content, flags=re.IGNORECASE))


def _collect_custom_text_export_items(lang_dir: Path) -> tuple[list[Path], list[Path]]:
    """
    收集自定义文本导出所需文件：
    - CSV: lang/aimerWT/*.csv
    - BLK: 仅当 localization.blk 被修改时导出 localization.blk
    """
    aimer_dir = lang_dir / "aimerWT"
    csv_files = sorted([p for p in aimer_dir.glob("*.csv") if p.is_file()], key=lambda p: p.name.lower())

    blk_files: list[Path] = []
    localization_blk = lang_dir / "localization.blk"
    if _is_localization_blk_modified_for_export(lang_dir) and localization_blk.exists() and localization_blk.is_file():
        blk_files.append(localization_blk)

    return csv_files, blk_files


def _show_fatal_error(title: str, message: str) -> None:
    """显示致命错误（尽量用系统对话框，失败则退回 stderr）。"""
    try:
        if sys.platform == "win32":
            import ctypes

            ctypes.windll.user32.MessageBoxW(None, str(message), str(title), 0x10)
            return
    except Exception:
        pass

    try:
        sys.stderr.write(f"{title}: {message}\n")
    except Exception:
        pass


def _install_global_exception_handlers() -> None:
    """将未捕获异常统一写入 app.log，避免只有 console 报错。"""

    def _excepthook(exc_type, exc, tb):
        if issubclass(exc_type, KeyboardInterrupt):
            sys.__excepthook__(exc_type, exc, tb)
            return

        try:
            fatal_log = get_logger("fatal")
            fatal_log.critical("未捕获异常", exc_info=(exc_type, exc, tb))
        except Exception:
            pass

        _show_fatal_error(
            "Aimer WT 发生错误",
            f"程序遇到未处理的错误而终止。\n\n"
            f"{exc_type.__name__}: {exc}\n\n"
            f"详细信息请查看 logs/app.log",
        )

    sys.excepthook = _excepthook

    # Python 3.8+：捕获 thread 未处理异常
    if hasattr(threading, "excepthook"):

        def _thread_excepthook(args):
            try:
                th_log = get_logger("thread")
                th_log.critical(
                    "后台线程未捕获异常: %s (%s)",
                    getattr(args.thread, "name", "<unknown>"),
                    getattr(args.thread, "ident", "?"),
                    exc_info=(args.exc_type, args.exc_value, args.exc_traceback),
                )
            except Exception:
                pass

        threading.excepthook = _thread_excepthook


def _windows_has_webview2_runtime() -> bool:
    """粗略检查 Windows 是否安装 WebView2 Runtime。

    pywebview 在缺少 WebView2 时可能回退到 MSHTML(IE) 内核，
    而本专案前端大量使用现代 JS（async/await、const 等），在 MSHTML 会直接失效，
    造成「按钮没反应 / 输入框无法互动」等现象。
    """
    if sys.platform != "win32":
        return True

    candidates = []
    pf_x86 = os.environ.get("ProgramFiles(x86)")
    pf = os.environ.get("ProgramFiles")
    if pf_x86:
        candidates.append(Path(pf_x86) / "Microsoft" / "EdgeWebView" / "Application")
    if pf:
        candidates.append(Path(pf) / "Microsoft" / "EdgeWebView" / "Application")

    for base in candidates:
        try:
            if not base.exists() or not base.is_dir():
                continue
            # Application\<version>\msedgewebview2.exe
            for sub in base.iterdir():
                exe = sub / "msedgewebview2.exe"
                if exe.exists():
                    return True
        except Exception:
            continue

    return False


def _open_url(url: str) -> bool:
    try:
        if sys.platform == "win32":
            # 使用系统预设浏览器 / 协议处理器
            subprocess.Popen(["cmd", "/c", "start", "", url], shell=False)
            return True
        if sys.platform == "darwin":
            subprocess.Popen(["open", url])
            return True
        subprocess.Popen(["xdg-open", url])
        return True
    except Exception:
        return False


def _launch_detached(args, *, cwd: str | None = None) -> None:
    """尽量以非阻塞、与宿主解耦的方式启动外部进程。"""
    popen_kwargs = {
        "cwd": cwd or None,
        "shell": False,
    }

    if sys.platform == "win32":
        popen_kwargs["creationflags"] = (
            getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
            | getattr(subprocess, "DETACHED_PROCESS", 0)
        )
        popen_kwargs["close_fds"] = False

    subprocess.Popen(args, **popen_kwargs)


def _parse_cli_args(argv: list[str] | None = None) -> argparse.Namespace:
    """解析启动参数（不使用环境变数）。"""
    if argv is None:
        argv = sys.argv[1:]

    # 不要让 argparse 在 GUI 程式中直接 sys.exit()
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--allow-fallback", action="store_true")
    parser.add_argument("--perf", action="store_true")
    parser.add_argument("--silent", action="store_true", help="静默启动，只显示托盘")
    parser.add_argument("--tray-only", action="store_true", help="仅启动托盘，不显示主窗口")

    try:
        args, _unknown = parser.parse_known_args(argv)
        return args
    except Exception:
        return argparse.Namespace(allow_fallback=False, perf=False, silent=False, tray_only=False)


class AppApi:
    # 提供前端可调用的后端 API 集合，并协调配置、库管理、安装与资源管理等模块。

    def __init__(self, *, perf_enabled: bool = False):
        # 初始化桥接层的状态、各业务管理器与日志系统。
        self._lock = threading.Lock()

        self._logger = setup_logger()
        self._client_diagnostic_log_path = self._initialize_client_diagnostic_log()

        self._perf_enabled = bool(perf_enabled)

        # 保存 PyWebview Window 引用（用于调用 evaluate_js 与打开系统对话框）

        # 连接 logger -> 前端 UI（窗口未创建时会自动忽略）
        set_ui_callback(self._append_log_to_ui)

        # _window 为私有变量，避免 pywebview 扫描序列化窗口对象导致递归错误
        self._window = None
        self._latest_server_config = None

        # 管理器实例：配置、语音包库、涂装、炮镜、游戏目录操作
        # 注意：所有管理器现在统一使用 logger.py 的日誌系统
        self._cfg_mgr = ConfigManager()
        if ThemeUnlockService is not None:
            self._theme_unlock = ThemeUnlockService(self._cfg_mgr)
        else:
            log.info("Theme unlock module unavailable; using GitHub fallback mode.")
            self._theme_unlock = _ThemeUnlockFallbackService(self._cfg_mgr)

        # 从配置读取自定义路径
        custom_pending = self._cfg_mgr.get_pending_dir()
        custom_library = self._cfg_mgr.get_library_dir()
        self._lib_mgr = LibraryManager(
            pending_dir=custom_pending if custom_pending else None,
            library_dir=custom_library if custom_library else None
        )

        self._skins_mgr = SkinsManager()
        self._sights_mgr = SightsManager()
        self._task_mgr = TaskManager()
        self._model_mgr = ModelManager()
        self._hangar_mgr = HangarManager()
        self._bank_preview_mgr = BankPreviewService(BASE_DIR)
        self._logic = CoreService()
        self._audition_items_cache = {}
        self._audition_scan_lock = threading.Lock()

        # ========== 本地测试配置 ==========
        # 设置为 True 启用本地遥测测试（连接 localhost:8082）
        # 正常上线时设置为 False，使用正式服务器
        self._local_telemetry_test = False
        # ==================================

        # 初始化遥测系统
        self._is_dev_mode = False
        self._initialize_telemetry()

        self._search_running = False
        self._is_busy = False
        self._password_event = threading.Event()
        self._password_lock = threading.Lock()
        self._password_value = None
        self._password_cancelled = False

        # 遥测消息去重
        self._last_alert_content = None  # 紧急通知 (弹窗)
        self._last_notice_content = None  # 公告栏 (左下角的)
        self._last_update_content = None  # 更新提示
        self._last_maintenance_status = None  # 维护模式
        self._last_announce_content = None  # 兼容以前的 key (可选)
        self._last_ad_carousel_state = None  # 广告轮播配置去重
        self._last_notice_items_state = None  # 公告列表配置去重
        self._last_user_feature_state = None  # 用户功能开关去重

        # 服务器数据缓存文件路径
        self._server_cache_file = Path(self._cfg_mgr.config_dir) / "server_cache.json"

    def _get_client_diagnostic_log_path(self) -> Path:
        log_dir = get_docs_data_dir() / "logs"
        log_dir.mkdir(parents=True, exist_ok=True)
        return log_dir / "AimerWT-Log.log"

    def _initialize_client_diagnostic_log(self) -> Path:
        path = self._get_client_diagnostic_log_path()
        try:
            if not path.exists() or path.stat().st_size == 0:
                path.write_text(
                    "AimerWT-Log 自动诊断日志\n"
                    f"启动时间: {time.strftime('%Y-%m-%d %H:%M:%S')}\n"
                    "说明: 该文件会在前端启动后自动持续写入，便于排查白屏等问题。\n\n",
                    encoding="utf-8",
                )
            else:
                with path.open("a", encoding="utf-8") as f:
                    f.write(f"\n\n[App Boot] {time.strftime('%Y-%m-%d %H:%M:%S')}\n")
            self._logger.info(f"AimerWT-Log 已初始化: {path}")
        except Exception as e:
            self._logger.warning(f"AimerWT-Log 初始化失败: {e}")
        return path

    def _resolve_telemetry_target_url(self):
        """解析当前应连接的遥测地址，并同步开发模式状态。"""
        dev_mode_file = Path(__file__).parent / ".dev_mode"
        dev_url = None
        if dev_mode_file.exists():
            try:
                raw = dev_mode_file.read_text(encoding="utf-8").strip()
                if raw.startswith("{"):
                    data = json.loads(raw)
                    dev_url = data.get("url", "")
                    dev_secret = data.get("client_secret", "")
                    if dev_secret:
                        os.environ["TELEMETRY_CLIENT_SECRET"] = dev_secret
                else:
                    dev_url = raw
            except Exception:
                dev_url = None

        self._is_dev_mode = False
        if dev_url:
            self._is_dev_mode = True
            return dev_url, f"[遥测] 开发模式已启用，连接 {dev_url}"

        if self._local_telemetry_test:
            self._is_dev_mode = True
            return "http://localhost:8082/telemetry", "[遥测] 本地测试模式已启用，连接 localhost:8082"

        return None, None

    def _initialize_telemetry(self):
        """初始化遥测实例，并在绑定回调后补拉一次当前配置。"""
        if not self._cfg_mgr.get_telemetry_enabled():
            return None

        telemetry_url, telemetry_message = self._resolve_telemetry_target_url()
        telemetry_manager = init_telemetry(APP_VERSION, telemetry_url, autostart=False)
        self._bind_telemetry_callbacks(telemetry_manager)

        # 回调必须先绑定，再启动首次上报，避免 pending_command 被服务端清掉后客户端却没接住。
        telemetry_manager.stop()
        telemetry_manager.start_heartbeat_loop()
        telemetry_manager.report_startup()

        if telemetry_message:
            self._logger.info(telemetry_message)
        return telemetry_manager

    def _bind_telemetry_callbacks(self, telemetry_manager):
        telemetry_manager.set_server_message_callback(self.on_server_message)
        telemetry_manager.set_user_command_callback(self.on_user_command)
        telemetry_manager.set_log_callback(self._logger)

    def _build_notice_items_apply_js(self, notice_items):
        items_json = json.dumps(notice_items, ensure_ascii=False)
        return (
            "(function(){"
            f"var items={items_json};"
            "function apply(){"
            "if(!window.app) return false;"
            "window.app.noticeData = items;"
            "window.app._noticeDataSource = 'remote';"
            "if(window.NoticeBoardModule && typeof window.NoticeBoardModule.renderNoticeBoard === 'function') {"
            "window.NoticeBoardModule.renderNoticeBoard(window.app);"
            "}"
            "return true;"
            "}"
            "if(apply()) return;"
            "var attempts = 0;"
            "var timer = window.setInterval(function(){"
            "attempts += 1;"
            "if(apply() || attempts >= 20){ window.clearInterval(timer); }"
            "}, 300);"
            "})();"
        )

    def _build_ad_carousel_apply_js(self, ad_items, ad_interval_ms):
        items_json = json.dumps(ad_items, ensure_ascii=False)
        interval_clause = ""
        if isinstance(ad_interval_ms, int) and ad_interval_ms > 0:
            interval_clause = f"window.AIMER_AD_CAROUSEL_CONFIG.autoPlayIntervalMs = {ad_interval_ms};"
        return (
            "(function(){"
            f"var items={items_json};"
            "function apply(){"
            "if(!window.AIMER_AD_CAROUSEL_CONFIG) return false;"
            "window.AIMER_AD_CAROUSEL_CONFIG.items = items;"
            f"{interval_clause}"
            "if(window.AdCarouselModule && typeof window.AdCarouselModule.refresh === 'function') {"
            "window.AdCarouselModule.refresh();"
            "}"
            "return true;"
            "}"
            "if(apply()) return;"
            "var attempts = 0;"
            "var timer = window.setInterval(function(){"
            "attempts += 1;"
            "if(apply() || attempts >= 20){ window.clearInterval(timer); }"
            "}, 300);"
            "})();"
        )

    def _build_header_banner_apply_js(self, banner_items, banner_interval):
        items_json = json.dumps(banner_items, ensure_ascii=False)
        interval_clause = ""
        if isinstance(banner_interval, int) and banner_interval > 0:
            interval_clause = (
                "if(window.HeaderBannerModule && window.HeaderBannerModule._setInterval) "
                f"window.HeaderBannerModule._setInterval({banner_interval * 1000});"
            )
        return (
            "(function(){"
            f"var items={items_json};"
            "function apply(){"
            "if(!window.HeaderBannerModule) return false;"
            "window.HeaderBannerModule.clearAnnouncement();"
            f"{interval_clause}"
            "items.forEach(function(item){"
            "if(!item || !item.text) return;"
            "window.HeaderBannerModule.pushAnnouncement(item.text, item.action || null, true);"
            "});"
            "return true;"
            "}"
            "if(apply()) return;"
            "var attempts = 0;"
            "var timer = window.setInterval(function(){"
            "attempts += 1;"
            "if(apply() || attempts >= 20){ window.clearInterval(timer); }"
            "}, 300);"
            "})();"
        )

    def _normalize_banner_payload(self, config: dict):
        raw_items = config.get("banner_items", [])
        raw_interval = config.get("banner_interval", 6)

        banner_interval = 6
        if isinstance(raw_interval, (int, float)) and not isinstance(raw_interval, bool):
            banner_interval = int(raw_interval) if int(raw_interval) > 0 else 6

        if not isinstance(raw_items, list):
            raw_items = []

        # 兼容旧的单条 notice 配置
        if not raw_items:
            notice_text = config.get("notice_content", "") or config.get("content", "")
            if notice_text:
                action_type = config.get("notice_action_type", "none")
                item = {"type": "announcement", "text": notice_text, "icon": "ri-megaphone-line"}
                if action_type == "url":
                    item["action"] = {"type": "url", "url": config.get("notice_action_url", "")}
                elif action_type == "alert":
                    item["action"] = {
                        "type": "alert",
                        "title": config.get("notice_action_title", "系统公告"),
                        "content": config.get("notice_action_content", notice_text),
                        "level": "info"
                    }
                raw_items = [item]

        normalized_items = []
        for item in raw_items:
            if not isinstance(item, dict):
                continue
            text = str(item.get("text", "") or "").strip()
            if not text:
                continue

            action_obj = item.get("action") if isinstance(item.get("action"), dict) else None
            if not action_obj:
                action_type = str(item.get("action_type", "none") or "none").strip().lower()
                if action_type == "url" and item.get("action_url"):
                    action_obj = {"type": "url", "url": item.get("action_url", "")}
                elif action_type == "alert":
                    action_obj = {
                        "type": "alert",
                        "title": item.get("action_title", "系统公告"),
                        "content": item.get("action_content", text),
                        "level": "info"
                    }

            normalized_item = {
                "type": str(item.get("type", "announcement") or "announcement"),
                "text": text,
                "icon": str(item.get("icon", "ri-megaphone-line") or "ri-megaphone-line"),
            }
            if action_obj:
                normalized_item["action"] = action_obj
            normalized_items.append(normalized_item)

        return normalized_items, banner_interval

    def _schedule_server_config_replay(self, delays=(0.8, 2.0, 4.0)):
        """在首页脚本陆续就绪后重放最近一次服务端配置。"""
        if not self._window or not isinstance(self._latest_server_config, dict):
            return

        latest_config = copy.deepcopy(self._latest_server_config)

        def _replay():
            for delay in delays:
                time.sleep(delay)
                if not self._window:
                    return
                try:
                    self._apply_server_message(copy.deepcopy(latest_config), force=True)
                except Exception:
                    log.debug("重放服务端配置失败", exc_info=True)

        threading.Thread(target=_replay, name="ServerConfigReplay", daemon=True).start()

    def _extract_user_feature_flags(self, config=None) -> dict:
        defaults = {
            "badge_system_enabled": True,
            "nickname_change_enabled": True,
            "avatar_upload_enabled": True,
            "notice_comment_enabled": True,
            "notice_reaction_enabled": True,
            "redeem_code_enabled": True,
            "feedback_enabled": True,
        }
        if not isinstance(config, dict):
            return defaults

        result = dict(defaults)
        for key in list(defaults.keys()):
            if key in config:
                result[key] = bool(config.get(key))
        return result

    def _apply_server_message(self, config: dict, force: bool = False):
        """将服务端配置应用到当前窗口。"""
        if not self._window or not isinstance(config, dict):
            return

        def safe_js_call(func_name, *args):
            # 将参数序列化为 JSON 字符串，确保特殊字符（引号、换行）被正确转义
            js_args = ", ".join([json.dumps(arg, ensure_ascii=False) for arg in args])
            return f"if(window.app && app.{func_name}) app.{func_name}({js_args})"

        try:
            # 0. 用户功能开关（优先注入，让设置页和公告弹窗及时响应）
            feature_flags = self._extract_user_feature_flags(config)
            feature_state = json.dumps(feature_flags, ensure_ascii=False, sort_keys=True)
            if force or self._last_user_feature_state != feature_state:
                self._window.evaluate_js(safe_js_call("applyServerUserFeatures", feature_flags))
                self._last_user_feature_state = feature_state

            # 1. 维护模式处理 (状态发生变化时才提示)
            is_maint = config.get("maintenance", False)
            maint_msg = config.get("maintenance_msg", "")
            maint_key = f"{is_maint}:{maint_msg}"

            if is_maint and (force or self._last_maintenance_status != maint_key):
                self._logger.warning(f"[SYS] ⚠️ 维护模式已开启: {maint_msg}")
                self._window.evaluate_js(safe_js_call("showWarnToast", "维护模式已开启", maint_msg, 8000))

            self._last_maintenance_status = maint_key

            # 2. 紧急通知弹窗 (Alert - 内容变化时才提示)
            if config.get("alert_active"):
                title = config.get("alert_title", "系统通知")
                content = config.get("alert_content", "")
                full_alert_key = f"{title}|{content}"

                if content and (force or self._last_alert_content != full_alert_key):
                    self._logger.info(f"[通知] {title}")
                    self._window.evaluate_js(safe_js_call("showAlert", title, content, "info"))
                    self._window.evaluate_js(
                        f"if(window.HeaderBannerModule) HeaderBannerModule.pushAnnouncement({json.dumps(content, ensure_ascii=False)})"
                    )
                    self._last_alert_content = full_alert_key

            # 3. Header Banner 信息带推送 (notice 通道，支持多条 banner_items)
            if config.get("notice_active"):
                banner_items, banner_interval = self._normalize_banner_payload(config)
                notice_key = json.dumps({
                    "items": banner_items,
                    "interval": banner_interval,
                }, ensure_ascii=False, sort_keys=True)
                if force or self._last_notice_content != notice_key:
                    self._window.evaluate_js(self._build_header_banner_apply_js(banner_items, banner_interval))
                    self._last_notice_content = notice_key
                    self._save_server_cache(
                        banner_payload={
                            "items": banner_items,
                            "interval": banner_interval,
                        }
                    )
            else:
                empty_notice_key = json.dumps({"items": [], "interval": 6}, ensure_ascii=False, sort_keys=True)
                if force or self._last_notice_content != empty_notice_key:
                    self._window.evaluate_js(self._build_header_banner_apply_js([], 6))
                    self._last_notice_content = empty_notice_key
                    self._save_server_cache(banner_payload={"items": [], "interval": 6})

            # 4. 更新提示（纯内存去重：激活时每次启动弹一次，会话内不重复）
            if config.get("update_active"):
                content = config.get("update_content", "")
                update_url = config.get("update_url", "")

                update_key = f"{content}|{update_url}"
                if content and (force or self._last_update_content != update_key):
                    self._logger.info(f"[更新] {content}")
                    self._window.evaluate_js(safe_js_call("showAlert", "发现新版本", content, "success", update_url))
                    self._window.evaluate_js(
                        f"if(window.HeaderBannerModule) HeaderBannerModule.pushUpdate({json.dumps(content, ensure_ascii=False)}, {json.dumps(update_url, ensure_ascii=False)})"
                    )
                    self._last_update_content = update_key

            # 5. 广告轮播远程覆盖
            ad_items = config.get("ad_carousel_items")
            ad_interval_ms = config.get("ad_carousel_interval_ms")
            if isinstance(ad_items, list):
                ad_state = json.dumps({
                    "items": ad_items,
                    "interval_ms": ad_interval_ms,
                }, ensure_ascii=False, sort_keys=True)
                if force or self._last_ad_carousel_state != ad_state:
                    self._window.evaluate_js(self._build_ad_carousel_apply_js(ad_items, ad_interval_ms))
                    self._last_ad_carousel_state = ad_state
                    self._save_server_cache(ad_carousel={"items": ad_items, "interval_ms": ad_interval_ms})

            # 5.5 信息库广告位远程覆盖
            kb_ads = config.get("knowledge_ads_items")
            if isinstance(kb_ads, dict) and isinstance(kb_ads.get("items"), list):
                kb_json = json.dumps(kb_ads, ensure_ascii=False)
                self._window.evaluate_js(
                    "(function(){"
                    f"var cfg={kb_json};"
                    "function apply(){"
                    "if(!window.AIMER_KNOWLEDGE_ADS_CONFIG) return false;"
                    "window.AIMER_KNOWLEDGE_ADS_CONFIG.items = cfg.items || [];"
                    "if(window.KnowledgeAdsModule && typeof window.KnowledgeAdsModule.refresh === 'function') {"
                    "window.KnowledgeAdsModule.refresh();"
                    "}"
                    "return true;"
                    "}"
                    "if(apply()) return;"
                    "var attempts = 0;"
                    "var timer = window.setInterval(function(){"
                    "attempts += 1;"
                    "if(apply() || attempts >= 20){ window.clearInterval(timer); }"
                    "}, 300);"
                    "})();"
                )

            # 6. 公告列表远程覆盖
            notice_items = config.get("notice_items")
            if isinstance(notice_items, list):
                notice_state = json.dumps(notice_items, ensure_ascii=False, sort_keys=True)
                if force or self._last_notice_items_state != notice_state:
                    mapped = []
                    for item in notice_items:
                        mapped.append({
                            "id": item.get("id"),
                            "type": item.get("type", "normal"),
                            "tag": item.get("tag", ""),
                            "title": item.get("title", ""),
                            "date": item.get("date", ""),
                            "summary": item.get("summary", ""),
                            "content": item.get("content", ""),
                            "isPinned": item.get("is_pinned", False),
                            "iconClass": item.get("icon_class", "")
                        })
                    self._window.evaluate_js(self._build_notice_items_apply_js(mapped))
                    self._last_notice_items_state = notice_state
                    self._save_server_cache(notice_items=mapped)

            # 6.5 公告表情反应摘要注入
            notice_reactions = config.get("notice_reactions")
            if isinstance(notice_reactions, list):
                reactions_json = json.dumps(notice_reactions, ensure_ascii=False)
                self._window.evaluate_js(
                    f"(function(){{ window._noticeReactionsData = {reactions_json}; }})()"
                )

            # 7. 项目状态远程控制
            project_status = config.get("project_status", "")
            project_last_update = config.get("project_last_update", "")
            status_map = {
                "active": {"class": "active", "text": "活跃开发中"},
                "warning": {"class": "warning", "text": "维护更新中"},
                "danger": {"class": "danger", "text": "暂停维护"},
            }
            if project_status and project_status in status_map:
                s = status_map[project_status]
                self._window.evaluate_js(
                    f"(function(){{ var b=document.getElementById('project-status-badge');"
                    f"if(b){{ b.className='status-badge {s['class']}'; b.textContent={json.dumps(s['text'], ensure_ascii=False)}; }} }})()"
                )
            if project_last_update:
                self._window.evaluate_js(
                    f"(function(){{ var el=document.getElementById('project-last-update');"
                    f"if(el) el.textContent={json.dumps(project_last_update, ensure_ascii=False)}; }})()"
                )

        except Exception as e:
            print(f"消息处理异常: {e}")

    def on_server_message(self, config: dict):
        """处理服务端下发的系统消息（公告/更新/维护）"""
        if isinstance(config, dict):
            self._latest_server_config = copy.deepcopy(config)
        self._apply_server_message(config)

    def on_user_command(self, cmd_json: str):
        """处理针对当前用户的特定指令驱动"""
        if not self._window:
            return

        import json
        try:
            cmd = json.loads(cmd_json)
            cmd_type = cmd.get("type")
            msg = cmd.get("message", "")

            # 序列化辅助
            def safe_js_call(func_name, *args):
                js_args = ", ".join([json.dumps(arg, ensure_ascii=False) for arg in args])
                return f"if(window.app && app.{func_name}) app.{func_name}({js_args})"

            if cmd_type == "popup":
                self._logger.info("[CMD] 收到系统通知")
                self._window.evaluate_js(safe_js_call("showAlert", "系统通知", msg, "info"))
            elif cmd_type == "toast":
                self._logger.info(f"[CMD] 收到管理员信息: {msg}")
                self._window.evaluate_js(safe_js_call("showWarnToast", "管理员消息", msg, 5000))
            elif cmd_type == "unlock_theme":
                theme_file = cmd.get("theme_file", "")
                if theme_file and self._theme_unlock:
                    result = self._theme_unlock.unlock_theme_by_name(theme_file)
                    if result.get("success"):
                        self._logger.info(f"[CMD] 主题已解锁: {theme_file}")
                        self._window.evaluate_js("if(window.app && app.loadThemeList) app.loadThemeList()")
                        self._window.evaluate_js(safe_js_call("showAlert", "🎉 感谢支持", "开发者已赠送您支持者专属主题，您可在设置中切换使用，感谢您的支持！", "success"))
            elif cmd_type == "redeem_result":
                success = cmd.get("success", False)
                title = cmd.get("title", "兑换结果")
                message = cmd.get("message", "")
                if success:
                    self._logger.info(f"[CMD] 兑换成功: {message}")
                    # 如果包含主题解锁，刷新主题列表
                    if cmd.get("theme_unlocked"):
                        theme_file = cmd.get("theme_file", "")
                        if theme_file and self._theme_unlock:
                            self._theme_unlock.unlock_theme_by_name(theme_file)
                        self._window.evaluate_js("if(window.app && app.loadThemeList) app.loadThemeList()")
                    self._window.evaluate_js(safe_js_call("showAlert", title, message, "success"))
                else:
                    self._window.evaluate_js(safe_js_call("showAlert", title, message, "error"))

        except Exception as e:
            print(f"专用指令解析异常: {e}")

    def set_window(self, window):
        # 绑定 PyWebview Window 实例到桥接层，供后续 API 调用使用。
        self._window = window
        # 注入上次服务器数据缓存，填补启动到首次服务器响应之间的空档
        self._inject_server_cache()
        # 重放最近一次服务器配置，覆盖窗口和首页脚本尚未就绪的时机差。
        self._schedule_server_config_replay()

    def _save_server_cache(self, notice_items=None, ad_carousel=None, banner_payload=None):
        """将服务器下发的公告/广告数据持久化到本地缓存文件（开发模式跳过）"""
        if getattr(self, '_is_dev_mode', False):
            return
        try:
            cache = self._load_server_cache()
            if notice_items is not None:
                cache["notice_items"] = notice_items
            if ad_carousel is not None:
                cache["ad_carousel"] = ad_carousel
            if banner_payload is not None:
                cache["banner_payload"] = banner_payload
            cache_file = self._server_cache_file
            cache_file.parent.mkdir(parents=True, exist_ok=True)
            tmp = cache_file.with_suffix('.tmp')
            with open(tmp, 'w', encoding='utf-8') as f:
                json.dump(cache, f, ensure_ascii=False)
            tmp.replace(cache_file)
        except Exception as e:
            log.debug(f"保存服务器缓存失败: {e}")

    def _load_server_cache(self):
        """读取本地缓存的服务器数据"""
        try:
            if self._server_cache_file.exists():
                with open(self._server_cache_file, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                if isinstance(data, dict):
                    return data
        except Exception as e:
            log.debug(f"读取服务器缓存失败: {e}")
        return {}

    def _inject_server_cache(self):
        """启动时从本地缓存注入公告/广告数据到前端（开发模式跳过）"""
        if getattr(self, '_is_dev_mode', False):
            return
        if not self._window:
            return

        def _do_inject():
            import time
            time.sleep(0.8)
            if not self._window:
                return
            try:
                cache = self._load_server_cache()

                # 注入缓存的公告数据
                cached_notices = cache.get("notice_items")
                if isinstance(cached_notices, list):
                    self._window.evaluate_js(self._build_notice_items_apply_js(cached_notices))
                    log.info(f"[缓存] 已注入 {len(cached_notices)} 条缓存公告")

                # 注入缓存的广告轮播数据
                cached_ad = cache.get("ad_carousel")
                if isinstance(cached_ad, dict):
                    ad_items = cached_ad.get("items")
                    ad_interval = cached_ad.get("interval_ms")
                    if isinstance(ad_items, list):
                        self._window.evaluate_js(self._build_ad_carousel_apply_js(ad_items, ad_interval))
                        log.info(f"[缓存] 已注入 {len(ad_items)} 条缓存广告")

                cached_banner = cache.get("banner_payload")
                if isinstance(cached_banner, dict):
                    banner_items = cached_banner.get("items")
                    banner_interval = cached_banner.get("interval")
                    if isinstance(banner_items, list):
                        self._window.evaluate_js(self._build_header_banner_apply_js(banner_items, banner_interval))
                        log.info(f"[缓存] 已注入 {len(banner_items)} 条缓存横幅公告")
            except Exception as e:
                log.debug(f"注入服务器缓存失败: {e}")

        t = threading.Thread(target=_do_inject, name="ServerCacheInject", daemon=True)
        t.start()

    def _load_json_with_fallback(self, file_path):
        # 按编码回退策略读取 JSON 文件并解析为 Python 对象。
        encodings = ["utf-8-sig", "utf-8", "cp950", "big5", "gbk"]
        for enc in encodings:
            try:
                with open(file_path, "r", encoding=enc) as f:
                    return json.load(f)
            except Exception:
                continue
        return None

    def _append_log_to_ui(self, formatted_message: str, record):
        """
        将 logger 的输出追加到前端日志面板。
        record: logging.LogRecord (从 logger.py 传入)
        """
        if not self._window:
            return

        # 1. 追加日志到面板
        try:
            safe_msg = formatted_message.replace("\r", "").replace("\n", "<br>")
            msg_js = json.dumps(safe_msg, ensure_ascii=True)
            self._window.evaluate_js(f"if(window.app && app.appendLog) app.appendLog({msg_js})")
        except Exception:
            # 避免在日志回调中抛异常导致业务中断
            log.exception("日志推送失败")

        # 2. 处理 Toast 通知：从消息内容探测 [SUCCESS]/[WARN]/[ERROR] 等自定义标签

        try:
            level_key = record.levelname  # INFO, WARNING, ERROR, DEBUG
            msg_content = record.getMessage()

            # 兼容：从消息内容解析 [SUCCESS] / [WARN] / [ERROR] 等标签
            # 如果消息里显式写了 [SUCCESS]，我们认为它是 SUCCESS 级别
            import re
            match = re.search(r"^\s*\[(SUCCESS|WARN|ERROR|INFO|SYS)]", msg_content)
            custom_tag = match.group(1) if match else None

            # 映射到前端 Toast 类型
            toast_level = None

            if custom_tag == "SUCCESS":
                toast_level = "SUCCESS"
            elif custom_tag in ("WARN", "WARNING"):
                toast_level = "WARN"
            elif custom_tag == "ERROR":
                toast_level = "ERROR"
            elif level_key == "WARNING":
                toast_level = "WARN"
            elif level_key == "ERROR":
                toast_level = "ERROR"

            # 如果有对应的 Toast 级别，则推送
            if toast_level:
                # 去除换行
                msg_plain = msg_content.replace("\r", " ").replace("\n", " ")
                # 去除可能的标签前缀 (可选，保留也无妨，前端只是显示文本)
                # msg_plain = re.sub(r"^\s*\[(SUCCESS|WARN|ERROR|INFO|SYS)\]\s*", "", msg_plain)

                msg_plain_js = json.dumps(msg_plain, ensure_ascii=True)
                level_js = json.dumps(toast_level, ensure_ascii=True)
                self._window.evaluate_js(
                    f"if(window.app && app.notifyToast) app.notifyToast({level_js}, {msg_plain_js})")

        except Exception:
            pass

    # --- 窗口控制 ---
    def toggle_topmost(self, is_top):
        def _update_topmost():
            if self._window:
                try:
                    self._window.on_top = is_top
                except Exception as e:
                    log.error(f"置顶设置失败: {e}")

        t = threading.Thread(target=_update_topmost)
        t.daemon = True
        t.start()
        return True

    def drag_window(self):
        # 预留接口：用于在支持的 PyWebview 模式下触发窗口拖拽。
        pass

    # --- 新增窗口控制 API ---
    def minimize_window(self):
        # 最小化当前窗口。
        if self._window:
            self._window.minimize()

    def close_window(self):
        # 关闭当前窗口并结束应用。
        if not self._window:
            return

        core_ready = True
        try:
            inner = getattr(self._window, "_window", None)
            webview_ctrl = getattr(inner, "webview", None)
            if webview_ctrl is not None and hasattr(webview_ctrl, "CoreWebView2"):
                if getattr(webview_ctrl, "CoreWebView2", None) is None:
                    core_ready = False
        except Exception:
            core_ready = False

        if not core_ready:
            os._exit(0)

        self._window.destroy()

    # --- 核心业务 API (供 JS 调用) ---
    def init_app_state(self):
        # 汇总并返回前端初始化所需状态，包括配置中的路径、主题、当前语音包与炮镜路径。
        path = self._cfg_mgr.get_game_path()
        theme = self._cfg_mgr.get_theme_mode()
        sights_path = self._cfg_mgr.get_sights_path()
        launch_mode = self._cfg_mgr.get_launch_mode()

        # 验证路径
        is_valid = False
        if path:
            is_valid, _ = self._logic.validate_game_path(path)
            if is_valid:
                log.info(f"[INIT] 已加载配置路径: {path}")
            else:
                log.warning(f"配置路径失效: {path}")

        if sights_path:
            try:
                self._sights_mgr.set_usersights_path(sights_path)
            except Exception as e:
                log.warning(f"炮镜路径失效: {e}")
                sights_path = ""
                self._cfg_mgr.set_sights_path("")

        active_theme = self._theme_unlock.get_accessible_active_theme(self._cfg_mgr.get_active_theme())
        if active_theme != self._cfg_mgr.get_active_theme():
            self._cfg_mgr.set_active_theme(active_theme)

        # 从遥测地址提取基地址（如 http://localhost:8082/telemetry → http://localhost:8082）
        telemetry_base_url = ""
        tm = get_telemetry_manager()
        if tm and tm.report_url:
            telemetry_base_url = resolve_service_base_url(tm.report_url)

        return {
            "game_path": path,
            "path_valid": is_valid,
            "theme": theme,
            "active_theme": active_theme,
            "installed_mods": self._logic.get_installed_mods(),
            "sights_path": sights_path,
            "launch_mode": launch_mode,
            "hwid": get_hwid(),
            "telemetry_enabled": self._cfg_mgr.get_telemetry_enabled(),
            "telemetry_connected": get_telemetry_connection_status(),
            "telemetry_base_url": telemetry_base_url,
            "server_user_features": self._extract_user_feature_flags(self._latest_server_config),
            "user_seq_id": get_user_seq_id(),
            "autostart_enabled": self._cfg_mgr.get_autostart_enabled(),
            "tray_mode": self._cfg_mgr.get_tray_mode(),
            "close_confirm": self._cfg_mgr.get_close_confirm()
        }

    def ensure_telemetry_ready(self, timeout_ms=2500):
        """
        尝试主动完成一次遥测握手，确保前端后续访问受保护的公告评论/互动接口时，
        已经具备 base_url、hwid 与设备令牌。
        """
        try:
            timeout_ms = int(timeout_ms or 0)
        except Exception:
            timeout_ms = 2500
        timeout_ms = max(0, min(timeout_ms, 8000))

        tm = get_telemetry_manager()
        base_state = self.init_app_state()
        requires_device_token = bool(resolve_client_auth_secret())

        def _build_state():
            state = self.init_app_state()
            has_device_token = bool(get_client_device_token())
            telemetry_base_url = str(state.get("telemetry_base_url") or "").strip()
            state["telemetry_has_device_token"] = has_device_token
            state["telemetry_ready"] = bool(telemetry_base_url) and (has_device_token or not requires_device_token)
            return state

        if not tm or not self._cfg_mgr.get_telemetry_enabled():
            return _build_state()

        if base_state.get("telemetry_ready"):
            return _build_state()

        try:
            tm.report_startup()
        except Exception:
            return _build_state()

        deadline = time.time() + (timeout_ms / 1000.0)
        while time.time() < deadline:
            state = _build_state()
            if state.get("telemetry_ready"):
                return state
            time.sleep(0.12)

        return _build_state()

    def save_theme_selection(self, filename):
        # 保存前端选择的主题文件名到配置。
        filename = self._theme_unlock.get_accessible_active_theme(filename)
        return self._cfg_mgr.set_active_theme(filename)

    def set_theme(self, mode):
        # 保存前端选择的主题模式（Light/Dark）到配置。
        self._cfg_mgr.set_theme_mode(mode)

    def set_launch_mode(self, mode):
        """
        功能定位:
        - 保存前端选择的启动方式。
        输入输出:
        - 参数: mode，启动方式 (launcher/steam/aces)。
        - 返回: bool，是否保存成功。
        """
        return self._cfg_mgr.set_launch_mode(mode)

    def start_game(self):
        """
        功能定位:
        - 依据配置启动 War Thunder。
        输入输出:
        - 参数: 无。
        - 返回: dict，包含 success 与可选 message。
        """
        try:
            game_path = self._cfg_mgr.get_game_path()
            if not game_path or not os.path.exists(game_path):
                self._logger.error("[ERROR] 无法启动游戏：路径无效")
                return {"success": False, "message": "游戏路径无效，请先重新选择路径。"}

            mode = self._cfg_mgr.get_launch_mode()
            game_root = Path(game_path)

            if mode == "steam":
                try:
                    self._logger.info("[INFO] 正在通过 Steam 启动 War Thunder ...")
                    if sys.platform == "win32":
                        _launch_detached(["cmd", "/c", "start", "", "steam://rungameid/236390"], cwd=str(game_root))
                    else:
                        if not _open_url("steam://rungameid/236390"):
                            raise RuntimeError("无法调用系统协议处理器打开 Steam。")
                    return {"success": True}
                except Exception as e:
                    self._logger.warning(f"[WARN] Steam 启动失败: {e}，尝试使用启动器...")

            launcher_exe = game_root / "launcher.exe"
            aces_exe_64 = game_root / "win64" / "aces.exe"
            aces_exe_32 = game_root / "win32" / "aces.exe"
            target_exe = None

            if mode == "aces":
                if aces_exe_64.exists():
                    target_exe = aces_exe_64
                elif aces_exe_32.exists():
                    target_exe = aces_exe_32
                elif launcher_exe.exists():
                    target_exe = launcher_exe
            else:
                if launcher_exe.exists():
                    target_exe = launcher_exe
                elif aces_exe_64.exists():
                    target_exe = aces_exe_64
                elif aces_exe_32.exists():
                    target_exe = aces_exe_32

            if target_exe:
                try:
                    self._logger.info(f"[INFO] 正在启动游戏: {target_exe.name} ...")
                    _launch_detached([str(target_exe)], cwd=str(game_root))
                    return {"success": True}
                except Exception as e:
                    self._logger.error(f"[ERROR] 启动失败: {e}", exc_info=True)
                    return {"success": False, "message": f"启动失败：{e}"}

            self._logger.error("[ERROR] 未找到游戏可执行文件 (launcher.exe / aces.exe)")
            return {"success": False, "message": "未找到游戏可执行文件（launcher.exe / aces.exe）。"}
        except Exception as e:
            self._logger.error(f"[ERROR] start_game 发生未处理异常: {e}", exc_info=True)
            return {"success": False, "message": f"启动游戏时发生异常：{e}"}

    def get_telemetry_status(self):
        """
        功能定位:
        - 获取当前遥测开启状态。
        """
        return self._cfg_mgr.get_telemetry_enabled()

    def get_telemetry_connection_status(self):
        """
        功能定位:
        - 获取当前与遥测服务端的连接状态。
        """
        return get_telemetry_connection_status()

    def set_telemetry_status(self, enabled):
        """
        功能定位:
        - 设置遥测开启状态，并实时启动/停止后台服务。
        """
        self._cfg_mgr.set_telemetry_enabled(enabled)

        if enabled:
            telemetry_url, telemetry_message = self._resolve_telemetry_target_url()
            tm = init_telemetry(APP_VERSION, telemetry_url, autostart=False)
            self._bind_telemetry_callbacks(tm)

            # 手动重启服务：先停止可能存在的旧循环，再启动新循环
            tm.stop()
            tm.start_heartbeat_loop()
            tm.report_startup()
            if telemetry_message:
                self._logger.info(telemetry_message)
            self._logger.info("[SYS] 遥测服务已启用")
        else:
            tm = get_telemetry_manager()
            if tm:
                tm.stop()
            self._logger.info("[SYS] 遥测服务已停用")

    def submit_feedback(self, contact, content, category="other"):
        """
        功能定位:
        - 接收前端反馈数据，异步提交到遥测服务器。
        输入输出:
        - 参数: contact(联系方式), content(反馈内容), category(分类: bug/suggestion/other)
        - 返回: dict，包含 submitted 状态。
        """
        if not content or not str(content).strip():
            return {"submitted": False, "message": "反馈内容不能为空"}

        if not self._cfg_mgr.get_telemetry_enabled():
            return {"submitted": False, "message": "遥测服务未启用，无法提交反馈"}

        def _on_result(success, message):
            if not self._window:
                return
            msg_js = json.dumps(message, ensure_ascii=False)
            if success:
                self._window.evaluate_js(
                    f"if(window.app) app.showInfoToast('反馈', {msg_js})"
                )
            else:
                self._window.evaluate_js(
                    f"if(window.app) app.showWarnToast('反馈', {msg_js})"
                )

        submit_feedback(contact, content, category, callback=_on_result)
        return {"submitted": True, "message": "正在提交…"}

    def get_telemetry_auth_headers(self, path, method="GET", machine_id=""):
        """
        供前端 JS 获取当前请求所需的遥测签名头。
        不包含浏览器禁止设置的 User-Agent。
        """
        tm = get_telemetry_manager()
        resolved_machine_id = str(machine_id or "").strip()
        if not resolved_machine_id and tm:
            try:
                resolved_machine_id = tm.get_machine_id()
            except Exception:
                resolved_machine_id = ""
        return build_client_auth_headers(path, method=method, machine_id=resolved_machine_id)

    def get_autostart_status(self):
        """
        功能定位:
        - 获取开机自启动状态。
        输入输出:
        - 返回: dict，包含 enabled 和 configured 状态。
        """
        return {
            "enabled": autostart_manager.is_enabled(),
            "configured": self._cfg_mgr.get_autostart_enabled()
        }

    def set_autostart_status(self, enabled):
        """
        功能定位:
        - 设置开机自启动状态。
        输入输出:
        - 参数:
          - enabled: bool，是否开启。
        - 返回: bool，操作是否成功。
        """
        # 静默启动（只显示托盘）
        success = autostart_manager.toggle(enabled, silent=True)
        if success:
            self._cfg_mgr.set_autostart_enabled(enabled)
            self._logger.info(f"[SYS] 开机自启动已{'开启' if enabled else '关闭'}")
        else:
            self._logger.error(f"[SYS] 设置开机自启动失败")
        return success

    def get_tray_mode_status(self):
        """
        功能定位:
        - 获取托盘模式状态。
        输入输出:
        - 返回: bool，是否启用托盘模式。
        """
        return self._cfg_mgr.get_tray_mode()

    def set_tray_mode_status(self, enabled):
        """
        功能定位:
        - 设置托盘模式状态。
        输入输出:
        - 参数:
          - enabled: bool，是否开启。
        """
        self._cfg_mgr.set_tray_mode(enabled)
        self._logger.info(f"[SYS] 托盘模式已{'开启' if enabled else '关闭'}")

    def get_close_confirm_status(self):
        """
        功能定位:
        - 获取关闭确认提示状态。
        输入输出:
        - 返回: bool，是否启用关闭确认提示。
        """
        return self._cfg_mgr.get_close_confirm()

    def set_close_confirm_status(self, enabled):
        """
        功能定位:
        - 设置关闭确认提示状态。
        输入输出:
        - 参数:
          - enabled: bool，是否开启。
        """
        self._cfg_mgr.set_close_confirm(enabled)
        self._logger.info(f"[SYS] 关闭确认提示已{'开启' if enabled else '关闭'}")

    def minimize_to_tray(self):
        """
        功能定位:
        - 最小化窗口到系统托盘。
        输入输出:
        - 无返回值。
        """
        if self._window:
            try:
                self._window.hide()
                self._logger.info("[SYS] 窗口已最小化到托盘")
            except Exception as e:
                self._logger.error(f"[SYS] 最小化到托盘失败: {e}")

    def exit_app(self):
        """
        功能定位:
        - 退出应用程序。
        输入输出:
        - 无返回值。
        """
        self._logger.info("[SYS] 用户请求退出程序")
        try:
            if self._window:
                self._window.destroy()
        except Exception:
            pass
        os._exit(0)

    def browse_folder(self):
        # 打开目录选择对话框，获取用户选择的游戏根目录并进行校验与保存。
        folder = self._window.create_file_dialog(webview.FileDialog.FOLDER)
        if folder and len(folder) > 0:
            path = folder[0].replace(os.sep, "/")
            valid, msg = self._logic.validate_game_path(path)
            if valid:
                self._cfg_mgr.set_game_path(path)
                log.info(f"[SUCCESS] 手动加载路径: {path}")
                return {"valid": True, "path": path}
            else:
                log.error(f"路径无效: {msg}")
                return {"valid": False, "path": path, "msg": msg}
        return None

    def get_installed_mods(self):
        """
        功能定位:
        - 获取当前已安装在游戏目录下的模块 ID 列表。
        输入输出:
        - 参数: 无
        - 返回: list[str]，已安装模块的 ID 集合。
        - 外部资源/依赖: CoreService.get_installed_mods
        实现逻辑:
        - 调用逻辑层的 get_installed_mods 接口并返回。
        业务关联:
        - 上游: 前端切换路径或执行安装/还原后，用于同步界面状态。
        - 下游: 无。
        """
        return self._logic.get_installed_mods()

    def log_message(self, level, message):
        """
        前端日志输出到后端。

        Args:
            level: 日志级别 (info, warning, error, debug)
            message: 日志消息
        """
        level_map = {
            'info': log.info,
            'warning': log.warning,
            'error': log.error,
            'debug': log.debug
        }
        log_func = level_map.get(level.lower(), log.info)
        log_func(message)

    def save_client_diagnostic_log(self, content):
        """将前端 AimerWT-Log 自动同步到本地文件。"""
        try:
            path = self._client_diagnostic_log_path or self._get_client_diagnostic_log_path()
            text = str(content or "")
            path.write_text(text, encoding="utf-8", errors="replace")
            return {"success": True, "path": str(path)}
        except Exception as e:
            self._logger.error(f"保存 AimerWT-Log 失败: {e}")
            return {"success": False, "message": str(e)}

    def start_auto_search(self):
        # 在后台线程执行游戏目录自动搜索，并将结果写入配置后通知前端更新显示。
        if self._search_running:
            return
        self._search_running = True

        def _run():
            log.debug("检索引擎初始化...")
            time.sleep(0.3)

            # 执行路径搜索
            found_path = self._logic.auto_detect_game_path()

            # 通过节流减少前端更新频率
            spinner = itertools.cycle(["|", "/", "—", "\\"])
            progress = 0
            update_interval = 0.15  # 每150ms更新一次UI
            last_update = time.time()

            while progress < 100:
                step = random.randint(3, 8)
                if 30 < progress < 50:
                    time.sleep(random.uniform(0.15, 0.25))
                    step = random.randint(8, 15)
                elif 80 < progress < 90:
                    time.sleep(random.uniform(0.25, 0.45))
                    step = 2
                else:
                    time.sleep(0.08)

                progress += step
                if progress > 100:
                    progress = 100

                # 只在达到更新间隔或完成时推送一次进度文本
                current_time = time.time()
                if current_time - last_update >= update_interval or progress >= 100:
                    char = next(spinner)
                    msg_js = json.dumps(
                        f"[扫描] 正在检索存储设备... [{char}] {progress}%",
                        ensure_ascii=False,
                    )
                    self._window.evaluate_js(f"app.updateSearchLog({msg_js})")
                    last_update = current_time

            time.sleep(0.3)
            if found_path:
                self._cfg_mgr.set_game_path(found_path)
                self._logic.validate_game_path(found_path)
                log.info("[SUCCESS] 自动搜索成功，路径已保存。")

                # 通知前端更新 UI
                path_js = json.dumps(found_path.replace(os.sep, "/"), ensure_ascii=False)
                self._window.evaluate_js(f"app.onSearchSuccess({path_js})")
            else:
                log.error("深度扫描未发现游戏客户端。")
                self._window.evaluate_js("app.onSearchFail()")
            self._search_running = False

        t = threading.Thread(target=_run)
        t.daemon = True
        t.start()

    def get_library_list(self, opts=None):
        # 扫描语音包库并返回每个语音包的详情列表，包含封面 data URL 以便前端直接渲染。
        t0 = time.perf_counter() if self._perf_enabled else None
        mods = self._lib_mgr.scan_library()
        result = []

        # 默认封面路径（当语音包未提供封面或封面文件不存在时使用）
        default_cover_path = WEB_DIR / "assets" / "card_image.png"

        for mod in mods:
            details = self._lib_mgr.get_mod_details(mod)

            # 1. 获取作者提供的封面路径
            cover_path = details.get("cover_path")
            details["cover_url"] = ""

            # 封面路径选择：优先使用语音包提供的封面，否则使用默认封面
            if not cover_path or not os.path.exists(cover_path):
                cover_path = str(default_cover_path)

            # 封面图片读取并转为 data URL
            if cover_path and os.path.exists(cover_path):
                try:
                    ext = os.path.splitext(cover_path)[1].lower().replace(".", "")
                    if ext == "jpg":
                        ext = "jpeg"
                    with open(cover_path, "rb") as f:
                        b64_data = base64.b64encode(f.read()).decode("utf-8")
                        details["cover_url"] = f"data:image/{ext};base64,{b64_data}"
                except Exception as e:
                    log.error(f"图片转码失败: {e}")

            # 补充 ID
            details["id"] = mod
            result.append(details)
        if self._perf_enabled and t0 is not None:
            dt_ms = (time.perf_counter() - t0) * 1000.0
            log.debug(f"[PERF] get_library_list {dt_ms:.1f}ms mods={len(result)}")
        return result

    def audition_mod(self, mod_name, max_seconds=12):
        """
        生成语音包试听音频（data URL）。
        """
        try:
            mod_id = str(mod_name or "").strip()
            if not mod_id:
                return {"success": False, "msg": "语音包名称为空"}

            mod_dir = self._lib_mgr.library_dir / mod_id
            if not mod_dir.exists() or not mod_dir.is_dir():
                return {"success": False, "msg": "语音包不存在"}

            details = self._lib_mgr.get_mod_details(mod_id)
            groups = details.get("files") or []

            candidates = []
            for g in groups:
                for rel in g.get("files", []):
                    rp = str(rel).replace("\\", "/").strip()
                    lp = rp.lower()
                    if not lp.endswith(".bank"):
                        continue
                    if "/info/" in lp or lp.startswith("info/"):
                        continue
                    candidates.append(rp)

            candidates.sort(key=lambda p: (0 if p.lower().endswith(".assets.bank") else 1, len(p)))
            if not candidates:
                return {"success": False, "msg": "未找到可试听的 bank 文件"}

            bank_path = None
            for rel in candidates:
                p = (mod_dir / rel).resolve()
                if p.exists() and p.is_file() and self._bank_preview_mgr.is_supported_bank(p):
                    bank_path = p
                    break

            if bank_path is None:
                return {"success": False, "msg": "不是支持的 FMOD bank"}

            sec = int(max_seconds) if max_seconds else 12
            sec = max(3, min(30, sec))
            audio_url = self._bank_preview_mgr.create_preview_data_url(bank_path, max_seconds=sec)
            return {
                "success": True,
                "audio_url": audio_url,
                "bank_file": bank_path.name,
                "seconds": sec,
            }
        except ValueError:
            return {"success": False, "msg": "文件不正确"}
        except RuntimeError as e:
            msg = str(e).strip() or "试听失败"
            return {"success": False, "msg": msg}
        except Exception as e:
            log.error(f"试听生成失败: {e}")
            return {"success": False, "msg": "试听生成失败"}

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
        mod_dir = self._lib_mgr.library_dir / mod_id
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
            p = (mod_dir / rel).resolve()
            if progress_cb:
                progress = int(5 + (idx / max(1, total_candidates)) * 90)
                progress_cb(progress, f"正在扫描 {p.name} ({idx}/{total_candidates})")
            if not p.exists() or not p.is_file():
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
        """
        启动语音包试听分类的后台增量解析；解析过程中会实时推送前端更新。
        """
        mod_id = str(mod_name or "").strip()
        if not mod_id:
            return {"success": False, "msg": "语音包名称为空"}

        mod_dir = self._lib_mgr.library_dir / mod_id
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
                    # 支持用户在前端暂停解析
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

                    p = (mod_dir / rel).resolve()
                    progress = int(5 + (idx / max(1, total)) * 90)
                    if not p.exists() or not p.is_file() or not self._bank_preview_mgr.is_supported_bank(p):
                        with self._audition_scan_lock:
                            st = self._audition_items_cache.get(mod_id, {})
                            st.update({"items": parsed_items, "progress": progress, "message": f"跳过 {p.name} ({idx}/{total})"})
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
                log.error(f"试听增量解析失败: {e}")

        t = threading.Thread(target=_worker, daemon=True)
        t.start()
        return {"success": True, "running": True}

    def set_mod_audition_scan_paused(self, mod_name, paused):
        """
        暂停或继续指定语音包的试听解析任务。
        """
        mod_id = str(mod_name or "").strip()
        if not mod_id:
            return {"success": False, "msg": "语音包名称为空"}
        want_pause = bool(paused)

        with self._audition_scan_lock:
            st = self._audition_items_cache.get(mod_id)
            if not st:
                return {"success": False, "msg": "当前没有解析任务"}
            if st.get("complete"):
                return {"success": False, "msg": "解析已完成"}
            st["paused"] = want_pause
            st["message"] = "解析已暂停" if want_pause else "继续解析中..."
            self._audition_items_cache[mod_id] = st

        self._emit_audition_scan_update(mod_id)
        return {"success": True, "paused": want_pause}

    def stop_mod_audition_scan(self, mod_name):
        """
        停止指定语音包的试听解析任务。
        """
        mod_id = str(mod_name or "").strip()
        if not mod_id:
            return {"success": False, "msg": "语音包名称为空"}

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
        """
        获取当前已解析的试听分类快照（可用于实时刷新）。
        """
        mod_id = str(mod_name or "").strip()
        if not mod_id:
            return {"success": False, "msg": "语音包名称为空"}
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
        """
        按指定 VoiceType 列出可手动选择的试听条目（用于作者专用试听类型）。
        """
        mod_id = str(mod_name or "").strip()
        vt_code = str(voice_type_code or "").strip().lower()
        if not mod_id or not vt_code:
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

    def clear_audition_cache(self, mod_name=None):
        """
        清理试听音频缓存文件。
        """
        try:
            removed = self._bank_preview_mgr.clear_cache()
            return {"success": True, "removed": int(removed)}
        except Exception as e:
            log.error(f"清理试听缓存失败: {e}")
            return {"success": False, "msg": "清理试听缓存失败"}

    def list_mod_audition_categories(self, mod_name):
        """
        按 VoiceType 返回可试听分类（不暴露具体语音列表）。
        """
        try:
            def _push_progress(pct: int, msg: str):
                if not self._window:
                    return
                try:
                    safe_pct = max(0, min(100, int(pct)))
                    msg_js = json.dumps(str(msg or ""), ensure_ascii=False)
                    self._window.evaluate_js(
                        f"if(window.MinimalistLoading) MinimalistLoading.update({safe_pct}, {msg_js})"
                    )
                except Exception:
                    pass

            mod_id = str(mod_name or "").strip()
            if not mod_id:
                return {"success": False, "msg": "语音包名称为空"}

            _push_progress(3, "正在解析语音包...")
            all_items, err = self._get_mod_audition_items(mod_id, progress_cb=_push_progress)
            if err:
                return err

            grouped = defaultdict(lambda: {"code": "", "name": "", "cls": "default", "count": 0})
            for it in all_items:
                code = it.get("voice_type_code") or "unknown"
                row = grouped[code]
                row["code"] = code
                row["name"] = it.get("voice_type_name") or code
                row["cls"] = it.get("voice_type_cls") or "default"
                row["count"] += 1

            categories = sorted(grouped.values(), key=lambda x: x["name"])
            _push_progress(100, f"解析完成，共 {len(categories)} 个分类")
            return {
                "success": True,
                "count": len(all_items),
                "category_count": len(categories),
                "categories": categories,
            }
        except Exception as e:
            log.error(f"试听分类枚举失败: {e}")
            return {"success": False, "msg": "试听分类枚举失败"}

    def audition_mod_random_by_type(self, mod_name, voice_type_code, max_seconds=12):
        """
        在指定 VoiceType 分类内随机抽取一条语音试听。
        """
        try:
            mod_id = str(mod_name or "").strip()
            vt_code = str(voice_type_code or "").strip().lower()
            if not mod_id or not vt_code:
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

            mod_dir = self._lib_mgr.library_dir / mod_id
            rel = str(selected.get("bank_rel") or "").replace("\\", "/")
            bank_path = self._resolve_mod_relative_path(mod_dir, rel)
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
        except Exception as e:
            log.error(f"分类随机试听失败: {e}")
            return {"success": False, "msg": "试听失败"}

    def audition_mod_stream(self, mod_name, bank_rel, chunk_index, stream_index, max_seconds=12):
        """
        按指定 bank/chunk/subsong 生成试听音频（data URL）。
        """
        try:
            mod_id = str(mod_name or "").strip()
            rel = str(bank_rel or "").replace("\\", "/").strip()
            if not mod_id or not rel:
                return {"success": False, "msg": "参数不完整"}

            mod_dir = self._lib_mgr.library_dir / mod_id
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
        except Exception as e:
            log.error(f"指定语音试听失败: {e}")
            return {"success": False, "msg": "试听失败"}

    def audition_mod_preview_audio(self, mod_name, preview_index):
        """
        播放作者手动提供的试听音频文件（mp3/wav）。
        """
        try:
            mod_id = str(mod_name or "").strip()
            if not mod_id:
                return {"success": False, "msg": "语音包名称为空"}

            try:
                idx = int(preview_index)
            except Exception:
                return {"success": False, "msg": "参数不正确"}

            details = self._lib_mgr.get_mod_details(mod_id)
            preview_items = details.get("preview_audio_files") or []
            if idx < 0 or idx >= len(preview_items):
                return {"success": False, "msg": "试听条目不存在"}

            item = preview_items[idx] or {}
            source_rel = str(item.get("source_file") or "").replace("\\", "/").strip()
            if not source_rel:
                return {"success": False, "msg": "试听文件未配置"}

            mod_dir = self._lib_mgr.library_dir / mod_id
            mod_dir_resolved = mod_dir.resolve()
            file_path = (mod_dir / source_rel).resolve()
            try:
                file_path.relative_to(mod_dir_resolved)
            except ValueError:
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
        except Exception as e:
            log.error(f"作者试听文件播放失败: {e}")
            return {"success": False, "msg": "试听失败"}

    @staticmethod
    def _read_audio_file_to_data_url(file_path):
        try:
            p = Path(file_path)
            ext = p.suffix.lower().lstrip(".")
            mime_map = {
                "mp3": "audio/mpeg",
                "wav": "audio/wav",
            }
            mime = mime_map.get(ext)
            if not mime:
                return ""
            raw = p.read_bytes()
            b64 = base64.b64encode(raw).decode("utf-8")
            return f"data:{mime};base64,{b64}"
        except Exception:
            return ""

    def open_folder(self, folder_type):
        # 按类型打开资源相关目录（待解压区/语音包库/游戏目录/UserSkins）。
        if folder_type == "pending":
            self._lib_mgr.open_pending_folder()
        elif folder_type == "library":
            self._lib_mgr.open_library_folder()
        elif folder_type == "game":
            path = self._cfg_mgr.get_game_path()
            if path and os.path.exists(path):
                try:
                    if platform.system() == "Windows":
                        os.startfile(path)
                    elif platform.system() == "Darwin":
                        subprocess.Popen(["open", path])
                    else:
                        subprocess.Popen(["xdg-open", path])
                except Exception as e:
                    log.error(f"打开游戏目录失败: {e}")
            else:
                log.warning("游戏路径无效或未设置")
        elif folder_type == "userskins":
            path = self._cfg_mgr.get_game_path()
            valid, _ = self._logic.validate_game_path(path)
            if not valid:
                log.warning("未设置有效游戏路径，无法打开 UserSkins")
                return
            userskins_dir = self._skins_mgr.get_userskins_dir(path)
            try:
                userskins_dir.mkdir(parents=True, exist_ok=True)
                os.startfile(str(userskins_dir))
            except Exception as e:
                log.error(f"打开 UserSkins 失败: {e}")
        elif folder_type == "user_missions":
            path = self._cfg_mgr.get_game_path()
            valid, _ = self._logic.validate_game_path(path)
            if not valid:
                log.warning("未设置有效游戏路径，无法打开 UserMissions")
                return
            user_missions_dir = Path(path) / "UserMissions"
            try:
                user_missions_dir.mkdir(parents=True, exist_ok=True)
                os.startfile(str(user_missions_dir))
            except Exception as e:
                log.error(f"打开 UserMissions 失败: {e}")
        elif folder_type == "task_library":
            self._task_mgr.open_task_library_folder()
        elif folder_type == "model_library":
            self._model_mgr.open_model_library_folder()
        elif folder_type == "hangar_library":
            self._hangar_mgr.open_hangar_library_folder()

        # 未列入允许名单的 folder_type 不执行任何操作

    def open_mod_folder(self, mod_name):
        # 打开语音包库中指定语音包目录。
        name = str(mod_name or "").strip()
        if not name:
            return {"success": False, "msg": "语音包名称为空"}

        try:
            library_dir = Path(self._lib_mgr.library_dir).resolve()
            target = (library_dir / name).resolve()
            if os.path.commonpath([str(target), str(library_dir)]) != str(library_dir):
                return {"success": False, "msg": "非法语音包路径"}
            if not target.exists() or not target.is_dir():
                return {"success": False, "msg": "语音包目录不存在"}

            if platform.system() == "Windows":
                os.startfile(str(target))
            elif platform.system() == "Darwin":
                subprocess.Popen(["open", str(target)])
            else:
                subprocess.Popen(["xdg-open", str(target)])
            return {"success": True}
        except Exception as e:
            log.error(f"打开语音包目录失败: {e}")
            return {"success": False, "msg": f"打开失败: {e}"}

    def open_external(self, url):
        """
        功能定位:
        - 在系统默认浏览器中打开指定的 URL。

        输入输出:
        - 参数:
          - url: str，要打开的链接。
        - 返回: None
        - 外部资源/依赖: os.startfile 或 webbrowser

        实现逻辑:
        - 校验协议，若无则补充 https://。
        - 使用 os.startfile (Windows) 打开连接。
        """
        if not url:
            return

        import re
        u = str(url).strip()
        if not re.match(r'^[a-zA-Z]+://', u):
            u = "https://" + u

        try:
            import os
            os.startfile(u)
        except Exception as e:
            self._logger.error(f"[ERROR] 无法打开链接: {e}")

    # --- 辅助方法 ---
    def update_loading_ui(self, progress, message):
        # 将进度与提示文本推送到前端加载组件 MinimalistLoading。
        if self._window:
            try:
                safe_msg = str(message).replace("\r", " ").replace("\n", " ")
                safe_progress = max(0, min(100, int(progress)))
                msg_js = json.dumps(safe_msg, ensure_ascii=True)
                self._window.evaluate_js(
                    f"if(window.MinimalistLoading) MinimalistLoading.update({safe_progress}, {msg_js})"
                )
            except Exception as e:
                log.error(f"Loading UI 更新失败: {e}")

    def submit_archive_password(self, password):
        # 接收前端输入的压缩包密码，并唤醒等待中的解压线程。
        with self._password_lock:
            self._password_value = "" if password is None else str(password)
            self._password_cancelled = False
            self._password_event.set()
        return True

    def cancel_archive_password(self):
        # 处理前端取消输入密码的动作，并唤醒等待中的解压线程。
        with self._password_lock:
            self._password_value = None
            self._password_cancelled = True
            self._password_event.set()
        return True

    def _request_archive_password(self, archive_name, error_hint=""):
        # 向前端弹出密码输入框，并阻塞等待用户输入或取消。
        if not self._window:
            return None
        with self._password_lock:
            self._password_event.clear()
            self._password_value = None
            self._password_cancelled = False
        name_js = json.dumps(str(archive_name or ""), ensure_ascii=False)
        err_js = json.dumps(str(error_hint or ""), ensure_ascii=False)
        self._window.evaluate_js(f"app.openArchivePasswordModal({name_js}, {err_js})")
        self._password_event.wait()
        with self._password_lock:
            if self._password_cancelled:
                return None
            return self._password_value

    def import_zips(self):
        # 将待解压区中的压缩包批量导入到语音包库，并将进度同步到前端加载组件。
        if self._is_busy:
            log.warning("另一个任务正在进行中，请稍候...")
            return
        self._is_busy = True

        # 显示加载组件（关闭自动模拟，由后端推送真实进度）
        if self._window:
            msg_js = json.dumps("正在准备导入...", ensure_ascii=False)
            self._window.evaluate_js(
                f"if(window.MinimalistLoading) MinimalistLoading.show(false, {msg_js})"
            )
            self.update_loading_ui(1, "开始扫描待解压区...")

        def _run():
            try:
                def password_provider(archive_path, reason):
                    hint = "密码错误，请重试" if reason == "incorrect" else ""
                    return self._request_archive_password(Path(archive_path).name, hint)

                self._lib_mgr.unzip_zips_to_library(
                    progress_callback=self.update_loading_ui,
                    password_provider=password_provider,
                )

                # 完成后通知前端刷新列表
                if self._window:
                    self._window.evaluate_js("app.refreshLibrary()")
                    msg_js = json.dumps("导入完成", ensure_ascii=False)
                    self._window.evaluate_js(
                        f"if(window.MinimalistLoading) MinimalistLoading.update(100, {msg_js})"
                    )
            except ArchivePasswordCanceled:
                log.warning("已取消输入密码，导入已终止")
                if self._window:
                    self._window.evaluate_js(
                        "if(window.MinimalistLoading) MinimalistLoading.hide()"
                    )
            except Exception as e:
                log.error(f"导入失败: {e}")
                if self._window:
                    msg_js = json.dumps("导入失败", ensure_ascii=False)
                    self._window.evaluate_js(
                        f"if(window.MinimalistLoading) MinimalistLoading.update(100, {msg_js})"
                    )
            finally:
                self._is_busy = False

        t = threading.Thread(target=_run)
        t.daemon = True  # 设置为守护线程
        t.start()

    def import_selected_zip(self):
        # 打开文件选择对话框导入单个 ZIP/RAR 到语音包库，并将进度同步到前端加载组件。
        if self._is_busy:
            log.warning("另一个任务正在进行中，请稍候...")
            return

        # 打开文件选择对话框（返回列表，即使为单选）
        file_types = (
            "Archive Files (*.zip;*.rar;*.7z;*.tar;*.gz;*.bz2;*.xz;*.tgz;*.tbz2;*.bank)",
            "Zip Files (*.zip)",
            "Rar Files (*.rar)",
            "7zip Files (*.7z)",
            "AimerWT Bank Files (*.bank)",
            "All files (*.*)"
        )

        # 使用 OPEN 对话框模式进行单文件选择
        result = self._window.create_file_dialog(
            webview.FileDialog.OPEN, allow_multiple=False, file_types=file_types
        )

        if result and len(result) > 0:
            zip_path = result[0]
            # log.info(f"准备导入: {zip_path}")
            self._is_busy = True

            # 显示加载条
            if self._window:
                msg_js = json.dumps(
                    f"准备导入: {Path(zip_path).name}", ensure_ascii=False
                )
                self._window.evaluate_js(
                    f"if(window.MinimalistLoading) MinimalistLoading.show(false, {msg_js})"
                )

            def _run():
                try:
                    self.update_loading_ui(1, f"正在读取: {Path(zip_path).name}")

                    def password_provider(archive_path, reason):
                        hint = "密码错误，请重试" if reason == "incorrect" else ""
                        return self._request_archive_password(Path(archive_path).name, hint)

                    self._lib_mgr.unzip_single_zip(
                        Path(zip_path),
                        progress_callback=self.update_loading_ui,
                        password_provider=password_provider,
                    )

                    # 完成后通知前端刷新列表
                    if self._window:
                        self._window.evaluate_js("app.refreshLibrary()")
                        msg_js = json.dumps("导入完成", ensure_ascii=False)
                        self._window.evaluate_js(
                            f"if(window.MinimalistLoading) MinimalistLoading.update(100, {msg_js})"
                        )
                except ArchivePasswordCanceled:
                    log.warning("已取消输入密码，导入已终止")
                    if self._window:
                        self._window.evaluate_js(
                            "if(window.MinimalistLoading) MinimalistLoading.hide()"
                        )
                except Exception as e:
                    log.error(f"导入失败: {e}")
                    if self._window:
                        msg_js = json.dumps("导入失败", ensure_ascii=False)
                        self._window.evaluate_js(
                            f"if(window.MinimalistLoading) MinimalistLoading.update(100, {msg_js})"
                        )
                finally:
                    self._is_busy = False

            t = threading.Thread(target=_run)
            t.daemon = True
            t.start()
        else:
            pass

    def import_voice_zip_from_path(self, zip_path):
        """导入指定路径的压缩包"""
        if self._is_busy:
            log.warning("另一个任务正在进行中，请稍候...")
            return False

        zip_path = str(zip_path)
        self._is_busy = True

        if self._window:
            msg_js = json.dumps(f"准备导入: {Path(zip_path).name}", ensure_ascii=False)
            self._window.evaluate_js(
                f"if(window.MinimalistLoading) MinimalistLoading.show(false, {msg_js})"
            )

        def _run():
            try:
                self.update_loading_ui(1, f"正在读取: {Path(zip_path).name}")

                def password_provider(archive_path, reason):
                    hint = "密码错误，请重试" if reason == "incorrect" else ""
                    return self._request_archive_password(Path(archive_path).name, hint)

                self._lib_mgr.unzip_single_zip(
                    Path(zip_path),
                    progress_callback=self.update_loading_ui,
                    password_provider=password_provider,
                )

                if self._window:
                    self._window.evaluate_js("app.refreshLibrary()")
                    msg_js = json.dumps("导入完成", ensure_ascii=False)
                    self._window.evaluate_js(
                        f"if(window.MinimalistLoading) MinimalistLoading.update(100, {msg_js})"
                    )
            except ArchivePasswordCanceled:
                log.warning("已取消输入密码，导入已终止")
                if self._window:
                    self._window.evaluate_js("if(window.MinimalistLoading) MinimalistLoading.hide()")
            except Exception as e:
                log.error(f"导入失败: {e}")
                if self._window:
                    msg_js = json.dumps("导入失败", ensure_ascii=False)
                    self._window.evaluate_js(
                        f"if(window.MinimalistLoading) MinimalistLoading.update(100, {msg_js})"
                    )
            finally:
                self._is_busy = False

        t = threading.Thread(target=_run)
        t.daemon = True
        t.start()
        return True

    # ===========================
    # 自定义文本（lang/menu.csv）
    # ===========================
    def _normalize_lang_header(self, value: str) -> str:
        if value is None:
            return ""
        return str(value).strip().strip('"').strip().strip("<>").strip()

    def _find_header_index(self, header_row: list[str], target_name: str) -> int:
        target = self._normalize_lang_header(target_name).lower()
        for idx, name in enumerate(header_row):
            if self._normalize_lang_header(name).lower() == target:
                return idx
        return -1

    def _ensure_test_localization_enabled(self, config_path: Path):
        if not config_path.exists():
            return False, "未找到 config.blk，无法自动开启 testLocalization。"

        try:
            content = config_path.read_text(encoding="utf-8", errors="ignore")
        except Exception as e:
            return False, f"读取 config.blk 失败: {e}"

        if "testLocalization:b=yes" in content:
            return True, "testLocalization 已开启。"

        new_content = content
        if "testLocalization:b=no" in new_content:
            new_content = new_content.replace("testLocalization:b=no", "testLocalization:b=yes")
        else:
            debug_open_pat = re.compile(r"(debug\s*\{)", re.IGNORECASE)
            if debug_open_pat.search(new_content):
                new_content = debug_open_pat.sub(r"\1\n  testLocalization:b=yes", new_content, count=1)
            else:
                suffix = "\n" if not new_content.endswith("\n") else ""
                new_content = f"{new_content}{suffix}\ndebug{{\n  testLocalization:b=yes\n}}\n"

        try:
            config_path.write_text(new_content, encoding="utf-8")
            return True, "已在 config.blk 写入 testLocalization:b=yes。"
        except Exception as e:
            return False, f"写入 config.blk 失败: {e}"

    def _ensure_custom_text_dir(self, lang_dir: Path) -> tuple[bool, str]:
        aimer_dir = lang_dir / "AimerWT"
        try:
            aimer_dir.mkdir(parents=True, exist_ok=True)
            return True, "已就绪"
        except Exception as e:
            return False, f"创建 lang/AimerWT 失败: {e}"

    def _redirect_localization_for_files(self, lang_dir: Path, changed_files: list[str]) -> tuple[bool, str]:
        if not changed_files:
            return True, "无路径变更"

        localization_blk = lang_dir / "localization.blk"
        if not localization_blk.exists():
            return False, "未找到 lang/localization.blk。"

        try:
            content = localization_blk.read_text(encoding="utf-8", errors="ignore")
        except Exception as e:
            return False, f"读取 localization.blk 失败: {e}"

        changed_set = {str(x).strip().lower() for x in changed_files if str(x).strip()}
        if not changed_set:
            return True, "无路径变更"

        changed_count = 0

        def _redirect_lang_ref(match: re.Match):
            nonlocal changed_count
            name = match.group(1).strip()
            if name.lower() in changed_set:
                changed_count += 1
                return f'%lang/aimerWT/{name}'
            return match.group(0)

        redirected = re.sub(
            r'%lang/(?:AimerWT/)?([^"\r\n]+?\.csv)',
            _redirect_lang_ref,
            content,
            flags=re.IGNORECASE
        )

        if redirected != content:
            backup = lang_dir / "localization.blk.AimerWT.backup"
            try:
                if not backup.exists():
                    backup.write_text(content, encoding="utf-8")
            except Exception:
                pass
            try:
                localization_blk.write_text(redirected, encoding="utf-8")
            except Exception as e:
                return False, f"写入 localization.blk 失败: {e}"

        return True, f"已更新 localization.blk（命中 {changed_count} 处）。"

    def get_custom_text_data(self, payload=None):
        if isinstance(payload, str):
            try:
                payload = json.loads(payload)
            except Exception:
                payload = None
        payload = payload if isinstance(payload, dict) else {}

        game_path = self._cfg_mgr.get_game_path()
        if not game_path:
            return {"success": False, "msg": "请先在主页设置游戏路径。"}

        valid, msg = self._logic.validate_game_path(game_path)
        if not valid:
            return {"success": False, "msg": msg or "游戏路径无效。"}

        game_root = Path(game_path)
        lang_dir = game_root / "lang"
        if not lang_dir.exists() or not lang_dir.is_dir():
            ok, info = self._ensure_test_localization_enabled(game_root / "config.blk")
            return {
                "success": False,
                "need_restart": True,
                "msg": "未检测到 lang 文件夹。已尝试开启 testLocalization，请启动一次游戏后再使用该功能。",
                "detail": info,
                "config_updated": bool(ok),
            }

        csv_files_info = list_lang_csv_files_with_status(lang_dir)
        if not csv_files_info:
            return {"success": False, "msg": "未找到 lang/*.csv，请先启动一次游戏。若您在启动游戏后看见此弹窗，请将lang文件夹清空，然后重启游戏"}

        csv_files = [f["name"] for f in csv_files_info]
        requested_csv = sanitize_csv_file_name(payload.get("csv_file", ""))
        selected_csv = requested_csv if requested_csv in csv_files else ("menu.csv" if "menu.csv" in csv_files else csv_files[0])
        source_csv = lang_dir / selected_csv

        # 使用功能时确保 lang/aimerWT 存在；读取优先副本，不强制改路径。
        ok, info = self._ensure_custom_text_dir(lang_dir)
        if not ok:
            return {"success": False, "msg": info}

        aimer_csv = lang_dir / "aimerWT" / selected_csv
        read_csv = aimer_csv if aimer_csv.exists() else source_csv

        try:
            rows, used_encoding = load_csv_rows_with_fallback(read_csv)
        except Exception as e:
            return {"success": False, "msg": f"读取 {selected_csv} 失败: {e}"}

        if not rows:
            return {"success": False, "msg": f"{selected_csv} 内容为空。"}

        header = rows[0]
        id_idx = self._find_header_index(header, "ID|readonly|noverify")
        if id_idx < 0:
            id_idx = 0

        language_keys = [
            "English", "French", "Italian", "German", "Spanish", "Russian", "Polish",
            "Czech", "Turkish", "Chinese", "Japanese", "Portuguese", "Ukrainian",
            "Serbian", "Hungarian", "Korean", "Belarusian", "Romanian", "TChinese",
            "HChinese", "Vietnamese"
        ]
        lang_indexes = {}
        for lk in language_keys:
            idx = self._find_header_index(header, lk)
            if idx >= 0:
                lang_indexes[lk] = idx

        if "Chinese" not in lang_indexes:
            # 非标准表头时，尽量给出可编辑列
            if len(header) > 1:
                fallback = self._normalize_lang_header(header[1]) or "Column2"
                lang_indexes[fallback] = 1
            else:
                return {"success": False, "msg": f"{selected_csv} 缺少可编辑语言列。"}

        default_language = "Chinese" if "Chinese" in lang_indexes else list(lang_indexes.keys())[0]

        # 读取原始文件以检测修改
        original_data = {}
        if aimer_csv.exists():
            try:
                original_rows, _ = load_csv_rows_with_fallback(source_csv)
                if original_rows and len(original_rows) > 1:
                    original_header = original_rows[0]
                    original_id_idx = self._find_header_index(original_header, "ID|readonly|noverify")
                    if original_id_idx < 0:
                        original_id_idx = 0

                    for lk in lang_indexes.keys():
                        original_lang_idx = self._find_header_index(original_header, lk)
                        if original_lang_idx >= 0:
                            for row in original_rows[1:]:
                                if row and original_id_idx < len(row):
                                    text_id = str(row[original_id_idx]).strip()
                                    if text_id:
                                        if text_id not in original_data:
                                            original_data[text_id] = {}
                                        original_data[text_id][lk] = str(row[original_lang_idx]) if original_lang_idx < len(row) else ""
            except Exception:
                pass

        groups_map = defaultdict(list)
        total = 0

        for row in rows[1:]:
            if not row:
                continue
            if id_idx >= len(row):
                continue
            text_id = str(row[id_idx]).strip()
            if not text_id:
                continue

            group = extract_prefix_group(text_id)
            lang_values = {}
            modified = False

            for lk, idx in lang_indexes.items():
                current_value = str(row[idx]) if idx < len(row) else ""
                lang_values[lk] = current_value

                # 检测是否修改
                if text_id in original_data and lk in original_data[text_id]:
                    if original_data[text_id][lk] != current_value:
                        modified = True

            groups_map[group].append({
                "id": text_id,
                "value": lang_values.get(default_language, ""),
                "languages": lang_values,
                "modified": modified
            })
            total += 1

        # 对每个分组内的项目排序：已修改的在前
        for group_items in groups_map.values():
            group_items.sort(key=lambda x: (not x.get("modified", False), x["id"].lower()))

        groups = [{"group": k, "items": v} for k, v in sorted(groups_map.items(), key=lambda x: x[0].lower())]
        return {
            "success": True,
            "menu_csv": str(read_csv),
            "csv_file": selected_csv,
            "csv_files": csv_files_info,
            "encoding": used_encoding,
            "language_keys": list(lang_indexes.keys()),
            "default_language": default_language,
            "groups": groups,
            "total": total,
            "workspace_info": info
        }

    def save_custom_text_data(self, payload):
        if isinstance(payload, str):
            try:
                payload = json.loads(payload)
            except Exception:
                return {"success": False, "msg": "参数格式错误。"}

        if not isinstance(payload, dict):
            return {"success": False, "msg": "参数格式错误。"}

        language = str(payload.get("language") or "Chinese")
        csv_file = sanitize_csv_file_name(payload.get("csv_file", ""))
        entries = payload.get("entries") or []
        if not isinstance(entries, list) or not entries:
            return {"success": False, "msg": "没有可保存的数据。"}

        game_path = self._cfg_mgr.get_game_path()
        if not game_path:
            return {"success": False, "msg": "请先在主页设置游戏路径。"}

        valid, msg = self._logic.validate_game_path(game_path)
        if not valid:
            return {"success": False, "msg": msg or "游戏路径无效。"}

        lang_dir = Path(game_path) / "lang"
        csv_files = list_lang_csv_files(lang_dir)
        aimer_dir = lang_dir / "aimerWT"
        custom_only_files = []
        try:
            if aimer_dir.exists() and aimer_dir.is_dir():
                custom_only_files = [p.name for p in aimer_dir.glob("*.csv") if p.is_file()]
        except Exception:
            custom_only_files = []
        all_csv_files = sorted(set(csv_files + custom_only_files), key=lambda x: x.lower())

        if not all_csv_files:
            return {"success": False, "msg": "未在 lang 或 lang/aimerWT 文件夹中找到 CSV 文件。"}

        if not csv_file:
            csv_file = "menu.csv" if "menu.csv" in all_csv_files else all_csv_files[0]
        if csv_file not in all_csv_files:
            return {"success": False, "msg": f"未找到 {csv_file}（lang 或 lang/aimerWT）。"}

        source_csv = lang_dir / csv_file

        ok, info = self._ensure_custom_text_dir(lang_dir)
        if not ok:
            return {"success": False, "msg": info}

        target_csv = lang_dir / "aimerWT" / csv_file
        source_menu_csv = target_csv if target_csv.exists() else source_csv

        try:
            rows, used_encoding = load_csv_rows_with_fallback(source_menu_csv)
        except Exception as e:
            return {"success": False, "msg": f"读取 {csv_file} 失败: {e}"}

        if not rows:
            return {"success": False, "msg": f"{csv_file} 内容为空。"}

        header = rows[0]
        id_idx = self._find_header_index(header, "ID|readonly|noverify")
        if id_idx < 0:
            id_idx = 0
        lang_idx = self._find_header_index(header, language)
        if lang_idx < 0:
            return {"success": False, "msg": f"{csv_file} 缺少 {language} 列。"}

        update_map = {}
        for item in entries:
            if not isinstance(item, dict):
                continue
            text_id = str(item.get("id", "")).strip()
            if not text_id:
                continue
            update_map[text_id] = str(item.get("text", ""))

        if not update_map:
            return {"success": False, "msg": "没有有效的文本条目。"}

        changed = 0
        for i in range(1, len(rows)):
            row = rows[i]
            if not row or id_idx >= len(row):
                continue
            text_id = str(row[id_idx]).strip()
            if text_id not in update_map:
                continue

            if lang_idx >= len(row):
                row.extend([""] * (lang_idx - len(row) + 1))
            new_text = update_map[text_id]
            if row[lang_idx] != new_text:
                row[lang_idx] = new_text
                changed += 1

        if changed == 0:
            return {"success": True, "msg": "没有检测到变更。", "changed": 0}

        if not target_csv.exists():
            try:
                if source_csv.exists():
                    import shutil
                    shutil.copy2(source_csv, target_csv)
            except Exception as e:
                return {"success": False, "msg": f"创建 {csv_file} 副本失败: {e}"}

        try:
            with open(target_csv, "w", encoding=used_encoding, newline="") as f:
                writer = csv.writer(f, delimiter=';', quotechar='"', quoting=csv.QUOTE_ALL, lineterminator="\n")
                writer.writerows(rows)
        except Exception as e:
            return {"success": False, "msg": f"写入 {csv_file} 失败: {e}"}

        loc_ok, loc_info = self._redirect_localization_for_files(lang_dir, [csv_file])
        if not loc_ok:
            return {"success": False, "msg": loc_info}

        return {
            "success": True,
            "msg": f"已保存 {changed} 条文本到 lang/aimerWT/{csv_file}。",
            "changed": changed,
            "workspace_info": info,
            "localization_info": loc_info
        }

    def import_custom_text(self, payload):
        """
        导入自定义文本模组
        支持：压缩包（.zip）或 CSV 文件
        """
        if isinstance(payload, str):
            try:
                payload = json.loads(payload)
            except Exception:
                return {"success": False, "msg": "参数格式错误。"}

        if not isinstance(payload, dict):
            return {"success": False, "msg": "参数格式错误。"}

        import_file = payload.get("file_path", "")
        if not import_file:
            return {"success": False, "msg": "未提供导入文件路径。"}

        import_path = Path(import_file)
        if not import_path.exists():
            return {"success": False, "msg": f"文件不存在: {import_file}"}

        game_path = self._cfg_mgr.get_game_path()
        if not game_path:
            return {"success": False, "msg": "请先在主页设置游戏路径。"}

        valid, msg = self._logic.validate_game_path(game_path)
        if not valid:
            return {"success": False, "msg": msg or "游戏路径无效。"}

        lang_dir = Path(game_path) / "lang"
        if not lang_dir.exists():
            return {"success": False, "msg": "未找到 lang 文件夹。"}

        ok, info = self._ensure_custom_text_dir(lang_dir)
        if not ok:
            return {"success": False, "msg": info}

        aimer_dir = lang_dir / "aimerWT"
        temp_dir = aimer_dir / ".import_temp"
        skipped_temp_dir = aimer_dir / ".skipped_files"  # 保存跳过的文件

        try:
            # 清理临时目录
            if temp_dir.exists():
                shutil.rmtree(temp_dir)
            temp_dir.mkdir(parents=True, exist_ok=True)

            # 处理压缩包
            if import_path.suffix.lower() in ['.zip', '.rar', '.7z']:
                extract_ok, extract_msg = extract_archive(import_path, temp_dir)
                if not extract_ok:
                    shutil.rmtree(temp_dir, ignore_errors=True)
                    return {"success": False, "msg": extract_msg}

                # 递归查找 CSV 和 BLK 文件
                csv_files = find_csv_files_recursive(temp_dir)
                blk_files = find_blk_files_recursive(temp_dir)

                if not csv_files:
                    shutil.rmtree(temp_dir, ignore_errors=True)
                    return {"success": False, "msg": "压缩包中未找到 CSV 文件。"}

            # 处理单个 CSV 文件
            elif import_path.suffix.lower() == '.csv':
                csv_files = [import_path]
                blk_files = []
            else:
                return {"success": False, "msg": f"不支持的文件格式: {import_path.suffix}"}

            # 获取标准 CSV 文件列表
            standard_csv_files = list_lang_csv_files(lang_dir)
            if not standard_csv_files:
                shutil.rmtree(temp_dir, ignore_errors=True)
                return {"success": False, "msg": "未找到标准 CSV 文件，请先启动一次游戏。"}

            # 检测导入模式
            mode = "standard"
            csv_references = []

            if blk_files:
                # 模式2：有 blk 文件
                mode = "custom_blk"
                for blk_file in blk_files:
                    try:
                        with open(blk_file, 'r', encoding='utf-8', errors='ignore') as f:
                            content = f.read()
                            refs = extract_csv_references_from_blk(content)
                            csv_references.extend(refs)
                    except Exception:
                        pass
                csv_references = list(set(csv_references))

            # 映射和导入
            imported_files = []
            mapping_info = []
            unrecognized_files = []  # 无法识别但已导入的文件

            for csv_file in csv_files:
                csv_name = csv_file.name

                # 确定目标文件名
                target_name = None
                is_unrecognized = False

                if mode == "custom_blk" and csv_references:
                    # 模式2：有 blk 文件，尝试从引用中找到匹配
                    if csv_name in csv_references:
                        # 映射到标准名称
                        target_name = match_csv_to_standard(csv_name, standard_csv_files)
                        if not target_name:
                            # 无法识别，使用原文件名
                            target_name = csv_name
                            is_unrecognized = True
                    else:
                        target_name = match_csv_to_standard(csv_name, standard_csv_files)
                        if not target_name:
                            # 无法识别，使用原文件名
                            target_name = csv_name
                            is_unrecognized = True
                else:
                    # 模式1：标准命名
                    if csv_name in standard_csv_files:
                        target_name = csv_name
                    else:
                        target_name = match_csv_to_standard(csv_name, standard_csv_files)
                        if not target_name:
                            # 无法识别，使用原文件名
                            target_name = csv_name
                            is_unrecognized = True

                # 目标路径
                target_path = aimer_dir / target_name
                source_path = lang_dir / target_name

                try:
                    if is_unrecognized:
                        # 无法识别的文件，直接复制
                        shutil.copy2(csv_file, target_path)
                        imported_files.append(target_name)
                        unrecognized_files.append(target_name)
                        mapping_info.append(f"⚠ {target_name} (无法识别，已导入)")
                    elif mode == "custom_blk":
                        # 模式2：使用智能合并
                        merge_ok, merge_msg, stats = merge_csv_files(
                            source_path,  # 原始CSV
                            csv_file,     # 模组CSV
                            target_path   # 输出路径
                        )

                        if merge_ok:
                            imported_files.append(target_name)
                            detail = f"✓ {csv_name}"
                            if csv_name != target_name:
                                detail += f" → {target_name}"
                            detail += f" (新增 {stats.get('added', 0)} 条, 修改 {stats.get('modified', 0)} 条)"
                            mapping_info.append(detail)
                        else:
                            mapping_info.append(f"✗ 失败: {csv_name} ({merge_msg})")
                    else:
                        # 模式1：直接复制
                        shutil.copy2(csv_file, target_path)
                        imported_files.append(target_name)
                        if csv_name != target_name:
                            mapping_info.append(f"✓ {csv_name} → {target_name}")
                        else:
                            mapping_info.append(f"✓ {csv_name}")

                except Exception as e:
                    mapping_info.append(f"✗ 失败: {csv_name} ({e})")

            # 清理临时目录
            if temp_dir.exists():
                shutil.rmtree(temp_dir, ignore_errors=True)

            if not imported_files:
                return {"success": False, "msg": "没有成功导入任何文件。", "details": mapping_info}

            # 更新 localization.blk
            loc_ok, loc_info = self._redirect_localization_for_files(lang_dir, imported_files)

            result_msg = f"成功导入 {len(imported_files)} 个文件。"
            if unrecognized_files:
                result_msg += f"\n其中 {len(unrecognized_files)} 个文件无法识别，已以原文件名导入。"

            return {
                "success": True,
                "msg": result_msg,
                "imported_files": imported_files,
                "unrecognized_files": unrecognized_files,
                "mapping_info": mapping_info,
                "mode": mode,
                "localization_info": loc_info if loc_ok else f"警告: {loc_info}"
            }

        except Exception as e:
            if temp_dir.exists():
                shutil.rmtree(temp_dir, ignore_errors=True)
            return {"success": False, "msg": f"导入失败: {e}"}

    def delete_custom_text_files(self, payload):
        """
        删除指定的自定义文本文件
        """
        if isinstance(payload, str):
            try:
                payload = json.loads(payload)
            except Exception:
                return {"success": False, "msg": "参数格式错误。"}

        if not isinstance(payload, dict):
            return {"success": False, "msg": "参数格式错误。"}

        file_names = payload.get("file_names", [])
        if not file_names:
            return {"success": False, "msg": "缺少文件名列表。"}

        game_path = self._cfg_mgr.get_game_path()
        if not game_path:
            return {"success": False, "msg": "请先在主页设置游戏路径。"}

        lang_dir = Path(game_path) / "lang"
        aimer_dir = lang_dir / "aimerWT"

        if not aimer_dir.exists():
            return {"success": False, "msg": "自定义文本目录不存在。"}

        deleted_files = []
        failed_files = []

        for file_name in file_names:
            file_path = aimer_dir / file_name
            try:
                if file_path.exists():
                    file_path.unlink()
                    deleted_files.append(file_name)
                else:
                    failed_files.append(f"{file_name} (文件不存在)")
            except Exception as e:
                failed_files.append(f"{file_name} ({e})")

        if not deleted_files:
            return {"success": False, "msg": "没有成功删除任何文件。", "failed": failed_files}

        # 更新 localization.blk，移除这些文件的引用
        # 这里简单处理：重新扫描剩余文件并更新
        remaining_files = [f.name for f in aimer_dir.glob("*.csv")]
        if remaining_files:
            self._redirect_localization_for_files(lang_dir, remaining_files)

        result = {
            "success": True,
            "msg": f"成功删除 {len(deleted_files)} 个文件。",
            "deleted_files": deleted_files
        }

        if failed_files:
            result["failed_files"] = failed_files
            result["msg"] += f"\n{len(failed_files)} 个文件删除失败。"

        return result

    def import_custom_text_manual(self, payload):
        """
        手动导入用户确认的CSV文件（保持原文件名）
        从临时目录导入
        """
        if isinstance(payload, str):
            try:
                payload = json.loads(payload)
            except Exception:
                return {"success": False, "msg": "参数格式错误。"}

        if not isinstance(payload, dict):
            return {"success": False, "msg": "参数格式错误。"}

        selected_files = payload.get("selected_files", [])  # 用户选中的文件名列表
        temp_dir_str = payload.get("temp_dir", "")  # 临时目录路径

        if not selected_files or not temp_dir_str:
            return {"success": False, "msg": "缺少必要参数。"}

        temp_dir = Path(temp_dir_str)
        if not temp_dir.exists():
            return {"success": False, "msg": "临时文件已被清理，请重新导入。"}

        game_path = self._cfg_mgr.get_game_path()
        if not game_path:
            return {"success": False, "msg": "请先在主页设置游戏路径。"}

        valid, msg = self._logic.validate_game_path(game_path)
        if not valid:
            return {"success": False, "msg": msg or "游戏路径无效。"}

        lang_dir = Path(game_path) / "lang"
        if not lang_dir.exists():
            return {"success": False, "msg": "未找到 lang 文件夹。"}

        ok, info = self._ensure_custom_text_dir(lang_dir)
        if not ok:
            return {"success": False, "msg": info}

        aimer_dir = lang_dir / "aimerWT"

        try:
            # 查找临时目录中的所有CSV文件
            csv_files_map = {}
            for csv_file in find_csv_files_recursive(temp_dir):
                csv_files_map[csv_file.name] = csv_file

            # 执行手动导入（保持原文件名）
            imported_files = []
            mapping_info = []

            for file_name in selected_files:
                if file_name not in csv_files_map:
                    mapping_info.append(f"✗ 失败: {file_name} (文件不存在)")
                    continue

                source_file = csv_files_map[file_name]
                # 保持原文件名
                target_path = aimer_dir / file_name

                try:
                    # 直接复制文件
                    shutil.copy2(source_file, target_path)
                    imported_files.append(file_name)
                    mapping_info.append(f"✓ {file_name} (保持原文件名)")

                except Exception as e:
                    mapping_info.append(f"✗ 失败: {file_name} ({e})")

            # 清理临时目录
            if temp_dir.exists():
                shutil.rmtree(temp_dir, ignore_errors=True)

            if not imported_files:
                return {"success": False, "msg": "没有成功导入任何文件。", "details": mapping_info}

            # 更新 localization.blk，添加这些文件的引用
            loc_ok, loc_info = self._redirect_localization_for_files(lang_dir, imported_files)

            return {
                "success": True,
                "msg": f"手动导入成功，共 {len(imported_files)} 个文件。",
                "imported_files": imported_files,
                "mapping_info": mapping_info,
                "mode": "manual",
                "localization_info": loc_info if loc_ok else f"警告: {loc_info}"
            }

        except Exception as e:
            # 出错时也清理临时目录
            if temp_dir.exists():
                shutil.rmtree(temp_dir, ignore_errors=True)
            return {"success": False, "msg": f"手动导入失败: {e}"}

    def cleanup_import_temp(self, payload):
        """
        清理导入临时目录
        """
        if isinstance(payload, str):
            try:
                payload = json.loads(payload)
            except Exception:
                return {"success": False, "msg": "参数格式错误。"}

        if not isinstance(payload, dict):
            return {"success": False, "msg": "参数格式错误。"}

        temp_dir_str = payload.get("temp_dir", "")
        if not temp_dir_str:
            return {"success": False, "msg": "缺少临时目录路径。"}

        temp_dir = Path(temp_dir_str)
        try:
            if temp_dir.exists():
                shutil.rmtree(temp_dir, ignore_errors=True)
            return {"success": True, "msg": "清理成功。"}
        except Exception as e:
            return {"success": False, "msg": f"清理失败: {e}"}

    def select_custom_text_file(self):
        """
        打开文件选择对话框，选择自定义文本文件（CSV 或压缩包）
        """
        file_types = (
            "Custom Text Files (*.csv;*.zip)",
            "CSV Files (*.csv)",
            "Zip Files (*.zip)",
            "All files (*.*)"
        )

        try:
            result = self._window.create_file_dialog(
                webview.FileDialog.OPEN, allow_multiple=False, file_types=file_types
            )

            if result and len(result) > 0:
                file_path = result[0]
                return {"success": True, "file_path": file_path}
            return {"success": False}
        except Exception as e:
            return {"success": False, "msg": f"选择文件失败: {e}"}

    def select_custom_text_export_folder(self):
        """打开文件夹选择对话框，选择导出压缩包保存目录。"""
        try:
            result = self._window.create_file_dialog(webview.FileDialog.FOLDER)
            if result and len(result) > 0:
                return {"success": True, "folder_path": result[0]}
            return {"success": False}
        except Exception as e:
            return {"success": False, "msg": f"选择导出目录失败: {e}"}

    def export_custom_text_package(self, payload=None):
        """
        导出自定义文本压缩包：
        - 包内包含 AimerWT/ 目录（仅当前已修改 CSV）
        - 仅包含已修改的 blk（目前为 localization.blk）
        """
        if isinstance(payload, str):
            try:
                payload = json.loads(payload)
            except Exception:
                payload = None
        payload = payload if isinstance(payload, dict) else {}

        export_folder = str(payload.get("export_folder", "")).strip()
        if not export_folder:
            return {"success": False, "msg": "缺少导出目录。"}

        game_path = self._cfg_mgr.get_game_path()
        if not game_path:
            return {"success": False, "msg": "请先在主页设置游戏路径。"}

        valid, msg = self._logic.validate_game_path(game_path)
        if not valid:
            return {"success": False, "msg": msg or "游戏路径无效。"}

        lang_dir = Path(game_path) / "lang"
        if not lang_dir.exists() or not lang_dir.is_dir():
            return {"success": False, "msg": "未找到 lang 文件夹。"}

        csv_files, blk_files = _collect_custom_text_export_items(lang_dir)
        if not csv_files:
            return {"success": False, "msg": "未检测到可导出的自定义 CSV（lang/aimerWT/*.csv）。"}

        try:
            export_dir = Path(export_folder)
            export_dir.mkdir(parents=True, exist_ok=True)
        except Exception as e:
            return {"success": False, "msg": f"创建导出目录失败: {e}"}

        ts = time.strftime("%Y%m%d_%H%M%S")
        zip_path = export_dir / f"AimerWT_custom_text_{ts}.zip"

        try:
            with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
                for csv_file in csv_files:
                    zf.write(csv_file, arcname=f"AimerWT/{csv_file.name}")
                for blk_file in blk_files:
                    zf.write(blk_file, arcname=blk_file.name)
        except Exception as e:
            return {"success": False, "msg": f"导出压缩包失败: {e}"}

        return {
            "success": True,
            "msg": f"导出成功：{zip_path.name}",
            "zip_path": str(zip_path),
            "csv_count": len(csv_files),
            "blk_count": len(blk_files),
            "csv_files": [p.name for p in csv_files],
            "blk_files": [p.name for p in blk_files],
        }

    def _get_custom_text_backup_dir(self):
        """
        获取自定义文本备份目录路径。
        路径：<应用所在目录>/AimerWT资源库/WT备份/自定义文本备份/
        """
        app_dir = Path(sys.executable).parent if getattr(sys, "frozen", False) else Path(__file__).parent
        backup_dir = app_dir / DEFAULT_RESOURCE_ROOT_DIR_NAME / "WT备份" / "自定义文本备份"
        return backup_dir

    def _build_custom_text_backup_zip_path(self, backup_dir: Path) -> tuple[Path, str]:
        """
        生成唯一的自定义文本备份 zip 路径，避免同一秒内重复备份时重名覆盖。
        """
        base_name = f"custom_text_backup_{time.strftime('%Y%m%d_%H%M%S')}"
        candidate = backup_dir / f"{base_name}.zip"
        if not candidate.exists():
            return candidate, candidate.name

        for idx in range(1, 1000):
            candidate = backup_dir / f"{base_name}_{idx:02d}.zip"
            if not candidate.exists():
                return candidate, candidate.name

        # 极端情况下退回到毫秒时间戳，确保总能拿到可用文件名。
        candidate = backup_dir / f"{base_name}_{int(time.time() * 1000)}.zip"
        return candidate, candidate.name

    def _inspect_custom_text_backup_zip(self, zip_path: Path) -> dict:
        """
        预检备份 zip，仅接受：
        - aimerWT/<name>.csv
        - localization.blk
        其他条目会被忽略；若没有任何合法 CSV，则视为无效备份。
        """
        csv_members: list[tuple[str, str]] = []
        csv_names: set[str] = set()
        has_blk = False

        try:
            with zipfile.ZipFile(zip_path, "r") as zf:
                bad_member = zf.testzip()
                if bad_member is not None:
                    return {"success": False, "msg": f"备份压缩包已损坏: {bad_member}"}

                for info in zf.infolist():
                    if info.is_dir():
                        continue

                    member = str(info.filename or "").replace("\\", "/").strip()
                    if not member:
                        continue

                    if member == "localization.blk":
                        has_blk = True
                        continue

                    if not member.startswith("aimerWT/") or not member.lower().endswith(".csv"):
                        continue

                    parts = [part for part in member.split("/") if part]
                    if len(parts) != 2 or parts[0] != "aimerWT":
                        continue

                    csv_name = parts[1]
                    if Path(csv_name).name != csv_name or csv_name in (".", ".."):
                        return {"success": False, "msg": f"备份压缩包包含非法文件名: {member}"}

                    if csv_name.lower() in csv_names:
                        return {"success": False, "msg": f"备份压缩包包含重复 CSV: {csv_name}"}

                    csv_names.add(csv_name.lower())
                    csv_members.append((member, csv_name))
        except zipfile.BadZipFile:
            return {"success": False, "msg": "备份文件不是有效的 ZIP 压缩包。"}
        except Exception as e:
            return {"success": False, "msg": f"读取备份压缩包失败: {e}"}

        if not csv_members:
            return {"success": False, "msg": "备份压缩包中没有找到可还原的 CSV 文件。"}

        return {
            "success": True,
            "csv_members": csv_members,
            "has_blk": has_blk,
        }

    def _rollback_custom_text_restore(
        self,
        aimer_dir: Path,
        lang_dir: Path,
        rollback_csv_dir: Path,
        rollback_blk_path: Path,
        had_localization_blk: bool,
    ) -> None:
        """
        还原失败时，尽力恢复到操作前状态。
        """
        for current_csv in aimer_dir.glob("*.csv"):
            current_csv.unlink(missing_ok=True)

        for backup_csv in rollback_csv_dir.glob("*.csv"):
            shutil.copy2(backup_csv, aimer_dir / backup_csv.name)

        target_blk = lang_dir / "localization.blk"
        if had_localization_blk and rollback_blk_path.exists():
            shutil.copy2(rollback_blk_path, target_blk)
        elif not had_localization_blk and target_blk.exists():
            target_blk.unlink(missing_ok=True)

    def backup_custom_text(self, payload=None):
        """
        将 lang/aimerWT/ 下的所有 CSV 文件及 localization.blk 打包为带时间戳的 zip 备份。
        备份保存在 AimerWT资源库/WT备份/自定义文本备份/ 目录下，最多保留 20 份。
        """
        game_path = self._cfg_mgr.get_game_path()
        if not game_path:
            return {"success": False, "msg": "请先在主页设置游戏路径。"}

        valid, msg = self._logic.validate_game_path(game_path)
        if not valid:
            return {"success": False, "msg": msg or "游戏路径无效。"}

        lang_dir = Path(game_path) / "lang"
        aimer_dir = lang_dir / "aimerWT"

        if not aimer_dir.exists() or not aimer_dir.is_dir():
            return {"success": False, "msg": "未找到 lang/aimerWT 目录，没有可备份的自定义文本。"}

        csv_files = list(aimer_dir.glob("*.csv"))
        if not csv_files:
            return {"success": False, "msg": "lang/aimerWT 目录下没有 CSV 文件，无需备份。"}

        blk_file = lang_dir / "localization.blk"

        backup_dir = self._get_custom_text_backup_dir()
        try:
            backup_dir.mkdir(parents=True, exist_ok=True)
        except Exception as e:
            return {"success": False, "msg": f"创建备份目录失败: {e}"}

        zip_path, zip_name = self._build_custom_text_backup_zip_path(backup_dir)

        try:
            with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
                for csv_file in csv_files:
                    zf.write(csv_file, arcname=f"aimerWT/{csv_file.name}")
                if blk_file.exists():
                    zf.write(blk_file, arcname="localization.blk")
        except Exception as e:
            try:
                zip_path.unlink(missing_ok=True)
            except Exception:
                pass
            return {"success": False, "msg": f"创建备份压缩包失败: {e}"}

        # 清理旧备份，仅保留最近 20 份
        max_backups = 20
        try:
            existing = sorted(backup_dir.glob("custom_text_backup_*.zip"), key=lambda p: p.stat().st_mtime, reverse=True)
            for old in existing[max_backups:]:
                old.unlink(missing_ok=True)
        except Exception:
            pass

        return {
            "success": True,
            "msg": f"备份成功：{zip_name}（共 {len(csv_files)} 个 CSV）",
            "zip_name": zip_name,
            "csv_count": len(csv_files),
            "backup_dir": str(backup_dir),
        }

    def get_custom_text_backups(self, payload=None):
        """
        列出所有已存在的自定义文本备份文件，按时间倒序排列。
        """
        backup_dir = self._get_custom_text_backup_dir()
        if not backup_dir.exists():
            return {"success": True, "backups": []}

        backups = []
        try:
            for f in sorted(backup_dir.glob("custom_text_backup_*.zip"), key=lambda p: p.stat().st_mtime, reverse=True):
                stat = f.stat()
                backups.append({
                    "name": f.name,
                    "size_kb": round(stat.st_size / 1024, 1),
                    "time": time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(stat.st_mtime)),
                })
        except Exception as e:
            return {"success": False, "msg": f"读取备份列表失败: {e}"}

        return {"success": True, "backups": backups}

    def restore_custom_text(self, payload=None):
        """
        从指定的备份 zip 文件还原自定义文本数据到 lang/aimerWT/ 目录。
        还原前先清空 aimerWT/ 下的 CSV 文件，然后解压备份内容。
        """
        if isinstance(payload, str):
            try:
                payload = json.loads(payload)
            except Exception:
                return {"success": False, "msg": "参数格式错误。"}

        if not isinstance(payload, dict):
            return {"success": False, "msg": "参数格式错误。"}

        zip_name = str(payload.get("zip_name", "")).strip()
        if not zip_name:
            return {"success": False, "msg": "缺少备份文件名。"}

        # 防止路径穿越
        if "/" in zip_name or "\\" in zip_name or ".." in zip_name:
            return {"success": False, "msg": "无效的备份文件名。"}
        if not zip_name.lower().endswith(".zip"):
            return {"success": False, "msg": "无效的备份文件类型。"}

        backup_dir = self._get_custom_text_backup_dir()
        zip_path = backup_dir / zip_name
        if not zip_path.exists() or not zip_path.is_file():
            return {"success": False, "msg": f"备份文件不存在: {zip_name}"}

        game_path = self._cfg_mgr.get_game_path()
        if not game_path:
            return {"success": False, "msg": "请先在主页设置游戏路径。"}

        valid, msg = self._logic.validate_game_path(game_path)
        if not valid:
            return {"success": False, "msg": msg or "游戏路径无效。"}

        lang_dir = Path(game_path) / "lang"
        aimer_dir = lang_dir / "aimerWT"
        aimer_dir.mkdir(parents=True, exist_ok=True)

        zip_check = self._inspect_custom_text_backup_zip(zip_path)
        if not zip_check.get("success"):
            return zip_check

        csv_members = list(zip_check.get("csv_members") or [])
        has_blk = bool(zip_check.get("has_blk"))

        try:
            with tempfile.TemporaryDirectory(prefix="aimerwt_ct_restore_", dir=str(lang_dir.parent)) as temp_root_str:
                temp_root = Path(temp_root_str)
                extract_lang_dir = temp_root / "extracted_lang"
                extract_aimer_dir = extract_lang_dir / "aimerWT"
                rollback_dir = temp_root / "rollback"
                rollback_csv_dir = rollback_dir / "aimerWT"

                extract_aimer_dir.mkdir(parents=True, exist_ok=True)
                rollback_csv_dir.mkdir(parents=True, exist_ok=True)

                rollback_blk_path = rollback_dir / "localization.blk"
                target_blk = lang_dir / "localization.blk"
                had_localization_blk = target_blk.exists() and target_blk.is_file()

                # 先提取到临时目录，确认备份内容可完整读取。
                with zipfile.ZipFile(zip_path, "r") as zf:
                    for member, csv_name in csv_members:
                        target = extract_aimer_dir / csv_name
                        with zf.open(member) as src, open(target, "wb") as dst:
                            shutil.copyfileobj(src, dst)

                    if has_blk:
                        with zf.open("localization.blk") as src, open(extract_lang_dir / "localization.blk", "wb") as dst:
                            shutil.copyfileobj(src, dst)

                extracted_csv_files = sorted(extract_aimer_dir.glob("*.csv"))
                if len(extracted_csv_files) != len(csv_members):
                    return {"success": False, "msg": "备份压缩包校验失败：CSV 提取数量不一致。"}

                # 进入真正替换前，先做好回滚快照。
                for current_csv in aimer_dir.glob("*.csv"):
                    shutil.copy2(current_csv, rollback_csv_dir / current_csv.name)
                if had_localization_blk:
                    shutil.copy2(target_blk, rollback_blk_path)

                restored_csv = 0
                restored_blk = False
                try:
                    for old_csv in aimer_dir.glob("*.csv"):
                        old_csv.unlink(missing_ok=True)

                    for extracted_csv in extracted_csv_files:
                        os.replace(str(extracted_csv), str(aimer_dir / extracted_csv.name))
                        restored_csv += 1

                    if has_blk:
                        os.replace(str(extract_lang_dir / "localization.blk"), str(target_blk))
                        restored_blk = True
                except Exception:
                    self._rollback_custom_text_restore(
                        aimer_dir=aimer_dir,
                        lang_dir=lang_dir,
                        rollback_csv_dir=rollback_csv_dir,
                        rollback_blk_path=rollback_blk_path,
                        had_localization_blk=had_localization_blk,
                    )
                    raise

            blk_info = "，已还原 localization.blk" if restored_blk else ""
            return {
                "success": True,
                "msg": f"还原成功：已恢复 {restored_csv} 个 CSV 文件{blk_info}。",
                "restored_csv": restored_csv,
                "restored_blk": restored_blk,
            }

        except Exception as e:
            return {"success": False, "msg": f"还原失败: {e}"}

    def refresh_skins_async(self, opts=None):
        """
        先传回基本信息，再异步推送封面数据。
        """
        game_path = self._cfg_mgr.get_game_path()
        valid, _ = self._logic.validate_game_path(game_path)
        if not valid:
            return False

        force_refresh = False
        if isinstance(opts, dict):
            force_refresh = bool(opts.get("force_refresh"))

        def _worker():
            try:
                default_cover_path = WEB_DIR / "assets" / "card_image_small.png"
                data = self._skins_mgr.scan_userskins(
                    game_path, default_cover_path=default_cover_path,
                    force_refresh=force_refresh, skip_covers=True
                )
                data["valid"] = True

                # 推送基本列表到前端，让界面先渲染出来
                if self._window:
                    js_data = json.dumps(data, ensure_ascii=False)
                    self._window.evaluate_js(f"if(app.onSkinsListReady) app.onSkinsListReady({js_data})")

                items = data.get("items", [])
                for it in items:
                    name = it.get("name")
                    preview_path = it.get("preview_path")
                    cover_url = ""

                    if preview_path and Path(preview_path).exists():
                        cover_url = self._skins_mgr._to_data_url(Path(preview_path))
                    elif default_cover_path.exists():
                        cover_url = self._skins_mgr._to_data_url(default_cover_path)

                    if self._window and cover_url:
                        # 单条推送，避免大数据包造成的卡顿
                        name_js = json.dumps(name, ensure_ascii=False)
                        url_js = json.dumps(cover_url, ensure_ascii=True)
                        self._window.evaluate_js(f"if(app.onSkinCoverReady) app.onSkinCoverReady({name_js}, {url_js})")
            except Exception as e:
                log.error(f"后台刷新涂装库失败: {e}")

        threading.Thread(target=_worker, daemon=True).start()
        return True

    def get_skins_list(self, opts=None):
        # 保留原接口供兼容，但实际上前端将改用 refresh_skins_async
        path = self._cfg_mgr.get_game_path()
        default_cover_path = WEB_DIR / "assets" / "card_image_small.png"
        force_refresh = bool(opts.get("force_refresh")) if opts else False
        data = self._skins_mgr.scan_userskins(path, default_cover_path, force_refresh)
        data["valid"] = True
        return data

    def import_skin_zip_dialog(self):
        if self._is_busy:
            log.warning("另一个任务正在进行中，请稍候...")
            return False

        path = self._cfg_mgr.get_game_path()
        valid, msg = self._logic.validate_game_path(path)
        if not valid:
            log.error(f"未设置有效游戏路径: {msg}")
            return False

        file_types = ("Zip Files (*.zip)", "All files (*.*)")
        result = self._window.create_file_dialog(
            webview.FileDialog.OPEN, allow_multiple=False, file_types=file_types
        )
        if not result or len(result) == 0:
            return False

        zip_path = result[0]
        self.import_skin_zip_from_path(zip_path)
        return True

    def import_skin_zip_from_path(self, zip_path):
        if self._is_busy:
            log.warning("另一个任务正在进行中，请稍候...")
            return False

        path = self._cfg_mgr.get_game_path()
        valid, msg = self._logic.validate_game_path(path)
        if not valid:
            log.error(f"未设置有效游戏路径: {msg}")
            return False

        zip_path = str(zip_path)
        self._is_busy = True

        if self._window:
            msg_js = json.dumps(f"涂装解压: {Path(zip_path).name}", ensure_ascii=False)
            self._window.evaluate_js(
                f"if(window.MinimalistLoading) MinimalistLoading.show(false, {msg_js})"
            )

        def _run():
            try:
                self._skins_mgr.import_skin_zip(
                    zip_path, path, progress_callback=self.update_loading_ui
                )
                if self._window:
                    self._window.evaluate_js("if(app.refreshSkins) app.refreshSkins()")
                    msg_js = json.dumps("涂装导入完成", ensure_ascii=False)
                    self._window.evaluate_js(
                        f"if(window.MinimalistLoading) MinimalistLoading.update(100, {msg_js})"
                    )
            except FileExistsError as e:
                log.warning(f"{e}")
                if self._window:
                    msg_js = json.dumps(str(e), ensure_ascii=False)
                    self._window.evaluate_js(
                        f"if(window.MinimalistLoading) MinimalistLoading.update(100, {msg_js})"
                    )
            except Exception as e:
                log.error(f"涂装导入失败: {e}")
                if self._window:
                    msg_js = json.dumps("涂装导入失败", ensure_ascii=False)
                    self._window.evaluate_js(
                        f"if(window.MinimalistLoading) MinimalistLoading.update(100, {msg_js})"
                    )
            finally:
                self._is_busy = False

        t = threading.Thread(target=_run)
        t.daemon = True
        t.start()
        return True

    def rename_skin(self, old_name, new_name):
        # 重命名 UserSkins 下的涂装文件夹。
        path = self._cfg_mgr.get_game_path()
        try:
            self._skins_mgr.rename_skin(path, old_name, new_name)
            return {"success": True}
        except Exception as e:
            return {"success": False, "msg": str(e)}

    def update_skin_cover(self, skin_name):
        # 打开图片选择对话框并将所选图片设置为涂装封面（preview.png）。
        if self._is_busy:
            return {"success": False, "msg": "系统繁忙"}

        file_types = ("Image Files (*.jpg;*.jpeg;*.png;*.webp)", "All files (*.*)")
        result = self._window.create_file_dialog(
            webview.FileDialog.OPEN, allow_multiple=False, file_types=file_types
        )

        if result and len(result) > 0:
            img_path = result[0]
            path = self._cfg_mgr.get_game_path()
            try:
                self._skins_mgr.update_skin_cover(path, skin_name, img_path)
                return {"success": True, "new_cover": img_path}  # Return path, JS can reload
            except Exception as e:
                return {"success": False, "msg": str(e)}
        return {"success": False, "msg": "取消选择"}

    def update_skin_cover_data(self, skin_name, data_url):
        # 将前端传入的 base64 图片数据写入为涂装封面 preview.png。
        if self._is_busy:
            return {"success": False, "msg": "系统繁忙"}

        path = self._cfg_mgr.get_game_path()
        try:
            self._skins_mgr.update_skin_cover_data(path, skin_name, data_url)
            return {"success": True}
        except Exception as e:
            return {"success": False, "msg": str(e)}

    def install_mod(self, mod_name, install_list):
        # 将指定语音包按选择的文件夹列表安装到游戏 sound/mod，并更新前端加载进度与安装状态。
        # install_list 可能以 JSON 字符串形式传入
        if isinstance(install_list, str):
            try:
                install_list = json.loads(install_list)
            except json.JSONDecodeError:
                log.error(f"解析安装列表失败: {install_list}")
                return False

        # 使用线程锁与状态位限制并发任务
        with self._lock:
            if self._is_busy:
                log.warning("另一个任务正在进行中，请稍候...")
                return False
            self._is_busy = True

        path = self._cfg_mgr.get_game_path()
        valid, _ = self._logic.validate_game_path(path)
        if not valid:
            log.error("安装失败：未设置有效游戏路径")
            with self._lock:
                self._is_busy = False
            return False

        # 记录当前语音包标识，供前端在列表中标记已生效项
        self._cfg_mgr.set_current_mod(mod_name)

        def _run():
            try:
                mod_path = self._lib_mgr.library_dir / mod_name
                result = self._logic.install_from_library(
                    mod_path, install_list, progress_callback=self.update_loading_ui
                )

                # 根据安装结果通知前端
                if self._window:
                    if isinstance(result, dict):
                        if result.get("success"):
                            failed_count = result.get("failed", 0)
                            if failed_count > 0:
                                # 部分成功
                                msg = f"安装完成，但有 {failed_count} 个文件复制失败"
                                msg_js = json.dumps(msg, ensure_ascii=False)
                                self._window.evaluate_js(
                                    f"if(window.MinimalistLoading) MinimalistLoading.update(100, {msg_js})"
                                )
                            else:
                                msg_js = json.dumps("安装完成", ensure_ascii=False)
                                self._window.evaluate_js(
                                    f"if(window.MinimalistLoading) MinimalistLoading.update(100, {msg_js})"
                                )
                            self._window.evaluate_js(
                                f"if(app.onInstallSuccess) app.onInstallSuccess('{mod_name}')"
                            )
                        else:
                            # 安装失败
                            error_msg = result.get("error", "")
                            failed_count = result.get("failed", 0)
                            if error_msg:
                                msg = f"安装失败：{error_msg}"
                            elif failed_count > 0:
                                msg = f"安装失败：{failed_count} 个文件复制失败"
                            else:
                                msg = "安装失败"
                            msg_js = json.dumps(msg, ensure_ascii=False)
                            self._window.evaluate_js(
                                f"if(window.MinimalistLoading) MinimalistLoading.update(100, {msg_js})"
                            )
                    else:
                        # 兼容旧版返回 bool 的情况
                        if result:
                            self._window.evaluate_js(
                                f"if(app.onInstallSuccess) app.onInstallSuccess('{mod_name}')"
                            )
                            msg_js = json.dumps("安装完成", ensure_ascii=False)
                            self._window.evaluate_js(
                                f"if(window.MinimalistLoading) MinimalistLoading.update(100, {msg_js})"
                            )
                        else:
                            msg_js = json.dumps("安装失败", ensure_ascii=False)
                            self._window.evaluate_js(
                                f"if(window.MinimalistLoading) MinimalistLoading.update(100, {msg_js})"
                            )
            except Exception as e:
                log.error(f"安装失败: {e}")
                if self._window:
                    msg_js = json.dumps(f"安装失败：{e}", ensure_ascii=False)
                    self._window.evaluate_js(
                        f"if(window.MinimalistLoading) MinimalistLoading.update(100, {msg_js})"
                    )
            finally:
                with self._lock:
                    self._is_busy = False

        t = threading.Thread(target=_run)
        t.daemon = True  # 设置为守护线程
        t.start()
        return True

    def check_install_conflicts(self, mod_name, install_list):
        # 基于安装清单对本次安装可能写入的文件名进行冲突检查，并返回冲突明细列表。
        try:
            # install_list 可能以 JSON 字符串形式传入
            if isinstance(install_list, str):
                try:
                    install_list = json.loads(install_list)
                except json.JSONDecodeError:
                    return []

            path = self._cfg_mgr.get_game_path()
            valid, _ = self._logic.validate_game_path(path)
            if not valid:
                return []

            # 需要先获取 mod 的源路径
            mod_path = self._lib_mgr.library_dir / mod_name
            if not mod_path.exists():
                return []

            # install_list 现在是文件路径列表，直接提取文件名
            files_to_install = []
            for file_rel_path in install_list:
                # 只提取文件名
                file_name = Path(file_rel_path).name
                files_to_install.append(file_name)

            # 调用 manifest_mgr 进行冲突检测
            if self._logic.manifest_mgr:
                return self._logic.manifest_mgr.check_conflicts(mod_name, files_to_install)
            return []
        except Exception as e:
            log.warning(f"冲突检测失败: {e}")
            return []

    def delete_mod(self, mod_name):
        """从语音包库目录中删除指定语音包文件夹（不影响游戏目录中已安装的文件）。"""
        if self._is_busy:
            log.warning("另一个任务正在进行中，请稍候...")
            return {"success": False, "msg": "另一个任务正在进行中"}

        import shutil

        try:
            library_dir = Path(self._lib_mgr.library_dir).resolve()
            target = (library_dir / str(mod_name)).resolve()
            if os.path.commonpath([str(target), str(library_dir)]) != str(
                    library_dir
            ) or str(target) == str(library_dir):
                raise Exception("非法路径")
            shutil.rmtree(target)
            log.info(f"已从库中删除语音包: {mod_name}")
            return {"success": True, "msg": f"已从库中删除: {mod_name}"}
        except Exception as e:
            log.error(f"删除库文件失败: {e}")
            return {"success": False, "msg": f"删除失败: {e}"}

    def uninstall_mod(self, mod_name):
        """从游戏目录中卸载指定语音包的已安装文件（保留库文件）。"""
        if self._is_busy:
            log.warning("另一个任务正在进行中，请稍候...")
            return {"success": False, "msg": "另一个任务正在进行中"}

        try:
            path = self._cfg_mgr.get_game_path()
            valid, msg = self._logic.validate_game_path(path)
            if not valid:
                return {"success": False, "msg": msg or "未设置有效游戏路径"}

            result = self._logic.uninstall_mod(mod_name)
            return result
        except Exception as e:
            log.error(f"卸载失败: {e}")
            return {"success": False, "msg": f"卸载失败: {e}"}

    def uninstall_mod_modules(self, mod_name, modules):
        """按模块卸载语音包的特定文件。

        Args:
            mod_name: 语音包名称
            modules: 模块列表，如 ["ground", "radio", "tank"]
        """
        if self._is_busy:
            log.warning("另一个任务正在进行中，请稍候...")
            return {"success": False, "msg": "另一个任务正在进行中"}

        try:
            path = self._cfg_mgr.get_game_path()
            valid, msg = self._logic.validate_game_path(path)
            if not valid:
                return {"success": False, "msg": msg or "未设置有效游戏路径"}

            # 将模块名称转换为文件名模式
            module_patterns = []
            module_map = {
                "ground": "_crew_dialogs_ground_",
                "radio": "_crew_dialogs_common_",
                "tank": "_tank_",
                "aircraft": "_aircraft_",
                "ships": "_ships_",
                "infantry": "_infantry_"
            }

            for module in modules:
                pattern = module_map.get(module.lower())
                if pattern:
                    module_patterns.append(pattern)
                else:
                    # 如果不在映射中，直接使用原始值
                    module_patterns.append(module)

            if not module_patterns:
                return {"success": False, "msg": "未指定有效的模块"}

            result = self._logic.uninstall_mod_modules(mod_name, module_patterns)
            return result
        except Exception as e:
            log.error(f"模块卸载失败: {e}")
            return {"success": False, "msg": f"模块卸载失败: {e}"}

    def delete_mod_completely(self, mod_name):
        """完全删除语音包：同时删除库文件和游戏目录中的已安装文件。"""
        if self._is_busy:
            log.warning("另一个任务正在进行中，请稍候...")
            return {"success": False, "msg": "另一个任务正在进行中"}

        import shutil

        try:
            # 先卸载游戏目录中的文件
            path = self._cfg_mgr.get_game_path()
            valid, msg = self._logic.validate_game_path(path)
            if valid:
                uninstall_result = self._logic.uninstall_mod(mod_name)
                if uninstall_result.get("success"):
                    log.info(f"已卸载游戏目录中的文件: {uninstall_result.get('removed', 0)} 个")
            else:
                log.warning(f"游戏路径无效，跳过卸载步骤: {msg}")

            # 再删除库文件
            library_dir = Path(self._lib_mgr.library_dir).resolve()
            target = (library_dir / str(mod_name)).resolve()
            if os.path.commonpath([str(target), str(library_dir)]) != str(
                    library_dir
            ) or str(target) == str(library_dir):
                raise Exception("非法路径")

            if target.exists():
                shutil.rmtree(target)
                log.info(f"已从库中删除语音包: {mod_name}")
            else:
                log.warning(f"库文件不存在: {mod_name}")

            return {"success": True, "msg": f"已完全删除: {mod_name}"}
        except Exception as e:
            log.error(f"完全删除失败: {e}")
            return {"success": False, "msg": f"删除失败: {e}"}

    def get_installed_mods_info(self):
        """获取所有已安装的语音包信息。"""
        try:
            path = self._cfg_mgr.get_game_path()
            valid, msg = self._logic.validate_game_path(path)
            if not valid:
                return {"success": False, "msg": msg or "未设置有效游戏路径", "mods": {}}

            if not self._logic.manifest_mgr:
                return {"success": False, "msg": "清单管理器未初始化", "mods": {}}

            installed_mods = self._logic.manifest_mgr.get_all_installed_mods()
            return {"success": True, "mods": installed_mods}
        except Exception as e:
            log.error(f"获取已安装语音包信息失败: {e}")
            return {"success": False, "msg": f"获取失败: {e}", "mods": {}}

    def copy_country_files(self, mod_name, country_code, include_ground=True, include_radio=True):
        # 触发“复制国籍文件”流程：从语音包库中查找匹配文件并复制到游戏 sound/mod。
        try:
            if not mod_name:
                return {"success": False, "msg": "语音包名称为空"}
            path = self._cfg_mgr.get_game_path()
            valid, msg = self._logic.validate_game_path(path)
            if not valid:
                return {"success": False, "msg": msg or "未设置有效游戏路径"}
            result = self._lib_mgr.copy_country_files(
                mod_name,
                path,
                country_code,
                include_ground,
                include_radio
            )
            created = result.get("created", [])
            skipped = result.get("skipped", [])
            missing = result.get("missing", [])
            msg = f"复制完成，新增 {len(created)}"
            if skipped:
                msg += f"，跳过 {len(skipped)}"
            if missing:
                msg += f"，缺失 {len(missing)}"
            log.info(msg)
            return {
                "success": True,
                "created": created,
                "skipped": skipped,
                "missing": missing,
            }
        except Exception as e:
            log.error(f"复制国籍文件失败: {e}")
            return {"success": False, "msg": str(e)}

    def restore_game(self):
        # 触发游戏目录还原流程：清空 sound/mod 子项并关闭 enable_mod，同时清理当前语音包状态。
        if self._is_busy:
            log.warning("另一个任务正在进行中，请稍候...")
            return False

        path = self._cfg_mgr.get_game_path()
        valid, msg = self._logic.validate_game_path(path)
        if not valid:
            log.error(f"还原失败: {msg}")
            return False

        self._is_busy = True

        def _run():
            try:
                self._logic.restore_game()

                # 还原成功，清除状态
                self._cfg_mgr.set_current_mod("")
                if self._window:
                    self._window.evaluate_js("app.onRestoreSuccess()")
            finally:
                self._is_busy = False

        t = threading.Thread(target=_run)
        t.daemon = True  # 设置为守护线程
        t.start()
        return True

    def clear_logs(self):
        # 接收前端“清空日志”动作，并输出一条日志用于记录该行为。
        log.info("日志已清空")

    # --- 首次运行状态 API ---
    def check_first_run(self):
        # 判断前端是否需要展示首次运行协议弹窗。
        is_first = self._cfg_mgr.get_is_first_run()
        saved_ver = self._cfg_mgr.get_agreement_version()
        needs_agreement = is_first or (saved_ver != AGREEMENT_VERSION)
        return {"status": needs_agreement, "version": AGREEMENT_VERSION}

    def agree_to_terms(self, version):
        # 记录用户已同意协议，并保存其同意的协议版本号。
        self._cfg_mgr.set_is_first_run(False)
        self._cfg_mgr.set_agreement_version(version)
        return True

    def get_guide_state(self):
        # 读取新手引导状态（持久化在 settings.json）。
        return self._cfg_mgr.get_guide_state()

    def save_guide_state(self, guide_state):
        # 保存新手引导状态到 settings.json。
        ok = self._cfg_mgr.set_guide_state(guide_state if isinstance(guide_state, dict) else {})
        return {"success": bool(ok)}

    # --- 主题管理 API ---
    def get_theme_list(self):
        # 扫描 web/themes 目录下的主题 JSON 文件列表，并返回主题元信息供前端下拉框展示。
        themes_dir = WEB_DIR / "themes"
        if not themes_dir.exists():
            return []

        theme_list = []
        for file in themes_dir.glob("*.json"):
            try:
                data = self._load_json_with_fallback(file)
                if isinstance(data, dict):
                    meta = data.get("meta", {})
                    sort_order = meta.get("sort_order", 100)
                    try:
                        sort_order = int(sort_order)
                    except (TypeError, ValueError):
                        sort_order = 100
                    theme_list.append(
                        {
                            "filename": file.name,
                            "name": meta.get("name", file.stem),
                            "author": meta.get("author", "Unknown"),
                            "version": meta.get("version", "1.0"),
                            "sort_order": sort_order,
                        }
                    )
            except Exception as e:
                log.error(f"读取主题 {file.name} 失败: {e}")

        theme_list.sort(key=lambda item: item.get("sort_order", 100))
        return self._theme_unlock.filter_theme_list(theme_list)

    def load_theme_content(self, filename):
        # 读取指定主题文件的完整 JSON 内容并返回给前端应用。
        if not self._theme_unlock.is_theme_accessible(filename):
            return None
        themes_dir = (WEB_DIR / "themes").resolve()
        theme_path = (themes_dir / str(filename)).resolve()
        if os.path.commonpath([str(theme_path), str(themes_dir)]) != str(themes_dir):
            return None
        if theme_path.suffix.lower() != ".json":
            return None
        if not theme_path.exists():
            return None
        try:
            data = self._load_json_with_fallback(theme_path)
            if isinstance(data, dict):
                return data
        except Exception as e:
            log.error(f"加载主题失败: {e}")
            return None

    def get_app_version(self):
        """返回当前软件版本号，供前端更新检测卡片展示"""
        return {"version": APP_VERSION}

    def check_for_update(self):
        """向服务端查询最新版本号，与本地版本比较并返回结果"""
        import requests
        tm = get_telemetry_manager()
        if not tm or not tm.report_url:
            return {"success": False, "message": "遥测服务未配置"}

        version_url = resolve_related_endpoint(tm.report_url, "/latest-version")
        try:
            resp = requests.get(version_url, timeout=10, headers={
                "User-Agent": f"AimerWT-Client/{APP_VERSION}",
            })
            data = resp.json()
            latest = str(data.get("latest_version", "") or "").strip()
            if not latest:
                return {"success": True, "has_update": False, "current": APP_VERSION,
                        "message": "服务端暂未配置版本信息"}

            has_update = latest != APP_VERSION
            result = {
                "success": True,
                "has_update": has_update,
                "current": APP_VERSION,
                "latest": latest,
                "download_url": data.get("download_url", ""),
                "changelog": data.get("changelog", ""),
            }
            if has_update:
                result["message"] = f"发现新版本: {latest}"
            else:
                result["message"] = "当前已是最新版本"
            return result
        except Exception as e:
            log.error(f"检查更新失败: {e}")
            return {"success": False, "message": "网络请求失败，请稍后重试"}

    def redeem_theme_code(self, code):
        # 校验兑换口令并解锁对应的隐藏主题。
        return self._theme_unlock.redeem_theme_code(code)

    def redeem_code(self, code):
        """向服务器提交兑换码验证，成功后执行对应功能"""
        import requests
        tm = get_telemetry_manager()
        if not tm or not tm.report_url:
            return {"success": False, "message": "遥测服务未配置"}

        redeem_url = resolve_related_endpoint(tm.report_url, "/redeem")
        try:
            machine_id = tm.get_machine_id()
            resp = requests.post(
                redeem_url,
                json={
                    "code": str(code or "").strip(),
                    "machine_id": machine_id,
                },
                headers=build_client_auth_headers(
                    redeem_url,
                    method="POST",
                    machine_id=machine_id,
                    user_agent=f"AimerWT-Client/{tm.app_version}",
                ),
                timeout=10,
            )
            data = resp.json()
            if resp.status_code == 200 and data.get("status") == "success":
                # 处理服务端返回的指令
                cmd = data.get("command")
                if cmd:
                    self.on_user_command(json.dumps(cmd) if isinstance(cmd, dict) else str(cmd))
                return {"success": True, "message": data.get("message", "兑换成功！")}
            else:
                return {"success": False, "message": data.get("error", "兑换失败")}
        except Exception as e:
            log.error(f"兑换码请求失败: {e}")
            return {"success": False, "message": "网络请求失败，请稍后重试"}

    def reset_unlocked_themes(self):
        # 清空已解锁的隐藏主题，并回退到默认主题。
        ok = self._theme_unlock.reset_unlocked_themes()
        if ok:
            self._cfg_mgr.set_active_theme("default.json")
        return {"success": bool(ok)}

    # --- 炮镜管理 API ---
    def discover_usersights_paths(self):
        """自动搜索系统中所有可能的 War Thunder UserSights 路径"""
        try:
            cfg_path = self._cfg_mgr.get_sights_path()
            return self._sights_mgr.discover_usersights_paths(configured_sights_path=cfg_path)
        except Exception as e:
            log.error(f"搜索 UserSights 路径失败: {e}")
            return []

    def select_uid_sights_path(self, uid):
        """根据 UID 选择并设置对应的 UserSights 路径"""
        try:
            cfg_path = self._cfg_mgr.get_sights_path()
            path = self._sights_mgr.select_uid_path(uid, configured_sights_path=cfg_path)
            self._cfg_mgr.set_sights_path(path)
            log.info(f"已选择 UID {uid} 的炮镜路径: {path}")
            return {"success": True, "path": path}
        except Exception as e:
            log.error(f"选择 UID 炮镜路径失败: {e}")
            return {"success": False, "error": str(e)}

    def select_sights_path(self):
        # 打开目录选择对话框设置 UserSights 路径，并写入配置用于下次启动恢复。
        folder = self._window.create_file_dialog(webview.FileDialog.FOLDER)
        if folder and len(folder) > 0:
            path = folder[0]
            try:
                self._sights_mgr.set_usersights_path(path)
                self._cfg_mgr.set_sights_path(path)
                log.info(f"炮镜路径已设置: {path}")
                return {"success": True, "path": path}
            except Exception as e:
                log.error(f"设置炮镜路径失败: {e}")
                return {"success": False, "error": str(e)}
        return {"success": False}

    def get_sights_list(self, opts=None):
        # 返回炮镜列表数据，供前端渲染炮镜网格与统计信息。
        t0 = time.perf_counter() if self._perf_enabled else None
        try:
            force_refresh = False
            if isinstance(opts, dict):
                force_refresh = bool(opts.get("force_refresh"))
            default_cover_path = WEB_DIR / "assets" / "card_image_small.png"
            res = self._sights_mgr.scan_sights(
                force_refresh=force_refresh, default_cover_path=default_cover_path
            )
            if self._perf_enabled and t0 is not None:
                dt_ms = (time.perf_counter() - t0) * 1000.0
                log.debug(f"[PERF] get_sights_list {dt_ms:.1f}ms items={len(res.get('items') or [])}")
            return res
        except Exception as e:
            log.error(f"扫描炮镜失败: {e}")
            return {"exists": False, "items": []}

    def rename_sight(self, old_name, new_name):
        # 重命名 UserSights 下的炮镜文件夹。
        try:
            self._sights_mgr.rename_sight(old_name, new_name)
            return {"success": True}
        except Exception as e:
            return {"success": False, "msg": str(e)}

    def update_sight_cover_data(self, sight_name, data_url):
        # 将前端传入的 base64 图片数据写入为炮镜封面 preview.png。
        if self._is_busy:
            return {"success": False, "msg": "系统繁忙"}

        try:
            self._sights_mgr.update_sight_cover_data(sight_name, data_url)
            return {"success": True}
        except Exception as e:
            return {"success": False, "msg": str(e)}

    def import_sights_zip_dialog(self):
        # 打开文件选择对话框选择炮镜 ZIP 并触发导入流程。
        if self._is_busy:
            log.warning("另一个任务正在进行中，请稍候...")
            return False

        if not self._sights_mgr.get_usersights_path():
            log.warning("请先设置有效的 UserSights 路径")
            return False

        file_types = ("Zip Files (*.zip)", "All files (*.*)")
        result = self._window.create_file_dialog(
            webview.FileDialog.OPEN, allow_multiple=False, file_types=file_types
        )
        if not result or len(result) == 0:
            return False

        zip_path = result[0]
        self.import_sights_zip_from_path(zip_path)
        return True

    def import_sights_zip_from_path(self, zip_path):
        # 导入指定路径的炮镜 ZIP 到 UserSights，并将进度同步到前端加载组件。
        if self._is_busy:
            log.warning("另一个任务正在进行中，请稍候...")
            return False

        if not self._sights_mgr.get_usersights_path():
            log.warning("请先设置有效的 UserSights 路径")
            return False

        zip_path = str(zip_path)
        self._is_busy = True

        if self._window:
            msg_js = json.dumps(f"炮镜解压: {Path(zip_path).name}", ensure_ascii=False)
            self._window.evaluate_js(
                f"if(window.MinimalistLoading) MinimalistLoading.show(false, {msg_js})"
            )

        def _run():
            try:
                self._sights_mgr.import_sights_zip(
                    zip_path, progress_callback=self.update_loading_ui
                )
                if self._window:
                    self._window.evaluate_js("if(app.refreshSights) app.refreshSights()")
                    msg_js = json.dumps("炮镜导入完成", ensure_ascii=False)
                    self._window.evaluate_js(
                        f"if(window.MinimalistLoading) MinimalistLoading.update(100, {msg_js})"
                    )
            except FileExistsError as e:
                log.warning(f"{e}")
                if self._window:
                    msg_js = json.dumps(str(e), ensure_ascii=False)
                    self._window.evaluate_js(
                        f"if(window.MinimalistLoading) MinimalistLoading.update(100, {msg_js})"
                    )
            except Exception as e:
                log.error(f"炮镜导入失败: {e}")
                if self._window:
                    msg_js = json.dumps("炮镜导入失败", ensure_ascii=False)
                    self._window.evaluate_js(
                        f"if(window.MinimalistLoading) MinimalistLoading.update(100, {msg_js})"
                    )
            finally:
                self._is_busy = False

        t = threading.Thread(target=_run)
        t.daemon = True
        t.start()
        return True

    def open_sights_folder(self):
        # 打开当前设置的 UserSights 目录。
        try:
            self._sights_mgr.open_usersights_folder()
        except Exception as e:
            log.error(f"打开炮镜文件夹失败: {e}")

    # --- 语音包库路径管理 API ---
    def get_library_path_info(self):
        """获取待解压区和语音包库的当前路径及预设路径。"""
        paths = self._lib_mgr.get_current_paths()
        custom_pending = self._cfg_mgr.get_pending_dir()
        custom_library = self._cfg_mgr.get_library_dir()
        return {
            "pending_dir": paths['pending_dir'],
            "library_dir": paths['library_dir'],
            "default_pending_dir": paths['default_pending_dir'],
            "default_library_dir": paths['default_library_dir'],
            "custom_pending_dir": custom_pending,
            "custom_library_dir": custom_library
        }

    def select_pending_dir(self):
        """打开目录选择对话框，选择待解压区目录。"""
        folder = self._window.create_file_dialog(webview.FileDialog.FOLDER)
        if folder and len(folder) > 0:
            path = folder[0].replace(os.sep, "/")
            return {"success": True, "path": path}
        return {"success": False}

    def select_library_dir(self):
        """打开目录选择对话框，选择语音包库目录。"""
        folder = self._window.create_file_dialog(webview.FileDialog.FOLDER)
        if folder and len(folder) > 0:
            path = folder[0].replace(os.sep, "/")
            return {"success": True, "path": path}
        return {"success": False}

    def save_pending_dir(self, pending_dir=None):
        """
        保存待解压区的自定义路径。
        参数为空字串则重设为预设路径。
        """
        try:
            if pending_dir is None:
                return {"success": True}

            if pending_dir == "":
                # 重设为预设
                self._cfg_mgr.set_pending_dir("")
                default_pending = self._lib_mgr.root_dir / ".." / DEFAULT_PENDING_DIR_NAME
                self._lib_mgr.update_paths(pending_dir=str(default_pending))
                log.info(f"待解压区已重设为预设路径: {default_pending}")
                return {"success": True}

            # 验证路径
            p = Path(pending_dir)
            if not p.exists():
                try:
                    p.mkdir(parents=True, exist_ok=True)
                except Exception as e:
                    return {"success": False, "msg": f"无法建立待解压区目录: {e}"}
            self._cfg_mgr.set_pending_dir(pending_dir)
            self._lib_mgr.update_paths(pending_dir=pending_dir)
            return {"success": True}
        except Exception as e:
            log.error(f"保存待解压区路径失败: {e}")
            return {"success": False, "msg": str(e)}

    def save_library_dir(self, library_dir=None):
        """
        保存语音包库的自定义路径。
        参数为空字串则重设为预设路径。
        """
        try:
            if library_dir is None:
                return {"success": True}

            if library_dir == "":
                # 重设为预设
                self._cfg_mgr.set_library_dir("")
                default_library = (
                    self._lib_mgr.root_dir / ".." / DEFAULT_RESOURCE_ROOT_DIR_NAME / DEFAULT_VOICE_LIBRARY_DIR_NAME
                )
                self._lib_mgr.update_paths(library_dir=str(default_library))
                log.info(f"语音包库已重设为预设路径: {default_library}")
                return {"success": True}

            # 验证路径
            p = Path(library_dir)
            if not p.exists():
                try:
                    p.mkdir(parents=True, exist_ok=True)
                except Exception as e:
                    return {"success": False, "msg": f"无法建立语音包库目录: {e}"}
            self._cfg_mgr.set_library_dir(library_dir)
            self._lib_mgr.update_paths(library_dir=library_dir)
            return {"success": True}
        except Exception as e:
            log.error(f"保存语音包库路径失败: {e}")
            return {"success": False, "msg": str(e)}

    def open_pending_folder(self):
        """打开待解压区目录。"""
        self._lib_mgr.open_pending_folder()

    def open_library_folder(self):
        """打开语音包库目录。"""
        self._lib_mgr.open_library_folder()

    # ==================== 任务库 / 模型库 / 机库 卡片管理 API ====================

    def get_tasks_list(self):
        """扫描任务库目录，返回子文件夹列表供前端卡片展示。"""
        try:
            items = self._task_mgr.scan_items()
            return {"valid": True, "items": items}
        except Exception as e:
            log.error(f"获取任务列表失败: {e}")
            return {"valid": False, "items": []}

    def rename_task(self, old_name, new_name):
        """重命名任务库中的子文件夹。"""
        try:
            self._task_mgr.rename_item(old_name, new_name)
            return {"success": True}
        except (ValueError, FileExistsError, FileNotFoundError) as e:
            return {"success": False, "msg": str(e)}
        except Exception as e:
            log.error(f"任务重命名异常: {e}")
            return {"success": False, "msg": str(e)}

    def update_task_cover_data(self, item_name, data_url):
        """将前端裁切后的 base64 图片写入任务封面。"""
        try:
            self._task_mgr.update_cover_data(item_name, data_url)
            return {"success": True}
        except (ValueError, FileNotFoundError) as e:
            return {"success": False, "msg": str(e)}
        except Exception as e:
            log.error(f"任务封面更新异常: {e}")
            return {"success": False, "msg": str(e)}

    def get_models_list(self):
        """扫描模型库目录，返回子文件夹列表供前端卡片展示。"""
        try:
            items = self._model_mgr.scan_items()
            return {"valid": True, "items": items}
        except Exception as e:
            log.error(f"获取模型列表失败: {e}")
            return {"valid": False, "items": []}

    def rename_model(self, old_name, new_name):
        """重命名模型库中的子文件夹。"""
        try:
            self._model_mgr.rename_item(old_name, new_name)
            return {"success": True}
        except (ValueError, FileExistsError, FileNotFoundError) as e:
            return {"success": False, "msg": str(e)}
        except Exception as e:
            log.error(f"模型重命名异常: {e}")
            return {"success": False, "msg": str(e)}

    def update_model_cover_data(self, item_name, data_url):
        """将前端裁切后的 base64 图片写入模型封面。"""
        try:
            self._model_mgr.update_cover_data(item_name, data_url)
            return {"success": True}
        except (ValueError, FileNotFoundError) as e:
            return {"success": False, "msg": str(e)}
        except Exception as e:
            log.error(f"模型封面更新异常: {e}")
            return {"success": False, "msg": str(e)}

    def get_hangar_list(self):
        """扫描机库目录，返回子文件夹列表供前端卡片展示。"""
        try:
            items = self._hangar_mgr.scan_items()
            return {"valid": True, "items": items}
        except Exception as e:
            log.error(f"获取机库列表失败: {e}")
            return {"valid": False, "items": []}

    def rename_hangar(self, old_name, new_name):
        """重命名机库中的子文件夹。"""
        try:
            self._hangar_mgr.rename_item(old_name, new_name)
            return {"success": True}
        except (ValueError, FileExistsError, FileNotFoundError) as e:
            return {"success": False, "msg": str(e)}
        except Exception as e:
            log.error(f"机库重命名异常: {e}")
            return {"success": False, "msg": str(e)}

    def update_hangar_cover_data(self, item_name, data_url):
        """将前端裁切后的 base64 图片写入机库封面。"""
        try:
            self._hangar_mgr.update_cover_data(item_name, data_url)
            return {"success": True}
        except (ValueError, FileNotFoundError) as e:
            return {"success": False, "msg": str(e)}
        except Exception as e:
            log.error(f"机库封面更新异常: {e}")
            return {"success": False, "msg": str(e)}


def _setup_tray(window):
    """
    设置系统托盘。
    
    功能定位:
    - 根据配置初始化托盘图标和菜单
    - 绑定窗口显示/隐藏事件
    """
    if not tray_manager.is_available():
        log.info("[TRAY] pystray 不可用，跳过托盘初始化")
        return

    def on_show():
        """托盘菜单：显示窗口"""
        try:
            window.show()
            window.evaluate_js("if(window.app && app.onWindowShown) app.onWindowShown();")
        except Exception as e:
            log.error(f"[TRAY] 显示窗口失败: {e}")

    def on_exit():
        """托盘菜单：退出程序"""
        log.info("[TRAY] 用户通过托盘退出程序")
        tray_manager.stop()
        try:
            window.destroy()
        except Exception:
            pass
        os._exit(0)

    # 设置托盘
    success = tray_manager.setup(
        window=window,
        on_show=on_show,
        on_exit=on_exit
    )

    if success:
        tray_manager.start()
        log.info("[TRAY] 系统托盘已初始化")
    else:
        log.warning("[TRAY] 系统托盘初始化失败")


def on_app_started():
    # 在窗口创建完成后执行启动后处理，包括关闭 PyInstaller 启动图并让前端进入可交互状态。
    # 延时以预留页面加载与渲染时间
    time.sleep(0.5)

    if getattr(sys, "frozen", False):
        try:
            import pyi_splash

            pyi_splash.close()
            log.info("[INFO] Splash screen closed.")
        except ImportError:
            pass

    for i in range(10):
        try:
            if webview.windows:
                win = webview.windows[0]
                win.evaluate_js(
                    "if (window.app && app.recoverToSafeState) app.recoverToSafeState('backend_start');"
                )
                state = win.evaluate_js(
                    "JSON.stringify({activePage: (document.querySelector('.page.active')||{}).id || null, openModals: Array.from(document.querySelectorAll('.modal-overlay.show')).map(x=>x.id)})"
                )
                log.info(f"[UI_STATE] {state}")
                break
        except Exception:
            # 启动初期 UI 尚未就绪很常见：仅在最后一次尝试记录详细原因
            if i == 9:
                log.debug("on_app_started: UI 尚未就绪", exc_info=True)
            time.sleep(0.2)


def main() -> int:
    _install_global_exception_handlers()

    cli = _parse_cli_args()

    if webview is None:
        err = globals().get("_WEBVIEW_IMPORT_ERROR")
        log.error("pywebview 载入失败: %s", err)
        _show_fatal_error(
            "缺少依赖：pywebview",
            "无法载入 pywebview，请先安装依赖：\n\npip install -r requirements.txt\n\n"
            f"错误：{err}",
        )
        return 2

    # 基本资源检查：避免黑画面或神祕崩溃
    index_html = WEB_DIR / "index.html"
    if not index_html.exists():
        msg = f"找不到前端入口档：{index_html}"
        log.error(msg)
        _show_fatal_error("资源缺失", msg)
        return 3

    # 创建后端 API 桥接对象
    api = AppApi(perf_enabled=bool(getattr(cli, "perf", False)))

    if sys.platform == "win32":
        try:
            import ctypes

            ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID("AimerWT.v2")
        except Exception:
            log.debug("设定 AppUserModelID 失败", exc_info=True)

    # 窗口尺寸参数
    window_width = 1200
    window_height = 740

    start_x = None
    start_y = None

    def _get_windows_work_area():
        if sys.platform != "win32":
            return None
        try:
            import ctypes
            from ctypes import wintypes

            class POINT(ctypes.Structure):
                _fields_ = [("x", wintypes.LONG), ("y", wintypes.LONG)]

            class RECT(ctypes.Structure):
                _fields_ = [
                    ("left", wintypes.LONG),
                    ("top", wintypes.LONG),
                    ("right", wintypes.LONG),
                    ("bottom", wintypes.LONG),
                ]

            class MONITORINFO(ctypes.Structure):
                _fields_ = [
                    ("cbSize", wintypes.DWORD),
                    ("rcMonitor", RECT),
                    ("rcWork", RECT),
                    ("dwFlags", wintypes.DWORD),
                ]

            user32 = ctypes.windll.user32
            point = POINT()
            if not user32.GetCursorPos(ctypes.byref(point)):
                return None

            # MONITOR_DEFAULTTONEAREST = 2
            hmonitor = user32.MonitorFromPoint(point, 2)
            if not hmonitor:
                return None

            mi = MONITORINFO()
            mi.cbSize = ctypes.sizeof(MONITORINFO)
            if not user32.GetMonitorInfoW(hmonitor, ctypes.byref(mi)):
                return None

            r = mi.rcWork
            return int(r.left), int(r.top), int(r.right), int(r.bottom)
        except Exception:
            log.debug("取得 Windows 工作区失败", exc_info=True)
            return None

    # 置中策略：优先用 Windows 工作区（避开工作列/多萤幕）；不行再退回 webview.screens
    try:
        work = _get_windows_work_area()
        if work:
            left, top, right, bottom = work
            work_w = max(0, right - left)
            work_h = max(0, bottom - top)
            if work_w and work_h:
                start_x = left + (work_w - window_width) // 2
                start_y = top + (work_h - window_height) // 2
        else:
            screens = getattr(webview, "screens", None)
            if screens:
                primary = screens[0]
                start_x = (primary.width - window_width) // 2
                start_y = (primary.height - window_height) // 2
    except Exception:
        log.warning("计算窗口居中坐标失败，改用默认窗口位置", exc_info=True)

    # 检查是否静默启动
    silent_mode = getattr(cli, "silent", False) or getattr(cli, "tray_only", False)

    # 创建窗口实例（x/y 指定启动位置）
    try:
        window = webview.create_window(
            title="Aimer WT v3 内测",
            url=str(index_html),
            js_api=api,
            width=window_width,
            height=window_height,
            x=start_x,
            y=start_y,
            min_size=(1000, 700),
            background_color="#F5F7FA",
            resizable=True,
            text_select=False,
            frameless=True,
            easy_drag=False,
            hidden=silent_mode,  # 静默启动时隐藏窗口
        )
    except Exception as e:
        log.exception("建立视窗失败")
        _show_fatal_error("启动失败", f"建立视窗失败：{e}\n\n详见 logs/app.log")
        return 4

    # 绑定窗口对象到桥接层
    api.set_window(window)

    # TODO: 当前拖放导入在部分压缩包场景下仍可能阻塞，需要单独治理后再启用。
    def _bind_drag_drop(win):
        # 绑定拖拽投放事件，用于在特定页面接收文件拖入并触发导入流程。
        try:
            from webview.dom import DOMEventHandler
        except Exception:
            log.debug("DOMEventHandler 不可用，略过拖放绑定")
            return

        def on_drop(e):
            def _async_processor():
                try:
                    win.evaluate_js("if(window.app && app.hideDropOverlay) app.hideDropOverlay()")

                    try:
                        active_page = win.evaluate_js("(document.querySelector('.page.active')||{}).id || ''")
                    except Exception:
                        active_page = ""

                    allowed_pages = ["page-home", "page-lib", "page-camo", "page-sight"]
                    if not active_page or active_page not in allowed_pages:
                        return

                    if active_page == "page-home":
                        win.evaluate_js("app.switchTab('lib')")
                        active_page = "page-lib"

                    # 提取文件路径
                    try:
                        data_tx = e.get("dataTransfer") or {}
                        files = data_tx.get("files") or []
                    except Exception:
                        files = []

                    full_paths = []
                    for f in files:
                        p = f.get("pywebviewFullPath")
                        if p:
                            full_paths.append(str(p))

                    if not full_paths:
                        return

                    archive_exts = (".zip", ".rar", ".7z", ".tar", ".gz", ".bz2", ".xz", ".tgz", ".tbz2", ".bank")
                    zip_files = [p for p in full_paths if p.lower().endswith(archive_exts)]
                    if not zip_files:
                        return

                    zp = zip_files[0]

                    if active_page == "page-lib":
                        api.import_voice_zip_from_path(zp)
                    elif active_page == "page-camo":
                        try:
                            res_view = win.evaluate_js(
                                "(document.querySelector('#page-camo .resource-nav-item.active')||{}).dataset.target || 'skins'"
                            )
                        except Exception:
                            res_view = "skins"

                        if res_view == "sights":
                            api.import_sights_zip_from_path(zp)
                        else:
                            api.import_skin_zip_from_path(zp)
                    elif active_page == "page-sight":
                        api.import_sights_zip_from_path(zp)

                except Exception as ex:
                    log.error(f"拖拽处理发生异常: {ex}", exc_info=True)

            threading.Thread(target=_async_processor, daemon=True).start()

        try:
            win.dom.document.events.drop += DOMEventHandler(on_drop, True, False)
        except Exception:
            log.debug("绑定拖放事件失败", exc_info=True)
            return

    def _on_start(win):
        # TODO 需要优化，拖放压缩包时大概率卡死
        # try:
        #     _bind_drag_drop(win)
        # except Exception:
        #     log.exception("_bind_drag_drop 失败")

        # 部分 GUI 后端可能忽略 create_window 的 x/y；启动后补一次置中
        try:
            if start_x is not None and start_y is not None and hasattr(win, "move"):
                win.move(int(start_x), int(start_y))
        except Exception:
            log.debug("启动后移动视窗失败", exc_info=True)

        try:
            on_app_started()
        except Exception:
            log.exception("on_app_started 失败")

        # 初始化托盘管理器
        _setup_tray(win)

    # 启动
    icon_path = str(WEB_DIR / "assets" / "logo.ico")
    # WebKitGTK (Linux) 下 file:// 协议会阻止 JS 模块加载，需启用 HTTP 服务
    use_http_server = sys.platform != "win32"
    try:
        # 尝试使用 edgechromium 内核（性能更好）
        webview.start(
            _on_start,
            window,
            debug=False,
            http_server=use_http_server,
            gui="edgechromium",
            icon=icon_path,
        )
        return 0
    except Exception as e:
        log.error(f"Edge Chromium 启动失败，尝试默认模式: {e}")

        # 在 Windows 上，若缺少 WebView2 Runtime，pywebview 可能回退到 MSHTML(IE)，
        # 因此在侦测到 WebView2 不存在时，优先提示用户安装，而不是静默降级。
        if sys.platform == "win32" and not _windows_has_webview2_runtime():
            allow_fallback = bool(getattr(cli, "allow_fallback", False))
            if not allow_fallback:
                msg = (
                    "侦测到系统未安装 Microsoft Edge WebView2 Runtime。\n\n"
                    "本程序需要 WebView2 才能正常显示与交互（否则会回退到旧版 IE 内核，导致一些意外的错误）。\n\n"
                    "请安装 WebView2 Evergreen Runtime 后再启动：\n"
                    "https://developer.microsoft.com/microsoft-edge/webview2/\n\n"
                    "（如仍想尝试旧模式启动，可使用启动参数 --allow-fallback）"
                )
                _show_fatal_error("缺少 WebView2 Runtime", msg)
                return 6

        try:
            # 降级启动
            webview.start(_on_start, window, debug=False, http_server=use_http_server, icon=icon_path)
            return 0
        except Exception as e2:
            log.exception("webview 启动失败（含降级）")
            _show_fatal_error("启动失败", f"webview 启动失败：{e2}\n\n详见 logs/app.log")
            return 5


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        raise SystemExit(130)
