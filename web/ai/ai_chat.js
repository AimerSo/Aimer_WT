/**
 * AI聊天框核心模块
 * 
 * 功能定位:
 * - 管理聊天框的UI交互
 * - 处理消息发送和接收
 * - 集成AI提供商和上下文管理
 * 
 * 业务关联:
 * - 上游: 用户点击Logo触发
 * - 下游: AI提供商、上下文管理器
 */

const AIChat = {
    // DOM元素引用
    elements: {},
    
    // 状态
    state: {
        isOpen: false,
        isLoading: false,
        messages: [],
        currentStream: null,
        settingsOpen: false,
        tokens: { prompt: 0, completion: 0, total: 0 },
        emotionCache: {}  // 流式输出时的情绪标签缓存，固定每次选择的表情
    },
    
    // 下拉菜单实例
    dropdowns: {},
    
    // 初始化
    init() {
        this._createDOM();
        this._initDropdowns();
        this._bindEvents();
        this._bindLogoClick();
        
        // 初始化子模块
        AIProviderManager.init();
        AIContextManager.init();
        
        // 初始化 Token 追踪
        if (typeof TokenTracker !== 'undefined') {
            TokenTracker.init();
            // 监听 Token 更新事件
            window.addEventListener('ai-token-update', () => {
                if (AI_CONFIG.get('apiMode') === 'aimer_free') {
                    this._updateTokenDisplay();
                }
            });
        }
        
        console.log('[AI] 聊天模块已初始化');
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
        // 注意：OpenAI和Claude暂时关闭，后续可能重新启用
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
                
                // 处理自定义模型选择
                if (value === 'custom') {
                    document.getElementById('ai-setting-custom-model-item').style.display = 'block';
                    // 如果已有自定义模型ID，加载到输入框
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
    
    // 创建DOM结构
    _createDOM() {
        // 遮罩层
        const overlay = document.createElement('div');
        overlay.className = 'ai-chat-overlay';
        overlay.id = 'ai-chat-overlay';
        document.body.appendChild(overlay);
        
        // 聊天容器
        const container = document.createElement('div');
        container.className = 'ai-chat-container';
        container.id = 'ai-chat-container';
        container.innerHTML = `
            <div class="ai-chat-settings" id="ai-chat-settings">
                <div class="ai-chat-settings-title">AI设置</div>
                <div class="ai-chat-setting-item">
                    <div class="ai-chat-setting-label">API模式</div>
                    <div id="ai-setting-mode-wrapper" class="ai-dropdown-wrapper"></div>
                </div>
                <div class="ai-chat-setting-item" id="ai-token-usage-item" style="display: none;">
                    <div class="ai-chat-setting-label">
                        <i class="ri-coins-line" style="color: var(--primary);"></i>
                        已使用的 Token 数
                    </div>
                    <div class="ai-token-usage-display">
                        <span class="ai-token-count" id="ai-token-count">0</span>
                        <span class="ai-token-label">tokens</span>
                    </div>
                    <div class="ai-token-detail">
                        <span id="ai-token-prompt">输入: 0</span>
                        <span class="ai-token-divider">|</span>
                        <span id="ai-token-completion">输出: 0</span>
                    </div>
                </div>
                <div id="ai-custom-api-settings" style="display: none;">
                    <div class="ai-chat-setting-item">
                        <div class="ai-chat-setting-label">提供商</div>
                        <div id="ai-setting-provider-wrapper" class="ai-dropdown-wrapper"></div>
                    </div>
                    <div class="ai-chat-setting-item">
                        <div class="ai-chat-setting-label">API Key</div>
                        <div class="ai-chat-setting-input-wrapper">
                            <input type="password" class="ai-chat-setting-input" id="ai-setting-key" placeholder="输入你的API Key">
                            <button type="button" class="ai-chat-input-toggle" id="ai-setting-key-toggle" title="显示/隐藏">
                                <i class="ri-eye-off-line"></i>
                            </button>
                        </div>
                    </div>
                    <div class="ai-chat-setting-item">
                        <div class="ai-chat-setting-label">模型</div>
                        <div id="ai-setting-model-wrapper" class="ai-dropdown-wrapper"></div>
                    </div>
                    <div class="ai-chat-setting-item" id="ai-setting-custom-model-item" style="display: none;">
                        <div class="ai-chat-setting-label">
                            自定义模型ID
                            <span class="ai-setting-help" data-tooltip="输入自定义模型的完整ID，例如：gpt-4o、claude-3-opus等">
                                <i class="ri-question-line"></i>
                            </span>
                        </div>
                        <input type="text" class="ai-chat-setting-input" id="ai-setting-custom-model" placeholder="输入模型ID">
                    </div>
                    <div class="ai-chat-setting-item" id="ai-setting-topP-item" style="display: none;">
                        <div class="ai-chat-setting-label">
                            Top P
                            <span class="ai-setting-help" data-tooltip="核采样阈值，控制输出多样性。值越小，输出越确定；值越大，输出越多样。范围：0-1，建议：0.7">
                                <i class="ri-question-line"></i>
                            </span>
                        </div>
                        <input type="number" class="ai-chat-setting-input" id="ai-setting-topP" min="0" max="1" step="0.1" value="0.7">
                    </div>
                    <div class="ai-chat-setting-item" id="ai-setting-topK-item" style="display: none;">
                        <div class="ai-chat-setting-label">
                            Top K
                            <span class="ai-setting-help" data-tooltip="Top-K采样，限制候选token数量。值越小，输出越保守；值越大，选择越多。范围：1-100，建议：50">
                                <i class="ri-question-line"></i>
                            </span>
                        </div>
                        <input type="number" class="ai-chat-setting-input" id="ai-setting-topK" min="1" max="100" step="1" value="50">
                    </div>
                    <div class="ai-chat-setting-item" id="ai-setting-minP-item" style="display: none;">
                        <div class="ai-chat-setting-label">
                            Min P (Qwen3)
                            <span class="ai-setting-help" data-tooltip="Qwen3模型特有参数，动态过滤阈值。范围：0-1，建议：0.05">
                                <i class="ri-question-line"></i>
                            </span>
                        </div>
                        <input type="number" class="ai-chat-setting-input" id="ai-setting-minP" min="0" max="1" step="0.01" value="0.05">
                    </div>
                    <div class="ai-chat-setting-item" id="ai-setting-thinking-item" style="display: none;">
                        <div class="ai-chat-setting-label">
                            思考模式
                            <span class="ai-setting-help" data-tooltip="启用后模型会先思考再回答，适合复杂问题。支持：GLM-4.7、DeepSeek-V3.2、Qwen3等">
                                <i class="ri-question-line"></i>
                            </span>
                        </div>
                        <div id="ai-setting-thinking-wrapper" class="ai-dropdown-wrapper"></div>
                    </div>
                    <div class="ai-chat-setting-item" id="ai-setting-thinking-budget-item" style="display: none;">
                        <div class="ai-chat-setting-label">
                            思考预算 (Tokens)
                            <span class="ai-setting-help" data-tooltip="思考模式下的最大思维链长度。范围：128-32768，建议：4096">
                                <i class="ri-question-line"></i>
                            </span>
                        </div>
                        <input type="number" class="ai-chat-setting-input" id="ai-setting-thinking-budget" min="128" max="32768" step="128" value="4096">
                    </div>
                    <div class="ai-chat-setting-item">
                        <div class="ai-chat-setting-label">
                            Temperature
                            <span class="ai-setting-help" data-tooltip="控制输出的随机性。值越低，输出越确定；值越高，输出越随机。范围：0-2，建议：0.7">
                                <i class="ri-question-line"></i>
                            </span>
                        </div>
                        <input type="number" class="ai-chat-setting-input" id="ai-setting-temperature" min="0" max="2" step="0.1" value="0.7">
                    </div>
                    <div class="ai-chat-setting-item">
                        <div class="ai-chat-setting-label">
                            Max Tokens
                            <span class="ai-setting-help" data-tooltip="模型最多生成多少token。范围：100-8192，建议：2048">
                                <i class="ri-question-line"></i>
                            </span>
                        </div>
                        <input type="number" class="ai-chat-setting-input" id="ai-setting-maxTokens" min="100" max="8192" step="100" value="2048">
                    </div>
                    <div class="ai-chat-setting-item" id="ai-setting-frequency-penalty-item" style="display: none;">
                        <div class="ai-chat-setting-label">
                            频率惩罚
                            <span class="ai-setting-help" data-tooltip="减少重复内容的生成。正值会减少重复，负值会增加重复。范围：-2.0到2.0，建议：0-0.5">
                                <i class="ri-question-line"></i>
                            </span>
                        </div>
                        <input type="number" class="ai-chat-setting-input" id="ai-setting-frequency-penalty" min="-2" max="2" step="0.1" value="0">
                    </div>
                    <div class="ai-chat-setting-item">
                        <button class="ai-chat-test-api-btn" id="ai-chat-test-api-btn">
                            <i class="ri-test-tube-line"></i> 检测API连接
                        </button>
                        <div class="ai-chat-test-result" id="ai-chat-test-result"></div>
                    </div>
                </div>
            </div>
            
            <div class="ai-chat-header">
                <span class="ai-chat-beta-tag">不稳定测试版</span>
            </div>

            <div class="ai-chat-tokens" id="ai-chat-tokens" title="当前对话预估Tokens">
                <i class="ri-coins-line"></i>
                <span class="ai-chat-tokens-count" id="ai-chat-tokens-count">0</span>
            </div>

            <button class="ai-chat-settings-btn" id="ai-chat-settings-btn" title="设置">
                <i class="ri-settings-3-line"></i>
            </button>
            
            <div class="ai-chat-messages" id="ai-chat-messages">
                <div class="ai-chat-welcome">
                    <div class="ai-chat-welcome-title">你好！我是小艾米！ε٩(๑> ₃ <)۶з<br>有什么可以帮你的？</div>
                    <div class="ai-chat-quick-actions">
                        <button class="ai-chat-quick-btn" data-prompt="分析一下最近的日志">
                            <i class="ri-file-list-3-line"></i> 分析日志
                        </button>
                        <button class="ai-chat-quick-btn" data-prompt="这个页面怎么用？">
                            <i class="ri-question-line"></i> 当前页面帮助
                        </button>
                        <button class="ai-chat-quick-btn" data-prompt="语音包安装失败怎么办？">
                            <i class="ri-volume-up-line"></i> 语音包问题
                        </button>
                    </div>
                </div>
            </div>
            
            <div class="ai-chat-input-area">
                <div class="ai-chat-input-wrapper">
                    <textarea class="ai-chat-input" id="ai-chat-input"
                        placeholder="输入你的问题..." rows="1" maxlength="200"></textarea>
                    <button class="ai-chat-send" id="ai-chat-send" title="发送">
                        <i class="ri-arrow-up-line"></i>
                    </button>
                </div>
                <div class="ai-chat-toolbar">
                    <button class="ai-chat-tool-btn" id="ai-tool-logs" title="包含日志上下文">
                        <i class="ri-file-list-line"></i> 日志
                    </button>
                    <button class="ai-chat-tool-btn" id="ai-tool-page" title="包含页面上下文">
                        <i class="ri-pages-line"></i> 页面
                    </button>
                    <button class="ai-chat-tool-btn" id="ai-tool-clear" title="清空对话">
                        <i class="ri-delete-bin-line"></i> 清空
                    </button>
                </div>
            </div>
        `;
        document.body.appendChild(container);
        
        // 缓存元素引用
        this.elements = {
            overlay: overlay,
            container: container,
            messages: document.getElementById('ai-chat-messages'),
            input: document.getElementById('ai-chat-input'),
            sendBtn: document.getElementById('ai-chat-send'),
            settings: document.getElementById('ai-chat-settings'),
            toolLogs: document.getElementById('ai-tool-logs'),
            toolPage: document.getElementById('ai-tool-page'),
            toolClear: document.getElementById('ai-tool-clear'),
            settingsBtn: document.getElementById('ai-chat-settings-btn'),
            tokensCount: document.getElementById('ai-chat-tokens-count')
        };
        
        // 从配置恢复工具按钮状态
        const config = AI_CONFIG.get();
        if (config.features.logAnalysis) {
            this.elements.toolLogs.classList.add('active');
        }
        if (config.features.tutorialRecognition) {
            this.elements.toolPage.classList.add('active');
        }
    },
    
    // 绑定Logo点击事件
    _bindLogoClick() {
        const logo = document.querySelector('.app-logo');
        if (logo) {
            logo.style.cursor = 'pointer';
            logo.addEventListener('click', () => this.toggle());
            console.log('[AI] Logo点击事件已绑定');
        }
    },
    
    // 绑定事件
    _bindEvents() {
        // 遮罩层点击关闭
        this.elements.overlay.addEventListener('click', () => this.close());
        
        // 发送按钮
        this.elements.sendBtn.addEventListener('click', () => this._sendMessage());
        
        // 输入框回车发送
        this.elements.input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this._sendMessage();
            }
        });
        
        // 输入框自动调整高度
        this.elements.input.addEventListener('input', () => {
            this.elements.input.style.height = 'auto';
            this.elements.input.style.height = Math.min(120, this.elements.input.scrollHeight) + 'px';
        });

        // 粘贴时截断至200字
        this.elements.input.addEventListener('paste', (e) => {
            e.preventDefault();
            const pastedText = (e.clipboardData || window.clipboardData).getData('text');
            const currentText = this.elements.input.value;
            const selectionStart = this.elements.input.selectionStart;
            const selectionEnd = this.elements.input.selectionEnd;

            // 计算可用空间
            const availableSpace = 200 - currentText.length + (selectionEnd - selectionStart);

            // 截断粘贴内容
            const truncatedPaste = pastedText.substring(0, Math.max(0, availableSpace));

            // 插入截断后的内容
            const newText = currentText.substring(0, selectionStart) + truncatedPaste + currentText.substring(selectionEnd);
            this.elements.input.value = newText.substring(0, 200);

            // 调整高度
            this.elements.input.style.height = 'auto';
            this.elements.input.style.height = Math.min(120, this.elements.input.scrollHeight) + 'px';
        });
        
        // 快捷按钮
        this.elements.messages.addEventListener('click', (e) => {
            if (e.target.classList.contains('ai-chat-quick-btn')) {
                const prompt = e.target.dataset.prompt;
                if (prompt) {
                    this.elements.input.value = prompt;
                    this._sendMessage();
                }
            }
        });

        // 消息气泡点击复制
        this.elements.messages.addEventListener('click', (e) => {
            const bubble = e.target.closest('.ai-message-bubble');
            if (bubble) {
                this._copyBubbleContent(bubble);
            }
        });
        
        // 工具按钮
        this.elements.toolLogs.addEventListener('click', () => {
            this.elements.toolLogs.classList.toggle('active');
            AI_CONFIG.setNested('features.logAnalysis', this.elements.toolLogs.classList.contains('active'));
        });
        
        this.elements.toolPage.addEventListener('click', () => {
            this.elements.toolPage.classList.toggle('active');
            AI_CONFIG.setNested('features.tutorialRecognition', this.elements.toolPage.classList.contains('active'));
        });
        
        this.elements.settingsBtn.addEventListener('click', () => {
            this.state.settingsOpen = !this.state.settingsOpen;
            this.elements.settings.classList.toggle('show', this.state.settingsOpen);
            this.elements.container.classList.toggle('settings-open', this.state.settingsOpen);
        });
        
        this.elements.toolClear.addEventListener('click', () => {
            this._clearMessages();
        });
        
        // 设置面板事件（输入框）
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

    // 初始化tooltip位置调整，使用fixed定位避免被父容器截断
    _initTooltipPosition() {
        const settingsPanel = document.getElementById('ai-chat-settings');
        if (!settingsPanel) return;

        // 创建全局tooltip元素
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

                // 计算位置：显示在问号下方
                let left = helpRect.left;
                let top = helpRect.bottom + 8;

                // 检查右侧是否超出面板（预留10px边距）
                const tooltipWidth = tooltipEl.offsetWidth || 220;
                const rightEdge = left + tooltipWidth;
                const panelRightEdge = panelRect.right - 10;

                if (rightEdge > panelRightEdge) {
                    // 超出右侧，向左偏移
                    left = panelRightEdge - tooltipWidth;
                    // 更新箭头位置
                    tooltipEl.style.setProperty('--arrow-left', `${helpRect.left - left + 4}px`);
                } else {
                    tooltipEl.style.setProperty('--arrow-left', '8px');
                }

                tooltipEl.style.left = `${left}px`;
                tooltipEl.style.top = `${top}px`;

                // 更新箭头位置
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
        
        if (customSettings) {
            customSettings.style.display = mode === 'custom' ? 'block' : 'none';
        }
        
        // 显示/隐藏 Token 使用量（仅在 aimer_free 模式显示）
        if (tokenUsageItem) {
            tokenUsageItem.style.display = mode === 'aimer_free' ? 'block' : 'none';
            if (mode === 'aimer_free') {
                this._updateTokenDisplay();
            }
        }
        
        // 如果是自定义模式，初始化提供商UI
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
    
    // 根据提供商更新UI
    _updateProviderUI(provider) {
        // 更新模型选项
        const models = AIProviderManager.getProviderModels(provider);
        if (this.dropdowns.model) {
            if (models.length > 0) {
                // 在模型列表开头添加"自定义"选项
                const options = [
                    { value: 'custom', label: '自定义' },
                    ...models.map(m => ({ value: m.id, label: m.label }))
                ];
                this.dropdowns.model.setOptions(options);
            } else {
                // 代理模式或其他无模型列表的情况
                this.dropdowns.model.setOptions([{ value: 'default', label: '默认模型' }]);
            }
        }
        
        // 显示/隐藏SiliconFlow特有选项
        const isSiliconFlow = provider === 'siliconflow';
        document.getElementById('ai-setting-topP-item').style.display = isSiliconFlow ? 'block' : 'none';
        document.getElementById('ai-setting-topK-item').style.display = isSiliconFlow ? 'block' : 'none';
        document.getElementById('ai-setting-minP-item').style.display = isSiliconFlow ? 'block' : 'none';
        document.getElementById('ai-setting-frequency-penalty-item').style.display = isSiliconFlow ? 'block' : 'none';

        // 思考模式选项显示逻辑
        const isZhipu = provider === 'zhipu';
        if (isSiliconFlow && this.dropdowns.model) {
            this._updateSiliconFlowOptions(this.dropdowns.model.getValue());
        } else if (isZhipu) {
            // 智谱AI所有模型都支持思考模式
            document.getElementById('ai-setting-thinking-item').style.display = 'block';
            document.getElementById('ai-setting-thinking-budget-item').style.display = 'none';
        } else {
            document.getElementById('ai-setting-thinking-item').style.display = 'none';
            document.getElementById('ai-setting-thinking-budget-item').style.display = 'none';
        }
        
        // 加载当前配置值
        this._loadProviderConfig(provider);
    },
    
    // 测试API连接
    async _testApiConnection() {
        const testBtn = document.getElementById('ai-chat-test-api-btn');
        const testResult = document.getElementById('ai-chat-test-result');
        
        if (!testBtn || !testResult) return;
        
        // 获取当前配置
        const provider = AI_CONFIG.get('provider');
        const config = AI_CONFIG.getNested(`apiConfig.${provider}`) || {};
        
        if (!config.apiKey) {
            testResult.className = 'ai-chat-test-result show error';
            testResult.textContent = '请先填写 API Key';
            return;
        }
        
        // 设置测试状态
        testBtn.disabled = true;
        testBtn.classList.add('testing');
        testBtn.innerHTML = '<i class="ri-loader-4-line ri-spin"></i> 检测中...';
        testResult.className = 'ai-chat-test-result';
        
        try {
            // 获取完整配置（包含 baseUrl）
            const fullConfig = AI_CONFIG.getNested(`apiConfig.${provider}`) || {};
            const defaultConfig = AI_CONFIG.defaults.apiConfig[provider] || {};
            const mergedConfig = {
                ...defaultConfig,
                ...fullConfig
            };
            
            if (!mergedConfig.apiKey) {
                throw new Error('API Key 未配置');
            }
            
            // 获取提供商实例
            const providerInstance = AIProviderManager.getProvider(provider, mergedConfig);
            if (!providerInstance) {
                throw new Error('提供商未初始化');
            }
            
            // 构建测试消息
            const testMessages = [
                { role: 'user', content: '测试消息，请回复我"1"' }
            ];
            
            // 记录开始时间
            const startTime = Date.now();
            let firstByteTime = null;
            
            // 发送测试请求
            let responseContent = '';
            await providerInstance.chatStream(testMessages, (chunk) => {
                // 记录首包时间
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
            
            // 计算延迟（首包响应时间）
            const latency = firstByteTime ? firstByteTime - startTime : Date.now() - startTime;
            
            // 检查响应
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
            // 恢复按钮状态
            testBtn.disabled = false;
            testBtn.classList.remove('testing');
            testBtn.innerHTML = '<i class="ri-test-tube-line"></i> 检测API连接';
        }
    },
    
    // 更新SiliconFlow特定模型的选项
    _updateSiliconFlowOptions(model) {
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
        
        const supportsThinking = thinkingModels.some(m => model?.includes(m));
        document.getElementById('ai-setting-thinking-item').style.display = supportsThinking ? 'block' : 'none';
        document.getElementById('ai-setting-thinking-budget-item').style.display = supportsThinking ? 'block' : 'none';
    },
    
    // 加载提供商配置到UI
    _loadProviderConfig(provider) {
        const config = AI_CONFIG.getNested(`apiConfig.${provider}`) || {};

        // 加载API Key
        this._loadApiKeyToInput();

        // 加载通用配置
        const tempInput = document.getElementById('ai-setting-temperature');
        if (tempInput) tempInput.value = config.temperature ?? 0.7;

        const maxTokensInput = document.getElementById('ai-setting-maxTokens');
        if (maxTokensInput) maxTokensInput.value = config.maxTokens ?? 2048;

        // 加载模型选择
        if (this.dropdowns.model && config.model) {
            // 获取当前提供商的模型列表
            const models = AIProviderManager.getProviderModels(provider);
            const modelIds = models.map(m => m.id);
            
            // 如果当前模型不在预设列表中，说明是自定义模型
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
    },
    
    // 打开聊天框
    open() {
        // 检查免责声明
        if (typeof AIDisclaimer !== 'undefined' && !AIDisclaimer.state.hasAgreed) {
            AIDisclaimer.show();
            AIDisclaimer.onAgree(() => {
                this._doOpen();
            });
            AIDisclaimer.onReject(() => {
                // 拒绝则关闭AI聊天，不执行任何操作
                console.log('[AI] 用户拒绝免责声明，关闭AI功能');
            });
            return;
        }
        
        this._doOpen();
    },
    
    // 实际打开聊天框
    _doOpen() {
        this.state.isOpen = true;
        this.elements.container.classList.add('open');
        this.elements.overlay.classList.add('show');
        document.body.style.overflow = 'hidden';
        
        // 聚焦输入框
        setTimeout(() => this.elements.input.focus(), 300);
        
        // 滚动到底部
        this._scrollToBottom();
    },
    
    // 关闭聊天框
    close() {
        this.state.isOpen = false;
        this.elements.container.classList.remove('open');
        this.elements.overlay.classList.remove('show');
        document.body.style.overflow = '';
        
        // 关闭设置面板
        this.state.settingsOpen = false;
        this.elements.settings.classList.remove('show');
        this.elements.container.classList.remove('settings-open');
    },
    
    // 切换聊天框
    toggle() {
        if (this.state.isOpen) {
            this.close();
        } else {
            this.open();
        }
    },
    
    // 发送消息
    async _sendMessage() {
        const message = this.elements.input.value.trim();
        if (!message || this.state.isLoading) return;

        // 清空情绪标签缓存（新消息重新随机选择）
        this.state.emotionCache = {};

        // 获取上下文标识状态
        const contextFlags = {
            includeLogs: this.elements.toolLogs.classList.contains('active'),
            includePage: this.elements.toolPage.classList.contains('active')
        };

        // 清空输入框
        this.elements.input.value = '';
        this.elements.input.style.height = 'auto';

        // 添加用户消息（带上下文标识）
        this._addMessage('user', message, contextFlags);

        // 估算用户消息的token数
        const userTokens = this._estimateTokens(message);

        // 显示加载状态
        this._showLoading();
        
        try {
            // 构建消息历史
            const history = this.state.messages.map(m => ({
                role: m.type === 'ai' ? 'assistant' : m.type,
                content: m.content
            }));
            
            // 构建选项
            const options = {
                includeLogs: this.elements.toolLogs.classList.contains('active'),
                includeTutorial: this.elements.toolPage.classList.contains('active')
            };
            
            // 获取提供商
            const provider = AIProviderManager.getCurrentProvider();
            if (!provider) {
                throw new Error('AI提供商未配置');
            }
            
            // 验证配置
            const validation = provider.validateConfig();
            if (!validation.valid) {
                throw new Error(validation.error);
            }
            
            // 构建完整消息
            const messages = AIContextManager.buildMessages(message, history, options);
            
            // 流式响应
            let responseContent = '';
            await provider.chatStream(messages, (chunk) => {
                if (chunk.error) {
                    throw new Error(chunk.error);
                }
                if (chunk.done) {
                    return;
                }
                if (chunk.content) {
                    responseContent += chunk.content;
                    this._updateStreamingMessage(responseContent);
                }
            });
            
            // 完成响应
            this._finalizeMessage(responseContent);

            // 估算AI回复的token数并更新统计
            const aiTokens = this._estimateTokens(responseContent);
            this._updateTokens(userTokens, aiTokens);

        } catch (error) {
            console.error('[AI] 请求失败:', error);
            this._hideLoading();
            this.state.isLoading = false;
            // 延迟0.3秒后显示错误消息
            setTimeout(() => {
                this._addMessage('ai', `抱歉，请求失败：${error.message}`);
            }, 300);
        }
    },
    
    // 添加消息到界面
    _addMessage(type, content, contextFlags = {}) {
        const isFirstMessage = this.state.messages.length === 0;

        // 如果是第一条消息，先隐藏欢迎区域
        if (isFirstMessage) {
            const welcomeEl = this.elements.messages.querySelector('.ai-chat-welcome');
            if (welcomeEl) {
                welcomeEl.style.display = 'none';
            }
        }

        // 获取现有消息的高度，用于动画
        const existingMessages = this.elements.messages.querySelectorAll('.ai-message');
        const messageHeight = existingMessages.length > 0 ? existingMessages[0].offsetHeight + 10 : 0;

        // 给现有消息添加向上移动的动画
        existingMessages.forEach(msg => {
            msg.style.transform = `translateY(-${messageHeight}px)`;
        });

        const messageEl = document.createElement('div');
        messageEl.className = `ai-message ${type}`;
        messageEl.style.opacity = '0';
        messageEl.style.transform = 'translateY(20px)';

        // 构建上下文标识图标（仅用户消息显示）
        let contextIcons = '';
        if (type === 'user' && (contextFlags.includeLogs || contextFlags.includePage)) {
            const icons = [];
            if (contextFlags.includeLogs) icons.push('<i class="ri-file-list-line" title="包含日志"></i>');
            if (contextFlags.includePage) icons.push('<i class="ri-pages-line" title="包含页面"></i>');
            contextIcons = `<div class="ai-message-context-icons">${icons.join('')}</div>`;
        }

        messageEl.innerHTML = `
            <div class="ai-message-content">
                <div class="ai-message-bubble">${this._formatMessage(content)}${contextIcons}</div>
            </div>
        `;

        this.elements.messages.appendChild(messageEl);

        // 触发动画
        requestAnimationFrame(() => {
            // 新消息淡入并上移
            messageEl.style.transition = 'all 0.3s ease';
            messageEl.style.opacity = '1';
            messageEl.style.transform = 'translateY(0)';

            // 现有消息复位
            existingMessages.forEach(msg => {
                msg.style.transition = 'transform 0.3s ease';
                msg.style.transform = 'translateY(0)';
            });

            // 滚动到底部
            this._scrollToBottom();
        });

        // 保存到状态
        this.state.messages.push({ type, content, contextFlags });
    },
    
    // 更新流式消息
    _updateStreamingMessage(content) {
        // 移除加载动画
        this._hideLoading();
        
        // 查找或创建AI消息元素
        let messageEl = this.elements.messages.querySelector('.ai-message.ai:last-child');
        if (!messageEl || messageEl.dataset.finalized === 'true') {
            messageEl = document.createElement('div');
            messageEl.className = 'ai-message ai';
            messageEl.innerHTML = `
                <div class="ai-message-content">
                    <div class="ai-message-bubble"></div>
                </div>
            `;
            this.elements.messages.appendChild(messageEl);
        }
        
        // 更新内容
        const bubble = messageEl.querySelector('.ai-message-bubble');
        bubble.innerHTML = this._formatMessage(content);
        
        // 使用 requestAnimationFrame 确保 DOM 渲染后再滚动
        requestAnimationFrame(() => {
            this._scrollToBottom();
        });
    },
    
    // 完成消息
    _finalizeMessage(content) {
        const messageEl = this.elements.messages.querySelector('.ai-message.ai:last-child');
        if (messageEl) {
            messageEl.dataset.finalized = 'true';
            const bubble = messageEl.querySelector('.ai-message-bubble');
            bubble.innerHTML = this._formatMessage(content);
        }
        
        // 更新状态中的最后一条消息
        const lastMsg = this.state.messages[this.state.messages.length - 1];
        if (lastMsg && lastMsg.type === 'ai') {
            lastMsg.content = content;
        } else {
            this.state.messages.push({
                type: 'ai',
                content: content
            });
        }
        
        this.state.isLoading = false;
    },
    
    // 显示加载动画
    _showLoading() {
        this.state.isLoading = true;
        const loadingEl = document.createElement('div');
        loadingEl.className = 'ai-message ai ai-message-loading-container';
        loadingEl.innerHTML = `
            <div class="ai-message-content">
                <div class="ai-message-loading">
                    <span></span>
                    <span></span>
                    <span></span>
                </div>
            </div>
        `;
        this.elements.messages.appendChild(loadingEl);
        
        // 使用 requestAnimationFrame 确保 DOM 渲染后再滚动
        requestAnimationFrame(() => {
            this._scrollToBottom();
        });
    },
    
    // 隐藏加载动画
    _hideLoading() {
        const loadingEl = this.elements.messages.querySelector('.ai-message-loading-container');
        if (loadingEl) {
            loadingEl.remove();
        }
        this.state.isLoading = false;
    },
    
    // 清空消息
    _clearMessages() {
        // 获取所有消息元素
        const messages = this.elements.messages.querySelectorAll('.ai-message');
        
        // 所有消息快速渐隐
        messages.forEach((msg, index) => {
            msg.style.transition = 'opacity 0.2s ease, transform 0.2s ease';
            msg.style.opacity = '0';
            msg.style.transform = 'translateY(-10px)';
        });
        
        // 欢迎区域也渐隐
        const welcomeEl = this.elements.messages.querySelector('.ai-chat-welcome');
        if (welcomeEl) {
            welcomeEl.style.transition = 'opacity 0.2s ease';
            welcomeEl.style.opacity = '0';
        }
        
        // 200ms 后清空并显示新内容
        setTimeout(() => {
            this.state.messages = [];
            this.elements.messages.innerHTML = `
                <div class="ai-chat-welcome" style="opacity: 0; transform: translateY(10px);">
                    <div class="ai-chat-welcome-title">对话已清空</div>
                    <div class="ai-chat-quick-actions">
                        <button class="ai-chat-quick-btn" data-prompt="分析一下最近的日志">
                            <i class="ri-file-list-3-line"></i> 分析日志
                        </button>
                        <button class="ai-chat-quick-btn" data-prompt="这个页面怎么用？">
                            <i class="ri-question-line"></i> 当前页面帮助
                        </button>
                        <button class="ai-chat-quick-btn" data-prompt="语音包安装失败怎么办？">
                            <i class="ri-volume-up-line"></i> 语音包问题
                        </button>
                    </div>
                </div>
            `;
            
            // 渐显新内容
            requestAnimationFrame(() => {
                const newWelcomeEl = this.elements.messages.querySelector('.ai-chat-welcome');
                if (newWelcomeEl) {
                    newWelcomeEl.style.transition = 'opacity 0.25s ease, transform 0.25s ease';
                    newWelcomeEl.style.opacity = '1';
                    newWelcomeEl.style.transform = 'translateY(0)';
                }
            });
            
            // 2秒后恢复原标题
            setTimeout(() => {
                const titleEl = this.elements.messages.querySelector('.ai-chat-welcome-title');
                if (titleEl && titleEl.textContent === '对话已清空') {
                    titleEl.style.transition = 'opacity 0.2s ease';
                    titleEl.style.opacity = '0';
                    setTimeout(() => {
                        titleEl.innerHTML = '你好！我是小艾米！<br>有什么可以帮你的？';
                        titleEl.style.opacity = '1';
                    }, 200);
                }
            }, 2000);

            // 重置token统计
            this._resetTokens();
        }, 200);
    },

    // 估算文本的token数（简化算法：中文约1字=1token，英文约4字符=1token）
    _estimateTokens(text) {
        if (!text) return 0;
        // 中文字符数
        const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
        // 非中文字符数
        const otherChars = text.length - chineseChars;
        // 估算：中文1字≈1token，英文4字符≈1token
        return Math.ceil(chineseChars + otherChars / 4);
    },

    // 更新token统计
    _updateTokens(promptTokens, completionTokens) {
        this.state.tokens.prompt += promptTokens;
        this.state.tokens.completion += completionTokens;
        this.state.tokens.total = this.state.tokens.prompt + this.state.tokens.completion;
        this._renderTokens();
        
        // 同步到全局 Token 统计（仅在 aimer_free 模式）
        if (AI_CONFIG.get('apiMode') === 'aimer_free' && typeof TokenTracker !== 'undefined') {
            TokenTracker.addUsage(promptTokens, completionTokens);
        }
    },

    // 重置token统计
    _resetTokens() {
        this.state.tokens = { prompt: 0, completion: 0, total: 0 };
        this._renderTokens();
    },

    // 渲染token显示
    _renderTokens() {
        if (this.elements.tokensCount) {
            this.elements.tokensCount.textContent = this.state.tokens.total.toLocaleString();
        }
    },

    // 计算当前对话的预估token数
    _calculateConversationTokens() {
        let total = 0;
        for (const msg of this.state.messages) {
            total += this._estimateTokens(msg.content);
        }
        return total;
    },
    
    // 滚动到底部
    _scrollToBottom() {
        this.elements.messages.scrollTop = this.elements.messages.scrollHeight;
    },
    
    // 转义HTML
    _escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    },

    // 复制气泡内容
    async _copyBubbleContent(bubble) {
        try {
            // 获取纯文本内容（去除HTML标签）
            const text = bubble.textContent || bubble.innerText || '';
            await navigator.clipboard.writeText(text.trim());

            // 添加复制成功视觉反馈
            bubble.classList.add('copied');
            setTimeout(() => {
                bubble.classList.remove('copied');
            }, 1000);
        } catch (err) {
            console.error('[AI] 复制失败:', err);
        }
    },
    
    // 格式化消息（支持简单的Markdown）
    _formatMessage(text) {
        // 转换情绪标签 §1-§7 为颜表情（必须在HTML转义之前）
        if (typeof AIVocabularyMappings !== 'undefined') {
            text = this._convertEmotionTagsWithCache(text);
        }

        // 先转义HTML特殊字符，防止XSS
        text = this._escapeHtml(text);

        // Markdown链接 [描述](URL) → 可点击链接
        text = text.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');

        // 纯URL自动转换（兜底处理）
        text = text.replace(/(https?:\/\/[^\s<]+)(?![^<]*>|[^<>]*<\/a)/g, '<a href="$1" target="_blank" rel="noopener noreferrer">🔗 链接</a>');

        // 代码块
        text = text.replace(/```(\w+)?\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>');

        // 行内代码
        text = text.replace(/`([^`]+)`/g, '<code>$1</code>');

        // 粗体
        text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

        // 斜体
        text = text.replace(/\*([^*]+)\*/g, '<em>$1</em>');

        // 换行
        text = text.replace(/\n/g, '<br>');

        return text;
    },

    // 带缓存的情绪标签转换（流式输出时固定表情选择）
    _convertEmotionTagsWithCache(text) {
        if (!text || typeof text !== 'string') return text;

        const emotionPattern = /§[1-7]/g;
        return text.replace(emotionPattern, (tag) => {
            // 如果缓存中有该标签，使用缓存的表情
            if (this.state.emotionCache[tag]) {
                return this.state.emotionCache[tag];
            }

            // 否则随机选择并缓存
            const mapping = AIVocabularyMappings.EMOTION_MAPPINGS[tag];
            if (mapping && mapping.faces) {
                const randomFace = mapping.faces[Math.floor(Math.random() * mapping.faces.length)];
                this.state.emotionCache[tag] = randomFace;
                return randomFace;
            }

            return tag;
        });
    }
};

window.AIChat = AIChat;
