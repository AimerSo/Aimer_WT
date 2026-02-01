# -*- coding: utf-8 -*-
"""
配置管理模块：负责应用配置的读取、更新与持久化保存。

功能定位:
- 将前端需要持久化的用户配置保存到 settings.json，并提供读取与更新接口。

输入输出:
- 输入: 配置键的目标值（如 game_path、theme_mode、active_theme 等）。
- 输出: 对配置字典的读写，以及 settings.json 的文件写入副作用。
- 外部资源/依赖:
  - 文件: <APP_ROOT>/settings.json（读写）
  - 运行环境: frozen（PyInstaller）与非 frozen 两种路径定位方式

实现逻辑:
- 1) 启动时加载 settings.json（若存在）。
- 2) 修改配置时更新内存字典并立即写回文件。
- 3) 读取 JSON 时按编码列表回退尝试，以兼容不同来源的文件编码。

业务关联:
- 上游: main.py 的桥接层在初始化、主题切换、路径选择、协议确认等场景调用。
- 下游: 配置结果影响后端安装/还原路径选择与前端界面状态恢复。
"""
import json
import os
from pathlib import Path

# 使用用户文档文件夹 Aimer_WT/settings.json
DOCS_DIR = Path.home() / "Documents" / "Aimer_WT"
CONFIG_FILE = DOCS_DIR / "settings.json"

