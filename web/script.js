const DEFAULT_THEME = {
    "--primary": "#FF9900",
    "--primary-hover": "#e68a00",
    "--bg-body": "#F5F7FA",
    "--bg-card": "#FFFFFF",
    "--text-main": "#2C3E50",
    "--text-sec": "#7F8C8D",
    "--border-color": "#E2E8F0",
    "--nav-bg": "#FFFFFF",
    "--nav-item-text": "#7F8C8D",
    "--nav-item-hover-bg": "rgba(0, 0, 0, 0.05)",
    "--nav-item-active": "#FF9900",
    "--nav-item-active-bg": "rgba(255, 153, 0, 0.1)",
    "--status-waiting": "#F59E0B",
    "--status-success": "#10B981",
    "--status-error": "#EF4444",
    "--status-icon-def": "#E2E8F0",
    "--mod-card-title": "#2C3E50",
    "--mod-ver-bg": "rgba(255,153,0,0.1)",
    "--mod-ver-text": "#FF9900",
    "--mod-author-text": "#7F8C8D",
    "--action-trash": "#2C3E50",
    "--action-trash-hover": "#EF4444",
    "--action-refresh": "#2C3E50",
    "--action-refresh-bg": "#2C3E50",
    "--link-bili-normal": "#23ade5",
    "--link-bili-hover": "#23ade5",
    "--link-wt-normal": "#2C3E50",
    "--link-wt-hover": "#2C3E50",
    "--link-vid-normal": "#EF4444",
    "--link-vid-hover": "#EF4444",
    "--tag-tank-bg": "#DCFCE7",
    "--tag-tank-text": "#16A34A",
    "--tag-air-bg": "#F3F4F6",
    "--tag-air-text": "#4B5563",
    "--tag-naval-bg": "#E0F2FE",
    "--tag-naval-text": "#0284C7",
    "--tag-radio-bg": "#FEF9C3",
    "--tag-radio-text": "#CA8A04",
    "--tag-missile-bg": "#FFE4E8",
    "--tag-missile-text": "#DC2626",
    "--tag-music-bg": "#F3E8FF",
    "--tag-music-text": "#9333EA",

    // 默认主题变量（与样式表中使用的 CSS 变量保持一致）
    "--bg-log": "#FFFFFF",
    "--text-log": "#374151",
    "--border-log": "#f0f0f0",
    "--log-info": "#0EA5E9",
    "--log-success": "#10B981",
    "--log-error": "#EF4444",
    "--log-warn": "#F59E0B",
    "--log-sys": "#9CA3AF",
    "--log-scan": "#FF9900",
    "--bili-color-1": "#00aeec",
    "--bili-color-2": "#fb7299",
    "--win-close-hover-bg": "#EF4444",
    "--win-close-hover-text": "#FFFFFF",
    "--scrollbar-track-hover": "#ccc"
};

/**
 * 前端主控制对象。
 *
 * 功能定位:
 * - 维护页面状态（当前路径/主题/已加载数据等），并提供 UI 交互与后端 API 调用的统一入口。
 *
 * 输入输出:
 * - 输入:
 *   - 用户交互（点击/输入/拖拽等）
 *   - 后端返回的数据（pywebview.api.*）
 * - 输出:
 *   - DOM 更新（列表渲染、弹窗、提示、日志面板）
 *   - 调用后端接口（安装/还原/导入/扫描/配置保存）
 * - 外部资源/依赖:
 *   - pywebview.api（后端桥接 API）
 *   - 页面 DOM（按 id/class 组织）
 *   - MinimalistLoading（加载组件）
 *
 * 实现逻辑:
 * - 按“初始化 → 页面切换 → 数据加载/刷新 → 用户操作回调”的流程组织方法。
 *
 * 业务关联:
 * - 上游: index.html 的按钮/输入与浏览器事件。
 * - 下游: main.py 的 AppApi 接口，负责实际文件系统读写与业务执行。
 */
