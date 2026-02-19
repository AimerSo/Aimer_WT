# Aimer UI 3.0 主题设计手册

> **致设计师**：
> 欢迎来到 Aimer 战雷语音盒子的视觉世界。本软件采用基于 CSS 变量 (CSS Variables) 的动态主题引擎。你不需要写一行代码，只需在一个 `.json` 文件中定义色彩，即可重塑整个软件的视觉灵魂。
> 本文档旨在涵盖每一个像素的颜色定义，确保你拥有 100% 的掌控权。

---

## 📖 1. 核心架构与文件规范

### 1.1 文件格式
- 所有主题必须保存为 `.json` 格式，编码为 `UTF-8`。
- 建议文件名为英文小写，例如 `cyberpunk_2077.json`。

### 1.2 存放位置
请将你的主题文件放入软件根目录下的 `web/themes/` 文件夹中。重启软件即可在设置中看到。

### 1.3 双色板机制 (Dual-Palette System)
Aimer UI 原生支持 **明亮 (Light)** 和 **深色 (Dark)** 两种模式。为了提供最佳体验，你的主题文件应包含两套色板。

**标准结构示例：**
```json
{
    "meta": {
        "name": "主题名称 (显示在UI上)",
        "author": "设计师昵称",
        "version": "1.0"
    },
    "colors": {
        "//_说明": "这里定义的变量会同时应用在明亮和深色模式，除非被特定的模式覆盖",
        "--primary": "#FF9900" 
    },
    "light": {
        "//_明亮模式": "当用户切换到白天模式时，这里的变量生效",
        "--bg-body": "#FFFFFF",
        "--text-main": "#333333"
    },
    "dark": {
        "//_深色模式": "当用户切换到夜间模式时，这里的变量生效",
        "--bg-body": "#18181B",
        "--text-main": "#F4F4F5"
    }
}
```

---

## 🎨 2. 界面解构 (Anatomy of UI)

在开始配色前，请先理解软件的三大核心层级：
1. **底层 (Canvas)**: 软件的物理背景，承载所有内容。
2. **浮层 (Surface)**: 漂浮在底层之上的卡片、导航栏、输入框。
3. **内容 (Content)**: 文字、图标、按钮。

---

## 📚 3. 全局变量字典 (The Complete Dictionary)

以下是 Aimer UI 所有的可配置变量。请勿修改变量名 (Key)，仅修改颜色值 (Value)。

### A. 品牌与基调 (Brand & Foundation)
决定主题的第一印象。

