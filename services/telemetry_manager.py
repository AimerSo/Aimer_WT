# -*- coding: utf-8 -*-

"""
遥测管理模块 (Telemetry Manager)。

功能定位:
- 获取机器唯一标识码 (HWID)，用于统计跨平台用户数量。
- 在本地完成硬件指纹聚合与哈希，确保用户隐私（非直传原始序列号）。
- 异步上报系统详情，帮助开发者了解用户分布与环境特征。

安全性审计:
- 隐私性：收集的 CPU/磁盘 ID 仅用于生成哈希，不以明文形式离线或上传。
- 稳定性：网络请求通过独立后台线程执行，超时设置严谨，失败完全静默，绝不阻塞 UI 或核心逻辑。
- 合规性：加盐哈希（Salted Hash）防止 HWID 被轻易碰撞且无法逆向还原原始硬件码。
"""

import hashlib
import hmac
import os
import platform
import subprocess
import sys
import threading
import time
import uuid
from typing import Optional
from urllib.parse import urlparse

import requests


def resolve_report_url(report_url: Optional[str] = None) -> str:
    """解析最终上报地址，优先使用显式传入值。"""
    final_url = (report_url or "").strip()
    if not final_url:
        try:
            import app_secrets
            final_url = str(getattr(app_secrets, "REPORT_URL", "") or "").strip()
        except ImportError:
            final_url = ""
    return final_url or "https://api.example.com/telemetry"


def resolve_service_base_url(report_url: Optional[str] = None) -> str:
    """从遥测地址推导服务基地址。"""
    final_url = resolve_report_url(report_url).strip()
    if final_url.endswith("/telemetry"):
        return final_url[:-len("/telemetry")]
    return final_url.rstrip("/")


def resolve_related_endpoint(report_url: Optional[str], endpoint: str) -> str:
    """基于遥测地址推导关联公开端点，例如 /feedback、/redeem。"""
    normalized_endpoint = "/" + str(endpoint or "").lstrip("/")
    return f"{resolve_service_base_url(report_url)}{normalized_endpoint}"


def resolve_client_auth_secret() -> str:
    """读取客户端与遥测服务共享的签名密钥。"""
    secret = os.environ.get("TELEMETRY_CLIENT_SECRET", "").strip()
    if not secret:
        try:
            import app_secrets
            secret = str(getattr(app_secrets, "TELEMETRY_CLIENT_SECRET", "") or "").strip()
        except ImportError:
            secret = ""
    return secret


def _normalize_auth_path(path_or_url: str) -> str:
    raw = str(path_or_url or "").strip()
    if not raw:
        return "/"
    parsed = urlparse(raw)
    path = parsed.path if parsed.scheme or parsed.netloc else raw
    path = path or "/"
    return path if path.startswith("/") else "/" + path


def build_client_auth_headers(path_or_url: str, method: str = "POST", machine_id: str = "",
                              user_agent: Optional[str] = None) -> dict[str, str]:
    """
    构建客户端请求头。

    - 未配置密钥时：保留兼容头，继续支持本地/旧版测试环境。
    - 配置密钥时：追加时间戳 + HMAC 签名，供服务端严格校验。
    """
    headers: dict[str, str] = {
        "X-AimerWT-Client": "1",
    }
    if user_agent:
        headers["User-Agent"] = user_agent

    secret = resolve_client_auth_secret()
    if not secret:
        return headers

    normalized_path = _normalize_auth_path(path_or_url)
    timestamp = str(int(time.time()))
    machine = str(machine_id or "").strip()
    canonical = "\n".join([
        str(method or "GET").upper(),
        normalized_path,
        machine,
        timestamp,
    ])
    signature = hmac.new(secret.encode("utf-8"), canonical.encode("utf-8"), hashlib.sha256).hexdigest()

    headers.update({
        "X-AimerWT-Timestamp": timestamp,
        "X-AimerWT-Machine": machine,
        "X-AimerWT-Signature": signature,
    })
    return headers