const app = {
    currentGamePath: "",
    currentModId: null, // 当前正在操作的 mod
    currentTheme: null, // 当前主题对象
    currentThemeData: null, // 当前主题原始数据
    _libraryLoaded: false,
    _libraryRefreshing: false,
    _skinsLoaded: false,
    _sightsLoaded: false,

    // 应用主题的函数
    applyTheme(themeObj) {
        const root = document.documentElement;
        for (const [key, value] of Object.entries(themeObj)) {
            if (key.startsWith('--')) {
                root.style.setProperty(key, value);
            }
        }
        this.currentTheme = { ...DEFAULT_THEME, ...themeObj };
    },

    resolveThemeColors(themeData) {
        const mode = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
        const base = themeData?.colors || {};
        const overrides = mode === 'dark' ? themeData?.dark : themeData?.light;
        return { ...base, ...(overrides || {}) };
    },

    applyThemeData(themeData) {
        if (!themeData) return;
        const themeColors = this.resolveThemeColors(themeData);
        this.applyTheme(themeColors);
        this.currentThemeData = themeData;
    },

    // 恢复默认主题（清除内联样式，交给 CSS 处理）
    resetTheme() {
        const root = document.documentElement;
        if (typeof DEFAULT_THEME !== 'undefined') {
            for (const key of Object.keys(DEFAULT_THEME)) {
                if (key.startsWith('--')) {
                    root.style.removeProperty(key);
                }
            }
        }
        this.currentTheme = DEFAULT_THEME;
        this.currentThemeData = null;
    },

    // --- Theme Logic ---
    async loadThemeList() {
        const select = document.getElementById('theme-select');
        if (!select) return;
        select.innerHTML = '<option value="default.json">默认主题 (System Default)</option>';

        try {
            const themes = await pywebview.api.get_theme_list();
            themes.forEach(t => {
                if (t.filename === 'default.json') return;
                const opt = document.createElement('option');
                opt.value = t.filename;
                opt.textContent = `${t.name} (v${t.version}) - by ${t.author}`;
                select.appendChild(opt);
            });
        } catch (e) {
            console.error("Failed to load themes", e);
        }
    },

    async onThemeChange(filename) {
        if (filename === 'default.json') {
            this.resetTheme();
            pywebview.api.save_theme_selection("default.json");
            return;
        }
        const themeData = await pywebview.api.load_theme_content(filename);
        if (themeData && (themeData.colors || themeData.light || themeData.dark)) {
            this.applyThemeData(themeData);
            pywebview.api.save_theme_selection(filename);
        } else {
            app.showAlert("错误", "主题文件损坏或格式错误！");
            document.getElementById('theme-select').value = "default.json";
            this.resetTheme();
        }
    },

    // 初始化
    async init() {
        console.log("App initializing...");
        this.recoverToSafeState('init');

        if (!this._safetyHandlersInstalled) {
            this._safetyHandlersInstalled = true;

            window.addEventListener('error', () => this.recoverToSafeState('error'));
            window.addEventListener('unhandledrejection', () => this.recoverToSafeState('unhandledrejection'));
            document.addEventListener('keydown', (e) => {
                if (e.key !== 'Escape') return;
                const openModal = document.querySelector('.modal-overlay.show');
                if (openModal && openModal.id) app.closeModal(openModal.id);
            });
        }

        // 移除开局强制应用默认主题的逻辑，直接使用 CSS 默认值
        // 这样可以避免内联样式覆盖 CSS 的深色模式定义

        // 监听 pywebview 准备就绪
        window.addEventListener('pywebviewready', async () => {
            console.log("PyWebview ready!");
            // 获取初始状态
            const state = await pywebview.api.init_app_state();
            this.updatePathUI(state.game_path, state.path_valid);

            // 加载主题列表并应用上次的选择
            await this.loadThemeList();
            if (state.active_theme && state.active_theme !== 'default.json') {
                const select = document.getElementById('theme-select');
                if (select) select.value = state.active_theme;

                // 加载内容
                const themeData = await pywebview.api.load_theme_content(state.active_theme);
                if (themeData && themeData.colors) {
                    this.applyTheme(themeData.colors);
                }
            }

            const themeBtn = document.getElementById('btn-theme');
            if (state.theme === 'Light') {
                document.documentElement.setAttribute('data-theme', 'light');
                themeBtn.innerHTML = '<i class="ri-moon-line"></i>';
            } else {
                document.documentElement.setAttribute('data-theme', 'dark');
                themeBtn.innerHTML = '<i class="ri-sun-line"></i>';
            }

            // 绑定快捷键
            document.addEventListener('keydown', this.handleShortcuts.bind(this));

            // --- 新增：设置页面卡片悬停时禁用全局拖拽，防止干扰交互 ---
            document.querySelectorAll('#page-settings .card').forEach(card => {
                card.addEventListener('mouseenter', () => {
                    document.body.classList.add('drag-disabled');
                });
                card.addEventListener('mouseleave', () => {
                    document.body.classList.remove('drag-disabled');
                });
            });
        });
    },

    // --- 页面切换 ---
    switchTab(tabId) {
        const current = document.querySelector('.page.active');
        if (current && current.id === `page-${tabId}`) return;

        const now = (window.performance && performance.now) ? performance.now() : Date.now();
        if (this._lastTabSwitchAt && (now - this._lastTabSwitchAt) < 120) return;
        this._lastTabSwitchAt = now;

        // 更新按钮状态
        document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
        document.getElementById(`btn-${tabId}`).classList.add('active');

        // 更新页面显隐
        document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
        document.getElementById(`page-${tabId}`).classList.add('active');

        if (tabId === 'camo') {
            setTimeout(() => {
                const camoPage = document.getElementById('page-camo');
                const skinsView = document.getElementById('view-skins');
                const sightsView = document.getElementById('view-sights');
                if (!camoPage || !skinsView) return;
                if (!camoPage.classList.contains('active')) return;
                if (skinsView.classList.contains('active')) {
                    if (!this._skinsLoaded) this.refreshSkins();
                    return;
                }
                if (sightsView && sightsView.classList.contains('active')) {
                    if (!this._sightsLoaded) this.loadSightsView();
                }
            }, 80);
        } else if (tabId === 'lib') {
            if (!this._libraryLoaded) this.refreshLibrary();
        }
    },

    async refreshSkins(opts) {
        const listEl = document.getElementById('skins-list');
        const countEl = document.getElementById('skins-count');
        if (!listEl || !countEl || !window.pywebview?.api?.get_skins_list) return;

        const refreshBtn = document.getElementById('btn-refresh-skins');
        if (this._skinsRefreshing) return;
        this._skinsRefreshing = true;
        if (refreshBtn) {
            refreshBtn.disabled = true;
            refreshBtn.classList.add('is-loading');
        }
        countEl.textContent = '刷新中...';
        await new Promise(requestAnimationFrame);

        const camoPage = document.getElementById('page-camo');
        const skinsView = document.getElementById('view-skins');
        if (!camoPage || !skinsView) {
            this._skinsRefreshing = false;
            if (refreshBtn) {
                refreshBtn.disabled = false;
                refreshBtn.classList.remove('is-loading');
            }
            return;
        }
        if (!camoPage.classList.contains('active') || !skinsView.classList.contains('active')) {
            this._skinsRefreshing = false;
            if (refreshBtn) {
                refreshBtn.disabled = false;
                refreshBtn.classList.remove('is-loading');
            }
            return;
        }

        this._skinsRefreshSeq = (this._skinsRefreshSeq || 0) + 1;
        const seq = this._skinsRefreshSeq;

        try {
            const forceRefresh = !!(opts && opts.manual);
            const res = await pywebview.api.get_skins_list({ force_refresh: forceRefresh });
            if (seq !== this._skinsRefreshSeq) return;
            if (!camoPage.classList.contains('active')) return;
            if (!skinsView.classList.contains('active')) return;

            if (!res || !res.valid) {
                this._skinsLoaded = false;
                countEl.textContent = '本地: 0';
                listEl.innerHTML = `
                    <div class="empty-state" style="grid-column: 1 / -1;">
                        <i class="ri-error-warning-line"></i>
                        <h3>未设置有效游戏路径</h3>
                        <p>请先在主页定位《战争雷霆》安装目录</p>
                    </div>
                `;
                return;
            }

            const items = res.items || [];
            countEl.textContent = `本地: ${items.length}`;

            if (items.length === 0) {
                this._skinsLoaded = true;
                listEl.innerHTML = `
                    <div class="empty-state" style="grid-column: 1 / -1;">
                        <i class="ri-brush-3-line"></i>
                        <h3>还没有涂装</h3>
                        <p>拖入 ZIP 或点击“选择 ZIP 解压”，导入后会自动出现在这里</p>
                    </div>
                `;
                return;
            }

            const placeholder = 'assets/card_image_small.png';
            listEl.innerHTML = items.map(it => {
                const cover = it.cover_url || placeholder;
                const isDefaultCover = !!it.cover_is_default;
                const sizeText = app._formatBytes(it.size_bytes || 0);

                // Add edit button to the card
                return `
                    <div class="small-card" title="${app._escapeHtml(it.path || '')}">
                        <div class="small-card-img-wrapper" style="position:relative;">
                             <img class="small-card-img${isDefaultCover ? ' is-default-cover' : ''}" src="${cover}" alt="">
                             <div class="skin-edit-overlay">
                                 <button class="btn-v2 icon-only small secondary skin-edit-btn"
                                         onclick="app.openEditSkinModal('${app._escapeHtml(it.name)}', '${cover.replace(/'/g, "\\'")}')">
                                     <i class="ri-edit-line"></i>
                                 </button>
                             </div>
                        </div>
                        <div class="small-card-body">
                            <div class="skin-card-footer">
                                <div class="skin-card-name" title="${app._escapeHtml(it.name || '')}">${app._escapeHtml(it.name || '')}</div>
                                <div class="skin-card-size">${sizeText}</div>
                            </div>
                        </div>
                    </div>
                `;
            }).join('');
            this._skinsLoaded = true;
        } catch (e) {
            console.error(e);
        } finally {
            this._skinsRefreshing = false;
            if (refreshBtn) {
                refreshBtn.disabled = false;
                refreshBtn.classList.remove('is-loading');
            }
        }
    },

    // --- Skin Editing Logic (New) ---
    currentEditSkin: null,
    currentEditSight: null,
    _cropCoverTarget: "skin",

    openEditSkinModal(skinName, coverUrl) {
        this.currentEditSkin = skinName;
        this._cropCoverTarget = "skin";
        const modal = document.getElementById('modal-edit-skin');
        const nameInput = document.getElementById('edit-skin-name');
        const coverImg = document.getElementById('edit-skin-cover');

        if (!modal || !nameInput || !coverImg) return;

        nameInput.value = skinName;
        coverImg.src = coverUrl || 'assets/coming_soon_img.png';

        modal.classList.remove('hiding');
        modal.classList.add('show');
    },

    async saveSkinEdit() {
        if (!this.currentEditSkin) return;

        const newName = document.getElementById('edit-skin-name').value.trim();
        if (!newName) {
            app.showAlert("错误", "名称不能为空！", "error");
            return;
        }

        if (newName !== this.currentEditSkin) {
            // Rename logic
            try {
                const res = await pywebview.api.rename_skin(this.currentEditSkin, newName);
                if (res.success) {
                    app.showAlert("成功", "重命名成功！", "success");
                    this.currentEditSkin = newName; // Update local ref
                    this.refreshSkins(); // Reload list
                } else {
                    app.showAlert("失败", "重命名失败: " + res.msg, "error");
                    return; // Stop if rename failed
                }
            } catch (e) {
                app.showAlert("错误", "调用失败: " + e, "error");
                return;
            }
        }

        app.closeModal('modal-edit-skin');
        // Refresh to reflect changes (especially if cover was updated separately)
        this.refreshSkins();
    },

    async requestUpdateSkinCover() {
        if (!this.currentEditSkin) return;
        this._cropCoverTarget = "skin";

        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.onchange = async () => {
            const file = input.files && input.files[0];
            if (!file) return;
            try {
                const dataUrl = await new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onerror = () => reject(new Error('读取图片失败'));
                    reader.onload = () => resolve(String(reader.result || ''));
                    reader.readAsDataURL(file);
                });
                this.openCropCoverModal(dataUrl);
            } catch (e) {
                console.error(e);
                this.showAlert("错误", "读取图片失败", "error");
            }
        };
        input.click();
    },

    _cropCoverState: null,

    openEditSightModal(sightName, coverUrl) {
        this.currentEditSight = sightName;
        this._cropCoverTarget = "sight";
        const modal = document.getElementById('modal-edit-sight');
        const nameInput = document.getElementById('edit-sight-name');
        const coverImg = document.getElementById('edit-sight-cover');

        if (!modal || !nameInput || !coverImg) return;

        nameInput.value = sightName;
        coverImg.src = coverUrl || 'assets/coming_soon_img.png';

        modal.classList.remove('hiding');
        modal.classList.add('show');
    },

    async saveSightEdit() {
        if (!this.currentEditSight) return;

        const newName = document.getElementById('edit-sight-name').value.trim();
        if (!newName) {
            app.showAlert("错误", "名称不能为空！", "error");
            return;
        }

        if (newName !== this.currentEditSight) {
            try {
                const res = await pywebview.api.rename_sight(this.currentEditSight, newName);
                if (res.success) {
                    app.showAlert("成功", "重命名成功！", "success");
                    this.currentEditSight = newName;
                    this.refreshSights({ manual: true });
                } else {
                    app.showAlert("失败", "重命名失败: " + res.msg, "error");
                    return;
                }
            } catch (e) {
                app.showAlert("错误", "调用失败: " + e, "error");
                return;
            }
        }

        app.closeModal('modal-edit-sight');
        this.refreshSights({ manual: true });
    },

    async requestUpdateSightCover() {
        if (!this.currentEditSight) return;
        this._cropCoverTarget = "sight";

        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.onchange = async () => {
            const file = input.files && input.files[0];
            if (!file) return;
            try {
                const dataUrl = await new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onerror = () => reject(new Error('读取图片失败'));
                    reader.onload = () => resolve(String(reader.result || ''));
                    reader.readAsDataURL(file);
                });
                this.openCropCoverModal(dataUrl);
            } catch (e) {
                console.error(e);
                this.showAlert("错误", "读取图片失败", "error");
            }
        };
        input.click();
    },

    openCropCoverModal(dataUrl) {
        const modal = document.getElementById('modal-crop-cover');
        const canvas = document.getElementById('crop-canvas');
        const zoomEl = document.getElementById('crop-zoom');
        if (!modal || !canvas || !zoomEl) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const img = new Image();
        img.onload = () => {
            const cw = canvas.width;
            const ch = canvas.height;

            const scaleX = cw / img.width;
            const scaleY = ch / img.height;
            const baseScale = Math.max(scaleX, scaleY);

            const state = {
                img,
                baseScale,
                scale: 1,
                offsetX: (cw - img.width * baseScale) / 2,
                offsetY: (ch - img.height * baseScale) / 2,
                dragging: false,
                lastX: 0,
                lastY: 0,
                cw,
                ch,
            };

            this._cropCoverState = state;
            zoomEl.value = '1';

            const draw = () => {
                const s = this._cropCoverState;
                if (!s) return;
                ctx.clearRect(0, 0, cw, ch);
                const drawScale = s.baseScale * s.scale;
                const dw = s.img.width * drawScale;
                const dh = s.img.height * drawScale;
                ctx.drawImage(s.img, s.offsetX, s.offsetY, dw, dh);
            };

            const clamp = () => {
                const s = this._cropCoverState;
                if (!s) return;
                const drawScale = s.baseScale * s.scale;
                const dw = s.img.width * drawScale;
                const dh = s.img.height * drawScale;

                const minX = Math.min(0, s.cw - dw);
                const maxX = Math.max(0, s.cw - dw);
                const minY = Math.min(0, s.ch - dh);
                const maxY = Math.max(0, s.ch - dh);

                s.offsetX = Math.min(Math.max(s.offsetX, minX), maxX);
                s.offsetY = Math.min(Math.max(s.offsetY, minY), maxY);
            };

            const onPointerDown = (e) => {
                const s = this._cropCoverState;
                if (!s) return;
                s.dragging = true;
                s.lastX = e.clientX;
                s.lastY = e.clientY;
                canvas.setPointerCapture(e.pointerId);
            };
            const onPointerMove = (e) => {
                const s = this._cropCoverState;
                if (!s || !s.dragging) return;
                const dx = e.clientX - s.lastX;
                const dy = e.clientY - s.lastY;
                s.lastX = e.clientX;
                s.lastY = e.clientY;
                s.offsetX += dx;
                s.offsetY += dy;
                clamp();
                draw();
            };
            const onPointerUp = (e) => {
                const s = this._cropCoverState;
                if (!s) return;
                s.dragging = false;
                try { canvas.releasePointerCapture(e.pointerId); } catch { }
            };

            canvas.onpointerdown = onPointerDown;
            canvas.onpointermove = onPointerMove;
            canvas.onpointerup = onPointerUp;
            canvas.onpointercancel = onPointerUp;

            canvas.onwheel = (e) => {
                e.preventDefault();
                const s = this._cropCoverState;
                if (!s) return;
                const delta = e.deltaY > 0 ? -0.06 : 0.06;
                s.scale = Math.min(3, Math.max(0.2, s.scale + delta));
                zoomEl.value = String(s.scale);
                clamp();
                draw();
            };

            zoomEl.oninput = () => {
                const s = this._cropCoverState;
                if (!s) return;
                s.scale = Math.min(3, Math.max(0.2, Number(zoomEl.value || 1)));
                clamp();
                draw();
            };

            draw();
            modal.classList.remove('hiding');
            modal.classList.add('show');
        };
        img.src = dataUrl;
    },

    async applyCroppedCover() {
        if (!this.currentEditSkin && !this.currentEditSight) return;
        const canvas = document.getElementById('crop-canvas');
        const state = this._cropCoverState;
        if (!canvas || !state) return;

        const out = document.createElement('canvas');
        out.width = 1280;
        out.height = 720;
        const octx = out.getContext('2d');
        if (!octx) return;

        const drawScale = state.baseScale * state.scale;
        const srcScale = drawScale * (out.width / state.cw);

        const sx = (-state.offsetX) / drawScale;
        const sy = (-state.offsetY) / drawScale;
        const sw = state.cw / drawScale;
        const sh = state.ch / drawScale;

        octx.clearRect(0, 0, out.width, out.height);
        octx.drawImage(state.img, sx, sy, sw, sh, 0, 0, out.width, out.height);

        const dataUrl = out.toDataURL('image/png');
        try {
            if (this._cropCoverTarget === "sight") {
                if (!window.pywebview?.api?.update_sight_cover_data) {
                    this.showAlert("错误", "功能未就绪，请检查后端连接", "error");
                    return;
                }
                const res = await pywebview.api.update_sight_cover_data(this.currentEditSight, dataUrl);
                if (res && res.success) {
                    const coverImg = document.getElementById('edit-sight-cover');
                    if (coverImg) coverImg.src = dataUrl;
                    this.showAlert("成功", "封面已更新！", "success");
                    this.refreshSights({ manual: true });
                    this.closeModal('modal-crop-cover');
                } else {
                    this.showAlert("错误", (res && res.msg) ? res.msg : "封面更新失败", "error");
                }
                return;
            }

            if (!window.pywebview?.api?.update_skin_cover_data) {
                this.showAlert("错误", "功能未就绪，请检查后端连接", "error");
                return;
            }

            const res = await pywebview.api.update_skin_cover_data(this.currentEditSkin, dataUrl);
            if (res && res.success) {
                const coverImg = document.getElementById('edit-skin-cover');
                if (coverImg) coverImg.src = dataUrl;
                this.showAlert("成功", "封面已更新！", "success");
                this.refreshSkins({ manual: true });
                this.closeModal('modal-crop-cover');
            } else {
                this.showAlert("错误", (res && res.msg) ? res.msg : "封面更新失败", "error");
            }
        } catch (e) {
            console.error(e);
            this.showAlert("错误", "封面更新失败", "error");
        }
    },


    importSkinZipDialog() {
        if (!this.currentGamePath) {
            app.showAlert("提示", "请先在主页设置游戏路径！");
            this.switchTab('home');
            return;
        }
        if (!window.pywebview?.api?.import_skin_zip_dialog) return;
        pywebview.api.import_skin_zip_dialog();
    },

    importSightsZipDialog() {
        if (!this.sightsPath) {
            app.showAlert("提示", "请先设置 UserSights 路径！");
            return;
        }
        if (!window.pywebview?.api?.import_sights_zip_dialog) return;
        pywebview.api.import_sights_zip_dialog();
    },

    setupSkinsDropZone() {
        const zone = document.getElementById('skins-drop-zone');
        if (!zone) return;

        const canHighlight = () => {
            const activeId = (document.querySelector('.page.active') || {}).id || '';
            return activeId === 'page-camo';
        };

        const onDragOver = (e) => {
            if (!canHighlight()) return;
            e.preventDefault();
            e.stopPropagation();
            zone.classList.add('drag-over');
        };

        const clear = () => zone.classList.remove('drag-over');

        zone.addEventListener('dragenter', onDragOver);
        zone.addEventListener('dragover', onDragOver);
        zone.addEventListener('dragleave', clear);
        zone.addEventListener('drop', (e) => {
            e.preventDefault();
            e.stopPropagation();
            clear();

            if (!this.currentGamePath) {
                this.showAlert("提示", "请先在主页设置游戏路径！", "warn");
                this.switchTab('home');
                return;
            }

            const files = Array.from((e.dataTransfer && e.dataTransfer.files) ? e.dataTransfer.files : []);
            const zipFile = files.find(f => String(f.path || f.name || '').toLowerCase().endsWith('.zip'));
            if (!zipFile) {
                this.showAlert("提示", "请拖入 .zip 压缩包", "warn");
                return;
            }

            const zipPath = zipFile.path;
            if (!zipPath) {
                this.showAlert("提示", "当前环境无法获取拖入文件路径，请使用“选择 ZIP 解压”按钮", "warn");
                return;
            }

            if (!window.pywebview?.api?.import_skin_zip_from_path) {
                this.showAlert("错误", "功能未就绪，请检查后端连接", "error");
                return;
            }

            pywebview.api.import_skin_zip_from_path(zipPath);
        });

        document.addEventListener('dragover', (e) => {
            if (!canHighlight()) return;
            e.preventDefault();
        });
        document.addEventListener('drop', (e) => {
            if (!canHighlight()) return;
            e.preventDefault();
        });
    },

    setupSightsDropZone() {
        const zone = document.getElementById('sights-drop-zone');
        if (!zone) return;

        const canHighlight = () => {
            const activeId = (document.querySelector('.page.active') || {}).id || '';
            const sightsView = document.getElementById('view-sights');
            return activeId === 'page-camo' && !!(sightsView && sightsView.classList.contains('active'));
        };

        const onDragOver = (e) => {
            if (!canHighlight()) return;
            e.preventDefault();
            e.stopPropagation();
            zone.classList.add('drag-over');
        };

        const clear = () => zone.classList.remove('drag-over');

        zone.addEventListener('dragenter', onDragOver);
        zone.addEventListener('dragover', onDragOver);
        zone.addEventListener('dragleave', clear);
        zone.addEventListener('drop', (e) => {
            e.preventDefault();
            e.stopPropagation();
            clear();

            const files = Array.from((e.dataTransfer && e.dataTransfer.files) ? e.dataTransfer.files : []);
            const zipFile = files.find(f => String(f.path || f.name || '').toLowerCase().endsWith('.zip'));
            if (!zipFile) {
                this.showAlert("提示", "请拖入 .zip 压缩包", "warn");
                return;
            }

            const zipPath = zipFile.path;
            if (!zipPath) {
                this.showAlert("提示", "当前环境无法获取拖入文件路径，请使用“选择 ZIP 解压”按钮", "warn");
                return;
            }

            if (!window.pywebview?.api?.import_sights_zip_from_path) {
                this.showAlert("错误", "功能未就绪，请检查后端连接", "error");
                return;
            }

            pywebview.api.import_sights_zip_from_path(zipPath);
        });

        document.addEventListener('dragover', (e) => {
            if (!canHighlight()) return;
            e.preventDefault();
        });
        document.addEventListener('drop', (e) => {
            if (!canHighlight()) return;
            e.preventDefault();
        });
    },

    _formatBytes(bytes) {
        const b = Number(bytes || 0);
        if (!Number.isFinite(b) || b <= 0) return '0 MB';
        const mb = b / (1024 * 1024);
        if (mb < 1) return '<1 MB';
        if (mb < 1024) return `${mb.toFixed(0)} MB`;
        return `${(mb / 1024).toFixed(1)} GB`;
    },

    _escapeHtml(str) {
        return String(str || '')
            .replaceAll('&', '&amp;')
            .replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;')
            .replaceAll('"', '&quot;')
            .replaceAll("'", '&#39;');
    },

    async copyText(text) {
        const value = String(text || '');
        if (!value) return false;
        if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
            try {
                await navigator.clipboard.writeText(value);
                return true;
            } catch (e) {
            }
        }
        const textarea = document.createElement('textarea');
        textarea.value = value;
        textarea.setAttribute('readonly', 'true');
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        textarea.style.pointerEvents = 'none';
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        let ok = false;
        try {
            ok = document.execCommand('copy');
        } catch (e) {
            ok = false;
        }
        document.body.removeChild(textarea);
        return ok;
    },

    closeModal(modalId) {
        const el = document.getElementById(modalId);
        if (!el) return;
        if (!el.classList.contains('show')) return;

        el.classList.add('hiding');

        const finalize = () => {
            if (!el.classList.contains('hiding')) return;
            el.classList.remove('show');
            el.classList.remove('hiding');
        };

        el.addEventListener('animationend', finalize, { once: true });
        setTimeout(finalize, 250);
    },

    _setupModalDragLock() {
        const patchPywebviewMoveWindow = () => {
            if (this._pywebviewMoveWindowPatched) return;
            if (!window.pywebview || typeof window.pywebview._jsApiCallback !== 'function') return;

            const original = window.pywebview._jsApiCallback.bind(window.pywebview);
            window.pywebview._jsApiCallback = (funcName, params, id) => {
                const anyOpen = !!document.querySelector('.modal-overlay.show');
                if (anyOpen && funcName === 'pywebviewMoveWindow') return;
                return original(funcName, params, id);
            };
            this._pywebviewMoveWindowPatched = true;
        };

        const update = () => {
            patchPywebviewMoveWindow();
        };

        update();

        const modals = Array.from(document.querySelectorAll('.modal-overlay'));
        if (modals.length === 0) return;

        const observer = new MutationObserver(update);
        modals.forEach(m => observer.observe(m, { attributes: true, attributeFilter: ['class'] }));
    },

    confirm(title, messageHtml, isDanger = false, okText = null) {
        const modal = document.getElementById('modal-confirm');
        const titleEl = document.getElementById('confirm-title');
        const msgEl = document.getElementById('confirm-message');
        const okBtn = document.getElementById('btn-confirm-ok');
        const cancelBtn = document.getElementById('btn-confirm-cancel');

        if (!modal || !titleEl || !msgEl || !okBtn || !cancelBtn) {
            return Promise.resolve(false);
        }

        if (typeof this._confirmCleanup === 'function') {
            try { this._confirmCleanup(false); } catch (e) { }
        }

        titleEl.textContent = title || '操作确认';
        msgEl.innerHTML = messageHtml || '';

        let finalOkText = okText;
        let iconClass = 'ri-check-line';
        const t = String(title || '');
        if (!finalOkText) {
            if (t.includes('删除')) {
                finalOkText = '确认删除';
                iconClass = 'ri-delete-bin-line';
            } else if (t.includes('还原')) {
                finalOkText = '确认还原';
                iconClass = 'ri-refresh-line';
            } else if (t.includes('冲突') || t.includes('安装')) {
                finalOkText = '继续';
                iconClass = 'ri-rocket-line';
            } else {
                finalOkText = isDanger ? '确认' : '确定';
                iconClass = isDanger ? 'ri-alert-line' : 'ri-check-line';
            }
        }

        okBtn.innerHTML = `<i class="${iconClass}"></i> ${finalOkText}`;
        okBtn.classList.remove('primary', 'secondary', 'danger');
        okBtn.classList.add(isDanger ? 'danger' : 'primary');

        modal.classList.remove('hiding');
        modal.classList.add('show');

        return new Promise((resolve) => {
            let done = false;

            const cleanup = () => {
                okBtn.removeEventListener('click', onOk);
                cancelBtn.removeEventListener('click', onCancel);
                modal.removeEventListener('click', onOverlay);
                document.removeEventListener('keydown', onKeydown, true);
                this._confirmCleanup = null;
            };

            const finish = (result) => {
                if (done) return;
                done = true;
                cleanup();
                this.closeModal('modal-confirm');
                resolve(!!result);
            };

            const onOk = () => finish(true);
            const onCancel = () => finish(false);
            const onOverlay = (e) => {
                if (e.target === modal) finish(false);
            };
            const onKeydown = (e) => {
                if (e.key === 'Escape') finish(false);
            };

            this._confirmCleanup = finish;

            okBtn.addEventListener('click', onOk);
            cancelBtn.addEventListener('click', onCancel);
            modal.addEventListener('click', onOverlay);
            document.addEventListener('keydown', onKeydown, true);
        });
    },

    openArchivePasswordModal(archiveName, errorHint = '') {
        const modal = document.getElementById('modal-archive-password');
        const titleEl = document.getElementById('archive-password-title');
        const fileEl = document.getElementById('archive-password-file');
        const hintEl = document.getElementById('archive-password-hint');
        const input = document.getElementById('archive-password-input');
        if (!modal || !input) return;

        if (typeof this._archivePasswordCleanup === 'function') {
            try { this._archivePasswordCleanup(); } catch (e) { }
        }

        if (titleEl) titleEl.textContent = '请输入解压密码';
        if (fileEl) fileEl.textContent = archiveName ? `文件: ${archiveName}` : '';
        if (hintEl) hintEl.textContent = errorHint || '';
        input.value = '';

        modal.classList.remove('hiding');
        modal.classList.add('show');

        const onOverlay = (e) => {
            if (e.target === modal) this.cancelArchivePassword();
        };
        const onKeydown = (e) => {
            if (e.key === 'Escape') this.cancelArchivePassword();
        };
        modal.addEventListener('click', onOverlay);
        document.addEventListener('keydown', onKeydown, true);

        this._archivePasswordCleanup = () => {
            modal.removeEventListener('click', onOverlay);
            document.removeEventListener('keydown', onKeydown, true);
            this._archivePasswordCleanup = null;
        };

        setTimeout(() => {
            try { input.focus(); } catch (e) { }
        }, 0);
    },

    onArchivePasswordKeydown(e) {
        if (!e) return;
        if (e.key === 'Enter') {
            e.preventDefault();
            this.submitArchivePassword();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            this.cancelArchivePassword();
        }
    },

    submitArchivePassword() {
        const input = document.getElementById('archive-password-input');
        const value = String(input?.value || '');
        if (!value) {
            this.showAlert('提示', '请输入密码', 'warn');
            return;
        }
        if (typeof this._archivePasswordCleanup === 'function') {
            try { this._archivePasswordCleanup(); } catch (e) { }
        }
        this.closeModal('modal-archive-password');
        pywebview.api.submit_archive_password(value);
    },

    cancelArchivePassword() {
        if (typeof this._archivePasswordCleanup === 'function') {
            try { this._archivePasswordCleanup(); } catch (e) { }
        }
        this.closeModal('modal-archive-password');
        pywebview.api.cancel_archive_password();
    },

    forceHideAllModals() {
        document.querySelectorAll('.modal-overlay').forEach(el => {
            el.classList.remove('show');
            el.classList.remove('hiding');
        });
    },

    initToasts() {
        if (this._toastInited) return;
        this._toastInited = true;

        const errorClose = document.getElementById('toast-error-close');
        if (errorClose) errorClose.addEventListener('click', () => this.hideErrorToast());

        const warnClose = document.getElementById('toast-warn-close');
        if (warnClose) warnClose.addEventListener('click', () => this.hideWarnToast());

        const infoClose = document.getElementById('toast-info-close');
        if (infoClose) infoClose.addEventListener('click', () => this.hideInfoToast());
    },

    formatToastMessage(message) {
        const text = String(message || '')
            .replace(/<br\s*\/?>/gi, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        return text.replace(/^\[[^\]]+\]\s*\[[A-Z]+\]\s*/i, '');
    },

    notifyToast(level, message) {
        const content = this.formatToastMessage(message);
        if (!content) return;
        if (level === 'ERROR') {
            this.showErrorToast('错误', content);
            return;
        }
        if (level === 'WARN') {
            this.showWarnToast('警告', content);
            return;
        }
        if (level === 'SUCCESS') {
            this.showInfoToast('成功', content);
            return;
        }
        this.showInfoToast('提示', content);
    },

    showErrorToast(title, message, duration = 5000) {
        const toast = document.getElementById('toast-error');
        if (!toast) {
            this.showAlert(title || '错误', message, 'error');
            return;
        }

        const titleEl = toast.querySelector('.toast-error-title');
        const messageEl = toast.querySelector('.toast-error-message');

        if (titleEl) titleEl.textContent = title || '错误';
        if (messageEl) messageEl.textContent = message || '';

        toast.classList.remove('hiding');
        toast.classList.add('show');

        if (this._errorToastTimeout) {
            clearTimeout(this._errorToastTimeout);
        }

        this._errorToastTimeout = setTimeout(() => {
            this.hideErrorToast();
        }, duration);
    },

    hideErrorToast() {
        const toast = document.getElementById('toast-error');
        if (!toast) return;

        toast.classList.add('hiding');

        setTimeout(() => {
            toast.classList.remove('hiding', 'show');
        }, 300);

        if (this._errorToastTimeout) {
            clearTimeout(this._errorToastTimeout);
            this._errorToastTimeout = null;
        }
    },

    showWarnToast(title, message, duration = 5000) {
        const toast = document.getElementById('toast-warn');
        if (!toast) {
            this.showAlert(title || '警告', message, 'warn');
            return;
        }

        const titleEl = toast.querySelector('.toast-warn-title');
        const messageEl = toast.querySelector('.toast-warn-message');

        if (titleEl) titleEl.textContent = title || '警告';
        if (messageEl) messageEl.textContent = message || '';

        toast.classList.remove('hiding');
        toast.classList.add('show');

        if (this._warnToastTimeout) {
            clearTimeout(this._warnToastTimeout);
        }

        this._warnToastTimeout = setTimeout(() => {
            this.hideWarnToast();
        }, duration);
    },

    hideWarnToast() {
        const toast = document.getElementById('toast-warn');
        if (!toast) return;

        toast.classList.add('hiding');

        setTimeout(() => {
            toast.classList.remove('hiding', 'show');
        }, 300);

        if (this._warnToastTimeout) {
            clearTimeout(this._warnToastTimeout);
            this._warnToastTimeout = null;
        }
    },

    showInfoToast(title, message, duration = 5000) {
        const toast = document.getElementById('toast-info');
        if (!toast) {
            this.showAlert(title || '提示', message, 'info');
            return;
        }

        const titleEl = toast.querySelector('.toast-info-title');
        const messageEl = toast.querySelector('.toast-info-message');

        if (titleEl) titleEl.textContent = title || '提示';
        if (messageEl) messageEl.textContent = message || '';

        toast.classList.remove('hiding');
        toast.classList.add('show');

        if (this._infoToastTimeout) {
            clearTimeout(this._infoToastTimeout);
        }

        this._infoToastTimeout = setTimeout(() => {
            this.hideInfoToast();
        }, duration);
    },

    hideInfoToast() {
        const toast = document.getElementById('toast-info');
        if (!toast) return;

        toast.classList.add('hiding');

        setTimeout(() => {
            toast.classList.remove('hiding', 'show');
        }, 300);

        if (this._infoToastTimeout) {
            clearTimeout(this._infoToastTimeout);
            this._infoToastTimeout = null;
        }
    },

    // 自定义提示弹窗（替代原生 alert）
    showAlert(title, message, iconType = 'info') {
        const modal = document.getElementById('modal-alert');
        if (!modal) {
            console.error('modal-alert not found, falling back to native alert');
            alert(message);
            return;
        }

        const titleEl = document.getElementById('alert-title');
        const msgEl = document.getElementById('alert-message');
        const iconEl = document.getElementById('alert-icon');

        if (titleEl) titleEl.textContent = title || '提示';
        if (msgEl) msgEl.textContent = message || '';

        // 根据类型设置图标
        if (iconEl) {
            let iconClass = 'ri-information-line';
            let iconColor = 'var(--primary)';
            if (iconType === 'error') {
                iconClass = 'ri-error-warning-line';
                iconColor = 'var(--status-error)';
            } else if (iconType === 'success') {
                iconClass = 'ri-checkbox-circle-line';
                iconColor = 'var(--status-success)';
            } else if (iconType === 'warn') {
                iconClass = 'ri-alert-line';
                iconColor = 'var(--status-waiting)';
            }
            iconEl.innerHTML = `<i class="${iconClass}" style="font-size: 48px; color: ${iconColor};"></i>`;
        }

        modal.classList.remove('hiding');
        modal.classList.add('show');
    },

    recoverToSafeState(reason) {
        try {
            const disclaimer = document.getElementById('modal-disclaimer');
            if (reason === 'backend_start' && disclaimer && disclaimer.classList.contains('show')) {
                return;
            }
            this.forceHideAllModals();
            this.switchTab('home');
        } catch (e) {
        }
    },

    // --- 主题与置顶 ---
    toggleTheme() {
        const root = document.documentElement;
        const btn = document.getElementById('btn-theme');

        if (root.getAttribute('data-theme') === 'light') {
            // 切换到深色
            root.setAttribute('data-theme', 'dark');
            // 换成太阳图标
            btn.innerHTML = '<i class="ri-sun-line"></i>';
            pywebview.api.set_theme('Dark');
        } else {
            // 切换到浅色
            root.setAttribute('data-theme', 'light');
            // 换成月亮图标
            btn.innerHTML = '<i class="ri-moon-line"></i>';
            pywebview.api.set_theme('Light');
        }
        if (this.currentThemeData) {
            this.applyThemeData(this.currentThemeData);
        }
    },

    togglePin() {
        const btn = document.getElementById('btn-pin-title');
        if (!btn) return;

        btn.classList.toggle('active');
        const isTop = btn.classList.contains('active');

        if (isTop) {
            btn.innerHTML = '<i class="ri-pushpin-fill"></i>';
        } else {
            btn.innerHTML = '<i class="ri-pushpin-line"></i>';
        }

        pywebview.api.toggle_topmost(isTop);
    },

    // --- 窗口控制 ---
    minimizeApp() {
        pywebview.api.minimize_window();
    },

    closeApp() {
        pywebview.api.close_window();
    },

    // --- 路径搜索逻辑 ---
    updatePathUI(path, valid) {
        const input = document.getElementById('input-game-path');
        const statusIcon = document.getElementById('status-icon');
        const statusText = document.getElementById('status-text');

        input.value = path || "";
        this.currentGamePath = path;

        if (valid) {
            statusIcon.innerHTML = '<i class="ri-link"></i>';
            statusIcon.className = 'status-icon active';
            statusText.textContent = '连接正常';
            statusText.className = 'status-text success';
        } else if (!path) {
            statusIcon.innerHTML = '<i class="ri-wifi-off-line"></i>';
            statusIcon.className = 'status-icon';
            statusText.textContent = '未设置路径';
            statusText.className = 'status-text waiting';
        } else {
            statusIcon.innerHTML = '<i class="ri-error-warning-line"></i>';
            statusIcon.className = 'status-icon';
            statusText.textContent = '路径无效';
            statusText.className = 'status-text error';
        }
    },

    async browsePath() {
        const res = await pywebview.api.browse_folder();
        if (res) {
            this.updatePathUI(res.path, res.valid);
        }
    },

    autoSearch() {
        document.getElementById('btn-auto-search').disabled = true;
        document.getElementById('status-text').textContent = '搜索中...';
        document.getElementById('status-icon').textContent = '⏳';
        pywebview.api.start_auto_search();
    },

    // 被 Python 调用的回调
    onSearchSuccess(path) {
        this.updatePathUI(path, true);
        document.getElementById('btn-auto-search').disabled = false;
    },

    onSearchFail() {
        this.updatePathUI("", false);
        document.getElementById('btn-auto-search').disabled = false;
    },

    // --- 日志系统 ---
    appendLog(htmlMsg) {
        const container = document.getElementById('log-container');
        const div = document.createElement('div');
        // 根据内容简单判断颜色类
        let cls = 'info';
        if (htmlMsg.includes('ERROR') || htmlMsg.includes('错误')) cls = 'error';
        else if (htmlMsg.includes('SUCCESS') || htmlMsg.includes('成功')) cls = 'success';
        else if (htmlMsg.includes('WARN')) cls = 'warn';
        else if (htmlMsg.includes('SYS')) cls = 'sys';

        div.className = `log-line ${cls}`;
        div.innerHTML = htmlMsg; // 允许 <br>
        container.appendChild(div);
        container.scrollTop = container.scrollHeight; // 自动滚动到底部
    },

    updateSearchLog(msg) {
        // 更新最后一行而不是追加
        const container = document.getElementById('log-container');
        if (container.lastElementChild && container.lastElementChild.classList.contains('scan')) {
            container.lastElementChild.textContent = msg;
        } else {
            const div = document.createElement('div');
            div.className = 'log-line scan';
            div.textContent = msg;
            container.appendChild(div);
        }
        container.scrollTop = container.scrollHeight;
    },

    clearLogs() {
        document.getElementById('log-container').innerHTML = '';
        pywebview.api.clear_logs();
    },

    // --- 语音包库逻辑 ---
    async refreshLibrary(opts) {
        const listContainer = document.getElementById('lib-list');
        if (!listContainer) return;
        if (this._libraryRefreshing) return;
        const isManual = !!(opts && opts.manual);
        if (!isManual && this._libraryLoaded) return;
        this._libraryRefreshing = true;

        listContainer.classList.add('fade-out');
        await new Promise(r => setTimeout(r, 200));

        const mods = await pywebview.api.get_library_list({ force_refresh: isManual });
        app.modCache = mods;

        this.renderList(mods);

        requestAnimationFrame(() => {
            listContainer.classList.remove('fade-out');
        });

        const searchInput = document.querySelector('.search-input');
        if (searchInput) searchInput.value = '';
        this._libraryLoaded = true;
        this._libraryRefreshing = false;
    },

    renderList(modsToRender) {
        const listContainer = document.getElementById('lib-list');
        listContainer.innerHTML = '';
        this.bindModNoteTooltip();

        if (modsToRender.length === 0) {
            listContainer.innerHTML = `
                <div class="empty-state" style="grid-column: 1 / span 2; animation: cardEntrance 0.5s ease both;">
                    <div class="emoji">🔍</div>
                    <h3>没有找到相关语音包</h3>
                    <p>试试其他关键词，或导入新文件</p>
                </div>`;
            return;
        }

        modsToRender.forEach((mod, index) => {
            const card = this.createModCard(mod);
            // 卡片入场动画延迟：按索引递增并限制最大延迟
            const delay = Math.min(index * 0.05, 0.5);
            card.style.animationDelay = `${delay}s`;
            listContainer.appendChild(card);
        });
    },

    filterTimeout: null,
    filterLibrary(keyword) {
        if (!app.modCache) return;

        // 防抖处理，避免输入太快导致动画混乱
        if (this.filterTimeout) clearTimeout(this.filterTimeout);

        this.filterTimeout = setTimeout(async () => {
            const listContainer = document.getElementById('lib-list');
            const term = keyword.toLowerCase().trim();

            const filtered = app.modCache.filter(mod => {
                const title = (mod.title || "").toLowerCase();
                const author = (mod.author || "").toLowerCase();
                return title.includes(term) || author.includes(term);
            });

            // 先让旧列表淡出
            listContainer.classList.add('fade-out');
            await new Promise(r => setTimeout(r, 200));

            this.renderList(filtered);

            // 再让新列表淡入
            requestAnimationFrame(() => {
                listContainer.classList.remove('fade-out');
            });
        }, 150);
    },

    createModCard(mod) {
        const div = document.createElement('div');
        div.className = 'card mod-card';
        div.dataset.id = mod.id; // 添加 ID 标识，方便动画定位

        const imgUrl = mod.cover_url || '';
        let tagsHtml = '';

        // 标签映射优先使用 UI_CONFIG；当 UI_CONFIG 不存在时使用内置映射
        if (typeof UI_CONFIG !== 'undefined') {
            for (const [key, conf] of Object.entries(UI_CONFIG.tagMap)) {
                if (mod.capabilities[key]) {
                    tagsHtml += `<span class="tag ${conf.cls}">${conf.text}</span>`;
                }
            }
        } else {
            if (mod.capabilities.tank) tagsHtml += `<span class="tag tank">陆战</span>`;
            if (mod.capabilities.air) tagsHtml += `<span class="tag air">空战</span>`;
            if (mod.capabilities.naval) tagsHtml += `<span class="tag naval">海战</span>`;
            if (mod.capabilities.radio) tagsHtml += `<span class="tag radio">无线电/局势</span>`;
            if (mod.capabilities.missile) tagsHtml += `<span class="tag missile">导弹音效</span>`;
            if (mod.capabilities.music) tagsHtml += `<span class="tag music">音乐包</span>`;
            if (mod.capabilities.noise) tagsHtml += `<span class="tag noise">降噪包</span>`;
            if (mod.capabilities.pilot) tagsHtml += `<span class="tag pilot">飞行员语音</span>`;
        }

        let langList = [];
        if (mod.language && Array.isArray(mod.language) && mod.language.length > 0) {
            langList = mod.language;
        } else if (mod.language && typeof mod.language === 'string') {
            // 兼容如果是字符串的情况
            langList = [mod.language];
        } else {
            // 如果后端没返回，或者是旧数据
            if (mod.title.includes("Aimer") || mod.id === "Aimer") {
                langList = ["中", "美", "俄"];
            } else {
                langList = ["多语言"];
            }
        }

        const langHtml = langList.map(lang => {
            // 语言样式映射优先使用 UI_CONFIG.langMap
            let cls = "";
            if (typeof UI_CONFIG !== 'undefined' && UI_CONFIG.langMap[lang]) {
                cls = UI_CONFIG.langMap[lang];
            }
            return `<span class="lang-text ${cls}">${lang}</span>`;
        }).join('<span style="margin:0 2px">/</span>');

        const updateDate = mod.date || "未知日期";

        const clsVideo = mod.link_video ? 'video' : 'disabled';
        const clsWt = mod.link_wtlive ? 'wt' : 'disabled';
        const clsBili = mod.link_bilibili ? 'bili' : 'disabled';

        const actVideo = mod.link_video ? `window.open('${mod.link_video}')` : '';
        const actWt = mod.link_wtlive ? `window.open('${mod.link_wtlive}')` : '';
        const actBili = mod.link_bilibili ? `window.open('${mod.link_bilibili}')` : '';

        const noteText = mod.note || '暂无留言';

        // 判断该语音包是否为当前已生效项
        const isInstalled = app.installedModIds && app.installedModIds.includes(mod.id);

        // 根据状态决定按钮样式和图标
        // 已安装: active 样式, check 图标, title="当前已加载"
        // 未安装: 普通样式, play-circle 图标, title="加载此语音包"
        const loadBtnClass = isInstalled ? 'action-btn-load active' : 'action-btn-load';
        const loadBtnIcon = isInstalled ? 'ri-check-line' : 'ri-play-circle-line';
        const loadBtnTitle = isInstalled ? '当前已生效' : '加载此语音包';
        const loadBtnClick = `app.openInstallModal('${mod.id}')`;

        // 处理版本号显示，避免出现 vv2.53 的情况
        let displayVersion = mod.version || "1.0";
        if (displayVersion.toLowerCase().startsWith('v')) {
            displayVersion = displayVersion.substring(1);
        }

        div.innerHTML = `
            <div class="mod-img-area">
                <img src="${imgUrl}" class="mod-img" onerror="this.style.display='none'">
            </div>

            <div class="mod-info-area">
                <div class="mod-ver">v${displayVersion}</div>

                <div class="mod-title-row">
                    <div class="mod-title" title="${mod.title}">${mod.title}</div>
                </div>

                <div class="mod-author-row">
                    <i class="ri-user-3-line"></i> <span>${mod.author}</span>
                    <span style="margin: 0 5px; color:#ddd">|</span>
                    <i class="ri-hard-drive-2-line"></i> <span>${mod.size_str}</span>
                    <span style="margin: 0 5px; color:#ddd">|</span>
                    
                    <i class="ri-translate"></i> 
                    <span style="margin-left:2px">${langHtml}</span>
                </div>

                <div class="mod-tags">
                    ${tagsHtml}
                </div>
                
                <div style="font-size:11px; color:var(--text-log); opacity:0.6; margin-bottom:8px; display:flex; align-items:center; gap:4px;">
                    <i class="ri-time-line"></i> 更新于: ${updateDate}
                </div>

                <div class="mod-note">
                    <i class="ri-chat-1-line" style="vertical-align:middle; margin-right:4px; opacity:0.7"></i>
                    ${noteText}
                </div>
            </div>

            <button class="mod-copy-action" title="复制国籍文件">
                <i class="ri-file-copy-line"></i>
            </button>

            <div class="mod-actions-col">
                <div class="action-icon action-btn-del" onclick="app.deleteMod('${mod.id}')" title="删除语音包">
                    <i class="ri-delete-bin-line"></i>
                </div>

                <div style="flex:1"></div>

                <div class="action-icon ${clsVideo}" onclick="${actVideo}" title="观看介绍视频">
                    <i class="ri-play-circle-line"></i>
                </div>

                <div class="action-icon ${clsWt}" onclick="${actWt}" title="访问 WT Live 页面">
                    <i class="ri-global-line"></i>
                </div>

                <div class="action-icon ${clsBili}" onclick="${actBili}" title="访问 Bilibili">
                    <i class="ri-bilibili-line"></i>
                </div>

                <button class="${loadBtnClass}" onclick="${loadBtnClick}" title="${loadBtnTitle}">
                    <i class="${loadBtnIcon}" style="font-size: 24px;"></i>
                </button>
            </div>
        `;

        div.dataset.caps = JSON.stringify(mod.capabilities);
        const copyBtn = div.querySelector('.mod-copy-action');
        if (copyBtn) {
            copyBtn.dataset.modId = mod.id || '';
            copyBtn.dataset.modTitle = mod.title || '';
            copyBtn.onclick = () => {
                app.openCopyCountryModal(copyBtn.dataset.modId, copyBtn.dataset.modTitle);
            };
        }
        const noteEl = div.querySelector('.mod-note');
        if (noteEl) noteEl.dataset.note = noteText;
        return div;
    },

    bindModNoteTooltip() {
        const listContainer = document.getElementById('lib-list');
        if (!listContainer || this._modNoteTooltipBound) return;
        this._modNoteTooltipBound = true;

        listContainer.addEventListener('mouseover', (e) => {
            const noteEl = e.target.closest('.mod-note');
            if (!noteEl || !listContainer.contains(noteEl)) return;
            if (noteEl.contains(e.relatedTarget)) return;
            const text = noteEl.dataset.note || '';
            if (!text) return;
            app.showTooltip(noteEl, text);
            this._tooltipTarget = noteEl;
        });

        listContainer.addEventListener('mouseout', (e) => {
            const noteEl = e.target.closest('.mod-note');
            if (!noteEl || !listContainer.contains(noteEl)) return;
            if (noteEl.contains(e.relatedTarget)) return;
            if (this._tooltipTarget === noteEl) {
                app.hideTooltip();
                this._tooltipTarget = null;
            }
        });

        listContainer.addEventListener('click', async (e) => {
            if (e.button !== 0) return;
            const noteEl = e.target.closest('.mod-note');
            if (!noteEl || !listContainer.contains(noteEl)) return;
            const text = noteEl.dataset.note || '';
            if (!text) return;
            e.stopPropagation();
            await app.copyText(text);
        });
    },

    currentCopyModId: null,
    openCopyCountryModal(modId, modTitle) {
        this.currentCopyModId = modId || null;
        const modal = document.getElementById('modal-copy-country');
        const titleEl = document.getElementById('copy-country-title');
        const input = document.getElementById('copy-country-code');
        if (!modal || !input) return;
        if (titleEl) {
            titleEl.textContent = modTitle ? `复制国籍文件 - ${modTitle}` : '复制国籍文件';
        }
        input.value = '';
        modal.classList.remove('hiding');
        modal.classList.add('show');
    },
    async confirmCopyCountryFiles(mode) {
        const modal = document.getElementById('modal-copy-country');
        const input = document.getElementById('copy-country-code');
        const code = String(input?.value || '').trim().toLowerCase();
        if (!this.currentCopyModId) {
            this.showAlert('错误', '未选中语音包', 'error');
            return;
        }
        if (!code) {
            this.showAlert('错误', '请输入国家缩写', 'error');
            return;
        }
        if (!/^[a-z]{2,10}$/.test(code)) {
            this.showAlert('错误', '国家缩写仅支持 2-10 位英文字母', 'error');
            return;
        }
        const includeGround = mode ? mode === 'ground' : true;
        const includeRadio = mode ? mode === 'radio' : true;
        if (!includeGround && !includeRadio) {
            this.showAlert('错误', '至少勾选一种类型', 'error');
            return;
        }
        try {
            const res = await pywebview.api.copy_country_files(
                this.currentCopyModId,
                code,
                includeGround,
                includeRadio
            );
            if (res && res.success) {
                const created = (res.created || []).length;
                const skipped = (res.skipped || []).length;
                const missing = (res.missing || []).length;
                this.showAlert('成功', `已复制 ${created} 个文件${skipped ? `，跳过 ${skipped}` : ''}${missing ? `，缺失 ${missing}` : ''}`, 'success');
                if (modal) this.closeModal('modal-copy-country');
            } else {
                this.showAlert('失败', res?.msg || '复制失败', 'error');
            }
        } catch (e) {
            this.showAlert('错误', `调用失败: ${e}`, 'error');
        }
    },

    // --- 导入功能新逻辑 ---
    openImportModal() {
        const el = document.getElementById('modal-import');
        el.classList.remove('hiding');
        el.classList.add('show');
    },

    importSelectedZip() {
        app.closeModal('modal-import');
        // 调用后端选择文件接口
        pywebview.api.import_selected_zip();
    },

    importPendingZips() {
        app.closeModal('modal-import');
        // 调用后端批量导入接口 (原 import_zips)
        pywebview.api.import_zips();
    },

    openFolder(type) {
        if (type === 'game' || type === 'userskins') {
            if (!this.currentGamePath) {
                app.showAlert("提示", "请先在主页设置游戏路径！");
                this.switchTab('home');
                return;
            }
        }
        pywebview.api.open_folder(type);
    },

    openBiliSpace() {
        window.open('https://space.bilibili.com/1379084732?spm_id_from=333.1007.0.0');
    },

    openGitHubRepo() {
        window.open('https://github.com/AimerSo/Aimer_WT');
    },

    openExternal(url) {
        const u = String(url || '').trim();
        if (!u) return;
        try {
            window.open(u, '_blank', 'noopener');
        } catch (e) {
            console.error(e);
            this.showAlert('错误', '打开链接失败', 'error');
        }
    },

    openSupportMe() {
        const modal = document.getElementById('modal-support-me');
        if (!modal) return;
        modal.classList.remove('hiding');
        modal.classList.add('show');
    },

    openWorkshopChooser() {
        const el = document.getElementById('modal-workshop');
        if (!el) return;
        el.classList.remove('hiding');
        el.classList.add('show');
    },

    openWorkshop(site) {
        const key = String(site || '').toLowerCase();
        const url = key === 'liker'
            ? 'https://wtliker.com/'
            : 'https://live.warthunder.com/feed/all/';

        this.closeModal('modal-workshop');
        window.open(url);
    },

    async deleteMod(modId) {
        const yes = await app.confirm(
            '删除确认',
            `确定要永久删除语音包 <strong>[${modId}]</strong> 吗？<br>此操作不可撤销。`,
            true
        );
        if (yes) {
            // 找到对应的卡片并添加离场动画
            const card = document.querySelector(`.mod-card[data-id="${modId}"]`);
            if (card) {
                card.classList.add('leaving');
                // 等待动画结束 (300ms)
                await new Promise(r => setTimeout(r, 300));
            }

            const success = await pywebview.api.delete_mod(modId);
            if (success) this.refreshLibrary();
        }
    },

    // --- 安装模态框 ---
    // openInstallModal 的实现在文件末尾，使用 modCache

    // 安装/还原成功回调
    onInstallSuccess(modName) {
        console.log("Install Success:", modName);
        if (!this.installedModIds) {
            this.installedModIds = [];
        }
        if (!this.installedModIds.includes(modName)) {
            this.installedModIds.push(modName);
        }
        if (this.modCache) this.renderList(this.modCache);
    },

    onRestoreSuccess() {
        console.log("Restore Success");
        this.installedModIds = [];
        if (this.modCache) this.renderList(this.modCache);
    }
};

