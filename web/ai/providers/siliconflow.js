/**
 * SiliconFlow 提供商实现
 * 
 * 功能定位:
 * - 实现SiliconFlow API的调用
 * - 支持Qwen、DeepSeek、GLM等国产模型
 * 
 * 业务关联:
 * - 上游: AI提供商管理器
 * - 下游: SiliconFlow API (https://api.siliconflow.cn/v1)
 */

class SiliconFlowProvider extends BaseAIProvider {
    constructor(config) {
        super(config);
        this.name = 'siliconflow';
        this.label = '硅基流动';
        this.defaultModels = [
            { id: 'Qwen/Qwen3-8B', label: 'Qwen3-8B', description: '阿里通义千问3-8B，性价比高' },
            { id: 'Qwen/Qwen3-14B', label: 'Qwen3-14B', description: '阿里通义千问3-14B，性能更强' },
            { id: 'Qwen/Qwen3-32B', label: 'Qwen3-32B', description: '阿里通义千问3-32B，大参数模型' },
            { id: 'deepseek-ai/DeepSeek-V3.2', label: 'DeepSeek-V3.2', description: 'DeepSeek最新版本' },
            { id: 'Pro/deepseek-ai/DeepSeek-V3.2', label: 'DeepSeek-V3.2 Pro', description: 'DeepSeek专业版' },
            { id: 'Pro/zai-org/GLM-4.7', label: 'GLM-4.7', description: '智谱GLM-4.7' },
            { id: 'zai-org/GLM-4.6', label: 'GLM-4.6', description: '智谱GLM-4.6' },
            { id: 'tencent/Hunyuan-A13B-Instruct', label: 'Hunyuan-A13B', description: '腾讯混元' }
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
            model: this.config.model || 'Qwen/Qwen3-8B',
            messages: messages,
            temperature: this.config.temperature ?? 0.7,
            max_tokens: this.config.maxTokens ?? 2048,
            top_p: this.config.topP ?? 0.7,
            stream: options.stream || false
        };

        // Top-K采样
        if (this.config.topK !== undefined) {
            body.top_k = this.config.topK;
        }

        // Qwen3系列支持min_p参数
        if (this.config.model?.includes('Qwen3') && this.config.minP !== undefined) {
            body.min_p = this.config.minP;
        }

        // 频率惩罚，减少重复内容
        if (this.config.frequencyPenalty !== undefined) {
            body.frequency_penalty = this.config.frequencyPenalty;
        }

        // 支持思考模式的模型
        if (this.config.enableThinking !== undefined) {
            const thinkingModels = [
                'Pro/zai-org/GLM-4.7',
                'deepseek-ai/DeepSeek-V3.2',
                'Pro/deepseek-ai/DeepSeek-V3.2',
                'zai-org/GLM-4.6',
                'Qwen/Qwen3-8B',
                'Qwen/Qwen3-14B',
                'Qwen/Qwen3-32B',
                'Qwen/Qwen3-30B-A3B',
                'tencent/Hunyuan-A13B-Instruct',
                'zai-org/GLM-4.5V',
                'deepseek-ai/DeepSeek-V3.1-Terminus',
                'Pro/deepseek-ai/DeepSeek-V3.1-Terminus'
            ];

            if (thinkingModels.some(m => this.config.model?.includes(m))) {
                body.enable_thinking = this.config.enableThinking;
                if (this.config.thinkingBudget) {
                    body.thinking_budget = this.config.thinkingBudget;
                }
            }
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
            console.error('[SiliconFlow] 请求失败:', error);
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
                            
                            // 处理思考内容（reasoning_content）
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
            console.error('[SiliconFlow] 流式请求失败:', error);
            onChunk({ error: error.message });
        }
    }

    parseResponse(response) {
        const choice = response.choices?.[0];
        const message = choice?.message;
        
        // 处理思考内容
        let content = message?.content || '';
        const reasoningContent = message?.reasoning_content;
        
        // 如果有思考内容，将其附加到回复中
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

window.SiliconFlowProvider = SiliconFlowProvider;
