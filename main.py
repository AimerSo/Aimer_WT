# -*- coding: utf-8 -*-

"""
应用启动入口与前后端桥接模块（PyWebview）。

功能定位:
- 启动 PyWebview 窗口并加载前端页面资源（web/）。
- 定义供前端通过 pywebview.api 调用的后端 API（路径设置、语音包库管理、安装/还原、涂装/炮镜管理、主题与协议状态等）。
- 统一后端日志输出：写入本地日志文件并推送到前端日志面板/提示组件。

输入输出:
- 输入:
  - 前端通过 pywebview.api.* 传入的参数（字符串/布尔/JSON 字符串等）。
  - 本地配置文件 settings.json（由 ConfigManager 读取）。
- 输出:
  - 前端可消费的 JSON 结构（dict/list），由 pywebview 自动序列化返回。
  - 文件系统副作用：语音包库目录写入、游戏目录 sound/mod 写入、config.blk 写入、日志文件写入等（由下游模块执行）。
- 外部资源/依赖:
  - webview（PyWebview）窗口与 evaluate_js 桥接
  - 本地目录: web/ 静态资源目录
  - 其他模块: ConfigManager/CoreService/LibraryManager/SkinsManager/SightsManager/setup_logger

实现逻辑:
- 1) 计算资源目录 BASE_DIR/WEB_DIR（区分 frozen 与开发环境）。
- 2) AppApi 聚合各业务管理器并暴露给前端调用。
- 3) 通过 log_from_backend 统一处理：写文件日志 + 推送前端展示。

业务关联:
- 上游: 用户在前端界面触发的操作（按钮/输入/拖拽/导入等）。
- 下游: 调用 core_logic/library_manager 等模块对语音包库与游戏目录执行实际读写。
"""

import base64
import itertools
import json
import os
import random
import re
import sys
import threading
import time
from pathlib import Path

import webview

from config_manager import ConfigManager
from core_logic import CoreService
from library_manager import ArchivePasswordCanceled, LibraryManager
from logger import setup_logger
from sights_manager import SightsManager
from skins_manager import SkinsManager

AGREEMENT_VERSION = "2026-01-10"

# 资源目录定位：打包环境使用 _MEIPASS，开发环境使用源码目录
if getattr(sys, "frozen", False):
    BASE_DIR = Path(sys._MEIPASS)
else:
    BASE_DIR = Path(__file__).parent
WEB_DIR = BASE_DIR / "web"

def _set_windows_appid(appid):
    """
    功能定位:
    - 在 Windows 下设置当前进程的 AppUserModelID，用于任务栏分组与图标识别。

    输入输出:
    - 参数:
      - appid: str，应用标识字符串。
    - 返回: None
    - 外部资源/依赖: ctypes（Windows API）

    实现逻辑:
    - 调用 SetCurrentProcessExplicitAppUserModelID；失败时忽略异常。

    业务关联:
    - 上游: 应用启动阶段调用。
    - 下游: 影响 Windows 任务栏的显示行为。
    """
    try:
        import ctypes
        ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID(appid)
    except Exception:
        pass


