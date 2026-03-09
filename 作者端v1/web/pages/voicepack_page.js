window.AuthorPageModules = window.AuthorPageModules || {};

window.AuthorPageModules.voicepack = {
    _inited: false,
    _query: "",
    _packs: [],

    init(app) {
        this._app = app;
        this.bindUi();
    },

    onEnter() {
        this.bindUi();
        this.loadWorkspace();
        this.refreshList();
    },

    bindUi() {
        if (this._inited) return;

        const search = document.getElementById("voicepack-search-input");
        const refreshBtn = document.getElementById("btn-voicepack-refresh");
        const createBtn = document.getElementById("btn-voicepack-create");
        const openLibBtn = document.getElementById("btn-voicepack-open-library");
        const statsBtn = document.getElementById("btn-voicepack-stats");
        const importBtn = document.getElementById("btn-voicepack-import-bank");
        const importInput = document.getElementById("voicepack-bank-file-input");

        if (search) {
            search.addEventListener("input", (e) => {
                this._query = String(e.target.value || "").trim();
                this.refreshList();
            });
        }

        if (refreshBtn) refreshBtn.addEventListener("click", () => this.refreshList(true));

        if (createBtn) {
            createBtn.addEventListener("click", async () => {
                const res = await this._app.showInputDialog({
                    title: "新建语音包文件夹",
                    message: "请输入语音包文件夹名称",
                    inputLabel: "文件夹名称",
                    placeholder: "例如：莉可丽丝"
                });
                if (!res?.ok) return;
                const name = String(res.value || "").trim();
                if (!name) return;
                await this.createFolder(name);
            });
        }

        if (openLibBtn) {
            openLibBtn.addEventListener("click", async () => {
                try {
                    const res = await window.pywebview?.api?.open_voicepack_library?.();
                    if (!res?.success) this._app.notifyToast("warn", res?.msg || "打开失败");
                } catch (_e) {
                    this._app.notifyToast("warn", "打开语音包库目录失败");
                }
            });
        }

        if (statsBtn) {
            statsBtn.addEventListener("click", () => {
                this._app.notifyToast("info", `当前语音包总数：${this._packs.length}`);
            });
        }

        if (importBtn && importInput) {
            importBtn.addEventListener("click", () => {
                importInput.value = "";
                importInput.click();
            });
            importInput.addEventListener("change", async (e) => {
                const file = e?.target?.files?.[0];
                if (!file) return;
                await this.importBankFile(file);
            });
        }

        this._inited = true;
    },

    async importBankFile(file) {
        if (!window.pywebview?.api?.import_voicepack_bank) {
            this._app.notifyToast("warn", "后端导入 API 不可用");
            return;
        }

        try {
            const dataUrl = await this._app.readFileAsDataUrl(file);
            const res = await window.pywebview.api.import_voicepack_bank(file.name, dataUrl);
            if (!res?.success) {
                this._app.notifyToast("warn", res?.msg || "导入失败");
                return;
            }
            this._app.notifyToast("success", `导入成功：${res.name || file.name}`);
            await this.refreshList(true);
        } catch (_e) {
            this._app.notifyToast("warn", "导入失败");
        }
    },

    async loadWorkspace() {
        try {
            const data = await window.pywebview?.api?.get_voicepack_workspace?.();
            if (!data) return;

            const workspaceEl = document.getElementById("settings-workspace-dir");
            const libEl = document.getElementById("settings-library-dir");
            if (workspaceEl) workspaceEl.textContent = String(data.workspace_dir || "-");
            if (libEl) libEl.textContent = String(data.library_dir || "-");
        } catch (_e) {
            // ignore
        }
    },

    async refreshList(manual = false) {
        const list = document.getElementById("voicepack-list");
        if (!list) return;
        if (manual) this._app.notifyToast("info", "正在刷新语音包库...");

        try {
            const rows = await window.pywebview?.api?.get_voicepack_list?.(this._query || "");
            this._packs = Array.isArray(rows) ? rows : [];
            this.renderList();

            const stat = document.getElementById("voicepack-pack-count");
            if (stat) stat.textContent = `统计：${this._packs.length} 个语音包`;
        } catch (_e) {
            this._packs = [];
            this.renderEmpty("读取语音包库失败");
        }
    },

    renderEmpty(message = "暂无语音包文件夹") {
        const list = document.getElementById("voicepack-list");
        if (!list) return;

        list.innerHTML = `
            <div class="voicepack-empty">
                <i class="ri-folder-unknow-line" style="font-size:30px;"></i>
                <h3 style="margin:0;font-size:15px;color:#334155;">${this._app.escapeHtml(message)}</h3>
                <p style="margin:0;font-size:12px;">可点击「新建语音包文件夹」开始创建。</p>
            </div>
        `;
    },

    renderList() {
        const list = document.getElementById("voicepack-list");
        if (!list) return;

        if (!this._packs.length) {
            this.renderEmpty(this._query ? "未找到匹配的语音包" : "暂无语音包文件夹");
            return;
        }

        const html = this._packs.map((pack) => {
            const cover = this._app.escapeHtml(pack.cover_url || "assets/card_image.png");
            const name = this._app.escapeHtml(pack.name || "");
            const title = this._app.escapeHtml(pack.title || pack.name || "未命名语音包");
            const folderLabel = this._app.escapeHtml(`（文件夹名：${pack.name || ""}）`);
            const author = this._app.escapeHtml(pack.author || "未知作者");
            const version = this._app.escapeHtml(String(pack.version || "1.0"));
            const date = this._app.escapeHtml(pack.date || "-");
            const size = this._app.escapeHtml(pack.size_str || "<1 MB");
            const hasInfo = Boolean(pack.has_info);

            return `
                <article class="voicepack-pack-card" data-pack-name="${name}">
                    <img class="voicepack-pack-cover" src="${cover}" alt="${title}" onerror="this.src='assets/card_image.png'">
                    <div class="voicepack-pack-main">
                        <div class="voicepack-pack-title-row">
                            <div class="voicepack-pack-title">${title}</div>
                            <div class="voicepack-pack-folder-name" title="${name}">${folderLabel}</div>
                        </div>
                        <div class="voicepack-pack-meta">
                            <span><i class="ri-user-3-line"></i> ${author}</span>
                            <span><i class="ri-price-tag-3-line"></i> v${version}</span>
                            <span><i class="ri-hard-drive-2-line"></i> ${size}</span>
                            <span><i class="ri-time-line"></i> ${date}</span>
                        </div>
                        <div class="voicepack-pack-status">
                            <span class="voicepack-dot ${hasInfo ? "" : "warn"}"></span>
                            <span>${hasInfo ? "已识别配置文件" : "未识别配置文件（点击后自动创建）"}</span>
                        </div>
                    </div>
                    <div class="voicepack-pack-actions">
                        <button class="voicepack-mini-btn" type="button" title="打开目录" data-action="open"><i class="ri-folder-open-line"></i></button>
                        <button class="voicepack-mini-btn" type="button" title="重命名" data-action="rename"><i class="ri-edit-2-line"></i></button>
                        <button class="voicepack-mini-btn danger" type="button" title="删除" data-action="delete"><i class="ri-delete-bin-line"></i></button>
                    </div>
                </article>
            `;
        }).join("");

        list.innerHTML = html;
        this.bindCardEvents();
    },

    bindCardEvents() {
        const list = document.getElementById("voicepack-list");
        if (!list) return;

        list.querySelectorAll(".voicepack-pack-card").forEach((card) => {
            card.addEventListener("click", async (e) => {
                const actionBtn = e.target.closest("[data-action]");
                const name = card.getAttribute("data-pack-name") || "";
                if (!name) return;

                if (actionBtn) {
                    e.stopPropagation();
                    const action = actionBtn.getAttribute("data-action") || "";
                    if (action === "open") return this.openFolder(name);
                    if (action === "rename") {
                        const title = card.querySelector(".voicepack-pack-title")?.textContent || name;
                        return this.renamePack(name, title);
                    }
                    if (action === "delete") return this.deleteFolder(name);
                    return;
                }

                await this.openForEdit(name);
            });
        });
    },

    async createFolder(name) {
        try {
            const res = await window.pywebview?.api?.create_voicepack_folder?.(name);
            if (!res?.success) {
                this._app.notifyToast("warn", res?.msg || "创建失败");
                return;
            }
            this._app.notifyToast("success", `已创建：${res.name}`);
            await this.refreshList();
        } catch (_e) {
            this._app.notifyToast("warn", "创建语音包文件夹失败");
        }
    },

    async renamePack(folderName, currentTitle) {
        const dialog = await this._app.showChoiceInputDialog({
            title: "重命名语音包",
            message: `当前语音包名称：${currentTitle}\n当前文件夹名：${folderName}`,
            inputLabel: "新名称",
            value: currentTitle,
            choiceValue: "title",
            choicesCompact: true,
            choiceDefaults: {
                title: currentTitle,
                folder: folderName
            },
            choices: [
                { value: "title", title: "改语音包名称", description: "" },
                { value: "folder", title: "改文件夹名", description: "" }
            ]
        });
        if (!dialog?.ok) return;
        const next = String(dialog.value || "").trim();
        const mode = String(dialog.choice || "title").trim() || "title";
        const currentValue = mode === "folder" ? folderName : currentTitle;
        if (!next || next === currentValue) return;

        try {
            const res = mode === "folder"
                ? await window.pywebview?.api?.rename_voicepack_folder?.(folderName, next)
                : await window.pywebview?.api?.rename_voicepack_title?.(folderName, next);
            if (!res?.success) {
                this._app.notifyToast("warn", res?.msg || "重命名失败");
                return;
            }
            this._app.notifyToast("success", "重命名成功");
            if (mode === "folder" && this._app.currentVoicepackName === folderName) {
                this._app.setCurrentVoicepackContext(next);
            }
            if (mode === "title" && this._app.currentVoicepackName === folderName) {
                this._app.state.modForm.title = next;
                this._app.persistState();
                this._app.syncVoiceFormInputs();
                this._app.renderPreviewLists();
            }
            await this.refreshList();
        } catch (_e) {
            this._app.notifyToast("warn", "重命名失败");
        }
    },

    async deleteFolder(name) {
        const ok = await this._app.showConfirmDialog({
            title: "确认删除",
            message: `确认删除语音包文件夹「${name}」？\n该操作不可撤销。`,
            confirmText: "删除",
            cancelText: "取消"
        });
        if (!ok) return;

        try {
            const res = await window.pywebview?.api?.delete_voicepack_folder?.(name);
            if (!res?.success) {
                this._app.notifyToast("warn", res?.msg || "删除失败");
                return;
            }
            this._app.notifyToast("success", "删除成功");
            await this.refreshList();
        } catch (_e) {
            this._app.notifyToast("warn", "删除失败");
        }
    },

    async openFolder(name) {
        try {
            const res = await window.pywebview?.api?.open_voicepack_item?.(name);
            if (!res?.success) this._app.notifyToast("warn", res?.msg || "打开目录失败");
        } catch (_e) {
            this._app.notifyToast("warn", "打开目录失败");
        }
    },

    async openForEdit(name) {
        try {
            const res = await window.pywebview?.api?.load_voicepack_for_edit?.(name);
            if (!res?.success) {
                this._app.notifyToast("warn", res?.msg || "加载语音包配置失败");
                return;
            }

            this._app.applyVoicepackToEditor(res);
            this._app.switchPage("voiceinfo");
            this._app.notifyToast("success", res.created ? "已自动创建配置并进入编辑" : "已加载语音包配置");
        } catch (_e) {
            this._app.notifyToast("warn", "加载语音包配置失败");
        }
    },
};