// 补充 modCache 逻辑
app.modCache = [];

// 真正的打开模态框
app.openInstallModal = async function (modId) {
    if (!app.currentGamePath) {
        app.showAlert("提示", "请先设置游戏路径！");
        app.switchTab('home');
        return;
    }
    app.currentModId = modId;
    const mod = app.modCache.find(m => m.id === modId);
    if (!mod) return;

    const modal = document.getElementById('modal-install');
    const container = document.getElementById('install-toggles');
    container.innerHTML = '';

    // 新逻辑：基于文件夹列表
    const folders = mod.folders || [];

    if (folders.length === 0) {
        container.innerHTML = '<div class="no-folders" style="padding:20px;text-align:center;color:#888;">⚠️ 未检测到有效语音包文件夹 (不含 .bank 文件)</div>';
    } else {
        folders.forEach(item => {
            // 兼容旧版字符串格式 (防止报错)
            let folderPath = "";
            let folderType = "folder";

            if (typeof item === 'string') {
                folderPath = item;
            } else {
                folderPath = item.path;
                folderType = item.type || "folder";
            }

            const div = document.createElement('div');
            // 默认全选
            div.className = 'toggle-btn available selected';
            div.dataset.key = folderPath;

            // 截断逻辑：超过4个字，第3个字后加...
            let displayName = folderPath;
            // 如果是 "根目录"，显示为 "根目录"
            if (folderPath === "根目录") {
                displayName = "根目录";
            } else {
                // 取最后一段路径名显示 (如果路径很长)
                const parts = folderPath.split(/[/\\]/);
                const name = parts[parts.length - 1];
                if (name.length > 4) {
                    displayName = name.substring(0, 3) + '...';
                } else {
                    displayName = name;
                }
            }

            // 根据类型选择图标
            let iconClass = "ri-folder-3-line";
            if (folderType === "ground") iconClass = "ri-car-line"; // 陆战
            else if (folderType === "radio") iconClass = "ri-radio-2-line"; // 无线电
            else if (folderType === "aircraft") iconClass = "ri-plane-line"; // 空战

            div.innerHTML = `<i class="${iconClass}"></i><div class="label">${displayName}</div>`;

            div.onclick = () => {
                div.classList.toggle('selected');
            };

            // Tooltip 交互
            div.onmouseenter = (e) => app.showTooltip(div, folderPath);
            div.onmouseleave = () => app.hideTooltip();

            container.appendChild(div);
        });
    }

    modal.classList.add('show');
};

