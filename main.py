# -*- coding: utf-8 -*-
import argparse
import base64
import itertools
import json
import os
import random
import sys
import threading
import time
import platform
import subprocess

try:
    import webview
except Exception as _e:
    webview = None
    _WEBVIEW_IMPORT_ERROR = _e

from pathlib import Path
from config_manager import ConfigManager
from core_logic import CoreService
from library_manager import ArchivePasswordCanceled, LibraryManager
from logger import setup_logger, get_logger, set_ui_callback
from sights_manager import SightsManager
from skins_manager import SkinsManager
from telemetry_manager import init_telemetry, get_hwid

APP_VERSION = "2.1.0"
AGREEMENT_VERSION = "2026-01-10"

# 资源目录定位：打包环境使用 _MEIPASS，开发环境使用源码目录
if getattr(sys, "frozen", False):
    BASE_DIR = Path(sys._MEIPASS)
else:
    BASE_DIR = Path(__file__).parent
WEB_DIR = BASE_DIR / "web"

log = get_logger(__name__)


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
    """将未捕捉例外统一写入 app.log，避免只有 console 报错。"""

    def _excepthook(exc_type, exc, tb):
        if issubclass(exc_type, KeyboardInterrupt):
            sys.__excepthook__(exc_type, exc, tb)
            return

        try:
            fatal_log = get_logger("fatal")
            fatal_log.critical("未捕捉例外", exc_info=(exc_type, exc, tb))
        except Exception:
            pass

        _show_fatal_error(
            "Aimer WT 发生错误",
            f"程式遇到未处理的错误而终止。\n\n"
            f"{exc_type.__name__}: {exc}\n\n"
            f"详细资讯请查看 logs/app.log",
        )

    sys.excepthook = _excepthook

    # Python 3.8+：捕捉 thread 未处理例外
    if hasattr(threading, "excepthook"):

        def _thread_excepthook(args):
            try:
                th_log = get_logger("thread")
                th_log.critical(
                    "背景执行绪未捕捉例外: %s (%s)",
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


def _open_url(url: str) -> None:
    if sys.platform != "win32":
        return
    try:
        # 使用系统预设浏览器
        subprocess.Popen(["cmd", "/c", "start", "", url], shell=False)
    except Exception:
        pass


def _parse_cli_args(argv: list[str] | None = None) -> argparse.Namespace:
    """解析启动参数（不使用环境变数）。"""
    if argv is None:
        argv = sys.argv[1:]

    # 不要让 argparse 在 GUI 程式中直接 sys.exit()
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--allow-fallback", action="store_true")
    parser.add_argument("--perf", action="store_true")

    try:
        args, _unknown = parser.parse_known_args(argv)
        return args
    except Exception:
        return argparse.Namespace(allow_fallback=False, perf=False)


class AppApi:
    # 提供前端可调用的后端 API 集合，并协调配置、库管理、安装与资源管理等模块。

    def __init__(self, *, perf_enabled: bool = False):
        # 初始化桥接层的状态、各业务管理器与日志系统。
        self._lock = threading.Lock()

        self._logger = setup_logger()

        self._perf_enabled = bool(perf_enabled)

        # 保存 PyWebview Window 引用（用于调用 evaluate_js 与打开系统对话框）

        # 连接 logger -> 前端 UI（窗口未创建时会自动忽略）
        set_ui_callback(self._append_log_to_ui)

        # [关键修复] 将 window 改为 _window。
        # 加下划线表示私有变量，pywebview 就不会尝试去扫描和序列化整个窗口对象，
        # 从而避免了 "window.native... maximum recursion depth" 错误。
        self._window = None

        # 管理器实例：配置、语音包库、涂装、炮镜、游戏目录操作
        # 注意：所有管理器现在统一使用 logger.py 的日誌系统
        self._cfg_mgr = ConfigManager()

        # 从配置读取自定义路径
        custom_pending = self._cfg_mgr.get_pending_dir()
        custom_library = self._cfg_mgr.get_library_dir()
        self._lib_mgr = LibraryManager(
            pending_dir=custom_pending if custom_pending else None,
            library_dir=custom_library if custom_library else None
        )

        self._skins_mgr = SkinsManager()
        self._sights_mgr = SightsManager()
        self._logic = CoreService()

        # 初始化遥测系统
        if self._cfg_mgr.get_telemetry_enabled():
            tm = init_telemetry(APP_VERSION)
            tm.set_server_message_callback(self.on_server_message)
            tm.set_user_command_callback(self.on_user_command)
            tm.set_log_callback(self._logger)

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

    def on_server_message(self, config: dict):
        """处理服务端下发的系统消息（公告/更新/维护）"""
        if not self._window:
            return

        def safe_js_call(func_name, *args):
            # 将参数序列化为 JSON 字符串，确保特殊字符（引号、换行）被正确转义
            js_args = ", ".join([json.dumps(arg, ensure_ascii=False) for arg in args])
            return f"if(window.app && app.{func_name}) app.{func_name}({js_args})"

        try:
            # 1. 维护模式处理 (状态发生变化时才提示)
            is_maint = config.get("maintenance", False)
            maint_msg = config.get("maintenance_msg", "")
            maint_key = f"{is_maint}:{maint_msg}"

            if is_maint and (self._last_maintenance_status != maint_key):
                self._logger.warning(f"[SYS] ⚠️ 维护模式已开启: {maint_msg}")
                self._window.evaluate_js(safe_js_call("showWarnToast", "维护模式已开启", maint_msg, 8000))

            self._last_maintenance_status = maint_key

            # 2. 紧急通知弹窗 (Alert - 内容变化时才提示)
            if config.get("alert_active"):
                title = config.get("alert_title", "系统通知")
                content = config.get("alert_content", "")
                full_alert_key = f"{title}|{content}"

                if content and (self._last_alert_content != full_alert_key):
                    self._logger.info(f"[通知] {title}")
                    self._window.evaluate_js(safe_js_call("showAlert", title, content, "info"))
                    self._last_alert_content = full_alert_key

            # 3. 公告栏常驻内容 (Notice - 发现有效内容则覆盖首页公告)
            if config.get("notice_active"):
                notice_content = config.get("notice_content", "")
                if notice_content and (self._last_notice_content != notice_content):
                    self._window.evaluate_js(safe_js_call("updateNoticeBar", notice_content))
                    self._last_notice_content = notice_content

            # 4. 更新提示 (内容变化时才提示)
            if config.get("update_active"):
                content = config.get("update_content", "")
                update_url = config.get("update_url", "")

                update_key = f"{content}|{update_url}"
                if content and (self._last_update_content != update_key):
                    self._logger.info(f"[更新] {content}")
                    self._window.evaluate_js(safe_js_call("showAlert", "发现新版本", content, "success", update_url))
                    self._last_update_content = update_key

        except Exception as e:
            print(f"消息处理异常: {e}")

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

        except Exception as e:
            print(f"专用指令解析异常: {e}")

    def set_window(self, window):
        # 绑定 PyWebview Window 实例到桥接层，供后续 API 调用使用。
        self._window = window

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

        # 2. 处理 Toast 通知
        # 我们可以根据 record.message 或 record.levelname 判断是否弹窗。
        # 以前的逻辑是：如果 levelKey in (WARN, ERROR, SUCCESS) 则弹窗。
        # 这里我们需要从 message 探测 [SUCCESS] 这种自定义标签，因为 standard logging 只有 INFO/WARN/ERROR。

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

        return {
            "game_path": path,
            "path_valid": is_valid,
            "theme": theme,
            "active_theme": self._cfg_mgr.get_active_theme(),
            "installed_mods": self._logic.get_installed_mods(),
            "sights_path": sights_path,
            "hwid": get_hwid(),
            "telemetry_enabled": self._cfg_mgr.get_telemetry_enabled()
        }

    def save_theme_selection(self, filename):
        # 保存前端选择的主题文件名到配置。
        self._cfg_mgr.set_active_theme(filename)

    def set_theme(self, mode):
        # 保存前端选择的主题模式（Light/Dark）到配置。
        self._cfg_mgr.set_theme_mode(mode)

    def get_telemetry_status(self):
        """
        功能定位:
        - 获取当前遥测开启状态。
        """
        return self._cfg_mgr.get_telemetry_enabled()

    def set_telemetry_status(self, enabled):
        """
        功能定位:
        - 设置遥测开启状态，并实时启动/停止后台服务。
        """
        self._cfg_mgr.set_telemetry_enabled(enabled)

        # 无论开启还是关闭，都获取单例（如果尚未初始化则初始化）
        tm = init_telemetry(APP_VERSION)

        if enabled:
            # 重新绑定回调
            tm.set_server_message_callback(self.on_server_message)
            tm.set_user_command_callback(self.on_user_command)
            tm.set_log_callback(self._logger)

            # 手动重启服务：先停止可能存在的旧循环，再启动新循环
            tm.stop()
            tm.start_heartbeat_loop()
            tm.report_startup()
            self._logger.info("[SYS] 遥测服务已启用")
        else:
            tm.stop()
            self._logger.info("[SYS] 遥测服务已停用")

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

        # 未列入允许名单的 folder_type 不执行任何操作

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
            "Archive Files (*.zip;*.rar;*.7z;*.tar;*.gz;*.bz2;*.xz;*.tgz;*.tbz2)",
            "Zip Files (*.zip)",
            "Rar Files (*.rar)",
            "7zip Files (*.7z)",
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
                self._logic.install_from_library(
                    mod_path, install_list, progress_callback=self.update_loading_ui
                )

                # 安装完成，通知前端
                if self._window:
                    self._window.evaluate_js(
                        f"if(app.onInstallSuccess) app.onInstallSuccess('{mod_name}')"
                    )
                    msg_js = json.dumps("安装完成", ensure_ascii=False)
                    self._window.evaluate_js(
                        f"if(window.MinimalistLoading) MinimalistLoading.update(100, {msg_js})"
                    )
            except Exception as e:
                log.error(f"安装失败: {e}")
                if self._window:
                    msg_js = json.dumps("安装失败", ensure_ascii=False)
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
        # 从语音包库目录中删除指定语音包文件夹。
        if self._is_busy:
            log.warning("另一个任务正在进行中，请稍候...")
            return False

        import shutil

        try:
            library_dir = Path(self._lib_mgr.library_dir).resolve()
            target = (library_dir / str(mod_name)).resolve()
            if os.path.commonpath([str(target), str(library_dir)]) != str(
                    library_dir
            ) or str(target) == str(library_dir):
                raise Exception("非法路径")
            shutil.rmtree(target)
            log.info(f"已删除语音包: {mod_name}")
            return True
        except Exception as e:
            log.error(f"删除失败: {e}")
            return False

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
                    theme_list.append(
                        {
                            "filename": file.name,
                            "name": meta.get("name", file.stem),
                            "author": meta.get("author", "Unknown"),
                            "version": meta.get("version", "1.0"),
                        }
                    )
            except Exception as e:
                log.error(f"读取主题 {file.name} 失败: {e}")

        return theme_list

    def load_theme_content(self, filename):
        # 读取指定主题文件的完整 JSON 内容并返回给前端应用。
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
                default_pending = self._lib_mgr.root_dir / "WT待解压区"
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
                default_library = self._lib_mgr.root_dir / "WT语音包库"
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
            return (int(r.left), int(r.top), int(r.right), int(r.bottom))
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

    # 创建窗口实例（x/y 指定启动位置）
    try:
        window = webview.create_window(
            title="Aimer WT v2 Beta",
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
        )
    except Exception as e:
        log.exception("建立视窗失败")
        _show_fatal_error("启动失败", f"建立视窗失败：{e}\n\n详见 logs/app.log")
        return 4

    # 绑定窗口对象到桥接层
    api.set_window(window)
    

    # TODO 需要优化，拖放压缩包时大概率卡死
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

                    archive_exts = (".zip", ".rar", ".7z", ".tar", ".gz", ".bz2", ".xz", ".tgz", ".tbz2")
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

    # 启动
    icon_path = str(WEB_DIR / "assets" / "logo.ico")
    try:
        # 尝试使用 edgechromium 内核（性能更好）
        webview.start(
            _on_start,
            window,
            debug=False,
            http_server=False,
            gui="edgechromium",
            icon=icon_path,
        )
        return 0
    except Exception as e:
        log.error(f"Edge Chromium 启动失败，尝试默认模式: {e}")

        # 在 Windows 上，若缺少 WebView2 Runtime，pywebview 可能回退到 MSHTML(IE)，
        # 因此在侦测到 WebView2 不存在时，优先提示使用者安装，而不是静默降级。
        if sys.platform == "win32" and not _windows_has_webview2_runtime():
            allow_fallback = bool(getattr(cli, "allow_fallback", False))
            if not allow_fallback:
                msg = (
                    "侦测到系统未安装 Microsoft Edge WebView2 Runtime。\n\n"
                    "本程式需要 WebView2 才能正常显示与互动（否则会回退到旧版 IE 内核，导致一些意外的错误）。\n\n"
                    "请安装 WebView2 Evergreen Runtime 后再启动：\n"
                    "https://developer.microsoft.com/microsoft-edge/webview2/\n\n"
                    "（如仍想尝试旧模式启动，可使用启动参数 --allow-fallback）"
                )
                _show_fatal_error("缺少 WebView2 Runtime", msg)
                return 6

        try:
            # 降级启动
            webview.start(_on_start, window, debug=False, http_server=False, icon=icon_path)
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
