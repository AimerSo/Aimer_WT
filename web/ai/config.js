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
            logAnalysis: false,
            // 是否启用教程识别
            tutorialRecognition: false,
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

// 导出配置
window.AI_CONFIG = AI_CONFIG;
