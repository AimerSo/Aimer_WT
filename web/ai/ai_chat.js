/**
 * AI聊天框核心模块
 * 
 * 功能定位:
 * - 管理聊天框的DOM创建和生命周期
 * - 编排消息发送流程
 * - 绑定核心交互事件
 * - 协调 AIChatSettings 和 AIChatMessages 子模块
 * 
 * 业务关联:
 * - 上游: 用户点击Logo触发
 * - 下游: AIChatSettings（设置面板）、AIChatMessages（消息管理）、AI提供商、上下文管理器
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
        emotionCache: {}
    },
    
    // 初始化
    init() {
        this._createDOM();

        // 初始化子模块
        AIChatSettings.init(this);
        AIChatMessages.init(this);

        this._bindEvents();
        this._bindLogoClick();
        
        // 初始化AI核心模块
        AIProviderManager.init();
        AIContextManager.init();
        
        // 初始化 Token 追踪
        if (typeof TokenTracker !== 'undefined') {
            TokenTracker.init();
            window.addEventListener('ai-token-update', () => {
                if (AI_CONFIG.get('apiMode') === 'aimer_free') {
                    AIChatSettings._updateTokenDisplay();
                }
            });
        }
        
        console.log('[AI] 聊天模块已初始化');
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
    
    // 绑定核心交互事件
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

            const availableSpace = 200 - currentText.length + (selectionEnd - selectionStart);
            const truncatedPaste = pastedText.substring(0, Math.max(0, availableSpace));

            const newText = currentText.substring(0, selectionStart) + truncatedPaste + currentText.substring(selectionEnd);
            this.elements.input.value = newText.substring(0, 200);

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
                AIChatMessages.copyBubbleContent(bubble);
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
            AIChatMessages.clearMessages();
        });
    },
    
    // 打开聊天框
    open() {
        if (typeof AIDisclaimer !== 'undefined' && !AIDisclaimer.state.hasAgreed) {
            AIDisclaimer.show();
            AIDisclaimer.onAgree(() => {
                this._doOpen();
            });
            AIDisclaimer.onReject(() => {
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
        
        setTimeout(() => this.elements.input.focus(), 300);
        AIChatMessages.scrollToBottom();
    },
    
    // 关闭聊天框
    close() {
        this.state.isOpen = false;
        this.elements.container.classList.remove('open');
        this.elements.overlay.classList.remove('show');
        document.body.style.overflow = '';
        
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

        // 清空情绪标签缓存
        this.state.emotionCache = {};

        const contextFlags = {
            includeLogs: this.elements.toolLogs.classList.contains('active'),
            includePage: this.elements.toolPage.classList.contains('active')
        };

        this.elements.input.value = '';
        this.elements.input.style.height = 'auto';

        AIChatMessages.addMessage('user', message, contextFlags);

        const userTokens = AIChatMessages.estimateTokens(message);

        AIChatMessages.showLoading();
        
        try {
            const history = this.state.messages.map(m => ({
                role: m.type === 'ai' ? 'assistant' : m.type,
                content: m.content
            }));
            
            const options = {
                includeLogs: this.elements.toolLogs.classList.contains('active'),
                includeTutorial: this.elements.toolPage.classList.contains('active')
            };
            
            const provider = AIProviderManager.getCurrentProvider();
            if (!provider) {
                throw new Error('AI提供商未配置');
            }
            
            const validation = provider.validateConfig();
            if (!validation.valid) {
                throw new Error(validation.error);
            }

            let messages;
            const streamOptions = {};

            if (provider.name === 'proxy') {
                // proxy 模式：后端管理 system prompt，客户端只发对话消息和上下文
                messages = [...history, { role: 'user', content: message }];
                const context = {};
                if (options.includeTutorial) {
                    const pageCtx = typeof TutorialDetector !== 'undefined' ? TutorialDetector.getContextForAI() : '';
                    if (pageCtx) context.page = pageCtx;
                }
                if (options.includeLogs) {
                    const logLines = AI_CONFIG.getNested('context.logContextLines') || 30;
                    const logs = typeof LogCollector !== 'undefined' ? LogCollector.getFormattedLogs(logLines) : '';
                    if (logs && logs !== '暂无日志记录。') context.logs = logs;
                }
                streamOptions.context = context;
            } else {
                // 其他提供商：客户端构建完整消息（含本地 system prompt）
                messages = AIContextManager.buildMessages(message, history, options);
            }
            
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
                    AIChatMessages.updateStreamingMessage(responseContent);
                }
            }, streamOptions);
            
            AIChatMessages.finalizeMessage(responseContent);

            const aiTokens = AIChatMessages.estimateTokens(responseContent);
            AIChatMessages.updateTokens(userTokens, aiTokens);

        } catch (error) {
            console.error('[AI] 请求失败:', error);
            AIChatMessages.hideLoading();
            this.state.isLoading = false;
            setTimeout(() => {
                AIChatMessages.addMessage('ai', `抱歉，请求失败：${error.message}`);
            }, 300);
        }
    }
};

window.AIChat = AIChat;
