# AimerWT Dashboard 重构说明

## 重构概述

本次重构将原有的单文件 `dashboard.html`（约2500行）拆分为模块化结构，提高代码可维护性和可扩展性。

## 文件结构

```
dashboard/
├── index.html              # 主框架入口
├── css/
│   └── base.css            # 基础样式、布局、组件样式
├── js/
│   └── app.js              # 核心应用逻辑、路由、API通信
├── views/                  # 视图页面（8个独立文件）
│   ├── dashboard.html      # 主页（数据总览、图表）
│   ├── control.html        # 操控（维护模式、通知发布）
│   ├── advertisement.html  # 广告管理
│   ├── ai-assistant.html   # AI助手
│   ├── userlist.html       # 用户列表
│   ├── userdetail.html     # 用户详情
│   ├── analysis.html       # 数据分析
│   └── settings.html       # 系统设置
└── README.md               # 本文档
```

## 各文件职责

### index.html
- **作用**: 应用主框架，包含侧边栏导航和全局容器
- **特点**: 只加载一次，视图内容动态替换
- **包含**: 侧边栏菜单、模态框、抽屉、全局脚本引用

### css/base.css
- **作用**: 全局样式定义
- **内容**: CSS变量、动画、布局、组件样式、响应式设计
- **特点**: 所有视图共享同一套样式，避免重复

### js/app.js
- **作用**: 核心应用逻辑
- **主要功能**:
  - 路由管理（视图切换）
  - API通信（数据获取）
  - 图表渲染（ECharts）
  - 状态管理（全局状态）
  - 工具函数（日期格式化、防抖等）
- **全局对象**: `app` - 可在视图中直接调用

### views/*.html
- **作用**: 各页面视图内容
- **特点**: 
  - 纯HTML片段，不含完整文档结构
  - 通过 `fetch()` 动态加载到主框架
  - 可包含内联 `<style>` 定义视图特有样式
  - 通过 `app` 对象调用全局功能

## 工作流程

1. **初始化**: `index.html` 加载 → `app.js` 初始化 → 默认加载 `dashboard` 视图
2. **视图切换**: 点击菜单 → `app.switchView()` → fetch加载视图文件 → 插入主容器 → 执行视图初始化
3. **数据获取**: `app.fetchData()` → 调用后端API → 更新全局状态 → 渲染图表和数据

## 后端接口

重构不影响后端接口，所有API调用保持不变：
- `GET /admin/stats` - 获取统计数据
- `POST /admin/control` - 控制操作
- 其他接口...

## 访问方式

重构后访问地址：
```
http://localhost:8081/dashboard/index.html
```

旧文件保留为备份：
```
http://localhost:8081/dashboard.html  # 旧版本
```

## 开发指南

### 新增视图
1. 在 `views/` 目录创建新的HTML文件
2. 在 `index.html` 侧边栏添加菜单项
3. 在 `app.js` 的 `initView()` 中添加视图初始化逻辑

### 修改样式
- 全局样式修改 `css/base.css`
- 视图特有样式可在视图文件内使用 `<style>` 标签

### 添加功能
- 通用功能添加到 `app.js` 的 `app` 对象
- 视图特定功能写在视图文件内的 `<script>` 标签

## 注意事项

1. **视图文件** 不要包含 `<html>`, `<head>`, `<body>` 标签
2. **相对路径**: 视图中的资源引用使用相对 `index.html` 的路径
3. **全局变量**: `app`, `echarts` 可直接使用
4. **事件处理**: 使用 `onclick="app.xxx()"` 绑定事件

## 兼容性

- 现代浏览器（Chrome, Firefox, Edge, Safari）
- 需要支持 ES6+ 和 Fetch API
- 使用原生 JavaScript，无框架依赖
