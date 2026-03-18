/**
 * 开发调试日志模块
 *
 * 功能定位:
 * - 拦截 console.log/warn/error 并持久化到 localStorage
 * - 捕获全局异常和未处理的 Promise rejection
 * - 保留最近 3 次启动的日志，总大小 ≤ 10MB
 * - 过滤敏感信息（API Key、token 密文等）
 * - 提供 export() 方法便于用户导出日志文本
 *
 * 业务关联:
 * - 上游: index.html 最先加载
 * - 下游: 用户/开发者排查白屏等启动问题
 */

const AppLogger = {
    STORAGE_KEY: 'app_debug_logs',
    MAX_SESSIONS: 3,
    MAX_BYTES: 10 * 1024 * 1024, // 10MB
    SESSION_ID: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),

    // 内存缓冲区（当前 session）
    _buffer: [],
    _initialized: false,

    // 原始 console 方法备份
    _origLog: null,
    _origWarn: null,
    _origError: null,
    _origInfo: null,

    // 敏感信息匹配模式
    _sensitivePatterns: [
        /(['"]?(?:api[_-]?key|apikey|token|secret|password|passwd|authorization|bearer)['"]?\s*[:=]\s*)['"]?[^\s'"]{4,}['"]?/gi,
        /(sk-|pk-|Bearer\s+)[a-zA-Z0-9_\-]{8,}/g
    ],

    init() {
        if (this._initialized) return;
        this._initialized = true;

        // 备份原始 console
        this._origLog = console.log.bind(console);
        this._origWarn = console.warn.bind(console);
        this._origError = console.error.bind(console);
        this._origInfo = console.info.bind(console);

        // 拦截 console
        console.log = (...args) => { this._capture('LOG', args); this._origLog(...args); };
        console.warn = (...args) => { this._capture('WARN', args); this._origWarn(...args); };
        console.error = (...args) => { this._capture('ERROR', args); this._origError(...args); };
        console.info = (...args) => { this._capture('INFO', args); this._origInfo(...args); };

        // 捕获未处理全局异常
        window.addEventListener('error', (e) => {
            this._capture('EXCEPTION', [
                `${e.message} at ${e.filename}:${e.lineno}:${e.colno}`
            ]);
        });

        window.addEventListener('unhandledrejection', (e) => {
            const reason = e.reason instanceof Error
                ? `${e.reason.message}\n${e.reason.stack || ''}`
                : String(e.reason);
            this._capture('UNHANDLED_REJECTION', [reason]);
        });

        // 记录启动信息
        this._capture('SYSTEM', [
            `[AppLogger] Session ${this.SESSION_ID} started`,
            `UA: ${navigator.userAgent}`,
            `Time: ${new Date().toISOString()}`
        ]);

        // 清理旧 session（保留最近 MAX_SESSIONS 次）
        this._pruneOldSessions();
    },

    // 捕获日志条目
    _capture(level, args) {
        const ts = new Date().toISOString().slice(11, 23); // HH:mm:ss.sss
        let message = args.map(a => {
            if (a === null) return 'null';
            if (a === undefined) return 'undefined';
            if (typeof a === 'object') {
                try { return JSON.stringify(a).slice(0, 500); } catch { return String(a); }
            }
            return String(a);
        }).join(' ');

        // 过滤敏感信息
        message = this._sanitize(message);

        // 控制单条长度
        if (message.length > 800) {
            message = message.slice(0, 800) + '...[truncated]';
        }

        const entry = `[${ts}][${level}] ${message}`;
        this._buffer.push(entry);

        // 定期写入 localStorage（每 20 条或遇到 ERROR/EXCEPTION）
        const isImportant = level === 'ERROR' || level === 'EXCEPTION' || level === 'UNHANDLED_REJECTION';
        if (this._buffer.length >= 20 || isImportant) {
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
    _flush() {
        if (this._buffer.length === 0) return;

        try {
            const sessions = this._loadSessions();
            let currentSession = sessions.find(s => s.id === this.SESSION_ID);
            if (!currentSession) {
                currentSession = { id: this.SESSION_ID, ts: Date.now(), entries: [] };
                sessions.push(currentSession);
            }

            currentSession.entries.push(...this._buffer);
            this._buffer = [];

            // 大小检查：如果超出限制，从最旧 session 开始删除
            let json = JSON.stringify(sessions);
            while (json.length > this.MAX_BYTES && sessions.length > 1) {
                sessions.shift();
                json = JSON.stringify(sessions);
            }

            // 如果单个 session 仍超出，截断最旧的条目
            if (json.length > this.MAX_BYTES && currentSession.entries.length > 100) {
                const removeCount = Math.floor(currentSession.entries.length * 0.3);
                currentSession.entries.splice(0, removeCount);
                json = JSON.stringify(sessions);
            }

            localStorage.setItem(this.STORAGE_KEY, json);
        } catch (e) {
            // localStorage 写入失败（空间不足等），静默忽略
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

    // 清理旧 session，保留最近 MAX_SESSIONS 个
    _pruneOldSessions() {
        try {
            const sessions = this._loadSessions();
            if (sessions.length >= this.MAX_SESSIONS) {
                // 保留最近 MAX_SESSIONS - 1 个，给当前 session 留位置
                const keep = sessions.slice(-(this.MAX_SESSIONS - 1));
                localStorage.setItem(this.STORAGE_KEY, JSON.stringify(keep));
            }
        } catch { /* 静默忽略 */ }
    },

    /**
     * 导出所有日志为文本（用户发给开发者排查问题）
     * @returns {string} 格式化的日志文本
     */
    export() {
        // 先刷新缓冲区
        this._flush();

        const sessions = this._loadSessions();
        const lines = [
            '=== AimerWT Debug Log ===',
            `Export Time: ${new Date().toISOString()}`,
            `Sessions: ${sessions.length}`,
            ''
        ];

        for (const session of sessions) {
            lines.push(`--- Session ${session.id} (${new Date(session.ts).toLocaleString()}) ---`);
            lines.push(...(session.entries || []));
            lines.push('');
        }

        return lines.join('\n');
    },

    /**
     * 下载日志为文件
     */
    download() {
        const text = this.export();
        const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `aimerWT_debug_${new Date().toISOString().slice(0, 10)}.log`;
        a.click();
        URL.revokeObjectURL(url);
    },

    /**
     * 清空所有日志
     */
    clear() {
        this._buffer = [];
        localStorage.removeItem(this.STORAGE_KEY);
    }
};

// 立即初始化（必须在其他脚本之前）
AppLogger.init();
window.AppLogger = AppLogger;
