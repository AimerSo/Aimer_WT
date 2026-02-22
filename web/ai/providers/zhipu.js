/**
 * 智谱AI (ChatGLM) 提供商实现
 * 
 * 功能定位:
 * - 实现智谱AI API的调用
 * - 支持GLM-4.7-Flash、GLM-4.6、GLM-4.5V等模型
 * - 支持深度思考模式（thinking）
 * 
 * 业务关联:
 * - 上游: AI提供商管理器
 * - 下游: 智谱AI API (https://open.bigmodel.cn/api/paas/v4)
 * 
 * 版本: 1.0.0
 */

class ZhipuProvider extends BaseAIProvider {
    constructor(config) {
        super(config);
        this.name = 'zhipu';
        this.label = '智谱清言';
        this.defaultModels = [
            { id: 'glm-4.7-flash', label: 'GLM-4.7-Flash', description: '30B级SOTA模型，支持深度思考' },
            { id: 'glm-4.6', label: 'GLM-4.6', description: '多模态模型，支持图文理解' },
            { id: 'glm-4.5v', label: 'GLM-4.5V', description: '视觉增强模型' },
            { id: 'glm-4-plus', label: 'GLM-4-Plus', description: '高性能版本' },
            { id: 'glm-4-air', label: 'GLM-4-Air', description: '快速响应版本' }
        ];
    }

    validateConfig() {
        if (!this.config.apiKey) {
            return { valid: false, error: 'API Key 未配置' };
        }
        if (!this.config.baseUrl) {
            return { valid: false, error: 'API 地址未配置' };
        }
        return { valid: true };
    }

    getModels() {
        return this.defaultModels;
    }

    buildHeaders() {
        return {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.config.apiKey}`
        };
    }

    buildRequestBody(messages, options = {}) {
        const body = {
            model: this.config.model || 'glm-4.7-flash',
            messages: messages,
            temperature: this.config.temperature ?? 1.0,
            max_tokens: this.config.maxTokens ?? 65536,
            stream: options.stream || false
        };

        if (this.config.enableThinking) {
            body.thinking = {
                type: 'enabled'
            };
        }

        return body;
    }

    async chat(messages, options = {}) {
        const validation = this.validateConfig();
        if (!validation.valid) {
            return { error: validation.error };
        }

        try {
            const response = await fetch(`${this.config.baseUrl}/chat/completions`, {
                method: 'POST',
                headers: this.buildHeaders(),
                body: JSON.stringify(this.buildRequestBody(messages, options))
            });

            if (!response.ok) {
                const error = await response.json().catch(() => ({}));
                throw new Error(error.error?.message || error.message || `HTTP ${response.status}`);
            }

            const data = await response.json();
            return this.parseResponse(data);
        } catch (error) {
            console.error('[Zhipu] 请求失败:', error);
            return { error: error.message };
        }
    }

    async chatStream(messages, onChunk, options = {}) {
        const validation = this.validateConfig();
        if (!validation.valid) {
            onChunk({ error: validation.error });
            return;
        }

        try {
            const response = await fetch(`${this.config.baseUrl}/chat/completions`, {
                method: 'POST',
                headers: this.buildHeaders(),
                body: JSON.stringify(this.buildRequestBody(messages, { ...options, stream: true }))
            });

            if (!response.ok) {
                const error = await response.json().catch(() => ({}));
                throw new Error(error.error?.message || error.message || `HTTP ${response.status}`);
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder();

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                const chunk = decoder.decode(value);
                const lines = chunk.split('\n');

                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        const data = line.slice(6);
                        if (data === '[DONE]') {
                            onChunk({ done: true });
                            return;
                        }

                        try {
                            const parsed = JSON.parse(data);
                            const delta = parsed.choices?.[0]?.delta;
                            
                            const reasoningContent = delta?.reasoning_content;
                            const content = delta?.content;
                            
                            if (reasoningContent) {
                                onChunk({ reasoning: reasoningContent });
                            }
                            if (content) {
                                onChunk({ content: content });
                            }
                        } catch (e) {
                            // 忽略解析错误
                        }
                    }
                }
            }

            onChunk({ done: true });
        } catch (error) {
            console.error('[Zhipu] 流式请求失败:', error);
            onChunk({ error: error.message });
        }
    }

    parseResponse(response) {
        const choice = response.choices?.[0];
        const message = choice?.message;
        
        let content = message?.content || '';
        const reasoningContent = message?.reasoning_content;
        
        if (reasoningContent) {
            content = `<思考过程>\n${reasoningContent}\n</思考过程>\n\n${content}`;
        }
        
        return {
            content: content,
            usage: {
                prompt: response.usage?.prompt_tokens || 0,
                completion: response.usage?.completion_tokens || 0,
                total: response.usage?.total_tokens || 0
            }
        };
    }
}

window.ZhipuProvider = ZhipuProvider;
