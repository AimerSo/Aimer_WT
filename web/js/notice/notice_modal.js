/* 公告详情弹窗模块：按类型调用独立模板 */
(function () {
    const MODAL_ID = 'modal-notice-detail';
    const CLOSE_ANIMATION_MS = 240;

    function escapeHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function sanitizeUrl(url) {
        const raw = String(url || '').trim();
        if (!raw) return '';
        if (/^(https?:|mailto:)/i.test(raw)) return raw;
        return '';
    }

    function renderInlineBasic(text) {
        if (window.MarkdownRenderer) return window.MarkdownRenderer.renderInline(text);
        let html = escapeHtml(text);
        html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
        html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
        html = html.replace(/(^|[^\*])\*([^*]+)\*(?!\*)/g, '$1<em>$2</em>');
        html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, function (_, label, href) {
            const safeHref = sanitizeUrl(href);
            if (!safeHref) return label;
            return '<a href="' + escapeHtml(safeHref) + '" target="_blank" rel="noopener noreferrer">' + label + '</a>';
        });
        return html;
    }

    function parseLogTextHtml(text) {
        if (window.MarkdownRenderer) return window.MarkdownRenderer.parseLogTextHtml(text);
        const safeText = escapeHtml(String(text || ''));
        const parts = safeText.split(/(（.*?）)/g);
        return parts.map((part) => {
            if (part.startsWith('（') && part.endsWith('）')) {
                const innerText = part.slice(1, -1);
                const tokens = innerText.split(/(@[a-zA-Z0-9_]+|#[0-9]+)/g);
                const tokenHtml = tokens.map((token) => {
                    if (!token) return '';
                    if (token.startsWith('@') || token.startsWith('#')) {
                        return '<span class="notice-react-token">' + token + '</span>';
                    }
                    return token;
                }).join('');
                return '<span class="notice-react-inline-meta">（' + tokenHtml + '）</span>';
            }
            return part;
        }).join('');
    }

    function parseMarkdown(md) {
        if (window.MarkdownRenderer) return window.MarkdownRenderer.parseChangelog(md);
        const lines = String(md || '').split('\n');
        const data = { title: '更新日志', version: 'Latest', sections: [] };
        let currentSection = null;

        lines.forEach((line) => {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('---') || trimmed.startsWith('***')) return;

            if (trimmed.startsWith('# ')) {
                data.title = trimmed.substring(2).trim() || data.title;
                const vMatch = data.title.match(/[Vv]\d+(\.\d+)*/i);
                if (vMatch) data.version = vMatch[0].toUpperCase();
            } else if (trimmed.startsWith('## ')) {
                if (currentSection) data.sections.push(currentSection);
                const secTitle = trimmed.substring(3).trim();
                let typeData = { icon: 'ri-rocket-line', color: 'gray' };
                if (secTitle.indexOf('优化') >= 0) typeData = { icon: 'ri-tools-line', color: 'blue' };
                else if (secTitle.indexOf('新增') >= 0) typeData = { icon: 'ri-add-circle-line', color: 'green' };
                else if (secTitle.indexOf('修复') >= 0) typeData = { icon: 'ri-bug-line', color: 'red' };
                currentSection = { title: secTitle, icon: typeData.icon, color: typeData.color, items: [] };
            } else if (trimmed.startsWith('* ') || trimmed.startsWith('- ')) {
                if (currentSection) currentSection.items.push(trimmed.substring(2).trim());
            }
        });

        if (currentSection) data.sections.push(currentSection);
        return data;
    }

    function parseArticleMarkdown(md, fallbackTitle) {
        if (window.MarkdownRenderer) return window.MarkdownRenderer.parseArticleMarkdown(md, fallbackTitle);
        const blocks = String(md || '').split(/\n{2,}/);
        const data = {
            title: fallbackTitle || '日常公告',
            date: new Date().toLocaleDateString(),
            content: []
        };

        blocks.forEach((block) => {
            const text = block.trim();
            if (!text || text.startsWith('---')) return;

            if (text.startsWith('# ')) {
                data.title = text.substring(2).trim() || data.title;
                return;
            }
            if (text.startsWith('## ')) {
                data.content.push({ type: 'h2', text: text.substring(3).trim() });
                return;
            }
            if (text.startsWith('> ')) {
                const quoteText = text.split('\n').map((l) => l.replace(/^>\s*/, '').trim()).join('\n');
                data.content.push({ type: 'quote', text: quoteText });
                return;
            }
            if (text.startsWith('* ') || text.startsWith('- ')) {
                const items = text.split('\n').map((l) => l.replace(/^[-*]\s/, '').trim()).filter(Boolean);
                data.content.push({ type: 'list', items: items });
                return;
            }
            data.content.push({ type: 'paragraph', text: text });
        });

        if (!data.content.length && md) {
            data.content.push({ type: 'paragraph', text: String(md) });
        }
        return data;
    }

    function flushParagraph(lines, output) {
        if (!lines.length) return;
        output.push('<p>' + lines.map((line) => renderInlineBasic(line)).join('<br>') + '</p>');
        lines.length = 0;
    }

    function renderMarkdownSafe(markdownText) {
        if (window.MarkdownRenderer) return window.MarkdownRenderer.render(markdownText);
        const src = String(markdownText == null ? '' : markdownText).replace(/\r\n?/g, '\n');
        const lines = src.split('\n');
        const out = [];
        const paragraph = [];
        let inCode = false;
        let codeBuffer = [];
        let inUl = false;
        let inOl = false;

        function closeLists() {
            if (inUl) {
                out.push('</ul>');
                inUl = false;
            }
            if (inOl) {
                out.push('</ol>');
                inOl = false;
            }
        }

        lines.forEach((line) => {
            if (/^\s*```/.test(line)) {
                flushParagraph(paragraph, out);
                closeLists();
                if (inCode) {
                    out.push('<pre><code>' + escapeHtml(codeBuffer.join('\n')) + '</code></pre>');
                    codeBuffer = [];
                    inCode = false;
                } else {
                    inCode = true;
                }
                return;
            }

            if (inCode) {
                codeBuffer.push(line);
                return;
            }

            if (/^\s*$/.test(line)) {
                flushParagraph(paragraph, out);
                closeLists();
                return;
            }

            const h = line.match(/^\s*(#{1,6})\s+(.+?)\s*$/);
            if (h) {
                flushParagraph(paragraph, out);
                closeLists();
                const level = Math.min(h[1].length, 6);
                out.push('<h' + level + '>' + renderInlineBasic(h[2]) + '</h' + level + '>');
                return;
            }

            const blockQuote = line.match(/^\s*>\s?(.*)$/);
            if (blockQuote) {
                flushParagraph(paragraph, out);
                closeLists();
                out.push('<blockquote>' + renderInlineBasic(blockQuote[1]) + '</blockquote>');
                return;
            }

            const ul = line.match(/^\s*[-*+]\s+(.+)$/);
            if (ul) {
                flushParagraph(paragraph, out);
                if (inOl) {
                    out.push('</ol>');
                    inOl = false;
                }
                if (!inUl) {
                    out.push('<ul>');
                    inUl = true;
                }
                out.push('<li>' + renderInlineBasic(ul[1]) + '</li>');
                return;
            }

            const ol = line.match(/^\s*\d+\.\s+(.+)$/);
            if (ol) {
                flushParagraph(paragraph, out);
                if (inUl) {
                    out.push('</ul>');
                    inUl = false;
                }
                if (!inOl) {
                    out.push('<ol>');
                    inOl = true;
                }
                out.push('<li>' + renderInlineBasic(ol[1]) + '</li>');
                return;
            }

            closeLists();
            paragraph.push(line);
        });

        if (inCode) out.push('<pre><code>' + escapeHtml(codeBuffer.join('\n')) + '</code></pre>');
        flushParagraph(paragraph, out);
        if (inUl) out.push('</ul>');
        if (inOl) out.push('</ol>');

        return out.join('');
    }

    function ensureModal() {
        let overlay = document.getElementById(MODAL_ID);
        if (overlay) return overlay;

        overlay = document.createElement('div');
        overlay.id = MODAL_ID;
        overlay.className = 'modal-overlay notice-detail-overlay';
        overlay.innerHTML = '<div id="notice-detail-shell" class="notice-detail-shell"></div>';
        document.body.appendChild(overlay);

        overlay.addEventListener('click', (e) => {
            if (!e.target.closest('.notice-detail-modal')) closeNoticeDetail();
        });

        return overlay;
    }

    function closeNoticeDetail() {
        const overlay = document.getElementById(MODAL_ID);
        if (!overlay || !overlay.classList.contains('show') || overlay.classList.contains('hiding')) return;

        overlay.classList.remove('entered');
        overlay.classList.add('hiding');

        const finalize = () => {
            if (!overlay.classList.contains('hiding')) return;
            overlay.classList.remove('show');
            overlay.classList.remove('hiding');
        };

        overlay.addEventListener('animationend', finalize, { once: true });
        setTimeout(finalize, CLOSE_ANIMATION_MS);
    }

    function bindCloseButtons(overlay) {
        const closeButtons = overlay.querySelectorAll('[data-notice-close="1"]');
        closeButtons.forEach((btn) => {
            btn.addEventListener('click', closeNoticeDetail);
        });
    }

    /* 预选表情面板 */
    var REACTION_EMOJI_PALETTE = ['👍','❤️','😄','😮','🎉','🔥','😢','👀','👎','🤔','💯','🙏','✨','😂','🤣','😍','🥺','💀','😎','🫡'];

    /* 渲染反应栏内容（嵌入 footer 内部，与"我已知晓"按钮同行） */
    function _buildReactionBarHtml(noticeId) {
        if (!noticeId) return '';
        return '<div class="notice-reaction-inline" data-notice-reaction-id="' + noticeId + '">' +
            '<span class="reaction-loading" style="font-size:12px;color:#9ca3af;">加载中...</span>' +
            '</div>';
    }

    /* 异步加载并渲染反应栏内容 */
    function _loadAndRenderReactions(noticeId) {
        var baseUrl = (window._telemetryBaseUrl || '').replace(/\/+$/, '');
        var hwid = window._telemetryHWID || '';
        if (!baseUrl || !noticeId) {
            // 无遥测连接时使用摘要数据做静态展示
            _renderReactionsFromSummary(noticeId);
            return;
        }
        var url = baseUrl + '/notice-reactions/' + noticeId;
        if (hwid) url += '?machine_id=' + encodeURIComponent(hwid);

        fetch(url).then(function(res) { return res.json(); }).then(function(data) {
            var reactions = data.reactions || [];
            _renderReactionPills(noticeId, reactions);
        }).catch(function() {
            _renderReactionsFromSummary(noticeId);
        });
    }

    /* 从全局摘要数据渲染（无详细用户列表） */
    function _renderReactionsFromSummary(noticeId) {
        var rawData = window._noticeReactionsData;
        if (!Array.isArray(rawData)) { _renderReactionPills(noticeId, []); return; }
        var reactions = [];
        rawData.forEach(function(r) {
            if (String(r.notice_id) !== String(noticeId)) return;
            reactions.push({ emoji: r.emoji, count: r.count || 0, users: [], reacted: false });
        });
        _renderReactionPills(noticeId, reactions);
    }

    /* 生成反应胶囊 DOM */
    function _renderReactionPills(noticeId, reactions) {
        var container = document.querySelector('[data-notice-reaction-id="' + noticeId + '"]');
        if (!container) return;

        var pills = (reactions || []).map(function(r) {
            var userList = (r.users || []).map(function(u) { return 'UID' + u; });
            var tooltipText = userList.length ? userList.join('、') : r.emoji + ' × ' + r.count;
            return '<div class="notice-reaction-pill' + (r.reacted ? ' active' : '') + '" data-emoji="' + escapeHtml(r.emoji) + '" onclick="NoticeModalModule._onReactionClick(this,' + noticeId + ')">' +
                '<span class="notice-reaction-tooltip">' + escapeHtml(tooltipText) + '</span>' +
                '<span class="reaction-emoji">' + r.emoji + '</span>' +
                '<span class="reaction-count">' + r.count + '</span>' +
                '</div>';
        }).join('');

        var pickerItems = REACTION_EMOJI_PALETTE.map(function(e) {
            return '<span class="notice-reaction-picker-item" onclick="NoticeModalModule._onPickerSelect(\'' + e + '\',' + noticeId + ')">' + e + '</span>';
        }).join('');

        container.innerHTML = pills +
            '<button class="notice-reaction-add-btn" onclick="NoticeModalModule._toggleReactionPicker(this)" title="添加表情">😀</button>' +
            '<div class="notice-reaction-picker">' + pickerItems + '</div>';
    }

    /* 切换表情选择浮层 */
    function _toggleReactionPicker(btn) {
        var picker = btn.parentElement.querySelector('.notice-reaction-picker');
        if (!picker) return;
        var isOpen = picker.classList.contains('show');
        document.querySelectorAll('.notice-reaction-picker.show').forEach(function(p) { p.classList.remove('show'); });
        if (!isOpen) {
            picker.classList.add('show');
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

    /* 从选择器选中表情 */
    function _onPickerSelect(emoji, noticeId) {
        document.querySelectorAll('.notice-reaction-picker.show').forEach(function(p) { p.classList.remove('show'); });
        _submitReaction(noticeId, emoji);
    }

    /* 点击已有反应胶囊（切换） */
    function _onReactionClick(pill, noticeId) {
        var emoji = pill.getAttribute('data-emoji');
        if (emoji) _submitReaction(noticeId, emoji);
    }

    /* 提交/取消反应 */
    function _submitReaction(noticeId, emoji) {
        var baseUrl = (window._telemetryBaseUrl || '').replace(/\/+$/, '');
        var hwid = window._telemetryHWID || '';
        if (!baseUrl || !hwid) return;

        fetch(baseUrl + '/notice-reaction', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ notice_id: Number(noticeId), machine_id: hwid, emoji: emoji })
        }).then(function() {
            _loadAndRenderReactions(noticeId);
        }).catch(function() {});
    }

    function isUpdateType(item) {
        const t = String((item && item.type) || '').toLowerCase();
        if (t === 'update') return true;
        const title = String((item && item.title) || '');
        return /更新日志|版本更新|changelog/i.test(title);
    }

    function renderByTemplate(item, helpers) {
        const useUpdate = isUpdateType(item);
        if (useUpdate && window.NoticeUpdateTemplate && typeof window.NoticeUpdateTemplate.render === 'function') {
            return window.NoticeUpdateTemplate.render(item, helpers);
        }
        if (!useUpdate && window.NoticeGeneralTemplate && typeof window.NoticeGeneralTemplate.render === 'function') {
            return window.NoticeGeneralTemplate.render(item, helpers);
        }

        // 兜底：无模板时使用通用 markdown 内容
        return '' +
            '<div class="modal-content notice-detail-modal">' +
            '  <div class="notice-article-header">' +
            '    <div class="notice-article-head-left"><div><h3 class="notice-article-title">' + escapeHtml(item.title || '公告详情') + '</h3></div></div>' +
            '    <button class="notice-detail-close" type="button" data-notice-close="1" aria-label="关闭"><i class="ri-close-line"></i></button>' +
            '  </div>' +
            '  <div class="notice-article-content custom-scrollbar">' + renderMarkdownSafe(item.content || '') + '</div>' +
            '  <div class="notice-article-footer"><p>Aimer WT • 感谢支持，正在努力开发中！</p><button class="notice-ack-btn" type="button" data-notice-close="1"><i class="ri-check-line"></i> 我已知晓</button></div>' +
            '</div>';
    }

    function openNoticeDetail(item) {
        const overlay = ensureModal();
        const safeItem = item || {};
        const shell = document.getElementById('notice-detail-shell');
        if (!shell) return;

        const helpers = {
            escapeHtml: escapeHtml,
            renderInlineBasic: renderInlineBasic,
            parseLogTextHtml: parseLogTextHtml,
            parseMarkdown: parseMarkdown,
            parseArticleMarkdown: parseArticleMarkdown,
            renderMarkdownSafe: renderMarkdownSafe,
            buildReactionBarHtml: function(noticeId) {
                return _buildReactionBarHtml(noticeId);
            }
        };

        shell.innerHTML = renderByTemplate(safeItem, helpers);
        bindCloseButtons(overlay);

        // 弹窗渲染完成后，异步加载反应详情
        if (safeItem.id) {
            _loadAndRenderReactions(safeItem.id);
        }

        overlay.classList.remove('entered');
        overlay.classList.remove('hiding');
        overlay.classList.add('show');
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                if (!overlay.classList.contains('show') || overlay.classList.contains('hiding')) return;
                overlay.classList.add('entered');
            });
        });
    }

    window.NoticeModalModule = {
        ensureModal: ensureModal,
        closeNoticeDetail: closeNoticeDetail,
        openNoticeDetail: openNoticeDetail,
        renderMarkdownSafe: renderMarkdownSafe,
        _toggleReactionPicker: _toggleReactionPicker,
        _onPickerSelect: _onPickerSelect,
        _onReactionClick: _onReactionClick
    };
})();