class AppApi:
    """
    功能定位:
    - 提供前端可调用的后端 API 集合，并协调配置、库管理、安装与资源管理等模块。

    输入输出:
    - 输入: 前端通过 pywebview.api 传入的参数（路径、文件名、JSON 字符串、base64 数据等）。
    - 输出: 返回 dict/list/bool 等可序列化结果；并通过 evaluate_js 推送日志与提示。
    - 外部资源/依赖:
      - self._window（PyWebview Window，负责 evaluate_js 与对话框）
      - ConfigManager（settings.json）
      - CoreService（游戏目录安装/还原、config.blk 写入）
      - LibraryManager（语音包库/待解压区、解压与元数据读取）
      - SkinsManager/SightsManager（UserSkins/UserSights 管理）
      - setup_logger（日志文件）

    实现逻辑:
    - 通过线程锁与状态位控制并发操作（避免重复任务叠加）。
    - 对部分参数进行格式兼容（例如 JSON 字符串形式的列表参数）。
    - 通过 log_from_backend 统一处理日志与前端展示。

    业务关联:
    - 上游: web/script.js 中的 app.* 方法调用。
    - 下游: 调用各业务模块执行文件系统操作与数据生成。
    """

    def __init__(self):
        """
        功能定位:
        - 初始化桥接层的状态、各业务管理器与日志系统。

        输入输出:
        - 参数: 无
        - 返回: None
        - 外部资源/依赖:
          - 环境变量: AIMERWT_PERF（性能开关）
          - 日志: setup_logger
          - 其他模块: ConfigManager/CoreService/LibraryManager/SkinsManager/SightsManager

        实现逻辑:
        - 1) 初始化线程锁与任务状态位。
        - 2) 初始化日志记录器。
        - 3) 初始化管理器对象并将 log_from_backend 作为回调注入。
        - 4) 初始化与“压缩包密码输入”相关的线程同步对象。

        业务关联:
        - 上游: 应用启动时创建 AppApi 实例。
        - 下游: 供前端调用的所有 API 方法依赖此处初始化的对象。
        """
        self._lock = threading.Lock()

        self._logger = setup_logger()

        self._perf_enabled = os.environ.get("AIMERWT_PERF", "").strip() == "1"

        # 保存 PyWebview Window 引用（用于调用 evaluate_js 与打开系统对话框）
        self._window = None

        # 管理器实例：配置、语音包库、涂装、炮镜、游戏目录操作
        self._cfg_mgr = ConfigManager()
        self._lib_mgr = LibraryManager(self.log_from_backend)
        self._skins_mgr = SkinsManager(self.log_from_backend)
        self._sights_mgr = SightsManager(self.log_from_backend)
        self._logic = CoreService()
        self._logic.set_callbacks(self.log_from_backend)

        self._search_running = False
        self._is_busy = False
        self._password_event = threading.Event()
        self._password_lock = threading.Lock()
        self._password_value = None
        self._password_cancelled = False

    def set_window(self, window):
        """
        功能定位:
        - 绑定 PyWebview Window 实例到桥接层，供后续 API 调用使用。

        输入输出:
        - 参数:
          - window: webview.Window，PyWebview 窗口对象。
        - 返回: None
        - 外部资源/依赖: 无

        实现逻辑:
        - 保存引用到 self._window。

        业务关联:
        - 上游: 应用创建窗口后调用。
        - 下游: 日志推送、文件对话框、窗口控制依赖该对象。
        """
        self._window = window

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
        - 上游: 主题文件读取等功能使用。
        - 下游: 为前端提供主题/配置等 JSON 内容。
        """
        encodings = ["utf-8-sig", "utf-8", "cp950", "big5", "gbk"]
        for enc in encodings:
            try:
                with open(file_path, "r", encoding=enc) as f:
                    return json.load(f)
            except Exception:
                continue
        return None

    # --- 日志回调 ---
    def log_from_backend(self, message, level="INFO"):
        """
        功能定位:
        - 接收后端各模块的日志，并同步输出到文件日志与前端日志面板。

        输入输出:
        - 参数:
          - message: str，日志内容（可能包含时间戳/级别前缀）。
          - level: str，调用方提供的级别标签（INFO/WARN/ERROR/SUCCESS/SYS 等）。
        - 返回: None
        - 外部资源/依赖:
          - 日志记录器: self._logger
          - 前端推送: self._window.evaluate_js（app.appendLog / app.notifyToast）

        实现逻辑:
        - 1) 解析 level_key：若 level 为 INFO 且 message 内含 [WARN/ERROR/SUCCESS/INFO/SYS] 前缀，则以该前缀为准。
        - 2) 将日志写入文件日志（按 level_key 映射到 logger 方法）。
        - 3) 将日志推送到前端：文本进行换行转 <br>，并在 WARN/ERROR/SUCCESS 时触发 toast 提示。

        业务关联:
        - 上游: CoreService/LibraryManager/SkinsManager/SightsManager 等模块调用。
        - 下游: 前端日志面板与提示组件展示该信息；本地 logs/app.log 记录该信息。
        """
        try:
            level_key = level
            if level_key == "INFO":
                match = re.search(r"\[(WARN|ERROR|SUCCESS|INFO|SYS)\]", str(message))
                if match:
                    level_key = match.group(1)
            log_level_map = {
                "INFO": self._logger.info,
                "WARN": self._logger.warning,
                "ERROR": self._logger.error,
                "SUCCESS": self._logger.info,
                "SYS": self._logger.debug,
            }
            log_func = log_level_map.get(level_key, self._logger.info)
            log_func(f"[{level_key}] {message}")
        except Exception as e:
            print(f"日志文件写入失败: {e}")

        if self._window:
            try:
                # 统一前端展示格式：在缺少级别前缀时补齐时间戳与级别
                if level_key != "INFO" and f"[{level_key}]" not in message:
                    timestamp = time.strftime("%H:%M:%S")
                    message = f"[{timestamp}] [{level_key}] {message}"
                safe_msg = message.replace("\r", "").replace("\n", "<br>")
                msg_js = json.dumps(safe_msg, ensure_ascii=False)

                webview.settings["ALLOW_DOWNLOADS"] = True
                self._window.evaluate_js(f"app.appendLog({msg_js})")
                if level_key in ("WARN", "ERROR", "SUCCESS"):
                    msg_plain = message.replace("\r", " ").replace("\n", " ")
                    msg_plain_js = json.dumps(msg_plain, ensure_ascii=False)
                    level_js = json.dumps(level_key, ensure_ascii=False)
                    self._window.evaluate_js(f"if(window.app && app.notifyToast) app.notifyToast({level_js}, {msg_plain_js})")
            except Exception as e:
                print(f"日志推送失败: {e}")

    # --- 窗口控制 ---
    def toggle_topmost(self, is_top):
        """
        功能定位:
        - 设置窗口置顶状态（on_top），并保证 API 调用快速返回。

        输入输出:
        - 参数:
          - is_top: bool，True 表示置顶，False 表示取消置顶。
        - 返回:
          - bool，调用已提交返回 True。
        - 外部资源/依赖:
          - PyWebview Window: self._window.on_top
          - threading（后台线程）

        实现逻辑:
        - 在后台线程中设置窗口 on_top 属性，避免阻塞前端等待。

        业务关联:
        - 上游: 前端置顶按钮触发。
        - 下游: 影响窗口置顶状态。
        """
        def _update_topmost():
            if self._window:
                try:
                    self._window.on_top = is_top
                except Exception as e:
                    print(f"置顶设置失败: {e}")

        t = threading.Thread(target=_update_topmost)
        t.daemon = True
        t.start()
        return True

    def drag_window(self):
        """
        功能定位:
        - 预留接口：用于在支持的 PyWebview 模式下触发窗口拖拽。

        输入输出:
        - 参数: 无
        - 返回: None
        - 外部资源/依赖: 取决于 PyWebview 运行模式

        实现逻辑:
        - 当前不执行具体动作。

        业务关联:
        - 上游: 前端若实现拖拽相关调用可使用该入口。
        - 下游: 无。
        """
        pass

    # --- 新增窗口控制 API ---
    def minimize_window(self):
        """
        功能定位:
        - 最小化当前窗口。

        输入输出:
        - 参数: 无
        - 返回: None
        - 外部资源/依赖: self._window.minimize

        实现逻辑:
        - 当窗口对象存在时调用 minimize。

        业务关联:
        - 上游: 前端最小化按钮触发。
        - 下游: 影响窗口状态。
        """
        if self._window:
            self._window.minimize()

    def close_window(self):
        """
        功能定位:
        - 关闭当前窗口并结束应用。

        输入输出:
        - 参数: 无
        - 返回: None
        - 外部资源/依赖: self._window.destroy、os._exit

        实现逻辑:
        - 1) 当窗口对象存在时，检查 WebView2 Core 是否可用。
        - 2) Core 可用时调用 destroy。
        - 3) Core 不可用时直接结束进程，避免关闭阶段异常。

        业务关联:
        - 上游: 前端关闭按钮触发。
        - 下游: 结束应用窗口生命周期。
        """
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
        """
        功能定位:
        - 汇总并返回前端初始化所需状态，包括配置中的路径、主题、当前语音包与炮镜路径。

        输入输出:
        - 参数: 无
        - 返回:
          - dict，包含 game_path/path_valid/theme/active_theme/current_mod/sights_path 等字段。
        - 外部资源/依赖:
          - settings.json（通过 ConfigManager 读取）
          - 游戏目录校验（CoreService.validate_game_path）
          - 炮镜路径设置（SightsManager.set_usersights_path）

        实现逻辑:
        - 1) 从配置读取 game_path/theme/sights_path。
        - 2) 若存在 game_path，则校验有效性并写日志。
        - 3) 若存在 sights_path，则尝试设置；失败则清空配置并写日志。
        - 4) 返回初始化数据供前端渲染与状态恢复。

        业务关联:
        - 上游: web/script.js 在 pywebviewready 后调用。
        - 下游: 前端根据返回数据刷新路径状态、主题按钮与当前语音包标记。
        """
        path = self._cfg_mgr.get_game_path()
        theme = self._cfg_mgr.get_theme_mode()
        sights_path = self._cfg_mgr.get_sights_path()

        # 验证路径
        is_valid = False
        if path:
            is_valid, _ = self._logic.validate_game_path(path)
            if is_valid:
                self.log_from_backend(f"[INIT] 已加载配置路径: {path}")
            else:
                self.log_from_backend(f"[WARN] 配置路径失效: {path}")

        if sights_path:
            try:
                self._sights_mgr.set_usersights_path(sights_path)
            except Exception as e:
                self.log_from_backend(f"[WARN] 炮镜路径失效: {e}", "WARN")
                sights_path = ""
                self._cfg_mgr.set_sights_path("")

        return {
            "game_path": path,
            "path_valid": is_valid,
            "theme": theme,
            "active_theme": self._cfg_mgr.get_active_theme(),
            "installed_mods": self._logic.get_installed_mods(),
            "sights_path": sights_path
        }

    def save_theme_selection(self, filename):
        """
        功能定位:
        - 保存前端选择的主题文件名到配置。

        输入输出:
        - 参数:
          - filename: str，主题文件名。
        - 返回: None
        - 外部资源/依赖: settings.json（通过 ConfigManager 写入）

        实现逻辑:
        - 调用 ConfigManager.set_active_theme 写入配置。

        业务关联:
        - 上游: 前端主题下拉框变更触发。
        - 下游: 下次启动时恢复该主题选择。
        """
        self._cfg_mgr.set_active_theme(filename)

    def set_theme(self, mode):
        """
        功能定位:
        - 保存前端选择的主题模式（Light/Dark）到配置。

        输入输出:
        - 参数:
          - mode: str，主题模式字符串。
        - 返回: None
        - 外部资源/依赖: settings.json（通过 ConfigManager 写入）

        实现逻辑:
        - 调用 ConfigManager.set_theme_mode 写入配置。

        业务关联:
        - 上游: 前端主题切换按钮触发。
        - 下游: 下次启动时恢复主题模式。
        """
        self._cfg_mgr.set_theme_mode(mode)

    def browse_folder(self):
        """
        功能定位:
        - 打开目录选择对话框，获取用户选择的游戏根目录并进行校验与保存。

        输入输出:
        - 参数: 无
        - 返回:
          - dict | None，成功时返回 {valid, path}；失败时返回 {valid, path, msg}；用户取消返回 None。
        - 外部资源/依赖:
          - PyWebview 对话框: self._window.create_file_dialog
          - 游戏目录校验: CoreService.validate_game_path
          - 配置写入: ConfigManager.set_game_path

        实现逻辑:
        - 1) 打开文件夹选择对话框并读取选择结果。
        - 2) 将路径分隔符标准化后调用 validate_game_path 校验。
        - 3) 校验通过则写入配置并返回有效结果；否则记录日志并返回无效结果。

        业务关联:
        - 上游: 前端“手动选择路径”操作触发。
        - 下游: 影响后续安装/还原流程的目标游戏目录。
        """
        folder = self._window.create_file_dialog(webview.FileDialog.FOLDER)
        if folder and len(folder) > 0:
            path = folder[0].replace(os.sep, "/")
            valid, msg = self._logic.validate_game_path(path)
            if valid:
                self._cfg_mgr.set_game_path(path)
                self.log_from_backend(f"[SUCCESS] 手动加载路径: {path}")
                return {"valid": True, "path": path}
            else:
                self.log_from_backend(f"[ERROR] 路径无效: {msg}")
                return {"valid": False, "path": path, "msg": msg}
        return None

    def start_auto_search(self):
        """
        功能定位:
        - 在后台线程执行游戏目录自动搜索，并将结果写入配置后通知前端更新显示。

        输入输出:
        - 参数: 无
        - 返回: None
        - 外部资源/依赖:
          - CoreService.auto_detect_game_path（注册表与磁盘路径扫描）
          - ConfigManager.set_game_path（写入 settings.json）
          - 前端回调: app.updateSearchLog/app.onSearchSuccess/app.onSearchFail

        实现逻辑:
        - 1) 若已有搜索线程运行则直接返回。
        - 2) 后台线程中调用 auto_detect_game_path 获取候选路径。
        - 3) 通过定时节流向前端推送“搜索进度文本”。
        - 4) 若找到路径则保存配置并通知前端成功；否则通知前端失败。

        业务关联:
        - 上游: 前端“自动搜索”按钮触发。
        - 下游: 搜索结果用于后续安装/还原流程的目标目录选择。
        """
        if self._search_running:
            return
        self._search_running = True

        def _run():
            self.log_from_backend("[SYS] 检索引擎初始化...")
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
                self.log_from_backend("[SUCCESS] 自动搜索成功，路径已保存。")

                # 通知前端更新 UI
                path_js = json.dumps(found_path.replace(os.sep, "/"), ensure_ascii=False)
                self._window.evaluate_js(f"app.onSearchSuccess({path_js})")
            else:
                self.log_from_backend("[ERROR] 深度扫描未发现游戏客户端。")
                self._window.evaluate_js("app.onSearchFail()")
            self._search_running = False

        t = threading.Thread(target=_run)
        t.daemon = True
        t.start()

    def get_library_list(self, opts=None):
        """
        功能定位:
        - 扫描语音包库并返回每个语音包的详情列表，包含封面 data URL 以便前端直接渲染。

        输入输出:
        - 参数:
          - opts: dict | None，可选参数（当前实现保留接口，具体字段由前端传入）。
        - 返回:
          - list[dict]，每个元素为 get_mod_details 结果的扩展字段集合（含 id 与 cover_url）。
        - 外部资源/依赖:
          - LibraryManager.scan_library/get_mod_details
          - 默认封面文件: <WEB_DIR>/assets/card_image.png

        实现逻辑:
        - 1) 扫描库目录得到语音包目录名列表。
        - 2) 对每个语音包读取详情字典，并确定封面路径：
           - 优先使用详情中的 cover_path；
           - 当 cover_path 缺失或文件不存在时，使用默认封面。
        - 3) 将封面图片读取并转为 data URL 写入 details["cover_url"]。
        - 4) 补充 details["id"]=mod 并汇总返回。

        业务关联:
        - 上游: 前端进入“语音包库”页面或手动刷新时调用。
        - 下游: 前端据此渲染卡片列表、标签与封面。
        """
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
                    print(f"图片转码失败: {e}")

            # 补充 ID
            details["id"] = mod
            result.append(details)
        if self._perf_enabled and t0 is not None:
            dt_ms = (time.perf_counter() - t0) * 1000.0
            self.log_from_backend(f"[PERF] get_library_list {dt_ms:.1f}ms mods={len(result)}", "SYS")
        return result

    def open_folder(self, folder_type):
        """
        功能定位:
        - 按类型打开资源相关目录（待解压区/语音包库/游戏目录/UserSkins）。

        输入输出:
        - 参数:
          - folder_type: str，目录类型标识（pending/library/game/userskins）。
        - 返回: None
        - 外部资源/依赖:
          - os.startfile（Windows）
          - LibraryManager.open_pending_folder/open_library_folder
          - ConfigManager.get_game_path 与 CoreService.validate_game_path

        实现逻辑:
        - 根据 folder_type 分派到对应目录的打开逻辑；对 game/userskins 会校验配置路径是否可用。

        业务关联:
        - 上游: 前端“打开目录”按钮触发。
        - 下游: 便于用户查看资源目录结构与内容。
        """
        if folder_type == "pending":
            self._lib_mgr.open_pending_folder()
        elif folder_type == "library":
            self._lib_mgr.open_library_folder()
        elif folder_type == "game":
            path = self._cfg_mgr.get_game_path()
            if path and os.path.exists(path):
                try:
                    os.startfile(path)
                except Exception as e:
                    self.log_from_backend(f"[ERROR] 打开游戏目录失败: {e}")
            else:
                self.log_from_backend("[WARN] 游戏路径无效或未设置")
        elif folder_type == "userskins":
            path = self._cfg_mgr.get_game_path()
            valid, _ = self._logic.validate_game_path(path)
            if not valid:
                self.log_from_backend("[WARN] 未设置有效游戏路径，无法打开 UserSkins")
                return
            userskins_dir = self._skins_mgr.get_userskins_dir(path)
            try:
                userskins_dir.mkdir(parents=True, exist_ok=True)
                os.startfile(str(userskins_dir))
            except Exception as e:
                self.log_from_backend(f"[ERROR] 打开 UserSkins 失败: {e}")

        # 未列入允许名单的 folder_type 不执行任何操作

    # --- 辅助方法 ---
    def update_loading_ui(self, progress, message):
        """
        功能定位:
        - 将进度与提示文本推送到前端加载组件 MinimalistLoading。

        输入输出:
        - 参数:
          - progress: int|float，进度百分比（期望范围 0-100）。
          - message: str，提示文本。
        - 返回: None
        - 外部资源/依赖:
          - self._window.evaluate_js
          - window.MinimalistLoading.update（前端组件）

        实现逻辑:
        - 1) 规范化 message（去除换行）与 progress（裁剪到 0-100）。
        - 2) 调用 MinimalistLoading.update 将状态同步到前端。

        业务关联:
        - 上游: 导入/解压等后台任务通过 progress_callback 调用。
        - 下游: 前端展示加载进度与当前步骤提示。
        """
        if self._window:
            try:
                safe_msg = str(message).replace("\r", " ").replace("\n", " ")
                safe_progress = max(0, min(100, int(progress)))
                msg_js = json.dumps(safe_msg, ensure_ascii=False)
                self._window.evaluate_js(
                    f"if(window.MinimalistLoading) MinimalistLoading.update({safe_progress}, {msg_js})"
                )
            except Exception as e:
                print(f"Loading UI 更新失败: {e}")

    def submit_archive_password(self, password):
        """
        功能定位:
        - 接收前端输入的压缩包密码，并唤醒等待中的解压线程。

        输入输出:
        - 参数:
          - password: str | None，用户输入的密码；None 表示空输入。
        - 返回:
          - bool，写入完成返回 True。
        - 外部资源/依赖: threading.Event/Lock

        实现逻辑:
        - 在锁内写入 _password_value，设置 _password_cancelled=False，并 set 事件。

        业务关联:
        - 上游: 前端密码弹窗提交按钮调用。
        - 下游: _request_archive_password 的等待逻辑收到事件后继续解压流程。
        """
        with self._password_lock:
            self._password_value = "" if password is None else str(password)
            self._password_cancelled = False
            self._password_event.set()
        return True

    def cancel_archive_password(self):
        """
        功能定位:
        - 处理前端取消输入密码的动作，并唤醒等待中的解压线程。

        输入输出:
        - 参数: 无
        - 返回:
          - bool，写入完成返回 True。
        - 外部资源/依赖: threading.Event/Lock

        实现逻辑:
        - 在锁内设置 _password_value=None、_password_cancelled=True，并 set 事件。

        业务关联:
        - 上游: 前端密码弹窗取消按钮调用。
        - 下游: _request_archive_password 检测取消后返回 None，由调用方中止导入流程。
        """
        with self._password_lock:
            self._password_value = None
            self._password_cancelled = True
            self._password_event.set()
        return True

    def _request_archive_password(self, archive_name, error_hint=""):
        """
        功能定位:
        - 向前端弹出密码输入框，并阻塞等待用户输入或取消。

        输入输出:
        - 参数:
          - archive_name: str，压缩包文件名（用于弹窗展示）。
          - error_hint: str，错误提示文本（例如“密码错误，请重试”）。
        - 返回:
          - str | None，用户输入密码；用户取消返回 None。
        - 外部资源/依赖:
          - 前端弹窗: app.openArchivePasswordModal
          - 线程同步: self._password_event/self._password_lock

        实现逻辑:
        - 1) 清理上次密码状态并清空事件。
        - 2) 通过 evaluate_js 打开前端密码弹窗。
        - 3) wait 等待事件被 submit/cancel 触发。
        - 4) 在锁内读取最终密码或取消标志并返回。

        业务关联:
        - 上游: LibraryManager 解压流程通过 password_provider 调用。
        - 下游: 解压流程依据返回值决定继续尝试或终止导入。
        """
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
        """
        功能定位:
        - 将待解压区中的压缩包批量导入到语音包库，并将进度同步到前端加载组件。

        输入输出:
        - 参数: 无
        - 返回: None
        - 外部资源/依赖:
          - LibraryManager.unzip_zips_to_library
          - 前端组件: MinimalistLoading.show/update/hide
          - 密码交互: _request_archive_password（通过 password_provider 回调）

        实现逻辑:
        - 1) 使用 _is_busy 防止并发导入任务。
        - 2) 前端显示加载组件并推送初始进度。
        - 3) 在后台线程执行 unzip_zips_to_library，并将 update_loading_ui 作为进度回调。
        - 4) 解压完成后通知前端刷新语音包库列表并将进度更新到 100。
        - 5) 用户取消密码输入时中止导入并隐藏加载组件。

        业务关联:
        - 上游: 前端“批量导入”操作触发。
        - 下游: 语音包库目录新增内容，前端刷新后展示新语音包。
        """
        if self._is_busy:
            self.log_from_backend("[WARN] 另一个任务正在进行中，请稍候...")
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
                self.log_from_backend("[WARN] 已取消输入密码，导入已终止", "WARN")
                if self._window:
                    self._window.evaluate_js(
                        "if(window.MinimalistLoading) MinimalistLoading.hide()"
                    )
            except Exception as e:
                self.log_from_backend(f"[ERROR] 导入失败: {e}")
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
        """
        功能定位:
        - 打开文件选择对话框导入单个 ZIP/RAR 到语音包库，并将进度同步到前端加载组件。

        输入输出:
        - 参数: 无
        - 返回: None
        - 外部资源/依赖:
          - PyWebview 对话框: self._window.create_file_dialog（OPEN 单选）
          - LibraryManager.unzip_single_zip
          - 前端组件: MinimalistLoading.show/update/hide
          - 密码交互: _request_archive_password

        实现逻辑:
        - 1) 若已有任务运行则提示并返回。
        - 2) 打开文件选择对话框，读取用户选择的压缩包路径。
        - 3) 显示加载组件，在后台线程执行 unzip_single_zip 并推送真实进度。
        - 4) 完成后通知前端刷新语音包库列表并更新进度到 100；异常时写日志并更新前端状态。

        业务关联:
        - 上游: 前端“选择文件导入”触发。
        - 下游: 语音包库目录新增内容，前端刷新后展示新语音包。
        """
        if self._is_busy:
            self.log_from_backend("[WARN] 另一个任务正在进行中，请稍候...")
            return

        # 打开文件选择对话框（返回列表，即使为单选）
        file_types = ("Zip Files (*.zip)", "Rar Files (*.rar)", "All files (*.*)")

        # 使用 OPEN 对话框模式进行单文件选择
        result = self._window.create_file_dialog(
            webview.FileDialog.OPEN, allow_multiple=False, file_types=file_types
        )

        if result and len(result) > 0:
            zip_path = result[0]
            # self.log_from_backend(f"[INFO] 准备导入: {zip_path}")
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
                    self.log_from_backend("[WARN] 已取消输入密码，导入已终止", "WARN")
                    if self._window:
                        self._window.evaluate_js(
                            "if(window.MinimalistLoading) MinimalistLoading.hide()"
                        )
                except Exception as e:
                    self.log_from_backend(f"[ERROR] 导入失败: {e}")
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

    def get_skins_list(self, opts=None):
        """
        功能定位:
        - 扫描游戏目录下的 UserSkins 并返回前端渲染所需的涂装列表数据。

        输入输出:
        - 参数:
          - opts: dict | None，可选参数；支持 force_refresh 控制是否忽略缓存。
        - 返回:
          - dict，包含 valid/msg/exists/path/items 等字段（由 SkinsManager.scan_userskins 生成或由校验失败分支生成）。
        - 外部资源/依赖:
          - ConfigManager.get_game_path
          - CoreService.validate_game_path
          - SkinsManager.scan_userskins
          - 默认封面文件: <WEB_DIR>/assets/card_image_small.png

        实现逻辑:
        - 1) 读取配置中的 game_path 并校验为有效游戏目录。
        - 2) 计算默认封面路径，解析 opts.force_refresh。
        - 3) 调用 scan_userskins 返回扫描结果。

        业务关联:
        - 上游: 前端涂装页面进入或刷新时调用。
        - 下游: 前端根据 items 渲染涂装网格并展示封面与统计信息。
        """
        path = self._cfg_mgr.get_game_path()
        valid, msg = self._logic.validate_game_path(path)
        if not valid:
            return {
                "valid": False,
                "msg": msg or "未设置有效游戏路径",
                "exists": False,
                "path": "",
                "items": [],
            }

        default_cover_path = WEB_DIR / "assets" / "card_image_small.png"
        force_refresh = False
        if isinstance(opts, dict):
            force_refresh = bool(opts.get("force_refresh"))
        data = self._skins_mgr.scan_userskins(
            path, default_cover_path=default_cover_path, force_refresh=force_refresh
        )
        data["valid"] = True
        data["msg"] = ""
        return data

    def import_skin_zip_dialog(self):
        if self._is_busy:
            self.log_from_backend("[WARN] 另一个任务正在进行中，请稍候...")
            return False

        path = self._cfg_mgr.get_game_path()
        valid, msg = self._logic.validate_game_path(path)
        if not valid:
            self.log_from_backend(f"[ERROR] 未设置有效游戏路径: {msg}", "ERROR")
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
            self.log_from_backend("[WARN] 另一个任务正在进行中，请稍候...")
            return False

        path = self._cfg_mgr.get_game_path()
        valid, msg = self._logic.validate_game_path(path)
        if not valid:
            self.log_from_backend(f"[ERROR] 未设置有效游戏路径: {msg}", "ERROR")
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
                self.log_from_backend(f"[WARN] {e}", "WARN")
                if self._window:
                    msg_js = json.dumps(str(e), ensure_ascii=False)
                    self._window.evaluate_js(
                        f"if(window.MinimalistLoading) MinimalistLoading.update(100, {msg_js})"
                    )
            except Exception as e:
                self.log_from_backend(f"[ERROR] 涂装导入失败: {e}", "ERROR")
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
        """
        功能定位:
        - 重命名 UserSkins 下的涂装文件夹。

        输入输出:
        - 参数:
          - old_name: str，原涂装目录名。
          - new_name: str，新涂装目录名。
        - 返回:
          - dict，{success: bool, msg?: str}。
        - 外部资源/依赖:
          - SkinsManager.rename_skin（对 <game_path>/UserSkins 执行重命名）
          - ConfigManager.get_game_path

        实现逻辑:
        - 读取 game_path 后调用 skins_mgr.rename_skin；捕获异常并转换为返回结构。

        业务关联:
        - 上游: 前端涂装管理“改名”操作。
        - 下游: 前端刷新列表后展示新名称。
        """
        path = self._cfg_mgr.get_game_path()
        try:
            self._skins_mgr.rename_skin(path, old_name, new_name)
            return {"success": True}
        except Exception as e:
            return {"success": False, "msg": str(e)}

    def update_skin_cover(self, skin_name):
        """
        功能定位:
        - 打开图片选择对话框并将所选图片设置为涂装封面（preview.png）。

        输入输出:
        - 参数:
          - skin_name: str，涂装目录名。
        - 返回:
          - dict，{success: bool, msg?: str, new_cover?: str}。
        - 外部资源/依赖:
          - PyWebview 文件选择对话框（OPEN 单选）
          - SkinsManager.update_skin_cover（写入 preview.png）

        实现逻辑:
        - 1) 若系统处于忙碌状态则拒绝操作。
        - 2) 打开图片文件选择对话框并读取用户选择。
        - 3) 调用 update_skin_cover 写入 preview.png。

        业务关联:
        - 上游: 前端涂装编辑弹窗“更换封面”操作。
        - 下游: 前端刷新涂装列表后封面展示更新。
        """
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
        """
        功能定位:
        - 将前端传入的 base64 图片数据写入为涂装封面 preview.png。

        输入输出:
        - 参数:
          - skin_name: str，涂装目录名。
          - data_url: str，形如 data:image/<type>;base64,<data> 的字符串。
        - 返回:
          - dict，{success: bool, msg?: str}。
        - 外部资源/依赖:
          - SkinsManager.update_skin_cover_data（写入 preview.png）
          - ConfigManager.get_game_path

        实现逻辑:
        - 1) 若系统处于忙碌状态则拒绝操作。
        - 2) 调用 update_skin_cover_data 写入封面并返回结果。

        业务关联:
        - 上游: 前端裁剪封面后提交调用。
        - 下游: 前端刷新列表后封面展示更新。
        """
        if self._is_busy:
            return {"success": False, "msg": "系统繁忙"}

        path = self._cfg_mgr.get_game_path()
        try:
            self._skins_mgr.update_skin_cover_data(path, skin_name, data_url)
            return {"success": True}
        except Exception as e:
            return {"success": False, "msg": str(e)}

    def install_mod(self, mod_name, install_list):
        """
        功能定位:
        - 将指定语音包按选择的文件夹列表安装到游戏 sound/mod，并更新前端加载进度与安装状态。

        输入输出:
        - 参数:
          - mod_name: str，语音包目录名（语音包库中的文件夹名）。
          - install_list: list[str] | str，待安装的相对文件夹列表；可能以 JSON 字符串形式传入。
        - 返回:
          - bool，安装任务已启动返回 True；参数错误或环境不满足时返回 False。
        - 外部资源/依赖:
          - ConfigManager.get_game_path/set_current_mod
          - CoreService.validate_game_path/install_from_library
          - LibraryManager.library_dir（定位语音包源目录）
          - 前端组件: MinimalistLoading.update、app.onInstallSuccess

        实现逻辑:
        - 1) 若 install_list 为字符串则尝试 json.loads 转为列表。
        - 2) 通过线程锁与 _is_busy 控制并发，避免同时执行多个任务。
        - 3) 校验游戏路径有效性；失败时清理 busy 状态并返回 False。
        - 4) 写入当前语音包标识到配置。
        - 5) 在后台线程执行 install_from_library，并通过 update_loading_ui 推送进度。
        - 6) 完成后通知前端更新“已安装”状态并结束加载组件。

        业务关联:
        - 上游: 前端在用户确认安装后调用。
        - 下游: 游戏目录 sound/mod 内容与 config.blk 开关被更新；清单记录被写入以供冲突检测。
        """
        # install_list 可能以 JSON 字符串形式传入
        if isinstance(install_list, str):
            try:
                install_list = json.loads(install_list)
            except json.JSONDecodeError:
                self.log_from_backend(
                    f"[ERROR] 解析安装列表失败: {install_list}", "ERROR"
                )
                return False

        # 使用线程锁与状态位限制并发任务
        with self._lock:
            if self._is_busy:
                self.log_from_backend("[WARN] 另一个任务正在进行中，请稍候...", "WARN")
                return False
            self._is_busy = True

        path = self._cfg_mgr.get_game_path()
        valid, _ = self._logic.validate_game_path(path)
        if not valid:
            self.log_from_backend("[ERROR] 安装失败：未设置有效游戏路径", "ERROR")
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
                self.log_from_backend(f"[ERROR] 安装失败: {e}", "ERROR")
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
        """
        功能定位:
        - 基于安装清单对本次安装可能写入的文件名进行冲突检查，并返回冲突明细列表。

        输入输出:
        - 参数:
          - mod_name: str，准备安装的语音包名称。
          - install_list: list[str] | str，待安装的相对文件夹列表；可能以 JSON 字符串形式传入。
        - 返回:
          - list[dict]，冲突列表；元素结构由 ManifestManager.check_conflicts 定义。
        - 外部资源/依赖:
          - ConfigManager.get_game_path
          - CoreService.validate_game_path（初始化 manifest_mgr）
          - LibraryManager.library_dir（定位语音包源目录）
          - ManifestManager.check_conflicts（基于 .manifest.json 的 file_map 检测）

        实现逻辑:
        - 1) 若 install_list 为字符串则尝试解析为列表。
        - 2) 校验游戏路径与语音包目录存在。
        - 3) 递归遍历 install_list 对应目录，收集将写入 sound/mod 的目标文件名列表。
        - 4) 调用 manifest_mgr.check_conflicts 返回冲突结果。

        业务关联:
        - 上游: 前端在用户确认安装前调用，用于展示覆盖关系与风险提示。
        - 下游: 前端依据返回结果决定是否继续安装。
        """
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

            # 遍历将要安装的目录集合，收集目标文件名列表
            files_to_install = []
            for folder_rel_path in install_list:
                if folder_rel_path == "根目录":
                    src_dir = mod_path
                else:
                    src_dir = mod_path / folder_rel_path
                if src_dir.exists():
                    for root, dirs, files in os.walk(src_dir):
                        for file in files:
                            files_to_install.append(file)

            # 调用 manifest_mgr 进行冲突检测
            if self._logic.manifest_mgr:
                return self._logic.manifest_mgr.check_conflicts(mod_name, files_to_install)
            return []
        except Exception as e:
            self.log_from_backend(f"[WARN] 冲突检测失败: {e}", "WARN")
            return []

    def delete_mod(self, mod_name):
        """
        功能定位:
        - 从语音包库目录中删除指定语音包文件夹。

        输入输出:
        - 参数:
          - mod_name: str，语音包目录名。
        - 返回:
          - bool，删除成功返回 True，失败返回 False。
        - 外部资源/依赖:
          - 文件系统: <library_dir>/<mod_name>（删除）

        实现逻辑:
        - 1) 使用 _is_busy 防止与其他任务并发。
        - 2) 将 library_dir 与 target 路径 resolve 后做包含关系校验，限制删除范围。
        - 3) 调用 shutil.rmtree 删除目标目录并写日志。

        业务关联:
        - 上游: 前端语音包卡片“删除”操作触发。
        - 下游: 前端刷新语音包库列表后移除该条目。
        """
        if self._is_busy:
            self.log_from_backend("[WARN] 另一个任务正在进行中，请稍候...")
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
            self.log_from_backend(f"[INFO] 已删除语音包: {mod_name}")
            return True
        except Exception as e:
            self.log_from_backend(f"[ERROR] 删除失败: {e}")
            return False

    def copy_country_files(self, mod_name, country_code, include_ground=True, include_radio=True):
        """
        功能定位:
        - 触发“复制国籍文件”流程：从语音包库中查找匹配文件并复制到游戏 sound/mod。

        输入输出:
        - 参数:
          - mod_name: str，语音包名称。
          - country_code: str，目标国家缩写。
          - include_ground: bool，是否复制陆战文件对。
          - include_radio: bool，是否复制无线电/局势文件对。
        - 返回:
          - dict，{success: bool, msg: str}。
        - 外部资源/依赖:
          - ConfigManager.get_game_path
          - CoreService.validate_game_path
          - LibraryManager.copy_country_files（写入 <game_root>/sound/mod）

        实现逻辑:
        - 1) 校验 mod_name 非空并校验游戏路径有效性。
        - 2) 调用 LibraryManager.copy_country_files 返回 created/skipped/missing。
        - 3) 汇总统计信息并写日志，返回提示文本。

        业务关联:
        - 上游: 前端语音包卡片“复制国籍文件”操作触发。
        - 下游: 游戏 sound/mod 新增文件将影响游戏加载的语音资源集合。
        """
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
            self.log_from_backend(f"[INFO] {msg}")
            return {
                "success": True,
                "created": created,
                "skipped": skipped,
                "missing": missing,
            }
        except Exception as e:
            self.log_from_backend(f"[ERROR] 复制国籍文件失败: {e}")
            return {"success": False, "msg": str(e)}

    def restore_game(self):
        """
        功能定位:
        - 触发游戏目录还原流程：清空 sound/mod 子项并关闭 enable_mod，同时清理当前语音包状态。

        输入输出:
        - 参数: 无
        - 返回:
          - bool，任务已启动返回 True；前置校验失败返回 False。
        - 外部资源/依赖:
          - ConfigManager.get_game_path/set_current_mod
          - CoreService.validate_game_path/restore_game
          - 前端回调: app.onRestoreSuccess

        实现逻辑:
        - 1) 若系统忙碌则拒绝执行。
        - 2) 校验游戏路径有效性；失败则写日志并返回 False。
        - 3) 后台线程调用 core_logic.restore_game 执行目录清理与配置写回。
        - 4) 还原完成后将 current_mod 置空并通知前端刷新状态。

        业务关联:
        - 上游: 前端“还原纯净”按钮触发。
        - 下游: 游戏目录与配置状态恢复到未加载语音包的状态。
        """
        if self._is_busy:
            self.log_from_backend("[WARN] 另一个任务正在进行中，请稍候...")
            return False

        path = self._cfg_mgr.get_game_path()
        valid, msg = self._logic.validate_game_path(path)
        if not valid:
            self.log_from_backend(f"[ERROR] 还原失败: {msg}", "ERROR")
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
        """
        功能定位:
        - 接收前端“清空日志”动作，并输出一条日志用于记录该行为。

        输入输出:
        - 参数: 无
        - 返回: None
        - 外部资源/依赖: log_from_backend

        实现逻辑:
        - 后端不清理历史日志文件；前端负责清空页面日志容器。

        业务关联:
        - 上游: 前端日志面板“清空”按钮触发。
        - 下游: 前端清空 DOM 后，后端继续推送的新日志会重新显示。
        """
        self.log_from_backend("[INFO] 日志已清空")

    # --- 首次运行状态 API ---
    def check_first_run(self):
        """
        功能定位:
        - 判断前端是否需要展示首次运行协议弹窗。

        输入输出:
        - 参数: 无
        - 返回:
          - dict，{status: bool, version: str}；status=True 表示需要展示协议。
        - 外部资源/依赖:
          - ConfigManager.get_is_first_run/get_agreement_version
          - AGREEMENT_VERSION（当前协议版本常量）

        实现逻辑:
        - 只要 is_first_run 为 True，或已保存的 agreement_version 与当前 AGREEMENT_VERSION 不一致，则认为需要展示协议。

        业务关联:
        - 上游: 前端启动后调用以决定是否弹出协议。
        - 下游: 前端根据 status 决定展示与否，并在同意后调用 agree_to_terms 更新配置。
        """
        is_first = self._cfg_mgr.get_is_first_run()
        saved_ver = self._cfg_mgr.get_agreement_version()
        needs_agreement = is_first or (saved_ver != AGREEMENT_VERSION)
        return {"status": needs_agreement, "version": AGREEMENT_VERSION}

    def agree_to_terms(self, version):
        """
        功能定位:
        - 记录用户已同意协议，并保存其同意的协议版本号。

        输入输出:
        - 参数:
          - version: str，前端传入的协议版本号。
        - 返回:
          - bool，写入完成返回 True。
        - 外部资源/依赖:
          - ConfigManager.set_is_first_run/set_agreement_version（写入 settings.json）

        实现逻辑:
        - 将 is_first_run 置为 False，并写入 agreement_version。

        业务关联:
        - 上游: 前端协议弹窗“同意”操作触发。
        - 下游: 后续启动依据保存的版本判断是否需要再次展示协议。
        """
        self._cfg_mgr.set_is_first_run(False)
        self._cfg_mgr.set_agreement_version(version)
        return True

    # --- 主题管理 API ---
    def get_theme_list(self):
        """
        功能定位:
        - 扫描 web/themes 目录下的主题 JSON 文件列表，并返回主题元信息供前端下拉框展示。

        输入输出:
        - 参数: 无
        - 返回:
          - list[dict]，主题列表；每项包含 filename/name/version/author 等字段（由主题文件内容决定）。
        - 外部资源/依赖:
          - 目录: <WEB_DIR>/themes（读取）
          - 文件: *.json 主题文件（读取并解析 JSON）

        实现逻辑:
        - 遍历 themes_dir 下的 JSON 文件，读取并提取必要字段；对异常文件做跳过处理。

        业务关联:
        - 上游: 前端加载主题列表时调用。
        - 下游: 前端选择主题后调用 load_theme_content 获取完整内容并应用到页面。
        """
        themes_dir = WEB_DIR / "themes"
        if not themes_dir.exists():
            return []

        theme_list = []
        # 遍历 json 文件
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
                print(f"读取主题 {file.name} 失败: {e}")
        return theme_list

    def load_theme_content(self, filename):
        """
        功能定位:
        - 读取指定主题文件的完整 JSON 内容并返回给前端应用。

        输入输出:
        - 参数:
          - filename: str，主题文件名（应为 web/themes 下的 .json 文件）。
        - 返回:
          - dict | None，主题 JSON 内容；文件不存在、类型不匹配或越界路径时返回 None。
        - 外部资源/依赖:
          - 文件: <WEB_DIR>/themes/<filename>（读取）

        实现逻辑:
        - 1) 计算 themes_dir 与 theme_path，并用 commonpath 校验 theme_path 必须位于 themes_dir 内。
        - 2) 限制仅允许 .json 后缀。
        - 3) 使用 _load_json_with_fallback 读取并解析，成功则返回 dict。

        业务关联:
        - 上游: 前端在选择主题后调用以获取颜色配置。
        - 下游: 前端将解析内容应用为 CSS 变量并更新界面样式。
        """
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
            print(f"加载主题失败: {e}")
            return None

    # --- 炮镜管理 API ---
    def select_sights_path(self):
        """
        功能定位:
        - 打开目录选择对话框设置 UserSights 路径，并写入配置用于下次启动恢复。

        输入输出:
        - 参数: 无
        - 返回:
          - dict，成功时 {success: True, path: str}；失败时 {success: False, error?: str}。
        - 外部资源/依赖:
          - PyWebview 对话框: self._window.create_file_dialog
          - SightsManager.set_usersights_path
          - ConfigManager.set_sights_path

        实现逻辑:
        - 1) 打开文件夹选择对话框并读取选择结果。
        - 2) 调用 set_usersights_path 校验/创建目录。
        - 3) 写入配置并记录日志。

        业务关联:
        - 上游: 前端炮镜页面“设置炮镜路径”操作触发。
        - 下游: scan_sights/import_sights_zip 等流程使用该路径作为目标目录。
        """
        folder = self._window.create_file_dialog(webview.FileDialog.FOLDER)
        if folder and len(folder) > 0:
            path = folder[0]
            try:
                self._sights_mgr.set_usersights_path(path)
                self._cfg_mgr.set_sights_path(path)
                self.log_from_backend(f"[INFO] 炮镜路径已设置: {path}", "INFO")
                return {"success": True, "path": path}
            except Exception as e:
                self.log_from_backend(f"[ERROR] 设置炮镜路径失败: {e}", "ERROR")
                return {"success": False, "error": str(e)}
        return {"success": False}

    def get_sights_list(self, opts=None):
        """
        功能定位:
        - 返回炮镜列表数据，供前端渲染炮镜网格与统计信息。

        输入输出:
        - 参数:
          - opts: dict | None，可选参数；支持 force_refresh 控制是否忽略缓存。
        - 返回:
          - dict，包含 exists/path/items 等字段（由 SightsManager.scan_sights 生成）。
        - 外部资源/依赖:
          - SightsManager.scan_sights
          - 默认封面文件: <WEB_DIR>/assets/card_image_small.png

        实现逻辑:
        - 1) 解析 opts.force_refresh。
        - 2) 调用 scan_sights 执行扫描并返回结果。
        - 3) 当开启性能统计时记录耗时日志。

        业务关联:
        - 上游: 前端打开炮镜页或刷新列表时调用。
        - 下游: 前端据此渲染炮镜卡片与封面。
        """
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
                self.log_from_backend(
                    f"[PERF] get_sights_list {dt_ms:.1f}ms items={len(res.get('items') or [])}",
                    "SYS",
                )
            return res
        except Exception as e:
            self.log_from_backend(f"[ERROR] 扫描炮镜失败: {e}", "ERROR")
            return {"exists": False, "items": []}

    def rename_sight(self, old_name, new_name):
        """
        功能定位:
        - 重命名 UserSights 下的炮镜文件夹。

        输入输出:
        - 参数:
          - old_name: str，原炮镜目录名。
          - new_name: str，新炮镜目录名。
        - 返回:
          - dict，{success: bool, msg?: str}。
        - 外部资源/依赖: SightsManager.rename_sight

        实现逻辑:
        - 调用 rename_sight，捕获异常并转换为返回结构。

        业务关联:
        - 上游: 前端炮镜管理“改名”操作。
        - 下游: 前端刷新列表后展示新名称。
        """
        try:
            self._sights_mgr.rename_sight(old_name, new_name)
            return {"success": True}
        except Exception as e:
            return {"success": False, "msg": str(e)}

    def update_sight_cover_data(self, sight_name, data_url):
        """
        功能定位:
        - 将前端传入的 base64 图片数据写入为炮镜封面 preview.png。

        输入输出:
        - 参数:
          - sight_name: str，炮镜目录名。
          - data_url: str，形如 data:image/<type>;base64,<data> 的字符串。
        - 返回:
          - dict，{success: bool, msg?: str}。
        - 外部资源/依赖: SightsManager.update_sight_cover_data

        实现逻辑:
        - 1) 若系统处于忙碌状态则拒绝操作。
        - 2) 调用 update_sight_cover_data 写入封面并返回结果。

        业务关联:
        - 上游: 前端裁剪封面后提交调用。
        - 下游: 前端刷新列表后封面展示更新。
        """
        if self._is_busy:
            return {"success": False, "msg": "系统繁忙"}

        try:
            self._sights_mgr.update_sight_cover_data(sight_name, data_url)
            return {"success": True}
        except Exception as e:
            return {"success": False, "msg": str(e)}

    def import_sights_zip_dialog(self):
        """
        功能定位:
        - 打开文件选择对话框选择炮镜 ZIP 并触发导入流程。

        输入输出:
        - 参数: 无
        - 返回:
          - bool，已触发导入返回 True，否则 False。
        - 外部资源/依赖:
          - PyWebview 文件选择对话框（OPEN 单选）
          - import_sights_zip_from_path

        实现逻辑:
        - 1) 校验当前无并发任务且已设置 UserSights 路径。
        - 2) 打开文件选择对话框获取 zip_path。
        - 3) 调用 import_sights_zip_from_path 执行后台导入。

        业务关联:
        - 上游: 前端“导入炮镜”按钮触发。
        - 下游: 导入完成后前端刷新炮镜列表展示新内容。
        """
        if self._is_busy:
            self.log_from_backend("[WARN] 另一个任务正在进行中，请稍候...")
            return False

        if not self._sights_mgr.get_usersights_path():
            self.log_from_backend("[WARN] 请先设置有效的 UserSights 路径", "WARN")
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
        """
        功能定位:
        - 导入指定路径的炮镜 ZIP 到 UserSights，并将进度同步到前端加载组件。

        输入输出:
        - 参数:
          - zip_path: str | Path，炮镜 ZIP 文件路径。
        - 返回:
          - bool，已启动导入返回 True，否则 False。
        - 外部资源/依赖:
          - SightsManager.import_sights_zip
          - 前端组件: MinimalistLoading.show/update
          - 前端回调: app.refreshSights

        实现逻辑:
        - 1) 校验当前无并发任务且已设置 UserSights 路径。
        - 2) 显示加载组件并在后台线程执行 import_sights_zip，使用 update_loading_ui 推送进度。
        - 3) 完成后通知前端刷新炮镜列表并更新进度到 100。

        业务关联:
        - 上游: import_sights_zip_dialog 或前端拖拽导入流程调用。
        - 下游: UserSights 目录新增内容，前端刷新后展示新炮镜。
        """
        if self._is_busy:
            self.log_from_backend("[WARN] 另一个任务正在进行中，请稍候...")
            return False

        if not self._sights_mgr.get_usersights_path():
            self.log_from_backend("[WARN] 请先设置有效的 UserSights 路径", "WARN")
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
                self.log_from_backend(f"[WARN] {e}", "WARN")
                if self._window:
                    msg_js = json.dumps(str(e), ensure_ascii=False)
                    self._window.evaluate_js(
                        f"if(window.MinimalistLoading) MinimalistLoading.update(100, {msg_js})"
                    )
            except Exception as e:
                self.log_from_backend(f"[ERROR] 炮镜导入失败: {e}", "ERROR")
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
        """
        功能定位:
        - 打开当前设置的 UserSights 目录。

        输入输出:
        - 参数: 无
        - 返回: None
        - 外部资源/依赖: SightsManager.open_usersights_folder（内部使用 os.startfile）

        实现逻辑:
        - 调用 open_usersights_folder；失败时写日志。

        业务关联:
        - 上游: 前端“打开 UserSights”按钮触发。
        - 下游: 便于用户查看与管理炮镜目录结构。
        """
        try:
            self._sights_mgr.open_usersights_folder()
        except Exception as e:
            self.log_from_backend(f"[ERROR] 打开炮镜文件夹失败: {e}", "ERROR")


def on_app_started():
    """
    功能定位:
    - 在窗口创建完成后执行启动后处理，包括关闭 PyInstaller 启动图并让前端进入可交互状态。

    输入输出:
    - 参数: 无
    - 返回: None
    - 外部资源/依赖:
      - PyInstaller: pyi_splash.close（仅 frozen 环境可用）
      - PyWebview: webview.windows[0].evaluate_js

    实现逻辑:
    - 1) 延时一段时间，给前端页面加载与渲染预留时间。
    - 2) 若为 frozen 环境则尝试关闭启动图模块。
    - 3) 尝试获取窗口对象并调用前端恢复接口，打印当前 UI 状态用于诊断。

    业务关联:
    - 上游: 应用启动时由 webview.start 的回调触发。
    - 下游: 前端页面在启动阶段恢复到默认可用界面。
    """
    # 延时以预留页面加载与渲染时间
    time.sleep(0.5)

    if getattr(sys, "frozen", False):
        try:
            import pyi_splash

            pyi_splash.close()
            print("[INFO] Splash screen closed.", flush=True)
        except ImportError:
            pass

    for _ in range(10):
        try:
            if webview.windows:
                win = webview.windows[0]
                win.evaluate_js(
                    "if (window.app && app.recoverToSafeState) app.recoverToSafeState('backend_start');"
                )
                state = win.evaluate_js(
                    "JSON.stringify({activePage: (document.querySelector('.page.active')||{}).id || null, openModals: Array.from(document.querySelectorAll('.modal-overlay.show')).map(x=>x.id)})"
                )
                print(f"[UI_STATE] {state}", flush=True)
                break
        except Exception:
            time.sleep(0.2)


if __name__ == "__main__":
    # 创建后端 API 桥接对象
    api = AppApi()
    if sys.platform == "win32":
        _set_windows_appid("AimerWT.v2")

    # 窗口尺寸参数
    window_width = 1200
    window_height = 740

    try:
        # 获取主显示器信息并计算窗口居中坐标
        screens = webview.screens
        if screens:
            primary = screens[0]
            start_x = (primary.width - window_width) // 2
            start_y = (primary.height - window_height) // 2
        else:
            start_x = None
            start_y = None
    except Exception as e:
        print(f"获取屏幕信息失败: {e}")
        start_x = None
        start_y = None

    # 创建窗口实例（x/y 指定启动位置）
    window = webview.create_window(
        title="Aimer WT v2 Beta",
        url=str(WEB_DIR / "index.html"),
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
        easy_drag=True,
    )

    # 绑定窗口对象到桥接层
    api.set_window(window)

    def _bind_drag_drop(win):
        """
        功能定位:
        - 绑定拖拽投放事件，用于在特定页面接收文件拖入并触发导入流程。

        输入输出:
        - 参数:
          - win: webview.Window，窗口对象。
        - 返回: None
        - 外部资源/依赖:
          - webview.dom.DOMEventHandler（存在时用于事件绑定）
          - win.evaluate_js（获取当前激活页面）

        实现逻辑:
        - 当 DOM 事件模块可用时注册 drop 事件回调；回调内部根据当前页面决定是否处理拖拽文件。

        业务关联:
        - 上游: 用户将文件拖入窗口触发。
        - 下游: 导入逻辑由相应的后端 API 执行并更新前端状态。
        """
        try:
            from webview.dom import DOMEventHandler
        except Exception:
            return

        def on_drop(e):
            try:
                active_page = win.evaluate_js(
                    "(document.querySelector('.page.active')||{}).id || ''"
                )
            except Exception:
                active_page = ""

            if active_page != "page-camo":
                return

            try:
                files = (e.get("dataTransfer", {}) or {}).get("files", []) or []
            except Exception:
                files = []

            full_paths = []
            for f in files:
                try:
                    p = f.get("pywebviewFullPath")
                except Exception:
                    p = None
                if p:
                    full_paths.append(p)

            if not full_paths:
                return

            zip_files = [p for p in full_paths if str(p).lower().endswith(".zip")]
            if not zip_files:
                return

            for zp in zip_files[:1]:
                th = threading.Thread(target=api.import_skin_zip_from_path, args=(zp,))
                th.daemon = True
                th.start()

        try:
            win.dom.document.events.drop += DOMEventHandler(on_drop, True, True)
        except Exception:
            return

    def _on_start(win):
        _bind_drag_drop(win)
        on_app_started()

    # 4. 启动
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
    except Exception as e:
        print(f"Edge Chromium 启动失败，尝试默认模式: {e}")
        # 降级启动
        webview.start(_on_start, window, debug=False, http_server=False, icon=icon_path)
