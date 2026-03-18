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

    /**
     * 渲染公告内容的 Markdown 详情预览
     * @param {HTMLElement} container - 预览容器
     * @param {Object} item - 当前编辑中的公告对象
     */
    function renderContentPreview(container, item) {
        if (!container) return;
        if (!item || !item.content) {
            container.innerHTML = '<div style="text-align:center;color:var(--text-muted,#9ca3af);padding:40px 16px;font-size:12px;">' +
                '<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="opacity:0.25;margin-bottom:8px;">' +
                '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>' +
                '<polyline points="14 2 14 8 20 8"></polyline></svg>' +
                '<div>在编辑区输入 Markdown 内容后</div><div>预览将实时显示在此处</div></div>';
            return;
        }
        var html = '';
        if (window.MarkdownRenderer) {
            html = window.MarkdownRenderer.render(item.content);
        } else {
            html = '<p>' + esc(item.content) + '</p>';
        }
        container.innerHTML = '<div class="md-content" style="padding:4px 0;">' + html + '</div>';
    }

    /**
     * 复用客户端模板逻辑，渲染"客户端效果"预览
     * 根据公告类型自动选择 update / general 渲染方式
     */
    function renderClientPreview(container, item) {
        if (!container) return;
        if (!item || !item.content) {
            container.innerHTML = '<div style="text-align:center;color:var(--text-muted,#9ca3af);padding:40px 16px;font-size:12px;">' +
                '<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="opacity:0.25;margin-bottom:8px;">' +
                '<rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect>' +
                '<line x1="8" y1="21" x2="16" y2="21"></line>' +
                '<line x1="12" y1="17" x2="12" y2="21"></line></svg>' +
                '<div>在编辑区输入内容后</div><div>客户端效果预览将显示在此处</div></div>';
            return;
        }

        var MR = window.MarkdownRenderer || {};
        var isUpdate = (item.type === 'update') ||
            /更新日志|版本更新|changelog/i.test(item.title || '');
        var html = '';

        if (isUpdate) {
            html = _renderUpdatePreview(item, MR);
        } else {
            html = _renderGeneralPreview(item, MR);
        }
        container.innerHTML = html;
    }

    /* 更新日志模板预览（分节 + 图标 + 时间线） */
    function _renderUpdatePreview(item, MR) {
        var parseChangelog = MR.parseChangelog || function (md) {
            return { title: '更新日志', version: 'Latest', sections: [] };
        };
        var escH = MR.escapeHtml || esc;
        var parseLog = MR.parseLogTextHtml || function (t) { return escH(t); };

        var data = parseChangelog(item.content || '');
        var title = data.title || item.title || '更新日志';
        var version = data.version || 'Latest';
        var intro = item.summary || '';

        var sectionsHtml = (data.sections || []).map(function (section) {
            var colorClass = section.color === 'blue' ? 'notice-react-sec-blue'
                : section.color === 'green' ? 'notice-react-sec-green'
                    : section.color === 'red' ? 'notice-react-sec-red'
                        : 'notice-react-sec-gray';

            var itemsHtml = (section.items || []).map(function (line) {
                return '<li class="notice-react-item">' +
                    '<div class="notice-react-item-dot"></div>' +
                    '<div class="notice-react-item-text">' + parseLog(line) + '</div>' +
                    '</li>';
            }).join('');

            return '<section class="notice-react-section">' +
                '<div class="notice-react-sec-head">' +
                '<div class="notice-react-sec-icon ' + colorClass + '"><i class="' + escH(section.icon) + '"></i></div>' +
                '<h3>' + escH(section.title) + '</h3>' +
                '</div>' +
                '<ul class="notice-react-list">' + itemsHtml + '</ul>' +
                '</section>';
        }).join('');

        var bodyHtml = sectionsHtml || '<div style="padding:12px;color:var(--text-muted);font-size:12px;">（无有效日志节，请使用 ## 节名 + - 列表项 格式）</div>';

        return '<div class="notice-react-update-modal" style="border-radius:14px;overflow:hidden;border:1px solid var(--border);background:var(--card-bg,#fff);">' +
            '<div class="notice-react-header">' +
            '<div>' +
            '<h2 class="notice-react-title">' + escH(title) + '</h2>' +
            '<div class="notice-react-subline">' +
            '<span class="notice-react-pulse"></span>' +
            '<span>' + escH(version) + '</span>' +
            '</div>' +
            (intro ? '<p class="notice-react-intro">' + escH(intro) + '</p>' : '') +
            '</div>' +
            '</div>' +
            '<div class="notice-react-content" style="max-height:380px;overflow-y:auto;">' + bodyHtml + '</div>' +
            '<div class="notice-react-footer"><p>Aimer WT • 预览模式</p></div>' +
            '</div>';
    }

    /* 通用公告模板预览（文章样式） */
    function _renderGeneralPreview(item, MR) {
        var parseArticle = MR.parseArticleMarkdown || function (md, ft) {
            return { title: ft || '公告详情', date: '', content: [{ type: 'paragraph', text: md }] };
        };
        var escH = MR.escapeHtml || esc;
        var renderInline = MR.renderInline || function (t) { return escH(t); };

        var data = parseArticle(item.content || '', item.title || '公告详情');

        var blocksHtml = (data.content || []).map(function (block) {
            if (!block) return '';
            if (block.type === 'h2') {
                return '<h4 class="notice-article-h2"><span class="notice-article-h2-bar"></span>' + renderInline(block.text) + '</h4>';
            }
            if (block.type === 'quote') {
                return '<div class="notice-article-quote"><i class="ri-information-line"></i><div>' + renderInline(block.text) + '</div></div>';
            }
            if (block.type === 'list') {
                var items = (block.items || []).map(function (x) { return '<li>' + renderInline(x) + '</li>'; }).join('');
                return '<ul class="notice-article-list">' + items + '</ul>';
            }
            return '<p class="notice-article-p">' + renderInline(block.text) + '</p>';
        }).join('');

        return '<div class="notice-article-modal" style="border-radius:14px;overflow:hidden;border:1px solid var(--border);background:var(--card-bg,#fff);">' +
            '<div class="notice-article-header">' +
            '<div class="notice-article-head-left">' +
            '<div class="notice-article-bell"><i class="ri-notification-3-line"></i></div>' +
            '<div>' +
            '<h3 class="notice-article-title">' + escH(data.title || '公告详情') + '</h3>' +
            '<div class="notice-article-date">Release Date: ' + escH(item.date || data.date || '') + '</div>' +
            '</div>' +
            '</div>' +
            '</div>' +
            '<div class="notice-article-content" style="max-height:380px;overflow-y:auto;">' + blocksHtml + '</div>' +
            '<div class="notice-article-footer"><p>Aimer WT • 预览模式</p></div>' +
            '</div>';
    }

    window.NoticePreviewModule = {
        renderPreview: renderPreview,
        renderContentPreview: renderContentPreview,
        renderClientPreview: renderClientPreview
    };
})();
