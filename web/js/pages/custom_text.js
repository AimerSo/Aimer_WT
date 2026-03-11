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
                    <button class="btn-v2" id="btn-custom-text-backup" title="备份 / 还原"><i class="ri-archive-line"></i></button>
                    <button class="btn-v2" id="btn-custom-text-import" title="导入"><i class="ri-upload-2-line"></i></button>
                    <button class="btn-v2" id="btn-custom-text-export" title="导出"><i class="ri-download-2-line"></i></button>
                    <button class="btn-v2" id="btn-custom-text-reload" title="刷新"><i class="ri-refresh-line"></i></button>
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
        const importBtn = document.getElementById('btn-custom-text-import');
        const exportBtn = document.getElementById('btn-custom-text-export');
        const backupBtn = document.getElementById('btn-custom-text-backup');
        const searchEl = document.getElementById('custom-text-search');
        const groupSearchEl = document.getElementById('custom-text-group-search');
        const langEl = document.getElementById('custom-text-language');
        const csvEl = document.getElementById('custom-text-csv-file');

        if (reloadBtn) reloadBtn.onclick = () => this.loadData();
        if (saveBtn) saveBtn.onclick = () => this.saveData();
        if (importBtn) importBtn.onclick = () => this.importData();
        if (exportBtn) exportBtn.onclick = () => this.exportData();
        if (backupBtn) backupBtn.onclick = () => this.showBackupRestoreDialog();
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
            const fileName = typeof f === 'string' ? f : (f.name || '');
            const isModified = typeof f === 'object' && f.modified;
            op.value = String(fileName);
            op.textContent = isModified ? `★ ${fileName}` : String(fileName);
            if (String(fileName) === this.currentCsvFile) op.selected = true;
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
            const isModified = it.modified === true;
            const modifiedClass = isModified ? ' modified' : '';
            const modifiedMark = isModified ? '<span class="modified-mark" title="已修改">★</span>' : '';
            return `
                <div class="custom-text-row${modifiedClass}">
                    <div class="custom-text-id" title="${this.escapeHtml(id)}">${modifiedMark}${this.escapeHtml(id)}</div>
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

    async importData() {
        if (!window.pywebview?.api?.import_custom_text) {
            app.showAlert('错误', '后端导入接口不可用', 'error');
            return;
        }

        try {
            // 使用后端的文件选择对话框
            const result = await pywebview.api.select_custom_text_file();

            if (!result || !result.success || !result.file_path) {
                return; // 用户取消选择
            }

            const res = await pywebview.api.import_custom_text({
                file_path: result.file_path
            });

            if (res && res.success) {
                // 使用新的导入结果模态框
                this.showImportResult(res, result.file_path);
                // 重新加载数据
                this.loadData();
            } else {
                // 失败时也使用模态框展示
                this.showImportResult(res, result.file_path);
            }
        } catch (e) {
            app.showAlert('错误', `导入失败: ${e.message || e}`, 'error');
        }
    },

    async exportData() {
        if (!window.pywebview?.api?.select_custom_text_export_folder || !window.pywebview?.api?.export_custom_text_package) {
            app.showAlert('错误', '后端导出接口不可用', 'error');
            return;
        }

        try {
            const folderRes = await pywebview.api.select_custom_text_export_folder();
            if (!folderRes || !folderRes.success || !folderRes.folder_path) {
                return;
            }

            const res = await pywebview.api.export_custom_text_package({
                export_folder: folderRes.folder_path
            });

            if (res && res.success) {
                const msg = `${res.msg || '导出成功'}\nCSV: ${Number(res.csv_count || 0)} 个，BLK: ${Number(res.blk_count || 0)} 个\n${res.zip_path || ''}`;
                app.showAlert('成功', msg, 'success');
            } else {
                app.showAlert('错误', (res && res.msg) ? res.msg : '导出失败', 'error');
            }
        } catch (e) {
            app.showAlert('错误', `导出失败: ${e.message || e}`, 'error');
        }
    },

    async showBackupRestoreDialog() {
        // 拉取备份列表
        let backups = [];
        try {
            if (window.pywebview?.api?.get_custom_text_backups) {
                const res = await pywebview.api.get_custom_text_backups();
                if (res && res.success) backups = res.backups || [];
            }
        } catch (e) {
            console.error('获取备份列表失败:', e);
        }

        const existing = document.getElementById('modal-custom-text-backup');
        if (existing) existing.remove();

        const overlay = document.createElement('div');
        overlay.id = 'modal-custom-text-backup';
        overlay.className = 'modal-overlay show';
        overlay.onclick = (e) => {
            if (e.target === overlay) this.closeBackupRestoreDialog(overlay);
        };

        const modal = document.createElement('div');
        modal.className = 'modal-content custom-text-backup-modal';
        modal.onclick = (e) => e.stopPropagation();

        // 备份列表 HTML
        let backupListHtml = '';
        if (backups.length > 0) {
            backupListHtml = `
                <div class="custom-text-backup-list">
                    ${backups.map(b => `
                        <div class="custom-text-backup-item" data-name="${this.escapeHtml(b.name)}">
                            <div class="custom-text-backup-item-info">
                                <div class="custom-text-backup-item-name">
                                    <span class="custom-text-backup-file-icon"><i class="ri-file-zip-line"></i></span>
                                    <span>${this.escapeHtml(b.name)}</span>
                                </div>
                                <div class="custom-text-backup-item-meta">${this.escapeHtml(b.time)} · ${this.escapeHtml(b.size_kb)} KB</div>
                            </div>
                            <button class="btn primary custom-text-backup-restore-btn" data-name="${this.escapeHtml(b.name)}">
                                <i class="ri-history-line"></i>
                                <span>还原</span>
                            </button>
                        </div>
                    `).join('')}
                </div>
            `;
        } else {
            backupListHtml = `
                <div class="custom-text-backup-empty">
                    <div class="custom-text-backup-empty-icon"><i class="ri-inbox-archive-line"></i></div>
                    <div class="custom-text-backup-empty-title">暂无备份记录</div>
                    <div class="custom-text-backup-empty-text">先创建一份备份，之后就可以在这里快速还原。</div>
                </div>
            `;
        }

        modal.innerHTML = `
            <button class="modal-close-x custom-text-backup-close" id="backup-dialog-close" aria-label="关闭">
                <i class="ri-close-line"></i>
            </button>
            <div class="custom-text-backup-head">
                <div class="custom-text-backup-title-row">
                    <div class="custom-text-backup-title-block">
                        <h2 class="custom-text-backup-title">备份与还原</h2>
                        <p class="custom-text-backup-subtitle">统一管理当前自定义文本，手动备份并从历史快照恢复。</p>
                    </div>
                    <div class="custom-text-backup-head-stat" aria-label="历史备份数量">
                        <span class="custom-text-backup-head-stat-label">历史备份</span>
                        <strong class="custom-text-backup-head-stat-value">${backups.length}</strong>
                    </div>
                </div>
            </div>
            <div class="custom-text-backup-body">
                <div class="custom-text-backup-callout">
                    <div class="custom-text-backup-callout-mark">覆盖提示</div>
                    <div class="custom-text-backup-callout-text">
                        还原会覆盖当前 lang/aimerWT 中的自定义文本文件，建议先执行一次备份。
                    </div>
                </div>
                <div class="custom-text-backup-primary-panel">
                    <div class="custom-text-backup-primary-copy">
                        <div class="custom-text-backup-primary-label">手动创建快照</div>
                        <div class="custom-text-backup-primary-text">建议在导入、批量修改或还原之前先备份一次，方便快速回退。</div>
                    </div>
                    <button class="btn primary custom-text-backup-create-btn" id="btn-backup-create">
                        <i class="ri-save-3-line"></i>
                        <span>立即备份当前数据</span>
                    </button>
                </div>
                <div class="custom-text-backup-section">
                    <div class="custom-text-backup-section-head">
                        <div>
                            <div class="custom-text-backup-section-label">历史备份</div>
                            <div class="custom-text-backup-section-desc">按时间倒序显示最近保留的备份压缩包。</div>
                        </div>
                        <span class="custom-text-backup-count">${backups.length}</span>
                    </div>
                    ${backupListHtml}
                </div>
            </div>
            <div class="custom-text-backup-footer">
                <button class="btn secondary" id="btn-backup-dialog-done">关闭</button>
            </div>
        `;

        overlay.appendChild(modal);
        document.body.appendChild(overlay);

        // 绑定关闭
        modal.querySelector('#backup-dialog-close').onclick = () => this.closeBackupRestoreDialog(overlay);
        modal.querySelector('#btn-backup-dialog-done').onclick = () => this.closeBackupRestoreDialog(overlay);

        // 绑定"立即备份"
        modal.querySelector('#btn-backup-create').onclick = async () => {
            await this.backupData();
            this.closeBackupRestoreDialog(overlay);
            this.showBackupRestoreDialog();
        };

        // 绑定所有"还原"按钮
        modal.querySelectorAll('.custom-text-backup-restore-btn').forEach(btn => {
            btn.onclick = async () => {
                const zipName = btn.dataset.name;
                const ok = await app.showConfirmDialog(
                    '确认还原备份',
                    `将要还原备份：<strong style="color: var(--primary);">${this.escapeHtml(zipName)}</strong><br><br>还原后当前的自定义文本将被覆盖，是否继续？`
                );
                if (!ok) return;
                await this.restoreData(zipName);
                this.closeBackupRestoreDialog(overlay);
            };
        });
    },

    closeBackupRestoreDialog(overlay) {
        if (!overlay || overlay.dataset.closing === '1') return;
        overlay.dataset.closing = '1';
        overlay.classList.add('hiding');
        setTimeout(() => {
            overlay.remove();
        }, 220);
    },

    async backupData() {
        if (!window.pywebview?.api?.backup_custom_text) {
            app.showAlert('错误', '后端备份接口不可用', 'error');
            return;
        }
        try {
            const res = await pywebview.api.backup_custom_text();
            if (res && res.success) {
                app.showAlert('成功', res.msg || '备份成功', 'success');
            } else {
                app.showAlert('错误', (res && res.msg) ? res.msg : '备份失败', 'error');
            }
        } catch (e) {
            app.showAlert('错误', `备份失败: ${e.message || e}`, 'error');
        }
    },

    async restoreData(zipName) {
        if (!window.pywebview?.api?.restore_custom_text) {
            app.showAlert('错误', '后端还原接口不可用', 'error');
            return;
        }
        try {
            const res = await pywebview.api.restore_custom_text({ zip_name: zipName });
            if (res && res.success) {
                app.showAlert('成功', res.msg || '还原成功', 'success');
                this.loadData();
            } else {
                app.showAlert('错误', (res && res.msg) ? res.msg : '还原失败', 'error');
            }
        } catch (e) {
            app.showAlert('错误', `还原失败: ${e.message || e}`, 'error');
        }
    },

    showImportResult(result, originalFilePath) {
        // 解析导入结果
        const success = result.success || false;
        const mappingInfo = result.mapping_info || result.details || [];
        const importedCount = (result.imported_files || []).length;
        const skippedCount = (result.skipped_files || []).length;
        const skippedFiles = result.skipped_files || [];
        const tempDir = result.temp_dir || null;  // 临时目录路径

        // 分类处理映射信息
        const successItems = [];
        const warningItems = [];
        const errorItems = [];

        mappingInfo.forEach(info => {
            const infoStr = String(info);
            if (infoStr.startsWith('✓')) {
                successItems.push(infoStr.substring(1).trim());
            } else if (infoStr.startsWith('⚠')) {
                warningItems.push(infoStr.substring(1).trim());
            } else if (infoStr.startsWith('✗')) {
                errorItems.push(infoStr.substring(1).trim());
            } else {
                // 默认归类
                if (infoStr.includes('跳过') || infoStr.includes('无法识别')) {
                    warningItems.push(infoStr);
                } else if (infoStr.includes('失败')) {
                    errorItems.push(infoStr);
                } else {
                    successItems.push(infoStr);
                }
            }
        });

        // 创建模态框
        const overlay = document.createElement('div');
        overlay.className = 'import-result-overlay';
        overlay.onclick = (e) => {
            if (e.target === overlay) {
                this.closeImportResult(overlay, tempDir);
            }
        };

        const modal = document.createElement('div');
        modal.className = 'import-result-modal';
        modal.onclick = (e) => e.stopPropagation();

        // 确定图标类型
        let iconClass = 'success';
        let iconSymbol = '✓';
        let titleText = '导入成功';

        if (!success) {
            iconClass = 'error';
            iconSymbol = '✗';
            titleText = '导入失败';
        } else if (skippedCount > 0) {
            iconClass = 'warning';
            iconSymbol = '⚠';
            titleText = '部分导入成功';
        }

        // 构建HTML
        modal.innerHTML = `
            <div class="import-result-header">
                <div class="import-result-title">
                    <div class="import-result-icon ${iconClass}">${iconSymbol}</div>
                    <span>${titleText}</span>
                </div>
                <button class="import-result-close" onclick="CustomText.closeImportResult(this.closest('.import-result-overlay'), ${tempDir ? `'${tempDir}'` : 'null'})">×</button>
            </div>
            <div class="import-result-body">
                ${this.renderImportSummary(result, importedCount, skippedCount)}
                ${this.renderImportSection('成功导入', successItems, 'success')}
                ${this.renderImportSection('跳过文件', warningItems, 'warning')}
                ${this.renderImportSection('导入失败', errorItems, 'error')}
                ${skippedCount > 0 && tempDir ? this.renderSkippedFilesSection(skippedFiles, tempDir) : ''}
            </div>
            <div class="import-result-footer">
                <button class="import-result-btn import-result-btn-primary" onclick="CustomText.closeImportResult(this.closest('.import-result-overlay'), ${tempDir ? `'${tempDir}'` : 'null'})">
                    ${skippedCount > 0 && tempDir ? '稍后处理' : '确定'}
                </button>
            </div>
        `;

        overlay.appendChild(modal);
        document.body.appendChild(overlay);
    },

    renderSkippedFilesSection(skippedFiles, tempDir) {
        const fileListHtml = skippedFiles.map((fileName) => `
            <div class="manual-import-file-item">
                <label class="manual-import-file-label">
                    <input type="checkbox" class="manual-import-checkbox" value="${this.escapeHtml(fileName)}" checked>
                    <span class="manual-import-file-name">${this.escapeHtml(fileName)}</span>
                </label>
            </div>
        `).join('');

        return `
            <div class="import-result-section" style="margin-top: 24px;">
                <div class="manual-import-warning">
                    <div class="manual-import-warning-icon">!</div>
                    <div class="manual-import-warning-text">
                        <strong>是否导入这些文件？</strong><br>
                        以下文件无法自动识别，但可能是有效的自定义文本模组。<br>
                        确认后，这些文件将以<strong>原文件名</strong>直接导入到 <code>lang/aimerWT/</code> 目录，<br>
                        并在 <code>localization.blk</code> 中添加对应的引用路径。
                    </div>
                </div>
                <div class="import-result-section-title">
                    选择要导入的文件
                    <span class="import-result-section-badge warning">${skippedFiles.length}</span>
                </div>
                <div class="manual-import-files-list">
                    ${fileListHtml}
                </div>
                <div style="margin-top: 16px; display: flex; gap: 12px; justify-content: flex-end;">
                    <button class="import-result-btn import-result-btn-primary" onclick="CustomText.confirmManualImportInline(this, '${tempDir}')">
                        <i class="ri-check-line"></i> 确认导入选中的文件
                    </button>
                </div>
            </div>
        `;
    },

    closeImportResult(overlay, tempDir) {
        overlay.remove();

        // 如果有临时目录，通知后端清理
        if (tempDir) {
            this.cleanupTempDir(tempDir);
        }
    },

    async cleanupTempDir(tempDir) {
        try {
            if (window.pywebview?.api?.cleanup_import_temp) {
                await pywebview.api.cleanup_import_temp({ temp_dir: tempDir });
            }
        } catch (e) {
            console.error('清理临时目录失败:', e);
        }
    },

    confirmManualImportInline(buttonElement, tempDir) {
        const modal = buttonElement.closest('.import-result-modal');
        const checkboxes = modal.querySelectorAll('.manual-import-checkbox:checked');
        const selectedFiles = Array.from(checkboxes).map(cb => cb.value);

        if (selectedFiles.length === 0) {
            app.showAlert('提示', '未选择任何文件', 'warn');
            return;
        }

        // 关闭当前对话框
        const overlay = buttonElement.closest('.import-result-overlay');
        overlay.remove();

        // 执行导入
        this.executeManualImport(tempDir, selectedFiles);
    },

    async closeImportResult(overlay, tempDir) {
        // 如果有临时目录，清理它
        if (tempDir) {
            try {
                await pywebview.api.import_custom_text_manual({
                    selected_files: [],
                    temp_dir: tempDir
                });
            } catch (e) {
                console.error('清理临时目录失败:', e);
            }
        }
        overlay.remove();
    },

    async handleSkippedFiles(skippedFiles, originalFilePath) {
        // 这个方法已经不需要了，因为跳过的文件直接在结果对话框中处理
    },

    showManualImportDialog(skippedFiles, originalFilePath) {
        // 这个方法已经不需要了
    },

    async executeManualImport(tempDir, selectedFiles) {
        if (!selectedFiles || selectedFiles.length === 0) {
            app.showAlert('提示', '未选择任何文件', 'warn');
            return;
        }

        try {
            app.showAlert('提示', '正在导入，请稍候...', 'info');

            const res = await pywebview.api.import_custom_text_manual({
                selected_files: selectedFiles,
                temp_dir: tempDir
            });

            if (res && res.success) {
                this.showImportResult(res, null);
                this.loadData();
            } else {
                this.showImportResult(res, null);
            }
        } catch (e) {
            app.showAlert('错误', `导入失败: ${e.message || e}`, 'error');
        }
    },

    renderImportSummary(result, importedCount, skippedCount) {
        const msg = result.msg || '';
        const mode = result.mode || 'standard';
        const modeText = mode === 'custom_blk' ? '智能合并模式' : '标准模式';

        return `
            <div class="import-result-summary">
                <p class="import-result-summary-text">
                    ${this.escapeHtml(msg)}<br>
                    <span style="font-size: 13px; opacity: 0.8;">导入模式：${modeText}</span>
                </p>
            </div>
        `;
    },

    renderImportSection(title, items, type) {
        if (!items || items.length === 0) return '';

        const iconMap = {
            success: '✓',
            warning: '⚠',
            error: '✗'
        };

        const itemsHtml = items.map(item => {
            // 解析统计信息（如果有）
            const statsMatch = item.match(/\(新增 (\d+) 条, 修改 (\d+) 条\)/);
            let mainText = item;
            let statsHtml = '';

            if (statsMatch) {
                mainText = item.replace(statsMatch[0], '').trim();
                const added = statsMatch[1];
                const modified = statsMatch[2];
                statsHtml = `
                    <div class="import-result-item-stats">
                        <span class="import-result-item-stat">
                            <span class="import-result-item-stat-value">+${added}</span> 新增
                        </span>
                        <span class="import-result-item-stat">
                            <span class="import-result-item-stat-value">${modified}</span> 修改
                        </span>
                    </div>
                `;
            }

            return `
                <div class="import-result-item">
                    <div class="import-result-item-icon ${type}">${iconMap[type]}</div>
                    <div class="import-result-item-content">
                        <div class="import-result-item-text">${this.escapeHtml(mainText)}</div>
                        ${statsHtml}
                    </div>
                </div>
            `;
        }).join('');

        return `
            <div class="import-result-section">
                <div class="import-result-section-title">
                    ${title}
                    <span class="import-result-section-badge ${type}">${items.length}</span>
                </div>
                <div class="import-result-items">
                    ${itemsHtml}
                </div>
            </div>
        `;
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