document.getElementById('btn-confirm-install').onclick = async function () {
    const toggles = document.querySelectorAll('#install-toggles .toggle-btn.selected');
    const selection = Array.from(toggles).map(el => el.dataset.key);

    // 如果列表为空（说明可能是全量安装模式，或者用户没选）
    // 但如果有 toggle 存在却没选，那就是用户取消了所有
    const hasToggles = document.querySelectorAll('#install-toggles .toggle-btn').length > 0;

    if (hasToggles && selection.length === 0) {
        app.showAlert("提示", "请至少选择一个模块！");
        return;
    }

    // 安装前执行冲突检查
    const conflictBtn = document.getElementById('btn-confirm-install');
    const originalText = conflictBtn.innerHTML;
    conflictBtn.disabled = true;
    conflictBtn.innerHTML = '<i class="ri-loader-4-line ri-spin"></i> 检查中...';

    try {
        // 将数组参数序列化为 JSON 字符串传递给后端
        const conflicts = await pywebview.api.check_install_conflicts(app.currentModId, JSON.stringify(selection));

        if (conflicts && conflicts.length > 0) {
            // 构建冲突提示信息
            const conflictCount = conflicts.length;
            let msg = `检测到 <strong>${conflictCount}</strong> 个文件冲突，继续安装将覆盖现有文件。<br><br>`;
            msg += `<div style="max-height:100px;overflow-y:auto;background:rgba(0,0,0,0.05);padding:8px;border-radius:4px;font-size:12px;">`;

            // 只显示前 5 个
            conflicts.slice(0, 5).forEach(c => {
                msg += `<div style="margin-bottom:2px;">• ${c.file} <span style="color:#aaa;">(来自 ${c.existing_mod})</span></div>`;
            });

            if (conflictCount > 5) {
                msg += `<div>... 以及其他 ${conflictCount - 5} 个文件</div>`;
            }
            msg += `</div><br>是否继续安装？`;

            const proceed = await app.confirm('⚠️ 文件冲突警告', msg, true); // 使用危险样式提醒
            if (!proceed) {
                conflictBtn.disabled = false;
                conflictBtn.innerHTML = originalText;
                return;
            }
        }
    } catch (e) {
        console.error("Conflict check failed", e);
    }

    // 恢复按钮状态
    conflictBtn.disabled = false;
    conflictBtn.innerHTML = originalText;

    // 显示极简加载动画 (关闭模拟模式，等待后端真实进度)
    if (typeof MinimalistLoading !== 'undefined') {
        MinimalistLoading.show(false, "正在准备安装...");
    }

    // 将数组参数序列化为 JSON 字符串传递给后端
    pywebview.api.install_mod(app.currentModId, JSON.stringify(selection));
    app.closeModal('modal-install');
    app.switchTab('home'); // 跳转回主页看日志
};