| 变量名 (Key) | 描述 (Description) | 设计建议 (Design Tips) |
| :--- | :--- | :--- |
| `--primary` | 主品牌色 | 用于主要按钮、选中状态、高亮边框。务必醒目。 |
| `--primary-hover` | 主色悬停态 | 鼠标悬停在主按钮上时的颜色。比主色稍亮或稍暗。 |
| `--bg-body` | 应用背景 | 软件的最底层颜色。深色模式推荐使用深灰 (#121212)。 |
| `--bg-card` | 卡片背景 | 承载内容的容器背景色。必须与应用背景有区分度。 |
| `--border-color` | 全局边框色 | 用于分割线、卡片描边。建议使用低透明度颜色。 |

### B. 文字排版 (Typography)
信息传达的核心。

| 变量名 (Key) | 描述 (Description) | 设计建议 (Design Tips) |
| :--- | :--- | :--- |
| `--text-main` | 主要文字 | 标题、正文。需与背景形成 7:1 以上的对比度。 |
| `--text-sec` | 次要文字 | 注释、辅助说明。降低透明度以弱化视觉干扰。 |

### C. 导航系统 (Navigation)
位于顶部的功能切换区域。

| 变量名 (Key) | 描述 (Description) |
| :--- | :--- |
| `--nav-bg` | 导航栏背景。通常与卡片背景一致或透明。 |
| `--nav-item-text` | 未选中的导航按钮图标/文字颜色。通常使用 `--text-sec`。 |
| `--nav-item-hover-bg` | 鼠标悬停时的背景块颜色。建议使用极淡的透明色。 |
| `--nav-item-active` | 当前激活页面的图标/文字颜色。通常使用 `--primary`。 |
| `--nav-item-active-bg` | 当前激活页面的背景块颜色。建议 `rgba(主色, 0.1)`。 |

### D. 语音包卡片 (Mod Card)
展示在“语音包库”中的每一个项目卡片。

| 变量名 (Key) | 描述 (Description) |
| :--- | :--- |
| `--mod-card-title` | 卡片标题。语音包的名字颜色。 |
| `--mod-ver-bg` | 版本号胶囊背景。位于右上角的小方块背景。 |
| `--mod-ver-text` | 版本号文字颜色。 |
| `--mod-author-text` | 作者栏文字颜色。 |

### E. 标签系统 (Tags)
用于区分“坦克”、“飞机”等类型的胶囊标签。

> **建议**：采用 [深底+浅字] 或 [浅底+深字] 搭配。

- **坦克 (Tank)**: `--tag-tank-bg` (底) / `--tag-tank-text` (字)
- **空军 (Air)**: `--tag-air-bg` (底) / `--tag-air-text` (字)
- **海战 (Naval)**: `--tag-naval-bg` (底) / `--tag-naval-text` (字)
- **无线电 (Radio)**: `--tag-radio-bg` (底) / `--tag-radio-text` (字)

### F. 交互与操作 (Actions & Links)
按钮与外部链接的反馈颜色。

| 变量名 (Key) | 描述 (Description) |
| :--- | :--- |
| `--action-trash` | 删除图标默认色。 |
| `--action-trash-hover` | 删除图标悬停背景色。强烈建议使用红色/警示色。 |
| `--action-refresh` | 刷新图标默认色。 |
| `--action-refresh-bg` | 刷新图标悬停背景色。 |
| `--link-bili-normal` | Bilibili 图标默认色。 |
| `--link-bili-hover` | Bilibili 图标悬停背景色。 |
| `--link-wt-normal` | WT Live 图标默认色。 |
| `--link-wt-hover` | WT Live 图标悬停背景色。 |
| `--link-vid-normal` | 视频图标默认色。 |
| `--link-vid-hover` | 视频图标悬停背景色。 |

### G. 状态指示 (Status Indicators)
首页的“连接状态”指示灯。

| 变量名 (Key) | 描述 (Description) |
| :--- | :--- |
| `--status-waiting` | 等待中。通常为黄色/橙色。 |
| `--status-success` | 成功/就绪。通常为绿色。 |
| `--status-error` | 错误/失败。通常为红色。 |
| `--status-icon-def` | 图标默认色。未触发任何状态时的灰色。 |

### H. 运行日志颜色 (Log Colors)
首页运行日志的各类消息颜色。

| 变量名 (Key) | 描述 (Description) |
| :--- | :--- |
| `--log-info` | 信息日志颜色。通常为蓝色。 |
| `--log-success` | 成功日志颜色。通常为绿色。 |
| `--log-error` | 错误日志颜色。通常为红色。 |
| `--log-warn` | 警告日志颜色。通常为橙色。 |
| `--log-sys` | 系统日志颜色。通常为灰色。 |
| `--log-scan` | 扫描日志颜色。默认使用主色调。 |

### I. 控件与细节 (Controls & Details)
往往被忽略但至关重要的细节。

| 变量名 (Key) | 描述 (Description) |
| :--- | :--- |
| `--input-bg` | 输入框背景。 |
| `--input-border` | 输入框边框。 |
| `--switch-bg` | 开关按钮背景。 |
| `--scrollbar-thumb` | 滚动条滑块颜色。建议使用半透明颜色。 |

---

## �️ 4. 进阶：调试你的主题

1. **实时预览**: 修改 `web/themes/` 下的 JSON 文件并保存。
2. **刷新界面**: 在软件内切换一次主题，或者按下 `Ctrl + R` (如果启用了开发模式) 即可看到更改。
3. **颜色格式**: 支持 `HEX` (#FFFFFF), `RGB` (255,255,255), `RGBA` (255,255,255,0.5)。

---

## 🚀 5. 分享你的杰作

如果你设计了精美的主题，欢迎提交 Pull Request 或在社区中分享！
