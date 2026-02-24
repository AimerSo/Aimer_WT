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
    currentLaunchMode: "launcher",
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
    themeListData: [],

    async loadThemeList() {
        const dropdown = document.getElementById('theme-select-dropdown');
        const textEl = document.getElementById('theme-select-text');
        if (!dropdown) return;

        this.themeListData = [{ filename: 'default.json', name: '默认主题', version: '', author: 'System' }];

        try {
            const themes = await pywebview.api.get_theme_list();
            themes.forEach(t => {
                if (t.filename !== 'default.json') {
                    this.themeListData.push(t);
                }
            });
            this.renderThemeDropdown();
        } catch (e) {
            console.error("Failed to load themes", e);
        }
    },

    renderThemeDropdown() {
        const dropdown = document.getElementById('theme-select-dropdown');
        const textEl = document.getElementById('theme-select-text');
        if (!dropdown) return;

        dropdown.innerHTML = '';
        this.themeListData.forEach(theme => {
            const option = document.createElement('div');
            option.className = 'custom-select-option';
            option.dataset.value = theme.filename;
            option.textContent = theme.filename === 'default.json'
                ? '默认主题 (System Default)'
                : `${theme.name} (v${theme.version}) - by ${theme.author}`;
            option.onclick = () => this.selectTheme(theme.filename);
            dropdown.appendChild(option);
        });
    },

    toggleThemeDropdown() {
        const wrapper = document.getElementById('theme-select-wrapper');
        if (!wrapper) return;

        const isActive = wrapper.classList.contains('active');

        document.querySelectorAll('.custom-select-wrapper').forEach(el => {
            el.classList.remove('active');
        });

        if (!isActive) {
            wrapper.classList.add('active');
        }
    },

    selectTheme(filename) {
        const textEl = document.getElementById('theme-select-text');
        const theme = this.themeListData.find(t => t.filename === filename);
        if (textEl && theme) {
            textEl.textContent = filename === 'default.json'
                ? '默认主题 (System Default)'
                : `${theme.name} (v${theme.version}) - by ${theme.author}`;
        }

        document.querySelectorAll('#theme-select-dropdown .custom-select-option').forEach(opt => {
            opt.classList.toggle('selected', opt.dataset.value === filename);
        });

        document.getElementById('theme-select-wrapper')?.classList.remove('active');

        this.onThemeChange(filename);
    },

    async onThemeChange(filename) {
        const themeData = await pywebview.api.load_theme_content(filename);
        if (themeData && (themeData.colors || themeData.light || themeData.dark)) {
            this.applyThemeData(themeData);
            pywebview.api.save_theme_selection(filename);
        } else {
            app.showAlert("错误", "主题文件损坏或格式错误！");
            this.selectTheme("default.json");
            // 尝试载入预设主题
            const defaultTheme = await pywebview.api.load_theme_content("default.json");
            if (defaultTheme) {
                this.applyThemeData(defaultTheme);
            } else {
                this.resetTheme();
            }
        }
    },

    // 初始化 - 此函数会被下方的 app.init 复盖，保留此处仅为结构完整性
    // 实际初始化逻辑请见文件末尾的 app.init = async function() {...}
    async init() {
        // 此方法将被复盖，不需要实现
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
            // 改用异步接口，让扫描在后台进行，前端立即响应
            pywebview.api.refresh_skins_async({ force_refresh: forceRefresh });
        } catch (e) {
            console.error(e);
            this._skinsRefreshing = false;
        }
    },

    // 接收后端异步推送的基本列表数据
    onSkinsListReady(res) {
        const listEl = document.getElementById('skins-list');
        const countEl = document.getElementById('skins-count');
        const refreshBtn = document.getElementById('btn-refresh-skins');

        if (!listEl || !countEl || !res || !res.valid) {
            this._skinsRefreshing = false;
            if (refreshBtn) refreshBtn.classList.remove('is-loading');
            return;
        }

        const items = res.items || [];
        countEl.textContent = `本地: ${items.length}`;

        if (items.length === 0) {
            this._skinsLoaded = true;
            this._skinsRefreshing = false;
            if (refreshBtn) {
                refreshBtn.disabled = false;
                refreshBtn.classList.remove('is-loading');
            }
            listEl.innerHTML = `
                <div class="empty-state" style="grid-column: 1 / -1;">
                    <i class="ri-brush-3-line"></i>
                    <h3>还没有涂装</h3>
                    <p>拖入 ZIP 或点击“选择 ZIP 解压”，导入后会自动出现在这里</p>
                </div>
            `;
            return;
        }

        // --- 分片渲染逻辑 ---
        listEl.innerHTML = '';
        const CHUNK_SIZE = 24;
        let currentIndex = 0;
        const seq = this._skinsRefreshSeq;

        const renderChunk = () => {
            if (seq !== this._skinsRefreshSeq) return;

            const chunk = items.slice(currentIndex, currentIndex + CHUNK_SIZE);
            const placeholder = 'assets/card_image_small.png';

            const html = chunk.map(it => {
                // 初始显示占位图或已有封面
                const cover = it.cover_url || placeholder;
                const isDefaultCover = !!it.cover_is_default;
                const sizeText = app._formatBytes(it.size_bytes || 0);
                const safeName = app._escapeHtml(it.name);

                return `
                    <div class="small-card animate-in" title="${app._escapeHtml(it.path || '')}" data-skin-name="${safeName}">
                        <div class="small-card-img-wrapper" style="position:relative;">
                             <img class="small-card-img${isDefaultCover ? ' is-default-cover' : ''} skin-img-node" 
                                  src="${cover}" loading="lazy" alt="">
                             <div class="skin-edit-overlay">
                                 <button class="btn-v2 icon-only small secondary skin-edit-btn"
                                         onclick="app.openEditSkinModal('${safeName}', this.closest('.small-card').querySelector('.skin-img-node').src)">
                                     <i class="ri-edit-line"></i>
                                 </button>
                             </div>
                        </div>
                        <div class="small-card-body">
                            <div class="skin-card-footer">
                                <div class="skin-card-name" title="${safeName}">${safeName}</div>
                                <div class="skin-card-size">${sizeText}</div>
                            </div>
                        </div>
                    </div>
                `;
            }).join('');

            listEl.insertAdjacentHTML('beforeend', html);
            currentIndex += CHUNK_SIZE;

            if (currentIndex < items.length) {
                requestAnimationFrame(renderChunk);
            } else {
                this._skinsLoaded = true;
                this._skinsRefreshing = false;
                if (refreshBtn) {
                    refreshBtn.disabled = false;
                    refreshBtn.classList.remove('is-loading');
                }
            }
        };

        renderChunk();
    },

    // 接收后端异步推送的封面数据
    onSkinCoverReady(skinName, coverUrl) {
        const card = document.querySelector(`.small-card[data-skin-name="${CSS.escape(skinName)}"]`);
        if (card) {
            const img = card.querySelector('.skin-img-node');
            if (img && img.src.includes('card_image_small.png')) {
                img.src = coverUrl;
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

    openModal(modalId) {
        const el = document.getElementById(modalId);
        if (!el) return;
        if (el.classList.contains('show')) return;
        el.classList.remove('hiding');
        el.classList.add('show');
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

    openFeedbackModal() {
        const modal = document.getElementById('modal-feedback');
        if (!modal) return;
        modal.classList.remove('hiding');
        modal.classList.add('show');
        const contact = document.getElementById('feedback-contact');
        const content = document.getElementById('feedback-content');
        if (contact) contact.value = '';
        if (content) content.value = '';
        this.updateFeedbackCount();
    },

    updateFeedbackCount() {
        const contact = document.getElementById('feedback-contact');
        const content = document.getElementById('feedback-content');
        const contactCount = document.getElementById('feedback-contact-count');
        const contentCount = document.getElementById('feedback-content-count');
        if (contact && contactCount) {
            contactCount.textContent = `${contact.value.length}/40`;
        }
        if (content && contentCount) {
            contentCount.textContent = `${content.value.length}/200`;
        }
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

    _setupModalOverlayClose() {
        if (this._modalOverlayCloseBound) return;
        this._modalOverlayCloseBound = true;

        document.addEventListener('click', (e) => {
            const target = e.target;
            if (!(target instanceof Element)) return;
            if (!target.classList.contains('modal-overlay')) return;
            if (!target.classList.contains('show')) return;
            const modalId = target.id;
            if (!modalId) return;

            e.stopPropagation();

            if (modalId === 'modal-confirm' && typeof this._confirmCleanup === 'function') {
                try {
                    this._confirmCleanup(false);
                } catch (err) {
                    this.closeModal(modalId);
                }
                return;
            }

            if (modalId === 'modal-archive-password') {
                this.cancelArchivePassword();
                return;
            }

            if (modalId === 'modal-mod-preview' && typeof this.closeModPreview === 'function') {
                this.closeModPreview();
                return;
            }

            this.closeModal(modalId);
        }, true);
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
    showAlert(title, message, iconType = 'info', linkUrl = null) {
        const modal = document.getElementById('modal-alert');
        if (!modal) {
            console.error('modal-alert not found, falling back to native alert');
            alert(message);
            return;
        }

        const titleEl = document.getElementById('alert-title');
        const msgEl = document.getElementById('alert-message');
        const iconEl = document.getElementById('alert-icon');
        const linkBtn = document.getElementById('alert-link-btn');

        if (titleEl) titleEl.textContent = title || '提示';
        if (msgEl) msgEl.textContent = message || '';

        // 处理跳转链接按钮
        if (linkBtn) {
            if (linkUrl) {
                linkBtn.style.display = 'flex';
                linkBtn.dataset.url = linkUrl;
            } else {
                linkBtn.style.display = 'none';
                linkBtn.dataset.url = '';
            }
        }

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

    // 动态更新首页公告栏文字
    updateNoticeBar(contentHtml) {
        const container = document.querySelector('.notice-content');
        if (container && contentHtml) {
            container.innerHTML = contentHtml;
        }
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
        this.handleWindowClose();
    },

    // --- 路径搜索逻辑 ---
    async updatePathUI(path, valid) {
        const input = document.getElementById('input-game-path');
        const statusIcon = document.getElementById('status-icon');
        const statusText = document.getElementById('status-text');
        const gameStatusText = document.getElementById('game-status-text');
        const gameStatusIcon = document.getElementById('game-status-icon');

        input.value = path || "";
        this.currentGamePath = path;

        const modeText = this.currentLaunchMode === 'steam' ? '[Steam端启动]' : '[战雷客户端启动]';
        if (valid) {
            statusIcon.innerHTML = '<i class="ri-link"></i>';
            statusIcon.className = 'status-icon active';
            statusText.textContent = '连接正常';
            statusText.className = 'status-text success';
            if (gameStatusIcon) {
                gameStatusIcon.innerHTML = '<i class="ri-link"></i>';
                gameStatusIcon.className = 'game-status-icon active';
            }
            if (gameStatusText) {
                gameStatusText.innerHTML = `<span style="color: var(--status-success)">连接正常</span><span style="color: var(--text-sec)">：随时可以开始游戏 ${modeText}</span>`;
                gameStatusText.className = 'game-status-text ready';
            }

            try {
                if (window.pywebview && pywebview.api && pywebview.api.get_installed_mods) {
                    this.installedModIds = await pywebview.api.get_installed_mods() || [];
                }
            } catch (e) {
                console.error("Failed to update installed mods:", e);
                this.installedModIds = [];
            }
        } else if (!path) {
            statusIcon.innerHTML = '<i class="ri-wifi-off-line"></i>';
            statusIcon.className = 'status-icon';
            statusText.textContent = '未设置路径';
            statusText.className = 'status-text waiting';
            if (gameStatusIcon) {
                gameStatusIcon.innerHTML = '<i class="ri-wifi-off-line"></i>';
                gameStatusIcon.className = 'game-status-icon';
            }
            if (gameStatusText) {
                gameStatusText.textContent = '未就绪：请先选择路径';
                gameStatusText.className = 'game-status-text waiting';
            }
            this.installedModIds = [];
        } else {
            statusIcon.innerHTML = '<i class="ri-error-warning-line"></i>';
            statusIcon.className = 'status-icon';
            statusText.textContent = '路径无效';
            statusText.className = 'status-text error';
            if (gameStatusIcon) {
                gameStatusIcon.innerHTML = '<i class="ri-error-warning-line"></i>';
                gameStatusIcon.className = 'game-status-icon error';
            }
            if (gameStatusText) {
                gameStatusText.textContent = '未就绪：路径无效';
                gameStatusText.className = 'game-status-text error';
            }
            this.installedModIds = [];
        }

        if (this.modCache && this.modCache.length > 0) {
            this.renderList(this.modCache);
        }
    },

    startGame() {
        if (!this.currentGamePath) {
            this.showAlert('提示', '请先在主页设置游戏路径！');
            return;
        }
        if (!window.pywebview?.api?.start_game) {
            this.showAlert('错误', '后端连接未就绪，请稍候再试或重启程序', 'error');
            return;
        }
        pywebview.api.start_game().then(success => {
            if (success) {
                this.notifyToast('SUCCESS', '游戏启动指令已发送');
            }
        }).catch((e) => {
            const message = e && e.message ? e.message : String(e || '');
            this.showAlert('错误', `启动失败：${message}`, 'error');
        });
    },

    openLaunchSettings() {
        const modal = document.getElementById('modal-launch-settings');
        if (!modal) return;

        const launcherCard = document.getElementById('option-launch-launcher');
        const steamCard = document.getElementById('option-launch-steam');
        const setActive = (card, active) => {
            if (!card) return;
            card.classList.toggle('active', active);
            const check = card.querySelector('.option-card-check i');
            if (check) check.style.display = active ? 'block' : 'none';
        };

        const mode = this.currentLaunchMode || 'launcher';
        setActive(launcherCard, mode === 'launcher');
        setActive(steamCard, mode === 'steam');

        modal.classList.remove('hiding');
        modal.classList.add('show');
    },

    async saveLaunchSettings(mode) {
        if (!mode) return;
        this.currentLaunchMode = mode;

        const launcherCard = document.getElementById('option-launch-launcher');
        const steamCard = document.getElementById('option-launch-steam');
        const setActive = (card, active) => {
            if (!card) return;
            card.classList.toggle('active', active);
            const check = card.querySelector('.option-card-check i');
            if (check) check.style.display = active ? 'block' : 'none';
        };

        setActive(launcherCard, mode === 'launcher');
        setActive(steamCard, mode === 'steam');

        if (window.pywebview?.api?.set_launch_mode) {
            try {
                await pywebview.api.set_launch_mode(mode);
            } catch (e) {
                const message = e && e.message ? e.message : String(e || '');
                this.showAlert('错误', `保存启动设置失败：${message}`, 'error');
            }
        }
        this.closeModal('modal-launch-settings');
        const gameStatusText = document.getElementById('game-status-text');
        if (gameStatusText && gameStatusText.classList.contains('ready')) {
            const modeText = mode === 'steam' ? '[Steam端启动]' : '[战雷客户端启动]';
            gameStatusText.innerHTML = `<span style="color: var(--status-success)">连接正常</span><span style="color: var(--text-sec)">：随时可以开始游戏 ${modeText}</span>`;
        }
    },

    async browsePath() {
        if (!window.pywebview?.api?.browse_folder) {
            console.error('API not ready: browse_folder');
            this.showAlert('错误', '后端连接未就绪，请稍候再试或重启程序', 'error');
            return;
        }
        try {
            const res = await pywebview.api.browse_folder();
            if (res) {
                this.updatePathUI(res.path, res.valid);
            }
        } catch (e) {
            console.error('browsePath failed:', e);
            this.showAlert('错误', '选择路径失败: ' + e.message, 'error');
        }
    },

    async toggleTelemetry(checked) {
        const toggle = document.getElementById('telemetry-switch');
        // 先还原 UI 状态，等待确认
        toggle.checked = !checked;
        const action = checked ? "开启" : "关闭";
        const message = checked
            ? "开启遥测功能将允许软件发送匿名的使用统计与环境数据，帮助开发者改进软件体验。<br><br>确认要开启吗？"
            : "关闭遥测功能后，开发者将无法收到您的使用反馈与统计，这可能会影响版本迭代方向。<br><br>确认要关闭吗？";
        // 关闭时显示红色确认按钮，开启时显示普通按钮
        const isDanger = !checked;
        const yes = await app.confirm(`确认${action}遥测`, message, isDanger);
        if (yes) {
            toggle.checked = checked; // 用户确认，应用新状态
            await pywebview.api.set_telemetry_status(checked);
        }
    },

    async toggleAutostart(checked) {
        const toggle = document.getElementById('autostart-switch');
        if (!window.pywebview?.api?.set_autostart_status) {
            toggle.checked = !checked;
            this.showAlert('错误', '后端连接未就绪', 'error');
            return;
        }
        try {
            const success = await pywebview.api.set_autostart_status(checked);
            if (!success) {
                toggle.checked = !checked;
                this.showAlert('错误', '设置开机自启动失败，请检查权限', 'error');
            }
        } catch (e) {
            toggle.checked = !checked;
            console.error('toggleAutostart failed:', e);
            this.showAlert('错误', '设置失败: ' + e.message, 'error');
        }
    },

    async toggleTrayMode(checked) {
        const toggle = document.getElementById('tray-mode-switch');
        if (!window.pywebview?.api?.set_tray_mode_status) {
            toggle.checked = !checked;
            this.showAlert('错误', '后端连接未就绪', 'error');
            return;
        }
        try {
            await pywebview.api.set_tray_mode_status(checked);
            // 更新本地状态
            this._trayMode = checked;
        } catch (e) {
            toggle.checked = !checked;
            console.error('toggleTrayMode failed:', e);
            this.showAlert('错误', '设置失败: ' + e.message, 'error');
        }
    },

    async toggleCloseConfirm(checked) {
        const toggle = document.getElementById('close-confirm-switch');
        if (!window.pywebview?.api?.set_close_confirm_status) {
            toggle.checked = !checked;
            this.showAlert('错误', '后端连接未就绪', 'error');
            return;
        }
        try {
            await pywebview.api.set_close_confirm_status(checked);
            // 更新本地状态
            this._closeConfirm = checked;
        } catch (e) {
            toggle.checked = !checked;
            console.error('toggleCloseConfirm failed:', e);
            this.showAlert('错误', '设置失败: ' + e.message, 'error');
        }
    },

    /**
     * 处理窗口关闭事件
     * 根据配置决定是直接关闭、最小化到托盘，还是显示确认弹窗
     */
    handleWindowClose() {
        // 如果托盘模式已开启，直接最小化到托盘
        if (this._trayMode) {
            this.minimizeToTray();
            return;
        }

        // 如果关闭确认已禁用，直接退出
        if (!this._closeConfirm) {
            this.exitApp();
            return;
        }

        // 显示关闭确认弹窗
        this.showCloseConfirmModal();
    },

    /**
     * 显示关闭确认弹窗
     */
    showCloseConfirmModal() {
        // 重置复选框
        const rememberCheckbox = document.getElementById('close-confirm-remember');
        if (rememberCheckbox) {
            rememberCheckbox.checked = false;
        }
        this.openModal('modal-close-confirm');
    },

    /**
     * 处理关闭确认弹窗的按钮点击
     * @param {string} action - 'cancel' | 'tray' | 'exit'
     */
    async handleCloseAction(action) {
        if (action === 'cancel') {
            this.closeModal('modal-close-confirm');
            return;
        }

        // 检查是否勾选了"不再提示"
        const rememberCheckbox = document.getElementById('close-confirm-remember');
        const remember = rememberCheckbox && rememberCheckbox.checked;

        if (remember) {
            // 用户选择了记住选择
            if (action === 'tray') {
                // 记住选择：开启托盘模式，关闭确认提示
                await this.toggleTrayMode(true);
                await this.toggleCloseConfirm(false);
                // 更新UI开关状态
                const traySwitch = document.getElementById('tray-mode-switch');
                const confirmSwitch = document.getElementById('close-confirm-switch');
                if (traySwitch) traySwitch.checked = true;
                if (confirmSwitch) confirmSwitch.checked = false;
            } else if (action === 'exit') {
                // 记住选择：关闭托盘模式，关闭确认提示
                await this.toggleTrayMode(false);
                await this.toggleCloseConfirm(false);
                // 更新UI开关状态
                const traySwitch = document.getElementById('tray-mode-switch');
                const confirmSwitch = document.getElementById('close-confirm-switch');
                if (traySwitch) traySwitch.checked = false;
                if (confirmSwitch) confirmSwitch.checked = false;
            }
        }

        this.closeModal('modal-close-confirm');

        if (action === 'tray') {
            this.minimizeToTray();
        } else if (action === 'exit') {
            this.exitApp();
        }
    },

    /**
     * 最小化到托盘
     */
    minimizeToTray() {
        if (window.pywebview?.api?.minimize_to_tray) {
            pywebview.api.minimize_to_tray();
        } else {
            // 降级处理：直接隐藏窗口
            console.log('[App] 最小化到托盘（降级处理）');
        }
    },

    /**
     * 退出程序
     */
    exitApp() {
        console.log('[App] 用户选择退出程序');
        if (window.pywebview?.api?.exit_app) {
            pywebview.api.exit_app();
        } else {
            // 降级处理
            window.close();
        }
    },

    autoSearch() {
        if (!window.pywebview?.api?.start_auto_search) {
            console.error('API not ready: start_auto_search');
            this.showAlert('错误', '后端连接未就绪，请稍候再试或重启程序', 'error');
            return;
        }
        document.getElementById('btn-auto-search').disabled = true;
        document.getElementById('status-text').textContent = '搜索中...';
        document.getElementById('status-icon').innerHTML = '<i class="ri-loader-4-line"></i>';
        const gameStatusIcon = document.getElementById('game-status-icon');
        if (gameStatusIcon) {
            gameStatusIcon.innerHTML = '<i class="ri-loader-4-line"></i>';
            gameStatusIcon.className = 'game-status-icon searching';
        }
        try {
            pywebview.api.start_auto_search();
        } catch (e) {
            console.error('autoSearch failed:', e);
            document.getElementById('btn-auto-search').disabled = false;
            this.showAlert('错误', '启动搜索失败: ' + e.message, 'error');
        }
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
        if (window.pywebview?.api?.clear_logs) {
            pywebview.api.clear_logs();
        }
    },

    // --- 语音包库逻辑 ---
    async refreshLibrary(opts) {
        const listContainer = document.getElementById('lib-list');
        if (!listContainer) return;
        if (this._libraryRefreshing) return;
        const isManual = !!(opts && opts.manual);
        if (!isManual && this._libraryLoaded) return;

        // 检查 API 是否就绪
        if (!window.pywebview?.api?.get_library_list) {
            console.warn('refreshLibrary: API not ready, will retry later');
            // 短暂延迟后重试
            setTimeout(() => {
                this._libraryRefreshing = false;
                this.refreshLibrary(opts);
            }, 1000);
            return;
        }

        this._libraryRefreshing = true;

        listContainer.classList.add('fade-out');
        await new Promise(r => setTimeout(r, 200));

        try {
            const mods = await pywebview.api.get_library_list({ force_refresh: isManual });
            app.modCache = mods;
            this.renderList(mods);
        } catch (e) {
            console.error('refreshLibrary failed:', e);
            listContainer.innerHTML = `
                <div class="empty-state">
                    <i class="ri-error-warning-line"></i>
                    <h3>加载失败</h3>
                    <p>请检查后端连接状态: ${e.message}</p>
                </div>
            `;
        } finally {
            requestAnimationFrame(() => {
                listContainer.classList.remove('fade-out');
            });

            const searchInput = document.querySelector('.search-input');
            if (searchInput) searchInput.value = '';
            this._libraryLoaded = true;
            this._libraryRefreshing = false;
        }
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

        let fullLangList = [];
        if (mod.language && Array.isArray(mod.language) && mod.language.length > 0) {
            fullLangList = mod.language;
        } else if (mod.language && typeof mod.language === 'string') {
            fullLangList = [mod.language];
        } else {
            fullLangList = (mod.title.includes("Aimer") || mod.id === "Aimer") ? ["中", "美", "俄"] : ["未识别"];
        }

        // 过滤出主要展示语言 (中/美/英)
        let displayLangs = fullLangList.filter(lang => ["中", "美", "英"].includes(lang));
        if (displayLangs.length === 0) {
            displayLangs = fullLangList.includes("未识别") ? ["未识别"] : ["其他"];
        }

        const langHtml = displayLangs.map(lang => {
            let cls = "";
            if (typeof UI_CONFIG !== 'undefined' && UI_CONFIG.langMap[lang]) {
                cls = UI_CONFIG.langMap[lang];
            }
            return `<span class="lang-text ${cls}">${lang}</span>`;
        }).join('<span style="margin:0 2px">/</span>');

        // 拼接悬停显示的完整列表
        const langTooltip = fullLangList.length > 0 ? `支持语言: ${fullLangList.join(', ')}` : '未识别语言';

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
                    
                    <div class="mod-lang-wrap" title="${langTooltip}" style="display:inline-flex; align-items:center; cursor:help;">
                        <i class="ri-translate"></i> 
                        <span style="margin-left:2px">${langHtml || '未识别'}</span>
                    </div>
                </div>

                <div class="mod-meta-row" style="margin-top: 6px; display: flex; flex-wrap: wrap; gap: 4px; min-height: 20px;">
                    ${mod.files && mod.files.length > 0 ?
                mod.files.map(f => `<span class="tag ${f.cls || 'default'}" title="包含模块: ${f.type}">${f.type}</span>`).join('')
                : tagsHtml
            }
                </div>
                
                <div style="font-size:11px; color:var(--text-log); opacity:0.6; margin: 6px 0 8px; display:flex; align-items:center; gap:4px;">
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
        if (type === 'game' || type === 'userskins' || type === 'user_missions') {
            if (!this.currentGamePath) {
                app.showAlert("提示", "请先在主页设置游戏路径！");
                this.switchTab('home');
                return;
            }
        }
        pywebview.api.open_folder(type);
    },

    refreshHangar(opts) {
        const listEl = document.getElementById('hangar-list');
        const countEl = document.getElementById('hangar-count');
        if (!listEl || !countEl) return;

        const refreshBtn = document.getElementById('btn-refresh-hangar');
        if (this._hangarRefreshing) return;
        this._hangarRefreshing = true;
        if (refreshBtn) {
            refreshBtn.disabled = true;
            refreshBtn.classList.add('is-loading');
        }
        countEl.textContent = '刷新中...';

        setTimeout(() => {
            this._hangarRefreshing = false;
            if (refreshBtn) {
                refreshBtn.disabled = false;
                refreshBtn.classList.remove('is-loading');
            }
            countEl.textContent = '本地: 0';
            listEl.innerHTML = `
                <div class="empty-state" style="grid-column: 1 / -1;">
                    <i class="ri-plane-line"></i>
                    <h3>还没有机库配置</h3>
                    <p>点击左侧"打开机库"按钮，导入机库配置文件</p>
                </div>
            `;
        }, 300);
    },

    refreshModels(opts) {
        const listEl = document.getElementById('models-list');
        const countEl = document.getElementById('models-count');
        if (!listEl || !countEl) return;

        const refreshBtn = document.getElementById('btn-refresh-models');
        if (this._modelsRefreshing) return;
        this._modelsRefreshing = true;
        if (refreshBtn) {
            refreshBtn.disabled = true;
            refreshBtn.classList.add('is-loading');
        }
        countEl.textContent = '刷新中...';

        setTimeout(() => {
            this._modelsRefreshing = false;
            if (refreshBtn) {
                refreshBtn.disabled = false;
                refreshBtn.classList.remove('is-loading');
            }
            countEl.textContent = '本地: 0';
            listEl.innerHTML = `
                <div class="empty-state" style="grid-column: 1 / -1;">
                    <i class="ri-box-3-line"></i>
                    <h3>还没有模型</h3>
                    <p>点击左侧"打开模型库"按钮，导入模型文件</p>
                </div>
            `;
        }, 300);
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

        // 优先使用后端 API 以在外部浏览器打开，并处理协议头
        if (window.pywebview?.api?.open_external) {
            pywebview.api.open_external(u);
        } else {
            // 降级方案
            let finalUrl = u;
            if (!finalUrl.match(/^[a-zA-Z]+:\/\//)) {
                finalUrl = 'https://' + finalUrl;
            }
            window.open(finalUrl, '_blank', 'noopener');
        }
    },

    openSupportMe() {
        const modal = document.getElementById('modal-support-me');
        if (!modal) return;
        modal.classList.remove('hiding');
        modal.classList.add('show');
    },

    openImagePreview(src, title) {
        const modal = document.getElementById('modal-image-preview');
        const img = document.getElementById('image-preview-img');
        const titleEl = document.getElementById('image-preview-title');
        if (!modal || !img) return;
        
        img.src = src;
        if (titleEl) titleEl.textContent = title || '图片预览';
        
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

    const fileGroups = mod.files || [];

    if (fileGroups.length === 0) {
        container.innerHTML = '<div class="no-folders" style="padding:20px;text-align:center;color:#888;">⚠️ 未检测到有效语音文件</div>';
    } else {
        fileGroups.forEach(group => {
            const div = document.createElement('div');
            // 默认全选
            div.className = 'toggle-btn available selected';
            div.dataset.key = group.code; // 使用 code 作为标识
            div.dataset.files = JSON.stringify(group.files); // 存储文件列表

            // 显示名称和文件数量
            const displayName = group.type;
            const fileCount = group.count;

            // 根据类型选择图标
            let iconClass = "ri-file-music-line"; // 默认音频图标

            if (group.code.includes('ground') || group.code.includes('tank')) {
                iconClass = "ri-car-line";
            }
            // 无线电/通用语音
            else if (group.code.includes('common') || group.code.includes('dialogs_chat')) {
                iconClass = "ri-radio-2-line";
            }
            // 空战相关
            else if (group.code.includes('aircraft')) {
                iconClass = "ri-plane-line";
            }
            // 海战相关
            else if (group.code.includes('ships') || group.code.includes('naval')) {
                iconClass = "ri-ship-line";
            }
            // 步兵相关
            else if (group.code.includes('infantry')) {
                iconClass = "ri-user-line";
            }
            // 降噪包
            else if (group.code.includes('masterbank')) {
                iconClass = "ri-volume-mute-line";
            }
            div.innerHTML = `<i class="${iconClass}"></i><div class="label">${displayName} <span style="opacity:0.6;font-size:11px;">(${fileCount})</span></div>`;


            div.onclick = () => {
                div.classList.toggle('selected');
            };

            // Tooltip 交互
            const tooltipText = `${displayName}\n包含 ${fileCount} 个文件`;
            div.onmouseenter = (e) => app.showTooltip(div, tooltipText);
            div.onmouseleave = () => app.hideTooltip();

            container.appendChild(div);
        });
    }

    modal.classList.add('show');
};

document.getElementById('btn-confirm-install').onclick = async function () {
    const toggles = document.querySelectorAll('#install-toggles .toggle-btn.selected');

    // 收集所有选中类型的文件列表
    let allFiles = [];
    toggles.forEach(el => {
        try {
            const files = JSON.parse(el.dataset.files || '[]');
            allFiles = allFiles.concat(files);
        } catch (e) {
            console.error('解析文件列表失败:', e);
        }
    });

    // 如果列表为空（说明可能是全量安装模式，或者用户没选）
    // 但如果有 toggle 存在却没选，那就是用户取消了所有
    const hasToggles = document.querySelectorAll('#install-toggles .toggle-btn').length > 0;

    if (hasToggles && allFiles.length === 0) {
        app.showAlert("提示", "请至少选择一个模块！");
        return;
    }

    // 安装前执行冲突检查
    const conflictBtn = document.getElementById('btn-confirm-install');
    const originalText = conflictBtn.innerHTML;
    conflictBtn.disabled = true;
    conflictBtn.innerHTML = '<i class="ri-loader-4-line ri-spin"></i> 检查中...';

    try {
        // 将文件列表序列化为 JSON 字符串传递给后端
        const conflicts = await pywebview.api.check_install_conflicts(app.currentModId, JSON.stringify(allFiles));

        if (conflicts && conflicts.length > 0) {
            // 构建冲突提示信息
            const conflictCount = conflicts.length;
            let msg = `检测到 <strong>${conflictCount}</strong> 个文件冲突，继续安装将复盖现有文件。<br><br>`;
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

    // 将文件列表序列化为 JSON 字符串传递给后端
    pywebview.api.install_mod(app.currentModId, JSON.stringify(allFiles));
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
app.init = async function () {
    // 防止重複初始化
    if (this._initStarted) {
        console.log("App init already started, skipping...");
        return;
    }
    this._initStarted = true;

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

    const feedbackContact = document.getElementById('feedback-contact');
    const feedbackContent = document.getElementById('feedback-content');
    if (feedbackContact) {
        feedbackContact.addEventListener('input', () => this.updateFeedbackCount());
    }
    if (feedbackContent) {
        feedbackContent.addEventListener('input', () => this.updateFeedbackCount());
    }

    // 核心初始化逻辑，抽取为独立函数以便重用
    const doInit = async () => {
        // 防止重複执行核心初始化
        if (this._coreInitDone) {
            console.log("Core init already done, skipping...");
            return;
        }
        this._coreInitDone = true;
        console.log("PyWebview ready, starting core init...");

        this._setupModalDragLock();
        this._setupModalOverlayClose();

        // 1. 优先检查免责声明
        await app.checkDisclaimer();

        // 1.2 全局拖放初始化 (暂时禁用)
        // TODO 需要优化，拖放压缩包时大概率卡死
        // if (app.setupGlobalDragDrop) app.setupGlobalDragDrop();


        // 2. 获取初始状态
        const state = await pywebview.api.init_app_state() || {
            game_path: "",
            path_valid: false,
            active_theme: "default.json",
            theme: "Light",
            installed_mods: [],
        };
        this.currentLaunchMode = state.launch_mode || 'launcher';
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
        const activeTheme = state.active_theme || 'default.json';
        this.selectTheme(activeTheme);

        // 加载主题内容（包括 default.json）
        const themeData = await pywebview.api.load_theme_content(activeTheme);
        if (themeData && (themeData.colors || themeData.light || themeData.dark)) {
            this.applyThemeData(themeData);
        }

        // 加载语音包库路径信息（设置页显示用）
        try {
            await this.loadLibraryPathInfo();
        } catch (e) {
            console.error('loadLibraryPathInfo failed:', e);
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

        const telSwitch = document.getElementById('telemetry-switch');
        if (telSwitch) {
            telSwitch.checked = !!state.telemetry_enabled;
        }

        // 设置开机自启动开关状态
        const autostartSwitch = document.getElementById('autostart-switch');
        if (autostartSwitch) {
            autostartSwitch.checked = !!state.autostart_enabled;
        }

        // 设置托盘模式开关状态
        const trayModeSwitch = document.getElementById('tray-mode-switch');
        if (trayModeSwitch) {
            trayModeSwitch.checked = !!state.tray_mode;
        }

        // 设置关闭确认开关状态
        const closeConfirmSwitch = document.getElementById('close-confirm-switch');
        if (closeConfirmSwitch) {
            closeConfirmSwitch.checked = state.close_confirm !== false; // 默认开启
        }

        // 保存状态到本地变量供关闭逻辑使用
        this._trayMode = !!state.tray_mode;
        this._closeConfirm = state.close_confirm !== false; // 默认开启
    };

    // 防止重複註册 pywebviewready 监听器
    if (!this._pywebviewReadyListenerAdded) {
        this._pywebviewReadyListenerAdded = true;
        window.addEventListener('pywebviewready', doInit);
    }

    // 备用机制：如果 pywebview 已经就绪但事件没有触发（例如快取问题）
    // 则在短暂延迟后手动检查并初始化
    setTimeout(() => {
        if (window.pywebview && window.pywebview.api && !this._coreInitDone) {
            console.log("PyWebview API detected but event not fired, triggering manual init...");
            doInit();
        }
    }, 500);

    // 额外的备用机制：更长的超时确保初始化
    setTimeout(() => {
        if (window.pywebview && window.pywebview.api && !this._coreInitDone) {
            console.log("PyWebview API detected (late check), triggering manual init...");
            doInit();
        } else if (!this._coreInitDone) {
            console.warn("PyWebview API still not available after timeout, UI may not be fully functional.");
        }
    }, 2000);
};

app.init();
// 显式挂载到 window，供后端通过 evaluate_js 访问
window.app = app;

// ===========================
// 资源库 Master-Detail 导航
// ===========================

// ===========================
// 资源页面注册系统
// ===========================
app.resourcePages = {};
app.currentResourcePage = null;

/**
 * 注册资源页面
 * @param {string} name - 页面标识名
 * @param {Object} pageModule - 页面对象，需包含 init/show/hide/destroy 方法
 */
app.registerResourcePage = function (name, pageModule) {
    this.resourcePages[name] = pageModule;
    console.log(`[App] 注册资源页面: ${name}`);
};

app.switchResourceView = function (target) {
    // 更新导航按钮状态
    document.querySelectorAll('.resource-nav-item').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.target === target);
    });

    // 检查是否是新模块系统注册的页面
    const registeredPage = this.resourcePages[target];
    if (registeredPage) {
        // 隐藏当前页面
        if (this.currentResourcePage && this.currentResourcePage !== registeredPage) {
            if (this.currentResourcePage.hide) {
                this.currentResourcePage.hide();
            }
            // 隐藏所有原生视图
            document.querySelectorAll('.resource-view').forEach(view => {
                view.classList.remove('active');
            });
        }

        // 初始化并显示新页面（如果未初始化）
        if (!registeredPage._initialized) {
            registeredPage.init();
            registeredPage._initialized = true;
        }
        registeredPage.show();
        this.currentResourcePage = registeredPage;
        return;
    }

    // 原有逻辑：隐藏当前注册的页面（如果有）
    if (this.currentResourcePage) {
        if (this.currentResourcePage.hide) {
            this.currentResourcePage.hide();
        }
        this.currentResourcePage = null;
    }

    // 切换原生视图
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
app._sightsUidList = [];

app.loadSightsView = function () {
    const primaryBtn = document.getElementById('btn-sights-primary');
    const primaryText = primaryBtn ? primaryBtn.querySelector('span') : null;
    const primaryIcon = primaryBtn ? primaryBtn.querySelector('i') : null;
    const secondaryBtn = document.getElementById('btn-sights-secondary');
    const secondaryText = secondaryBtn ? secondaryBtn.querySelector('span') : null;

    // 自动搜索 UID 列表
    this.refreshSightsUidList();

    if (this.sightsPath) {
        if (primaryBtn) primaryBtn.onclick = () => app.selectSightsPath();
        if (primaryText) primaryText.textContent = '手动选择路径';
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
    if (primaryText) primaryText.textContent = '手动选择路径';
    if (primaryIcon) primaryIcon.className = 'ri-folder-open-line';

    if (secondaryBtn) secondaryBtn.disabled = true;
    if (secondaryText) secondaryText.textContent = '打开 UserSights';
};

// 刷新 UID 列表
app.refreshSightsUidList = async function () {
    const wrapper = document.getElementById('sights-uid-select-wrapper');
    if (!wrapper) return;

    if (!window.pywebview?.api?.discover_usersights_paths) {
        if (this.sightsUidDropdown) {
            this.sightsUidDropdown.setOptions([{ value: '', label: '-- API 未就绪 --' }]);
        }
        return;
    }

    try {
        // 初始化或更新下拉菜单
        if (!this.sightsUidDropdown) {
            this.sightsUidDropdown = new AppDropdownMenu({
                id: 'sights-uid-select',
                containerId: 'sights-uid-select-wrapper',
                placeholder: '-- 搜索中... --',
                options: [{ value: '', label: '-- 搜索中... --' }],
                size: 'sm',
                onChange: (value) => this.onSightsUidChange(value)
            });
        } else {
            this.sightsUidDropdown.setOptions([{ value: '', label: '-- 搜索中... --' }]);
        }

        const paths = await pywebview.api.discover_usersights_paths();
        this._sightsUidList = paths || [];

        if (this._sightsUidList.length === 0) {
            this.sightsUidDropdown.setOptions([{ value: '', label: '-- 未找到 UID --' }]);
            return;
        }

        // 构建选项
        const options = [{ value: '', label: '-- 选择 UID --' }];
        let currentValue = '';
        for (const item of this._sightsUidList) {
            const status = item.exists ? '✓' : '(新建)';
            const label = `${item.uid} ${status}`;
            options.push({ value: item.uid, label: label });
            if (this.sightsPath && this.sightsPath.includes(item.uid)) {
                currentValue = item.uid;
            }
        }

        this.sightsUidDropdown.setOptions(options);
        if (currentValue) {
            this.sightsUidDropdown.setValue(currentValue, false);
        }
    } catch (e) {
        console.error('刷新 UID 列表失败:', e);
        if (this.sightsUidDropdown) {
            this.sightsUidDropdown.setOptions([{ value: '', label: '-- 搜索失败 --' }]);
        }
    }
};

// UID 选择变更事件
app.onSightsUidChange = async function (uid) {
    if (!uid) return;

    if (!window.pywebview?.api?.select_uid_sights_path) {
        this.showAlert('错误', '功能未就绪，请检查后端连接', 'error');
        return;
    }

    try {
        const result = await pywebview.api.select_uid_sights_path(uid);
        if (result && result.success) {
            this.sightsPath = result.path;
            this._sightsLoaded = false;
            this.loadSightsView();
            this.showInfoToast('已设置', `UID ${uid} 的炮镜路径已设置`);
        } else {
            this.showAlert('错误', result?.error || '设置失败', 'error');
        }
    } catch (e) {
        console.error(e);
        this.showAlert('错误', '选择 UID 失败: ' + e.message, 'error');
    }
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

// --- 语音包库路径管理 ---
app.loadLibraryPathInfo = async function () {
    const pendingInput = document.getElementById('pending-dir-input');
    const libraryInput = document.getElementById('library-dir-input');

    // 检查 API 是否可用
    if (!window.pywebview || !window.pywebview.api || typeof window.pywebview.api.get_library_path_info !== 'function') {
        console.warn('loadLibraryPathInfo: API not ready');
        if (pendingInput) pendingInput.placeholder = '等待后端连接...';
        if (libraryInput) libraryInput.placeholder = '等待后端连接...';
        return;
    }

    try {
        console.log('loadLibraryPathInfo: calling API...');
        const info = await pywebview.api.get_library_path_info();
        console.log('loadLibraryPathInfo: got info', info);

        if (pendingInput && info) {
            if (info.custom_pending_dir) {
                pendingInput.value = info.custom_pending_dir;
                pendingInput.title = info.custom_pending_dir;
            } else {
                pendingInput.value = '';
                pendingInput.placeholder = info.default_pending_dir || '使用默认路径';
                pendingInput.title = info.default_pending_dir || '';
            }
        }
        if (libraryInput && info) {
            if (info.custom_library_dir) {
                libraryInput.value = info.custom_library_dir;
                libraryInput.title = info.custom_library_dir;
            } else {
                libraryInput.value = '';
                libraryInput.placeholder = info.default_library_dir || '使用默认路径';
                libraryInput.title = info.default_library_dir || '';
            }
        }
    } catch (e) {
        console.error('加载语音包库路径信息失败:', e);
        if (pendingInput) pendingInput.placeholder = '加载失败';
        if (libraryInput) libraryInput.placeholder = '加载失败';
    }
};

app.browsePendingDir = async function () {
    if (!window.pywebview?.api?.select_pending_dir) {
        this.showAlert('错误', '功能未就绪，请检查后端连接', 'error');
        return;
    }

    try {
        const result = await pywebview.api.select_pending_dir();
        if (result && result.success && result.path) {
            const input = document.getElementById('pending-dir-input');
            if (input) {
                input.value = result.path;
                input.title = result.path;
            }
            await this.saveLibraryPaths();
        }
    } catch (e) {
        console.error(e);
        this.showAlert('错误', '选择路径失败: ' + e.message, 'error');
    }
};

app.browseLibraryDir = async function () {
    if (!window.pywebview?.api?.select_library_dir) {
        this.showAlert('错误', '功能未就绪，请检查后端连接', 'error');
        return;
    }

    try {
        const result = await pywebview.api.select_library_dir();
        if (result && result.success && result.path) {
            const input = document.getElementById('library-dir-input');
            if (input) {
                input.value = result.path;
                input.title = result.path;
            }
            await this.saveLibraryPaths();
        }
    } catch (e) {
        console.error(e);
        this.showAlert('错误', '选择路径失败: ' + e.message, 'error');
    }
};

app.openPendingFolder = async function () {
    if (!window.pywebview?.api?.open_pending_folder) {
        this.showAlert('错误', '功能未就绪，请检查后端连接', 'error');
        return;
    }

    try {
        await pywebview.api.open_pending_folder();
    } catch (e) {
        console.error(e);
        this.showAlert('错误', '打开文件夹失败: ' + e.message, 'error');
    }
};

app.openLibraryFolder = async function () {
    if (!window.pywebview?.api?.open_library_folder) {
        this.showAlert('错误', '功能未就绪，请检查后端连接', 'error');
        return;
    }

    try {
        await pywebview.api.open_library_folder();
    } catch (e) {
        console.error(e);
        this.showAlert('错误', '打开文件夹失败: ' + e.message, 'error');
    }
};

app.saveLibraryPaths = async function () {
    if (!window.pywebview?.api?.save_pending_dir || !window.pywebview?.api?.save_library_dir) {
        this.showAlert('错误', '功能未就绪，请检查后端连接', 'error');
        return;
    }

    const pendingInput = document.getElementById('pending-dir-input');
    const libraryInput = document.getElementById('library-dir-input');
    const pendingDir = pendingInput ? pendingInput.value.trim() : null;
    const libraryDir = libraryInput ? libraryInput.value.trim() : null;

    try {
        const pendingRes = await pywebview.api.save_pending_dir(pendingDir);
        if (!pendingRes || !pendingRes.success) {
            this.showErrorToast('保存失败', pendingRes?.msg || '保存失败');
            return;
        }

        const libraryRes = await pywebview.api.save_library_dir(libraryDir);
        if (!libraryRes || !libraryRes.success) {
            this.showErrorToast('保存失败', libraryRes?.msg || '保存失败');
            return;
        }

        this.showInfoToast('已保存', '路径设置已保存');
        // 重新加载路径信息以更新 placeholder
        await this.loadLibraryPathInfo();
        // 刷新语音包库列表
        if (typeof this.refreshLibrary === 'function') {
            this.refreshLibrary();
        }
    } catch (e) {
        console.error(e);
        this.showErrorToast('保存失败', '保存失败: ' + e.message);
    }
};

app.resetLibraryPaths = async function () {
    if (!window.pywebview?.api?.save_pending_dir || !window.pywebview?.api?.save_library_dir) {
        this.showAlert('错误', '功能未就绪，请检查后端连接', 'error');
        return;
    }

    // 确认重置
    const confirmed = await this.showConfirmDialog(
        '重置路径',
        '确定要将待解压区和语音包库路径重置为默认值吗？'
    );
    if (!confirmed) return;

    try {
        const pendingRes = await pywebview.api.save_pending_dir('');
        if (!pendingRes || !pendingRes.success) {
            this.showErrorToast('重置失败', pendingRes?.msg || '重置失败');
            return;
        }

        const libraryRes = await pywebview.api.save_library_dir('');
        if (!libraryRes || !libraryRes.success) {
            this.showErrorToast('重置失败', libraryRes?.msg || '重置失败');
            return;
        }

        // 清空输入框
        const pendingInput = document.getElementById('pending-dir-input');
        const libraryInput = document.getElementById('library-dir-input');
        if (pendingInput) pendingInput.value = '';
        if (libraryInput) libraryInput.value = '';

        this.showInfoToast('已重置', '路径已重置为默认值');
        // 重新加载以更新 placeholder
        await this.loadLibraryPathInfo();
        // 刷新语音包库列表
        if (typeof this.refreshLibrary === 'function') {
            this.refreshLibrary();
        }
    } catch (e) {
        console.error(e);
        this.showErrorToast('重置失败', '重置失败: ' + e.message);
    }
};

// 複製路径到剪贴板
app.copyPathToClipboard = async function (inputId) {
    const input = document.getElementById(inputId);
    if (!input) return;

    const path = input.value || input.placeholder;
    if (!path || path === '使用默认路径' || path === '等待后端连接...') {
        this.showInfoToast('提示', '没有可复制的路径');
        return;
    }

    try {
        await navigator.clipboard.writeText(path);

        // 显示複製成功的视觉反馈
        const btn = input.parentElement.querySelector('.path-copy-btn');
        if (btn) {
            btn.classList.add('copied');
            setTimeout(() => btn.classList.remove('copied'), 1500);
        }

        this.showInfoToast('已复制', '路径已复制到剪贴板');
    } catch (e) {
        console.error('复制失败:', e);
        this.showErrorToast('复制失败', '无法访问剪贴板');
    }
};

// 单独重置待解压区路径
app.resetPendingDir = async function () {
    if (!window.pywebview?.api?.save_pending_dir) {
        this.showAlert('错误', '功能未就绪，请检查后端连接', 'error');
        return;
    }

    try {
        // 将待解压区路径设为空（重置为预设）
        const result = await pywebview.api.save_pending_dir('');
        if (result && result.success) {
            const pendingInput = document.getElementById('pending-dir-input');
            if (pendingInput) {
                pendingInput.value = '';
            }
            this.showInfoToast('已重置', '待解压区路径已重置为默认值');
            await this.loadLibraryPathInfo();
            if (typeof this.refreshLibrary === 'function') {
                this.refreshLibrary();
            }
        } else {
            this.showErrorToast('重置失败', result.msg || '重置失败');
        }
    } catch (e) {
        console.error(e);
        this.showErrorToast('重置失败', '重置失败: ' + e.message);
    }
};

// 单独重置语音包库路径
app.resetLibraryDir = async function () {
    if (!window.pywebview?.api?.save_library_dir) {
        this.showAlert('错误', '功能未就绪，请检查后端连接', 'error');
        return;
    }

    try {
        // 将语音包库路径设为空（重置为预设）
        const result = await pywebview.api.save_library_dir('');
        if (result && result.success) {
            const libraryInput = document.getElementById('library-dir-input');
            if (libraryInput) {
                libraryInput.value = '';
            }
            this.showInfoToast('已重置', '语音包库路径已重置为默认值');
            await this.loadLibraryPathInfo();
            if (typeof this.refreshLibrary === 'function') {
                this.refreshLibrary();
            }
        } else {
            this.showErrorToast('重置失败', result.msg || '重置失败');
        }
    } catch (e) {
        console.error(e);
        this.showErrorToast('重置失败', '重置失败: ' + e.message);
    }
};

// 辅助方法：显示确认对话框
app.showConfirmDialog = function (title, message) {
    return new Promise((resolve) => {
        const modal = document.getElementById('modal-confirm');
        const titleEl = document.getElementById('confirm-title');
        const msgEl = document.getElementById('confirm-message');
        const cancelBtn = document.getElementById('btn-confirm-cancel');
        const okBtn = document.getElementById('btn-confirm-ok');

        if (!modal || !titleEl || !msgEl) {
            resolve(false);
            return;
        }

        titleEl.textContent = title;
        msgEl.innerHTML = message;
        okBtn.innerHTML = '<i class="ri-check-line"></i> 确认';
        okBtn.className = 'btn primary';

        const cleanup = () => {
            modal.classList.remove('show');
            cancelBtn.onclick = null;
            okBtn.onclick = null;
        };

        cancelBtn.onclick = () => {
            cleanup();
            resolve(false);
        };

        okBtn.onclick = () => {
            cleanup();
            resolve(true);
        };

        modal.classList.add('show');
    });
};

/**
 * 全局拖放识别逻辑 (Global Drag & Drop Setup)
 * 功能：在特定页面监听文件拖入，并显示高级视觉反馈。
 */
app._dragCounter = 0;
app.hideDropOverlay = function () {
    const overlay = document.getElementById('drop-overlay');
    if (overlay) overlay.classList.remove('active');
    app._dragCounter = 0;
};

app.setupGlobalDragDrop = function () {
    const overlay = document.getElementById('drop-overlay');
    if (!overlay) return;

    // 定义允许显示拖放层的页面 (包括首页)
    const allowedPages = ['page-home', 'page-lib', 'page-camo', 'page-sight'];

    const canShow = () => {
        const activePageEl = document.querySelector('.page.active');
        if (!activePageEl) return false;
        const activePageId = activePageEl.id;

        // 额外的逻辑判断：如果在炮镜库则也允许
        if (activePageId === 'page-camo') {
            const sightsView = document.getElementById('view-sights');
            if (sightsView && sightsView.classList.contains('active')) return true;
        }

        return allowedPages.includes(activePageId);
    };

    window.addEventListener('dragenter', (e) => {
        if (!canShow()) return;
        e.preventDefault();
        app._dragCounter++;
        if (app._dragCounter === 1) {
            // --- 动态更新提示文本 ---
            const activePageEl = document.querySelector('.page.active');
            const textEl = overlay.querySelector('.drop-overlay-text');
            if (activePageEl && textEl) {
                const id = activePageEl.id;
                if (id === 'page-lib' || id === 'page-home') {
                    textEl.innerText = '放下并导入语音包';
                } else if (id === 'page-camo') {
                    const sightsView = document.getElementById('view-sights');
                    if (sightsView && sightsView.classList.contains('active')) {
                        textEl.innerText = '放下并导入炮镜';
                    } else {
                        textEl.innerText = '放下并导入涂装';
                    }
                } else if (id === 'page-sight') {
                    textEl.innerText = '放下并导入信息/炮镜';
                }
            }
            overlay.classList.add('active');
        }
    });

    window.addEventListener('dragover', (e) => {
        if (!canShow()) return;
        e.preventDefault();
        if (!overlay.classList.contains('active')) {
            overlay.classList.add('active');
        }
    });

    window.addEventListener('dragleave', (e) => {
        if (!canShow()) return;
        e.preventDefault();
        app._dragCounter--;
        if (app._dragCounter <= 0) {
            app.hideDropOverlay();
        }
    });

    window.addEventListener('drop', (e) => {
        e.preventDefault();
        app.hideDropOverlay();
    });
};

(function () {
    const MODAL_ID = 'modal-mod-preview';
    const LIST_ID = 'lib-list';
    const QQ_GROUP_URL = 'https://qun.qq.com/universal-share/share?ac=1&authKey=%2FDJOR1E72xAQKvLD%2BNQmaZmD7py%2F5PUY7xHORJX4kmmKdabaRF4%2BwIJkp6s8I10U&busi_data=eyJncm91cENvZGUiOiIxMDc4MzQzNjI5IiwidG9rZW4iOiJmSUNpVXErcnNMMVhlemRNR25EbVF5TWJrbmc5bm02UmRIS0c0WHFxemdWQkRzUlVmSkVZQW11NXFkRXZkMXBDIiwidWluIjoiMTA3OTY0OTM2OSJ9&data=4qfEzEByH95wqWw0I5ButymAfP5Aj5bjksqrXyh3uAoIWg5ChDGQ3w6cocqmRaRaGbDRpFunhEYQYBHwC46GHg&svctype=4&tempid=h5_group_info';
    const WTLIKER_URL = 'https://wtliker.com/';
    const WT_LIVE_URL = 'https://live.warthunder.com/';

    function getApp() {
        return window.app || null;
    }

    function escapeHtml(value) {
        const app = getApp();
        if (app && typeof app._escapeHtml === 'function') return app._escapeHtml(value);
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function normalizeVersion(value) {
        let version = String(value || '1.0').trim();
        if (version.toLowerCase().startsWith('v')) version = version.slice(1);
        return version || '1.0';
    }

    function normalizeLanguages(mod) {
        if (Array.isArray(mod?.language) && mod.language.length > 0) return mod.language.map(String);
        if (typeof mod?.language === 'string' && mod.language.trim()) return [mod.language.trim()];
        return ['多语言'];
    }

    function buildLangHtml(mod) {
        return normalizeLanguages(mod).map((lang) => {
            let cls = '';
            if (typeof window.UI_CONFIG !== 'undefined' && window.UI_CONFIG?.langMap?.[lang]) {
                cls = window.UI_CONFIG.langMap[lang];
            }
            return `<span class="lang-text ${cls}">${escapeHtml(lang)}</span>`;
        }).join('<span class="mod-preview-lang-sep">/</span>');
    }

    function normalizeUserTags(mod) {
        if (!Array.isArray(mod?.tags)) return [];
        return mod.tags
            .map((t) => typeof t === 'string' ? t.trim() : String(t || '').trim())
            .filter(Boolean);
    }

    function buildCapabilityTags(mod) {
        const caps = mod?.capabilities || {};
        const tags = [];

        if (typeof UI_CONFIG !== 'undefined' && UI_CONFIG?.tagMap) {
            Object.entries(UI_CONFIG.tagMap).forEach(([key, conf]) => {
                if (!caps[key]) return;
                tags.push({
                    text: conf?.text || key,
                    cls: conf?.cls || '',
                });
            });
            return tags;
        }

        const fallback = [
            ['tank', 'tank', '陆战'],
            ['air', 'air', '空战'],
            ['naval', 'naval', '海战'],
            ['radio', 'radio', '无线电/队友'],
            ['missile', 'missile', '导弹音效'],
            ['music', 'music', '音乐包'],
            ['noise', 'noise', '降噪包'],
            ['pilot', 'pilot', '飞行员语音'],
        ];
        fallback.forEach(([capKey, cls, text]) => {
            if (caps[capKey]) tags.push({ text, cls });
        });
        return tags;
    }

    function buildTagHtml(mod) {
        const fromInfo = normalizeUserTags(mod);
        const normalizeTagText = (value) => String(value || '')
            .replace(/\s+/g, '')
            .replace(/[／]/g, '/')
            .toLowerCase();
        const resolveTagClass = (text) => {
            const keyText = normalizeTagText(text);
            if (typeof UI_CONFIG !== 'undefined' && UI_CONFIG?.tagMap) {
                const entry = Object.values(UI_CONFIG.tagMap).find((conf) => (
                    normalizeTagText(conf?.text) === keyText || normalizeTagText(conf?.cls) === keyText
                ));
                if (entry?.cls) return entry.cls;
            }
            const alias = [
                { cls: 'tank', words: ['陆战', '坦克'] },
                { cls: 'air', words: ['空战', '空军'] },
                { cls: 'naval', words: ['海战', '海军'] },
                { cls: 'radio', words: ['无线电', '局势'] },
                { cls: 'missile', words: ['导弹'] },
                { cls: 'music', words: ['音乐'] },
                { cls: 'noise', words: ['降噪'] },
                { cls: 'pilot', words: ['飞行员'] }
            ];
            for (const item of alias) {
                if (item.words.some((word) => keyText.includes(normalizeTagText(word)))) {
                    return item.cls;
                }
            }
            return '';
        };
        if (fromInfo.length > 0) {
            return fromInfo
                .map((text) => {
                    const cls = resolveTagClass(text);
                    return `<span class="tag ${escapeHtml(cls)}">${escapeHtml(text)}</span>`;
                })
                .join('');
        }
        return buildCapabilityTags(mod)
            .map((item) => `<span class="tag ${escapeHtml(item.cls)}">${escapeHtml(item.text)}</span>`)
            .join('');
    }

    function resolveDescription(mod) {
        return String(mod?.full_desc || mod?.description || mod?.note || '暂无详细介绍').trim();
    }

    function splitVersionNoteText(raw) {
        return String(raw || '')
            .split(/\n{2,}/)
            .map((block) => block.trim())
            .filter(Boolean)
            .map((block) => {
                const lines = block.split('\n');
                const firstLine = String(lines[0] || '').trim();
                const isPureVersion = /^v?\d+(?:\.\d+)*$/i.test(firstLine);
                if (isPureVersion) {
                    const version = `v${normalizeVersion(firstLine)}`;
                    const note = lines.slice(1).join('\n').trim();
                    return { version, note };
                }
                return { version: '', note: block };
            })
            .filter((item) => item.version || item.note);
    }

    function resolveVersionNoteEntries(mod) {
        if (Array.isArray(mod?.version_note)) {
            const entries = mod.version_note
                .map((item) => {
                    const rawVersion = String(item?.version || '').trim();
                    const version = rawVersion ? `v${normalizeVersion(rawVersion)}` : '';
                    const note = String(item?.note || '').trim();
                    if (!version && !note) return null;
                    return { version, note };
                })
                .filter(Boolean);
            if (entries.length) return entries;
        }

        const raw = String(mod?.version_note || mod?.changelog || '').trim();
        if (raw) return splitVersionNoteText(raw);

        const version = `v${normalizeVersion(mod?.version)}`;
        return [{ version, note: '暂无详细更新日志。' }];
    }

    function buildVersionNoteHtml(mod) {
        const entries = resolveVersionNoteEntries(mod);
        if (!entries.length) {
            return '<span class="mod-preview-empty">暂无详细更新日志。</span>';
        }
        return entries.map((item) => {
            const versionText = String(item?.version || '').trim();
            const noteText = String(item?.note || '').trim();
            const versionHtml = versionText ? `<div class="mod-preview-note-version">${escapeHtml(versionText)}</div>` : '';
            const noteHtml = noteText ? `<div class="mod-preview-note-text">${escapeHtml(noteText)}</div>` : '';
            const content = (versionHtml || noteHtml)
                ? `${versionHtml}${noteHtml}`
                : `<div class="mod-preview-note-text">暂无详细更新日志。</div>`;
            return `<div class="mod-preview-note-item">${content}</div>`;
        }).join('');
    }

    function findModById(modId) {
        const app = getApp();
        const list = Array.isArray(app?.modCache) ? app.modCache : [];
        const key = String(modId ?? '');
        return list.find((item) => String(item?.id ?? '') === key) || null;
    }

    function ensureModal() {
        let overlay = document.getElementById(MODAL_ID);
        if (overlay) return overlay;

        overlay = document.createElement('div');
        overlay.id = MODAL_ID;
        overlay.className = 'modal-overlay mod-preview-overlay';
        overlay.innerHTML = `
            <div class="modal-content mod-preview-modal-v2">
                <div class="mod-preview-topbar">
                    <div class="mod-preview-title-wrap">
                        <div class="mod-preview-title" id="mod-preview-title"></div>
                        <span class="mod-preview-version" id="mod-preview-version"></span>
                    </div>
                    <div class="mod-preview-subline">
                        <span><i class="ri-user-3-line"></i> <span id="mod-preview-author"></span></span>
                        <span class="dot"></span>
                        <span><i class="ri-time-line"></i> <span id="mod-preview-date"></span></span>
                    </div>
                    <button class="mod-preview-close-btn" type="button" title="关闭">
                        <i class="ri-close-line"></i>
                    </button>
                </div>

                <div class="mod-preview-body">
                    <div class="mod-preview-left">
                        <div class="mod-preview-cover-box">
                            <img class="mod-preview-cover" id="mod-preview-cover" src="" alt="语音包封面">
                        </div>
                        <div class="mod-preview-attrs">
                            <h4>文件属性</h4>
                            <div class="row"><span><i class="ri-hard-drive-2-line"></i> 文件大小</span><b id="mod-preview-size"></b></div>
                            <div class="row"><span><i class="ri-translate"></i> 语言支持</span><b id="mod-preview-lang"></b></div>
                            <div class="row"><span><i class="ri-price-tag-3-line"></i> 标签数量</span><b id="mod-preview-tag-count"></b></div>
                        </div>
                        <div class="mod-preview-compat">
                            <i class="ri-checkbox-circle-line"></i>
                            <div>
                                <strong>兼容性良好</strong>
                                <p>适配当前版本 War Thunder</p>
                            </div>
                        </div>
                    </div>

                    <div class="mod-preview-right">
                        <section class="mod-preview-card">
                            <h4><i class="ri-price-tag-3-line"></i> 包含内容</h4>
                            <div class="mod-preview-tags-scroll" id="mod-preview-tags"></div>
                        </section>

                        <section class="mod-preview-card">
                            <h4><i class="ri-information-line"></i> 详细介绍</h4>
                            <div class="mod-preview-desc" id="mod-preview-desc"></div>
                        </section>

                        <div class="mod-preview-bottom-grid">
                            <section class="mod-preview-card">
                                <h4><i class="ri-refresh-line"></i> 版本说明</h4>
                                <div class="mod-preview-note-log" id="mod-preview-version-note"></div>
                            </section>

                            <section class="mod-preview-card">
                                <h4><i class="ri-links-line"></i> 关注与反馈</h4>
                                <div class="mod-preview-link-grid">
                                    <button class="mod-preview-link-btn bili" type="button" data-link-action="bili"><i class="ri-bilibili-line"></i> Bilibili 主页</button>
                                    <button class="mod-preview-link-btn qq" type="button" data-link-action="qq"><i class="ri-qq-line"></i> 加入粉丝群</button>
                                    <button class="mod-preview-link-btn wt" type="button" data-link-action="wtlive"><i class="ri-global-line"></i> WT Live</button>
                                    <button class="mod-preview-link-btn liker" type="button" data-link-action="liker"><i class="ri-heart-3-line"></i> WT Liker</button>
                                    <button class="mod-preview-link-btn feedback" type="button" data-link-action="feedback"><i class="ri-mail-send-line"></i> 联系作者反馈</button>
                                </div>
                            </section>
                        </div>
                    </div>
                </div>

                <div class="mod-preview-footer">
                    <div class="mod-preview-id" id="mod-preview-id"></div>
                    <div class="mod-preview-footer-actions">
                        <button class="btn secondary" type="button" data-action="delete"><i class="ri-delete-bin-line"></i> 删除</button>
                        <button class="btn secondary" type="button" data-action="audition"><i class="ri-play-circle-line"></i> 试听语音</button>
                        <button class="btn primary" type="button" data-action="apply"><i class="ri-check-line"></i> 应用语音包</button>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);

        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) closePreview();
        });
        const closeBtn = overlay.querySelector('.mod-preview-close-btn');
        if (closeBtn) closeBtn.addEventListener('click', closePreview);

        return overlay;
    }

    function openExternal(url) {
        const safeUrl = String(url || '').trim();
        if (!safeUrl) return;
        try {
            window.open(safeUrl, '_blank', 'noopener');
        } catch (e) {
            const app = getApp();
            if (app && typeof app.showAlert === 'function') {
                app.showAlert('错误', '打开链接失败', 'error');
            }
        }
    }

    function bindFooterActions(overlay, mod) {
        const app = getApp();
        const applyBtn = overlay.querySelector('[data-action="apply"]');
        const deleteBtn = overlay.querySelector('[data-action="delete"]');
        const auditionBtn = overlay.querySelector('[data-action="audition"]');

        if (applyBtn) {
            applyBtn.onclick = () => {
                closePreview();
                if (app && typeof app.openInstallModal === 'function') {
                    app.openInstallModal(mod.id);
                }
            };
        }
        if (deleteBtn) {
            deleteBtn.onclick = () => {
                closePreview();
                if (app && typeof app.deleteMod === 'function') {
                    app.deleteMod(mod.id);
                }
            };
        }
        if (auditionBtn) {
            auditionBtn.onclick = async () => {
                try {
                    if (!window.pywebview?.api?.start_mod_audition_scan || !window.pywebview?.api?.get_mod_audition_categories_snapshot) {
                        if (app && typeof app.showAlert === 'function') {
                            app.showAlert('错误', '后端试听接口不可用', 'error');
                        }
                        return;
                    }

                    auditionBtn.disabled = true;
                    const oldHtml = auditionBtn.innerHTML;
                    auditionBtn.innerHTML = '<i class="ri-loader-2-line"></i> 初始化试听...';
                    const currentState = window.__auditionPickerState;
                    const currentModId = String(mod.id || '');
                    if (currentState && currentState.modId === currentModId) {
                        // 同一语音包重复点击：不重复开窗和重复初始化
                        auditionBtn.innerHTML = oldHtml;
                        auditionBtn.disabled = false;
                        if (app && typeof app.showInfoToast === 'function') {
                            app.showInfoToast('提示', '该语音包试听窗口已打开');
                        }
                        return;
                    }
                    if (currentState && typeof currentState.close === 'function') {
                        currentState.close(true);
                    }
                    openAuditionPicker(mod, []);
                    await pywebview.api.start_mod_audition_scan(mod.id);
                    const snap = await pywebview.api.get_mod_audition_categories_snapshot(mod.id);
                    auditionBtn.innerHTML = oldHtml;
                    auditionBtn.disabled = false;

                    if (!snap || !snap.success) {
                        const msg = (snap && snap.msg) ? snap.msg : '试听初始化失败';
                        if (app && typeof app.showAlert === 'function') {
                            app.showAlert('错误', msg, 'error');
                        }
                        return;
                    }
                    if (window.__auditionPickerState && typeof window.__auditionPickerState.update === 'function') {
                        window.__auditionPickerState.update(snap);
                    }
                } catch (e) {
                    if (auditionBtn) {
                        auditionBtn.disabled = false;
                        auditionBtn.innerHTML = '<i class="ri-play-circle-line"></i> 试听语音';
                    }
                    if (app && typeof app.showAlert === 'function') {
                        app.showAlert('错误', `试听失败: ${e.message || e}`, 'error');
                    }
                }
            };
        }
    }

    function formatDuration(sec) {
        const n = Number(sec || 0);
        if (!Number.isFinite(n) || n <= 0) return '0:00';
        const m = Math.floor(n / 60);
        const s = Math.floor(n % 60);
        return `${m}:${String(s).padStart(2, '0')}`;
    }

    function openAuditionPicker(mod, categories) {
        const app = getApp();
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay show';
        overlay.style.zIndex = '10002';
        let categoriesData = Array.isArray(categories) ? [...categories] : [];

        overlay.innerHTML = `
            <div class="modal-content" style="max-width:980px;width:min(94vw,980px);padding:20px;max-height:86vh;display:flex;flex-direction:column;">
                <h3 style="margin:0 0 12px 0;">选择试听分类</h3>
                <div style="display:flex;gap:8px;margin-bottom:10px;">
                    <input id="audition-search" type="text" placeholder="搜索分类名 / code" style="flex:1;padding:10px;border:1px solid var(--border-color);border-radius:10px;">
                    <span id="audition-count" style="align-self:center;color:var(--text-secondary);font-size:13px;line-height:1;padding:8px 10px;border:1px solid var(--border-color);border-radius:8px;white-space:nowrap;">等待解析...</span>
                </div>
                <div style="margin-bottom:10px;">
                    <div id="audition-progress-text" style="font-size:13px;color:var(--text-secondary);margin-bottom:6px;">准备中...</div>
                    <div style="height:8px;background:var(--bg-card-soft, rgba(127,127,127,0.2));border-radius:999px;overflow:hidden;border:1px solid var(--border-color);">
                        <div id="audition-progress-bar" style="height:100%;width:0%;background:linear-gradient(90deg,var(--primary),#ffb347);transition:width .2s ease;"></div>
                    </div>
                </div>
                <select id="audition-select" size="22" style="width:100%;flex:1;min-height:320px;font-family:Consolas, monospace;padding:10px;border:1px solid var(--border-color);border-radius:10px;"></select>
                <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:12px;">
                    <button class="btn secondary" type="button" id="audition-pause-btn">暂停解析</button>
                    <button class="btn secondary" type="button" id="audition-close-btn">关闭</button>
                    <button class="btn primary" type="button" id="audition-play-btn"><i class="ri-play-circle-line"></i> 随机试听该分类</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);

        const selectEl = overlay.querySelector('#audition-select');
        const searchEl = overlay.querySelector('#audition-search');
        const countEl = overlay.querySelector('#audition-count');
        const progressTextEl = overlay.querySelector('#audition-progress-text');
        const progressBarEl = overlay.querySelector('#audition-progress-bar');
        const playBtn = overlay.querySelector('#audition-play-btn');
        const closeBtn = overlay.querySelector('#audition-close-btn');
        const pauseBtn = overlay.querySelector('#audition-pause-btn');
        let snapshotStatusText = '准备中...';

        const close = (switching = false) => {
            if (window.__aimerAuditionAudio) {
                try {
                    window.__aimerAuditionAudio.pause();
                    window.__aimerAuditionAudio.currentTime = 0;
                    window.__aimerAuditionAudio.src = '';
                } catch (e) {
                }
            }
            if (window.pywebview?.api?.stop_mod_audition_scan) {
                pywebview.api.stop_mod_audition_scan(mod.id).catch(() => {});
            }
            if (window.pywebview?.api?.clear_audition_cache) {
                pywebview.api.clear_audition_cache(mod.id).catch(() => {});
            }
            if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
            if (window.__auditionPickerState && window.__auditionPickerState.modId === String(mod.id || '')) {
                window.__auditionPickerState = null;
            }
            if (!switching && app && typeof app.showInfoToast === 'function') {
                app.showInfoToast('提示', '已关闭试听窗口');
            }
        };

        const rebuildOptions = (keyword) => {
            const q = String(keyword || '').trim().toLowerCase();
            let visible = 0;
            const html = categoriesData.map((it, idx) => {
                const name = String(it.name || '');
                const code = String(it.code || '');
                const hit = !q || name.toLowerCase().includes(q) || code.toLowerCase().includes(q);
                if (!hit) return '';
                visible += 1;
                const label = `${escapeHtml(name)} (${Number(it.count || 0)} 条) [${escapeHtml(code)}]`;
                return `<option value="${idx}">${label}</option>`;
            }).join('');
            selectEl.innerHTML = html;
            if (progressTextEl) {
                const base = snapshotStatusText || '解析中...';
                if (visible !== categoriesData.length) {
                    progressTextEl.textContent = `${base} · 当前筛选 ${visible}/${categoriesData.length} 类`;
                } else {
                    progressTextEl.textContent = base;
                }
            }
        };

        const updateFromSnapshot = (snap) => {
            if (!snap) return;
            if (Array.isArray(snap.categories)) categoriesData = snap.categories;
            if (countEl) {
                const p = Number(snap.progress || 0);
                const msg = String(snap.message || '');
                countEl.textContent = `${categoriesData.length} 类 / ${Number(snap.count || 0)} 条`;
                if (progressTextEl) {
                    snapshotStatusText = `${msg || '解析中'} (${p}%)`;
                    progressTextEl.textContent = snapshotStatusText;
                }
                if (progressBarEl) {
                    progressBarEl.style.width = `${Math.max(0, Math.min(100, p))}%`;
                }
                if (snap.done) {
                    if (snap.error) {
                        snapshotStatusText = `解析结束：${snap.error}`;
                        if (progressTextEl) progressTextEl.textContent = snapshotStatusText;
                    } else {
                        snapshotStatusText = `解析完成：${categoriesData.length} 类，${Number(snap.count || 0)} 条语音`;
                        if (progressTextEl) progressTextEl.textContent = snapshotStatusText;
                    }
                }
            }
            rebuildOptions(searchEl ? searchEl.value : '');
            if (pauseBtn) {
                if (snap.done) {
                    pauseBtn.disabled = true;
                    pauseBtn.textContent = '解析已完成';
                } else {
                    pauseBtn.disabled = false;
                    pauseBtn.textContent = snap.paused ? '继续解析' : '暂停解析';
                }
            }
        };

        if (searchEl) {
            searchEl.addEventListener('input', (e) => {
                rebuildOptions(e.target.value);
            });
        }

        const playSelected = async () => {
            try {
                if (!selectEl || !selectEl.value) {
                    if (app && typeof app.showAlert === 'function') {
                        app.showAlert('提示', '请先选择一个分类', 'warn');
                    }
                    return;
                }
                if (!window.pywebview?.api?.audition_mod_random_by_type) {
                    if (app && typeof app.showAlert === 'function') {
                        app.showAlert('错误', '后端试听接口不可用', 'error');
                    }
                    return;
                }

                const selected = categoriesData[Number(selectEl.value)];
                if (!selected) return;

                const selectedCode = String(selected.code || '').toLowerCase();
                if (selectedCode === 'preview') {
                    if (!window.pywebview?.api?.list_mod_audition_items_by_type) {
                        if (app && typeof app.showAlert === 'function') {
                            app.showAlert('错误', '后端手动试听接口不可用', 'error');
                        }
                        return;
                    }
                    playBtn.disabled = true;
                    const oldHtml = playBtn.innerHTML;
                    playBtn.innerHTML = '<i class="ri-loader-2-line"></i> 加载试听条目...';
                    const listRes = await pywebview.api.list_mod_audition_items_by_type(mod.id, selected.code);
                    playBtn.disabled = false;
                    playBtn.innerHTML = oldHtml;
                    if (!listRes || !listRes.success || !Array.isArray(listRes.items) || listRes.items.length === 0) {
                        const msg = (listRes && listRes.msg) ? listRes.msg : '未获取到可试听条目';
                        if (app && typeof app.showAlert === 'function') {
                            app.showAlert('错误', msg, 'error');
                        }
                        return;
                    }
                    openManualPreviewPicker(mod, selected, listRes.items);
                    return;
                }

                playBtn.disabled = true;
                const oldHtml = playBtn.innerHTML;
                playBtn.innerHTML = '<i class="ri-loader-2-line"></i> 随机抽取中...';
                const res = await pywebview.api.audition_mod_random_by_type(
                    mod.id,
                    selected.code,
                    12
                );
                playBtn.disabled = false;
                playBtn.innerHTML = oldHtml;

                if (!res || !res.success || !res.audio_url) {
                    const msg = (res && res.msg) ? res.msg : '试听失败';
                    if (app && typeof app.showAlert === 'function') {
                        app.showAlert('错误', msg, 'error');
                    }
                    return;
                }

                if (!window.__aimerAuditionAudio) {
                    window.__aimerAuditionAudio = new Audio();
                }
                const player = window.__aimerAuditionAudio;
                player.pause();
                player.currentTime = 0;
                player.src = res.audio_url;
                await player.play();
                if (app && typeof app.showInfoToast === 'function') {
                    const picked = String(res.picked_name || '随机语音');
                    const typeName = String(res.voice_type_name || selected.name || selected.code);
                    app.showInfoToast('试听中', `分类[${typeName}] 随机播放：${picked}`);
                }
            } catch (e) {
                playBtn.disabled = false;
                playBtn.innerHTML = '<i class="ri-play-circle-line"></i> 随机试听该分类';
                if (app && typeof app.showAlert === 'function') {
                    app.showAlert('错误', `试听失败: ${e.message || e}`, 'error');
                }
            }
        };

        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) close();
        });
        if (closeBtn) closeBtn.addEventListener('click', close);
        if (pauseBtn) {
            pauseBtn.addEventListener('click', async () => {
                try {
                    if (!window.pywebview?.api?.set_mod_audition_scan_paused) {
                        if (app && typeof app.showAlert === 'function') {
                            app.showAlert('错误', '后端暂停接口不可用', 'error');
                        }
                        return;
                    }
                    const willPause = pauseBtn.textContent.includes('暂停');
                    pauseBtn.disabled = true;
                    const res = await pywebview.api.set_mod_audition_scan_paused(mod.id, willPause);
                    if (!res || !res.success) {
                        if (app && typeof app.showAlert === 'function') {
                            app.showAlert('错误', (res && res.msg) ? res.msg : '操作失败', 'error');
                        }
                        pauseBtn.disabled = false;
                        return;
                    }
                    pauseBtn.textContent = res.paused ? '继续解析' : '暂停解析';
                    pauseBtn.disabled = false;
                } catch (e) {
                    pauseBtn.disabled = false;
                    if (app && typeof app.showAlert === 'function') {
                        app.showAlert('错误', `操作失败: ${e.message || e}`, 'error');
                    }
                }
            });
        }
        if (playBtn) playBtn.addEventListener('click', playSelected);
        if (selectEl) {
            selectEl.addEventListener('dblclick', playSelected);
        }

        window.__auditionPickerState = {
            modId: String(mod.id || ''),
            update: updateFromSnapshot,
            close,
        };
        updateFromSnapshot({ categories: categoriesData, progress: 0, message: '等待解析', done: false, count: 0 });
    }

    function openManualPreviewPicker(mod, category, items) {
        const app = getApp();
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay show';
        overlay.style.zIndex = '10003';

        const optionsHtml = items.map((it, idx) => {
            const nm = escapeHtml(String(it.name || `stream_${it.stream_index}`));
            const bk = escapeHtml(String(it.bank_file || 'unknown.bank'));
            const d = formatDuration(it.duration_sec);
            return `<option value="${idx}">#${idx + 1} ${nm} (${d}) [${bk}]</option>`;
        }).join('');

        overlay.innerHTML = `
            <div class="modal-content" style="max-width:980px;width:min(94vw,980px);padding:20px;max-height:86vh;display:flex;flex-direction:column;">
                <h3 style="margin:0 0 12px 0;">手动选择试听语音 - ${escapeHtml(String(category?.name || '试听'))}</h3>
                <div style="display:flex;gap:8px;margin-bottom:10px;">
                    <input id="manual-preview-search" type="text" placeholder="搜索语音名 / bank 文件名" style="flex:1;padding:10px;border:1px solid var(--border-color);border-radius:10px;">
                    <span id="manual-preview-count" style="align-self:center;color:var(--text-secondary);font-size:13px;line-height:1;padding:8px 10px;border:1px solid var(--border-color);border-radius:8px;white-space:nowrap;">共 ${items.length} 条</span>
                </div>
                <select id="manual-preview-select" size="22" style="width:100%;flex:1;min-height:320px;font-family:Consolas, monospace;padding:10px;border:1px solid var(--border-color);border-radius:10px;">${optionsHtml}</select>
                <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:12px;">
                    <button class="btn secondary" type="button" id="manual-preview-close-btn">关闭</button>
                    <button class="btn primary" type="button" id="manual-preview-play-btn"><i class="ri-play-circle-line"></i> 播放选中语音</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);

        const selectEl = overlay.querySelector('#manual-preview-select');
        const searchEl = overlay.querySelector('#manual-preview-search');
        const countEl = overlay.querySelector('#manual-preview-count');
        const playBtn = overlay.querySelector('#manual-preview-play-btn');
        const closeBtn = overlay.querySelector('#manual-preview-close-btn');
        let viewItems = [...items];

        const close = () => {
            if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
        };

        const rebuild = (keyword) => {
            const q = String(keyword || '').trim().toLowerCase();
            const filtered = items.filter((it) => {
                const n = String(it.name || '').toLowerCase();
                const b = String(it.bank_file || '').toLowerCase();
                return !q || n.includes(q) || b.includes(q);
            });
            viewItems = filtered;
            selectEl.innerHTML = filtered.map((it, idx) => {
                const nm = escapeHtml(String(it.name || `stream_${it.stream_index}`));
                const bk = escapeHtml(String(it.bank_file || 'unknown.bank'));
                const d = formatDuration(it.duration_sec);
                return `<option value="${idx}">#${idx + 1} ${nm} (${d}) [${bk}]</option>`;
            }).join('');
            if (countEl) countEl.textContent = `显示 ${filtered.length} / ${items.length} 条`;
        };

        const playSelected = async () => {
            try {
                if (!selectEl || !selectEl.value) {
                    if (app && typeof app.showAlert === 'function') {
                        app.showAlert('提示', '请先选择一条语音', 'warn');
                    }
                    return;
                }
                if (!window.pywebview?.api?.audition_mod_stream) {
                    if (app && typeof app.showAlert === 'function') {
                        app.showAlert('错误', '后端播放接口不可用', 'error');
                    }
                    return;
                }
                const selected = viewItems[Number(selectEl.value)];
                if (!selected) return;

                playBtn.disabled = true;
                const oldHtml = playBtn.innerHTML;
                playBtn.innerHTML = '<i class="ri-loader-2-line"></i> 解析中...';
                const res = await pywebview.api.audition_mod_stream(
                    mod.id,
                    selected.bank_rel,
                    selected.chunk_index,
                    selected.stream_index,
                    12
                );
                playBtn.disabled = false;
                playBtn.innerHTML = oldHtml;
                if (!res || !res.success || !res.audio_url) {
                    const msg = (res && res.msg) ? res.msg : '试听失败';
                    if (app && typeof app.showAlert === 'function') {
                        app.showAlert('错误', msg, 'error');
                    }
                    return;
                }
                if (!window.__aimerAuditionAudio) {
                    window.__aimerAuditionAudio = new Audio();
                }
                const player = window.__aimerAuditionAudio;
                player.pause();
                player.currentTime = 0;
                player.src = res.audio_url;
                await player.play();
                if (app && typeof app.showInfoToast === 'function') {
                    app.showInfoToast('试听中', `正在播放：${selected.name || ('#' + selected.stream_index)}`);
                }
            } catch (e) {
                playBtn.disabled = false;
                playBtn.innerHTML = '<i class="ri-play-circle-line"></i> 播放选中语音';
                if (app && typeof app.showAlert === 'function') {
                    app.showAlert('错误', `试听失败: ${e.message || e}`, 'error');
                }
            }
        };

        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) close();
        });
        if (closeBtn) closeBtn.addEventListener('click', close);
        if (playBtn) playBtn.addEventListener('click', playSelected);
        if (selectEl) selectEl.addEventListener('dblclick', playSelected);
        if (searchEl) searchEl.addEventListener('input', (e) => rebuild(e.target.value));
    }

    app.onAuditionScanUpdate = function (modId, payload) {
        try {
            const st = window.__auditionPickerState;
            if (!st || !payload) return;
            if (String(st.modId || '') !== String(modId || '')) return;
            if (typeof st.update === 'function') st.update(payload);
        } catch (e) {
            console.error('onAuditionScanUpdate error:', e);
        }
    };

    function bindLinkActions(overlay, mod) {
        const getLink = (action) => {
            if (action === 'bili') return String(mod?.link_bilibili || '').trim();
            if (action === 'qq') return String(mod?.link_qq_group || '').trim();
            if (action === 'wtlive') return String(mod?.link_wtlive || '').trim();
            if (action === 'liker') return String(mod?.link_liker || '').trim();
            if (action === 'feedback') return String(mod?.link_feedback || '').trim();
            return '';
        };

        overlay.querySelectorAll('[data-link-action]').forEach((btn) => {
            const action = btn.dataset.linkAction;
            const url = getLink(action);
            const enabled = Boolean(url);
            btn.classList.toggle('disabled', !enabled);
            btn.disabled = !enabled;
            btn.onclick = () => {
                if (!enabled) return;
                return openExternal(url);
            };
        });
    }

    function openPreview(mod) {
        const overlay = ensureModal();
        const title = String(mod?.title || '未命名语音包');
        const author = String(mod?.author || '未知作者');
        const date = String(mod?.date || '未知日期');
        const sizeText = String(mod?.size_str || '未知大小');
        const cover = String(mod?.cover_url || 'assets/card_image.png');
        const version = normalizeVersion(mod?.version);
        const desc = resolveDescription(mod);
        const versionNoteHtml = buildVersionNoteHtml(mod);
        const tagHtml = buildTagHtml(mod);
        const tagCount = normalizeUserTags(mod).length || buildCapabilityTags(mod).length;

        const idText = String(mod?.id || '');
        const idShow = /^\d+$/.test(idText) ? idText.padStart(6, '0') : idText;

        const titleEl = overlay.querySelector('#mod-preview-title');
        const versionEl = overlay.querySelector('#mod-preview-version');
        const authorEl = overlay.querySelector('#mod-preview-author');
        const dateEl = overlay.querySelector('#mod-preview-date');
        const coverEl = overlay.querySelector('#mod-preview-cover');
        const sizeEl = overlay.querySelector('#mod-preview-size');
        const langEl = overlay.querySelector('#mod-preview-lang');
        const tagCountEl = overlay.querySelector('#mod-preview-tag-count');
        const tagsEl = overlay.querySelector('#mod-preview-tags');
        const descEl = overlay.querySelector('#mod-preview-desc');
        const versionNoteEl = overlay.querySelector('#mod-preview-version-note');
        const idEl = overlay.querySelector('#mod-preview-id');

        if (titleEl) titleEl.textContent = title;
        if (versionEl) versionEl.textContent = `v${version}`;
        if (authorEl) authorEl.textContent = author;
        if (dateEl) dateEl.textContent = date;
        if (coverEl) coverEl.src = cover;
        if (sizeEl) sizeEl.textContent = sizeText;
        if (langEl) langEl.innerHTML = buildLangHtml(mod);
        if (tagCountEl) tagCountEl.textContent = `${tagCount} 个`;
        if (tagsEl) tagsEl.innerHTML = tagHtml || '<span class="mod-preview-empty">暂无标签</span>';
        if (descEl) descEl.textContent = desc;
        if (versionNoteEl) versionNoteEl.innerHTML = versionNoteHtml;
        if (idEl) idEl.textContent = `ID: ${idShow || '-'}`;

        bindFooterActions(overlay, mod);
        bindLinkActions(overlay, mod);

        overlay.classList.remove('hiding');
        overlay.classList.add('show');
    }

    function closePreview() {
        const app = getApp();
        if (app && typeof app.closeModal === 'function') {
            app.closeModal(MODAL_ID);
            return;
        }
        const el = document.getElementById(MODAL_ID);
        if (!el) return;
        el.classList.remove('show');
        el.classList.remove('hiding');
    }

    function shouldIgnoreClick(target) {
        return !!target.closest(
            '.mod-actions-col, .action-icon, .action-btn-load, .mod-copy-action, .mod-note, button, a'
        );
    }

    function bindCardPreviewClick() {
        const list = document.getElementById(LIST_ID);
        if (!list || list.dataset.previewBound === '1') return;
        list.dataset.previewBound = '1';

        list.addEventListener('click', (e) => {
            if (e.button !== 0) return;
            if (shouldIgnoreClick(e.target)) return;
            const card = e.target.closest('.mod-card');
            if (!card || !list.contains(card)) return;

            const mod = findModById(card.dataset.id || '');
            if (!mod) return;
            openPreview(mod);
        });
    }

    function init() {
        const app = getApp();
        if (!app) {
            setTimeout(init, 60);
            return;
        }

        app.openModPreview = (modOrId) => {
            const mod = (typeof modOrId === 'object') ? modOrId : findModById(modOrId);
            if (!mod) return;
            openPreview(mod);
        };
        app.closeModPreview = closePreview;

        bindCardPreviewClick();
        if (!app._cardPreviewObserver) {
            const observer = new MutationObserver(bindCardPreviewClick);
            observer.observe(document.body, { childList: true, subtree: true });
            app._cardPreviewObserver = observer;
        }

        document.addEventListener('click', (e) => {
            const wrapper = document.getElementById('theme-select-wrapper');
            if (wrapper && !wrapper.contains(e.target)) {
                wrapper.classList.remove('active');
            }
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init, { once: true });
    } else {
        init();
    }
})();
