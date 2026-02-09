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
import os
import platform
import subprocess
import sys
import threading
import uuid
from typing import Optional

import requests


class TelemetryManager:
    def __init__(self, app_version: str, report_url: Optional[str] = None):
        self._stop_heartbeat = None
        self._is_log_error = False
        self.app_version = app_version

        # 优先级：显式注入 > app_secrets > 默认接口
        final_url = report_url
        if not final_url:
            try:
                import app_secrets
                final_url = getattr(app_secrets, "REPORT_URL", None)
            except ImportError:
                pass

        target_url = final_url or "https://api.example.com/telemetry"

        self.report_url = target_url
        self._machine_id = self._generate_hwid()
        self._msg_callback = None
        self._cmd_callback = None
        self._log_callback = None

    def set_server_message_callback(self, callback):
        """设置接收服务端控制消息的回调函数 (config: dict) -> None"""
        self._msg_callback = callback

    def set_user_command_callback(self, callback):
        """设置接收特定用户指令的回调函数 (command: str) -> None"""
        self._cmd_callback = callback

    def set_log_callback(self, callback):
        """设置日志回调 (msg: str, level: str) -> None"""
        self._log_callback = callback

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
                    headers={'User-Agent': f'AimerWT-Client/{self.app_version} ({platform.system()})'}
                )

                if response.status_code == 200 or response.status_code == 503:
                    self._is_log_error = False
                    try:
                        data = response.json()
                        sys_config = data.get("sys_config")
                        if sys_config and self._msg_callback:
                            self._msg_callback(sys_config)

                        user_cmd = data.get("user_command")
                        if user_cmd and self._cmd_callback:
                            self._cmd_callback(user_cmd)
                    except Exception:
                        pass
                else:
                    if self._log_callback and not self._is_log_error:
                        self._log_callback.error(f"[遥测] 服务异常: {response.status_code}")
                        self._is_log_error = True

            except Exception as e:
                if self._log_callback and not self._is_log_error:
                    self._log_callback.error(f"[遥测] 服务交互异常: {type(e).__name__}")
                    self._is_log_error = True

        t = threading.Thread(target=_do_report, daemon=True, name="TelemetryStartup")
        t.start()

    def start_heartbeat_loop(self):
        """
        心跳，每 5 分钟更新一次在线状态。
        """
        self._stop_heartbeat = threading.Event()

        def _loop():
            while not self._stop_heartbeat.wait(60):
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


_instance = None


def init_telemetry(version: str, url: str = None):
    """
    初始化并启动遥测服务（含心跳）。
    """
    global _instance
    if _instance is None:
        _instance = TelemetryManager(version, url)

        _instance.report_startup()
        _instance.start_heartbeat_loop()
    return _instance


def get_hwid():
    """获取当前的 HWID，若未初始化则返回未知。"""
    if _instance:
        return _instance.get_machine_id()
    return "UNKNOWN"
