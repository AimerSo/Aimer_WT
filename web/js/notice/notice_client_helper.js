(function () {
    function sanitizeMessage(value) {
        return String(value == null ? '' : value)
            .replace(/<[^>]*>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function hasChinese(value) {
        return /[\u4e00-\u9fff]/.test(String(value || ''));
    }

    var STATUS_REASON_MAP = {
        400: '请求参数不正确，服务器无法处理本次操作',
        401: '身份校验失败，请稍后重试',
        403: '服务器拒绝了当前请求，可能是客户端身份未同步、设备绑定不匹配，或当前功能未开放',
        404: '请求的接口或内容不存在，可能已被删除，或当前服务端版本不支持',
        408: '请求超时，请检查网络后重试',
        409: '请求状态发生冲突，请刷新后重试',
        413: '提交内容过大，请缩短内容后重试',
        415: '请求格式不受支持，请稍后重试',
        429: '操作过于频繁，请稍后再试',
        500: '服务器内部处理失败，请稍后重试',
        502: '服务器暂时不可用，请稍后重试',
        503: '服务器暂时不可用或正在维护中，请稍后重试',
        504: '服务器响应超时，请稍后重试'
    };

    var MESSAGE_RULES = [
        { pattern: /Failed to fetch|NetworkError|Load failed|fetch failed/i, message: '无法连接到服务器，可能是服务端未启动、网络不通，或当前客户端与服务端已断开连接' },
        { pattern: /AbortError/i, message: '请求已被中断，请稍后重试' },
        { pattern: /timeout|timed out|ETIMEDOUT/i, message: '请求超时，可能是网络不稳定或服务器响应较慢' },
        { pattern: /Unexpected token </i, message: '服务器返回了异常页面，可能尚未完成身份校验，或接口暂时不可用' },
        { pattern: /Unexpected end of JSON input/i, message: '服务器返回的数据不完整，请稍后重试' },
        { pattern: /device token missing|missing device token|缺少设备令牌/i, message: '客户端身份校验信息缺失，可能尚未完成握手，请稍后重试' },
        { pattern: /device token invalid|invalid device token|设备令牌无效/i, message: '客户端身份校验已失效，请稍后重试；若反复出现，请重启客户端后再试' },
        { pattern: /machine binding mismatch|device binding mismatch|设备绑定不匹配/i, message: '客户端身份与当前设备不匹配，请等待身份重新同步后再试' },
        { pattern: /access denied|forbidden|unauthorized|访问被拒绝/i, message: '服务器拒绝了当前请求，可能是身份校验失败、权限不足，或当前功能未开放' },
        { pattern: /not found|record not found/i, message: '请求的内容不存在，可能已经被删除或当前服务端版本不支持' },
        { pattern: /machine_id required|comment_id required|notice_id required|请求数据格式错误|request data/i, message: '请求参数不完整或格式不正确，请稍后重试' }
    ];

    function translateKnownMessage(message) {
        var text = sanitizeMessage(message);
        if (!text) return '';
        for (var i = 0; i < MESSAGE_RULES.length; i++) {
            if (MESSAGE_RULES[i].pattern.test(text)) {
                return MESSAGE_RULES[i].message;
            }
        }
        return hasChinese(text) ? text : '';
    }

    function buildStatusReason(status) {
        var code = Number(status || 0);
        return STATUS_REASON_MAP[code] || '';
    }

    function joinMessage(prefix, reason) {
        var safePrefix = sanitizeMessage(prefix);
        var safeReason = sanitizeMessage(reason);
        if (!safePrefix) return safeReason || '请求失败，请稍后重试';
        if (!safeReason || safeReason === safePrefix) return safePrefix;
        if (safeReason.indexOf(safePrefix) === 0) return safeReason;
        return safePrefix + '：' + safeReason;
    }

    function buildUserMessage(error, fallbackMessage) {
        var fallback = sanitizeMessage(fallbackMessage) || '请求失败，请稍后重试';
        if (!error) return fallback;

        var rawMessage = sanitizeMessage(
            error.userMessage ||
            error.serverMessage ||
            (error.payload && (error.payload.error || error.payload.message)) ||
            error.message ||
            error.responseText
        );
        var translated = translateKnownMessage(rawMessage);
        var statusReason = buildStatusReason(error.status);

        if (translated) return joinMessage(fallback, translated);
        if (hasChinese(rawMessage)) return joinMessage(fallback, rawMessage);
        if (statusReason) return joinMessage(fallback, statusReason);
        if (rawMessage && !/^TypeError(?::)?$/i.test(rawMessage) && rawMessage !== 'Error') {
            return joinMessage(fallback, rawMessage);
        }
        return fallback;
    }

    function decorateError(error, fallbackMessage) {
        var err = error instanceof Error ? error : new Error(String(error || ''));
        err.userMessage = buildUserMessage(err, fallbackMessage);
        err.message = err.userMessage;
        return err;
    }

    function parseJsonResponse(response, fallbackMessage) {
        if (!response) {
            return Promise.reject(decorateError(new Error(fallbackMessage || '请求失败'), fallbackMessage));
        }
        return response.text().then(function (text) {
            var data = {};
            try {
                data = text ? JSON.parse(text) : {};
            } catch (e) {
                data = {};
            }
            if (response.ok) {
                return data;
            }
            var error = new Error(
                sanitizeMessage((data && (data.error || data.message)) || text || fallbackMessage || ('请求失败（' + response.status + '）'))
            );
            error.status = response.status;
            error.payload = data;
            error.responseText = text;
            error.serverMessage = sanitizeMessage((data && (data.error || data.message)) || text);
            throw decorateError(error, fallbackMessage);
        });
    }

    function shouldRetryWithTelemetry(error) {
        var status = Number(error && error.status || 0);
        var message = sanitizeMessage(
            error && (
                error.serverMessage ||
                error.userMessage ||
                (error.payload && (error.payload.error || error.payload.message)) ||
                error.message
            )
        );
        if (status !== 401 && status !== 403) return false;
        return /设备令牌|设备绑定|访问被拒绝|缺少设备令牌|unauthorized|forbidden|device token|binding|access denied/i.test(message);
    }

    function requestTelemetryJsonViaBridge(path, options) {
        options = options || {};
        if (!(window.pywebview && window.pywebview.api && typeof window.pywebview.api.request_telemetry_json === 'function')) {
            return null;
        }

        var method = String(options.method || 'GET').toUpperCase();
        var params = options.params && typeof options.params === 'object' ? options.params : null;
        var payload = options.payload && typeof options.payload === 'object' ? options.payload : null;
        var timeoutMs = Number(options.timeoutMs || 8000);
        if (!isFinite(timeoutMs) || timeoutMs <= 0) timeoutMs = 8000;
        timeoutMs = Math.max(1000, Math.min(Math.round(timeoutMs), 20000));
        var ensureReady = options.ensureReady !== false;
        var fallbackMessage = sanitizeMessage(options.fallbackMessage) || '请求失败，请稍后重试';

        return window.pywebview.api.request_telemetry_json(path, method, params, payload, timeoutMs, ensureReady)
            .then(function (result) {
                if (result && result.ok) {
                    return result.data && typeof result.data === 'object' ? result.data : {};
                }
                var error = new Error(
                    sanitizeMessage(result && result.error) ||
                    fallbackMessage ||
                    '请求失败，请稍后重试'
                );
                error.status = Number(result && result.status || 0);
                error.payload = result && result.data && typeof result.data === 'object' ? result.data : {};
                error.serverMessage = sanitizeMessage(
                    (error.payload && (error.payload.error || error.payload.message)) ||
                    error.message
                );
                throw decorateError(error, fallbackMessage);
            })
            .catch(function (error) {
                throw decorateError(error, fallbackMessage);
            });
    }

    function cloneReactions(reactions) {
        if (!Array.isArray(reactions)) return [];
        return reactions.map(function (reaction) {
            return Object.assign({}, reaction, {
                users: Array.isArray(reaction && reaction.users) ? reaction.users.slice() : [],
                user_details: Array.isArray(reaction && reaction.user_details) ? reaction.user_details.map(function (item) {
                    return Object.assign({}, item);
                }) : []
            });
        });
    }

    function buildOptimisticReactions(reactions, emoji) {
        var next = cloneReactions(reactions);
        var currentReactedIndex = -1;
        var targetIndex = -1;

        next.forEach(function (reaction, index) {
            if (reaction && reaction.reacted) currentReactedIndex = index;
            if (reaction && reaction.emoji === emoji) targetIndex = index;
        });

        if (currentReactedIndex !== -1) {
            var currentReaction = next[currentReactedIndex];
            currentReaction.reacted = false;
            currentReaction.count = Math.max(0, Number(currentReaction.count || 0) - 1);
            if (currentReaction.count <= 0) {
                next.splice(currentReactedIndex, 1);
                if (targetIndex > currentReactedIndex) targetIndex -= 1;
                if (targetIndex === currentReactedIndex) targetIndex = -1;
            }
            if (currentReaction.emoji === emoji) return next;
        }

        if (targetIndex === -1) {
            next.push({
                emoji: emoji,
                count: 1,
                users: [],
                user_details: [],
                reacted: true
            });
            return next;
        }

        next[targetIndex].count = Math.max(0, Number(next[targetIndex].count || 0)) + 1;
        next[targetIndex].reacted = true;
        return next;
    }

    var reactionCache = {};
    var commentCache = {};

    function cloneCommentPayload(payload) {
        if (!payload || typeof payload !== 'object') return null;
        return JSON.parse(JSON.stringify(payload));
    }

    function updateReactionSummary(noticeId, reactions) {
        var key = String(noticeId);
        var summary = Array.isArray(window._noticeReactionsData) ? window._noticeReactionsData.slice() : [];
        summary = summary.filter(function (item) {
            return String(item && item.notice_id) !== key;
        });
        (reactions || []).forEach(function (reaction) {
            if (!reaction || !reaction.emoji || Number(reaction.count || 0) <= 0) return;
            summary.push({
                notice_id: noticeId,
                emoji: reaction.emoji,
                count: Number(reaction.count || 0)
            });
        });
        window._noticeReactionsData = summary;
    }

    function cacheReactions(noticeId, reactions) {
        var key = String(noticeId);
        reactionCache[key] = cloneReactions(reactions);
        updateReactionSummary(noticeId, reactionCache[key]);
        return cloneReactions(reactionCache[key]);
    }

    function getCachedReactions(noticeId) {
        var key = String(noticeId);
        if (!Object.prototype.hasOwnProperty.call(reactionCache, key)) return null;
        return cloneReactions(reactionCache[key]);
    }

    function getSummaryReactions(noticeId) {
        var key = String(noticeId);
        var raw = Array.isArray(window._noticeReactionsData) ? window._noticeReactionsData : [];
        var reactions = [];
        raw.forEach(function (item) {
            if (String(item && item.notice_id) !== key) return;
            reactions.push({
                emoji: item.emoji,
                count: Number(item.count || 0),
                users: [],
                user_details: [],
                reacted: false
            });
        });
        return reactions;
    }

    function cacheCommentPayload(noticeId, payload) {
        var key = String(noticeId);
        var cloned = cloneCommentPayload(payload);
        if (!cloned) return null;
        commentCache[key] = cloned;
        return cloneCommentPayload(cloned);
    }

    function getCachedCommentPayload(noticeId) {
        var key = String(noticeId);
        if (!Object.prototype.hasOwnProperty.call(commentCache, key)) return null;
        return cloneCommentPayload(commentCache[key]);
    }

    window.NoticeClientHelper = {
        buildUserMessage: buildUserMessage,
        decorateError: decorateError,
        parseJsonResponse: parseJsonResponse,
        shouldRetryWithTelemetry: shouldRetryWithTelemetry,
        requestTelemetryJsonViaBridge: requestTelemetryJsonViaBridge,
        cloneReactions: cloneReactions,
        buildOptimisticReactions: buildOptimisticReactions,
        cacheReactions: cacheReactions,
        getCachedReactions: getCachedReactions,
        getSummaryReactions: getSummaryReactions,
        cacheCommentPayload: cacheCommentPayload,
        getCachedCommentPayload: getCachedCommentPayload
    };
})();
