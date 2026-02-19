/**
 * AI助手配置模块
 * 
 * 功能定位:
 * - 管理AI助手的全局配置，包括API设置、用户偏好、功能开关等
 * - 支持自定义API配置和后端转发模式切换
 * 
 * 业务关联:
 * - 上游: 用户设置页面、AI聊天界面
 * - 下游: API提供商模块、用量限制模块
 */

const AI_CONFIG = {
    // 版本号
    VERSION: '1.0.0',
    
    // 默认配置
    defaults: {
        // API模式: 'aimer_free'(Aimer免费提供) | 'direct'(直连) | 'proxy'(后端转发)
        apiMode: 'aimer_free',
        
        // 当前使用的提供商
        // 注意：OpenAI和Claude暂时关闭，使用硅基流动作为默认
        provider: 'siliconflow',
        
        // 用户自定义API配置
        // 注意：OpenAI和Claude暂时关闭，后续可能重新启用
        apiConfig: {
            // ============================================================
            // 暂时关闭的提供商配置（后续可能重新启用）
            // ============================================================
            // [暂时关闭] openai: {
            //     baseUrl: 'https://api.openai.com/v1',
            //     apiKey: '',
            //     model: 'gpt-4o-mini',
            //     temperature: 0.7,
            //     maxTokens: 2048
            // },
            // [暂时关闭] claude: {
            //     baseUrl: 'https://api.anthropic.com/v1',
            //     apiKey: '',
            //     model: 'claude-3-haiku-20240307',
            //     temperature: 0.7,
            //     maxTokens: 2048
            // },
            // ============================================================
            
            siliconflow: {
                baseUrl: 'https://api.siliconflow.cn/v1',
                apiKey: '',
                model: 'Qwen/Qwen3-8B',
                temperature: 0.7,
                maxTokens: 2048,
                topP: 0.7,
                // Top-K采样
                topK: 50,
                // Qwen3特有参数
                minP: 0.05,
                // 思考模式（仅支持特定模型）
                enableThinking: false,
                thinkingBudget: 4096,
                // 频率惩罚，减少重复内容
                frequencyPenalty: 0
            },
            zhipu: {
                baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
                apiKey: '',
                model: 'glm-4.7-flash',
                temperature: 1.0,
                maxTokens: 65536,
                // 深度思考模式
                enableThinking: false
            },
            custom: {
                baseUrl: '',
                apiKey: '',
                model: '',
                temperature: 0.7,
                maxTokens: 2048
            }
            // [暂时关闭] custom: {
            //     baseUrl: '',
            //     apiKey: '',
            //     model: '',
            //     temperature: 0.7,
            //     maxTokens: 2048
            // }
        },
        
        // 功能开关
        features: {
            // 是否启用日志分析
            logAnalysis: true,
            // 是否启用教程识别
            tutorialRecognition: true,
            // 是否自动建议
            autoSuggestion: true
        },
        
        // 上下文设置
        context: {
            // 最大保留消息数（配合Token限制使用）
            maxHistory: 15,
            // 是否发送日志上下文
            includeLogs: true,
            // 日志上下文条数
            logContextLines: 50
        }
    },
    
    // 当前运行时配置
    _config: null,
    
    // 初始化配置
    init() {
        if (!this._config) {
            this._config = this._loadFromStorage();
        }
        return this._config;
    },
    
    // 从本地存储加载配置
    _loadFromStorage() {
        try {
            const saved = localStorage.getItem('ai_assistant_config');
            if (saved) {
                return { ...this.defaults, ...JSON.parse(saved) };
            }
        } catch (e) {
            console.error('[AI] 加载配置失败:', e);
        }
        return { ...this.defaults };
    },
    
    // 保存配置到本地存储
    save() {
        try {
            localStorage.setItem('ai_assistant_config', JSON.stringify(this._config));
            return true;
        } catch (e) {
            console.error('[AI] 保存配置失败:', e);
            return false;
        }
    },
    
    // 获取配置项
    get(key) {
        this.init();
        return key ? this._config[key] : this._config;
    },
    
    // 设置配置项
    set(key, value) {
        this.init();
        this._config[key] = value;
        return this.save();
    },
    
    // 更新嵌套配置
    setNested(path, value) {
        this.init();
        const keys = path.split('.');
        let target = this._config;
        for (let i = 0; i < keys.length - 1; i++) {
            if (!(keys[i] in target)) {
                target[keys[i]] = {};
            }
            target = target[keys[i]];
        }
        target[keys[keys.length - 1]] = value;
        return this.save();
    },
    
    // 获取嵌套配置
    getNested(path) {
        this.init();
        const keys = path.split('.');
        let target = this._config;
        for (const key of keys) {
            if (target && typeof target === 'object' && key in target) {
                target = target[key];
            } else {
                return undefined;
            }
        }
        return target;
    },
    
    // 重置为默认配置
    reset() {
        this._config = { ...this.defaults };
        return this.save();
    },
    
    // 导出配置（用于备份）
    export() {
        return JSON.stringify(this._config, null, 2);
    },
    
    // 导入配置
    import(configJson) {
        try {
            const parsed = JSON.parse(configJson);
            this._config = { ...this.defaults, ...parsed };
            return this.save();
        } catch (e) {
            console.error('[AI] 导入配置失败:', e);
            return false;
        }
    }
};

// 系统提示词配置
const AI_PROMPTS = {
    // 基础系统提示词
    base: `你是 Aimer WT 的AI助手，专门帮助用户解决战争雷霆游戏中的问题。

你的能力包括：
1. 分析软件运行日志，诊断问题
2. 解答语音包、涂装、炮镜相关的使用问题
3. 提供游戏优化建议
4. 解释软件界面功能

回复要求：
- 使用中文回复
- 简洁明了，避免冗长
- 技术问题给出具体解决步骤
- 不确定时诚实告知`,

    // 日志分析专用提示词
    logAnalysis: `你正在分析 Aimer WT 软件的运行日志。请：
1. 识别错误和警告信息
2. 分析问题可能的原因
3. 给出具体的解决建议
4. 如果是常见问题，提供快速修复方案`,

    // 教程解释提示词
    tutorial: `你正在解释 Aimer WT 软件的功能。请：
1. 用通俗易懂的语言解释
2. 提供操作步骤
3. 说明注意事项
4. 可以提及相关的其他功能`,

    // 战争雷霆游戏相关
    gameAssist: `你是战争雷霆游戏助手。请：
1. 提供游戏机制解释
2. 给出载具建议
3. 分享游戏技巧
4. 回答游戏设置相关问题`
};

// 导出配置
window.AI_CONFIG = AI_CONFIG;
window.AI_PROMPTS = AI_PROMPTS;
