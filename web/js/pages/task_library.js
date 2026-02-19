/**
 * 任务库模块
 * 功能定位: 管理游戏任务相关的配置和功能
 *
 * 输入输出:
 *   - 输入: 用户操作、后端数据
 *   - 输出: 渲染任务列表、状态更新
 *
 * 实现逻辑:
 *   - 提供打开任务库、游戏目录、UserMissions文件夹的功能
 *   - 显示任务列表和教程
 *
 * 业务关联:
 *   - 上游: resource_nav 导航切换
 *   - 下游: pywebview.api 后端接口
 */

const TaskLibrary = {
    name: '任务库',
    icon: 'ri-task-line',
    viewId: 'view-tasks',

    /**
     * 初始化模块
     */
    init() {
        console.log('[TaskLibrary] 初始化');
        this.bindEvents();
    },

    /**
     * 绑定事件
     */
    bindEvents() {
        // 按钮事件已在HTML中通过onclick绑定到app.openFolder
        // 这里可以添加额外的事件监听
    },

    /**
     * 显示视图
     */
    show() {
        const view = document.getElementById(this.viewId);
        if (view) {
            view.classList.add('active');
        }
        // 刷新任务列表
        this.refreshTasks();
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
     * 刷新任务列表
     * @param {Object} options - 选项
     */
    async refreshTasks(options = {}) {
        const { manual = false } = options;
        
        if (manual) {
            console.log('[TaskLibrary] 手动刷新任务列表');
        }

        try {
            // 检查后端API是否可用
            if (typeof pywebview !== 'undefined' && pywebview.api && pywebview.api.getTasksList) {
                const result = await pywebview.api.getTasksList();
                this.renderTasksList(result);
            } else {
                // 后端API未实现时显示空状态
                this.renderEmptyState();
            }
        } catch (error) {
            console.error('[TaskLibrary] 刷新任务列表失败:', error);
            this.renderEmptyState();
        }
    },

    /**
     * 渲染任务列表
     * @param {Array} tasks - 任务列表数据
     */
    renderTasksList(tasks) {
        const container = document.getElementById('tasks-list');
        const countEl = document.getElementById('tasks-count');
        
        if (!container) return;

        // 更新计数
        if (countEl) {
            const count = tasks && tasks.length ? tasks.length : 0;
            countEl.textContent = `本地: ${count}`;
        }

        // 如果没有任务，显示空状态
        if (!tasks || tasks.length === 0) {
            this.renderEmptyState();
            return;
        }

        // 渲染任务卡片网格
        container.innerHTML = tasks.map(task => this.createTaskCard(task)).join('');
    },

    /**
     * 渲染空状态
     */
    renderEmptyState() {
        const container = document.getElementById('tasks-list');
        const countEl = document.getElementById('tasks-count');
        
        if (container) {
            container.innerHTML = `
                <div class="empty-state" style="grid-column: 1 / -1;">
                    <i class="ri-task-line"></i>
                    <h3>还没有任务</h3>
                    <p>点击左侧"打开任务库"按钮，导入任务文件</p>
                </div>
            `;
        }
        
        if (countEl) {
            countEl.textContent = '本地: 0';
        }
    },

    /**
     * 创建任务卡片HTML
     * @param {Object} task - 任务数据
     * @returns {string} 卡片HTML
     */
    createTaskCard(task) {
        return `
            <div class="small-card task-card" data-task-id="${task.id || ''}">
                <img class="small-card-img" src="${task.cover || 'assets/default_task_cover.png'}" alt="${task.name}">
                <div class="small-card-body">
                    <div class="small-card-title">${task.name || '未命名任务'}</div>
                    <div class="small-card-meta">
                        <span><i class="ri-calendar-line"></i> ${task.date || '未知日期'}</span>
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
    app.registerResourcePage('tasks', TaskLibrary);
}
