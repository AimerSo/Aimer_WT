/**
 * AI上下文管理器
 *
 * 功能定位:
 * - 整合所有上下文信息（日志、教程、用户状态等）
 * - 为AI请求构建完整的上下文提示词
 * - 基于Token数的上下文滑动窗口管理
 *
 * 业务关联:
 * - 上游: 日志收集器、教程检测器
 * - 下游: AI核心模块
 */

const AIContextManager = {
    // 配置
    config: {
        maxContextTokens: 30000,  // 最大上下文Token数（2.8-3万）
        warningThreshold: 28000,  // 警告阈值
        approxTokensPerChar: 0.6  // 中文约0.6 token/字
    },

    // 初始化
    init() {
        LogCollector.init();
        console.log('[AI] 上下文管理器已初始化');
    },

    /**
     * 估算文本的Token数
     * 简单估算：中文字符 ≈ 0.6 token，英文 ≈ 0.3 token
     * @param {string} text - 要估算的文本
     * @returns {number} - 估算的token数
     */
    estimateTokens(text) {
        if (!text || typeof text !== 'string') return 0;

        let tokens = 0;
        for (const char of text) {
            // 中文字符范围
            if (/[\u4e00-\u9fa5]/.test(char)) {
                tokens += 0.6;
            } else if (/[a-zA-Z]/.test(char)) {
                tokens += 0.3;
            } else if (/\d/.test(char)) {
                tokens += 0.25;
            } else {
                tokens += 0.2;  // 标点符号等
            }
        }
        return Math.ceil(tokens);
    },

    /**
     * 计算消息数组的总Token数
     * @param {Array} messages - 消息数组
     * @returns {number} - 总token数
     */
    calculateTotalTokens(messages) {
        if (!Array.isArray(messages)) return 0;

        let total = 0;
        for (const msg of messages) {
            if (msg.content) {
                total += this.estimateTokens(msg.content);
            }
            // 每条消息的基础开销（role字段等）
            total += 4;
        }
        return total;
    },

    /**
     * 基于Token数裁剪历史消息
     * 保留最近的消息，直到达到token限制
     * @param {Array} messages - 完整消息数组
     * @param {number} maxTokens - 最大token数
     * @returns {Array} - 裁剪后的消息数组
     */
    trimMessagesByTokens(messages, maxTokens = null) {
        if (!Array.isArray(messages) || messages.length === 0) return messages;

        const limit = maxTokens || this.config.maxContextTokens;
        let totalTokens = this.calculateTotalTokens(messages);

        // 如果总token数未超限，直接返回
        if (totalTokens <= limit) {
            return messages;
        }

        console.log(`[AIContextManager] 上下文Token数(${totalTokens})超过限制(${limit})，开始裁剪`);

        // 保留系统提示词（第一条）
        const systemMessage = messages[0]?.role === 'system' ? messages[0] : null;
        let historyMessages = systemMessage ? messages.slice(1) : messages;

        // 从最早的消息开始删除，直到token数符合限制
        while (historyMessages.length > 0) {
            const currentTokens = this.calculateTotalTokens(
                systemMessage ? [systemMessage, ...historyMessages] : historyMessages
            );

            if (currentTokens <= limit) {
                break;
            }

            // 删除最早的一条历史消息
            historyMessages.shift();
        }

        const result = systemMessage ? [systemMessage, ...historyMessages] : historyMessages;
        const finalTokens = this.calculateTotalTokens(result);
        console.log(`[AIContextManager] 裁剪完成，剩余消息数: ${result.length}, Token数: ${finalTokens}`);

        return result;
    },
    
    // 构建系统提示词
    buildSystemPrompt(options = {}) {
        const sceneKeys = [];

        // 根据场景添加对应的提示词
        if (options.logAnalysis) {
            sceneKeys.push('logAnalysis');
        }
        if (options.tutorialMode) {
            sceneKeys.push('tutorial');
        }

        // 使用新的SYSTEM_PROMPTS构建提示词
        let prompt = SYSTEM_PROMPTS.build(sceneKeys);

        // 添加当前页面上下文
        if (options.includeTutorial !== false) {
            const tutorialContext = TutorialDetector.getContextForAI();
            if (tutorialContext) {
                prompt += '\n\n=== 当前页面信息 ===\n' + tutorialContext;
            }
        }

        // 添加日志上下文
        if (options.includeLogs !== false && AI_CONFIG.getNested('context.includeLogs')) {
            const logLines = AI_CONFIG.getNested('context.logContextLines') || 30;
            const logs = LogCollector.getFormattedLogs(logLines);
            if (logs && logs !== '暂无日志记录。') {
                prompt += `\n\n=== 最近软件日志（最近${logLines}条）===\n` + logs;
                prompt += '\n你可以根据这些日志分析用户遇到的问题。';
            }
        }

        return prompt;
    },
    
    // 构建用户消息上下文
    buildUserContext(userMessage, options = {}) {
        const context = {
            message: userMessage,
            timestamp: new Date().toISOString(),
            pageContext: null,
            recentIssues: null
        };
        
        // 检测用户是否在询问当前页面
        const pageKeywords = ['这个页面', '当前页面', '这里', '这个功能', '怎么用'];
        const isAskingAboutPage = pageKeywords.some(kw => userMessage.includes(kw));
        
        if (isAskingAboutPage) {
            context.pageContext = TutorialDetector.getContextForAI();
        }
        
        // 检测用户是否在询问错误/问题
        const issueKeywords = ['错误', '失败', '问题', '报错', '怎么回事', '为什么'];
        const isAskingAboutIssues = issueKeywords.some(kw => userMessage.includes(kw));
        
        if (isAskingAboutIssues) {
            context.recentIssues = LogCollector.analyzeIssues();
        }
        
        return context;
    },
    
    // 构建完整的消息数组
    buildMessages(userMessage, chatHistory = [], options = {}) {
        const messages = [];

        // 系统提示词
        const systemPrompt = this.buildSystemPrompt(options);
        messages.push({ role: 'system', content: systemPrompt });

        // 历史消息 - 先按条数限制（15条），再按token限制
        const maxHistoryCount = AI_CONFIG.getNested('context.maxHistory') || 15;
        let recentHistory = chatHistory.slice(-maxHistoryCount);
        messages.push(...recentHistory);

        // 用户当前消息
        const userContext = this.buildUserContext(userMessage, options);
        let finalMessage = userMessage;

        // 如果有额外的上下文信息，添加到消息中
        if (userContext.pageContext && !userMessage.includes('当前页面')) {
            finalMessage += '\n\n[系统提示：用户当前页面信息]\n' + userContext.pageContext;
        }

        if (userContext.recentIssues && userContext.recentIssues.patterns.length > 0) {
            finalMessage += '\n\n[系统提示：最近日志分析]\n' +
                userContext.recentIssues.patterns.join('\n');
        }

        messages.push({ role: 'user', content: finalMessage });

        // 基于Token数裁剪上下文
        const trimmedMessages = this.trimMessagesByTokens(messages, this.config.maxContextTokens);

        return trimmedMessages;
    },
    
    // 快速分析当前状态（用于显示给用户）
    getQuickAnalysis() {
        const analysis = {
            currentPage: null,
            recentIssues: null,
            suggestions: []
        };
        
        // 当前页面
        const tutorial = TutorialDetector.getCurrentPageTutorial();
        if (tutorial) {
            analysis.currentPage = {
                title: tutorial.title,
                features: tutorial.features.slice(0, 3)
            };
        }
        
        // 最近问题
        const issues = LogCollector.analyzeIssues();
        if (issues.errors.length > 0 || issues.warnings.length > 0) {
            analysis.recentIssues = {
                errorCount: issues.errors.length,
                warningCount: issues.warnings.length,
                lastError: issues.errors[issues.errors.length - 1]?.message || null
            };
        }
        
        // 生成建议
        if (issues.errors.length > 0) {
            analysis.suggestions.push('检测到最近的错误，我可以帮你分析日志');
        }
        
        if (tutorial && tutorial.tips.length > 0) {
            analysis.suggestions.push(`在${tutorial.title}页面，我可以解释各功能用法`);
        }
        
        return analysis;
    },
    
    // 获取日志摘要（用于显示）
    getLogSummary() {
        const stats = LogCollector.getStats();
        const issues = LogCollector.analyzeIssues();
        
        return {
            total: stats.total,
            errors: issues.errors.length,
            warnings: issues.warnings.length,
            recentActivity: stats.byType
        };
    }
};

window.AIContextManager = AIContextManager;
