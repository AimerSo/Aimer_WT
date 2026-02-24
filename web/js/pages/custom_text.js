/**
 * 自定义文本模块
 */
const CustomText = {
    name: '自定义文本',
    icon: 'ri-sparkling-2-line',
    viewId: 'view-custom_text',
    _initialized: false,
    groups: [],
    groupMap: {},
    currentGroup: '',
    currentCsvFile: 'menu.csv',
    csvFiles: [],
    currentLanguage: 'Chinese',

    init() {
        this.render();
        this.bindEvents();
        this.loadData();
    },

    render() {
        const container = document.getElementById('resource_content_container');
        if (!container) return;

        const view = document.createElement('div');
        view.className = 'resource-view';
        view.id = this.viewId;
        view.innerHTML = `
            <div class="resource-view-header">
                <h2><i class="${this.icon}"></i> ${this.name}</h2>
                <div class="resource-view-header-right custom-text-actions">
                    <select id="custom-text-csv-file" class="custom-text-select"></select>
                    <select id="custom-text-language" class="custom-text-select"></select>
                    <button class="btn-v2" id="btn-custom-text-reload"><i class="ri-refresh-line"></i><span>刷新</span></button>
                    <button class="btn-v2 primary" id="btn-custom-text-save"><i class="ri-save-3-line"></i><span>保存当前语言</span></button>
                </div>
            </div>
            <div class="custom-text-wrap">
                <aside class="custom-text-groups">
                    <div class="custom-text-groups-head">分组</div>
                    <div class="custom-text-groups-search-wrap">
                        <input id="custom-text-group-search" class="custom-text-group-search" placeholder="搜索分组...">
                    </div>
                    <div class="custom-text-groups-list" id="custom-text-groups-list"></div>
                </aside>
                <section class="custom-text-main">
                    <div class="custom-text-toolbar">
                        <input id="custom-text-search" class="custom-text-search" placeholder="搜索 ID 或文本...">
                        <div class="custom-text-summary" id="custom-text-summary">等待加载...</div>
                    </div>
                    <div class="custom-text-table" id="custom-text-table"></div>
                </section>
            </div>
        `;
        container.appendChild(view);
    },

    bindEvents() {
        const reloadBtn = document.getElementById('btn-custom-text-reload');
        const saveBtn = document.getElementById('btn-custom-text-save');
        const searchEl = document.getElementById('custom-text-search');
        const groupSearchEl = document.getElementById('custom-text-group-search');
        const langEl = document.getElementById('custom-text-language');
        const csvEl = document.getElementById('custom-text-csv-file');

        if (reloadBtn) reloadBtn.onclick = () => this.loadData();
        if (saveBtn) saveBtn.onclick = () => this.saveData();
        if (searchEl) searchEl.oninput = () => this.renderRows();
        if (groupSearchEl) groupSearchEl.oninput = () => this.renderGroupList();
        if (csvEl) {
            csvEl.onchange = (e) => {
                this.currentCsvFile = String(e.target.value || '').trim();
                this.loadData();
            };
        }
        if (langEl) {
            langEl.onchange = (e) => {
                this.currentLanguage = String(e.target.value || 'Chinese');
                this.renderRows();
            };
        }
    },

    async loadData() {
        const summaryEl = document.getElementById('custom-text-summary');
        if (summaryEl) summaryEl.textContent = '加载中...';

        if (!window.pywebview?.api?.get_custom_text_data) {
            app.showAlert('错误', '后端接口不可用', 'error');
            if (summaryEl) summaryEl.textContent = '接口不可用';
            return;
        }

        try {
            const res = await pywebview.api.get_custom_text_data({
                csv_file: this.currentCsvFile
            });
            if (!res || !res.success) {
                const msg = (res && res.msg) ? res.msg : '加载失败';
                if (res && res.need_restart) {
                    app.showAlert('提示', msg, 'warn');
                } else {
                    app.showAlert('错误', msg, 'error');
                }
                if (summaryEl) summaryEl.textContent = msg;
                this.groups = [];
                this.groupMap = {};
                this.renderGroupList();
                this.renderRows();
                return;
            }

            this.csvFiles = Array.isArray(res.csv_files) ? res.csv_files : [];
            this.currentCsvFile = String(res.csv_file || this.currentCsvFile || 'menu.csv');
            this.renderCsvFileOptions(this.csvFiles);

            this.groups = Array.isArray(res.groups) ? res.groups : [];
            this.groupMap = {};
            this.groups.forEach(g => {
                const key = String(g.group || 'no_prefix');
                this.groupMap[key] = Array.isArray(g.items) ? g.items : [];
            });
            this.currentLanguage = String(res.default_language || 'Chinese');
            if (!this.currentGroup || !this.groupMap[this.currentGroup]) {
                this.currentGroup = this.groups.length > 0 ? String(this.groups[0].group || 'no_prefix') : '';
            }

            this.renderLanguageOptions(Array.isArray(res.language_keys) ? res.language_keys : ['Chinese']);
            this.renderGroupList();
            this.renderRows();

            if (summaryEl) {
                summaryEl.textContent = `${this.currentCsvFile} · 总计 ${Number(res.total || 0)} 条`;
            }
        } catch (e) {
            app.showAlert('错误', `加载失败: ${e.message || e}`, 'error');
            if (summaryEl) summaryEl.textContent = '加载失败';
        }
    },

    renderCsvFileOptions(files) {
        const csvEl = document.getElementById('custom-text-csv-file');
        if (!csvEl) return;
        csvEl.innerHTML = '';
        (files || []).forEach((f) => {
            const op = document.createElement('option');
            op.value = String(f);
            op.textContent = String(f);
            if (String(f) === this.currentCsvFile) op.selected = true;
            csvEl.appendChild(op);
        });
    },

    renderLanguageOptions(keys) {
        const langEl = document.getElementById('custom-text-language');
        if (!langEl) return;
        langEl.innerHTML = '';
        keys.forEach((k) => {
            const op = document.createElement('option');
            op.value = String(k);
            op.textContent = String(k);
            if (String(k) === this.currentLanguage) op.selected = true;
            langEl.appendChild(op);
        });
    },

    renderGroupList() {
        const listEl = document.getElementById('custom-text-groups-list');
        const groupSearchEl = document.getElementById('custom-text-group-search');
        if (!listEl) return;

        if (!this.groups.length) {
            listEl.innerHTML = '<div class="custom-text-empty">暂无数据</div>';
            return;
        }

        const keyword = String(groupSearchEl?.value || '').trim().toLowerCase();
        const displayGroups = this.groups.filter((g) => {
            const group = String(g.group || 'no_prefix').toLowerCase();
            return !keyword || group.includes(keyword);
        });

        if (!displayGroups.length) {
            listEl.innerHTML = '<div class="custom-text-empty">没有匹配的分组</div>';
            return;
        }

        listEl.innerHTML = displayGroups.map(g => {
            const group = String(g.group || 'no_prefix');
            const count = Array.isArray(g.items) ? g.items.length : 0;
            const active = group === this.currentGroup ? ' active' : '';
            return `<button class="custom-text-group-item${active}" data-group="${this.escapeHtml(group)}">${this.escapeHtml(group)}<span>${count}</span></button>`;
        }).join('');

        listEl.querySelectorAll('.custom-text-group-item').forEach(btn => {
            btn.onclick = () => {
                this.currentGroup = String(btn.dataset.group || '');
                this.renderGroupList();
                this.renderRows();
            };
        });
    },

    renderRows() {
        const tableEl = document.getElementById('custom-text-table');
        const searchEl = document.getElementById('custom-text-search');
        const summaryEl = document.getElementById('custom-text-summary');
        if (!tableEl) return;

        const rawItems = this.groupMap[this.currentGroup] || [];
        const keyword = String(searchEl?.value || '').trim().toLowerCase();
        const items = rawItems.filter((it) => {
            const id = String(it.id || '').toLowerCase();
            const val = String((it.languages && it.languages[this.currentLanguage]) || '').toLowerCase();
            return !keyword || id.includes(keyword) || val.includes(keyword);
        });

        if (!items.length) {
            tableEl.innerHTML = '<div class="custom-text-empty">当前分组没有可显示文本</div>';
            if (summaryEl) summaryEl.textContent = `分组 ${this.currentGroup || '-'}：0 条`;
            return;
        }

        tableEl.innerHTML = items.map((it, idx) => {
            const id = String(it.id || '');
            const val = String((it.languages && it.languages[this.currentLanguage]) || '');
            return `
                <div class="custom-text-row">
                    <div class="custom-text-id" title="${this.escapeHtml(id)}">${this.escapeHtml(id)}</div>
                    <textarea class="custom-text-input" data-id="${this.escapeHtml(id)}" data-index="${idx}">${this.escapeHtml(val)}</textarea>
                </div>
            `;
        }).join('');

        tableEl.querySelectorAll('.custom-text-input').forEach((el) => {
            el.oninput = () => {
                const id = String(el.dataset.id || '');
                const groupItems = this.groupMap[this.currentGroup] || [];
                const target = groupItems.find(x => String(x.id) === id);
                if (!target) return;
                if (!target.languages || typeof target.languages !== 'object') target.languages = {};
                target.languages[this.currentLanguage] = String(el.value || '');
            };
        });

        if (summaryEl) summaryEl.textContent = `分组 ${this.currentGroup || '-'}：${items.length} 条`;
    },

    async saveData() {
        if (!window.pywebview?.api?.save_custom_text_data) {
            app.showAlert('错误', '后端保存接口不可用', 'error');
            return;
        }

        const allItems = [];
        Object.values(this.groupMap).forEach((arr) => {
            (arr || []).forEach((it) => {
                allItems.push({
                    id: String(it.id || ''),
                    text: String((it.languages && it.languages[this.currentLanguage]) || '')
                });
            });
        });

        if (!allItems.length) {
            app.showAlert('提示', '没有可保存的数据', 'warn');
            return;
        }

        try {
            const res = await pywebview.api.save_custom_text_data({
                csv_file: this.currentCsvFile,
                language: this.currentLanguage,
                entries: allItems
            });
            if (res && res.success) {
                app.showAlert('成功', res.msg || '保存成功', 'success');
            } else {
                app.showAlert('错误', (res && res.msg) ? res.msg : '保存失败', 'error');
            }
        } catch (e) {
            app.showAlert('错误', `保存失败: ${e.message || e}`, 'error');
        }
    },

    show() {
        const view = document.getElementById(this.viewId);
        if (view) view.classList.add('active');
    },

    hide() {
        const view = document.getElementById(this.viewId);
        if (view) view.classList.remove('active');
    },

    destroy() {
        const view = document.getElementById(this.viewId);
        if (view) view.remove();
    },

    escapeHtml(text) {
        return String(text || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }
};

(function registerWhenReady() {
    if (typeof window !== 'undefined' && window.app && typeof window.app.registerResourcePage === 'function') {
        window.app.registerResourcePage('custom_text', CustomText);
        return;
    }
    setTimeout(registerWhenReady, 60);
})();
