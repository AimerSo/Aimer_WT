/**
 * AI提供商基类
 * 
 * 功能定位:
 * - 定义AI提供商的标准接口
 * - 所有具体提供商需要继承此类
 * 
 * 业务关联:
 * - 上游: AI核心模块
 * - 下游: 具体提供商实现(OpenAI, Claude等)
 */

class BaseAIProvider {
    constructor(config) {
        this.config = config;
        this.name = 'base';
        this.label = '基础提供商';
    }
    
    /**
     * 发送聊天请求
     * @param {Array} messages - 消息数组 [{role, content}]
     * @param {Object} options - 额外选项
     * @returns {Promise<Object>} - 返回 {content, usage, error}
     */
    async chat(messages, options = {}) {
        throw new Error('子类必须实现chat方法');
    }
    
    /**
     * 流式聊天请求
     * @param {Array} messages - 消息数组
     * @param {Function} onChunk - 接收数据块的回调
     * @param {Object} options - 额外选项
     */
    async chatStream(messages, onChunk, options = {}) {
        throw new Error('子类必须实现chatStream方法');
    }
    
    /**
     * 验证配置是否有效
     * @returns {Object} - {valid, error}
     */
    validateConfig() {
        throw new Error('子类必须实现validateConfig方法');
    }
    
    /**
     * 获取可用模型列表
     * @returns {Array} - 模型列表
     */
    getModels() {
        return [];
    }
    
    /**
     * 格式化消息为提供商特定格式
     * @param {Array} messages - 标准格式消息
     * @returns {Array} - 提供商特定格式
     */
    formatMessages(messages) {
        return messages;
    }
    
    /**
     * 解析提供商响应为标准格式
     * @param {Object} response - 原始响应
     * @returns {Object} - 标准格式 {content, usage}
     */
    parseResponse(response) {
        return {
            content: '',
            usage: { prompt: 0, completion: 0, total: 0 }
        };
    }
    
    /**
     * 构建请求头
     * @returns {Object} - Headers对象
     */
    buildHeaders() {
        return {
            'Content-Type': 'application/json'
        };
    }
    
    /**
     * 构建请求体
     * @param {Array} messages - 消息数组
     * @param {Object} options - 选项
     * @returns {Object} - 请求体
     */
    buildRequestBody(messages, options = {}) {
        return {
            messages: this.formatMessages(messages),
            temperature: this.config.temperature || 0.7,
            max_tokens: this.config.maxTokens || 2048
        };
    }
}

window.BaseAIProvider = BaseAIProvider;
