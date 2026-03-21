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
        this.serverUrl = config.serverUrl || 'https://telemetry.aimerelle.com';
    }

    async _buildHeaders(path, method, machineId = '') {
        const headers = {
            'Content-Type': 'application/json',
            'X-AimerWT-Client': '1'
        };
        if (window.pywebview?.api?.get_telemetry_auth_headers) {
            try {
                const authHeaders = await window.pywebview.api.get_telemetry_auth_headers(path, method, machineId || '');
                if (authHeaders && typeof authHeaders === 'object') {
                    Object.assign(headers, authHeaders);
                }
            } catch (error) {
                console.warn('[Proxy] 获取遥测认证头失败:', error);
            }
        }
        return headers;
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
            const machineId = window._telemetryHWID || '';
            const response = await fetch(`${this.serverUrl}/api/ai/chat`, {
                method: 'POST',
                headers: await this._buildHeaders('/api/ai/chat', 'POST', machineId),
                body: JSON.stringify(this._buildRequestBody(messages, options))
            });

            if (!response.ok) {
                const error = await response.json().catch(() => ({}));
                throw new Error(error.error || error.detail || `HTTP ${response.status}`);
            }

            const result = await response.json();
            return {
                content: this._extractContent(result),
                usage: this._normalizeUsage(result.usage)
            };
        } catch (error) {
            console.error('[Proxy] 请求失败:', error);
            return { error: error.message };
        }
    }

    async chatStream(messages, onChunk, options = {}) {
        try {
            const machineId = window._telemetryHWID || '';
            const response = await fetch(`${this.serverUrl}/api/ai/chat`, {
                method: 'POST',
                headers: await this._buildHeaders('/api/ai/chat', 'POST', machineId),
                body: JSON.stringify(this._buildRequestBody(messages, options))
            });

            if (!response.ok) {
                const error = await response.json().catch(() => ({}));
                throw new Error(error.error || error.detail || `HTTP ${response.status}`);
            }

            const contentType = (response.headers.get('content-type') || '').toLowerCase();
            const remainingHeader = response.headers.get('X-AI-Remaining');
            if (remainingHeader !== null) {
                const remaining = Number(remainingHeader);
                if (Number.isFinite(remaining)) {
                    onChunk({ quotaRemaining: remaining });
                }
            }
            if (!response.body || !contentType.includes('text/event-stream')) {
                const result = await response.json().catch(() => ({}));
                const content = this._extractContent(result);
                const usage = this._normalizeUsage(result.usage);
                if (content) {
                    onChunk({ content });
                }
                onChunk({ usage, done: true });
                return;
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop();

                for (const rawLine of lines) {
                    const line = rawLine.replace(/\r$/, '');
                    this._handleSSELine(line, onChunk);
                }
            }

            const lastLine = buffer.trim();
            if (lastLine) {
                this._handleSSELine(lastLine, onChunk);
            }
            onChunk({ done: true });
        } catch (error) {
            console.error('[Proxy] 流式请求失败:', error);
            onChunk({ error: error.message });
        }
    }

    parseResponse(response) {
        return {
            content: this._extractContent(response),
            usage: this._normalizeUsage(response.usage)
        };
    }

    _buildRequestBody(messages, options = {}) {
        return {
            machine_id: window._telemetryHWID || '',
            messages,
            context: options.context || {}
        };
    }

    _handleSSELine(line, onChunk) {
        if (!line || !line.startsWith('data: ')) {
            return;
        }

        const data = line.slice(6).trim();
        if (!data || data === '[DONE]') {
            return;
        }

        try {
            const parsed = JSON.parse(data);
            const content = this._extractContent(parsed);
            const usage = this._normalizeUsage(parsed.usage);

            if (content) {
                onChunk({ content });
            }
            if (usage.total > 0) {
                onChunk({ usage });
            }
        } catch (_error) {
            // 忽略非 JSON 或不完整片段
        }
    }

    _extractContent(payload) {
        if (!payload || typeof payload !== 'object') {
            return '';
        }

        if (typeof payload.content === 'string') {
            return payload.content;
        }

        const choice = Array.isArray(payload.choices) ? payload.choices[0] : null;
        if (!choice || typeof choice !== 'object') {
            return '';
        }

        const delta = choice.delta;
        if (typeof delta === 'string') {
            return delta;
        }
        if (delta && typeof delta.content === 'string') {
            return delta.content;
        }

        const message = choice.message;
        if (message && typeof message.content === 'string') {
            return message.content;
        }

        if (typeof choice.text === 'string') {
            return choice.text;
        }

        return '';
    }

    _normalizeUsage(usage) {
        if (!usage || typeof usage !== 'object') {
            return { prompt: 0, completion: 0, total: 0 };
        }

        const prompt = Number(usage.prompt ?? usage.prompt_tokens ?? 0) || 0;
        const completion = Number(usage.completion ?? usage.completion_tokens ?? 0) || 0;
        const total = Number(usage.total ?? usage.total_tokens ?? (prompt + completion)) || 0;

        return { prompt, completion, total };
    }
}

window.ProxyProvider = ProxyProvider;
