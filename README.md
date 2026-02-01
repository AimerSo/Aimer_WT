# Aimer WT

用于 War Thunder 的语音包管理/安装工具。桌面端基于 Python + PyWebview，前端静态资源在 `web/` 目录。

**上传的文件都经过了opus重构和注释，应该比我自己的要工整许多。**

## 开发者信息

- **作者：** AimerSo
- **B站主页：** [个人主页](https://space.bilibili.com/1379084732)

## 功能

- 自动检测/配置游戏路径
- 导入语音包压缩包（zip）到本地语音包库
- 从语音包库选择并安装（支持按模块安装，以实际 UI 为准）
- 主题切换（`web/themes/*.json`）
- 日志记录（`logs/app.log`）

## 环境要求

- Windows
- Python（建议 3.10+，以你本地可运行版本为准）
- 依赖：pywebview

## 快速开始（源码运行）

1. 安装依赖（最小示例）：

```bash
pip install pywebview
```

2. 启动：

```bash
python main.py
```

## 目录结构说明

- `main.py`：程序入口与 JS API 桥接层（PyWebview）
- `core_logic.py`：与游戏目录/安装流程相关的核心逻辑
- `library_manager.py`：语音包库与导入管理
- `config_manager.py`：配置读写（默认 `settings.json`）
- `web/`：前端静态资源（HTML/CSS/JS、主题 `themes/`）
- `WT待解压区/`：放入待导入的 zip（或由程序导入时使用）
- `WT语音包库/`：导入后整理好的语音包库
- `logs/app.log`：运行日志

## 使用说明

1. 启动后在主页设置/自动搜索 War Thunder 游戏路径
2. 导入语音包 zip（会整理到 `WT语音包库/`）
3. 在语音包列表选择需要安装的语音包与模块并执行安装

## 免责声明

本项目仅用于学习与个人本地管理用途。语音包/音频资源及相关内容版权归原作者或权利方所有。请在遵守相关法律法规与游戏条款的前提下使用。

## 贡献说明
欢迎支持和参与Aimer WT的开发！  
- 如果您想要赞助，可以在管理器中找到赞助链接，也可以在交流群中联系作者赞助  
- 如果您想要参与开发，欢迎任何贡献，但如果可以请优先处理issue中的问题，我们会尽快处理您的pr

## 许可协议
本项目采用 GNU General Public License v3.0（GPL-3.0）开源，详见 `LICENSE` 文件。

