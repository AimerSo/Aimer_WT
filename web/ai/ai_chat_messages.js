/**
 * AI聊天消息管理模块
 *
 * 功能定位:
 * - 管理聊天消息的添加、更新、删除
 * - 流式消息渲染和最终化
 * - 消息格式化（Markdown、情绪标签）
 * - 加载动画管理
 * - Token 统计渲染
 *
 * 业务关联:
 * - 上游: AIChat 消息发送时调用
 * - 下游: AI_CONFIG、AIContextManager、TokenTracker
 */

const AIChatMessages = {
    // AIChat 实例引用（用于访问 elements 和 state）
    _chat: null,

    /**
     * 初始化消息模块
     * @param {Object} chat - AIChat 实例引用
     */
    init(chat) {
        this._chat = chat;
    },

    // 添加消息到界面
    addMessage(type, content, contextFlags = {}) {
        const chat = this._chat;
        const isFirstMessage = chat.state.messages.length === 0;

        if (isFirstMessage) {
            const welcomeEl = chat.elements.messages.querySelector('.ai-chat-welcome');
            if (welcomeEl) {
                welcomeEl.style.display = 'none';
            }
        }

        const existingMessages = chat.elements.messages.querySelectorAll('.ai-message');
        const messageHeight = existingMessages.length > 0 ? existingMessages[0].offsetHeight + 10 : 0;

        existingMessages.forEach(msg => {
            msg.style.transform = `translateY(-${messageHeight}px)`;
        });

        const messageEl = document.createElement('div');
        messageEl.className = `ai-message ${type}`;
        messageEl.style.opacity = '0';
        messageEl.style.transform = 'translateY(20px)';

        let contextIcons = '';
        if (type === 'user' && (contextFlags.includeLogs || contextFlags.includePage)) {
            const icons = [];
            if (contextFlags.includeLogs) icons.push('<i class="ri-file-list-line" title="包含日志"></i>');
            if (contextFlags.includePage) icons.push('<i class="ri-pages-line" title="包含页面"></i>');
            contextIcons = `<div class="ai-message-context-icons">${icons.join('')}</div>`;
        }

        messageEl.innerHTML = `
            <div class="ai-message-content">
                <div class="ai-message-bubble">${this.formatMessage(content)}${contextIcons}</div>
            </div>
        `;

        chat.elements.messages.appendChild(messageEl);

        requestAnimationFrame(() => {
            messageEl.style.transition = 'all 0.3s ease';
            messageEl.style.opacity = '1';
            messageEl.style.transform = 'translateY(0)';

            existingMessages.forEach(msg => {
                msg.style.transition = 'transform 0.3s ease';
                msg.style.transform = 'translateY(0)';
            });

            this.scrollToBottom();
        });

        chat.state.messages.push({ type, content, contextFlags });
    },

    // 更新流式消息
    updateStreamingMessage(content) {
        const chat = this._chat;
        this.hideLoading();

        let messageEl = chat.elements.messages.querySelector('.ai-message.ai:last-child');
        if (!messageEl || messageEl.dataset.finalized === 'true') {
            messageEl = document.createElement('div');
            messageEl.className = 'ai-message ai';
            messageEl.innerHTML = `
                <div class="ai-message-content">
                    <div class="ai-message-bubble"></div>
                </div>
            `;
            chat.elements.messages.appendChild(messageEl);
        }

        const bubble = messageEl.querySelector('.ai-message-bubble');
        bubble.innerHTML = this.formatMessage(content);

        requestAnimationFrame(() => {
            this.scrollToBottom();
        });
    },

    // 完成消息
    finalizeMessage(content) {
        const chat = this._chat;
        const messageEl = chat.elements.messages.querySelector('.ai-message.ai:last-child');
        if (messageEl) {
            messageEl.dataset.finalized = 'true';
            const bubble = messageEl.querySelector('.ai-message-bubble');
            bubble.innerHTML = this.formatMessage(content);
        }

        const lastMsg = chat.state.messages[chat.state.messages.length - 1];
        if (lastMsg && lastMsg.type === 'ai') {
            lastMsg.content = content;
        } else {
            chat.state.messages.push({
                type: 'ai',
                content: content
            });
        }

        chat.state.isLoading = false;
    },

    // 显示加载动画
    showLoading() {
        const chat = this._chat;
        chat.state.isLoading = true;
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
        chat.elements.messages.appendChild(loadingEl);

        requestAnimationFrame(() => {
            this.scrollToBottom();
        });
    },

    // 隐藏加载动画
    hideLoading() {
        const chat = this._chat;
        const loadingEl = chat.elements.messages.querySelector('.ai-message-loading-container');
        if (loadingEl) {
            loadingEl.remove();
        }
        chat.state.isLoading = false;
    },

    // 清空消息
    clearMessages() {
        const chat = this._chat;
        const messages = chat.elements.messages.querySelectorAll('.ai-message');

        messages.forEach((msg, index) => {
            msg.style.transition = 'opacity 0.2s ease, transform 0.2s ease';
            msg.style.opacity = '0';
            msg.style.transform = 'translateY(-10px)';
        });

        const welcomeEl = chat.elements.messages.querySelector('.ai-chat-welcome');
        if (welcomeEl) {
            welcomeEl.style.transition = 'opacity 0.2s ease';
            welcomeEl.style.opacity = '0';
        }

        setTimeout(() => {
            chat.state.messages = [];
            chat.elements.messages.innerHTML = `
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

            requestAnimationFrame(() => {
                const newWelcomeEl = chat.elements.messages.querySelector('.ai-chat-welcome');
                if (newWelcomeEl) {
                    newWelcomeEl.style.transition = 'opacity 0.25s ease, transform 0.25s ease';
                    newWelcomeEl.style.opacity = '1';
                    newWelcomeEl.style.transform = 'translateY(0)';
                }
            });

            setTimeout(() => {
                const titleEl = chat.elements.messages.querySelector('.ai-chat-welcome-title');
                if (titleEl && titleEl.textContent === '对话已清空') {
                    titleEl.style.transition = 'opacity 0.2s ease';
                    titleEl.style.opacity = '0';
                    setTimeout(() => {
                        titleEl.innerHTML = '你好！我是小艾米！<br>有什么可以帮你的？';
                        titleEl.style.opacity = '1';
                    }, 200);
                }
            }, 2000);

            this.resetTokens();
        }, 200);
    },

    // 格式化消息（支持Markdown）
    formatMessage(text) {
        // 情绪标签转换（HTML转义之前）
        if (typeof AIVocabularyMappings !== 'undefined') {
            text = this._convertEmotionTagsWithCache(text);
        }

        text = this.escapeHtml(text);

        // Markdown链接
        text = text.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');

        // 纯URL自动转换
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
        const chat = this._chat;

        const emotionPattern = /§[1-7]/g;
        return text.replace(emotionPattern, (tag) => {
            if (chat.state.emotionCache[tag]) {
                return chat.state.emotionCache[tag];
            }

            const mapping = AIVocabularyMappings.EMOTION_MAPPINGS[tag];
            if (mapping && mapping.faces) {
                const randomFace = mapping.faces[Math.floor(Math.random() * mapping.faces.length)];
                chat.state.emotionCache[tag] = randomFace;
                return randomFace;
            }

            return tag;
        });
    },

    // 复制气泡内容
    async copyBubbleContent(bubble) {
        try {
            const text = bubble.textContent || bubble.innerText || '';
            await navigator.clipboard.writeText(text.trim());

            bubble.classList.add('copied');
            setTimeout(() => {
                bubble.classList.remove('copied');
            }, 1000);
        } catch (err) {
            console.error('[AI] 复制失败:', err);
        }
    },

    // 转义HTML
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    },

    // 滚动到底部
    scrollToBottom() {
        this._chat.elements.messages.scrollTop = this._chat.elements.messages.scrollHeight;
    },

    // 估算Token数（统一使用 AIContextManager 的算法）
    estimateTokens(text) {
        if (typeof AIContextManager !== 'undefined') {
            return AIContextManager.estimateTokens(text);
        }
        // 降级方案：简单估算
        if (!text) return 0;
        const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
        const otherChars = text.length - chineseChars;
        return Math.ceil(chineseChars + otherChars / 4);
    },

    // 更新token统计
    updateTokens(promptTokens, completionTokens) {
        const chat = this._chat;
        chat.state.tokens.prompt += promptTokens;
        chat.state.tokens.completion += completionTokens;
        chat.state.tokens.total = chat.state.tokens.prompt + chat.state.tokens.completion;
        this.renderTokens();

        if (AI_CONFIG.get('apiMode') === 'aimer_free' && typeof TokenTracker !== 'undefined') {
            TokenTracker.addUsage(promptTokens, completionTokens);
        }
    },

    // 重置token统计
    resetTokens() {
        const chat = this._chat;
        chat.state.tokens = { prompt: 0, completion: 0, total: 0 };
        this.renderTokens();
    },

    // 渲染token显示
    renderTokens() {
        if (this._chat.elements.tokensCount) {
            this._chat.elements.tokensCount.textContent = this._chat.state.tokens.total.toLocaleString();
        }
    }
};

window.AIChatMessages = AIChatMessages;