app.restoreGame = async function () {
    const yes = await app.confirm(
        '确认还原',
        '确定要还原纯净模式吗？<br><br>' +
        '<strong>逻辑说明：</strong><br>' +
        '1. 将清空游戏目录 <code>sound/mod</code> 文件夹下的所有内容。<br>' +
        '2. 将在配置文件 <code>config.blk</code> 中设置 <code>enable_mod:b=no</code>。',
        true
    );
    if (yes) {
        // 显示加载组件，等待后端推送进度
        if (typeof MinimalistLoading !== 'undefined') {
            MinimalistLoading.show();
        }
        pywebview.api.restore_game();
        app.switchTab('home');
    }
};

// --- 免责声明逻辑 ---
app.checkDisclaimer = async function () {
    try {
        const result = await pywebview.api.check_first_run();
        // check_first_run 返回 { status: bool, version: str }
        // 如果 status 为 true，说明需要显示

        if (result && result.status) {
            // 保存版本号到临时变量，等用户同意后再写回
            app._pendingAgreementVer = result.version;

            const modal = document.getElementById('modal-disclaimer');
            modal.classList.add('show');

            // 倒计时逻辑
            const btn = document.getElementById('btn-disclaimer-agree');
            const hint = document.getElementById('disclaimer-timer-hint');
            let timeLeft = 5;

            btn.disabled = true;
            if (hint) hint.textContent = `请阅读协议 (${timeLeft}s)`;

            const timer = setInterval(() => {
                timeLeft--;
                if (timeLeft <= 0) {
                    clearInterval(timer);
                    btn.disabled = false;
                    if (hint) hint.textContent = "";
                } else {
                    if (hint) hint.textContent = `请阅读协议 (${timeLeft}s)`;
                }
            }, 1000);
        }
    } catch (e) {
        console.error("Disclaimer check failed", e);
    }
};

