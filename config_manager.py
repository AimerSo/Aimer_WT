# -*- coding: utf-8 -*-
import json
import os
import platform
from pathlib import Path
import sys
from logger import get_logger

log = get_logger(__name__)

# 配置文件固定存放在用户配置目录下的 Aimer_WT 资料夹
def _get_default_config_dir():
    """
    获取默认配置文件目录（跨平台支持）
    - Windows: ~/Documents/Aimer_WT
    - Linux: ~/.config/Aimer_WT
    - macOS: ~/Library/Application Support/Aimer_WT
    """
    system = platform.system()
    
    if system == "Windows":
        # Windows: 用户文档目录
        config_base = Path.home() / "Documents" / "Aimer_WT"
    elif system == "Darwin":
        # macOS: Application Support 目录
        config_base = Path.home() / "Library" / "Application Support" / "Aimer_WT"
    else:
        # Linux/其他: 使用 XDG_CONFIG_HOME 或 ~/.config
        xdg_config = os.environ.get("XDG_CONFIG_HOME")
        if xdg_config:
            config_base = Path(xdg_config) / "Aimer_WT"
        else:
            config_base = Path.home() / ".config" / "Aimer_WT"
    
    # 确保目录存在
    if not config_base.exists():
        try:
            config_base.mkdir(parents=True, exist_ok=True)
        except Exception as e:
            log.warning(f"无法创建配置目录，使用程序目录: {e}")
            # 备用方案：使用程序目录
            if getattr(sys, 'frozen', False):
                return Path(sys.executable).parent
            else:
                return Path(__file__).parent
    return config_base

def _get_config_dir():
    """获取配置文件目录"""
    return _get_default_config_dir()

DOCS_DIR = _get_config_dir()
CONFIG_FILE = DOCS_DIR / "settings.json"

class ConfigManager:
    # 维护应用配置的内存表示，并提供按键读写与落盘保存能力。
    def __init__(self):
        # 配置文件路径（固定在用户文档/Aimer_WT）
        self.config_dir = DOCS_DIR
        self.config_file = CONFIG_FILE
        
        # 初始化默认配置并尝试从 settings.json 加载覆盖。
        self.config = {
            "game_path": "",
            "theme_mode": "Light",  # 默认白色
            "is_first_run": True,
            "agreement_version": "",
            "sights_path": "",
            "pending_dir": "",   # 自定義待解壓區路徑
            "library_dir": ""    # 自定義語音包庫路徑
        }
        self.load_config()

    def _load_json_with_fallback(self, file_path):
        # 按编码回退策略读取 JSON 文件并解析为 Python 对象。
        encodings = ["utf-8-sig", "utf-8", "cp950", "big5", "gbk"]
        for enc in encodings:
            try:
                with open(file_path, 'r', encoding=enc) as f:
                    return json.load(f)
            except:
                continue
        return None

    def load_config(self):
        # 从 settings.json 加载配置并合并到当前配置字典。
        if os.path.exists(self.config_file):
            try:
                data = self._load_json_with_fallback(self.config_file)
                if isinstance(data, dict):
                    self.config.update(data)
            except Exception as e:
                log.warning(f"加载配置文件失败: {e}")

    def save_config(self):
        # 将当前配置字典写入 settings.json。
        try:
            # 确保目录存在
            if not self.config_dir.exists():
                self.config_dir.mkdir(parents=True, exist_ok=True)
                
            with open(self.config_file, 'w', encoding='utf-8') as f:
                json.dump(self.config, f, indent=4, ensure_ascii=False)
        except Exception as e:
            log.error(f"保存配置文件失败: {e}")

    def get_game_path(self):
        # 读取当前配置中的游戏根目录路径。
        return self.config.get("game_path", "")

    def set_game_path(self, path):
        # 更新游戏根目录路径并写入 settings.json。
        self.config["game_path"] = path
        self.save_config()

    def get_sights_path(self):
        # 读取当前配置中的 UserSights 目录路径。
        return self.config.get("sights_path", "")

    def set_sights_path(self, path):
        # 更新 UserSights 目录路径并写入 settings.json。
        self.config["sights_path"] = path
        self.save_config()

    def get_theme_mode(self):
        # 读取当前主题模式（Light/Dark）。
        return self.config.get("theme_mode", "Light")

    def set_theme_mode(self, mode):
        # 更新主题模式并写入 settings.json。
        self.config["theme_mode"] = mode
        self.save_config()

    def get_active_theme(self):
        # 读取当前选择的主题文件名（自定义主题的配置项）。
        return self.config.get("active_theme", "default.json")

    def set_active_theme(self, filename):
        # 更新当前选择的主题文件名并写入 settings.json。
        self.config["active_theme"] = filename
        self.save_config()

    def get_current_mod(self):
        # 读取当前记录的已安装/已生效语音包标识。
        return self.config.get("current_mod", "")

    def set_current_mod(self, mod_id):
        # 更新当前已生效语音包标识并写入 settings.json。
        self.config["current_mod"] = mod_id
        self.save_config()

    def get_is_first_run(self):
        # 读取是否为首次运行的标志位。
        return bool(self.config.get("is_first_run", True))

    def set_is_first_run(self, is_first_run):
        # 更新首次运行标志位并写入 settings.json。
        self.config["is_first_run"] = bool(is_first_run)
        self.save_config()

    def get_agreement_version(self):
        # 读取用户已确认的协议版本号。
        return self.config.get("agreement_version", "")

    def set_agreement_version(self, version):
        # 更新用户已确认的协议版本号并写入 settings.json。
        self.config["agreement_version"] = version
        self.save_config()

    def get_config_dir(self):
        # 读取当前配置文件所在目录路径。
        return str(self.config_dir)

    def get_config_file_path(self):
        # 读取当前 settings.json 的完整路径。
        return str(self.config_file)

    def get_pending_dir(self):
        # 讀取自定義的待解壓區目錄路徑。
        return self.config.get("pending_dir", "")

    def set_pending_dir(self, path):
        # 更新待解壓區目錄路徑並寫入 settings.json。
        self.config["pending_dir"] = path
        self.save_config()

    def get_library_dir(self):
        # 讀取自定義的語音包庫目錄路徑。
        return self.config.get("library_dir", "")

    def set_library_dir(self, path):
        # 更新語音包庫目錄路徑並寫入 settings.json。
        self.config["library_dir"] = path
        self.save_config()
