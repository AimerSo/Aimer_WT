/**
 * AI提供商管理器
 * 
 * 功能定位:
 * - 管理所有AI提供商的注册和实例化
 * - 根据配置返回对应的提供商实例
 * 
 * 业务关联:
 * - 上游: AI核心模块
 * - 下游: 各具体提供商实现
 */

const AIProviderManager = {
    // 注册的提供商
    _providers: {},
    
    // 初始化并注册所有提供商
    init() {
        // ============================================================
        // 暂时关闭的提供商（后续可能重新启用）
        // ============================================================
        // 注册OpenAI提供商 [暂时关闭]
        // this.register('openai', OpenAIProvider);
        
        // 注册Claude提供商 [暂时关闭]
        // this.register('claude', ClaudeProvider);
        // ============================================================
        
        // 注册SiliconFlow提供商
        this.register('siliconflow', SiliconFlowProvider);
        
        // 注册智谱AI提供商
        this.register('zhipu', ZhipuProvider);
        
        // 注册后端代理提供商
        this.register('proxy', ProxyProvider);
        
        // 注册自定义提供商（如果配置中有）
        // 注意：自定义使用OpenAI兼容格式，但OpenAI提供商本身已暂时关闭
        // this.register('custom', OpenAIProvider);
        
        console.log('[AI] 提供商管理器已初始化');
    },
    
    // 注册提供商
    register(name, ProviderClass) {
        this._providers[name] = ProviderClass;
    },
    
    // 获取提供商实例
    getProvider(providerName, config) {
        const ProviderClass = this._providers[providerName];
        if (!ProviderClass) {
            console.error(`[AI] 未找到提供商: ${providerName}`);
            return null;
        }
        return new ProviderClass(config);
    },
    
    // 获取当前配置的提供商
    getCurrentProvider() {
        const config = AI_CONFIG.get();
        const apiMode = config.apiMode;
        
        // Aimer免费模式使用后端代理
        if (apiMode === 'aimer_free') {
            return this.getProvider('proxy', {});
        }
        
        // 自定义API模式
        const providerName = config.provider;
        // 合并默认配置和用户配置，确保 baseUrl 等默认值存在
        const providerConfig = {
            ...AI_CONFIG.defaults.apiConfig[providerName],
            ...config.apiConfig[providerName]
        };

        return this.getProvider(providerName, providerConfig);
    },
    
    // 获取所有可用的提供商列表
    getAvailableProviders() {
        return Object.keys(this._providers).map(key => {
            const provider = new this._providers[key]({});
            return {
                name: key,
                label: provider.label
            };
        });
    },
    
    // 获取指定提供商的模型列表
    getProviderModels(providerName) {
        const ProviderClass = this._providers[providerName];
        if (!ProviderClass) return [];
        
        const provider = new ProviderClass({});
        return provider.getModels();
    },
    
    // 验证当前配置
    validateCurrentConfig() {
        const provider = this.getCurrentProvider();
        if (!provider) {
            return { valid: false, error: '无法创建提供商实例' };
        }
        return provider.validateConfig();
    }
};

window.AIProviderManager = AIProviderManager;
