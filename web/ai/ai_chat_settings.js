/**
 * AI聊天设置面板模块
 *
 * 功能定位:
 * - 管理AI设置面板的所有UI交互
 * - 下拉菜单初始化与状态管理
 * - API模式、提供商、模型切换
 * - API连接测试
 * - 配置加载与回显
 *
 * 业务关联:
 * - 上游: AIChat 初始化时调用
 * - 下游: AI_CONFIG、AIProviderManager、TokenTracker
 */

const AIChatSettings = {
    // AIChat 实例引用
    _chat: null,

    // 下拉菜单实例
    dropdowns: {},

    /**
     * 初始化设置模块
     * @param {Object} chat - AIChat 实例引用
     */
    init(chat) {
        this._chat = chat;
        this._initDropdowns();
        this._bindSettingsEvents();
    },

    // 初始化自定义下拉菜单
    _initDropdowns() {
        // API模式下拉菜单
        this.dropdowns.mode = new AppDropdownMenu({
            id: 'ai-setting-mode',
            containerId: 'ai-setting-mode-wrapper',
            options: [
                { value: 'aimer_free', label: 'Aimer免费提供（有限制的）' },
                { value: 'custom', label: '自定义API' }
            ],
            size: 'sm',
            onChange: (value) => {
                AI_CONFIG.set('apiMode', value);
                this._updateApiModeUI(value);
            }
        });

        // 提供商下拉菜单
        this.dropdowns.provider = new AppDropdownMenu({
            id: 'ai-setting-provider',
            containerId: 'ai-setting-provider-wrapper',
            options: [
                // [暂时关闭] { value: 'openai', label: 'OpenAI' },
                // [暂时关闭] { value: 'claude', label: 'Claude' },
                { value: 'siliconflow', label: '硅基流动' },
                { value: 'zhipu', label: '智谱清言' }
                // [暂时关闭] { value: 'custom', label: '自定义' }
            ],
            size: 'sm',
            onChange: (value) => {
                AI_CONFIG.set('provider', value);
                this._updateProviderUI(value);
            }
        });

        // 模型下拉菜单（动态）
        this.dropdowns.model = new AppDropdownMenu({
            id: 'ai-setting-model',
            containerId: 'ai-setting-model-wrapper',
            placeholder: '请选择模型',
            dynamic: true,
            size: 'sm',
            onChange: (value) => {
                const provider = AI_CONFIG.get('provider');

                if (value === 'custom') {
                    document.getElementById('ai-setting-custom-model-item').style.display = 'block';
                    const config = AI_CONFIG.getNested(`apiConfig.${provider}`) || {};
                    const customModelInput = document.getElementById('ai-setting-custom-model');
                    if (customModelInput && config.customModelId) {
                        customModelInput.value = config.customModelId;
                    }
                } else {
                    document.getElementById('ai-setting-custom-model-item').style.display = 'none';
                    AI_CONFIG.setNested(`apiConfig.${provider}.model`, value);
                }

                if (provider === 'siliconflow') {
                    this._updateSiliconFlowOptions(value);
                }
            }
        });

        // 思考模式下拉菜单
        this.dropdowns.thinking = new AppDropdownMenu({
            id: 'ai-setting-thinking',
            containerId: 'ai-setting-thinking-wrapper',
            options: [
                { value: 'false', label: '关闭' },
                { value: 'true', label: '开启' }
            ],
            size: 'sm',
            onChange: (value) => {
                const provider = AI_CONFIG.get('provider');
                AI_CONFIG.setNested(`apiConfig.${provider}.enableThinking`, value === 'true');
            }
        });

        // 从配置恢复值
        const config = AI_CONFIG.get();
        const apiMode = config.apiMode || 'aimer_free';
        this.dropdowns.mode.setValue(apiMode, false);

        // 初始化API模式UI
        setTimeout(() => {
            this._updateApiModeUI(apiMode);
        }, 0);

        this.dropdowns.provider.setValue(config.provider || 'siliconflow', false);
    },

    // 绑定设置面板事件
    _bindSettingsEvents() {
        const keyInput = document.getElementById('ai-setting-key');
        const keyToggle = document.getElementById('ai-setting-key-toggle');

        // 加载已保存的API Key
        this._loadApiKeyToInput();

        keyInput?.addEventListener('change', (e) => {
            const provider = AI_CONFIG.get('provider');
            AI_CONFIG.setNested(`apiConfig.${provider}.apiKey`, e.target.value);
        });

        // 眼睛图标切换显示/隐藏
        keyToggle?.addEventListener('click', () => {
            const isPassword = keyInput.type === 'password';
            keyInput.type = isPassword ? 'text' : 'password';
            keyToggle.innerHTML = isPassword ? '<i class="ri-eye-line"></i>' : '<i class="ri-eye-off-line"></i>';
        });

        // SiliconFlow特有设置
        document.getElementById('ai-setting-topP')?.addEventListener('change', (e) => {
            AI_CONFIG.setNested('apiConfig.siliconflow.topP', parseFloat(e.target.value));
        });

        document.getElementById('ai-setting-topK')?.addEventListener('change', (e) => {
            AI_CONFIG.setNested('apiConfig.siliconflow.topK', parseInt(e.target.value));
        });

        document.getElementById('ai-setting-minP')?.addEventListener('change', (e) => {
            AI_CONFIG.setNested('apiConfig.siliconflow.minP', parseFloat(e.target.value));
        });

        document.getElementById('ai-setting-thinking-budget')?.addEventListener('change', (e) => {
            AI_CONFIG.setNested('apiConfig.siliconflow.thinkingBudget', parseInt(e.target.value));
        });

        document.getElementById('ai-setting-frequency-penalty')?.addEventListener('change', (e) => {
            AI_CONFIG.setNested('apiConfig.siliconflow.frequencyPenalty', parseFloat(e.target.value));
        });

        // 自定义模型ID输入
        document.getElementById('ai-setting-custom-model')?.addEventListener('change', (e) => {
            const provider = AI_CONFIG.get('provider');
            const customModelId = e.target.value.trim();
            if (customModelId) {
                AI_CONFIG.setNested(`apiConfig.${provider}.customModelId`, customModelId);
                AI_CONFIG.setNested(`apiConfig.${provider}.model`, customModelId);
            }
        });

        // 通用设置
        document.getElementById('ai-setting-temperature')?.addEventListener('change', (e) => {
            const provider = AI_CONFIG.get('provider');
            AI_CONFIG.setNested(`apiConfig.${provider}.temperature`, parseFloat(e.target.value));
        });

        document.getElementById('ai-setting-maxTokens')?.addEventListener('change', (e) => {
            const provider = AI_CONFIG.get('provider');
            AI_CONFIG.setNested(`apiConfig.${provider}.maxTokens`, parseInt(e.target.value));
        });

        // API检测按钮
        document.getElementById('ai-chat-test-api-btn')?.addEventListener('click', () => {
            this._testApiConnection();
        });

        // 初始化tooltip位置调整
        this._initTooltipPosition();
    },

    // 初始化tooltip位置调整
    _initTooltipPosition() {
        const settingsPanel = document.getElementById('ai-chat-settings');
        if (!settingsPanel) return;

        let tooltipEl = document.getElementById('ai-setting-tooltip-global');
        if (!tooltipEl) {
            tooltipEl = document.createElement('div');
            tooltipEl.id = 'ai-setting-tooltip-global';
            tooltipEl.className = 'ai-setting-tooltip';
            document.body.appendChild(tooltipEl);
        }

        const helps = settingsPanel.querySelectorAll('.ai-setting-help');
        helps.forEach(help => {
            help.addEventListener('mouseenter', (e) => {
                const tooltipText = help.getAttribute('data-tooltip');
                if (!tooltipText) return;

                const helpRect = help.getBoundingClientRect();
                const panelRect = settingsPanel.getBoundingClientRect();

                tooltipEl.textContent = tooltipText;

                let left = helpRect.left;
                let top = helpRect.bottom + 8;

                const tooltipWidth = tooltipEl.offsetWidth || 220;
                const rightEdge = left + tooltipWidth;
                const panelRightEdge = panelRect.right - 10;

                if (rightEdge > panelRightEdge) {
                    left = panelRightEdge - tooltipWidth;
                    tooltipEl.style.setProperty('--arrow-left', `${helpRect.left - left + 4}px`);
                } else {
                    tooltipEl.style.setProperty('--arrow-left', '8px');
                }

                tooltipEl.style.left = `${left}px`;
                tooltipEl.style.top = `${top}px`;

                const arrowLeft = helpRect.left - left + 4;
                tooltipEl.querySelector('::before')?.style?.setProperty('left', `${arrowLeft}px`);

                tooltipEl.classList.add('show');
            });

            help.addEventListener('mouseleave', () => {
                tooltipEl.classList.remove('show');
            });
        });
    },

    // 根据API模式更新UI
    _updateApiModeUI(mode) {
        const customSettings = document.getElementById('ai-custom-api-settings');
        const tokenUsageItem = document.getElementById('ai-token-usage-item');
        const serverTokenItem = document.getElementById('ai-server-token-usage-item');

        if (customSettings) {
            customSettings.style.display = mode === 'custom' ? 'block' : 'none';
        }

        if (tokenUsageItem) {
            tokenUsageItem.style.display = mode === 'aimer_free' ? 'block' : 'none';
            if (mode === 'aimer_free') {
                this._updateTokenDisplay();
            }
        }

        if (serverTokenItem) {
            serverTokenItem.style.display = mode === 'aimer_free' ? 'block' : 'none';
            if (mode === 'aimer_free') {
                this._fetchServerTokenStats();
            }
        }

        if (mode === 'custom') {
            const provider = AI_CONFIG.get('provider') || 'siliconflow';
            this._updateProviderUI(provider);
        }
    },

    // 更新 Token 显示
    _updateTokenDisplay() {
        if (typeof TokenTracker === 'undefined') return;

        const stats = TokenTracker.getStats();
        const countEl = document.getElementById('ai-token-count');
        const promptEl = document.getElementById('ai-token-prompt');
        const completionEl = document.getElementById('ai-token-completion');

        if (countEl) countEl.textContent = TokenTracker.formatTokens(stats.totalTokens);
        if (promptEl) promptEl.textContent = `输入: ${TokenTracker.formatTokens(stats.promptTokens)}`;
        if (completionEl) completionEl.textContent = `输出: ${TokenTracker.formatTokens(stats.completionTokens)}`;
    },

    // 从服务器获取全局 Token 统计
    async _fetchServerTokenStats() {
        const countEl = document.getElementById('ai-server-token-count');
        const reqEl = document.getElementById('ai-server-request-count');

        try {
            const serverUrl = window._telemetryBaseUrl || 'https://telemetry.aimerelle.com';
            const resp = await fetch(`${serverUrl}/api/ai/stats`);
            if (!resp.ok) throw new Error('请求失败');
            const data = await resp.json();

            if (countEl && typeof TokenTracker !== 'undefined') {
                countEl.textContent = TokenTracker.formatTokens(data.total_tokens || 0);
            } else if (countEl) {
                countEl.textContent = (data.total_tokens || 0).toLocaleString();
            }
            if (reqEl) reqEl.textContent = `总请求: ${(data.total_requests || 0).toLocaleString()}`;
        } catch (e) {
            if (countEl) countEl.textContent = '--';
            if (reqEl) reqEl.textContent = '总请求: --';
        }
    },

    // 根据提供商更新UI
    _updateProviderUI(provider) {
        const models = AIProviderManager.getProviderModels(provider);
        if (this.dropdowns.model) {
            if (models.length > 0) {
                const options = [
                    { value: 'custom', label: '自定义' },
                    ...models.map(m => ({ value: m.id, label: m.label }))
                ];
                this.dropdowns.model.setOptions(options);
            } else {
                this.dropdowns.model.setOptions([{ value: 'default', label: '默认模型' }]);
            }
        }

        const isSiliconFlow = provider === 'siliconflow';
        document.getElementById('ai-setting-topP-item').style.display = isSiliconFlow ? 'block' : 'none';
        document.getElementById('ai-setting-topK-item').style.display = isSiliconFlow ? 'block' : 'none';
        document.getElementById('ai-setting-minP-item').style.display = isSiliconFlow ? 'block' : 'none';
        document.getElementById('ai-setting-frequency-penalty-item').style.display = isSiliconFlow ? 'block' : 'none';

        const isZhipu = provider === 'zhipu';
        if (isSiliconFlow && this.dropdowns.model) {
            this._updateSiliconFlowOptions(this.dropdowns.model.getValue());
        } else if (isZhipu) {
            document.getElementById('ai-setting-thinking-item').style.display = 'block';
            document.getElementById('ai-setting-thinking-budget-item').style.display = 'none';
        } else {
            document.getElementById('ai-setting-thinking-item').style.display = 'none';
            document.getElementById('ai-setting-thinking-budget-item').style.display = 'none';
        }

        this._loadProviderConfig(provider);
    },

    // 测试API连接
    async _testApiConnection() {
        const testBtn = document.getElementById('ai-chat-test-api-btn');
        const testResult = document.getElementById('ai-chat-test-result');

        if (!testBtn || !testResult) return;

        const provider = AI_CONFIG.get('provider');
        const config = AI_CONFIG.getNested(`apiConfig.${provider}`) || {};

        if (!config.apiKey) {
            testResult.className = 'ai-chat-test-result show error';
            testResult.textContent = '请先填写 API Key';
            return;
        }

        testBtn.disabled = true;
        testBtn.classList.add('testing');
        testBtn.innerHTML = '<i class="ri-loader-4-line ri-spin"></i> 检测中...';
        testResult.className = 'ai-chat-test-result';

        try {
            const fullConfig = AI_CONFIG.getNested(`apiConfig.${provider}`) || {};
            const defaultConfig = AI_CONFIG.defaults.apiConfig[provider] || {};
            const mergedConfig = {
                ...defaultConfig,
                ...fullConfig
            };

            if (!mergedConfig.apiKey) {
                throw new Error('API Key 未配置');
            }

            const providerInstance = AIProviderManager.getProvider(provider, mergedConfig);
            if (!providerInstance) {
                throw new Error('提供商未初始化');
            }

            const testMessages = [
                { role: 'user', content: '测试消息，请回复我"1"' }
            ];

            const startTime = Date.now();
            let firstByteTime = null;

            let responseContent = '';
            await providerInstance.chatStream(testMessages, (chunk) => {
                if (firstByteTime === null && chunk.content) {
                    firstByteTime = Date.now();
                }
                if (chunk.error) {
                    throw new Error(chunk.error);
                }
                if (chunk.content) {
                    responseContent += chunk.content;
                }
            });

            const latency = firstByteTime ? firstByteTime - startTime : Date.now() - startTime;

            if (responseContent && responseContent.trim()) {
                testResult.className = 'ai-chat-test-result show success';
                testResult.textContent = `✓ API连接正常 (延迟: ${latency}ms)`;
            } else {
                throw new Error('API返回空响应');
            }

        } catch (error) {
            console.error('[AI] API测试失败:', error);
            testResult.className = 'ai-chat-test-result show error';
            testResult.textContent = `✗ 连接失败: ${error.message}`;
        } finally {
            testBtn.disabled = false;
            testBtn.classList.remove('testing');
            testBtn.innerHTML = '<i class="ri-test-tube-line"></i> 检测API连接';
        }
    },

    // 更新SiliconFlow特定模型的选项（使用共享常量）
    _updateSiliconFlowOptions(model) {
        const supportsThinking = SiliconFlowProvider.THINKING_MODELS.some(m => model?.includes(m));
        document.getElementById('ai-setting-thinking-item').style.display = supportsThinking ? 'block' : 'none';
        document.getElementById('ai-setting-thinking-budget-item').style.display = supportsThinking ? 'block' : 'none';
    },

    // 加载提供商配置到UI
    _loadProviderConfig(provider) {
        const config = AI_CONFIG.getNested(`apiConfig.${provider}`) || {};

        this._loadApiKeyToInput();

        const tempInput = document.getElementById('ai-setting-temperature');
        if (tempInput) tempInput.value = config.temperature ?? 0.7;

        const maxTokensInput = document.getElementById('ai-setting-maxTokens');
        if (maxTokensInput) maxTokensInput.value = config.maxTokens ?? 2048;

        // 加载模型选择
        if (this.dropdowns.model && config.model) {
            const models = AIProviderManager.getProviderModels(provider);
            const modelIds = models.map(m => m.id);

            if (!modelIds.includes(config.model)) {
                this.dropdowns.model.setValue('custom', false);
                document.getElementById('ai-setting-custom-model-item').style.display = 'block';
                const customModelInput = document.getElementById('ai-setting-custom-model');
                if (customModelInput) {
                    customModelInput.value = config.model;
                }
            } else {
                this.dropdowns.model.setValue(config.model, false);
                document.getElementById('ai-setting-custom-model-item').style.display = 'none';
            }
        }

        // 加载SiliconFlow特有配置
        if (provider === 'siliconflow') {
            const topPInput = document.getElementById('ai-setting-topP');
            if (topPInput) topPInput.value = config.topP ?? 0.7;

            const topKInput = document.getElementById('ai-setting-topK');
            if (topKInput) topKInput.value = config.topK ?? 50;

            const minPInput = document.getElementById('ai-setting-minP');
            if (minPInput) minPInput.value = config.minP ?? 0.05;

            const thinkingBudgetInput = document.getElementById('ai-setting-thinking-budget');
            if (thinkingBudgetInput) thinkingBudgetInput.value = config.thinkingBudget ?? 4096;

            const frequencyPenaltyInput = document.getElementById('ai-setting-frequency-penalty');
            if (frequencyPenaltyInput) frequencyPenaltyInput.value = config.frequencyPenalty ?? 0;

            if (this.dropdowns.thinking) {
                this.dropdowns.thinking.setValue(String(config.enableThinking ?? false), false);
            }
        }

        // 加载智谱AI特有配置
        if (provider === 'zhipu') {
            if (this.dropdowns.thinking) {
                this.dropdowns.thinking.setValue(String(config.enableThinking ?? false), false);
            }
        }
    },

    // 加载API Key到输入框
    _loadApiKeyToInput() {
        const provider = AI_CONFIG.get('provider');
        const config = AI_CONFIG.getNested(`apiConfig.${provider}`) || {};
        const keyInput = document.getElementById('ai-setting-key');
        if (keyInput) {
            keyInput.value = config.apiKey || '';
        }
    }
};

window.AIChatSettings = AIChatSettings;
