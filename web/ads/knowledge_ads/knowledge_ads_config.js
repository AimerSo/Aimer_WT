/**
 * 信息库广告位默认配置
 *
 * 功能定位: 为 4 个信息库广告卡片提供初始配置，运行时被心跳下发数据覆盖
 * 数据来源: 仪表盘管理页面编辑 → 服务端存储 → 心跳下发 → 覆盖此对象
 */
(function () {
    'use strict';
    window.AIMER_KNOWLEDGE_ADS_CONFIG = {
        items: [
            { id: "kb_ad_1", enabled: false, title: "", subtitle: "", avatar: "", background: "", url: "", action: "link", popup_content: "" },
            { id: "kb_ad_2", enabled: false, title: "", subtitle: "", avatar: "", background: "", url: "", action: "link", popup_content: "" },
            { id: "kb_ad_3", enabled: false, title: "", subtitle: "", avatar: "", background: "", url: "", action: "link", popup_content: "" },
            { id: "kb_ad_4", enabled: false, title: "", subtitle: "", avatar: "", background: "", url: "", action: "link", popup_content: "" }
        ]
    };
})();