app.disclaimerAgree = async function () {
    if (!app._pendingAgreementVer) return;

    // 关闭弹窗
    const modal = document.getElementById('modal-disclaimer');
    modal.classList.remove('show');

    // 调用 API 保存状态
    await pywebview.api.agree_to_terms(app._pendingAgreementVer);
};

app.disclaimerReject = function () {
    // 拒绝则退出程序
    pywebview.api.close_window();
};

// --- Tooltip 智能定位 ---
app.showTooltip = function (el, text) {
    const tip = document.getElementById('tooltip');
    if (!tip) return;

    tip.textContent = text || '';
    tip.style.display = 'block';

    const rect = el.getBoundingClientRect();
    const tipRect = tip.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    const viewportWindow = window.innerWidth;

    let top = rect.bottom + 10;

    if (top + tipRect.height > viewportHeight) {
        top = rect.top - tipRect.height - 10;
    }
    // 防止顶部溢出
    if (top < 10) top = 10;

    let left = rect.left;

    if (left + tipRect.width > viewportWindow) {
        left = viewportWindow - tipRect.width - 20;
    }
    // 防止左侧溢出
    if (left < 10) left = 10;

    tip.style.top = top + 'px';
    tip.style.left = left + 'px';
};
app.hideTooltip = function () {
    const tip = document.getElementById('tooltip');
    if (!tip) return;
    tip.style.display = 'none';
};

