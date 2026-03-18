/**
 * UTM 参数拼接与广告点击上报工具
 *
 * 功能定位:
 * - 为所有外部广告链接自动追加 UTM 查询参数，便于广告商在第三方统计平台识别来源流量
 * - 向遥测服务器异步上报点击事件，供 Dashboard 广告统计页面使用
 *
 * 数据来源:
 * - 遥测服务地址: window._aimerTelemetryBase（由 Python 端注入）
 * - 用户标识: window._aimerMachineId（由 Python 端注入）
 */
(function () {
    'use strict';

    /**
     * 为外部链接拼接 UTM 追踪参数
     * @param {string} url     原始链接
     * @param {string} medium  广告位类型: carousel / header_banner / notice
     * @param {string} [content] 素材标识，如广告 id 或 banner 文字摘要
     * @returns {string} 拼好 UTM 的完整链接
     */
    function appendUtm(url, medium, content) {
        if (!url || url === '#') return url;
        try {
            var u = new URL(url);
            u.searchParams.set('utm_source', 'aimerWT');
            u.searchParams.set('utm_medium', medium || 'unknown');
            if (!u.searchParams.has('utm_campaign')) {
                u.searchParams.set('utm_campaign', content || 'default');
            }
            if (content) {
                u.searchParams.set('utm_content', content);
            }
            return u.toString();
        } catch (e) {
            return url;
        }
    }

    /**
     * 异步上报广告点击事件到遥测服务器
     * @param {string} medium    广告位类型
     * @param {string} adId      广告素材 ID
     * @param {string} targetUrl 目标链接
     */
    function reportClick(medium, adId, targetUrl) {
        var base = window._aimerTelemetryBase;
        if (!base) return;

        var endpoint = base.replace(/\/+$/, '') + '/telemetry/ad-click';
        var machineId = window._aimerMachineId || '';

        try {
            var xhr = new XMLHttpRequest();
            xhr.open('POST', endpoint, true);
            xhr.setRequestHeader('Content-Type', 'application/json');
            xhr.send(JSON.stringify({
                machine_id: machineId,
                ad_medium: medium || '',
                ad_id: adId || '',
                target_url: targetUrl || ''
            }));
        } catch (e) {
            // 上报失败不影响跳转
        }
    }

    window.AimerUtm = {
        appendUtm: appendUtm,
        reportClick: reportClick
    };
})();
