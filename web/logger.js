/**
 * AimerWT-Log — 客户端诊断日志模块
 *
 * 功能定位:
 * - 着重记录错误、异常和关键警告，用于排查白屏等严重问题
 * - 普通 console.log 仅记录关键信息，自动过滤高频重复和冗余内容
 * - 保留最近 3 次软件启动的日志，总大小 ≤ 5MB
 * - 过滤敏感信息（API Key、token 密文等）
 * - 提供 export() / download() 方法便于用户导出日志文本发送给开发者
 *
 * 业务关联:
 * - 上游: index.html 最先加载
 * - 下游: 用户/开发者排查白屏等严重问题
 */

const AppLogger = {
    STORAGE_KEY: 'aimerWT_log',
    MAX_SESSIONS: 3,
    MAX_BYTES: 5 * 1024 * 1024,
    SESSION_ID: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    BACKEND_SYNC_DEBOUNCE_MS: 800,

    // 内存缓冲区
    _buffer: [],
    _initialized: false,
    _syncTimer: null,
    _syncing: false,
    _pendingSync: false,
    _lastSyncedFingerprint: '',

    // 原始 console 方法备份
    _origLog: null,
    _origWarn: null,
    _origError: null,
    _origInfo: null,

    // 去重: 最近 N 条日志指纹，避免高频重复刷屏
    _recentFingerprints: [],
    _MAX_FINGERPRINTS: 30,

    // 敏感信息匹配
    _sensitivePatterns: [
        /(['""]?(?:api[_-]?key|apikey|token|secret|password|passwd|authorization|bearer)['""]?\s*[:=]\s*)['""]?[^\s'"]{4,}['""]?/gi,
        /(sk-|pk-|Bearer\s+)[a-zA-Z0-9_\-]{8,}/g
    ],

    // 已知无用日志关键词（自动跳过）
    _noisePatterns: [
        /\[HMR\]/i,
        /\[vite\]/i,
        /DevTools/i,
        /Download the React DevTools/i,
        /favicon\.ico/i,
        /ResizeObserver loop/i,
    ],

    init() {
        if (this._initialized) return;
        this._initialized = true;

        this._origLog = console.log.bind(console);
        this._origWarn = console.warn.bind(console);
        this._origError = console.error.bind(console);
        this._origInfo = console.info.bind(console);

        // 拦截 console（LOG 级别走智能过滤，ERROR/WARN 全量记录）
        console.log = (...args) => { this._smartCapture('LOG', args); this._origLog(...args); };
        console.info = (...args) => { this._smartCapture('INFO', args); this._origInfo(...args); };
        console.warn = (...args) => { this._capture('WARN', args); this._origWarn(...args); };
        console.error = (...args) => { this._capture('ERROR', args); this._origError(...args); };

        // 全局异常捕获
        window.addEventListener('error', (e) => {
            this._capture('EXCEPTION', [
                `${e.message}`,
                `  → ${e.filename || '(unknown)'}:${e.lineno}:${e.colno}`
            ]);
        });

        window.addEventListener('unhandledrejection', (e) => {
            const reason = e.reason instanceof Error
                ? `${e.reason.message}\n  Stack: ${(e.reason.stack || '').split('\n').slice(0, 4).join('\n  ')}`
                : String(e.reason);
            this._capture('UNHANDLED_PROMISE', [reason]);
        });

        // 启动信息头
        const now = new Date();
        this._capture('SYSTEM', [
            `━━━ AimerWT-Log Session Start ━━━`,
            `Session ID: ${this.SESSION_ID}`,
            `Time: ${now.toLocaleString('zh-CN', { hour12: false })}`,
            `UA: ${navigator.userAgent}`,
            `Screen: ${screen.width}×${screen.height}`,
            `Window: ${window.innerWidth}×${window.innerHeight}`,
            `Platform: ${navigator.platform || 'unknown'}`
        ]);

        // 清理旧版日志 key（从 app_debug_logs 迁移到 aimerWT_log）
        try { localStorage.removeItem('app_debug_logs'); } catch {}

        this._pruneOldSessions();
        this._scheduleSync(true);

        window.addEventListener('pywebviewready', () => {
            this._scheduleSync(true);
        }, { once: true });
    },

    // 智能捕获：过滤噪音和重复
    _smartCapture(level, args) {
        const message = this._argsToString(args);

        // 跳过已知噪音
        for (const pat of this._noisePatterns) {
            if (pat.test(message)) return;
        }

        // 去重：短时间内相同消息不重复记录
        const fingerprint = level + ':' + message.slice(0, 100);
        if (this._recentFingerprints.includes(fingerprint)) return;
        this._recentFingerprints.push(fingerprint);
        if (this._recentFingerprints.length > this._MAX_FINGERPRINTS) {
            this._recentFingerprints.shift();
        }

        this._capture(level, args);
    },

    // 格式化参数为字符串
    _argsToString(args) {
        return args.map(a => {
            if (a === null) return 'null';
            if (a === undefined) return 'undefined';
            if (a instanceof Error) return `${a.message}\n  Stack: ${(a.stack || '').split('\n').slice(0, 4).join('\n  ')}`;
            if (typeof a === 'object') {
                try { return JSON.stringify(a).slice(0, 500); } catch { return String(a); }
            }
            return String(a);
        }).join(' ');
    },

    // 核心捕获
    _capture(level, args) {
        const now = new Date();
        const ts = now.toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
            + '.' + String(now.getMilliseconds()).padStart(3, '0');

        let message = this._argsToString(args);
        message = this._sanitize(message);

        // 单条长度限制
        if (message.length > 600) {
            message = message.slice(0, 600) + '… [截断]';
        }

        // 可读性优化：重要级别加标记符号
        const levelMark = {
            'ERROR': '❌ ERROR',
            'EXCEPTION': '💥 EXCEPTION',
            'UNHANDLED_PROMISE': '💥 UNHANDLED',
            'WARN': '⚠ WARN',
            'SYSTEM': '🔧 SYSTEM',
            'LOG': 'LOG',
            'INFO': 'INFO',
        }[level] || level;

        const entry = `[${ts}] ${levelMark} | ${message}`;
        this._buffer.push(entry);

        // 错误类日志立即写入；普通日志攒满 30 条再写
        const isUrgent = ['ERROR', 'EXCEPTION', 'UNHANDLED_PROMISE', 'WARN'].includes(level);
        if (this._buffer.length >= 30 || isUrgent) {
            this._flush();
        }
    },

    // 过滤敏感信息
    _sanitize(text) {
        for (const pattern of this._sensitivePatterns) {
            text = text.replace(pattern, (match, prefix) => {
                if (prefix) return prefix + '[REDACTED]';
                return '[REDACTED]';
            });
        }
        return text;
    },

    // 写入 localStorage
    _flush(options = {}) {
        if (this._buffer.length === 0) return;

        try {
            const sessions = this._loadSessions();
            let currentSession = sessions.find(s => s.id === this.SESSION_ID);
            if (!currentSession) {
                currentSession = {
                    id: this.SESSION_ID,
                    ts: Date.now(),
                    entries: []
                };
                sessions.push(currentSession);
            }

            currentSession.entries.push(...this._buffer);
            this._buffer = [];

            // 大小控制
            let json = JSON.stringify(sessions);
            while (json.length > this.MAX_BYTES && sessions.length > 1) {
                sessions.shift();
                json = JSON.stringify(sessions);
            }

            // 单 session 超限时截断最旧的 30% 条目
            if (json.length > this.MAX_BYTES && currentSession.entries.length > 100) {
                const removeCount = Math.floor(currentSession.entries.length * 0.3);
                currentSession.entries.splice(0, removeCount);
                json = JSON.stringify(sessions);
            }

            localStorage.setItem(this.STORAGE_KEY, json);
        } catch (e) {
            // localStorage 写入失败，静默忽略
        }

        if (!options.skipSync) {
            this._scheduleSync();
        }
    },

    // 加载已存储的 sessions
    _loadSessions() {
        try {
            const raw = localStorage.getItem(this.STORAGE_KEY);
            if (raw) {
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed)) return parsed;
            }
        } catch { /* 数据损坏，重置 */ }
        return [];
    },

    // 清理旧 session（保留最近 MAX_SESSIONS 个）
    _pruneOldSessions() {
        try {
            const sessions = this._loadSessions();
            if (sessions.length >= this.MAX_SESSIONS) {
                const keep = sessions.slice(-(this.MAX_SESSIONS - 1));
                localStorage.setItem(this.STORAGE_KEY, JSON.stringify(keep));
            }
        } catch { /* 静默忽略 */ }
    },

    /**
     * 导出日志文本（用户发给开发者排查问题）
     * @returns {string} 格式化的诊断日志
     */
    export() {
        this._flush({ skipSync: true });
        return this._buildExportText();
    },

    _buildExportText() {
        const sessions = this._loadSessions();

        const divider = '━'.repeat(50);
        const lines = [
            divider,
            '  AimerWT-Log 诊断日志',
            divider,
            `导出时间: ${new Date().toLocaleString('zh-CN', { hour12: false })}`,
            `会话数量: ${sessions.length}`,
            ''
        ];

        for (const session of sessions) {
            const startTime = new Date(session.ts).toLocaleString('zh-CN', { hour12: false });
            lines.push(`┌─── 会话 ${session.id} (启动于 ${startTime}) ───`);
            lines.push(`│ 日志条数: ${(session.entries || []).length}`);
            lines.push('│');
            for (const entry of (session.entries || [])) {
                lines.push(`│ ${entry}`);
            }
            lines.push('└' + '─'.repeat(49));
            lines.push('');
        }

        lines.push(divider);
        lines.push('  End of AimerWT-Log');
        lines.push(divider);

        return lines.join('\n');
    },

    _scheduleSync(immediate = false) {
        if (this._syncTimer) {
            clearTimeout(this._syncTimer);
        }
        const delay = immediate ? 0 : this.BACKEND_SYNC_DEBOUNCE_MS;
        this._syncTimer = setTimeout(() => {
            this._syncTimer = null;
            this._syncToBackend();
        }, delay);
    },

    async _syncToBackend() {
        const api = window.pywebview?.api;
        if (!api || typeof api.save_client_diagnostic_log !== 'function') {
            this._pendingSync = true;
            return;
        }
        if (this._syncing) {
            this._pendingSync = true;
            return;
        }

        this._syncing = true;
        try {
            this._flush({ skipSync: true });
            const text = this._buildExportText();
            const fingerprint = `${text.length}:${text.slice(-512)}`;
            if (fingerprint !== this._lastSyncedFingerprint || this._pendingSync) {
                await api.save_client_diagnostic_log(text);
                this._lastSyncedFingerprint = fingerprint;
            }
            this._pendingSync = false;
        } catch (_error) {
            this._pendingSync = true;
        } finally {
            this._syncing = false;
            if (this._pendingSync) {
                this._scheduleSync();
            }
        }
    },

    /**
     * 下载日志文件
     */
    download() {
        const text = this.export();
        const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `AimerWT-Log_${new Date().toISOString().slice(0, 10)}.log`;
        a.click();
        URL.revokeObjectURL(url);
    },

    /**
     * 清空所有日志
     */
    clear() {
        this._buffer = [];
        localStorage.removeItem(this.STORAGE_KEY);
        this._lastSyncedFingerprint = '';
        this._pendingSync = true;
        this._scheduleSync(true);
    }
};

// 立即初始化（必须在其他脚本之前加载）
AppLogger.init();
window.AppLogger = AppLogger;
