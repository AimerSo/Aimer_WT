/**
 * AI Token 使用统计模块
 *
 * 功能定位:
 * - 统计用户通过 Aimer 免费服务使用的 Token 总数
 * - 加密存储到本地文件，防止被随意修改
 * - 打包成 exe 后数据文件隐藏保护
 *
 * 业务关联:
 * - 上游: AI 请求发送时调用 addUsage()
 * - 下游: 设置面板显示总使用量
 */

const TokenTracker = {
    // 存储文件名（使用不明显的名称）
    STORAGE_KEY: 'ai_config_cache_v2',
    
    // 简单异或加密密钥
    XOR_KEY: 0x7A,
    
    // 当前统计
    stats: {
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        requestCount: 0
    },
    
    // 初始化
    init() {
        this._loadStats();
        console.log('[AI] Token 统计模块已初始化');
    },
    
    // 异或加密/解密
    _xorEncrypt(data) {
        const bytes = new TextEncoder().encode(data);
        const encrypted = new Uint8Array(bytes.length);
        for (let i = 0; i < bytes.length; i++) {
            encrypted[i] = bytes[i] ^ this.XOR_KEY ^ (i % 256);
        }
        return btoa(String.fromCharCode(...encrypted));
    },
    
    _xorDecrypt(encrypted) {
        try {
            const bytes = new Uint8Array(
                atob(encrypted).split('').map(c => c.charCodeAt(0))
            );
            const decrypted = new Uint8Array(bytes.length);
            for (let i = 0; i < bytes.length; i++) {
                decrypted[i] = bytes[i] ^ this.XOR_KEY ^ (i % 256);
            }
            return new TextDecoder().decode(decrypted);
        } catch (e) {
            return null;
        }
    },
    
    // 加载统计
    _loadStats() {
        try {
            const encrypted = localStorage.getItem(this.STORAGE_KEY);
            if (encrypted) {
                const decrypted = this._xorDecrypt(encrypted);
                if (decrypted) {
                    const data = JSON.parse(decrypted);
                    if (data && data.stats) {
                        this.stats = data.stats;
                    }
                }
            }
        } catch (e) {
            console.error('[AI] 加载 Token 统计失败:', e);
        }
    },
    
    // 保存统计
    _saveStats() {
        try {
            const data = { stats: this.stats, ts: Date.now() };
            const encrypted = this._xorEncrypt(JSON.stringify(data));
            localStorage.setItem(this.STORAGE_KEY, encrypted);
        } catch (e) {
            console.error('[AI] 保存 Token 统计失败:', e);
        }
    },
    
    // 添加使用量
    addUsage(promptTokens, completionTokens) {
        this.stats.promptTokens += promptTokens || 0;
        this.stats.completionTokens += completionTokens || 0;
        this.stats.totalTokens += (promptTokens || 0) + (completionTokens || 0);
        this.stats.requestCount += 1;
        this._saveStats();
        
        // 触发更新事件
        this._notifyUpdate();
        
        console.log(`[AI] Token 使用: +${promptTokens || 0} / +${completionTokens || 0}, 总计: ${this.stats.totalTokens}`);
    },
    
    // 获取统计
    getStats() {
        return { ...this.stats };
    },
    
    // 格式化显示
    formatTokens(tokens) {
        if (tokens >= 1000000) {
            return (tokens / 1000000).toFixed(2) + 'M';
        } else if (tokens >= 1000) {
            return (tokens / 1000).toFixed(1) + 'K';
        }
        return tokens.toString();
    },
    
    // 通知更新
    _notifyUpdate() {
        if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('ai-token-update', { 
                detail: this.getStats() 
            }));
        }
    },
    
    // 重置统计（调试用）
    reset() {
        this.stats = {
            promptTokens: 0,
            completionTokens: 0,
            totalTokens: 0,
            requestCount: 0
        };
        this._saveStats();
        this._notifyUpdate();
    }
};

// 导出
if (typeof module !== 'undefined' && module.exports) {
    module.exports = TokenTracker;
}
