/* 仪表盘公告卡片实时预览模块 */
(function () {
    /* 预选表情列表 */
    var EMOJI_PALETTE = ['👍','❤️','😄','😮','🎉','🔥','😢','👀','👎','🤔','💯','🙏','✨','😂','🤣','😍','🥺','💀','😎','🫡'];

    /* 预览模式模拟反应数据 */
    var MOCK_REACTIONS = [
        { emoji: '👍', count: 12, users: ['a1b2c3..', 'd4e5f6..', '789abc..'], reacted: true },
        { emoji: '🎉', count: 5, users: ['d4e5f6..', 'ff0011..'], reacted: false },
        { emoji: '🔥', count: 3, users: ['789abc..'], reacted: false }
    ];

    /* 生成反应栏 HTML */
    function _buildReactionBarHtml(reactions) {
        if (!reactions) reactions = MOCK_REACTIONS;
        var pills = reactions.map(function(r) {
            var tooltip = r.emoji + ' ' + (r.users || []).join('、');
            return '<div class="notice-reaction-pill' + (r.reacted ? ' active' : '') + '">' +
                '<span class="notice-reaction-tooltip">' + esc(tooltip) + '</span>' +
                '<span class="reaction-emoji">' + r.emoji + '</span>' +
                '<span class="reaction-count">' + r.count + '</span>' +
                '</div>';
        }).join('');

        var pickerItems = EMOJI_PALETTE.map(function(e) {
            return '<span class="notice-reaction-picker-item">' + e + '</span>';
        }).join('');

        return '<div class="notice-reaction-bar-wrap">' +
            '<div class="notice-reaction-bar">' +
            pills +
            '<button class="notice-reaction-add-btn" onclick="NoticePreviewModule._togglePicker(this)" title="添加表情">😀</button>' +
            '<div class="notice-reaction-picker">' + pickerItems + '</div>' +
            '</div>' +
            '</div>';
    }
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

    function parseNoticeDateParts(dateStr) {
        if (!dateStr) return null;
        var s = String(dateStr).trim();
        var match = null;

        if (!s) return null;
        if (s === '今天') {
            var today = new Date();
            return { month: today.getMonth() + 1, day: today.getDate() };
        }

        match = s.match(/^(\d{4})(\d{2})(\d{2})$/);
        if (match) {
            return { month: parseInt(match[2], 10), day: parseInt(match[3], 10) };
        }

        match = s.match(/^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})(?:\s+.*)?$/);
        if (match) {
            return { month: parseInt(match[2], 10), day: parseInt(match[3], 10) };
        }

        match = s.match(/^(\d{4})年\s*(\d{1,2})月\s*(\d{1,2})日?$/);
        if (match) {
            return { month: parseInt(match[2], 10), day: parseInt(match[3], 10) };
        }

        match = s.match(/^(\d{1,2})月\s*(\d{1,2})日?$/);
        if (match) {
            return { month: parseInt(match[1], 10), day: parseInt(match[2], 10) };
        }

        match = s.match(/^(\d{1,2})[\/\-.](\d{1,2})$/);
        if (match) {
            return { month: parseInt(match[1], 10), day: parseInt(match[2], 10) };
        }

        return null;
    }

    /* 将日期文本缩写为 M.D 格式 */
    function shortDate(dateStr) {
        var parts = parseNoticeDateParts(dateStr);
        return parts ? (parts.month + '.' + parts.day) : '';
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
        var decoIcon = pinned.icon_class || pm.icon;

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
            '<div class="np-hero-deco">' + (decoIcon.startsWith('ri-') ? '<i class="' + esc(decoIcon) + '"></i>' : decoIcon) + '</div>' +
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
     * 复用客户端模板，渲染"客户端效果"预览
     * 直接调用主软件的 NoticeUpdateTemplate / NoticeGeneralTemplate
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

        // 构造辅助函数对象（与主软件 notice_modal.js 一致）
        var helpers = {
            escapeHtml: MR.escapeHtml || esc,
            parseMarkdown: MR.parseChangelog || function(md) { return { title: '更新日志', version: 'Latest', sections: [] }; },
            parseLogTextHtml: MR.parseLogTextHtml || function(t) { return esc(t); },
            renderMarkdownSafe: MR.render || function(t) { return t; },
            parseArticleMarkdown: MR.parseArticleMarkdown || function(md, ft) { return { title: ft || '公告详情', date: '', content: [{ type: 'paragraph', text: md }] }; },
            renderInlineBasic: MR.renderInline || function(t) { return esc(t); },
            buildReactionBarHtml: function() { return _buildReactionBarHtml(); }
        };

        var html = '';
        if (isUpdate && window.NoticeUpdateTemplate) {
            html = window.NoticeUpdateTemplate.render(item, helpers);
        } else if (window.NoticeGeneralTemplate) {
            html = window.NoticeGeneralTemplate.render(item, helpers);
        } else {
            // 模板未加载时的降级处理
            html = '<div style="padding:20px;color:var(--text-muted);font-size:12px;text-align:center;">模板组件未加载</div>';
        }

        // 限宽容器包裹，模拟弹窗效果
        container.innerHTML = '<div class="np-client-wrap">' + html + '</div>';

        // 初始化评论面板（离线占位）
        var ncPanel = container.querySelector('.nc-panel[data-nc-notice-id]');
        if (ncPanel && window.NoticeCommentPanel) {
            window.NoticeCommentPanel.renderPanel(item.id || 'preview', ncPanel);
        }
    }

    /* 切换表情选择浮层 */
    function _togglePicker(btn) {
        var picker = btn.parentElement.querySelector('.notice-reaction-picker');
        if (!picker) return;
        var isOpen = picker.classList.contains('show');
        // 先关闭所有已打开的 picker
        document.querySelectorAll('.notice-reaction-picker.show').forEach(function(p) { p.classList.remove('show'); });
        if (!isOpen) {
            picker.classList.add('show');
            // 点击其他地方关闭
            setTimeout(function() {
                function closePicker(e) {
                    if (!picker.contains(e.target) && e.target !== btn) {
                        picker.classList.remove('show');
                        document.removeEventListener('click', closePicker);
                    }
                }
                document.addEventListener('click', closePicker);
            }, 0);
        }
    }

    window.NoticePreviewModule = {
        renderPreview: renderPreview,
        renderContentPreview: renderContentPreview,
        renderClientPreview: renderClientPreview,
        _togglePicker: _togglePicker
    };
})();
