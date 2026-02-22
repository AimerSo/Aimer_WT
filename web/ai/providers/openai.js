/**
 * OpenAI 提供商实现
 * 
 * 功能定位:
 * - 实现OpenAI API的调用
 * - 支持GPT-4、GPT-3.5等模型
 * 
 * 业务关联:
 * - 上游: AI提供商管理器
 * - 下游: OpenAI API
 */

class OpenAIProvider extends BaseAIProvider {
    constructor(config) {
        super(config);
        this.name = 'openai';
        this.label = 'OpenAI';
        this.defaultModels = [
            { id: 'gpt-4o', label: 'GPT-4o', description: '最智能的模型' },
            { id: 'gpt-4o-mini', label: 'GPT-4o Mini', description: '快速经济' },
            { id: 'gpt-4-turbo', label: 'GPT-4 Turbo', description: '强大的多模态模型' },
            { id: 'gpt-3.5-turbo', label: 'GPT-3.5 Turbo', description: '性价比之选' }
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
            model: this.config.model || 'gpt-4o-mini',
            messages: messages,
            temperature: this.config.temperature ?? 0.7,
            max_tokens: this.config.maxTokens ?? 2048,
            stream: options.stream || false
        };

        // 添加系统提示词
        if (options.systemPrompt && !messages.some(m => m.role === 'system')) {
            body.messages = [
                { role: 'system', content: options.systemPrompt },
                ...messages
            ];
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
                throw new Error(error.error?.message || `HTTP ${response.status}`);
            }

            const data = await response.json();
            return this.parseResponse(data);
        } catch (error) {
            console.error('[OpenAI] 请求失败:', error);
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
                throw new Error(error.error?.message || `HTTP ${response.status}`);
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
                            const delta = parsed.choices?.[0]?.delta?.content || '';
                            if (delta) {
                                onChunk({ content: delta });
                            }
                        } catch (e) {
                            // 忽略解析错误
                        }
                    }
                }
            }

            onChunk({ done: true });
        } catch (error) {
            console.error('[OpenAI] 流式请求失败:', error);
            onChunk({ error: error.message });
        }
    }

    parseResponse(response) {
        const choice = response.choices?.[0];
        return {
            content: choice?.message?.content || '',
            usage: {
                prompt: response.usage?.prompt_tokens || 0,
                completion: response.usage?.completion_tokens || 0,
                total: response.usage?.total_tokens || 0
            }
        };
    }
}

window.OpenAIProvider = OpenAIProvider;
