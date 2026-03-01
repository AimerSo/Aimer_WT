# 广告模块 (web/ads)

此文件夹专门存放广告系统资源。

## 文件夹用途
- campaigns_active: 当前正在运行的广告活动
- campaigns_scheduled: 计划中（有开始/结束时间）的未来广告活动
- campaigns_archived: 已结束或已禁用的广告活动
- placements: 广告展示位置（首页横幅、弹窗、侧边栏等）
- rotation_rules: 轮播/权重/频率/上限规则
- creative_assets: 图片/视频/文案及相关文件
- audience_rules: 定向条件及白名单/黑名单
- tracking: 点击/展示/转化事件映射
- configs: 全局广告开关及默认设置
- templates: 可复用的活动/版位模板
- _examples: 参考示例文件

## 命名规范
使用小写字母 + 下划线，不要使用空格，文件名中不要包含中文。

### 活动 ID (Campaign IDs)
campaign_<主题>_<年月日>_<渠道>
示例: campaign_spring_event_20260301_home

### 版位 ID (Placement IDs)
placement_<页面>_<位置>
示例: placement_home_top_banner

### 轮播规则 ID (Rotation Rule IDs)
rotation_<策略>_<范围>
示例: rotation_weighted_home

### 创意素材 ID (Creative Asset IDs)
creative_<活动>_<类型>_<尺寸>
示例: creative_spring_event_banner_1920x480

### 受众规则 ID (Audience Rule IDs)
audience_<维度>_<目标>
示例: audience_region_cn

### 追踪事件 ID (Tracking Event IDs)
event_<动作>_<版位>
示例: event_click_home_top_banner
