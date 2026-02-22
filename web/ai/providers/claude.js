/**
 * Claude 提供商实现
 * 
 * 功能定位:
 * - 实现Anthropic Claude API的调用
 * - 支持Claude 3系列模型
 * 
 * 业务关联:
 * - 上游: AI提供商管理器
 * - 下游: Anthropic API
 */

class ClaudeProvider extends BaseAIProvider {
    constructor(config) {
        super(config);
        this.name = 'claude';
        this.label = 'Claude';
        this.defaultModels = [
            { id: 'claude-3-opus-20240229', label: 'Claude 3 Opus', description: '最强大的模型' },
            { id: 'claude-3-sonnet-20240229', label: 'Claude 3 Sonnet', description: '平衡性能与速度' },
            { id: 'claude-3-haiku-20240307', label: 'Claude 3 Haiku', description: '最快响应' }
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
            'x-api-key': this.config.apiKey,
            'anthropic-version': '2023-06-01'
        };
    }

    formatMessages(messages) {
        // Claude使用不同的消息格式
        const systemMessage = messages.find(m => m.role === 'system');
        const chatMessages = messages
            .filter(m => m.role !== 'system')
            .map(m => ({
                role: m.role === 'assistant' ? 'assistant' : 'user',
                content: m.content
            }));
        
        return { systemMessage, messages: chatMessages };
    }

    buildRequestBody(messages, options = {}) {
        const { systemMessage, messages: formattedMessages } = this.formatMessages(messages);
        
        const body = {
            model: this.config.model || 'claude-3-haiku-20240307',
            messages: formattedMessages,
            max_tokens: this.config.maxTokens ?? 2048,
            temperature: this.config.temperature ?? 0.7,
            stream: options.stream || false
        };

        if (systemMessage || options.systemPrompt) {
            body.system = systemMessage?.content || options.systemPrompt;
        }

        return body;
    }

    async chat(messages, options = {}) {
        const validation = this.validateConfig();
        if (!validation.valid) {
            return { error: validation.error };
        }

        try {
            const response = await fetch(`${this.config.baseUrl}/messages`, {
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
            console.error('[Claude] 请求失败:', error);
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
            const response = await fetch(`${this.config.baseUrl}/messages`, {
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
                        
                        try {
                            const parsed = JSON.parse(data);
                            
                            if (parsed.type === 'content_block_delta') {
                                const text = parsed.delta?.text || '';
                                if (text) {
                                    onChunk({ content: text });
                                }
                            } else if (parsed.type === 'message_stop') {
                                onChunk({ done: true });
                                return;
                            }
                        } catch (e) {
                            // 忽略解析错误
                        }
                    }
                }
            }

            onChunk({ done: true });
        } catch (error) {
            console.error('[Claude] 流式请求失败:', error);
            onChunk({ error: error.message });
        }
    }

    parseResponse(response) {
        const content = response.content?.[0]?.text || '';
        return {
            content: content,
            usage: {
                prompt: response.usage?.input_tokens || 0,
                completion: response.usage?.output_tokens || 0,
                total: (response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0)
            }
        };
    }
}

window.ClaudeProvider = ClaudeProvider;
