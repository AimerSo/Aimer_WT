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

    function hydrateClientContext(forceReady) {
        const needsBaseUrl = !window._telemetryBaseUrl;
        const needsHwid = !window._telemetryHWID;
        const needsSeqId = !window._userSeqId;
        if (!forceReady && !needsBaseUrl && !needsHwid && !needsSeqId) {
            return Promise.resolve();
        }
        if (!(window.pywebview && window.pywebview.api)) {
            return Promise.resolve();
        }
        const loader = forceReady && typeof window.pywebview.api.ensure_telemetry_ready === 'function'
            ? () => window.pywebview.api.ensure_telemetry_ready(2500)
            : (typeof window.pywebview.api.init_app_state === 'function'
                ? () => window.pywebview.api.init_app_state()
                : null);
        if (!loader) {
            return Promise.resolve();
        }
        return loader().then((state) => {
            if (!state || typeof state !== 'object') return;
            if (state.telemetry_base_url) window._telemetryBaseUrl = state.telemetry_base_url;
            if (state.hwid) window._telemetryHWID = state.hwid;
            if (state.user_seq_id) window._userSeqId = state.user_seq_id;
        }).catch(() => null);
    }

    function buildTelemetryHeaders(path, method, machineID, includeJsonContentType) {
        const headers = { 'X-AimerWT-Client': '1' };
        if (includeJsonContentType) headers['Content-Type'] = 'application/json';

        if (window.pywebview && window.pywebview.api && window.pywebview.api.get_telemetry_auth_headers) {
            return window.pywebview.api.get_telemetry_auth_headers(path, method, machineID || '')
                .then((authHeaders) => {
                    if (authHeaders && typeof authHeaders === 'object') {
                        Object.assign(headers, authHeaders);
                    }
                    return headers;
                })
                .catch(() => headers);
        }
        return Promise.resolve(headers);
    }

    function parseJsonResponse(response, fallbackMessage) {
        if (window.NoticeClientHelper && typeof window.NoticeClientHelper.parseJsonResponse === 'function') {
            return window.NoticeClientHelper.parseJsonResponse(response, fallbackMessage);
        }
        if (!response) {
            return Promise.reject(new Error(fallbackMessage || '请求失败'));
        }
        return response.json().catch(() => ({})).then((data) => {
            if (response.ok) return data;
            const error = new Error((data && data.error) || fallbackMessage || ('请求失败（' + response.status + '）'));
            error.status = response.status;
            error.payload = data;
            throw error;
        });
    }

    function shouldRetryWithTelemetry(error) {
        if (window.NoticeClientHelper && typeof window.NoticeClientHelper.shouldRetryWithTelemetry === 'function') {
            return window.NoticeClientHelper.shouldRetryWithTelemetry(error);
        }
        const status = Number(error && error.status || 0);
        const message = String(error && error.message || '');
        if (status !== 403) return false;
        return /设备令牌|访问被拒绝|设备绑定/.test(message);
    }

    function requestJsonWithTelemetryRetry(requestFactory, fallbackMessage) {
        return Promise.resolve().then(() => requestFactory()).then((response) => {
            return parseJsonResponse(response, fallbackMessage);
        }).catch((error) => {
            if (!shouldRetryWithTelemetry(error)) {
                if (window.NoticeClientHelper && typeof window.NoticeClientHelper.decorateError === 'function') {
                    throw window.NoticeClientHelper.decorateError(error, fallbackMessage);
                }
                throw error;
            }
            return hydrateClientContext(true).then(() => requestFactory()).then((response) => {
                return parseJsonResponse(response, fallbackMessage);
            }).catch((retryError) => {
                if (window.NoticeClientHelper && typeof window.NoticeClientHelper.decorateError === 'function') {
                    throw window.NoticeClientHelper.decorateError(retryError, fallbackMessage);
                }
                throw retryError;
            });
        });
    }

    function parseMarkdown(md) {
        if (window.MarkdownRenderer) return window.MarkdownRenderer.parseChangelog(md);
        const lines = String(md || '').split('\n');
        const data = { title: '', version: 'Latest', sections: [] };
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
            title: fallbackTitle || '',
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
        (document.getElementById('app-root') || document.body).appendChild(overlay);

        overlay.addEventListener('click', (e) => {
            const path = typeof e.composedPath === 'function' ? e.composedPath() : [];
            const clickedInsideModal = path.some((node) => node && node.classList && node.classList.contains('notice-detail-modal'));
            if (!clickedInsideModal) closeNoticeDetail();
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
    var _reactionPendingMap = {};

    function _loadAndRenderReactions(noticeId, options) {
        options = options || {};
        hydrateClientContext(true).then(function () {
            var baseUrl = (window._telemetryBaseUrl || '').replace(/\/+$/, '');
            var hwid = window._telemetryHWID || '';
            if (!baseUrl || !noticeId) {
                _renderReactionsFromSummary(noticeId);
                return null;
            }
            var routePath = '/notice-reactions/' + noticeId;
            var url = baseUrl + routePath;
            if (hwid) url += '?machine_id=' + encodeURIComponent(hwid);

            return requestJsonWithTelemetryRetry(function () {
                return buildTelemetryHeaders(routePath, 'GET', hwid, false).then(function (headers) {
                    return fetch(url, { method: 'GET', headers: headers });
                });
            }, '加载互动数据失败');
        }).then(function (data) {
            if (!data) return;
            var reactions = Array.isArray(data && data.reactions) ? data.reactions : [];
            if (window.NoticeClientHelper && typeof window.NoticeClientHelper.cacheReactions === 'function') {
                reactions = window.NoticeClientHelper.cacheReactions(noticeId, reactions);
            }
            _renderReactionPills(noticeId, reactions);
        }).catch(function() {
            if (options.keepCurrentOnFailure && window.NoticeClientHelper && typeof window.NoticeClientHelper.getCachedReactions === 'function') {
                var cached = window.NoticeClientHelper.getCachedReactions(noticeId);
                if (cached) {
                    _renderReactionPills(noticeId, cached);
                    return;
                }
            }
            _renderReactionPills(noticeId, []);
        });
    }

    /* 从全局摘要数据渲染（无详细用户列表） */
    function _renderReactionsFromSummary(noticeId) {
        var reactions = window.NoticeClientHelper && typeof window.NoticeClientHelper.getSummaryReactions === 'function'
            ? window.NoticeClientHelper.getSummaryReactions(noticeId)
            : [];
        if ((!reactions || !reactions.length) && Array.isArray(window._noticeReactionsData)) {
            window._noticeReactionsData.forEach(function(r) {
                if (String(r.notice_id) !== String(noticeId)) return;
                reactions.push({ emoji: r.emoji, count: r.count || 0, users: [], reacted: false });
            });
        }
        if (window.NoticeClientHelper && typeof window.NoticeClientHelper.cacheReactions === 'function') {
            reactions = window.NoticeClientHelper.cacheReactions(noticeId, reactions);
        }
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

    function _closeReactionPicker(picker) {
        if (!picker) return;
        if (picker._noticeReactionCloseTimer) {
            clearTimeout(picker._noticeReactionCloseTimer);
            picker._noticeReactionCloseTimer = null;
        }
        picker.classList.remove('show');
        picker.classList.add('closing');
        if (picker._noticeReactionDocHandler) {
            document.removeEventListener('click', picker._noticeReactionDocHandler);
            picker._noticeReactionDocHandler = null;
        }
        picker._noticeReactionCloseTimer = setTimeout(function() {
            picker.classList.remove('closing');
            picker._noticeReactionCloseTimer = null;
        }, 220);
    }

    /* 切换表情选择浮层 */
    function _toggleReactionPicker(btn) {
        var picker = btn.parentElement.querySelector('.notice-reaction-picker');
        if (!picker) return;
        var isOpen = picker.classList.contains('show');
        document.querySelectorAll('.notice-reaction-picker.show, .notice-reaction-picker.closing').forEach(function(p) {
            if (p !== picker) _closeReactionPicker(p);
        });
        if (isOpen) {
            _closeReactionPicker(picker);
            return;
        }
        if (picker._noticeReactionCloseTimer) {
            clearTimeout(picker._noticeReactionCloseTimer);
            picker._noticeReactionCloseTimer = null;
        }
        picker.classList.remove('closing');
        requestAnimationFrame(function() {
            picker.classList.add('show');
        });
        setTimeout(function() {
            function closePicker(e) {
                if (!picker.contains(e.target) && e.target !== btn) {
                    _closeReactionPicker(picker);
                }
            }
            picker._noticeReactionDocHandler = closePicker;
            document.addEventListener('click', closePicker);
        }, 0);
    }

    /* 从选择器选中表情 */
    function _onPickerSelect(emoji, noticeId) {
        document.querySelectorAll('.notice-reaction-picker.show, .notice-reaction-picker.closing').forEach(function(p) { _closeReactionPicker(p); });
        _submitReaction(noticeId, emoji);
    }

    /* 点击已有反应胶囊（切换） */
    function _onReactionClick(pill, noticeId) {
        var emoji = pill.getAttribute('data-emoji');
        if (emoji) _submitReaction(noticeId, emoji);
    }

    /* 提交/取消反应 */
    function _submitReaction(noticeId, emoji) {
        if (_reactionPendingMap[noticeId]) return;
        hydrateClientContext(true).then(function () {
            var baseUrl = (window._telemetryBaseUrl || '').replace(/\/+$/, '');
            var hwid = window._telemetryHWID || '';
            if (!baseUrl || !hwid) return null;

            var previousReactions = [];
            if (window.NoticeClientHelper) {
                previousReactions =
                    window.NoticeClientHelper.getCachedReactions(noticeId) ||
                    window.NoticeClientHelper.getSummaryReactions(noticeId) ||
                    [];
            }
            var optimisticReactions = window.NoticeClientHelper && typeof window.NoticeClientHelper.buildOptimisticReactions === 'function'
                ? window.NoticeClientHelper.buildOptimisticReactions(previousReactions, emoji)
                : previousReactions;

            _renderReactionPills(noticeId, optimisticReactions);
            _reactionPendingMap[noticeId] = {
                previous: previousReactions
            };

            return requestJsonWithTelemetryRetry(function () {
                return buildTelemetryHeaders('/notice-reaction', 'POST', hwid, true).then(function (headers) {
                    return fetch(baseUrl + '/notice-reaction', {
                        method: 'POST',
                        headers: headers,
                        body: JSON.stringify({ notice_id: Number(noticeId), machine_id: hwid, emoji: emoji })
                    });
                });
            }, '提交表情互动失败');
        }).then(function() {
            _loadAndRenderReactions(noticeId, { keepCurrentOnFailure: true });
        }).catch(function(err) {
            var pending = _reactionPendingMap[noticeId];
            if (pending) {
                _renderReactionPills(noticeId, pending.previous || []);
            }
            if (window.app && typeof window.app.showToast === 'function') {
                window.app.showToast((err && err.message) || '提交表情互动失败', 'error');
            }
        }).finally(function () {
            delete _reactionPendingMap[noticeId];
        });
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
            isFeatureEnabled: function(featureKey) {
                return !(window.app && typeof window.app.getServerUserFeatures === 'function') ||
                    window.app.getServerUserFeatures(featureKey);
            },
            buildReactionBarHtml: function(noticeId) {
                return _buildReactionBarHtml(noticeId);
            }
        };

        shell.innerHTML = renderByTemplate(safeItem, helpers);
        bindCloseButtons(overlay);

        // 弹窗渲染完成后，如果评论面板已启用，反应系统由评论面板统一管理
        var commentPanelActive = helpers.isFeatureEnabled('notice_comment_enabled') &&
            window.NoticeCommentPanel && typeof window.NoticeCommentPanel.renderPanel === 'function' &&
            !!shell.querySelector('.nc-panel[data-nc-notice-id]');
        if (safeItem.id && !commentPanelActive) {
            _loadAndRenderReactions(safeItem.id);
        }

        // 初始化社区评论面板
        if (helpers.isFeatureEnabled('notice_comment_enabled') &&
            window.NoticeCommentPanel && typeof window.NoticeCommentPanel.renderPanel === 'function') {
            var ncPanel = shell.querySelector('.nc-panel[data-nc-notice-id]');
            if (ncPanel && safeItem.id) {
                window.NoticeCommentPanel.renderPanel(safeItem.id, ncPanel);
            }
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
