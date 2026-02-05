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

- Windows/Linux
- Microsoft Edge WebView2 Runtime（Windows only）
- Python（建议 3.10+，以你本地可运行版本为准）
- 依赖：pywebview
## 🐧 Linux / Steam Deck 支持
本项目已适配 Linux (Arch/Debian) 及 Wayland 环境：
- ✅ 支持全盘 Steam 库自动检索
- ✅ 解决 Wayland 环境下渲染黑屏问题
- ✅ 支持手动选择路径与语音包管理

> **注意**：Linux 用户请务必查看 [Linux 使用指南](LINUX.md) 以安装必要依赖和配置环境变量。

## 快速开始（源码运行）

1. 安装依赖（最小示例）：

```bash
pip install -r requirements.txt
```

2. 启动：

```bash
python main.py
```

## 启动参数（可选）

- `--allow-fallback`：当 WebView2 不可用且 edgechromium 启动失败时，允许尝试降级启动（可能导致部分界面不可用）。
- `--perf`：开启部分接口的性能日志输出。

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

## 隐私声明

本程序包含一个轻量级的匿名遥测系统，旨在帮助开发者了解应用使用情况并优化跨平台兼容性。
- **匿名设备标识**：通过对 CPU、磁盘、主板等硬件信息进行“加盐哈希（Salted Hash）”处理，生成全局唯一的匿名机器码（HWID）。我们**不会**获取或上传任何原始硬件序列号或文件系统指纹。
- **数据收集范围**：仅收集非敏感的系统信息，包括操作系统版本、处理器架构（Arch）、应用版本号、地区/语种设置及心跳状态。
- **数据安全**：所有数据均通过安全链接传输，仅用于统计活跃用户量及环境特征分析，不涉及任何个人隐私、账号信息或本地文件内容。

## 许可协议
本项目采用 GNU General Public License v3.0（GPL-3.0）开源，详见 `LICENSE` 文件。

