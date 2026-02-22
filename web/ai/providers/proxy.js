/**
 * 后端代理提供商
 *
 * 功能定位:
 * - 通过远程服务器转发AI请求
 * - 保护API密钥，实现用量限制
 *
 * 业务关联:
 * - 上游: AI提供商管理器
 * - 下游: Aimer AI代理服务器
 */

class ProxyProvider extends BaseAIProvider {
    constructor(config) {
        super(config);
        this.name = 'proxy';
        this.label = 'Aimer AI服务';
        // 服务器地址，部署后修改为实际域名
        this.serverUrl = config.serverUrl || 'https://ai.aimerelle.com';
    }

    validateConfig() {
        return { valid: true };
    }

    getModels() {
        return [
            { id: 'glm-4.7-flash', label: 'GLM-4.7-Flash', description: '智谱AI默认模型' }
        ];
    }

    async chat(messages, options = {}) {
        try {
            const response = await fetch(`${this.serverUrl}/api/chat`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    messages: messages,
                    system_prompt: options.systemPrompt,
                    temperature: options.temperature ?? 0.7,
                    max_tokens: options.maxTokens ?? 2048,
                    stream: false
                })
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.detail || `HTTP ${response.status}`);
            }

            const result = await response.json();
            return {
                content: result.content,
                usage: result.usage || { prompt: 0, completion: 0, total: 0 }
            };
        } catch (error) {
            console.error('[Proxy] 请求失败:', error);
            return { error: error.message };
        }
    }

    async chatStream(messages, onChunk, options = {}) {
        try {
            const response = await fetch(`${this.serverUrl}/api/chat/stream`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    messages: messages,
                    system_prompt: options.systemPrompt,
                    temperature: options.temperature ?? 0.7,
                    max_tokens: options.maxTokens ?? 2048,
                    stream: true
                })
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.detail || `HTTP ${response.status}`);
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
                        if (data && data !== '[DONE]') {
                            try {
                                const parsed = JSON.parse(data);
                                const content = parsed.choices?.[0]?.delta?.content;
                                if (content) {
                                    onChunk({ content });
                                }
                            } catch (e) {
                                // 忽略解析错误
                            }
                        }
                    }
                }
            }

            onChunk({ done: true });
        } catch (error) {
            console.error('[Proxy] 流式请求失败:', error);
            onChunk({ error: error.message });
        }
    }

    parseResponse(response) {
        return {
            content: response.content || '',
            usage: response.usage || { prompt: 0, completion: 0, total: 0 }
        };
    }
}

window.ProxyProvider = ProxyProvider;
