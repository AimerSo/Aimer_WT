/**
 * AI助手模块入口
 * 
 * 功能定位:
 * - 整合所有AI相关模块
 * - 提供统一的初始化接口
 * 
 * 业务关联:
 * - 上游: 主应用
 * - 下游: 各AI子模块
 */

const AIManager = {
    // 版本号
    VERSION: '1.0.0',
    
    // 初始化状态
    initialized: false,
    
    /**
     * 初始化AI助手
     * 应在DOM加载完成后调用
     */
    init() {
        if (this.initialized) {
            console.log('[AI] 已经初始化');
            return;
        }
        
        console.log('[AI] 正在初始化AI助手模块...');
        
        // 初始化配置
        AI_CONFIG.init();
        
        // 初始化免责声明模块
        if (typeof AIDisclaimer !== 'undefined') {
            AIDisclaimer.init();
        }
        
        // 初始化聊天模块
        AIChat.init();
        
        this.initialized = true;
        console.log('[AI] AI助手模块初始化完成');
        
        // 显示初始化提示
        this._showInitNotification();
    },
    
    /**
     * 显示初始化提示
     */
    _showInitNotification() {
        // 如果有通知系统，可以在这里显示
        console.log('[AI] 提示：点击左上角Logo可以打开AI助手');
    },
    
    /**
     * 打开AI聊天框
     */
    openChat() {
        if (AIChat) {
            AIChat.open();
        }
    },
    
    /**
     * 关闭AI聊天框
     */
    closeChat() {
        if (AIChat) {
            AIChat.close();
        }
    },
    
    /**
     * 切换AI聊天框
     */
    toggleChat() {
        if (AIChat) {
            AIChat.toggle();
        }
    },
    
    /**
     * 获取当前配置
     */
    getConfig() {
        return AI_CONFIG.get();
    },
    
    /**
     * 更新配置
     */
    setConfig(key, value) {
        return AI_CONFIG.set(key, value);
    },
    
    /**
     * 获取日志统计
     */
    getLogStats() {
        return AIContextManager.getLogSummary();
    },
    
    /**
     * 分析当前状态
     */
    analyzeStatus() {
        return AIContextManager.getQuickAnalysis();
    }
};

// 导出到全局
window.AIManager = AIManager;

// 自动初始化（如果DOM已加载）
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => AIManager.init());
} else {
    // DOM已加载，延迟初始化确保其他脚本先加载
    setTimeout(() => AIManager.init(), 100);
}