// --- Shortcuts ---
app.handleShortcuts = function (e) {
    // 如果有模态框打开（比如首次运行协议），禁止常用快捷键
    const openModals = document.querySelectorAll('.modal-overlay.show');
    if (openModals.length > 0) return;

    if (e.ctrlKey) {
        switch (e.key) {
            case '1': this.switchTab('home'); break;
            case '2': this.switchTab('lib'); break;
            case '3': this.switchTab('camo'); break;
            case '4': this.switchTab('sight'); break;
            case '5': this.switchTab('settings'); break;
            case 't': case 'T': this.toggleTheme(); break;
            case 'p': case 'P': this.togglePin(); break;
            case 'r': case 'R': this.refreshLibrary(); break;
            case 'l': case 'L': this.clearLogs(); break;
        }
    }
};

// 启动 (稍作修改: init 里面调用 checkDisclaimer)
app.init = async function () { // 覆盖之前的 init 实现以插入 checkDisclaimer，或者修改之前的 init
    // 但由于之前的 init 已经被定义了（虽然是同一个文件里的对象方法，但为了确保正确插入）
    // 我们这里直接修改原有的 init 函数体比较好。由于工具限制，我们重写一下 init_app_state 之后的回调部分。
    // 其实更好的办法是在 pywebviewready 监听器里直接调用。

    // 复用之前的 init 逻辑，但这里为了方便，我们直接把之前的 init 逻辑 copy 过来并加上 disclaimer
    console.log("App initializing...");
    this.recoverToSafeState('init');
    this.initToasts();

    if (!this._safetyHandlersInstalled) {
        this._safetyHandlersInstalled = true;

        window.addEventListener('error', () => this.recoverToSafeState('error'));
        window.addEventListener('unhandledrejection', () => this.recoverToSafeState('unhandledrejection'));
        document.addEventListener('keydown', (e) => {
            if (e.key !== 'Escape') return;
            const openModal = document.querySelector('.modal-overlay.show');
            // 免责声明不允许 Esc 关闭
            if (openModal && openModal.id && openModal.id !== 'modal-disclaimer') {
                app.closeModal(openModal.id);
            }
        });
    }

    // 监听 pywebview 准备就绪
    window.addEventListener('pywebviewready', async () => {
        console.log("PyWebview ready!");

        this._setupModalDragLock();

        // 1. 优先检查免责声明
        await app.checkDisclaimer();

        // 2. 获取初始状态
        const state = await pywebview.api.init_app_state() || {
            game_path: "",
            path_valid: false,
            active_theme: "default.json",
            theme: "Light",
            installed_mods: [],
        };
        this.updatePathUI(state.game_path, state.path_valid);

        if (state.installed_mods && Array.isArray(state.installed_mods)) {
            this.installedModIds = state.installed_mods;
        } else {
            this.installedModIds = [];
        }

        if (state.installed_mods && Array.isArray(state.installed_mods)) {
            this.installedModIds = state.installed_mods;
        } else {
            this.installedModIds = [];
        }
        this.sightsPath = state.sights_path || null;
        this._sightsLoaded = false;
        this.loadSightsView();

        const themeBtn = document.getElementById('btn-theme');
        if (state.theme === 'Light') {
            document.documentElement.setAttribute('data-theme', 'light');
            themeBtn.innerHTML = '<i class="ri-moon-line"></i>';
        } else {
            document.documentElement.setAttribute('data-theme', 'dark');
            themeBtn.innerHTML = '<i class="ri-sun-line"></i>';
        }

        // 加载主题列表并应用上次的选择
        await this.loadThemeList();
        if (state.active_theme && state.active_theme !== 'default.json') {
            const select = document.getElementById('theme-select');
            if (select) select.value = state.active_theme;

            const themeData = await pywebview.api.load_theme_content(state.active_theme);
            if (themeData && (themeData.colors || themeData.light || themeData.dark)) {
                this.applyThemeData(themeData);
            }
        }

        // 绑定快捷键
        document.addEventListener('keydown', this.handleShortcuts.bind(this));

        // 初始刷新库
        this.refreshLibrary();

        // 设置页面防止拖拽干扰
        document.querySelectorAll('#page-settings .card').forEach(card => {
            card.addEventListener('mouseenter', () => {
                document.body.classList.add('drag-disabled');
            });
            card.addEventListener('mouseleave', () => {
                document.body.classList.remove('drag-disabled');
            });
        });
    });
};