class TelemetryManager:
    def __init__(self, app_version: str, report_url: Optional[str] = None):
        self._stop_heartbeat = None
        self._is_log_error = False
        self._server_connected = False
        self._heartbeat_interval = 60
        self._telemetry_started = False
        self.app_version = app_version

        self.report_url = resolve_report_url(report_url)
        self._machine_id = self._generate_hwid()
        self._msg_callback = None
        self._cmd_callback = None
        self._log_callback = None
        self._user_seq_id = 0

    def set_server_message_callback(self, callback):
        """设置接收服务端控制消息的回调函数 (config: dict) -> None"""
        self._msg_callback = callback

    def set_user_command_callback(self, callback):
        """设置接收特定用户指令的回调函数 (command: str) -> None"""
        self._cmd_callback = callback

    def set_log_callback(self, callback):
        """设置日志回调 (msg: str, level: str) -> None"""
        self._log_callback = callback

    def is_server_connected(self) -> bool:
        """返回最近一次遥测交互是否成功连接到服务端。"""
        return bool(self._server_connected)

    def update_report_url(self, report_url: Optional[str] = None) -> bool:
        """更新实例的遥测目标地址，返回是否发生了变更。"""
        target_url = resolve_report_url(report_url)
        if self.report_url == target_url:
            return False
        self.report_url = target_url
        self._server_connected = False
        self._is_log_error = False
        return True

    def _run_command(self, cmd: str) -> str:
        """执行系统命令。在 Windows 下会尝试隐藏控制台窗口。"""
        try:
            startupinfo = None
            if platform.system() == "Windows":
                startupinfo = subprocess.STARTUPINFO()
                startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW

            output = subprocess.check_output(
                cmd,
                shell=True,
                startupinfo=startupinfo,
                stderr=subprocess.STDOUT
            ).decode().strip()
            return output
        except Exception:
            return ""

    def _get_cpu_id(self) -> str:
        """跨平台获取 CPU 识别特征。"""
        sys_type = platform.system()
        if sys_type == "Windows":
            output = self._run_command("wmic cpu get processorid")
            lines = output.splitlines()
            filtered = [l.strip() for l in lines if l.strip() and "ProcessorId" not in l]
            return filtered[0] if filtered else ""
        elif sys_type == "Linux":
            # Linux CPU 序列号通常需要权限或特定架构支持，此处作为辅助
            try:
                with open("/proc/cpuinfo", "r") as f:
                    for line in f:
                        if "serial" in line.lower() and ":" in line:
                            return line.split(":")[1].strip()
            except Exception:
                pass
        return ""

    def _get_disk_serial(self) -> str:
        """ 获取磁盘或系统唯一 ID """
        sys_type = platform.system()
        if sys_type == "Windows":
            output = self._run_command("wmic diskdrive get serialnumber")
            lines = output.splitlines()
            filtered = [l.strip() for l in lines if l.strip() and "SerialNumber" not in l]
            return filtered[0] if filtered else ""
        elif sys_type == "Linux":
            # Linux 下优先使用系统级的 machine-id
            for p in ["/etc/machine-id", "/var/lib/dbus/machine-id"]:
                if os.path.exists(p):
                    try:
                        with open(p, "r") as f:
                            return f.read().strip()
                    except Exception:
                        pass
            # 备选：使用 lsblk 获取根磁盘序列号
            serial = self._run_command("lsblk -d -no serial")
            if serial:
                return serial.splitlines()[0].strip()
        return ""

    def _get_mac_address(self) -> str:
        """获取网卡 MAC 地址的哈希特征。"""
        try:
            node = uuid.getnode()
            return str(uuid.UUID(int=node).hex[-12:])
        except Exception:
            return ""

    def _generate_hwid(self) -> str:
        """
        生成脱敏后的跨平台唯一机器码。
        通过组合 CPU ID、磁盘/系统 ID、MAC 及主机名进行加盐哈希。
        """
        cpu_id = self._get_cpu_id()
        disk_id = self._get_disk_serial()
        mac_addr = self._get_mac_address()
        hostname = platform.node()

        # 读取注入的盐值
        salt = os.environ.get("TELEMETRY_SALT")
        if not salt:
            try:
                import app_secrets
                salt = getattr(app_secrets, "TELEMETRY_SALT", None)
            except ImportError:
                salt = None

        if not salt:
            salt = "DEFAULT_PUBLIC_SALT_2026_CROSS"

        raw_hwid = f"{cpu_id}|{disk_id}|{mac_addr}|{hostname}|{salt}"
        return hashlib.sha256(raw_hwid.encode('utf-8')).hexdigest()

    def get_machine_id(self) -> str:
        return self._machine_id

    def get_user_seq_id(self) -> int:
        return self._user_seq_id

    def report_startup(self):
        """
        执行异步遥测上报
        """
        if not self.report_url:
            return

        def _do_report():
            try:
                screen_res = "unknown"
                try:
                    import ctypes
                    # 尝试开启高 DPI 感知，以获取物理分辨率
                    try:
                        ctypes.windll.shcore.SetProcessDpiAwareness(1)
                    except Exception:
                        try:
                            ctypes.windll.user32.SetProcessDPIAware()
                        except Exception:
                            pass

                    user32 = ctypes.windll.user32

                    w, h = user32.GetSystemMetrics(0), user32.GetSystemMetrics(1)
                    screen_res = f"{w}x{h}"

                    windll = ctypes.windll.kernel32
                    loc_name = ctypes.create_unicode_buffer(85)
                    windll.GetUserDefaultLocaleName(loc_name, 85)
                    user_locale = loc_name.value
                except Exception:
                    user_locale = "en-US"

                payload = {
                    "machine_id": self._machine_id,
                    "version": self.app_version,
                    "os": platform.system(),
                    "os_release": platform.release(),
                    "os_version": platform.version(),
                    "arch": platform.machine(),
                    "cpu_count": os.cpu_count(),
                    "screen_res": screen_res,
                    "python_version": sys.version.split()[0],
                    "locale": user_locale,
                    "session_id": os.getpid()
                }

                response = requests.post(
                    self.report_url,
                    json=payload,
                    timeout=15,
                    headers=build_client_auth_headers(
                        self.report_url,
                        method="POST",
                        machine_id=self._machine_id,
                        user_agent=f'AimerWT-Client/{self.app_version} ({platform.system()})',
                    ),
                )

                if response.status_code == 200 or response.status_code == 503:
                    self._is_log_error = False
                    self._server_connected = True
                    try:
                        data = response.json()
                        sys_config = data.get("sys_config")
                        if sys_config:
                            # 读取服务端下发的心跳间隔
                            hb = sys_config.get("heartbeat_interval")
                            if isinstance(hb, (int, float)) and hb >= 10:
                                self._heartbeat_interval = int(hb)

                            if self._msg_callback:
                                # 将广告轮播等扩展数据合并到 config 中一并传递
                                ad_items = data.get("ad_carousel_items")
                                if ad_items is not None:
                                    sys_config["ad_carousel_items"] = ad_items
                                ad_interval_ms = data.get("ad_carousel_interval_ms")
                                if ad_interval_ms is not None:
                                    sys_config["ad_carousel_interval_ms"] = ad_interval_ms
                                notice_items = data.get("notice_items")
                                if notice_items is not None:
                                    sys_config["notice_items"] = notice_items
                                self._msg_callback(sys_config)

                        user_cmd = data.get("user_command")
                        if user_cmd and self._cmd_callback:
                            self._cmd_callback(user_cmd)

                        seq_id = data.get("user_seq_id")
                        if seq_id:
                            self._user_seq_id = int(seq_id)
                    except Exception:
                        pass
                else:
                    self._server_connected = False
                    if self._log_callback and not self._is_log_error:
                        self._log_callback.error(f"[遥测] 服务异常: {response.status_code}")
                        self._is_log_error = True

            except Exception as e:
                self._server_connected = False
                if self._log_callback and not self._is_log_error:
                    self._log_callback.error(f"[遥测] 服务交互异常: {type(e).__name__}")
                    self._is_log_error = True

        t = threading.Thread(target=_do_report, daemon=True, name="TelemetryStartup")
        t.start()

    def start_heartbeat_loop(self):
        """
        心跳循环，间隔由服务端 heartbeat_interval 动态控制，默认 60 秒。
        """
        self._stop_heartbeat = threading.Event()
        self._telemetry_started = True

        def _loop():
            while not self._stop_heartbeat.wait(self._heartbeat_interval):
                try:
                    self.report_startup()
                except Exception:
                    pass

        thread = threading.Thread(target=_loop, name="TelemetryHeartbeat", daemon=True)
        thread.start()

    def stop(self):
        """停止心跳上报"""
        if self._stop_heartbeat:
            self._stop_heartbeat.set()
        self._telemetry_started = False
        self._server_connected = False

    def submit_feedback(self, contact: str, content: str, category: str = "other",
                        callback=None):
        """
        异步提交用户反馈到遥测服务器。

        参数:
            contact  - 联系方式（QQ/邮箱）
            content  - 反馈正文
            category - 分类: bug / suggestion / other
            callback - 完成回调 (success: bool, message: str) -> None
        """
        if not self.report_url:
            if callback:
                callback(False, "遥测服务未配置")
            return

        feedback_url = resolve_related_endpoint(self.report_url, "/feedback")

        def _do_submit():
            try:
                screen_res = "unknown"
                user_locale = "unknown"
                try:
                    import ctypes
                    user32 = ctypes.windll.user32
                    w, h = user32.GetSystemMetrics(0), user32.GetSystemMetrics(1)
                    screen_res = f"{w}x{h}"

                    windll = ctypes.windll.kernel32
                    loc_name = ctypes.create_unicode_buffer(85)
                    windll.GetUserDefaultLocaleName(loc_name, 85)
                    user_locale = loc_name.value
                except Exception:
                    pass

                payload = {
                    "machine_id": self._machine_id,
                    "version": self.app_version,
                    "contact": str(contact or "").strip()[:100],
                    "content": str(content or "").strip()[:500],
                    "category": category if category in ("bug", "suggestion", "other") else "other",
                    "os": platform.system(),
                    "os_version": platform.version(),
                    "screen_res": screen_res,
                    "locale": user_locale,
                }

                response = requests.post(
                    feedback_url,
                    json=payload,
                    timeout=15,
                    headers=build_client_auth_headers(
                        feedback_url,
                        method="POST",
                        machine_id=self._machine_id,
                        user_agent=f'AimerWT-Client/{self.app_version} ({platform.system()})',
                    ),
                )

                if response.status_code == 200:
                    data = response.json()
                    fb_id = data.get("feedback_id", "")
                    if callback:
                        callback(True, f"反馈已提交 (#{fb_id})")
                elif response.status_code == 429:
                    data = response.json()
                    if callback:
                        callback(False, data.get("error", "提交过于频繁，请稍后再试"))
                else:
                    if callback:
                        callback(False, f"服务器返回异常状态: {response.status_code}")

            except Exception as e:
                if callback:
                    callback(False, f"提交失败: {type(e).__name__}")

        t = threading.Thread(target=_do_submit, daemon=True, name="FeedbackSubmit")
        t.start()


