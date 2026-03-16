/* 仪表盘公告卡片实时预览模块 */
(function () {
    /* 类型元信息映射（与主软件 notice_data.js 保持一致） */
    var TYPE_META = {
        urgent: { tagClass: 'np-tag-urgent', icon: '⚠️' },
        update: { tagClass: 'np-tag-update', icon: '⚡' },
        event:  { tagClass: 'np-tag-event',  icon: '✨' },
        bonus:  { tagClass: 'np-tag-bonus',  icon: '🎁' },
        normal: { tagClass: 'np-tag-normal', icon: '📌' }
    };

    function esc(v) {
        var d = document.createElement('div');
        d.textContent = v == null ? '' : String(v);
        return d.innerHTML;
    }

    /* 将日期文本缩写为 M.D 格式 */
    function shortDate(dateStr) {
        if (!dateStr) return '';
        var s = String(dateStr).trim();
        if (s === '今天') {
            var d = new Date();
            return (d.getMonth() + 1) + '.' + d.getDate();
        }
        var m = s.match(/(\d{1,2})\s*月\s*(\d{1,2})/);
        if (m) return m[1] + '.' + m[2];
        m = s.match(/(\d{1,2})[\/\-.](\d{1,2})(?:[\/\-.]|$)/);
        if (m) return parseInt(m[1], 10) + '.' + parseInt(m[2], 10);
        return '';
    }

    /* 从 content 或 summary 提取纯文本预览 */
    function buildPreview(item) {
        var summary = String(item && item.summary ? item.summary : '').trim();
        if (summary) return summary;
        var content = String(item && item.content ? item.content : '');
        if (!content) return '';
        return content
            .replace(/\r\n?/g, '\n')
            .replace(/```[\s\S]*?```/g, ' ')
            .replace(/^#{1,6}\s+/gm, '')
            .replace(/^\s*[-*+]\s+/gm, '')
            .replace(/^\s*\d+\.\s+/gm, '')
            .replace(/^>\s?/gm, '')
            .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')
            .replace(/[`*_~]/g, '')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function getMeta(type) {
        return TYPE_META[type] || TYPE_META.normal;
    }

    /**
     * 渲染公告卡片预览
     * @param {HTMLElement} container - 预览容器
     * @param {Array} items - 公告列表（后端格式，字段为 is_pinned）
     */
    function renderPreview(container, items) {
        if (!container) return;
        if (!items || !items.length) {
            container.innerHTML = '<div class="notice-preview-wrap"><div class="np-empty">' +
                '<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>' +
                '<span>暂无公告数据</span><span style="font-size:10px;opacity:0.6;">新建公告后将在此实时预览</span></div></div>';
            return;
        }

        var pinned = items.find(function(x) { return x.is_pinned; }) || items[0];
        var others = items.filter(function(x) { return x.id !== pinned.id; });
        var pm = getMeta(pinned.type);
        var preview = buildPreview(pinned);

        var listHtml = others.map(function(item) {
            var meta = getMeta(item.type);
            var sd = shortDate(item.date);
            return '<div class="np-item">' +
                '<div class="np-item-main">' +
                '<span class="np-tag ' + esc(meta.tagClass) + '">' + esc(item.tag || item.type) + '</span>' +
                '<span class="np-item-title">' + esc(item.title) + '</span>' +
                '</div>' +
                (sd ? '<span class="np-item-date">' + esc(sd) + '</span>' : '') +
                '<span class="np-item-arrow">›</span>' +
                '</div>';
        }).join('');

        container.innerHTML = '<div class="notice-preview-wrap">' +
            '<div class="np-hero">' +
            '<div class="np-hero-deco">' + pm.icon + '</div>' +
            '<div class="np-hero-top">' +
            '<span class="np-hero-pin">📌 置顶公告</span>' +
            '<span class="np-hero-date">' + esc(pinned.date || '') + '</span>' +
            '</div>' +
            '<div class="np-hero-title">' + esc(pinned.title) + '</div>' +
            (preview ? '<div class="np-hero-desc">' + esc(preview) + '</div>' : '') +
            '</div>' +
            '<div class="np-section"><span>往期动态</span><span class="np-section-line"></span></div>' +
            '<div class="np-history">' + (listHtml || '<div style="text-align:center;color:var(--np-text-muted);font-size:11px;padding:12px 0;">暂无更多公告</div>') + '</div>' +
            '<div class="np-footer"><span class="np-footer-dot"></span><span>预览模式 · 模拟客户端显示效果</span></div>' +
            '</div>';
    }

    window.NoticePreviewModule = {
        renderPreview: renderPreview
    };
})();
