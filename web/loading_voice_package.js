/**
 * 加载组件封装（前端可视化进度）。
 *
 * 功能定位:
 * - 提供覆盖层加载 UI，用于展示后台任务的进度百分比与当前步骤提示。
 *
 * 输入输出:
 * - 输入:
 *   - show(autoSimulate, initialMessage): 是否启用自动模拟进度、初始提示文本
 *   - update(progress, message): 后端推送的真实进度与提示文本
 * - 输出:
 *   - 在 DOM 中创建/更新 overlay、进度条宽度与文本
 *   - 在满足条件时自动隐藏 overlay
 * - 依赖:
 *   - document.head/style 注入与 document.body DOM 挂载
 *   - window.MinimalistLoading 暴露给后端通过 evaluate_js 调用
 *
 * 实现逻辑:
 * - 1) _init 创建样式与 DOM 结构并缓存关键节点引用。
 * - 2) show 初始化状态并按模式启动模拟进度或启动超时提示逻辑。
 * - 3) update 记录目标进度并通过 requestAnimationFrame 平滑逼近显示值。
 * - 4) hide 执行渐隐动画并清理定时器/动画帧与状态。
 *
 * 业务关联:
 * - 上游: 后端通过 main.py 的 update_loading_ui 推送进度与提示文本。
 * - 下游: 用户可通过加载覆盖层理解导入/安装等任务的执行状态。
 */