class ConfigManager:
    """
    功能定位:
    - 维护应用配置的内存表示，并提供按键读写与落盘保存能力。

    输入输出:
    - 输入: 各 setter 的参数（字符串/布尔值）。
    - 输出: getter 返回具体配置值；setter 写入 settings.json。
    - 外部资源/依赖: CONFIG_FILE（settings.json）。

    实现逻辑:
    - 使用 self.config 作为配置字典。
    - load_config 启动时合并文件内容；save_config 将当前字典写回文件。

    业务关联:
    - 上游: main.py 的 AppApi。
    - 下游: 影响游戏路径、主题、协议状态、炮镜路径等业务流程与 UI 展示。
    """
    def __init__(self):
        """
        功能定位:
        - 初始化默认配置并尝试从 settings.json 加载覆盖。

        输入输出:
        - 参数: 无
        - 返回: None
        - 外部资源/依赖:
          - 文件: CONFIG_FILE（读取）

        实现逻辑:
        - 1) 构造默认配置字典。
        - 2) 调用 load_config 从文件加载并合并到默认值上。

        业务关联:
        - 上游: main.py 在启动时创建该对象。
        - 下游: init_app_state 等接口依赖此处加载的配置。
        """
        self.config = {
            "game_path": "",
            "theme_mode": "Light",  # 默认白色
            "is_first_run": True,
            "agreement_version": "",
            "sights_path": ""
        }
        self.load_config()

    def _load_json_with_fallback(self, file_path):
        """
        功能定位:
        - 按编码回退策略读取 JSON 文件并解析为 Python 对象。

        输入输出:
        - 参数:
          - file_path: str，目标 JSON 文件路径。
        - 返回:
          - dict | list | None，解析成功返回对应对象，失败返回 None。
        - 外部资源/依赖:
          - 文件: file_path（读取）

        实现逻辑:
        - 依次尝试 encodings 列表中的编码进行打开与 json.load。
        - 任一编码成功即返回；全部失败返回 None。

        业务关联:
        - 上游: load_config。
        - 下游: 为配置加载提供兼容性支持。
        """
        encodings = ["utf-8-sig", "utf-8", "cp950", "big5", "gbk"]
        for enc in encodings:
            try:
                with open(file_path, 'r', encoding=enc) as f:
                    return json.load(f)
            except:
                continue
        return None

    def load_config(self):
        """
        功能定位:
        - 从 settings.json 加载配置并合并到当前配置字典。

        输入输出:
        - 参数: 无
        - 返回: None
        - 外部资源/依赖:
          - 文件: CONFIG_FILE（读取）

        实现逻辑:
        - 1) 若配置文件存在则读取并解析 JSON。
        - 2) 当解析结果为 dict 时，将其 update 合并到 self.config。
        - 3) 解析失败时保持默认配置不变。

        业务关联:
        - 上游: __init__。
        - 下游: main.py 初始化状态依赖此处的加载结果。
        """
        if os.path.exists(CONFIG_FILE):
            try:
                data = self._load_json_with_fallback(CONFIG_FILE)
                if isinstance(data, dict):
                    self.config.update(data)
            except:
                pass

    def save_config(self):
        try:
            # 确保目录存在
            if not DOCS_DIR.exists():
                DOCS_DIR.mkdir(parents=True, exist_ok=True)
                
            with open(CONFIG_FILE, 'w', encoding='utf-8') as f:
                json.dump(self.config, f, indent=4, ensure_ascii=False)
        except:
            pass

    def get_game_path(self):
        """
        功能定位:
        - 读取当前配置中的游戏根目录路径。

        输入输出:
        - 参数: 无
        - 返回: str，游戏路径；未设置时返回空字符串。
        - 外部资源/依赖: self.config（内存配置）

        实现逻辑:
        - 从 self.config 中读取键 game_path 并返回默认值。

        业务关联:
        - 上游: main.py 初始化与安装/还原流程。
        - 下游: 传入 core_logic.validate_game_path 进行校验与执行。
        """
        return self.config.get("game_path", "")

    def set_game_path(self, path):
        """
        功能定位:
        - 更新游戏根目录路径并写入 settings.json。

        输入输出:
        - 参数:
          - path: str，游戏根目录路径字符串。
        - 返回: None
        - 外部资源/依赖: CONFIG_FILE（写入）

        实现逻辑:
        - 写入 self.config["game_path"] 并调用 save_config。

        业务关联:
        - 上游: 用户手动选择路径或自动搜索成功后调用。
        - 下游: 影响后续安装/还原与前端显示的路径状态。
        """
        self.config["game_path"] = path
        self.save_config()

    def get_sights_path(self):
        """
        功能定位:
        - 读取当前配置中的 UserSights 目录路径。

        输入输出:
        - 参数: 无
        - 返回: str，炮镜路径；未设置时返回空字符串。
        - 外部资源/依赖: self.config

        实现逻辑:
        - 从 self.config 中读取键 sights_path 并返回默认值。

        业务关联:
        - 上游: main.py 初始化炮镜管理器时读取。
        - 下游: 影响炮镜列表扫描与导入目标目录。
        """
        return self.config.get("sights_path", "")

    def set_sights_path(self, path):
        """
        功能定位:
        - 更新 UserSights 目录路径并写入 settings.json。

        输入输出:
        - 参数:
          - path: str，炮镜目录路径字符串。
        - 返回: None
        - 外部资源/依赖: CONFIG_FILE（写入）

        实现逻辑:
        - 写入 self.config["sights_path"] 并调用 save_config。

        业务关联:
        - 上游: 用户在前端设置炮镜路径时调用。
        - 下游: 影响 SightsManager 的扫描与导入行为。
        """
        self.config["sights_path"] = path
        self.save_config()

    def get_theme_mode(self):
        """
        功能定位:
        - 读取当前主题模式（Light/Dark）。

        输入输出:
        - 参数: 无
        - 返回: str，主题模式字符串；未设置时返回默认值。
        - 外部资源/依赖: self.config

        实现逻辑:
        - 从 self.config 读取 theme_mode。

        业务关联:
        - 上游: main.py 初始化前端状态时读取。
        - 下游: 前端据此设置 data-theme 并决定图标与样式。
        """
        return self.config.get("theme_mode", "Dark")

    def set_theme_mode(self, mode):
        """
        功能定位:
        - 更新主题模式并写入 settings.json。

        输入输出:
        - 参数:
          - mode: str，主题模式字符串（Light/Dark）。
        - 返回: None
        - 外部资源/依赖: CONFIG_FILE（写入）

        实现逻辑:
        - 写入 self.config["theme_mode"] 并调用 save_config。

        业务关联:
        - 上游: 前端主题切换按钮触发。
        - 下游: 下次启动时恢复该主题模式。
        """
        self.config["theme_mode"] = mode
        self.save_config()

    def get_active_theme(self):
        """
        功能定位:
        - 读取当前选择的主题文件名（自定义主题的配置项）。

        输入输出:
        - 参数: 无
        - 返回: str，主题文件名；未设置时返回 default.json。
        - 外部资源/依赖: self.config

        实现逻辑:
        - 从 self.config 读取 active_theme。

        业务关联:
        - 上游: main.py 初始化时读取并传给前端。
        - 下游: 前端将按该文件名加载主题内容并应用颜色变量。
        """
        return self.config.get("active_theme", "default.json")

    def set_active_theme(self, filename):
        """
        功能定位:
        - 更新当前选择的主题文件名并写入 settings.json。

        输入输出:
        - 参数:
          - filename: str，主题文件名（例如 default.json 或 themes 下的其他文件）。
        - 返回: None
        - 外部资源/依赖: CONFIG_FILE（写入）

        实现逻辑:
        - 写入 self.config["active_theme"] 并调用 save_config。

        业务关联:
        - 上游: 前端主题下拉框选择触发。
        - 下游: 下次启动时恢复该主题选择。
        """
        self.config["active_theme"] = filename
        self.save_config()

    def get_current_mod(self):
        """
        功能定位:
        - 读取当前记录的已安装/已生效语音包标识。

        输入输出:
        - 参数: 无
        - 返回: str，语音包标识；未设置时返回空字符串。
        - 外部资源/依赖: self.config

        实现逻辑:
        - 从 self.config 读取 current_mod。

        业务关联:
        - 上游: main.py 初始化前端状态时读取。
        - 下游: 前端用于标记“当前已生效”的语音包卡片状态。
        """
        return self.config.get("current_mod", "")

    def set_current_mod(self, mod_id):
        """
        功能定位:
        - 更新当前已生效语音包标识并写入 settings.json。

        输入输出:
        - 参数:
          - mod_id: str，语音包标识（通常为语音包文件夹名）。
        - 返回: None
        - 外部资源/依赖: CONFIG_FILE（写入）

        实现逻辑:
        - 写入 self.config["current_mod"] 并调用 save_config。

        业务关联:
        - 上游: 安装流程成功后由 main.py 写入。
        - 下游: 前端渲染语音包列表时据此显示安装状态。
        """
        self.config["current_mod"] = mod_id
        self.save_config()

    def get_is_first_run(self):
        """
        功能定位:
        - 读取是否为首次运行的标志位。

        输入输出:
        - 参数: 无
        - 返回: bool，首次运行返回 True，否则 False。
        - 外部资源/依赖: self.config

        实现逻辑:
        - 读取 is_first_run 并转为 bool。

        业务关联:
        - 上游: main.py 在启动时判断是否需要展示协议。
        - 下游: 前端协议弹窗展示逻辑依赖该值。
        """
        return bool(self.config.get("is_first_run", True))

    def set_is_first_run(self, is_first_run):
        """
        功能定位:
        - 更新首次运行标志位并写入 settings.json。

        输入输出:
        - 参数:
          - is_first_run: bool，是否首次运行。
        - 返回: None
        - 外部资源/依赖: CONFIG_FILE（写入）

        实现逻辑:
        - 将参数转为 bool 写入 self.config 并保存。

        业务关联:
        - 上游: 用户完成首次协议流程后更新为 False。
        - 下游: 后续启动将不再按首次运行流程展示协议。
        """
        self.config["is_first_run"] = bool(is_first_run)
        self.save_config()

    def get_agreement_version(self):
        """
        功能定位:
        - 读取用户已确认的协议版本号。

        输入输出:
        - 参数: 无
        - 返回: str，协议版本号；未确认则为空字符串。
        - 外部资源/依赖: self.config

        实现逻辑:
        - 从 self.config 读取 agreement_version。

        业务关联:
        - 上游: main.py 在启动时判断是否需要重新确认协议。
        - 下游: 前端协议弹窗与后端 agree_to_terms 校验逻辑依赖该值。
        """
        return self.config.get("agreement_version", "")

    def set_agreement_version(self, version):
        """
        功能定位:
        - 更新用户已确认的协议版本号并写入 settings.json。

        输入输出:
        - 参数:
          - version: str，协议版本号字符串。
        - 返回: None
        - 外部资源/依赖: CONFIG_FILE（写入）

        实现逻辑:
        - 写入 self.config["agreement_version"] 并保存。

        业务关联:
        - 上游: 用户在前端点击同意协议后调用。
        - 下游: 下次启动依据该值判断协议是否已确认。
        """
        self.config["agreement_version"] = version
        self.save_config()
