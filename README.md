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
- Python（建议 3.10+，以你本地可运行版本为准）
- 依赖：pywebview
 ---
### Linux 依赖安装指南

为了让 Aimer WT 的 GUI 正常运行（基于 PyWebview 和 WebKit2GTK），请根据你的发行版执行以下命令：

#### 1. Arch Linux / Manjaro
```bash
sudo pacman -S python-gobject webkit2gtk python-pywebview
```

#### 2. Debian / Ubuntu / Mint
```bash
sudo apt update
sudo apt install python3-gi python3-gi-cairo gir1.2-gtk-3.0 gir1.2-webkit2-4.1 python3-webview
```
*注：如果系统仓库的 `python3-webview` 版本过低，建议使用 `pip install pywebview`。*

---

### 环境变量与兼容性设置

在 Linux（尤其是 Wayland 环境）下，如果遇到窗口不显示、黑屏或崩溃，请在启动前设置以下环境变量：

| 变量名 | 推荐值 | 作用 |
| :--- | :--- | :--- |
| `GDK_BACKEND` | `wayland` | 强制使用 Wayland 协议运行（解决窗口模糊/缩放问题） |
| `WEBKIT_DISABLE_COMPOSITING_MODE` | `1` | **核心修复**：关闭 WebKit 硬件加速，解决大部分显卡驱动导致的黑屏/崩溃 |
| `PYTHONUNBUFFERED` | `1` | 实时输出 Python 日志，方便调试 |

#### 建议的启动方式

你可以创建一个 `start.sh` 脚本来一键运行：

```bash
#!/bin/bash
# 适配 Wayland 并修复 WebKit 渲染问题
export GDK_BACKEND=wayland
export WEBKIT_DISABLE_COMPOSITING_MODE=1

python main.py
```

或者直接在终端单行运行：
```bash
GDK_BACKEND=wayland WEBKIT_DISABLE_COMPOSITING_MODE=1 python main.py
```

---

### 常见问题 (FAQ)

**Q: 启动后窗口是白的，或者直接段错误 (Segmentation Fault)？**
A: 这是 WebKit2GTK 与显卡驱动（尤其是 NVIDIA 或较旧的 Intel 集显）的兼容性问题。请务必确保设置了 `WEBKIT_DISABLE_COMPOSITING_MODE=1`。

**Q: 在 Wayland 下无法通过点击顶部拖动窗口？**
A: 由于 Wayland 的安全策略，无边框窗口 (`frameless=True`) 的自定义拖拽在某些合成器（如 GNOME/Hyprland）上可能失效。如果遇到此问题，建议在 `main.py` 中将 `frameless` 临时设为 `False`。
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

## 许可协议
本项目采用 GNU General Public License v3.0（GPL-3.0）开源，详见 `LICENSE` 文件。

