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