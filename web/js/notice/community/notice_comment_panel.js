/* 公告社区评论面板 — 独立组件，挂载到 window.NoticeCommentPanel */
(function () {
    var REACTION_PALETTE = ['👍','❤️','😄','😮','🎉','🔥','😢','👀','👎','🤔','💯','🙏','✨','😂','🤣','😍','🥺','💀','😎','🫡'];
    var LIKE_EMOJI = '❤️';
    var MAX_VISIBLE_REACTIONS = 5;
    var LIKERS_MODAL_ID = 'nc-likers-modal';
    var DEFAULT_COMMENT_CHAR_LIMIT = 200;
    var MAX_COMPOSER_ROWS = 4;
    var REPLY_BATCH_SIZE = 10;

    function escapeHtml(v) {
        return String(v == null ? '' : v)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function timeAgo(dateStr) {
        if (!dateStr) return '';
        var d = new Date(dateStr.replace(' ', 'T') + '+08:00');
        if (!isFinite(d.getTime())) return '';
        var now = new Date();
        var diff = Math.floor((now - d) / 1000);
        var days = 0;
        function formatDate(date, includeYear) {
            var year = date.getFullYear();
            var month = date.getMonth() + 1;
            var day = date.getDate();
            return includeYear ? (year + '年' + month + '月' + day + '日') : (month + '月' + day + '日');
        }
        if (diff < 0) diff = 0;
        days = Math.floor(diff / 86400);
        if (diff < 60) return '刚刚';
        if (diff < 3600) return Math.floor(diff / 60) + '分钟前';
        if (diff <= 86400) return Math.floor(diff / 3600) + '小时前';
        if (days <= 3) return days + '天前';
        if (now.getFullYear() !== d.getFullYear()) return formatDate(d, true);
        return formatDate(d, false);
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

    function countCharacters(value) {
        return Array.from(String(value == null ? '' : value)).length;
    }

    function normalizeCommentCharLimit(value) {
        var limit = Number(value || 0);
        if (!isFinite(limit) || limit <= 0) return DEFAULT_COMMENT_CHAR_LIMIT;
        return Math.max(1, Math.round(limit));
    }

    function normalizeUidValue(uid) {
        var text = String(uid == null ? '' : uid).trim();
        return text || '?';
    }

    function normalizePublicNickname(value) {
        return String(value == null ? '' : value).trim();
    }

    function getPublicUserName(entry) {
        var nickname = normalizePublicNickname(entry && entry.nickname);
        var uid = normalizeUidValue(entry && entry.uid);
        return nickname || ('用户#' + uid);
    }

    function getPublicUserTitle(entry) {
        return getPublicUserName(entry);
    }

    function getReplyTargetPublicName(entry) {
        var replyNickname = normalizePublicNickname(entry && entry.reply_to_nickname);
        if (replyNickname) return replyNickname;
        var replyUid = normalizeUidValue(entry && entry.reply_to_uid);
        return replyUid === '?' ? '' : ('用户#' + replyUid);
    }

    function getUidLengthClass(uid) {
        var len = Array.from(normalizeUidValue(uid)).length;
        if (len >= 6) return 'nc-uid-len-6p';
        if (len === 5) return 'nc-uid-len-5';
        if (len === 4) return 'nc-uid-len-4';
        return '';
    }

    function renderUidAvatar(baseClass, uid, titleText) {
        var text = normalizeUidValue(uid);
        var lengthClass = getUidLengthClass(text);
        return '<div class="' + baseClass + (lengthClass ? (' ' + lengthClass) : '') + '"' +
            (titleText ? (' title="' + escapeHtml(titleText) + '"') : '') +
            '><span class="nc-uid-text">' + escapeHtml(text) + '</span></div>';
    }

    function applyUidAvatar(el, uid, titleText) {
        if (!el) return;
        var text = normalizeUidValue(uid);
        var lengthClass = getUidLengthClass(text);
        el.classList.remove('nc-uid-len-4', 'nc-uid-len-5', 'nc-uid-len-6p');
        if (lengthClass) el.classList.add(lengthClass);
        el.innerHTML = '<span class="nc-uid-text">' + escapeHtml(text) + '</span>';
        el.title = titleText || '';
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
                isAppendingComments: false,
                viewerIsAdmin: false,
                showWeightScore: false,
                commentCharLimit: DEFAULT_COMMENT_CHAR_LIMIT,
                banExpiresAt: '',
                commentLoadError: '',
                isSubmittingReaction: false,
                reactionLoadToken: 0,
                pendingCommentLikes: {},
                localPinnedComments: {},
                localPinnedCommentOrder: []
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

    function _hydrateClientContext(forceReady) {
        var needsBaseUrl = !window._telemetryBaseUrl;
        var needsHwid = !window._telemetryHWID;
        var needsSeqId = !window._userSeqId;
        if (!forceReady && !needsBaseUrl && !needsHwid && !needsSeqId) {
            return Promise.resolve();
        }
        if (!(window.pywebview && window.pywebview.api)) {
            return Promise.resolve();
        }
        var loader = forceReady && typeof window.pywebview.api.ensure_telemetry_ready === 'function'
            ? function () { return window.pywebview.api.ensure_telemetry_ready(2500); }
            : (typeof window.pywebview.api.init_app_state === 'function'
                ? function () { return window.pywebview.api.init_app_state(); }
                : null);
        if (!loader) {
            return Promise.resolve();
        }
        return loader().then(function (state) {
            if (!state || typeof state !== 'object') return;
            if (state.telemetry_base_url) window._telemetryBaseUrl = state.telemetry_base_url;
            if (state.hwid) window._telemetryHWID = state.hwid;
            if (state.user_seq_id) window._userSeqId = state.user_seq_id;
        }).catch(function () {
            return null;
        });
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

    function _parseJsonResponse(response, fallbackMessage) {
        if (window.NoticeClientHelper && typeof window.NoticeClientHelper.parseJsonResponse === 'function') {
            return window.NoticeClientHelper.parseJsonResponse(response, fallbackMessage);
        }
        if (!response) {
            return Promise.reject(new Error(fallbackMessage || '请求失败'));
        }
        return response.json().catch(function () {
            return {};
        }).then(function (data) {
            if (response.ok) {
                return data;
            }
            var error = new Error((data && data.error) || fallbackMessage || ('请求失败（' + response.status + '）'));
            error.status = response.status;
            error.payload = data;
            throw error;
        });
    }

    function _shouldRetryWithTelemetry(error) {
        if (window.NoticeClientHelper && typeof window.NoticeClientHelper.shouldRetryWithTelemetry === 'function') {
            return window.NoticeClientHelper.shouldRetryWithTelemetry(error);
        }
        var status = Number(error && error.status || 0);
        var message = String(error && error.message || '');
        if (status !== 403) return false;
        return /设备令牌|访问被拒绝|设备绑定/.test(message);
    }

    function _requestJsonWithTelemetryRetry(requestFactory, fallbackMessage) {
        return Promise.resolve().then(function () {
            return requestFactory();
        }).then(function (response) {
            return _parseJsonResponse(response, fallbackMessage);
        }).catch(function (error) {
            var message = String(error && error.message || '');
            var shouldRetry = _shouldRetryWithTelemetry(error) ||
                (!Number(error && error.status || 0) && /Failed to fetch|NetworkError|Load failed|fetch failed|无法连接到服务器/i.test(message));
            if (!shouldRetry) {
                if (window.NoticeClientHelper && typeof window.NoticeClientHelper.decorateError === 'function') {
                    throw window.NoticeClientHelper.decorateError(error, fallbackMessage);
                }
                throw error;
            }
            return _hydrateClientContext(true).then(function () {
                return requestFactory();
            }).then(function (response) {
                return _parseJsonResponse(response, fallbackMessage);
            }).catch(function (retryError) {
                if (window.NoticeClientHelper && typeof window.NoticeClientHelper.decorateError === 'function') {
                    throw window.NoticeClientHelper.decorateError(retryError, fallbackMessage);
                }
                throw retryError;
            });
        });
    }

    function _isServerBackedNoticeId(noticeId) {
        var text = String(noticeId == null ? '' : noticeId).trim();
        if (!/^\d+$/.test(text)) return false;
        return Number(text) > 0;
    }

    function _isFeatureEnabled(key) {
        var flags = window._aimerUserFeatures || {};
        return flags[key] !== false;
    }

    function _getVisibleReactionLimit(noticeId) {
        var row = document.getElementById('nc-rr-' + noticeId);
        var panel = row ? row.closest('.nc-panel') : null;
        var panelWidth = panel ? panel.clientWidth : 0;
        if (panelWidth && panelWidth <= 340) return 3;
        return panelWidth && panelWidth <= 400 ? 4 : MAX_VISIBLE_REACTIONS;
    }

    function _getCommentCharLimit(noticeId) {
        var state = _getState(noticeId);
        return normalizeCommentCharLimit(state.commentCharLimit);
    }

    function _getRemainingCommentChars(noticeId) {
        var input = document.getElementById('nc-input-' + noticeId);
        return _getCommentCharLimit(noticeId) - countCharacters(input ? input.value : '');
    }

    function _animateReactionToggle(noticeId, reactions, expand) {
        var state = _getState(noticeId);
        document.querySelectorAll('.nc-emoji-picker.show').forEach(function (picker) {
            picker.classList.remove('show');
        });
        state.reactionsExpanded = expand;
        _renderReactions(noticeId, reactions);
    }

    function _normalizeLiker(entry) {
        if (entry && typeof entry === 'object') {
            return {
                uid: String(entry.uid || '?'),
                alias: String(entry.alias || ''),
                nickname: String(entry.nickname || '')
            };
        }
        return {
            uid: String(entry || '?'),
            alias: '',
            nickname: ''
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
                var uid = normalizeUidValue(user.uid);
                var publicName = getPublicUserName(user);
                var subtitle = normalizePublicNickname(user.nickname) ? ('用户#' + uid) : '未设置显示名称';
                return '<div class="nc-likers-item">' +
                    '  ' + renderUidAvatar('nc-likers-avatar', uid, getPublicUserTitle(user)) +
                    '  <div class="nc-likers-meta">' +
                    '    <div class="nc-likers-name">' + escapeHtml(publicName) + '</div>' +
                    '    <div class="nc-likers-alias">' + escapeHtml(subtitle) + '</div>' +
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
        if (state.commentLoadError && !state.comments.length) {
            return '<div class="nc-comment-error"><i class="ri-error-warning-line"></i><span>' + escapeHtml(state.commentLoadError) + '</span><button class="nc-comment-retry-btn" type="button" data-action="retry-comments">重试</button></div>';
        }
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
        _hydrateClientContext(true).finally(function () {
            _renderPanelResolved(noticeId, container);
        });
    }

    function _renderPanelResolved(noticeId, container) {
        if (!container || !noticeId) return;
        var id = noticeId;
        _panelState[id] = null;
        container.setAttribute('data-nc-notice-id', id);

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
        if (!_isServerBackedNoticeId(id)) {
            container.classList.add('nc-offline');
            container.innerHTML =
                '<div class="nc-offline-wrap">' +
                '  <div class="nc-offline-icon"><i class="ri-chat-off-line"></i></div>' +
                '  <div class="nc-offline-title">当前公告暂不支持评论</div>' +
                '  <div class="nc-offline-desc">这条公告还没有绑定服务端评论主题，因此无法加载评论区</div>' +
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
            '  <div class="nc-input-main">' +
            '    <textarea class="nc-input-field" id="nc-input-' + id + '" rows="1" placeholder="添加评论..."></textarea>' +
            '    <div class="nc-input-meta">' +
            '      <span class="nc-input-counter" id="nc-counter-' + id + '"></span>' +
            '    </div>' +
            '  </div>' +
            '  <button class="nc-send-btn" id="nc-send-' + id + '" disabled><i class="ri-send-plane-2-fill"></i></button>' +
            '</div>';

        var state = _getState(id);
        state.commentLimit = _estimateCommentPageSize(id);

        var myUid = _getUserSeqId();
        var avatarEl = document.getElementById('nc-my-avatar-' + id);
        applyUidAvatar(avatarEl, myUid || '?', myUid ? ('用户#' + normalizeUidValue(myUid)) : '');

        var input = document.getElementById('nc-input-' + id);
        var sendBtn = document.getElementById('nc-send-' + id);
        if (input && sendBtn) {
            input.addEventListener('input', function () {
                _updateComposerState(id);
            });
            input.addEventListener('keydown', function (e) {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.isComposing && input.value.trim()) {
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

        _updateComposerState(id);
        _syncComposerHeight(id);
        _ensureCommentScroll(id);
        if (reactionEnabled) {
            _loadReactions(id);
        }
        requestAnimationFrame(function () {
            state.commentLimit = _estimateCommentPageSize(id);
            _loadComments(id, { reset: true });
        });
    }

    function _loadReactions(noticeId, options) {
        options = options || {};
        if (!_isFeatureEnabled('notice_reaction_enabled')) {
            _renderReactions(noticeId, []);
            return;
        }
        var state = _getState(noticeId);
        var baseUrl = _getBaseUrl();
        var hwid = _getHWID();
        if (!baseUrl) {
            _renderReactionsFromGlobal(noticeId);
            return;
        }
        var url = baseUrl + '/notice-reactions/' + noticeId;
        if (hwid) url += '?machine_id=' + encodeURIComponent(hwid);
        url += (url.indexOf('?') === -1 ? '?' : '&') + '_t=' + Date.now();
        state.reactionLoadToken += 1;
        var loadToken = state.reactionLoadToken;

        _requestJsonWithTelemetryRetry(function () {
            return _buildTelemetryHeaders('/notice-reactions/' + noticeId, 'GET', hwid, false).then(function (headers) {
                return fetch(url, { method: 'GET', headers: headers, cache: 'no-store' });
            });
        }, '加载互动数据失败').then(function (data) {
            if (loadToken !== state.reactionLoadToken) return;
            var reactions = Array.isArray(data && data.reactions) ? data.reactions : [];
            if (window.NoticeClientHelper && typeof window.NoticeClientHelper.cacheReactions === 'function') {
                reactions = window.NoticeClientHelper.cacheReactions(noticeId, reactions);
            }
            _renderReactions(noticeId, reactions);
        }).catch(function () {
            if (loadToken !== state.reactionLoadToken) return;
            if (options.keepCurrentOnFailure && window.NoticeClientHelper && typeof window.NoticeClientHelper.getCachedReactions === 'function') {
                var cached = window.NoticeClientHelper.getCachedReactions(noticeId);
                if (cached) {
                    _renderReactions(noticeId, cached);
                    return;
                }
            }
            _renderReactions(noticeId, []);
        });
    }

    function _renderReactionsFromGlobal(noticeId) {
        var reactions = window.NoticeClientHelper && typeof window.NoticeClientHelper.getSummaryReactions === 'function'
            ? window.NoticeClientHelper.getSummaryReactions(noticeId)
            : [];
        if ((!reactions || !reactions.length) && Array.isArray(window._noticeReactionsData)) {
            window._noticeReactionsData.forEach(function (r) {
                if (String(r.notice_id) !== String(noticeId)) return;
                reactions.push({ emoji: r.emoji, count: r.count || 0, users: [], reacted: false });
            });
        }
        if (window.NoticeClientHelper && typeof window.NoticeClientHelper.cacheReactions === 'function') {
            reactions = window.NoticeClientHelper.cacheReactions(noticeId, reactions);
        }
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
                return getPublicUserName(u);
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

        row.innerHTML =
            '<div class="nc-reaction-list' + (state.reactionsExpanded ? ' nc-expanded' : '') + '">' + pills + '</div>' +
            '<div class="nc-reaction-tools">' +
            moreBtn +
            '<div class="nc-picker-wrap">' +
            '  <button class="nc-add-reaction-btn" id="nc-add-r-' + noticeId + '" type="button" title="添加表情">😀</button>' +
            '  <div class="nc-emoji-picker" id="nc-picker-' + noticeId + '">' + pickerItems + '</div>' +
            '</div>' +
            '</div>';

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
        var state = _getState(noticeId);
        if (!baseUrl) {
            _showToast('未连接服务器');
            return;
        }
        if (!hwid) {
            _showToast('客户端身份未就绪，请稍后重试');
            return;
        }
        if (state.isSubmittingReaction) return;

        var previousReactions = window.NoticeClientHelper
            ? (window.NoticeClientHelper.getCachedReactions(noticeId) ||
                window.NoticeClientHelper.getSummaryReactions(noticeId) ||
                [])
            : [];
        var optimisticReactions = window.NoticeClientHelper && typeof window.NoticeClientHelper.buildOptimisticReactions === 'function'
            ? window.NoticeClientHelper.buildOptimisticReactions(previousReactions, emoji)
            : previousReactions;
        state.isSubmittingReaction = true;
        // 作废旧的表情加载结果，避免刚切换成功又被旧快照覆盖。
        state.reactionLoadToken += 1;
        _renderReactions(noticeId, optimisticReactions);

        _requestJsonWithTelemetryRetry(function () {
            return _buildTelemetryHeaders('/notice-reaction', 'POST', hwid, true).then(function (headers) {
                return fetch(baseUrl + '/notice-reaction', {
                    method: 'POST',
                    headers: headers,
                    body: JSON.stringify({ notice_id: Number(noticeId), machine_id: hwid, emoji: emoji })
                });
            });
        }, '提交表情互动失败').then(function () {
            _loadReactions(noticeId, { keepCurrentOnFailure: true });
        }).catch(function (err) {
            _renderReactions(noticeId, previousReactions);
            _showToast((err && err.message) || '表情互动失败，请稍后重试');
        }).finally(function () {
            state.isSubmittingReaction = false;
        });
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
            state.commentLoadError = '';
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
        if (!baseUrl) {
            state.isLoadingComments = false;
            state.isAppendingComments = false;
            _renderComments(noticeId);
            return;
        }

        var offset = append ? state.commentOffset : 0;
        var url = baseUrl + '/notice-comments/' + noticeId +
            '?offset=' + encodeURIComponent(offset) +
            '&limit=' + encodeURIComponent(state.commentLimit);
        if (hwid) url += '&machine_id=' + encodeURIComponent(hwid);

        _requestJsonWithTelemetryRetry(function () {
            return _buildTelemetryHeaders('/notice-comments/' + noticeId, 'GET', hwid, false).then(function (headers) {
                return fetch(url, { method: 'GET', headers: headers, cache: 'no-store' });
            });
        }, '评论加载失败，请稍后重试').then(function (data) {
            var incoming = Array.isArray(data.comments) ? data.comments : [];
            state.commentLoadError = '';
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
            state.banExpiresAt = data.ban_expires_at || '';
            state.viewerIsAdmin = data.viewer_is_admin === true || data.show_weight_score === true;
            state.showWeightScore = data.show_weight_score === true;
            state.commentCharLimit = normalizeCommentCharLimit(data.comment_limit_chars);
            _renderComments(noticeId);
            _updateStats(noticeId);
            _updateComposerState(noticeId);
        }).catch(function (err) {
            state.commentLoadError = (err && err.message) || '评论加载失败，请稍后重试';
            _showToast(state.commentLoadError);
            state.totalCount = 0;
            state.totalLikes = 0;
            state.noticeLikeCount = 0;
            state.noticeLiked = false;
            state.noticeLikers = [];
            _updateStats(noticeId);
        }).finally(function () {
            state.isLoadingComments = false;
            state.isAppendingComments = false;
            _renderComments(noticeId);
        });
    }

    function _loadReplies(noticeId, commentId) {
        var baseUrl = _getBaseUrl();
        var hwid = _getHWID();
        var state = _getState(noticeId);
        var replyState = state.replyCache[commentId] || { items: [], loading: false, loaded: false, visibleCount: REPLY_BATCH_SIZE };
        if (replyState.loading || replyState.loaded) return;

        if (!baseUrl) {
            replyState.loading = false;
            _renderComments(noticeId);
            return;
        }

        replyState.loading = true;
        state.replyCache[commentId] = replyState;
        _renderComments(noticeId);

        var url = baseUrl + '/notice-comments/' + noticeId + '/replies/' + commentId;
        if (hwid) url += '?machine_id=' + encodeURIComponent(hwid);

        _requestJsonWithTelemetryRetry(function () {
            return _buildTelemetryHeaders('/notice-comments/' + noticeId + '/replies/' + commentId, 'GET', hwid, false).then(function (headers) {
                return fetch(url, { method: 'GET', headers: headers, cache: 'no-store' });
            });
        }, '回复加载失败，请稍后重试').then(function (data) {
            replyState.items = Array.isArray(data.replies) ? data.replies : [];
            replyState.loaded = true;
            replyState.visibleCount = Math.min(REPLY_BATCH_SIZE, replyState.items.length || REPLY_BATCH_SIZE);
            state.viewerIsAdmin = data.viewer_is_admin === true || data.show_weight_score === true;
            if (typeof data.show_weight_score === 'boolean') {
                state.showWeightScore = data.show_weight_score === true;
            }
            if (data.comment_limit_chars != null) {
                state.commentCharLimit = normalizeCommentCharLimit(data.comment_limit_chars);
            }
        }).catch(function (err) {
            _showToast((err && err.message) || '回复加载失败，请稍后重试');
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

    function _findCommentById(noticeId, commentId) {
        var state = _getState(noticeId);
        for (var i = 0; i < state.comments.length; i++) {
            if (Number(state.comments[i].id) === Number(commentId)) {
                return state.comments[i];
            }
            var topReplies = Array.isArray(state.comments[i].top_replies) ? state.comments[i].top_replies : [];
            for (var j = 0; j < topReplies.length; j++) {
                if (Number(topReplies[j].id) === Number(commentId)) {
                    return topReplies[j];
                }
            }
        }
        var replyKeys = Object.keys(state.replyCache || {});
        for (var k = 0; k < replyKeys.length; k++) {
            var replyState = state.replyCache[replyKeys[k]];
            if (!replyState || !Array.isArray(replyState.items)) continue;
            for (var m = 0; m < replyState.items.length; m++) {
                if (Number(replyState.items[m].id) === Number(commentId)) {
                    return replyState.items[m];
                }
            }
        }
        return null;
    }

    function _upsertLocalPinnedComment(noticeId, comment) {
        if (!comment || Number(comment.parent_id || 0) !== 0 || !comment.id) return;
        var state = _getState(noticeId);
        state.localPinnedComments[comment.id] = comment;
        state.localPinnedCommentOrder = state.localPinnedCommentOrder.filter(function (id) {
            return Number(id) !== Number(comment.id);
        });
        state.localPinnedCommentOrder.unshift(comment.id);
    }

    function _removeLocalPinnedComment(noticeId, commentId) {
        var state = _getState(noticeId);
        delete state.localPinnedComments[commentId];
        state.localPinnedCommentOrder = state.localPinnedCommentOrder.filter(function (id) {
            return Number(id) !== Number(commentId);
        });
    }

    function _getDisplayComments(state) {
        var display = [];
        var seen = {};
        state.localPinnedCommentOrder.forEach(function (id) {
            var item = state.localPinnedComments[id];
            if (!item) return;
            display.push(item);
            seen[item.id] = true;
        });
        state.comments.forEach(function (item) {
            if (seen[item.id]) {
                state.localPinnedComments[item.id] = item;
                return;
            }
            display.push(item);
            seen[item.id] = true;
        });
        return display;
    }

    function _syncComposerHeight(noticeId) {
        var input = document.getElementById('nc-input-' + noticeId);
        if (!input) return;

        input.style.height = 'auto';
        var style = window.getComputedStyle(input);
        var lineHeight = parseFloat(style.lineHeight) || 18;
        var paddingTop = parseFloat(style.paddingTop) || 0;
        var paddingBottom = parseFloat(style.paddingBottom) || 0;
        var borderTop = parseFloat(style.borderTopWidth) || 0;
        var borderBottom = parseFloat(style.borderBottomWidth) || 0;
        var maxHeight = (lineHeight * MAX_COMPOSER_ROWS) + paddingTop + paddingBottom + borderTop + borderBottom;
        var nextHeight = Math.min(input.scrollHeight, maxHeight);

        input.style.height = Math.max(nextHeight, lineHeight + paddingTop + paddingBottom + borderTop + borderBottom) + 'px';
        input.style.overflowY = input.scrollHeight > maxHeight ? 'auto' : 'hidden';
    }

    function _updateComposerState(noticeId) {
        var state = _getState(noticeId);
        var input = document.getElementById('nc-input-' + noticeId);
        var sendBtn = document.getElementById('nc-send-' + noticeId);
        if (!input || !sendBtn) return;

        var charLimit = _getCommentCharLimit(noticeId);

        if (!state.canComment) {
            input.value = '';
            input.disabled = true;
            input.placeholder = state.banExpiresAt
                ? ('评论资格已封禁至 ' + state.banExpiresAt + (state.banReason ? ('：' + state.banReason) : ''))
                : (state.banReason ? ('评论资格已封禁：' + state.banReason) : '评论资格已被封禁');
            sendBtn.disabled = true;
            _syncComposerHeight(noticeId);
            _updateComposerCounter(noticeId);
            return;
        }

        input.disabled = false;
        if (!state.replyingTo) {
            input.placeholder = '添加评论...';
        }
        sendBtn.disabled = !input.value.trim() || _getRemainingCommentChars(noticeId) < 0;
        _syncComposerHeight(noticeId);
        _updateComposerCounter(noticeId);
    }

    function _updateComposerCounter(noticeId) {
        var counter = document.getElementById('nc-counter-' + noticeId);
        var input = document.getElementById('nc-input-' + noticeId);
        if (!counter || !input) return;

        var remaining = _getRemainingCommentChars(noticeId);
        var charLimit = _getCommentCharLimit(noticeId);
        var shouldShow = !input.disabled && (countCharacters(input.value) >= Math.max(charLimit - 20, 0) || remaining < 0);

        counter.textContent = shouldShow ? String(remaining) : '';
        counter.classList.toggle('nc-warn', shouldShow && remaining <= 10 && remaining > 5);
        counter.classList.toggle('nc-danger', shouldShow && remaining <= 5 && remaining >= 0);
        counter.classList.toggle('nc-over', shouldShow && remaining < 0);
    }

    function _renderComments(noticeId) {
        var list = document.getElementById('nc-cl-' + noticeId);
        if (!list) return;
        var state = _getState(noticeId);
        var displayComments = _getDisplayComments(state);

        if (!displayComments.length && !state.isLoadingComments) {
            list.innerHTML = _renderCommentFooter(state);
            return;
        }

        var html = displayComments.map(function (c) {
            return _renderCommentItem(c, noticeId);
        }).join('') + _renderCommentFooter(state);
        list.innerHTML = html;
        _bindCommentEvents(list, noticeId);
        displayComments.forEach(function (comment) {
            if (!state.expandedReplies[comment.id] || Number(comment.reply_count || 0) <= 0) return;
            var replyState = state.replyCache[comment.id];
            if (!replyState || (!replyState.loaded && !replyState.loading)) {
                _loadReplies(noticeId, comment.id);
            }
        });
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
        var uid = normalizeUidValue(c.uid);
        var publicName = getPublicUserName(c);
        var replyCount = Number(c.reply_count || 0);
        var isExpanded = !!state.expandedReplies[c.id];
        var replyState = state.replyCache[c.id] || { items: [], loading: false, loaded: false, visibleCount: REPLY_BATCH_SIZE };
        var repliesHtml = '';

        if (replyCount > 0) {
            if (!isExpanded) {
                // 未展开：显示预览子评论（最多2条高权重）
                var topReplies = Array.isArray(c.top_replies) ? c.top_replies : [];
                if (topReplies.length > 0) {
                    repliesHtml += '<div class="nc-preview-replies">';
                    repliesHtml += topReplies.slice(0, 2).map(function (r) {
                        var rUid = r.uid || '?';
                        var rName = escapeHtml(getPublicUserName(r));
                        var rContent = _renderReplyPreviewContent(r);
                        var likeCount = Number(r.like_count || 0);
                        var likeHtml = '<button class="nc-preview-reply-like' + (r.liked ? ' nc-liked' : '') + '" type="button" data-action="like" data-cid="' + r.id + '">' +
                            '<i class="' + (r.liked ? 'ri-heart-fill' : 'ri-heart-line') + '"></i>' +
                            '<span>' + likeCount + '</span>' +
                            '</button>';
                        var moreHtml = '<button class="nc-preview-reply-more" type="button" data-action="more" data-cid="' + r.id + '" title="更多操作"><i class="ri-more-fill"></i></button>';
                        return '<div class="nc-preview-reply">' +
                            '<span class="nc-preview-reply-name">' + rName + '：</span>' +
                            '<span class="nc-preview-reply-content">' + rContent + '</span>' +
                            likeHtml +
                            moreHtml + '</div>';
                    }).join('');
                    repliesHtml += '</div>';
                }
                // "共X条回复 >" 链接
                repliesHtml += '<div class="nc-reply-toggle" style="padding-left:36px;"><button class="nc-reply-total-link" data-cid="' + c.id + '" data-nid="' + noticeId + '">共' + replyCount + '条回复 <i class="ri-arrow-right-s-line"></i></button></div>';
            } else {
                // 已展开：显示完整回复列表
                if (replyState.loading) {
                    repliesHtml += '<div class="nc-replies-wrap nc-open"><div class="nc-reply-loading"><i class="ri-loader-4-line"></i><span>正在加载回复...</span></div></div>';
                } else if (replyState.loaded && replyState.items.length) {
                    var visibleCount = Math.max(0, Math.min(Number(replyState.visibleCount || REPLY_BATCH_SIZE), replyState.items.length));
                    var visibleReplies = replyState.items.slice(0, visibleCount);
                    repliesHtml += '<div class="nc-replies-wrap nc-open">';
                    repliesHtml += visibleReplies.map(function (r) {
                        return _renderReplyItem(r, noticeId);
                    }).join('');
                    if (replyState.items.length > visibleCount) {
                        repliesHtml += '<button class="nc-reply-more-btn" type="button" data-cid="' + c.id + '" data-nid="' + noticeId + '">查看剩余 ' + (replyState.items.length - visibleCount) + ' 条回复</button>';
                    }
                    repliesHtml += '</div>';
                } else if (replyState.loaded) {
                    repliesHtml += '<div class="nc-replies-wrap nc-open"><div class="nc-reply-loading"><span>暂时还没有可显示的回复</span></div></div>';
                }
                // 展开状态下的收起按钮
                repliesHtml += '<div class="nc-reply-toggle" style="padding-left:36px;"><button class="nc-reply-total-link" data-cid="' + c.id + '" data-nid="' + noticeId + '">收起回复</button></div>';
            }
        }

        var selfBadge = (String(_getUserSeqId()) === String(uid) && uid !== '?') ? '<span class="nc-self-badge">我</span>' : '';

        return '<div class="nc-comment-item" data-comment-id="' + c.id + '">' +
            '<div class="nc-comment-head">' +
            '  ' + renderUidAvatar('nc-comment-avatar', uid, getPublicUserTitle(c)) +
            '  <span class="nc-comment-uid">' + escapeHtml(publicName) + '</span>' +
            selfBadge +
            _renderTagBadges(c.tags) +
            (state.showWeightScore ? ('  <span class="nc-comment-score">权重 ' + escapeHtml(formatWeight(c.weight_score || 0)) + '</span>') : '') +
            '  <span class="nc-comment-time">' + timeAgo(c.created_at) + '</span>' +
            '</div>' +
            '<div class="nc-comment-body">' + escapeHtml(c.content) + '</div>' +
            '<div class="nc-comment-actions">' +
            '  <button class="nc-action-btn' + (c.liked ? ' nc-liked' : '') + '" data-action="like" data-cid="' + c.id + '"><i class="' + (c.liked ? 'ri-heart-fill' : 'ri-heart-line') + '"></i> ' + (c.like_count || '') + '</button>' +
            '  <button class="nc-action-btn" data-action="reply" data-cid="' + c.id + '" data-root-cid="' + c.id + '" data-target-cid="' + c.id + '" data-uid="' + escapeHtml(uid) + '" data-name="' + escapeHtml(publicName) + '">回复</button>' +
            '  <span class="nc-more-dots" data-action="more" data-cid="' + c.id + '"><i class="ri-more-fill"></i></span>' +
            '</div>' +
            repliesHtml +
            '</div>';
    }

    function _renderReplyItem(r, noticeId) {
        var state = _getState(noticeId);
        var uid = normalizeUidValue(r.uid);
        var publicName = getPublicUserName(r);
        var bodyHtml = _renderReplyBody(r);
        var selfBadge = (String(_getUserSeqId()) === String(uid) && uid !== '?') ? '<span class="nc-self-badge">我</span>' : '';
        return '<div class="nc-reply-item" data-comment-id="' + r.id + '">' +
            '<div class="nc-reply-head">' +
            '  ' + renderUidAvatar('nc-reply-avatar', uid, getPublicUserTitle(r)) +
            '  <span class="nc-reply-uid">' + escapeHtml(publicName) + '</span>' +
            selfBadge +
            _renderTagBadges(r.tags) +
            (state.showWeightScore ? ('  <span class="nc-comment-score nc-reply-score">权重 ' + escapeHtml(formatWeight(r.weight_score || 0)) + '</span>') : '') +
            '  <span class="nc-reply-time">' + timeAgo(r.created_at) + '</span>' +
            '</div>' +
            '<div class="nc-reply-body">' + bodyHtml + '</div>' +
            '<div class="nc-reply-actions">' +
            '  <button class="nc-action-btn' + (r.liked ? ' nc-liked' : '') + '" data-action="like" data-cid="' + r.id + '"><i class="' + (r.liked ? 'ri-heart-fill' : 'ri-heart-line') + '"></i> ' + (r.like_count || '') + '</button>' +
            '  <button class="nc-action-btn" data-action="reply" data-cid="' + r.id + '" data-root-cid="' + r.parent_id + '" data-target-cid="' + r.id + '" data-uid="' + escapeHtml(uid) + '" data-name="' + escapeHtml(publicName) + '">回复</button>' +
            '  <span class="nc-more-dots" data-action="more" data-cid="' + r.id + '"><i class="ri-more-fill"></i></span>' +
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
                var targetCommentId = Number(btn.getAttribute('data-target-cid') || btn.getAttribute('data-cid'));
                var uid = btn.getAttribute('data-uid');
                var publicName = btn.getAttribute('data-name');
                _setReplyTarget(noticeId, rootCommentId, targetCommentId, uid, publicName);
            });
        });

        container.querySelectorAll('.nc-reply-toggle-btn').forEach(function (btn) {
            btn.addEventListener('click', function () {
                var cid = Number(btn.getAttribute('data-cid'));
                _toggleReplies(noticeId, cid);
            });
        });

        // "共X条回复" 和 "收起回复" 链接
        container.querySelectorAll('.nc-reply-total-link').forEach(function (btn) {
            btn.addEventListener('click', function () {
                var cid = Number(btn.getAttribute('data-cid'));
                _toggleReplies(noticeId, cid);
            });
        });

        container.querySelectorAll('.nc-reply-more-btn').forEach(function (btn) {
            btn.addEventListener('click', function () {
                var cid = Number(btn.getAttribute('data-cid'));
                _showMoreReplies(noticeId, cid);
            });
        });

        container.querySelectorAll('[data-action="more"]').forEach(function (dots) {
            dots.addEventListener('click', function (e) {
                e.stopPropagation();
                var cid = Number(dots.getAttribute('data-cid'));
                _showMoreMenu(dots, cid, noticeId);
            });
        });

        container.querySelectorAll('[data-action="retry-comments"]').forEach(function (btn) {
            btn.addEventListener('click', function () {
                _loadComments(noticeId, { reset: true });
            });
        });
    }

    function _setReplyTarget(noticeId, rootCommentId, targetCommentId, uid, publicName) {
        var state = _getState(noticeId);
        if (!state.canComment) {
            _showToast(state.banReason ? ('评论资格已封禁：' + state.banReason) : '评论资格已被封禁');
            return;
        }
        var replyName = normalizePublicNickname(publicName) || ('用户#' + normalizeUidValue(uid));
        state.replyingTo = {
            rootId: rootCommentId,
            targetId: targetCommentId,
            uid: uid,
            publicName: replyName
        };
        state.expandedReplies[rootCommentId] = true;

        var indicator = document.getElementById('nc-ri-' + noticeId);
        var nameEl = document.getElementById('nc-ri-name-' + noticeId);
        if (indicator) indicator.classList.add('nc-active');
        if (nameEl) nameEl.textContent = '@' + replyName;

        var input = document.getElementById('nc-input-' + noticeId);
        if (input) {
            input.placeholder = '回复 @' + replyName + '...';
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
            if (state.replyCache[commentId] && state.replyCache[commentId].loaded) {
                state.replyCache[commentId].visibleCount = Math.min(REPLY_BATCH_SIZE, state.replyCache[commentId].items.length || REPLY_BATCH_SIZE);
            }
            _loadReplies(noticeId, commentId);
        }
        _renderComments(noticeId);
    }

    function _showMoreReplies(noticeId, commentId) {
        var state = _getState(noticeId);
        var replyState = state.replyCache[commentId];
        if (!replyState || !replyState.loaded || !Array.isArray(replyState.items)) return;
        replyState.visibleCount = Math.min(replyState.items.length, Number(replyState.visibleCount || REPLY_BATCH_SIZE) + REPLY_BATCH_SIZE);
        _renderComments(noticeId);
    }

    function _toggleLike(commentId, noticeId) {
        var baseUrl = _getBaseUrl();
        var hwid = _getHWID();
        if (!baseUrl) {
            _showToast('未连接服务器');
            return;
        }
        if (!hwid) {
            _showToast('客户端身份未就绪，请稍后重试');
            return;
        }

        // 乐观更新：立即切换UI状态
        var state = _getState(noticeId);
        if (state.pendingCommentLikes[commentId]) return;
        var allItems = state.comments.slice();
        state.comments.forEach(function (comment) {
            if (Array.isArray(comment.top_replies) && comment.top_replies.length) {
                allItems = allItems.concat(comment.top_replies);
            }
        });
        // 也检查回复缓存
        Object.keys(state.replyCache).forEach(function (key) {
            var rc = state.replyCache[key];
            if (rc && rc.items) allItems = allItems.concat(rc.items);
        });
        var target = null;
        for (var i = 0; i < allItems.length; i++) {
            if (allItems[i].id === commentId) { target = allItems[i]; break; }
        }
        if (target) {
            var wasLiked = !!target.liked;
            target.liked = !wasLiked;
            target.like_count = Math.max(0, (target.like_count || 0) + (wasLiked ? -1 : 1));
            _renderComments(noticeId);
        }
        state.pendingCommentLikes[commentId] = true;

        _requestJsonWithTelemetryRetry(function () {
            return _buildTelemetryHeaders('/notice-comment-like', 'POST', hwid, true).then(function (headers) {
                return fetch(baseUrl + '/notice-comment-like', {
                    method: 'POST',
                    headers: headers,
                    body: JSON.stringify({ comment_id: commentId, machine_id: hwid })
                });
            });
        }, '点赞失败，请重试').then(function (data) {
            // 用后端返回的精确数据同步权重
            if (target && data) {
                if (typeof data.like_count === 'number') target.like_count = data.like_count;
                if (typeof data.liked !== 'undefined') target.liked = !!data.liked;
                if (typeof data.weight_score !== 'undefined') target.weight_score = data.weight_score;
                _renderComments(noticeId);
            } else {
                _loadComments(noticeId, { reset: true });
            }
        }).catch(function (err) {
            // 失败时回滚
            if (target) {
                target.liked = !target.liked;
                target.like_count = Math.max(0, (target.like_count || 0) + (target.liked ? 1 : -1));
                _renderComments(noticeId);
            }
            _showToast((err && err.message) || '点赞失败，请重试');
        }).finally(function () {
            delete state.pendingCommentLikes[commentId];
        });
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
        if (!input) return;
        if (!baseUrl) {
            _showToast('未连接服务器');
            return;
        }
        if (!hwid) {
            _showToast('客户端身份未就绪，请稍后重试');
            return;
        }

        var state = _getState(noticeId);
        if (!state.canComment) {
            _showToast(state.banReason ? ('评论资格已封禁：' + state.banReason) : '评论资格已被封禁');
            return;
        }

        var content = input.value.trim();
        if (!content) return;
        var charLimit = _getCommentCharLimit(noticeId);
        if (countCharacters(content) > charLimit) {
            _showToast('当前用户组评论最多允许 ' + charLimit + ' 字');
            _updateComposerState(noticeId);
            return;
        }

        var parentId = state.replyingTo ? Number(state.replyingTo.rootId || 0) : 0;
        var replyToId = state.replyingTo ? Number(state.replyingTo.targetId || 0) : 0;

        if (sendBtn) sendBtn.disabled = true;

        _requestJsonWithTelemetryRetry(function () {
            return _buildTelemetryHeaders('/notice-comment', 'POST', hwid, true).then(function (headers) {
                return fetch(baseUrl + '/notice-comment', {
                    method: 'POST',
                    headers: headers,
                    body: JSON.stringify({
                        notice_id: Number(noticeId),
                        machine_id: hwid,
                        content: content,
                        parent_id: parentId,
                        reply_to_id: replyToId
                    })
                });
            });
        }, '发送失败').then(function (data) {
            if (data.status === 'success') {
                input.value = '';
                if (sendBtn) sendBtn.disabled = true;
                if (data.comment) {
                    state.totalCount = Number(state.totalCount || 0) + 1;
                    if (parentId === 0) {
                        _upsertLocalPinnedComment(noticeId, data.comment);
                    }
                }
                if (parentId > 0) {
                    state.expandedReplies[parentId] = true;
                    delete state.replyCache[parentId];
                    var parentComment = _findCommentById(noticeId, parentId);
                    if (parentComment) {
                        parentComment.reply_count = Number(parentComment.reply_count || 0) + 1;
                    }
                }
                _cancelReply(noticeId);
                _renderComments(noticeId);
                _updateStats(noticeId);
                _showToast(parentId > 0 ? '回复已发送' : '评论已发送', 'success');
                var scrollToCommentId = (data.comment && data.comment.id) ? data.comment.id : null;
                _loadComments(noticeId, { reset: true });
                if (parentId > 0) {
                    setTimeout(function () {
                        _loadReplies(noticeId, parentId);
                    }, 120);
                }
                // 发评论成功后滚动定位到新评论
                if (scrollToCommentId) {
                    setTimeout(function () {
                        var container = document.querySelector('.nc-panel[data-nc-notice-id="' + noticeId + '"] .nc-comment-list');
                        var el = container && container.querySelector('[data-comment-id="' + scrollToCommentId + '"]');
                        if (el && container) {
                            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                            el.style.transition = 'background 0.3s ease';
                            el.style.background = 'rgba(249, 115, 22, 0.08)';
                            setTimeout(function () { el.style.background = ''; }, 2000);
                        }
                    }, 600);
                }
            } else {
                _showToast(data.error || '发送失败');
                if (sendBtn) sendBtn.disabled = false;
            }
        }).catch(function (err) {
            _showToast((err && err.message) || '网络错误，请重试');
            if (sendBtn) sendBtn.disabled = false;
        });
    }

    function _stripLegacyReplyPrefix(content) {
        return String(content || '').replace(/^\s*回复\s*@[^:：]+[:：]\s*/, '');
    }

    function _renderReplyPreviewContent(reply) {
        var targetName = getReplyTargetPublicName(reply);
        var content = String(reply && reply.content ? reply.content : '');
        if (targetName) {
            return '<span class="nc-reply-mention">回复 @' + escapeHtml(targetName) + '：</span>' + escapeHtml(_stripLegacyReplyPrefix(content));
        }
        return escapeHtml(content);
    }

    function _renderReplyBody(reply) {
        var targetName = getReplyTargetPublicName(reply);
        var content = String(reply && reply.content ? reply.content : '');
        if (targetName) {
            return '<span class="nc-reply-mention">回复 @' + escapeHtml(targetName) + '：</span>' + escapeHtml(_stripLegacyReplyPrefix(content));
        }
        return escapeHtml(content).replace(/^(回复\s*)(@[^:：]+[:：])/, function (_, prefix, mention) {
            return prefix + '<span class="nc-reply-mention">' + mention + '</span>';
        });
    }

    var _activeMoreMenu = null;
    var _activeMoreMenuAnchor = null;
    var _activeMoreMenuCommentId = null;
    var _activeMoreMenuOutsideClose = null;

    function _closeMoreMenu() {
        if (_activeMoreMenu) {
            _activeMoreMenu.remove();
            _activeMoreMenu = null;
        }
        if (_activeMoreMenuOutsideClose) {
            document.removeEventListener('click', _activeMoreMenuOutsideClose);
            _activeMoreMenuOutsideClose = null;
        }
        _activeMoreMenuAnchor = null;
        _activeMoreMenuCommentId = null;
    }

    function _showMoreMenu(anchor, commentId, noticeId) {
        if (_activeMoreMenu && _activeMoreMenuAnchor === anchor && Number(_activeMoreMenuCommentId) === Number(commentId)) {
            _closeMoreMenu();
            return;
        }
        _closeMoreMenu();
        var state = _getState(noticeId);
        var entry = _findCommentById(noticeId, commentId) || {};
        var items = [];
        var isSelf = entry.is_self === true || (String(_getUserSeqId()) !== '' && String(entry.uid || '') === String(_getUserSeqId()));

        if (entry.can_delete) {
            items.push({ action: 'delete', label: '删除评论', className: 'nc-more-popup-danger' });
        }
        if (state.viewerIsAdmin || entry.can_manage) {
            items.push({ action: 'weight', label: '调整权重', className: 'nc-more-popup-admin' });
            items.push({ action: 'ban', label: '封禁评论权限', className: 'nc-more-popup-admin' });
        }
        if (!isSelf) {
            items.push({ action: 'report', label: '举报', className: 'nc-more-popup-report' });
        }
        items.push({ action: 'cancel', label: '取消', className: 'nc-more-popup-cancel' });

        var menu = document.createElement('div');
        menu.className = 'nc-more-popup';
        menu.innerHTML = items.map(function (item) {
            return '<div class="nc-more-popup-item ' + item.className + '" data-action="' + item.action + '">' + item.label + '</div>';
        }).join('');

        // 挂载到 body 上以避免父容器 overflow 裁剪
        document.body.appendChild(menu);
        _activeMoreMenu = menu;
        _activeMoreMenuAnchor = anchor;
        _activeMoreMenuCommentId = commentId;

        // 基于 anchor 位置定位菜单
        var rect = anchor.getBoundingClientRect();
        var menuHeight = menu.offsetHeight || 120;
        var spaceAbove = rect.top;
        var topPos;
        if (spaceAbove > menuHeight + 8) {
            topPos = rect.top - menuHeight - 4;
        } else {
            topPos = rect.bottom + 4;
        }
        menu.style.top = topPos + 'px';
        menu.style.left = Math.max(4, rect.right - menu.offsetWidth) + 'px';

        menu.querySelectorAll('[data-action]').forEach(function (item) {
            item.addEventListener('click', function (e) {
                e.stopPropagation();
                var action = item.getAttribute('data-action');
                _closeMoreMenu();
                if (action === 'delete') {
                    _openDeleteConfirm(noticeId, commentId, entry);
                } else if (action === 'weight') {
                    _showWeightDialog(noticeId, commentId, entry);
                } else if (action === 'ban') {
                    _showBanDialog(noticeId, commentId);
                } else if (action === 'report') {
                    _showReportDialog(commentId, noticeId);
                }
            });
        });

        // 外部点击关闭
        setTimeout(function () {
            function outsideClose(ev) {
                if (!menu.contains(ev.target)) {
                    _closeMoreMenu();
                }
            }
            _activeMoreMenuOutsideClose = outsideClose;
            document.addEventListener('click', outsideClose);
        }, 0);
    }

    function _openDeleteConfirm(noticeId, commentId, entry) {
        var replyCount = Number(entry && entry.reply_count ? entry.reply_count : 0);
        var message = replyCount > 0
            ? '删除后，这条评论下的回复也会一并删除。<br>此操作无法撤销。'
            : '删除后将无法恢复。';

        if (window.app && typeof window.app.confirm === 'function') {
            window.app.confirm('确认删除评论', message, true, '确认删除').then(function (confirmed) {
                if (confirmed) _deleteComment(noticeId, commentId);
            });
            return;
        }
        if (window.confirm('确认删除这条评论吗？')) {
            _deleteComment(noticeId, commentId);
        }
    }

    function _showAdminDialog(config) {
        var existing = document.getElementById(config.id);
        if (existing) existing.remove();

        var overlay = document.createElement('div');
        overlay.id = config.id;
        overlay.className = 'nc-admin-overlay';
        overlay.innerHTML =
            '<div class="nc-admin-dialog">' +
            '  <div class="nc-admin-header">' +
            '    <div class="nc-admin-title">' + escapeHtml(config.title) + '</div>' +
            '    <button class="nc-admin-close" type="button">✕</button>' +
            '  </div>' +
            '  <div class="nc-admin-body">' + config.bodyHtml + '</div>' +
            '  <div class="nc-admin-footer">' +
            '    <button class="nc-admin-btn-cancel" type="button">取消</button>' +
            '    <button class="nc-admin-btn-submit" type="button">' + escapeHtml(config.submitText || '确定') + '</button>' +
            '  </div>' +
            '</div>';
        document.body.appendChild(overlay);

        function closeDialog() {
            overlay.classList.remove('show');
            setTimeout(function () {
                overlay.remove();
            }, 200);
        }

        overlay.addEventListener('click', function (e) {
            if (e.target === overlay) closeDialog();
        });
        overlay.querySelector('.nc-admin-close').addEventListener('click', closeDialog);
        overlay.querySelector('.nc-admin-btn-cancel').addEventListener('click', closeDialog);
        overlay.querySelector('.nc-admin-btn-submit').addEventListener('click', function () {
            config.onSubmit(closeDialog, overlay);
        });

        requestAnimationFrame(function () {
            overlay.classList.add('show');
            if (typeof config.onReady === 'function') {
                config.onReady(overlay, closeDialog);
            }
        });
    }

    function _deleteComment(noticeId, commentId) {
        var baseUrl = _getBaseUrl();
        var hwid = _getHWID();
        if (!baseUrl || !hwid) {
            _showToast('未连接服务器');
            return;
        }

        _requestJsonWithTelemetryRetry(function () {
            return _buildTelemetryHeaders('/notice-comments/' + commentId, 'DELETE', hwid, false).then(function (headers) {
                return fetch(baseUrl + '/notice-comments/' + commentId + '?machine_id=' + encodeURIComponent(hwid), {
                    method: 'DELETE',
                    headers: headers
                });
            });
        }, '删除失败').then(function (data) {
            if (data.status === 'success') {
                _showToast('评论已删除', 'success');
                var state = _getState(noticeId);
                _removeLocalPinnedComment(noticeId, commentId);
                if (state.replyingTo && Number(state.replyingTo.targetId) === Number(commentId)) {
                    _cancelReply(noticeId);
                }
                _loadComments(noticeId, { reset: true });
            } else {
                _showToast(data.error || '删除失败');
            }
        }).catch(function (err) {
            _showToast((err && err.message) || '网络错误，请重试');
        });
    }

    function _showWeightDialog(noticeId, commentId, entry) {
        var currentAdjustment = Number(entry && entry.weight_adjustment ? entry.weight_adjustment : 0);
        _showAdminDialog({
            id: 'nc-weight-overlay',
            title: '调整评论权重',
            submitText: '保存调整',
            bodyHtml:
                '<div class="nc-admin-field">' +
                '  <label class="nc-admin-label">当前手动权重</label>' +
                '  <div class="nc-admin-hint">' + (currentAdjustment > 0 ? '+' : '') + currentAdjustment + '</div>' +
                '</div>' +
                '<div class="nc-admin-field">' +
                '  <label class="nc-admin-label" for="nc-weight-action">调整方式</label>' +
                '  <select class="nc-admin-select" id="nc-weight-action">' +
                '    <option value="increase">增加</option>' +
                '    <option value="decrease">减少</option>' +
                '  </select>' +
                '</div>' +
                '<div class="nc-admin-field">' +
                '  <label class="nc-admin-label" for="nc-weight-amount">调整数值</label>' +
                '  <input class="nc-admin-input" id="nc-weight-amount" type="number" min="0.1" step="0.1" value="1" />' +
                '</div>' +
                '<div class="nc-admin-hint">权重会立刻参与评论排序，建议小步调整。</div>',
            onReady: function (overlay) {
                var input = overlay.querySelector('#nc-weight-amount');
                if (input) {
                    input.focus();
                    input.select();
                }
            },
            onSubmit: function (closeDialog, overlay) {
                var action = overlay.querySelector('#nc-weight-action').value;
                var amount = Number(overlay.querySelector('#nc-weight-amount').value || 0);
                if (!(amount > 0)) {
                    _showToast('请输入大于 0 的权重数值');
                    return;
                }
                _submitWeightAdjust(noticeId, commentId, action, amount, closeDialog);
            }
        });
    }

    function _submitWeightAdjust(noticeId, commentId, action, amount, closeDialog) {
        var baseUrl = _getBaseUrl();
        var hwid = _getHWID();
        if (!baseUrl || !hwid) {
            _showToast('未连接服务器');
            return;
        }

        _requestJsonWithTelemetryRetry(function () {
            return _buildTelemetryHeaders('/notice-comments/' + commentId + '/weight', 'POST', hwid, true).then(function (headers) {
                return fetch(baseUrl + '/notice-comments/' + commentId + '/weight', {
                    method: 'POST',
                    headers: headers,
                    body: JSON.stringify({
                        machine_id: hwid,
                        action: action,
                        amount: amount
                    })
                });
            });
        }, '调整失败').then(function (data) {
            if (data.status === 'success') {
                closeDialog();
                _showToast('评论权重已更新', 'success');
                // 实时更新权重分数，避免全量刷新
                var target = _findCommentById(noticeId, commentId);
                if (target && typeof data.weight_score !== 'undefined') {
                    target.weight_score = data.weight_score;
                    if (typeof data.weight_adjustment !== 'undefined') target.weight_adjustment = data.weight_adjustment;
                    _renderComments(noticeId);
                } else {
                    _loadComments(noticeId, { reset: true });
                }
            } else {
                _showToast(data.error || '调整失败');
            }
        }).catch(function (err) {
            _showToast((err && err.message) || '网络错误，请重试');
        });
    }

    function _showBanDialog(noticeId, commentId) {
        _showAdminDialog({
            id: 'nc-ban-overlay',
            title: '封禁评论权限',
            submitText: '确认封禁',
            bodyHtml:
                '<div class="nc-admin-field nc-admin-inline">' +
                '  <div class="nc-admin-inline-item">' +
                '    <label class="nc-admin-label" for="nc-ban-duration-value">时长</label>' +
                '    <input class="nc-admin-input" id="nc-ban-duration-value" type="number" min="1" step="1" value="30" />' +
                '  </div>' +
                '  <div class="nc-admin-inline-item">' +
                '    <label class="nc-admin-label" for="nc-ban-duration-unit">单位</label>' +
                '    <select class="nc-admin-select" id="nc-ban-duration-unit">' +
                '      <option value="minute">分钟</option>' +
                '      <option value="hour">小时</option>' +
                '      <option value="day">天</option>' +
                '    </select>' +
                '  </div>' +
                '</div>' +
                '<div class="nc-admin-field">' +
                '  <label class="nc-admin-label" for="nc-ban-reason">封禁理由</label>' +
                '  <textarea class="nc-admin-textarea" id="nc-ban-reason" rows="3" placeholder="请输入封禁理由（选填）"></textarea>' +
                '</div>' +
                '<div class="nc-admin-hint">封禁期间，该用户将无法继续发送新的评论和回复。</div>',
            onReady: function (overlay) {
                var input = overlay.querySelector('#nc-ban-duration-value');
                if (input) {
                    input.focus();
                    input.select();
                }
            },
            onSubmit: function (closeDialog, overlay) {
                var durationValue = Number(overlay.querySelector('#nc-ban-duration-value').value || 0);
                var durationUnit = overlay.querySelector('#nc-ban-duration-unit').value;
                var reason = (overlay.querySelector('#nc-ban-reason').value || '').trim();
                if (!(durationValue > 0)) {
                    _showToast('请输入有效的封禁时长');
                    return;
                }
                _submitBanAction(noticeId, commentId, durationValue, durationUnit, reason, closeDialog);
            }
        });
    }

    function _submitBanAction(noticeId, commentId, durationValue, durationUnit, reason, closeDialog) {
        var baseUrl = _getBaseUrl();
        var hwid = _getHWID();
        if (!baseUrl || !hwid) {
            _showToast('未连接服务器');
            return;
        }

        _requestJsonWithTelemetryRetry(function () {
            return _buildTelemetryHeaders('/notice-comments/' + commentId + '/ban', 'POST', hwid, true).then(function (headers) {
                return fetch(baseUrl + '/notice-comments/' + commentId + '/ban', {
                    method: 'POST',
                    headers: headers,
                    body: JSON.stringify({
                        machine_id: hwid,
                        duration_value: durationValue,
                        duration_unit: durationUnit,
                        reason: reason
                    })
                });
            });
        }, '封禁失败').then(function (data) {
            if (data.status === 'success') {
                closeDialog();
                _showToast('评论权限已封禁', 'success');
                _loadComments(noticeId, { reset: true });
            } else {
                _showToast(data.error || '封禁失败');
            }
        }).catch(function (err) {
            _showToast((err && err.message) || '网络错误，请重试');
        });
    }

    var REPORT_TYPES = [
        { value: 'porn', label: '色情低俗' },
        { value: 'hostile', label: '引战不友善言论' },
        { value: 'privacy', label: '传播他人隐私信息' },
        { value: 'minor', label: '涉未成年人不良信息' },
        { value: 'ad', label: '违规广告引流' },
        { value: 'political', label: '政治敏感' },
        { value: 'rumor', label: '传播谣言' },
        { value: 'spam', label: '无关内容刷屏' },
        { value: 'other', label: '其他' }
    ];

    function _showReportDialog(commentId, noticeId) {
        // 移除已存在的举报弹窗
        var existing = document.getElementById('nc-report-overlay');
        if (existing) existing.remove();

        var overlay = document.createElement('div');
        overlay.id = 'nc-report-overlay';
        overlay.className = 'nc-report-overlay';

        var options = REPORT_TYPES.map(function (t) {
            return '<option value="' + t.value + '">' + t.label + '</option>';
        }).join('');

        overlay.innerHTML =
            '<div class="nc-report-dialog">' +
            '  <div class="nc-report-header">' +
            '    <div class="nc-report-title">举报评论</div>' +
            '    <button class="nc-report-close" id="nc-report-close" type="button">✕</button>' +
            '  </div>' +
            '  <div class="nc-report-body">' +
            '    <div class="nc-report-field">' +
            '      <label class="nc-report-label">举报类型</label>' +
            '      <div class="nc-report-select-shell">' +
            '        <div class="nc-report-dropdown-host" id="nc-report-type-dropdown"></div>' +
            '        <div class="nc-report-select-native" id="nc-report-type-native-wrap">' +
            '          <select class="nc-report-select" id="nc-report-type">' + options + '</select>' +
            '          <i class="ri-arrow-down-s-line nc-report-select-arrow"></i>' +
            '        </div>' +
            '      </div>' +
            '    </div>' +
            '    <div class="nc-report-field">' +
            '      <label class="nc-report-label">原因说明 <span style="color:#9ca3af;font-weight:400;">(选填，最多100字)</span></label>' +
            '      <textarea class="nc-report-textarea" id="nc-report-reason" maxlength="100" rows="3" placeholder="请描述举报原因..."></textarea>' +
            '    </div>' +
            '  </div>' +
            '  <div class="nc-report-footer">' +
            '    <button class="nc-report-btn-cancel" id="nc-report-cancel">取消</button>' +
            '    <button class="nc-report-btn-submit" id="nc-report-submit">提交举报</button>' +
            '  </div>' +
            '</div>';

        document.body.appendChild(overlay);
        if (window.AppDropdownMenu && document.getElementById('nc-report-type-dropdown')) {
            var nativeWrap = document.getElementById('nc-report-type-native-wrap');
            if (nativeWrap) nativeWrap.style.display = 'none';
            overlay._reportTypeDropdown = new window.AppDropdownMenu({
                id: 'nc-report-type',
                containerId: 'nc-report-type-dropdown',
                options: REPORT_TYPES.map(function (item) {
                    return { value: item.value, label: item.label };
                }),
                placeholder: '请选择举报类型',
                size: 'md'
            });
            overlay._reportTypeDropdown.setValue(REPORT_TYPES[0].value, false);
        }
        requestAnimationFrame(function () { overlay.classList.add('show'); });

        function closeDialog() {
            overlay.classList.remove('show');
            setTimeout(function () {
                if (overlay._reportTypeDropdown && typeof overlay._reportTypeDropdown.destroy === 'function') {
                    overlay._reportTypeDropdown.destroy();
                }
                overlay.remove();
            }, 200);
        }

        overlay.addEventListener('click', function (e) {
            if (e.target === overlay) closeDialog();
        });
        document.getElementById('nc-report-close').addEventListener('click', closeDialog);
        document.getElementById('nc-report-cancel').addEventListener('click', closeDialog);
        document.getElementById('nc-report-submit').addEventListener('click', function () {
            _submitReport(commentId, noticeId, closeDialog);
        });
    }

    function _submitReport(commentId, noticeId, closeDialog) {
        var baseUrl = _getBaseUrl();
        var hwid = _getHWID();
        if (!baseUrl || !hwid) { _showToast('未连接服务器'); return; }

        var overlay = document.getElementById('nc-report-overlay');
        var reportType = overlay && overlay._reportTypeDropdown
            ? overlay._reportTypeDropdown.getValue()
            : document.getElementById('nc-report-type').value;
        var reason = (document.getElementById('nc-report-reason').value || '').trim();
        var submitBtn = document.getElementById('nc-report-submit');
        if (submitBtn) submitBtn.disabled = true;

        _requestJsonWithTelemetryRetry(function () {
            return _buildTelemetryHeaders('/notice-comment-report', 'POST', hwid, true).then(function (headers) {
                return fetch(baseUrl + '/notice-comment-report', {
                    method: 'POST',
                    headers: headers,
                    body: JSON.stringify({
                        comment_id: commentId,
                        machine_id: hwid,
                        report_type: reportType,
                        reason: reason
                    })
                });
            });
        }, '举报失败').then(function (data) {
            if (data.status === 'success') {
                _showToast('举报已提交，感谢反馈');
                closeDialog();
            } else {
                _showToast(data.error || '举报失败');
                if (submitBtn) submitBtn.disabled = false;
            }
        }).catch(function (err) {
            _showToast((err && err.message) || '网络错误，请重试');
            if (submitBtn) submitBtn.disabled = false;
        });
    }

    function _showToast(msg, kind) {
        var toastType = kind || 'error';
        if (window.app && typeof window.app.showToast === 'function') {
            window.app.showToast(msg, toastType);
        } else if (window.app && typeof window.app.showAlert === 'function') {
            window.app.showAlert('提示', msg, toastType === 'success' ? 'success' : 'error');
        } else if (window.showAlert && typeof window.showAlert === 'function') {
            window.showAlert('提示', msg, toastType === 'success' ? 'success' : 'info');
        }
    }

    window.NoticeCommentPanel = {
        renderPanel: renderPanel
    };
})();
