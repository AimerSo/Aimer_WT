/**
 * 模型库模块
 * 功能定位: 管理游戏模型相关的配置和功能
 *
 * 输入输出:
 *   - 输入: 用户操作、后端数据
 *   - 输出: 渲染模型列表、状态更新
 *
 * 实现逻辑:
 *   - 提供打开模型库、游戏目录、UserMissions的功能
 *   - 显示模型列表和教程
 *
 * 业务关联:
 *   - 上游: resource_nav 导航切换
 *   - 下游: pywebview.api 后端接口
 */

const ModelLibrary = {
    name: '模型库',
    icon: 'ri-box-3-line',
    viewId: 'view-models',

    /**
     * 初始化模块
     */
    init() {
        console.log('[ModelLibrary] 初始化');
        this.bindEvents();
    },

    /**
     * 绑定事件
     */
    bindEvents() {
        // 按钮事件已在HTML中通过onclick绑定到app.openFolder
    },

    /**
     * 显示视图
     */
    show() {
        const view = document.getElementById(this.viewId);
        if (view) {
            view.classList.add('active');
        }
        // 刷新模型列表
        this.refreshModels();
    },

    /**
     * 隐藏视图
     */
    hide() {
        const view = document.getElementById(this.viewId);
        if (view) {
            view.classList.remove('active');
        }
    },

    /**
     * 刷新模型列表
     * @param {Object} options - 选项
     */
    async refreshModels(options = {}) {
        const { manual = false } = options;
        
        if (manual) {
            console.log('[ModelLibrary] 手动刷新模型列表');
        }

        try {
            // 检查后端API是否可用
            if (typeof pywebview !== 'undefined' && pywebview.api && pywebview.api.getModelsList) {
                const result = await pywebview.api.getModelsList();
                this.renderModelsList(result);
            } else {
                // 后端API未实现时显示空状态
                this.renderEmptyState();
            }
        } catch (error) {
            console.error('[ModelLibrary] 刷新模型列表失败:', error);
            this.renderEmptyState();
        }
    },

    /**
     * 渲染模型列表
     * @param {Array} items - 模型列表数据
     */
    renderModelsList(items) {
        const container = document.getElementById('models-list');
        const countEl = document.getElementById('models-count');
        
        if (!container) return;

        // 更新计数
        if (countEl) {
            const count = items && items.length ? items.length : 0;
            countEl.textContent = `本地: ${count}`;
        }

        // 如果没有数据，显示空状态
        if (!items || items.length === 0) {
            this.renderEmptyState();
            return;
        }

        // 渲染模型卡片网格
        container.innerHTML = items.map(item => this.createModelCard(item)).join('');
    },

    /**
     * 渲染空状态
     */
    renderEmptyState() {
        const container = document.getElementById('models-list');
        const countEl = document.getElementById('models-count');
        
        if (container) {
            container.innerHTML = `
                <div class="empty-state" style="grid-column: 1 / -1;">
                    <i class="ri-box-3-line"></i>
                    <h3>还没有模型</h3>
                    <p>点击左侧"打开模型库"按钮，导入模型文件</p>
                </div>
            `;
        }
        
        if (countEl) {
            countEl.textContent = '本地: 0';
        }
    },

    /**
     * 创建模型卡片HTML
     * @param {Object} item - 模型数据
     * @returns {string} 卡片HTML
     */
    createModelCard(item) {
        return `
            <div class="small-card model-card" data-model-id="${item.id || ''}">
                <img class="small-card-img" src="${item.cover || 'assets/default_model_cover.png'}" alt="${item.name}">
                <div class="small-card-body">
                    <div class="small-card-title">${item.name || '未命名模型'}</div>
                    <div class="small-card-meta">
                        <span><i class="ri-calendar-line"></i> ${item.date || '未知日期'}</span>
                    </div>
                </div>
            </div>
        `;
    },

    /**
     * 清理资源
     */
    destroy() {
        // 清理工作（如需要）
    }
};

// 注册到全局
if (typeof app !== 'undefined') {
    app.registerResourcePage('models', ModelLibrary);
}