const MinimalistLoading = {
    overlay: null,
    bar: null,
    status: null,
    percent: null,
    cancelBtn: null,
    interval: null,
    watchdog: null,
    lastUpdateAt: 0,
    currentProgress: 0,
    targetProgress: 0,
    animationFrame: null,
    messages: ["准备加载文件...", "正在处理资源...", "正在写入配置...", "同步中...", "加载完成！"],

    // 初始化并创建 DOM 结构
    _init() {
        if (this.overlay) return; // 避免重复创建

        // 1. 创建 CSS 样式 (使用 CSS 变量适配主题)
        const style = document.createElement('style');
        style.textContent = `
            .loading-overlay {
                position: fixed;
                inset: 0;
                background-color: rgba(15, 23, 42, 0.6);
                backdrop-filter: blur(6px);
                z-index: 9999;
                display: flex;
                align-items: center;
                justify-content: center;
                padding: 1rem;
            }
            [data-theme="dark"] .loading-overlay {
                background-color: rgba(0, 0, 0, 0.75);
            }
            .loading-overlay.hidden { display: none; }
            
            .loading-card {
                width: 100%;
                max-width: 26rem;
                background-color: var(--bg-card, white);
                border-radius: 16px;
                padding: 1.75rem;
                position: relative;
                overflow: hidden;
                box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
                border: 1px solid var(--border-color, #e2e8f0);
            }
            
            .loading-progress-bar {
                position: absolute;
                top: 0;
                left: 0;
                height: 4px;
                background: linear-gradient(90deg, var(--primary, #FF9900) 0%, #ffb347 50%, var(--primary, #FF9900) 100%);
                background-size: 200% 100%;
                width: 0;
                transition: width 0.3s cubic-bezier(0.4, 0, 0.2, 1);
                animation: shimmer 2s ease-in-out infinite;
            }
            
            @keyframes shimmer {
                0% { background-position: 200% 0; }
                100% { background-position: -200% 0; }
            }
            
            .loading-content {
                display: flex;
                align-items: center;
                gap: 1rem;
                margin-top: 0.5rem;
            }
            
            .loading-text-status {
                color: var(--text-main, #1e293b);
                font-weight: 600;
                font-size: 0.9rem;
                margin: 0;
                line-height: 1.4;
            }
            
            .loading-text-percent {
                color: var(--text-sec, #94a3b8);
                font-size: 0.8rem;
                margin-top: 0.25rem;
                margin: 0;
                font-weight: 500;
            }
            
            .loading-actions {
                display: flex;
                justify-content: flex-end;
                margin-top: 1.25rem;
            }
            .loading-cancel-btn {
                border: 1px solid var(--border-color, #cbd5e1);
                background: var(--bg-card, white);
                color: var(--text-sec, #334155);
                padding: 0.5rem 1rem;
                border-radius: 8px;
                font-size: 0.85rem;
                cursor: pointer;
                transition: all 0.2s ease;
            }
            .loading-cancel-btn:hover { 
                background: var(--primary, #FF9900);
                color: white;
                border-color: var(--primary, #FF9900);
            }
            .loading-cancel-btn.hidden { display: none; }

            @keyframes modalIn {
                from { opacity: 0; transform: scale(0.95) translateY(10px); }
                to { opacity: 1; transform: scale(1) translateY(0); }
            }
            @keyframes spin {
                from { transform: rotate(0deg); }
                to { transform: rotate(360deg); }
            }
            .loading-spinner { 
                animation: spin 1s linear infinite;
                height: 1.5rem;
                width: 1.5rem;
                color: var(--primary, #FF9900);
                flex-shrink: 0;
            }
            .loading-modal-enter { animation: modalIn 0.3s ease-out forwards; }
            .loading-modal-exit { 
                animation: modalIn 0.3s ease-in reverse forwards; 
                pointer-events: none;
            }
            .overlay-fade-out {
                opacity: 0;
                transition: opacity 0.4s ease-out;
                pointer-events: none;
            }
        `;
        document.head.appendChild(style);

        // 2. 创建 HTML 结构
        this.overlay = document.createElement('div');
        this.overlay.className = "loading-overlay hidden";
        this.overlay.innerHTML = `
            <div class="loading-card loading-modal-enter">
                <div id="loading-bar" class="loading-progress-bar"></div>
                <div class="loading-content">
                    <svg class="loading-spinner" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" style="opacity: 0.25;"></circle>
                        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" style="opacity: 0.75;"></path>
                    </svg>
                    <div>
                        <p id="loading-status" class="loading-text-status">正在处理资源...</p>
                        <p id="loading-percent" class="loading-text-percent">已完成 0%</p>
                    </div>
                </div>
                <div class="loading-actions">
                    <button id="loading-cancel" class="loading-cancel-btn hidden" type="button">关闭</button>
                </div>
            </div>
        `;

        document.body.appendChild(this.overlay);
        this.bar = document.getElementById('loading-bar');
        this.status = document.getElementById('loading-status');
        this.percent = document.getElementById('loading-percent');
        this.cancelBtn = document.getElementById('loading-cancel');
        this.cancelBtn.addEventListener('click', () => this.hide());
    },

    // 显示 (autoSimulate: 是否自动模拟进度)
    show(autoSimulate = true, initialMessage = "准备加载文件...") {
        this._init();
        this.overlay.classList.remove('hidden');
        this.lastUpdateAt = Date.now();

        // 重置状态
        this.bar.style.width = '0%';
        this.percent.innerText = '已完成 0%';
        this.status.innerText = initialMessage;
        if (this.cancelBtn) this.cancelBtn.classList.add('hidden');

        if (autoSimulate) {
            if (this.watchdog) clearInterval(this.watchdog);
            this._simulate();
        } else {
            // 重置真实进度状态
            this.currentProgress = 0;
            this.targetProgress = 0;
            if (this.interval) clearInterval(this.interval);
            if (this.watchdog) clearInterval(this.watchdog);
            this.watchdog = setInterval(() => {
                if (!this.overlay || this.overlay.classList.contains('hidden')) return;
                const elapsed = Date.now() - this.lastUpdateAt;
                if (elapsed >= 30000) {
                    if (this.status) this.status.innerText = "导入耗时较长，请稍候或点击关闭";
                    if (this.cancelBtn) this.cancelBtn.classList.remove('hidden');
                }
            }, 1000);
        }
    },

    // 手动更新进度 (Backend 调用) - 支持平滑线性过渡
    update(progress, message) {
        if (!this.overlay || this.overlay.classList.contains('hidden')) {
            this._init();
            this.overlay.classList.remove('hidden');
            this.currentProgress = 0;
            this.targetProgress = 0;
        }
        this.lastUpdateAt = Date.now();

        if (this.interval) clearInterval(this.interval);
        if (this.watchdog) clearInterval(this.watchdog);
        if (this.cancelBtn) this.cancelBtn.classList.add('hidden');

        if (progress > 100) progress = 100;
        if (progress < 0) progress = 0;

        // 目标进度
        this.targetProgress = progress;

        // 更新消息文本
        if (message) {
            this.status.innerText = message;
        }

        // 启动平滑动画 (如果还没有在运行)
        if (!this.animationFrame) {
            this._animateProgress();
        }
    },

    // 平滑过渡动画
    _animateProgress() {
        const speed = 2; // 每帧增加的进度 (可调节速度)
        const diff = this.targetProgress - this.currentProgress;

        if (Math.abs(diff) < 0.5) {
            // 已经足够接近目标，直接设置
            this.currentProgress = this.targetProgress;
            this.bar.style.width = `${this.currentProgress}%`;
            this.percent.innerText = `已完成 ${Math.round(this.currentProgress)}%`;
            this.animationFrame = null;

            // 如果达到100%，延迟隐藏
            if (this.currentProgress >= 100) {
                setTimeout(() => this.hide(), 600);
            }
            return;
        }

        // 线性逼近目标
        if (diff > 0) {
            this.currentProgress += Math.min(speed, diff);
        } else {
            this.currentProgress += Math.max(-speed, diff);
        }

        this.bar.style.width = `${this.currentProgress}%`;
        this.percent.innerText = `已完成 ${Math.round(this.currentProgress)}%`;

        // 继续动画
        this.animationFrame = requestAnimationFrame(() => this._animateProgress());
    },

    // 内部模拟逻辑
    _simulate() {
        let progress = 0;
        if (this.interval) clearInterval(this.interval);

        this.interval = setInterval(() => {
            // 每次增加 10-20%，大约 1-2 秒完成
            progress += Math.floor(Math.random() * 10) + 10;
            if (progress > 100) progress = 100;

            this.bar.style.width = `${progress}%`;
            this.percent.innerText = `已完成 ${progress}%`;

            const msgIndex = Math.min(Math.floor(progress / (100 / this.messages.length)), this.messages.length - 1);
            this.status.innerText = this.messages[msgIndex];

            if (progress >= 100) {
                clearInterval(this.interval);
                setTimeout(() => this.hide(), 500);
            }
        }, 150);
    },

    // 隐藏 (增加渐隐效果)
    hide() {
        if (this.overlay && !this.overlay.classList.contains('hidden')) {
            const modal = this.overlay.querySelector('.loading-card');

            // 1. 添加渐隐动画类
            if (modal) modal.classList.add('loading-modal-exit');
            this.overlay.classList.add('overlay-fade-out');

            // 2. 等待动画结束再彻底隐藏
            setTimeout(() => {
                this.overlay.classList.add('hidden');
                // 清理类名以便下次显示
                if (modal) modal.classList.remove('loading-modal-exit');
                this.overlay.classList.remove('overlay-fade-out');
                if (this.interval) clearInterval(this.interval);
                if (this.watchdog) clearInterval(this.watchdog);
                // 清理动画帧和重置进度
                if (this.animationFrame) {
                    cancelAnimationFrame(this.animationFrame);
                    this.animationFrame = null;
                }
                this.currentProgress = 0;
                this.targetProgress = 0;
            }, 400); // 略长于 CSS 动画时间
        }
    }
};

// 显式挂载到 window 对象，供后端通过 evaluate_js 调用
window.MinimalistLoading = MinimalistLoading;
