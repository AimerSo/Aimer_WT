# -*- coding: utf-8 -*-
"""
配置管理模组：维护应用配置的内存表示，并提供按键读写与持久化保存能力。

功能特性:
- 跨平台配置文件存储路径支援 (Windows/Linux/macOS)
- 自动编码回退策略读取 JSON
- 配置项的安全读写与验证
"""
import json
import os
import platform
from pathlib import Path
import sys
from logger import get_logger

log = get_logger(__name__)


class ConfigError(Exception):
    """配置相关错误的基类。"""
    pass


class ConfigLoadError(ConfigError):
    """配置加载失败。"""
    pass


class ConfigSaveError(ConfigError):
    """配置保存失败。"""
    pass

# 配置文件固定存放在用户配置目录下的 Aimer_WT 资料夹
def _get_default_config_dir():
    """
    获取默认配置文件目录（跨平台支援）
    - Windows: ~/Documents/Aimer_WT
    - Linux: ~/.config/Aimer_WT
    - macOS: ~/Library/Application Support/Aimer_WT
    
    Returns:
        Path: 配置目录路径
    
    Raises:
        ConfigError: 无法创建或访问配置目录时
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
            log.info(f"已创建配置目录: {config_base}")
        except PermissionError as e:
            log.warning(f"无法创建配置目录（权限不足），使用程式目录: {e}")
            # 备用方案：使用程式目录
            if getattr(sys, 'frozen', False):
                return Path(sys.executable).parent
            else:
                return Path(__file__).parent
        except OSError as e:
            log.warning(f"无法创建配置目录（系统错误），使用程式目录: {e}")
            if getattr(sys, 'frozen', False):
                return Path(sys.executable).parent
            else:
                return Path(__file__).parent
    return config_base

def _get_config_dir():
    """获取配置文件目录。"""
    return _get_default_config_dir()

DOCS_DIR = _get_config_dir()
CONFIG_FILE = DOCS_DIR / "settings.json"


class ConfigManager:
    """
    维护应用配置的内存表示，并提供按键读写与落盘保存能力。
    
    属性:
        config_dir: 配置文件目录
        config_file: 配置文件路径
        config: 配置字典
    """
    
    # 默认配置模板
    DEFAULT_CONFIG = {
        "game_path": "",
        "theme_mode": "Light",
        "is_first_run": True,
        "agreement_version": "",
        "sights_path": "",
        "pending_dir": "",
        "library_dir": ""
    }
    
    def __init__(self):
        """初始化配置管理器，加载或创建配置文件。"""
        self.config_dir = DOCS_DIR
        self.config_file = CONFIG_FILE
        
        # 初始化默认配置并尝试从 settings.json 加载复盖
        self.config = self.DEFAULT_CONFIG.copy()
        self.load_config()

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
                with open(file_path, 'r', encoding=enc) as f:
                    return json.load(f)
            except UnicodeDecodeError:
                continue
            except json.JSONDecodeError as e:
                last_error = e
                log.warning(f"JSON 解析错误 (编码: {enc}): {e}")
                continue
            except Exception as e:
                last_error = e
                continue
        
        if last_error:
            log.error(f"无法读取配置文件 {file_path}: {last_error}")
        return None

    def load_config(self) -> bool:
        """
        从 settings.json 加载配置并合併到当前配置字典。
        
        Returns:
            bool: 是否成功加载
        """
        if not self.config_file.exists():
            log.info("配置文件不存在，使用默认配置")
            return False
            
        try:
            data = self._load_json_with_fallback(self.config_file)
            if isinstance(data, dict):
                # 只更新已知的配置项，忽略未知项
                for key in self.DEFAULT_CONFIG:
                    if key in data:
                        self.config[key] = data[key]
                log.debug(f"已加载配置文件: {self.config_file}")
                return True
            else:
                log.warning("配置文件格式无效，使用默认配置")
                return False
        except Exception as e:
            log.error(f"加载配置文件失败: {type(e).__name__}: {e}")
            return False

    def save_config(self) -> bool:
        """
        将当前配置字典写入 settings.json。
        
        Returns:
            bool: 是否成功保存
            
        Raises:
            ConfigSaveError: 保存失败时（仅在严重错误时）
        """
        try:
            # 确保目录存在
            if not self.config_dir.exists():
                self.config_dir.mkdir(parents=True, exist_ok=True)
            
            # 先写入临时文件，成功后再重命名（原子操作）
            temp_file = self.config_file.with_suffix('.tmp')
            with open(temp_file, 'w', encoding='utf-8') as f:
                json.dump(self.config, f, indent=4, ensure_ascii=False)
            
            # 重命名为正式文件
            temp_file.replace(self.config_file)
            log.debug(f"配置已保存: {self.config_file}")
            return True
            
        except PermissionError as e:
            log.error(f"保存配置文件失败（权限不足）: {e}")
            return False
        except OSError as e:
            log.error(f"保存配置文件失败（系统错误）: {e}")
            return False
        except Exception as e:
            log.error(f"保存配置文件失败: {type(e).__name__}: {e}")
            return False

    def get_game_path(self) -> str:
        """读取当前配置中的游戏根目录路径。"""
        return self.config.get("game_path", "")

    def set_game_path(self, path: str) -> bool:
        """
        更新游戏根目录路径并写入 settings.json。
        
        Args:
            path: 游戏路径
            
        Returns:
            bool: 是否成功保存
        """
        self.config["game_path"] = str(path) if path else ""
        return self.save_config()

    def get_sights_path(self) -> str:
        """读取当前配置中的 UserSights 目录路径。"""
        return self.config.get("sights_path", "")

    def set_sights_path(self, path: str) -> bool:
        """
        更新 UserSights 目录路径并写入 settings.json。
        
        Args:
            path: UserSights 路径
            
        Returns:
            bool: 是否成功保存
        """
        self.config["sights_path"] = str(path) if path else ""
        return self.save_config()

    def get_theme_mode(self) -> str:
        """读取当前主题模式（Light/Dark）。"""
        return self.config.get("theme_mode", "Light")

    def set_theme_mode(self, mode: str) -> bool:
        """
        更新主题模式并写入 settings.json。
        
        Args:
            mode: 主题模式 ("Light" 或 "Dark")
            
        Returns:
            bool: 是否成功保存
        """
        if mode not in ("Light", "Dark"):
            log.warning(f"无效的主题模式: {mode}，使用 Light")
            mode = "Light"
        self.config["theme_mode"] = mode
        return self.save_config()

    def get_active_theme(self) -> str:
        """读取当前选择的主题文件名（自定义主题的配置项）。"""
        return self.config.get("active_theme", "default.json")

    def set_active_theme(self, filename: str) -> bool:
        """
        更新当前选择的主题文件名并写入 settings.json。
        
        Args:
            filename: 主题文件名
            
        Returns:
            bool: 是否成功保存
        """
        self.config["active_theme"] = str(filename) if filename else "default.json"
        return self.save_config()

    def get_current_mod(self) -> str:
        """读取当前记录的已安装/已生效语音包标识。"""
        return self.config.get("current_mod", "")

    def set_current_mod(self, mod_id: str) -> bool:
        """
        更新当前已生效语音包标识并写入 settings.json。
        
        Args:
            mod_id: 语音包标识
            
        Returns:
            bool: 是否成功保存
        """
        self.config["current_mod"] = str(mod_id) if mod_id else ""
        return self.save_config()

    def get_is_first_run(self) -> bool:
        """读取是否为首次运行的标誌位。"""
        return bool(self.config.get("is_first_run", True))

    def set_is_first_run(self, is_first_run: bool) -> bool:
        """
        更新首次运行标誌位并写入 settings.json。
        
        Args:
            is_first_run: 是否首次运行
            
        Returns:
            bool: 是否成功保存
        """
        self.config["is_first_run"] = bool(is_first_run)
        return self.save_config()

    def get_agreement_version(self) -> str:
        """读取用户已确认的协议版本号。"""
        return self.config.get("agreement_version", "")

    def set_agreement_version(self, version: str) -> bool:
        """
        更新用户已确认的协议版本号并写入 settings.json。
        
        Args:
            version: 协议版本号
            
        Returns:
            bool: 是否成功保存
        """
        self.config["agreement_version"] = str(version) if version else ""
        return self.save_config()

    def get_config_dir(self) -> str:
        """读取当前配置文件所在目录路径。"""
        return str(self.config_dir)

    def get_config_file_path(self) -> str:
        """读取当前 settings.json 的完整路径。"""
        return str(self.config_file)

    def get_pending_dir(self) -> str:
        """读取自定义的待解压区目录路径。"""
        return self.config.get("pending_dir", "")

    def set_pending_dir(self, path: str) -> bool:
        """
        更新待解压区目录路径并写入 settings.json。
        
        Args:
            path: 待解压区路径
            
        Returns:
            bool: 是否成功保存
        """
        self.config["pending_dir"] = str(path) if path else ""
        return self.save_config()

    def get_library_dir(self) -> str:
        """读取自定义的语音包库目录路径。"""
        return self.config.get("library_dir", "")

    def set_library_dir(self, path: str) -> bool:
        """
        更新语音包库目录路径并写入 settings.json。
        
        Args:
            path: 语音包库路径
            
        Returns:
            bool: 是否成功保存
        """
        self.config["library_dir"] = str(path) if path else ""
        return self.save_config()