app.init();
// 显式挂载到 window，供后端通过 evaluate_js 访问
window.app = app;

// ===========================
// 资源库 Master-Detail 导航
// ===========================

app.switchResourceView = function (target) {
    // 更新导航按钮状态
    document.querySelectorAll('.resource-nav-item').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.target === target);
    });

    // 切换视图
    document.querySelectorAll('.resource-view').forEach(view => {
        view.classList.toggle('active', view.id === `view-${target}`);
    });

    // 刷新对应内容
    if (target === 'skins') {
        if (!this._skinsLoaded) this.refreshSkins();
    } else if (target === 'sights') {
        if (!this._sightsLoaded) this.loadSightsView();
    }
};

// ===========================
// 炮镜管理功能
// ===========================

app.sightsPath = null;

app.loadSightsView = function () {
    const primaryBtn = document.getElementById('btn-sights-primary');
    const primaryText = primaryBtn ? primaryBtn.querySelector('span') : null;
    const primaryIcon = primaryBtn ? primaryBtn.querySelector('i') : null;
    const secondaryBtn = document.getElementById('btn-sights-secondary');
    const secondaryText = secondaryBtn ? secondaryBtn.querySelector('span') : null;

    if (this.sightsPath) {
        if (primaryBtn) primaryBtn.onclick = () => app.selectSightsPath();
        if (primaryText) primaryText.textContent = '更改炮镜路径';
        if (primaryIcon) primaryIcon.className = 'ri-folder-open-line';

        if (secondaryBtn) secondaryBtn.disabled = false;
        if (secondaryText) secondaryText.textContent = '打开 UserSights';

        setTimeout(() => {
            const camoPage = document.getElementById('page-camo');
            const sightsView = document.getElementById('view-sights');
            if (!camoPage || !sightsView) return;
            if (!camoPage.classList.contains('active')) return;
            if (!sightsView.classList.contains('active')) return;
            if (!this._sightsLoaded) this.refreshSights();
        }, 80);
        return;
    }

    this._sightsLoaded = false;
    if (primaryBtn) primaryBtn.onclick = () => app.selectSightsPath();
    if (primaryText) primaryText.textContent = '设置炮镜路径';
    if (primaryIcon) primaryIcon.className = 'ri-folder-open-line';

    if (secondaryBtn) secondaryBtn.disabled = true;
    if (secondaryText) secondaryText.textContent = '打开 UserSights';
};

app.selectSightsPath = async function () {
    if (!window.pywebview?.api?.select_sights_path) {
        this.showAlert('错误', '功能未就绪，请检查后端连接', 'error');
        return;
    }

    try {
        const result = await pywebview.api.select_sights_path();
        if (result && result.success) {
            this.sightsPath = result.path;
            this._sightsLoaded = false;
            this.loadSightsView();
            this.showAlert('成功', '炮镜路径设置成功！', 'success');
        }
    } catch (e) {
        console.error(e);
        this.showAlert('错误', '选择路径失败: ' + e.message, 'error');
    }
};

app.changeSightsPath = function () {
    this.sightsPath = null;
    this._sightsLoaded = false;
    this.loadSightsView();
};

app.openSightsFolder = async function () {
    if (!this.sightsPath) {
        this.showAlert('提示', '请先选择炮镜文件夹', 'warn');
        return;
    }

    try {
        await pywebview.api.open_sights_folder();
    } catch (e) {
        console.error(e);
    }
};

app.refreshSights = async function (opts) {
    if (!this.sightsPath || !window.pywebview?.api?.get_sights_list) return;

    const camoPage = document.getElementById('page-camo');
    const sightsView = document.getElementById('view-sights');
    if (!camoPage || !sightsView) return;
    if (!camoPage.classList.contains('active')) return;
    if (!sightsView.classList.contains('active')) return;

    const refreshBtn = document.getElementById('btn-refresh-sights');
    const isManual = !!(opts && opts.manual);
    const now = (window.performance && performance.now) ? performance.now() : Date.now();
    if (this._sightsRefreshing) return;
    if (!isManual && this._lastSightsRefreshAt && (now - this._lastSightsRefreshAt) < 800) return;
    this._lastSightsRefreshAt = now;
    this._sightsRefreshing = true;
    this._sightsRefreshSeq = (this._sightsRefreshSeq || 0) + 1;
    const seq = this._sightsRefreshSeq;

    const listEl = document.getElementById('sights-list');
    const countEl = document.getElementById('sights-count');

    try {
        if (refreshBtn) {
            refreshBtn.disabled = true;
            refreshBtn.classList.add('is-loading');
        }
        if (countEl) countEl.textContent = '刷新中...';
        await new Promise(requestAnimationFrame);

        const forceRefresh = !!(opts && opts.manual);
        const result = await pywebview.api.get_sights_list({ force_refresh: forceRefresh });
        if (seq !== this._sightsRefreshSeq) return;
        if (!camoPage.classList.contains('active')) return;
        if (!sightsView.classList.contains('active')) return;

        const items = result.items || [];

        countEl.textContent = `本地: ${items.length}`;

        if (items.length === 0) {
            this._sightsLoaded = true;
            listEl.innerHTML = `
                <div class="empty-state">
                    <i class="ri-crosshair-line"></i>
                    <h3>还没有炮镜</h3>
                    <p>请手动将炮镜文件放入 UserSights 文件夹</p>
                </div>
            `;
            return;
        }

        const placeholder = 'assets/card_image_small.png';
        listEl.innerHTML = items.map(item => {
            const cover = item.cover_url || placeholder;
            const isDefaultCover = !!item.cover_is_default;
            return `
                <div class="small-card">
                    <div class="small-card-img-wrapper" style="position:relative;">
                        <img class="small-card-img${isDefaultCover ? ' is-default-cover' : ''}" src="${cover}" alt="">
                        <div class="skin-edit-overlay">
                            <button class="btn-v2 icon-only small secondary skin-edit-btn"
                                    onclick="app.openEditSightModal('${app._escapeHtml(item.name)}', '${cover.replace(/'/g, "\\'")}')">
                                <i class="ri-edit-line"></i>
                            </button>
                        </div>
                    </div>
                    <div class="small-card-body">
                        <div class="small-card-title">${app._escapeHtml(item.name)}</div>
                        <div class="small-card-meta">
                            <span><i class="ri-file-list-3-line"></i> ${item.file_count} 文件</span>
                        </div>
                    </div>
                </div>
            `;
        }).join('');
        this._sightsLoaded = true;
    } catch (e) {
        console.error(e);
    } finally {
        if (seq === this._sightsRefreshSeq) this._sightsRefreshing = false;
        if (refreshBtn) {
            refreshBtn.disabled = false;
            refreshBtn.classList.remove('is-loading');
        }
    }
};
