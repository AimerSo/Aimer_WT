/**
 * 日志收集器
 * 
 * 功能定位:
 * - 收集软件运行日志
 * - 为AI提供上下文分析数据
 * 
 * 业务关联:
 * - 上游: 软件日志系统
 * - 下游: AI上下文管理器
 */

const LogCollector = {
    // 日志缓存
    _logs: [],
    
    // 最大缓存条数
    maxLogs: 100,
    
    // 初始化
    init() {
        // 拦截console方法以捕获日志
        this._interceptConsole();
        
        // 监听全局错误
        this._setupGlobalErrorHandling();
        
        // 监听网络请求错误
        this._interceptNetworkRequests();
        
        // 监听来自后端的日志推送
        if (window.app && window.app.appendLog) {
            const originalAppendLog = window.app.appendLog;
            window.app.appendLog = (msg) => {
                this._addLog(msg, 'backend');
                return originalAppendLog.call(window.app, msg);
            };
        }
        
        console.log('[AI] 日志收集器已初始化');
    },
    
    // 设置全局错误处理
    _setupGlobalErrorHandling() {
        // 捕获未处理的JavaScript错误
        window.addEventListener('error', (event) => {
            const errorInfo = {
                type: 'javascript_error',
                message: event.message,
                filename: event.filename,
                lineno: event.lineno,
                colno: event.colno,
                stack: event.error?.stack || '无堆栈信息'
            };
            this._addLog(`[JS错误] ${event.message} at ${event.filename}:${event.lineno}:${event.colno}\n堆栈: ${errorInfo.stack}`, 'error');
            
            // 标记为已处理，避免重复上报
            event.preventDefault();
        }, true);
        
        // 捕获未处理的Promise拒绝
        window.addEventListener('unhandledrejection', (event) => {
            const reason = event.reason;
            let errorMessage = '未知错误';
            let stack = '无堆栈信息';
            
            if (reason instanceof Error) {
                errorMessage = reason.message;
                stack = reason.stack || '无堆栈信息';
            } else if (typeof reason === 'string') {
                errorMessage = reason;
            } else if (reason && typeof reason === 'object') {
                try {
                    errorMessage = JSON.stringify(reason);
                } catch (e) {
                    errorMessage = String(reason);
                }
            }
            
            this._addLog(`[未处理的Promise错误] ${errorMessage}\n堆栈: ${stack}`, 'error');
            event.preventDefault();
        });
        
        // 捕获资源加载错误（图片、脚本、样式表等）
        window.addEventListener('error', (event) => {
            const target = event.target;
            // 检查是否是资源加载错误
            if (target && (target.tagName === 'IMG' || target.tagName === 'SCRIPT' || target.tagName === 'LINK')) {
                const src = target.src || target.href || '未知资源';
                this._addLog(`[资源加载失败] ${target.tagName}: ${src}`, 'error');
            }
        }, true);
    },
    
    // 拦截网络请求以捕获错误
    _interceptNetworkRequests() {
        // 拦截fetch请求
        const originalFetch = window.fetch;
        window.fetch = async (...args) => {
            const url = args[0];
            const startTime = Date.now();
            
            try {
                const response = await originalFetch.apply(window, args);
                const duration = Date.now() - startTime;
                
                // 记录失败的请求
                if (!response.ok) {
                    this._addLog(`[HTTP错误] ${response.status} ${response.statusText} - ${url} (${duration}ms)`, 'error');
                }
                
                return response;
            } catch (error) {
                const duration = Date.now() - startTime;
                this._addLog(`[网络请求失败] ${url} - ${error.message} (${duration}ms)`, 'error');
                throw error;
            }
        };
        
        // 拦截XMLHttpRequest
        const originalXHROpen = XMLHttpRequest.prototype.open;
        const originalXHRSend = XMLHttpRequest.prototype.send;
        
        XMLHttpRequest.prototype.open = function(method, url, ...rest) {
            this._logCollectorUrl = url;
            this._logCollectorMethod = method;
            this._logCollectorStartTime = null;
            return originalXHROpen.apply(this, [method, url, ...rest]);
        };
        
        XMLHttpRequest.prototype.send = function(...args) {
            this._logCollectorStartTime = Date.now();
            
            this.addEventListener('loadend', () => {
                const duration = Date.now() - this._logCollectorStartTime;
                const url = this._logCollectorUrl;
                
                if (this.status >= 400) {
                    this._addLog(`[XHR错误] ${this.status} ${this.statusText} - ${url} (${duration}ms)`, 'error');
                }
            });
            
            return originalXHRSend.apply(this, args);
        };
    },
    
    // 拦截console方法
    _interceptConsole() {
        const levels = ['log', 'info', 'warn', 'error', 'debug'];
        
        levels.forEach(level => {
            const original = console[level];
            console[level] = (...args) => {
                const message = args.map(arg => {
                    if (typeof arg === 'object') {
                        try {
                            return JSON.stringify(arg);
                        } catch (e) {
                            return String(arg);
                        }
                    }
                    return String(arg);
                }).join(' ');
                
                this._addLog(message, level);
                original.apply(console, args);
            };
        });
    },
    
    // 添加日志
    _addLog(message, level = 'info') {
        const logEntry = {
            timestamp: new Date().toISOString(),
            level: level,
            message: message,
            // 解析日志内容提取关键信息
            parsed: this._parseLogMessage(message)
        };
        
        this._logs.push(logEntry);
        
        // 保持缓存大小
        if (this._logs.length > this.maxLogs) {
            this._logs.shift();
        }
    },
    
    // 解析日志消息
    _parseLogMessage(message) {
        const parsed = {
            type: 'unknown',
            category: null,
            keywords: []
        };
        
        // 识别日志类型
        if (message.includes('[SUCCESS]')) {
            parsed.type = 'success';
            parsed.keywords.push('成功');
        } else if (message.includes('[ERROR]') || message.includes('错误')) {
            parsed.type = 'error';
            parsed.keywords.push('错误');
        } else if (message.includes('[WARN]') || message.includes('警告')) {
            parsed.type = 'warning';
            parsed.keywords.push('警告');
        } else if (message.includes('[扫描]')) {
            parsed.type = 'scan';
            parsed.category = '扫描';
        } else if (message.includes('[安装]') || message.includes('安装')) {
            parsed.type = 'install';
            parsed.category = '安装';
        } else if (message.includes('[遥测]')) {
            parsed.type = 'telemetry';
            parsed.category = '遥测';
        }
        
        // 提取关键词
        const keywords = [
            '语音包', '涂装', '炮镜', '游戏路径', '导入', '解压',
            '失败', '成功', '错误', '警告', '扫描', '安装'
        ];
        
        keywords.forEach(keyword => {
            if (message.includes(keyword)) {
                parsed.keywords.push(keyword);
            }
        });
        
        return parsed;
    },
    
    // 获取最近的日志
    getRecentLogs(count = 50, filter = null) {
        let logs = [...this._logs];
        
        // 应用过滤
        if (filter) {
            if (filter.level) {
                logs = logs.filter(log => log.level === filter.level);
            }
            if (filter.type) {
                logs = logs.filter(log => log.parsed.type === filter.type);
            }
            if (filter.keyword) {
                logs = logs.filter(log => 
                    log.message.includes(filter.keyword) ||
                    log.parsed.keywords.includes(filter.keyword)
                );
            }
        }
        
        return logs.slice(-count);
    },
    
    // 获取格式化的日志文本（用于AI上下文）
    getFormattedLogs(count = 30) {
        const logs = this.getRecentLogs(count);
        
        if (logs.length === 0) {
            return '暂无日志记录。';
        }
        
        return logs.map(log => {
            const time = new Date(log.timestamp).toLocaleTimeString();
            const level = log.level.toUpperCase();
            return `[${time}] [${level}] ${log.message}`;
        }).join('\n');
    },
    
    // 分析日志中的问题
    analyzeIssues() {
        const recentLogs = this.getRecentLogs(50);
        const issues = {
            errors: [],
            warnings: [],
            patterns: []
        };
        
        recentLogs.forEach(log => {
            if (log.parsed.type === 'error') {
                issues.errors.push(log);
            } else if (log.parsed.type === 'warning') {
                issues.warnings.push(log);
            }
        });
        
        // 检测模式
        const errorCount = issues.errors.length;
        const warningCount = issues.warnings.length;
        
        if (errorCount > 0) {
            issues.patterns.push(`最近记录中发现 ${errorCount} 个错误`);
        }
        if (warningCount > 0) {
            issues.patterns.push(`最近记录中发现 ${warningCount} 个警告`);
        }
        
        return issues;
    },
    
    // 清空日志缓存
    clear() {
        this._logs = [];
    },
    
    // 获取统计信息
    getStats() {
        const stats = {
            total: this._logs.length,
            byLevel: {},
            byType: {}
        };
        
        this._logs.forEach(log => {
            stats.byLevel[log.level] = (stats.byLevel[log.level] || 0) + 1;
            stats.byType[log.parsed.type] = (stats.byType[log.parsed.type] || 0) + 1;
        });
        
        return stats;
    }
};

window.LogCollector = LogCollector;
