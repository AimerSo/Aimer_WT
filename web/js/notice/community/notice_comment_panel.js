/* 公告社区评论面板 — 独立组件，挂载到 window.NoticeCommentPanel */
(function () {
    var REACTION_PALETTE = ['👍','❤️','😄','😮','🎉','🔥','😢','👀','👎','🤔','💯','🙏','✨','😂','🤣','😍','🥺','💀','😎','🫡'];
    var LIKE_EMOJI = '❤️';
    var MAX_VISIBLE_REACTIONS = 5;
    var LIKERS_MODAL_ID = 'nc-likers-modal';

    function escapeHtml(v) {
        return String(v == null ? '' : v)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function timeAgo(dateStr) {
        if (!dateStr) return '';
        var d = new Date(dateStr.replace(' ', 'T') + '+08:00');
        var now = new Date();
        var diff = Math.floor((now - d) / 1000);
        if (diff < 60) return '刚刚';
        if (diff < 3600) return Math.floor(diff / 60) + '分钟前';
        if (diff < 86400) return Math.floor(diff / 3600) + '小时前';
        if (diff < 604800) return Math.floor(diff / 86400) + '天前';
        return dateStr.substring(5, 10);
    }

    function formatWeight(value) {
        var num = Number(value || 0);
        if (!isFinite(num)) return '0';
        var rounded = Math.round(num * 100) / 100;
        if (Math.abs(rounded - Math.round(rounded)) < 0.0001) {
            return String(Math.round(rounded));
        }
        return rounded.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
    }

    var _panelState = {};

    function _getState(noticeId) {
        if (!_panelState[noticeId]) {
            _panelState[noticeId] = {
                reactions: [],
                comments: [],
                totalCount: 0,
                totalLikes: 0,
                noticeLikeCount: 0,
                noticeLiked: false,
                noticeLikers: [],
                replyingTo: null,
                expandedReplies: {},
                replyCache: {},
                reactionsExpanded: false,
                canComment: true,
                banReason: '',
                commentOffset: 0,
                commentLimit: 0,
                hasMoreComments: false,
                isLoadingComments: false,
                isAppendingComments: false
            };
        }
        return _panelState[noticeId];
    }

    function _getBaseUrl() {
        return (window._telemetryBaseUrl || '').replace(/\/+$/, '');
    }

    function _getHWID() {
        return window._telemetryHWID || '';
    }

    function _getUserSeqId() {
        return window._userSeqId || '';
    }

    function _buildTelemetryHeaders(path, method, machineID, includeJsonContentType) {
        var headers = { 'X-AimerWT-Client': '1' };
        if (includeJsonContentType) headers['Content-Type'] = 'application/json';

        if (window.pywebview && window.pywebview.api && window.pywebview.api.get_telemetry_auth_headers) {
            return window.pywebview.api.get_telemetry_auth_headers(path, method, machineID || '')
                .then(function (authHeaders) {
                    if (authHeaders && typeof authHeaders === 'object') {
                        Object.assign(headers, authHeaders);
                    }
                    return headers;
                })
                .catch(function () {
                    return headers;
                });
        }
        return Promise.resolve(headers);
    }

    function _isFeatureEnabled(key) {
        var flags = window._aimerUserFeatures || {};
        return flags[key] !== false;
    }

    function _getVisibleReactionLimit(noticeId) {
        var row = document.getElementById('nc-rr-' + noticeId);
        var panel = row ? row.closest('.nc-panel') : null;
        var panelWidth = panel ? panel.clientWidth : 0;
        return panelWidth && panelWidth <= 360 ? 4 : MAX_VISIBLE_REACTIONS;
    }

    function _prefersReducedMotion() {
        return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    }

    function _animateReactionToggle(noticeId, reactions, expand) {
        var header = document.getElementById('nc-rh-' + noticeId);
        var row = document.getElementById('nc-rr-' + noticeId);
        var state = _getState(noticeId);
        if (!row || !header || _prefersReducedMotion()) {
            state.reactionsExpanded = expand;
            _renderReactions(noticeId, reactions);
            return;
        }

        var startHeight = Math.max(row.getBoundingClientRect().height, row.scrollHeight, 28);
        var startHeaderHeight = Math.max(header.getBoundingClientRect().height, header.scrollHeight, 48);
        header.classList.add('nc-animating');
        row.classList.add('nc-animating');
        header.style.maxHeight = startHeaderHeight + 'px';
        row.style.maxHeight = startHeight + 'px';
        row.style.opacity = '1';
        row.style.transform = 'translateY(0)';

        state.reactionsExpanded = expand;
        _renderReactions(noticeId, reactions);

        var endHeight = Math.max(row.scrollHeight, 28);
        var endHeaderHeight = Math.max(header.scrollHeight, 48);
        if (startHeight === endHeight) {
            header.classList.remove('nc-animating');
            row.classList.remove('nc-animating');
            header.style.maxHeight = '';
            row.style.maxHeight = '';
            row.style.opacity = '';
            row.style.transform = '';
            return;
        }

        header.style.maxHeight = startHeaderHeight + 'px';
        row.style.maxHeight = startHeight + 'px';
        row.style.opacity = '0.5';
        row.style.transform = expand ? 'translateY(6px)' : 'translateY(-6px)';
        header.offsetHeight;

        var cleaned = false;
        function cleanup() {
            if (cleaned) return;
            cleaned = true;
            header.classList.remove('nc-animating');
            row.classList.remove('nc-animating');
            header.style.maxHeight = '';
            row.style.maxHeight = '';
            row.style.opacity = '';
            row.style.transform = '';
            row.removeEventListener('transitionend', onEnd);
            window.clearTimeout(fallback);
        }
        function onEnd(e) {
            if (e.target !== row || e.propertyName !== 'max-height') return;
            cleanup();
        }
        row.addEventListener('transitionend', onEnd);
        var fallback = window.setTimeout(cleanup, 550);

        requestAnimationFrame(function () {
            header.style.maxHeight = endHeaderHeight + 'px';
            row.style.maxHeight = endHeight + 'px';
            row.style.opacity = '1';
            row.style.transform = 'translateY(0)';
        });
    }

    function _normalizeLiker(entry) {
        if (entry && typeof entry === 'object') {
            return {
                uid: String(entry.uid || '?'),
                alias: String(entry.alias || '')
            };
        }
        return {
            uid: String(entry || '?'),
            alias: ''
        };
    }

    function _ensureLikersModal() {
        var overlay = document.getElementById(LIKERS_MODAL_ID);
        if (overlay) return overlay;

        overlay = document.createElement('div');
        overlay.id = LIKERS_MODAL_ID;
        overlay.className = 'nc-likers-overlay';
        overlay.innerHTML =
            '<div class="nc-likers-dialog">' +
            '  <div class="nc-likers-header">' +
            '    <div class="nc-likers-title">赞</div>' +
            '    <button class="nc-likers-close" type="button" data-nc-likers-close="1" aria-label="关闭">✕</button>' +
            '  </div>' +
            '  <div class="nc-likers-body custom-scrollbar" id="nc-likers-body"></div>' +
            '</div>';
        document.body.appendChild(overlay);

        overlay.addEventListener('click', function (e) {
            if (e.target === overlay || e.target.closest('[data-nc-likers-close="1"]')) {
                _closeLikersModal();
            }
        });

        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape' && overlay.classList.contains('show')) {
                _closeLikersModal();
            }
        });

        return overlay;
    }

    function _closeLikersModal() {
        var overlay = document.getElementById(LIKERS_MODAL_ID);
        if (overlay) overlay.classList.remove('show');
    }

    function _openLikersModal(noticeId) {
        var state = _getState(noticeId);
        var overlay = _ensureLikersModal();
        var body = document.getElementById('nc-likers-body');
        if (!body) return;

        var users = state.noticeLikers || [];
        if (!users.length) {
            body.innerHTML = '<div class="nc-likers-empty">暂时还没有人点赞</div>';
        } else {
            body.innerHTML = users.map(function (user) {
                var uid = escapeHtml(user.uid || '?');
                var alias = escapeHtml((user.alias || '').trim() || '暂无昵称');
                return '<div class="nc-likers-item">' +
                    '  <div class="nc-likers-avatar">' + uid + '</div>' +
                    '  <div class="nc-likers-meta">' +
                    '    <div class="nc-likers-name">用户#' + uid + '</div>' +
                    '    <div class="nc-likers-alias">' + alias + '</div>' +
                    '  </div>' +
                    '</div>';
            }).join('');
        }

        overlay.classList.add('show');
    }

    function _syncNoticeLikeState(noticeId, reactions) {
        var state = _getState(noticeId);
        state.reactions = Array.isArray(reactions) ? reactions.slice() : [];

        var likeReaction = null;
        state.reactions.forEach(function (reaction) {
            if (reaction && reaction.emoji === LIKE_EMOJI) likeReaction = reaction;
        });

        state.noticeLikeCount = likeReaction ? Number(likeReaction.count || 0) : 0;
        state.noticeLiked = !!(likeReaction && likeReaction.reacted);

        var rawLikers = [];
        if (likeReaction) {
            if (Array.isArray(likeReaction.user_details) && likeReaction.user_details.length) {
                rawLikers = likeReaction.user_details;
            } else if (Array.isArray(likeReaction.users)) {
                rawLikers = likeReaction.users;
            }
        }
        state.noticeLikers = rawLikers.map(_normalizeLiker);
        _updateStats(noticeId);
    }

    function _estimateCommentPageSize(noticeId) {
        var list = document.getElementById('nc-cl-' + noticeId);
        var height = list ? list.clientHeight : 0;
        var estimate = Math.ceil(height / 92) + 2;
        if (!estimate || estimate < 6) estimate = 8;
        if (estimate > 20) estimate = 20;
        return estimate;
    }

    function _renderCommentFooter(state) {
        if (state.isLoadingComments && !state.comments.length) {
            return '<div class="nc-comment-loading"><i class="ri-loader-4-line"></i><span>正在加载评论...</span></div>';
        }
        if (!state.comments.length) {
            return '<div class="nc-comment-empty"><i class="ri-chat-3-line"></i>暂无评论，来说点什么吧</div>';
        }
        if (state.isAppendingComments) {
            return '<div class="nc-comment-more"><i class="ri-loader-4-line"></i><span>正在加载更多评论...</span></div>';
        }
        if (state.hasMoreComments) {
            return '<div class="nc-comment-more"><i class="ri-arrow-down-s-line"></i><span>继续下滑即可加载更多评论</span></div>';
        }
        return '<div class="nc-comment-more nc-comment-more-done"><i class="ri-check-line"></i><span>评论已经全部加载完成</span></div>';
    }

    function _ensureCommentScroll(noticeId) {
        var list = document.getElementById('nc-cl-' + noticeId);
        if (!list || list.dataset.ncScrollBound === '1') return;
        list.dataset.ncScrollBound = '1';
        list.addEventListener('scroll', function () {
            var state = _getState(noticeId);
            if (!state.hasMoreComments || state.isLoadingComments || state.isAppendingComments) return;
            if (list.scrollHeight - list.scrollTop - list.clientHeight <= 120) {
                _loadComments(noticeId, { append: true });
            }
        });
    }

    function renderPanel(noticeId, container) {
        if (!container || !noticeId) return;
        var id = noticeId;
        _panelState[id] = null;

        var baseUrl = _getBaseUrl();
        if (!baseUrl) {
            container.classList.add('nc-offline');
            container.innerHTML =
                '<div class="nc-offline-wrap">' +
                '  <div class="nc-offline-icon"><i class="ri-cloud-off-line"></i></div>' +
                '  <div class="nc-offline-title">未连接服务器</div>' +
                '  <div class="nc-offline-desc">评论功能需要连接服务器后才能使用</div>' +
                '</div>';
            return;
        }
        container.classList.remove('nc-offline');

        var reactionEnabled = _isFeatureEnabled('notice_reaction_enabled');

        container.innerHTML =
            (reactionEnabled ? (
            '<div class="nc-reaction-header" id="nc-rh-' + id + '">' +
            '  <div class="nc-reaction-row" id="nc-rr-' + id + '"><span style="font-size:12px;color:#9ca3af;">加载中...</span></div>' +
            '</div>'
            ) : '') +
            '<div class="nc-comment-list custom-scrollbar" id="nc-cl-' + id + '">' +
            '  <div class="nc-comment-loading"><i class="ri-loader-4-line"></i><span>正在加载评论...</span></div>' +
            '</div>' +
            '<div class="nc-stats-bar" id="nc-stats-' + id + '">' +
            (reactionEnabled ? (
            '  <div class="nc-stat-like-group">' +
            '    <button class="nc-stat-like-btn" id="nc-like-toggle-' + id + '" type="button" title="点赞">' +
            '      <i class="nc-stat-icon ri-heart-line" id="nc-like-icon-' + id + '"></i>' +
            '      <span class="nc-stat-count" id="nc-likes-' + id + '">0</span>' +
            '    </button>' +
            '    <button class="nc-stat-link" id="nc-likers-' + id + '" type="button">赞</button>' +
            '  </div>'
            ) : '') +
            '  <div class="nc-stat-item"><i class="nc-stat-icon ri-chat-3-line"></i><span class="nc-stat-count" id="nc-count-' + id + '">0</span><span class="nc-stat-label">条评论</span></div>' +
            '  <button class="nc-share-btn" id="nc-share-' + id + '" title="分享"><i class="ri-share-forward-line"></i> 分享</button>' +
            '</div>' +
            '<div class="nc-reply-indicator" id="nc-ri-' + id + '">' +
            '  <span>回复 <strong id="nc-ri-name-' + id + '"></strong></span>' +
            '  <span class="nc-reply-cancel" id="nc-ri-cancel-' + id + '">✕</span>' +
            '</div>' +
            '<div class="nc-input-bar">' +
            '  <div class="nc-input-avatar" id="nc-my-avatar-' + id + '">?</div>' +
            '  <input class="nc-input-field" id="nc-input-' + id + '" type="text" placeholder="添加评论..." maxlength="200" />' +
            '  <button class="nc-send-btn" id="nc-send-' + id + '" disabled><i class="ri-send-plane-2-fill"></i></button>' +
            '</div>';

        var state = _getState(id);
        state.commentLimit = _estimateCommentPageSize(id);

        var myUid = _getUserSeqId();
        var avatarEl = document.getElementById('nc-my-avatar-' + id);
        if (avatarEl && myUid) {
            avatarEl.textContent = myUid;
        }

        var input = document.getElementById('nc-input-' + id);
        var sendBtn = document.getElementById('nc-send-' + id);
        if (input && sendBtn) {
            input.addEventListener('input', function () {
                sendBtn.disabled = !input.value.trim();
            });
            input.addEventListener('keydown', function (e) {
                if (e.key === 'Enter' && !e.shiftKey && input.value.trim()) {
                    e.preventDefault();
                    _submitComment(id);
                }
            });
            sendBtn.addEventListener('click', function () {
                _submitComment(id);
            });
        }

        var cancelBtn = document.getElementById('nc-ri-cancel-' + id);
        if (cancelBtn) {
            cancelBtn.addEventListener('click', function () {
                _cancelReply(id);
            });
        }

        var likeToggleBtn = document.getElementById('nc-like-toggle-' + id);
        if (likeToggleBtn) {
            likeToggleBtn.addEventListener('click', function () {
                _toggleNoticeLike(id);
            });
        }

        var likersBtn = document.getElementById('nc-likers-' + id);
        if (likersBtn) {
            likersBtn.addEventListener('click', function () {
                _openLikersModal(id);
            });
        }

        _ensureCommentScroll(id);
        if (reactionEnabled) {
            _loadReactions(id);
        }
        requestAnimationFrame(function () {
            state.commentLimit = _estimateCommentPageSize(id);
            _loadComments(id, { reset: true });
        });
    }

    function _loadReactions(noticeId) {
        if (!_isFeatureEnabled('notice_reaction_enabled')) {
            _renderReactions(noticeId, []);
            return;
        }
        var baseUrl = _getBaseUrl();
        var hwid = _getHWID();
        if (!baseUrl) {
            _renderReactionsFromGlobal(noticeId);
            return;
        }
        var url = baseUrl + '/notice-reactions/' + noticeId;
        if (hwid) url += '?machine_id=' + encodeURIComponent(hwid);

        _buildTelemetryHeaders('/notice-reactions/' + noticeId, 'GET', hwid, false).then(function (headers) {
            return fetch(url, { method: 'GET', headers: headers });
        }).then(function (r) { return r.json(); }).then(function (data) {
            _renderReactions(noticeId, data.reactions || []);
        }).catch(function () {
            _renderReactionsFromGlobal(noticeId);
        });
    }

    function _renderReactionsFromGlobal(noticeId) {
        var raw = window._noticeReactionsData;
        if (!Array.isArray(raw)) { _renderReactions(noticeId, []); return; }
        var reactions = [];
        raw.forEach(function (r) {
            if (String(r.notice_id) !== String(noticeId)) return;
            reactions.push({ emoji: r.emoji, count: r.count || 0, users: [], reacted: false });
        });
        _renderReactions(noticeId, reactions);
    }

    function _renderReactions(noticeId, reactions) {
        var row = document.getElementById('nc-rr-' + noticeId);
        if (!row) return;
        var state = _getState(noticeId);
        var visibleLimit = _getVisibleReactionLimit(noticeId);

        _syncNoticeLikeState(noticeId, reactions);

        var visibleReactions = reactions;
        var hiddenCount = 0;
        if (!state.reactionsExpanded && reactions.length > visibleLimit) {
            visibleReactions = reactions.slice(0, visibleLimit);
            hiddenCount = reactions.length - visibleLimit;
        }

        var pills = visibleReactions.map(function (r) {
            var userDetails = Array.isArray(r.user_details) ? r.user_details : [];
            var tooltipParts = userDetails.slice(0, 5).map(function (u) {
                return (u.alias && u.alias.trim()) ? u.alias.trim() : ('UID' + u.uid);
            });
            if (userDetails.length > 5) tooltipParts.push('...');
            var titleText = tooltipParts.length ? tooltipParts.join(', ') : '';
            return '<div class="nc-reaction-pill' + (r.reacted ? ' active' : '') + '" data-emoji="' + escapeHtml(r.emoji) + '" data-nid="' + noticeId + '"' + (titleText ? ' title="' + escapeHtml(titleText) + '"' : '') + '>' +
                '<span class="nc-r-emoji">' + r.emoji + '</span>' +
                '<span class="nc-r-count">' + r.count + '</span>' +
                '</div>';
        }).join('');

        var moreBtn = '';
        if (hiddenCount > 0) {
            moreBtn = '<button class="nc-more-btn" id="nc-expand-' + noticeId + '" type="button">(+' + hiddenCount + ')</button>';
        } else if (state.reactionsExpanded && reactions.length > visibleLimit) {
            moreBtn = '<button class="nc-more-btn" id="nc-collapse-' + noticeId + '" type="button">收起</button>';
        }

        var pickerItems = REACTION_PALETTE.map(function (e) {
            return '<span class="nc-emoji-picker-item" data-emoji="' + e + '" data-nid="' + noticeId + '">' + e + '</span>';
        }).join('');

        row.innerHTML = pills + moreBtn +
            '<div class="nc-picker-wrap">' +
            '  <button class="nc-add-reaction-btn" id="nc-add-r-' + noticeId + '" type="button" title="添加表情">😀</button>' +
            '  <div class="nc-emoji-picker" id="nc-picker-' + noticeId + '">' + pickerItems + '</div>' +
            '</div>';

        // 根据展开状态切换 class（CSS transition 在这里生效）
        if (state.reactionsExpanded) row.classList.add('nc-expanded');
        else row.classList.remove('nc-expanded');

        row.querySelectorAll('.nc-reaction-pill').forEach(function (pill) {
            pill.addEventListener('click', function (e) {
                e.stopPropagation();
                var emoji = pill.getAttribute('data-emoji');
                _submitReaction(noticeId, emoji);
            });
        });

        var expandBtn = document.getElementById('nc-expand-' + noticeId);
        if (expandBtn) {
            expandBtn.addEventListener('click', function (e) {
                e.stopPropagation();
                _animateReactionToggle(noticeId, reactions, true);
            });
        }
        var collapseBtn = document.getElementById('nc-collapse-' + noticeId);
        if (collapseBtn) {
            collapseBtn.addEventListener('click', function (e) {
                e.stopPropagation();
                _animateReactionToggle(noticeId, reactions, false);
            });
        }

        var addBtn = document.getElementById('nc-add-r-' + noticeId);
        var picker = document.getElementById('nc-picker-' + noticeId);
        if (addBtn && picker) {
            addBtn.addEventListener('click', function (e) {
                e.stopPropagation();
                var isOpen = picker.classList.contains('show');
                document.querySelectorAll('.nc-emoji-picker.show').forEach(function (p) { p.classList.remove('show'); });
                if (!isOpen) {
                    picker.classList.add('show');
                    setTimeout(function () {
                        function close(ev) {
                            if (!picker.contains(ev.target) && ev.target !== addBtn) {
                                picker.classList.remove('show');
                                document.removeEventListener('click', close);
                            }
                        }
                        document.addEventListener('click', close);
                    }, 0);
                }
            });
            picker.querySelectorAll('.nc-emoji-picker-item').forEach(function (item) {
                item.addEventListener('click', function (e) {
                    e.stopPropagation();
                    picker.classList.remove('show');
                    _submitReaction(noticeId, item.getAttribute('data-emoji'));
                });
            });
        }
    }

    function _submitReaction(noticeId, emoji) {
        if (!_isFeatureEnabled('notice_reaction_enabled')) return;
        var baseUrl = _getBaseUrl();
        var hwid = _getHWID();
        if (!baseUrl || !hwid) return;

        _buildTelemetryHeaders('/notice-reaction', 'POST', hwid, true).then(function (headers) {
            return fetch(baseUrl + '/notice-reaction', {
                method: 'POST',
                headers: headers,
                body: JSON.stringify({ notice_id: Number(noticeId), machine_id: hwid, emoji: emoji })
            });
        }).then(function () {
            _loadReactions(noticeId);
        }).catch(function () { });
    }

    function _loadComments(noticeId, options) {
        options = options || {};
        var state = _getState(noticeId);
        var append = !!options.append;
        var reset = options.reset !== false && !append;

        if (append) {
            if (!state.hasMoreComments || state.isLoadingComments || state.isAppendingComments) return;
            state.isAppendingComments = true;
        } else {
            if (state.isLoadingComments) return;
            state.isLoadingComments = true;
            if (reset) {
                state.commentOffset = 0;
                state.comments = [];
                state.replyCache = {};
            }
        }

        state.commentLimit = state.commentLimit || _estimateCommentPageSize(noticeId);
        _renderComments(noticeId);

        var baseUrl = _getBaseUrl();
        var hwid = _getHWID();
        if (!baseUrl) return;

        var offset = append ? state.commentOffset : 0;
        var url = baseUrl + '/notice-comments/' + noticeId +
            '?offset=' + encodeURIComponent(offset) +
            '&limit=' + encodeURIComponent(state.commentLimit);
        if (hwid) url += '&machine_id=' + encodeURIComponent(hwid);

        _buildTelemetryHeaders('/notice-comments/' + noticeId, 'GET', hwid, false).then(function (headers) {
            return fetch(url, { method: 'GET', headers: headers });
        }).then(function (r) { return r.json(); }).then(function (data) {
            var incoming = Array.isArray(data.comments) ? data.comments : [];
            if (append) {
                var seen = {};
                state.comments.forEach(function (item) { seen[item.id] = true; });
                incoming.forEach(function (item) {
                    if (!seen[item.id]) state.comments.push(item);
                });
            } else {
                state.comments = incoming;
            }
            state.commentOffset = Number(data.next_offset || state.comments.length || 0);
            state.hasMoreComments = data.has_more === true;
            state.totalCount = data.total_count || 0;
            state.totalLikes = data.total_likes || 0;
            state.canComment = data.can_comment !== false;
            state.banReason = data.ban_reason || '';
            _renderComments(noticeId);
            _updateStats(noticeId);
            _updateComposerState(noticeId);
        }).catch(function () {
            _showToast('评论加载失败，请稍后重试');
        }).finally(function () {
            state.isLoadingComments = false;
            state.isAppendingComments = false;
            _renderComments(noticeId);
        });
    }

    function _loadReplies(noticeId, commentId) {
        var baseUrl = _getBaseUrl();
        var hwid = _getHWID();
        if (!baseUrl) return;

        var state = _getState(noticeId);
        var replyState = state.replyCache[commentId] || { items: [], loading: false, loaded: false };
        if (replyState.loading || replyState.loaded) return;

        replyState.loading = true;
        state.replyCache[commentId] = replyState;
        _renderComments(noticeId);

        var url = baseUrl + '/notice-comments/' + noticeId + '/replies/' + commentId;
        if (hwid) url += '?machine_id=' + encodeURIComponent(hwid);

        _buildTelemetryHeaders('/notice-comments/' + noticeId + '/replies/' + commentId, 'GET', hwid, false).then(function (headers) {
            return fetch(url, { method: 'GET', headers: headers });
        }).then(function (r) { return r.json(); }).then(function (data) {
            replyState.items = Array.isArray(data.replies) ? data.replies : [];
            replyState.loaded = true;
        }).catch(function () {
            _showToast('回复加载失败，请稍后重试');
        }).finally(function () {
            replyState.loading = false;
            _renderComments(noticeId);
        });
    }

    function _updateStats(noticeId) {
        var state = _getState(noticeId);
        var likeBtn = document.getElementById('nc-like-toggle-' + noticeId);
        var likeIcon = document.getElementById('nc-like-icon-' + noticeId);
        var likesEl = document.getElementById('nc-likes-' + noticeId);
        var countEl = document.getElementById('nc-count-' + noticeId);
        if (likeBtn) {
            likeBtn.classList.toggle('nc-liked', !!state.noticeLiked);
            likeBtn.title = state.noticeLiked ? '取消点赞' : '点赞';
        }
        if (likeIcon) likeIcon.className = 'nc-stat-icon ' + (state.noticeLiked ? 'ri-heart-fill' : 'ri-heart-line');
        if (likesEl) likesEl.textContent = state.noticeLikeCount;
        if (countEl) countEl.textContent = state.totalCount;
    }

    function _updateComposerState(noticeId) {
        var state = _getState(noticeId);
        var input = document.getElementById('nc-input-' + noticeId);
        var sendBtn = document.getElementById('nc-send-' + noticeId);
        if (!input || !sendBtn) return;

        if (!state.canComment) {
            input.value = '';
            input.disabled = true;
            input.placeholder = state.banReason ? ('评论资格已封禁：' + state.banReason) : '评论资格已被封禁';
            sendBtn.disabled = true;
            return;
        }

        input.disabled = false;
        if (!state.replyingTo) {
            input.placeholder = '添加评论...';
        }
        sendBtn.disabled = !input.value.trim();
    }

    function _renderComments(noticeId) {
        var list = document.getElementById('nc-cl-' + noticeId);
        if (!list) return;
        var state = _getState(noticeId);

        if (!state.comments.length && !state.isLoadingComments) {
            list.innerHTML = _renderCommentFooter(state);
            return;
        }

        var html = state.comments.map(function (c) {
            return _renderCommentItem(c, noticeId);
        }).join('') + _renderCommentFooter(state);
        list.innerHTML = html;
        _bindCommentEvents(list, noticeId);
    }

    // 赞助者/主播标签映射
    var _COMMENT_TAG_MAP = {
        'sponsor_1': { label: '一级赞助', color: '#b07c3b', bg: 'rgba(176,124,59,.1)' },
        'sponsor_2': { label: '二级赞助', color: '#94a3b8', bg: 'rgba(148,163,184,.1)' },
        'sponsor_3': { label: '三级赞助', color: '#d99a00', bg: 'rgba(217,154,0,.1)' },
        'sponsor_4': { label: '四级赞助', color: '#1a1a1a', bg: 'rgba(26,26,26,.06)' },
        'streamer':  { label: '主播',       color: '#dc2626', bg: 'rgba(220,38,38,.08)' }
    };

    function _renderTagBadges(tagsRaw) {
        var tags = [];
        if (typeof tagsRaw === 'string' && tagsRaw.length > 2) {
            try { tags = JSON.parse(tagsRaw); } catch (e) { tags = []; }
        } else if (Array.isArray(tagsRaw)) {
            tags = tagsRaw;
        }
        if (!tags.length) return '';
        var html = '';
        tags.forEach(function (t) {
            var def = _COMMENT_TAG_MAP[t];
            if (def) {
                html += '<span class="nc-tag-badge" style="color:' + def.color + ';background:' + def.bg + ';border:1px solid ' + def.color + '22;padding:1px 5px;border-radius:4px;font-size:10px;font-weight:500;margin-left:4px;">' + def.label + '</span>';
            }
        });
        return html;
    }

    function _renderCommentItem(c, noticeId) {
        var state = _getState(noticeId);
        var uid = c.uid || '?';
        var replyCount = Number(c.reply_count || 0);
        var isExpanded = !!state.expandedReplies[c.id];
        var replyState = state.replyCache[c.id] || { items: [], loading: false, loaded: false };
        var repliesHtml = '';

        if (replyCount > 0) {
            var toggleLabel = isExpanded ? '收起回复' : ('查看 ' + replyCount + ' 条回复');
            repliesHtml += '<div class="nc-reply-toggle">' +
                '<button class="nc-reply-toggle-btn" data-cid="' + c.id + '" data-nid="' + noticeId + '">' +
                '── ' + toggleLabel +
                '</button></div>';

            if (isExpanded) {
                if (replyState.loading) {
                    repliesHtml += '<div class="nc-replies-wrap nc-open"><div class="nc-reply-loading"><i class="ri-loader-4-line"></i><span>正在加载回复...</span></div></div>';
                } else if (replyState.loaded && replyState.items.length) {
                    repliesHtml += '<div class="nc-replies-wrap nc-open">';
                    repliesHtml += replyState.items.map(function (r) {
                        return _renderReplyItem(r);
                    }).join('');
                    repliesHtml += '</div>';
                } else if (replyState.loaded) {
                    repliesHtml += '<div class="nc-replies-wrap nc-open"><div class="nc-reply-loading"><span>暂时还没有可显示的回复</span></div></div>';
                }
            }
        }

        return '<div class="nc-comment-item" data-comment-id="' + c.id + '">' +
            '<div class="nc-comment-head">' +
            '  <div class="nc-comment-avatar">' + escapeHtml(uid) + '</div>' +
            '  <span class="nc-comment-uid">用户#' + escapeHtml(uid) + '</span>' +
            _renderTagBadges(c.tags) +
            '  <span class="nc-comment-score">权重 ' + escapeHtml(formatWeight(c.weight_score || 0)) + '</span>' +
            '  <span class="nc-comment-time">' + timeAgo(c.created_at) + '</span>' +
            '</div>' +
            '<div class="nc-comment-body">' + escapeHtml(c.content) + '</div>' +
            '<div class="nc-comment-actions">' +
            '  <button class="nc-action-btn' + (c.liked ? ' nc-liked' : '') + '" data-action="like" data-cid="' + c.id + '"><i class="' + (c.liked ? 'ri-heart-fill' : 'ri-heart-line') + '"></i> ' + (c.like_count || '') + '</button>' +
            '  <button class="nc-action-btn" data-action="reply" data-cid="' + c.id + '" data-root-cid="' + c.id + '" data-uid="' + escapeHtml(uid) + '">回复</button>' +
            '</div>' +
            repliesHtml +
            '</div>';
    }

    function _renderReplyItem(r) {
        var uid = r.uid || '?';
        return '<div class="nc-reply-item" data-comment-id="' + r.id + '">' +
            '<div class="nc-reply-head">' +
            '  <div class="nc-reply-avatar">' + escapeHtml(uid) + '</div>' +
            '  <span class="nc-reply-uid">用户#' + escapeHtml(uid) + '</span>' +
            _renderTagBadges(r.tags) +
            '  <span class="nc-comment-score nc-reply-score">权重 ' + escapeHtml(formatWeight(r.weight_score || 0)) + '</span>' +
            '  <span class="nc-reply-time">' + timeAgo(r.created_at) + '</span>' +
            '</div>' +
            '<div class="nc-reply-body">' + escapeHtml(r.content) + '</div>' +
            '<div class="nc-reply-actions">' +
            '  <button class="nc-action-btn' + (r.liked ? ' nc-liked' : '') + '" data-action="like" data-cid="' + r.id + '"><i class="' + (r.liked ? 'ri-heart-fill' : 'ri-heart-line') + '"></i> ' + (r.like_count || '') + '</button>' +
            '  <button class="nc-action-btn" data-action="reply" data-cid="' + r.id + '" data-root-cid="' + r.parent_id + '" data-uid="' + escapeHtml(uid) + '">回复</button>' +
            '</div>' +
            '</div>';
    }

    function _bindCommentEvents(container, noticeId) {
        container.querySelectorAll('[data-action="like"]').forEach(function (btn) {
            btn.addEventListener('click', function () {
                _toggleLike(Number(btn.getAttribute('data-cid')), noticeId);
            });
        });

        container.querySelectorAll('[data-action="reply"]').forEach(function (btn) {
            btn.addEventListener('click', function () {
                var rootCommentId = Number(btn.getAttribute('data-root-cid') || btn.getAttribute('data-cid'));
                var uid = btn.getAttribute('data-uid');
                _setReplyTarget(noticeId, rootCommentId, uid);
            });
        });

        container.querySelectorAll('.nc-reply-toggle-btn').forEach(function (btn) {
            btn.addEventListener('click', function () {
                var cid = Number(btn.getAttribute('data-cid'));
                _toggleReplies(noticeId, cid);
            });
        });
    }

    function _setReplyTarget(noticeId, commentId, uid) {
        var state = _getState(noticeId);
        if (!state.canComment) {
            _showToast(state.banReason ? ('评论资格已封禁：' + state.banReason) : '评论资格已被封禁');
            return;
        }
        state.replyingTo = commentId;
        state.expandedReplies[commentId] = true;

        var indicator = document.getElementById('nc-ri-' + noticeId);
        var nameEl = document.getElementById('nc-ri-name-' + noticeId);
        if (indicator) indicator.classList.add('nc-active');
        if (nameEl) nameEl.textContent = '用户#' + uid;

        var input = document.getElementById('nc-input-' + noticeId);
        if (input) {
            input.placeholder = '回复 用户#' + uid + '...';
            input.focus();
        }
    }

    function _cancelReply(noticeId) {
        var state = _getState(noticeId);
        state.replyingTo = null;

        var indicator = document.getElementById('nc-ri-' + noticeId);
        if (indicator) indicator.classList.remove('nc-active');

        var input = document.getElementById('nc-input-' + noticeId);
        if (input) input.placeholder = '添加评论...';
        _updateComposerState(noticeId);
    }

    function _toggleReplies(noticeId, commentId) {
        var state = _getState(noticeId);
        state.expandedReplies[commentId] = !state.expandedReplies[commentId];
        if (state.expandedReplies[commentId]) {
            _loadReplies(noticeId, commentId);
        }
        _renderComments(noticeId);
    }

    function _toggleLike(commentId, noticeId) {
        var baseUrl = _getBaseUrl();
        var hwid = _getHWID();
        if (!baseUrl || !hwid) return;

        _buildTelemetryHeaders('/notice-comment-like', 'POST', hwid, true).then(function (headers) {
            return fetch(baseUrl + '/notice-comment-like', {
                method: 'POST',
                headers: headers,
                body: JSON.stringify({ comment_id: commentId, machine_id: hwid })
            });
        }).then(function () {
            _loadComments(noticeId, { reset: true });
        }).catch(function () { });
    }

    function _toggleNoticeLike(noticeId) {
        if (!_isFeatureEnabled('notice_reaction_enabled')) return;
        _submitReaction(noticeId, LIKE_EMOJI);
    }

    function _submitComment(noticeId) {
        var baseUrl = _getBaseUrl();
        var hwid = _getHWID();
        var input = document.getElementById('nc-input-' + noticeId);
        var sendBtn = document.getElementById('nc-send-' + noticeId);
        if (!baseUrl || !hwid || !input) return;

        var state = _getState(noticeId);
        if (!state.canComment) {
            _showToast(state.banReason ? ('评论资格已封禁：' + state.banReason) : '评论资格已被封禁');
            return;
        }

        var content = input.value.trim();
        if (!content) return;

        var parentId = state.replyingTo || 0;

        if (sendBtn) sendBtn.disabled = true;

        _buildTelemetryHeaders('/notice-comment', 'POST', hwid, true).then(function (headers) {
            return fetch(baseUrl + '/notice-comment', {
                method: 'POST',
                headers: headers,
                body: JSON.stringify({
                    notice_id: Number(noticeId),
                    machine_id: hwid,
                    content: content,
                    parent_id: parentId
                })
            });
        }).then(function (r) { return r.json(); }).then(function (data) {
            if (data.status === 'success') {
                input.value = '';
                if (sendBtn) sendBtn.disabled = true;
                if (parentId > 0) {
                    state.expandedReplies[parentId] = true;
                    delete state.replyCache[parentId];
                }
                _cancelReply(noticeId);
                _loadComments(noticeId, { reset: true });
            } else {
                _showToast(data.error || '发送失败');
                if (sendBtn) sendBtn.disabled = false;
            }
        }).catch(function () {
            _showToast('网络错误，请重试');
            if (sendBtn) sendBtn.disabled = false;
        });
    }

    function _showToast(msg) {
        if (window.app && typeof window.app.showToast === 'function') {
            window.app.showToast(msg, 'error');
        } else if (window.app && typeof window.app.showAlert === 'function') {
            window.app.showAlert(msg, 'danger');
        } else if (window.showAlert && typeof window.showAlert === 'function') {
            window.showAlert('提示', msg, 'info');
        }
    }

    window.NoticeCommentPanel = {
        renderPanel: renderPanel
    };
})();