_instance = None


def init_telemetry(version: str, url: str = None, autostart: bool = True):
    """
    初始化并启动遥测服务（含心跳）。
    """
    global _instance
    target_url = resolve_report_url(url)
    should_start = False
    if _instance is None:
        _instance = TelemetryManager(version, target_url)
        should_start = True
    else:
        _instance.app_version = version
        _instance.update_report_url(target_url)
        if not _instance._telemetry_started or (_instance._stop_heartbeat is not None and _instance._stop_heartbeat.is_set()):
            should_start = True

    if autostart and should_start:
        if _instance._stop_heartbeat is None or _instance._stop_heartbeat.is_set():
            _instance.start_heartbeat_loop()
        _instance.report_startup()
        _instance._telemetry_started = True
    return _instance


def get_hwid():
    """获取当前的 HWID，若未初始化则返回未知。"""
    if _instance:
        return _instance.get_machine_id()
    return "UNKNOWN"


def get_telemetry_connection_status() -> bool:
    """获取当前遥测与服务端的连接状态。"""
    if _instance:
        return _instance.is_server_connected()
    return False


def get_user_seq_id() -> int:
    """获取服务端分配的用户序号。"""
    if _instance:
        return _instance.get_user_seq_id()
    return 0


def submit_feedback(contact: str, content: str, category: str = "other",
                    callback=None):
    """模块级反馈提交快捷入口，遥测未初始化时静默失败。"""
    if _instance:
        _instance.submit_feedback(contact, content, category, callback)
    elif callback:
        callback(False, "遥测服务未初始化")


def get_telemetry_manager():
    """返回当前遥测单例，未初始化时返回 None。"""
    return _instance
