
const STORAGE_KEY = "aimerwt_author_v1_state";
const FALLBACK_AVATAR = "assets/avatar_placeholder.svg";
const DEFAULT_COVER = "assets/card_image.png";
const MODAL_ID = "modal-mod-preview";
const AUTHOR_WORKS_MODAL_ID = "modal-author-works";
const PROFILE_MODAL_ID = "profile-modal";
const PROFILE_CROP_MODAL_ID = "profile-crop-modal";
const MODAL_FADE_MS = 180;
const MAX_LANGUAGE_COUNT = 3;
const MAX_PREVIEW_AUDIO_COUNT = 3;
const MAX_RELATED_PACK_COUNT = 2;
const MAX_RELATED_DESC_LENGTH = 50;
const RELATED_AVATAR_FALLBACK = "assets/avatar_placeholder.svg";

const HOME_LINK_META = [
    { id: "bilibili", name: "B站主页", icon: "ri-bilibili-line", tone: "home-icon-bili" },
    { id: "wtlive", name: "WT Live", icon: "ri-broadcast-line", tone: "home-icon-live" },
    { id: "wtliker", name: "WT Liker", icon: "ri-heart-3-line", tone: "home-icon-liker" },
    { id: "fans", name: "粉丝群", icon: "ri-team-line", tone: "home-icon-fans" },
    { id: "contact", name: "联系方式", icon: "ri-message-3-line", tone: "home-icon-contact", full: true }
];

const AVAILABLE_TAGS = ["陆战", "空战", "海战", "无线电", "导弹音效", "音乐包", "降噪包", "飞行员语音"];

const AVAILABLE_LANGS = [
    { label: "中", value: "中" },
    { label: "英", value: "英" },
    { label: "俄", value: "俄" },
    { label: "德", value: "德" },
    { label: "日", value: "日" },
    { label: "法", value: "法" },
    { label: "意", value: "意" },
    { label: "瑞", value: "瑞" },
    { label: "西", value: "西" }
];

const LANG_CLASS_MAP = {
    "中": "lang-cn",
    "英": "lang-us",
    "美": "lang-us",
    "俄": "lang-ru",
    "德": "lang-de",
    "日": "lang-jp",
    "法": "lang-fr"
};

const LANG_ALIAS_MAP = {
    "中文": "中",
    "简体中文": "中",
    "chinese": "中",
    "cn": "中",
    "英文": "英",
    "英语": "英",
    "english": "英",
    "en": "英",
    "俄语": "俄",
    "russian": "俄",
    "ru": "俄",
    "德语": "德",
    "german": "德",
    "de": "德",
    "日语": "日",
    "japanese": "日",
    "jp": "日",
    "法语": "法",
    "french": "法",
    "fr": "法",
    "意语": "意",
    "意大利语": "意",
    "italian": "意",
    "it": "意",
    "瑞典语": "瑞",
    "swedish": "瑞",
    "se": "瑞",
    "西语": "西",
    "西班牙语": "西",
    "spanish": "西",
    "es": "西"
};

const TOOLBOX_OPTIONS = {
    "img-to-webp": {
        label: "图片转WebP"
    }
};

const DEFAULT_STATE = {
    profile: {
        name: "AimerWT",
        avatar: FALLBACK_AVATAR,
        desc: "主页信息会自动注入语音包卡片预览，点击编辑按钮可更新名称与头像。",
        links: {
            bilibili: "",
            wtlive: "",
            wtliker: "",
            fans: "",
            contact: ""
        }
    },
    modForm: {
        title: "测试语音包",
        author: "",
        version: "2.53",
        date: new Date().toISOString().split("T")[0],
        size_str: "<1 MB",
        tags: ["陆战", "空战", "海战", "无线电", "导弹音效", "音乐包", "降噪包", "飞行员语音"],
        language: [],
        note: "这里是卡片摘要，支持实时编辑预览。",
        full_desc: "这里是语音包详情介绍区域，编辑后会同步到右侧详情预览中。",
        version_note: [
            { version: "2.53", note: "新增预览同步" },
            { version: "2.52", note: "修复样式细节" }
        ],
        cover_url: "",
        link_bilibili: "",
        link_wtlive: "",
        link_video: "",
        link_qq_group: "",
        link_liker: "",
        link_feedback: "",
        preview_use_random_bank: true,
        preview_audio_files: [],
        related_voicepacks: []
    }
};

const app = {
    _initDone: false,
    _actionsBound: false,
    _navBound: false,
    _sidebarBound: false,
    _homeBound: false,
    _voiceInfoBound: false,
    _staticButtonsBound: false,
    _toolboxBound: false,
    _previewBound: false,
    _sidebarAnimTimer: null,
    _previewAnimTimer: null,
    _saveTimer: null,
    _modalTimers: new Map(),
    _pageModulesReady: false,
    _guideReady: false,
    _dialogResolver: null,
    _dialogRejecter: null,
    _dialogKeyHandler: null,
    _profileCrop: {
        image: null,
        zoom: 1,
        x: 0,
        y: 0,
        dataUrl: ""
    },

    currentPage: "home",
    sidebarCollapsed: false,
    homeSaved: false,
    previewExpanded: false,
    currentToolboxOption: "img-to-webp",
    _profilePendingAvatar: "",
    currentVoicepackName: "",

    state: JSON.parse(JSON.stringify(DEFAULT_STATE)),
    previewModMap: new Map(),
    pageModules: new Map(),

    async init() {
        if (this._initDone) return;

        this.loadState();
        this.normalizeStateSchema();
        this.bindWindowActions();
        this.bindDialogModal();
        this.bindNavigation();
        this.bindSidebarToggle();
        this.bindHomeProfile();
        this.bindVoiceInfoEditor();
        this.bindStaticButtons();
        this.bindToolboxDropdown();
        this.initPageModules();
        this.bindCardPreviewClick();
        this.bindVoiceinfoPreviewToggle();

        this.renderHomeProfile();
        this.renderHomeLinks();
        this.syncVoiceFormInputs();
        this.renderTagChoices();
        this.renderLanguageChoices();
        this.renderVersionNoteEditor();
        this.renderMainPreviewAudioEditor();
        this.renderRelatedPackEditor();
        this.renderPreviewLists();
        this.refreshHomeInfoCards();
        this.setVoiceinfoPreviewExpanded(false);
        this.setCurrentVoicepackContext("");
        this.runPageEnterHook(this.currentPage);

        await this.loadAppInfo();
        this.initGuideSystem();
        this._initDone = true;
    },

    loadState() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return;
            const parsed = JSON.parse(raw);
            this.state = this.mergeState(DEFAULT_STATE, parsed);
        } catch (_e) {
            this.state = JSON.parse(JSON.stringify(DEFAULT_STATE));
        }
    },

    normalizeStateSchema() {
        if (!this.state || typeof this.state !== "object") {
            this.state = JSON.parse(JSON.stringify(DEFAULT_STATE));
            return;
        }

        const profile = this.state.profile || (this.state.profile = {});
        profile.name = String(profile.name || DEFAULT_STATE.profile.name);
        profile.avatar = String(profile.avatar || DEFAULT_STATE.profile.avatar);
        profile.desc = String(profile.desc || DEFAULT_STATE.profile.desc);
        profile.links = this.mergeState(DEFAULT_STATE.profile.links, profile.links || {});

        const form = this.state.modForm || (this.state.modForm = {});
        form.title = String(form.title || DEFAULT_STATE.modForm.title);
        form.author = String(form.author || "");
        form.version = this.normalizeVersion(form.version || DEFAULT_STATE.modForm.version);
        form.date = String(form.date || DEFAULT_STATE.modForm.date);
        form.size_str = String(form.size_str || DEFAULT_STATE.modForm.size_str) || DEFAULT_STATE.modForm.size_str;
        form.cover_url = String(form.cover_url || "");
        form.note = String(form.note || DEFAULT_STATE.modForm.note);
        form.full_desc = String(form.full_desc || DEFAULT_STATE.modForm.full_desc);
        form.link_bilibili = String(form.link_bilibili || "");
        form.link_wtlive = String(form.link_wtlive || "");
        form.link_video = String(form.link_video || "");
        form.link_qq_group = String(form.link_qq_group || "");
        form.link_liker = String(form.link_liker || "");
        form.link_feedback = String(form.link_feedback || "");
        form.preview_audio_files = this.normalizePreviewAudioList(form.preview_audio_files);
        form.preview_use_random_bank = this.normalizePreviewUseRandomBank(
            form.preview_use_random_bank,
            null,
            form.preview_audio_files
        );
        form.related_voicepacks = this.normalizeRelatedVoicepacks(form.related_voicepacks);

        form.tags = this.normalizeTagList(form.tags);
        form.language = this.normalizeLanguageList(form.language);
        form.version_note = this.normalizeVersionNoteArray(form.version_note, form.version);

        this.persistState();
    },

    normalizeTagList(raw) {
        const list = Array.isArray(raw) ? raw : this.parseList(raw);
        const normalized = list.map((v) => String(v || "").trim()).filter(Boolean);
        return normalized.length ? normalized : ["陆战"];
    },

    normalizeLanguageList(raw) {
        const allowed = new Set(AVAILABLE_LANGS.map((item) => item.value));
        const list = Array.isArray(raw) ? raw : this.parseList(raw);
        const normalized = [...new Set(list.map((v) => {
            const token = String(v || "").trim();
            if (!token) return "";
            const key = token.toLowerCase();
            return LANG_ALIAS_MAP[key] || token;
        }).filter((token) => allowed.has(token)))].slice(0, MAX_LANGUAGE_COUNT);
        return normalized;
    },

    normalizeVersionNoteArray(raw, fallbackVersion) {
        let entries = [];

        if (Array.isArray(raw)) {
            entries = raw
                .map((item) => ({
                    version: this.normalizeVersion(String(item?.version || "").trim() || fallbackVersion || ""),
                    note: String(item?.note || "").trim()
                }))
                .filter((item) => item.version || item.note);
        } else if (typeof raw === "string") {
            entries = this.splitVersionNoteText(raw).map((item) => ({
                version: this.normalizeVersion(item.version || fallbackVersion || ""),
                note: item.note
            }));
        }

        if (!entries.length) {
            entries = [{ version: this.normalizeVersion(fallbackVersion || "1.0"), note: "暂无详细更新日志。" }];
        }
        return entries;
    },

    normalizePreviewAudioList(raw, maxCount = MAX_PREVIEW_AUDIO_COUNT) {
        const arr = Array.isArray(raw) ? raw : [];
        return arr.slice(0, maxCount).map((item, idx) => ({
            display_name: String(item?.display_name || `试听音频${idx + 1}`).trim() || `试听音频${idx + 1}`,
            source_name: String(item?.source_name || "").trim(),
            source_file: String(item?.source_file || "").trim(),
            output_bank_name: String(item?.output_bank_name || "").trim(),
            ext: String(item?.ext || "").trim().toLowerCase(),
            audio_data_url: String(item?.audio_data_url || "").trim()
        }));
    },

    normalizePreviewUseRandomBank(raw, fallback = null, previewAudioFiles = null) {
        if (typeof raw === "boolean") return raw;
        if (typeof raw === "number") return Boolean(raw);
        const text = String(raw || "").trim().toLowerCase();
        if (["1", "true", "yes", "on", "random"].includes(text)) return true;
        if (["0", "false", "no", "off", "manual"].includes(text)) return false;

        if (typeof fallback === "boolean") return fallback;
        if (typeof fallback === "number") return Boolean(fallback);
        const fallbackText = String(fallback || "").trim().toLowerCase();
        if (["1", "true", "yes", "on", "random"].includes(fallbackText)) return true;
        if (["0", "false", "no", "off", "manual"].includes(fallbackText)) return false;

        const list = this.normalizePreviewAudioList(previewAudioFiles || []);
        return list.length === 0;
    },

    normalizeRelatedVoicepacks(raw) {
        const arr = Array.isArray(raw) ? raw : [];
        return arr.slice(0, MAX_RELATED_PACK_COUNT).map((item, idx) => ({
            name: String(item?.name || `关联语音包${idx + 1}`).trim() || `关联语音包${idx + 1}`,
            description: String(item?.description || "").trim().slice(0, MAX_RELATED_DESC_LENGTH),
            link: this.normalizeLink(String(item?.link || "").trim()),
            avatar_file: String(item?.avatar_file || "").trim(),
            avatar_url: String(item?.avatar_url || "").trim(),
            preview_audio_files: this.normalizePreviewAudioList(item?.preview_audio_files || [], MAX_PREVIEW_AUDIO_COUNT)
        }));
    },

    createEmptyPreviewAudio(index) {
        return {
            display_name: `试听音频${index}`,
            source_name: "",
            source_file: "",
            output_bank_name: "",
            ext: "",
            audio_data_url: ""
        };
    },

    createEmptyRelatedPack(index) {
        return {
            name: `关联语音包${index}`,
            description: "",
            link: "",
            avatar_file: "",
            avatar_url: "",
            preview_audio_files: []
        };
    },

    persistState() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(this.buildPersistableState()));
        } catch (_e) {
            // ignore
        }
    },

    buildPersistableState() {
        const cloned = JSON.parse(JSON.stringify(this.state || {}));
        const modForm = cloned?.modForm || {};
        const previews = Array.isArray(modForm.preview_audio_files) ? modForm.preview_audio_files : [];
        previews.forEach((item) => { delete item.audio_data_url; });
        const related = Array.isArray(modForm.related_voicepacks) ? modForm.related_voicepacks : [];
        related.forEach((row) => {
            const list = Array.isArray(row.preview_audio_files) ? row.preview_audio_files : [];
            list.forEach((item) => { delete item.audio_data_url; });
        });
        return cloned;
    },

    mergeState(base, patch) {
        if (Array.isArray(base)) return Array.isArray(patch) ? [...patch] : [...base];
        const out = { ...base };
        Object.keys(out).forEach((key) => {
            const bv = out[key];
            const pv = patch && Object.prototype.hasOwnProperty.call(patch, key) ? patch[key] : undefined;
            if (pv === undefined) return;
            if (Array.isArray(bv)) out[key] = Array.isArray(pv) ? [...pv] : [...bv];
            else if (bv && typeof bv === "object") out[key] = this.mergeState(bv, pv || {});
            else out[key] = pv;
        });
        return out;
    },
    bindWindowActions() {
        if (this._actionsBound) return;
        const guideBtn = document.getElementById("btn-guide-help");
        const pinBtn = document.getElementById("btn-pin-title");
        const minimizeBtn = document.getElementById("btn-minimize");
        const closeBtn = document.getElementById("btn-close");
        if (guideBtn) guideBtn.addEventListener("click", () => this.startGuide(true));
        if (pinBtn) pinBtn.addEventListener("click", () => this.togglePin());
        if (minimizeBtn) minimizeBtn.addEventListener("click", () => this.minimizeApp());
        if (closeBtn) closeBtn.addEventListener("click", () => this.closeApp());
        this._actionsBound = true;
    },

    bindDialogModal() {
        const modal = document.getElementById("author-dialog-modal");
        if (!modal || modal.dataset.bound === "1") return;
        modal.dataset.bound = "1";

        const closeBtn = document.getElementById("author-dialog-close");
        const cancelBtn = document.getElementById("author-dialog-cancel");
        const confirmBtn = document.getElementById("author-dialog-confirm");

        const onCancel = () => this._finishDialog({ ok: false, value: "" });
        const onConfirm = () => {
            const input = document.getElementById("author-dialog-input");
            const selectedChoice = document.querySelector("input[name='author-dialog-choice']:checked");
            this._finishDialog({
                ok: true,
                value: String(input?.value || ""),
                choice: String(selectedChoice?.value || "")
            });
        };

        if (closeBtn) closeBtn.addEventListener("click", onCancel);
        if (cancelBtn) cancelBtn.addEventListener("click", onCancel);
        if (confirmBtn) confirmBtn.addEventListener("click", onConfirm);
        modal.addEventListener("click", (e) => { if (e.target === modal) onCancel(); });
    },

    showConfirmDialog(options = {}) {
        return this._openDialog({
            mode: "confirm",
            title: options.title || "提示",
            message: options.message || "",
            confirmText: options.confirmText || "确定",
            cancelText: options.cancelText || "取消",
            value: ""
        }).then((res) => Boolean(res?.ok));
    },

    showInputDialog(options = {}) {
        return this._openDialog({
            mode: "input",
            title: options.title || "请输入",
            message: options.message || "",
            inputLabel: options.inputLabel || "内容",
            placeholder: options.placeholder || "",
            value: String(options.value || ""),
            confirmText: options.confirmText || "确定",
            cancelText: options.cancelText || "取消"
        });
    },

    showChoiceInputDialog(options = {}) {
        return this._openDialog({
            mode: "choice-input",
            title: options.title || "请选择",
            message: options.message || "",
            inputLabel: options.inputLabel || "内容",
            placeholder: options.placeholder || "",
            value: String(options.value || ""),
            choiceValue: String(options.choiceValue || ""),
            choices: Array.isArray(options.choices) ? options.choices : [],
            choicesCompact: Boolean(options.choicesCompact),
            choiceDefaults: options.choiceDefaults || {},
            confirmText: options.confirmText || "确定",
            cancelText: options.cancelText || "取消"
        });
    },

    _openDialog(options) {
        return new Promise((resolve) => {
            this.bindDialogModal();
            const modal = document.getElementById("author-dialog-modal");
            const titleEl = document.getElementById("author-dialog-title");
            const msgEl = document.getElementById("author-dialog-message");
            const optionsWrap = document.getElementById("author-dialog-options-wrap");
            const optionsEl = document.getElementById("author-dialog-options");
            const inputWrap = document.getElementById("author-dialog-input-wrap");
            const inputLabel = document.getElementById("author-dialog-input-label");
            const input = document.getElementById("author-dialog-input");
            const cancelBtn = document.getElementById("author-dialog-cancel");
            const confirmBtn = document.getElementById("author-dialog-confirm");
            if (!modal || !titleEl || !msgEl || !cancelBtn || !confirmBtn) {
                resolve({ ok: false, value: "" });
                return;
            }

            if (this._dialogResolver) {
                this._finishDialog({ ok: false, value: "" });
            }

            titleEl.textContent = String(options.title || "提示");
            msgEl.textContent = String(options.message || "");
            cancelBtn.textContent = String(options.cancelText || "取消");
            confirmBtn.textContent = String(options.confirmText || "确定");

            const choices = Array.isArray(options.choices) ? options.choices.filter((item) => item && item.value) : [];
            const selectedChoice = String(options.choiceValue || choices[0]?.value || "");
            const choiceDefaults = options.choiceDefaults && typeof options.choiceDefaults === "object"
                ? options.choiceDefaults
                : {};
            if (optionsWrap && optionsEl) {
                if (choices.length > 0) {
                    optionsEl.innerHTML = choices.map((item) => {
                        const value = String(item.value || "");
                        const checked = value === selectedChoice ? "checked" : "";
                        const optionClass = options.choicesCompact ? "author-dialog-option compact" : "author-dialog-option";
                        return `
                            <label class="${optionClass}">
                                <input type="radio" name="author-dialog-choice" value="${this.escapeHtml(value)}" ${checked}>
                                <span class="author-dialog-option-text">
                                    <span class="author-dialog-option-title">${this.escapeHtml(item.title || value)}</span>
                                    <span class="author-dialog-option-desc">${this.escapeHtml(item.description || "")}</span>
                                </span>
                            </label>
                        `;
                    }).join("");
                    optionsWrap.style.display = "block";
                    if (input) {
                        optionsEl.querySelectorAll("input[name='author-dialog-choice']").forEach((radio) => {
                            radio.addEventListener("change", () => {
                                const nextValue = choiceDefaults[radio.value];
                                if (typeof nextValue === "string") {
                                    input.value = nextValue;
                                    requestAnimationFrame(() => input.select());
                                }
                            });
                        });
                    }
                } else {
                    optionsEl.innerHTML = "";
                    optionsWrap.style.display = "none";
                }
            }

            const showInput = String(options.mode) === "input" || String(options.mode) === "choice-input";
            if (showInput) {
                if (inputWrap) inputWrap.style.display = "";
                if (inputLabel) inputLabel.textContent = String(options.inputLabel || "内容");
                if (input) {
                    input.value = String(options.value || "");
                    input.placeholder = String(options.placeholder || "");
                }
            } else {
                if (inputWrap) inputWrap.style.display = "none";
                if (input) input.value = "";
            }

            this._dialogResolver = resolve;
            this.showOverlay(modal);

            if (input && showInput) {
                requestAnimationFrame(() => input.focus());
            }

            if (this._dialogKeyHandler) {
                window.removeEventListener("keydown", this._dialogKeyHandler);
            }
            this._dialogKeyHandler = (e) => {
                if (e.key === "Escape") {
                    e.preventDefault();
                    this._finishDialog({ ok: false, value: "" });
                }
                if (e.key === "Enter") {
                    if (!showInput || (document.activeElement && document.activeElement.id === "author-dialog-input")) {
                        e.preventDefault();
                        const v = String(input?.value || "");
                        const selected = document.querySelector("input[name='author-dialog-choice']:checked");
                        this._finishDialog({ ok: true, value: v, choice: String(selected?.value || "") });
                    }
                }
            };
            window.addEventListener("keydown", this._dialogKeyHandler);
        });
    },

    _finishDialog(result) {
        const modal = document.getElementById("author-dialog-modal");
        if (modal) this.hideOverlay(modal);
        if (this._dialogKeyHandler) {
            window.removeEventListener("keydown", this._dialogKeyHandler);
            this._dialogKeyHandler = null;
        }
        const resolver = this._dialogResolver;
        this._dialogResolver = null;
        if (resolver) resolver(result || { ok: false, value: "" });
    },

    bindNavigation() {
        if (this._navBound) return;
        document.querySelectorAll(".side-item[data-page], .side-sub-item[data-page]").forEach((item) => {
            item.addEventListener("click", () => this.switchPage(item.getAttribute("data-page")));
        });
        document.querySelectorAll(".side-dropdown-toggle").forEach((item) => {
            item.addEventListener("click", () => {
                const parent = item.closest(".side-dropdown");
                if (!parent) return;
                const subPages = String(parent.getAttribute("data-subpages") || "")
                    .split(",").map((v) => v.trim()).filter(Boolean);
                const currentInGroup = subPages.includes(this.currentPage);
                const isOpen = parent.classList.contains("open");

                if (currentInGroup) {
                    parent.classList.toggle("open", !isOpen);
                    return;
                }

                parent.classList.add("open");
                if (subPages.length > 0) this.switchPage(subPages[0]);
            });
        });
        this._navBound = true;
    },

    switchPage(page) {
        if (page === this.currentPage) return;
        document.querySelectorAll(".side-item[data-page], .side-sub-item[data-page]").forEach((item) => {
            item.classList.toggle("active", item.getAttribute("data-page") === page);
        });
        document.querySelectorAll(".side-dropdown").forEach((group) => {
            const subPages = String(group.getAttribute("data-subpages") || "")
                .split(",")
                .map((v) => v.trim())
                .filter(Boolean);
            const matched = subPages.includes(page);
            group.classList.toggle("active", matched);
            if (matched) group.classList.add("open");
        });
        document.querySelectorAll(".page").forEach((p) => {
            p.classList.toggle("active", p.id === `page-${page}`);
        });
        this.currentPage = page;
        if (page === "voiceinfo") this.renderPreviewLists();
        this.runPageEnterHook(page);
    },

    initPageModules() {
        if (this._pageModulesReady) return;
        const modules = window.AuthorPageModules || {};
        Object.keys(modules).forEach((page) => {
            const mod = modules[page];
            if (!mod || typeof mod !== "object") return;
            this.pageModules.set(page, mod);
            if (typeof mod.init === "function") mod.init(this);
        });
        this._pageModulesReady = true;
    },

    runPageEnterHook(page) {
        const mod = this.pageModules.get(page);
        if (mod && typeof mod.onEnter === "function") mod.onEnter(this);
    },

    bindVoiceinfoPreviewToggle() {
        const btn = document.getElementById("btn-voiceinfo-preview-toggle");
        if (!btn || btn.dataset.bound === "1") return;
        btn.dataset.bound = "1";
        btn.addEventListener("click", () => this.setVoiceinfoPreviewExpanded(!this.previewExpanded));
    },

    setVoiceinfoPreviewExpanded(expanded) {
        this.previewExpanded = Boolean(expanded);
        const wb = document.getElementById("voiceinfo-workbench");
        const btn = document.getElementById("btn-voiceinfo-preview-toggle");
        const icon = document.getElementById("icon-voiceinfo-preview-toggle");
        if (this.previewExpanded && !this.sidebarCollapsed) this.forceSidebarCollapsed(true);
        if (wb) {
            wb.classList.add("preview-transitioning");
            requestAnimationFrame(() => {
                wb.classList.toggle("preview-collapsed", !this.previewExpanded);
            });
            if (this._previewAnimTimer) clearTimeout(this._previewAnimTimer);
            this._previewAnimTimer = setTimeout(() => {
                wb.classList.remove("preview-transitioning");
                this._previewAnimTimer = null;
            }, 380);
        }
        if (btn) {
            btn.classList.toggle("active", this.previewExpanded);
            btn.title = this.previewExpanded ? "折叠预览" : "展开预览";
        }
        if (icon) icon.className = this.previewExpanded ? "ri-arrow-right-s-line" : "ri-arrow-left-s-line";
    },

    bindSidebarToggle() {
        if (this._sidebarBound) return;
        const toggleBtn = document.getElementById("sidebar-toggle");
        if (toggleBtn) toggleBtn.addEventListener("click", () => this.toggleSidebar());
        this._sidebarBound = true;
    },

    toggleSidebar() {
        const sidebar = document.getElementById("sidebar");
        if (!sidebar || sidebar.classList.contains("is-animating")) return;
        sidebar.classList.add("is-animating");
        this.sidebarCollapsed = !this.sidebarCollapsed;
        sidebar.classList.toggle("collapsed", this.sidebarCollapsed);
        if (!this.sidebarCollapsed && this.previewExpanded) this.setVoiceinfoPreviewExpanded(false);
        if (this._sidebarAnimTimer) clearTimeout(this._sidebarAnimTimer);
        this._sidebarAnimTimer = setTimeout(() => {
            sidebar.classList.remove("is-animating");
            this._sidebarAnimTimer = null;
        }, 340);
    },

    forceSidebarCollapsed(collapsed) {
        const sidebar = document.getElementById("sidebar");
        if (!sidebar) return;
        this.sidebarCollapsed = Boolean(collapsed);
        sidebar.classList.toggle("collapsed", this.sidebarCollapsed);
    },

    bindHomeProfile() {
        if (this._homeBound) return;

        const saveBtn = document.getElementById("home-save-btn");
        if (saveBtn) {
            saveBtn.addEventListener("click", () => {
                this.persistState();
                this.homeSaved = true;
                this.refreshSaveButton();
                if (this._saveTimer) clearTimeout(this._saveTimer);
                this._saveTimer = setTimeout(() => {
                    this.homeSaved = false;
                    this.refreshSaveButton();
                    this._saveTimer = null;
                }, 1800);
                this.notifyToast("success", "保存成功");
            });
        }

        const openBtn = document.getElementById("btn-profile-edit");
        if (openBtn) openBtn.addEventListener("click", () => this.openProfileModal());

        const closeBtn = document.getElementById("btn-profile-close");
        if (closeBtn) closeBtn.addEventListener("click", () => this.closeProfileModal());

        const cancelBtn = document.getElementById("btn-profile-cancel");
        if (cancelBtn) cancelBtn.addEventListener("click", () => this.closeProfileModal());

        const saveProfileBtn = document.getElementById("btn-profile-save");
        if (saveProfileBtn) saveProfileBtn.addEventListener("click", () => this.saveProfileModal());

        const modal = document.getElementById(PROFILE_MODAL_ID);
        if (modal) modal.addEventListener("click", (e) => { if (e.target === modal) this.closeProfileModal(); });

        const modalName = document.getElementById("profile-modal-name");
        const modalFile = document.getElementById("profile-modal-avatar-file");
        const previewAvatar = document.getElementById("profile-modal-preview-avatar");
        const cropZoom = document.getElementById("profile-crop-zoom");
        const cropX = document.getElementById("profile-crop-x");
        const cropY = document.getElementById("profile-crop-y");
        const cropModal = document.getElementById(PROFILE_CROP_MODAL_ID);
        const cropClose = document.getElementById("btn-profile-crop-close");
        const cropCancel = document.getElementById("btn-profile-crop-cancel");
        const cropApply = document.getElementById("btn-profile-crop-apply");
        const previewFn = () => this.renderProfileModalPreview();
        if (modalName) modalName.addEventListener("input", previewFn);
        if (modalFile) modalFile.addEventListener("change", (e) => this.handleProfileAvatarFile(e));
        if (previewAvatar) previewAvatar.addEventListener("click", () => this.openProfileCropFromCurrentAvatar());
        if (cropZoom) cropZoom.addEventListener("input", (e) => this.onCropSliderChange("zoom", e.target.value));
        if (cropX) cropX.addEventListener("input", (e) => this.onCropSliderChange("x", e.target.value));
        if (cropY) cropY.addEventListener("input", (e) => this.onCropSliderChange("y", e.target.value));
        if (cropClose) cropClose.addEventListener("click", () => this.closeProfileCropModal());
        if (cropCancel) cropCancel.addEventListener("click", () => this.closeProfileCropModal());
        if (cropApply) cropApply.addEventListener("click", () => this.applyProfileCropModal());
        if (cropModal) cropModal.addEventListener("click", (e) => { if (e.target === cropModal) this.closeProfileCropModal(); });
        this.bindCropCanvasDrag();

        this.refreshSaveButton();
        this._homeBound = true;
    },

    openProfileModal() {
        const modal = document.getElementById(PROFILE_MODAL_ID);
        if (!modal) return;
        const profile = this.state.profile;
        const nameInput = document.getElementById("profile-modal-name");
        const fileInput = document.getElementById("profile-modal-avatar-file");
        const cropZoom = document.getElementById("profile-crop-zoom");
        const cropX = document.getElementById("profile-crop-x");
        const cropY = document.getElementById("profile-crop-y");
        if (nameInput) nameInput.value = String(profile.name || "");
        if (fileInput) fileInput.value = "";
        this._profilePendingAvatar = String(profile.avatar || "").trim() || FALLBACK_AVATAR;
        this._profileCrop.image = null;
        this._profileCrop.zoom = 1;
        this._profileCrop.x = 0;
        this._profileCrop.y = 0;
        this._profileCrop.dataUrl = "";
        if (cropZoom) cropZoom.value = "100";
        if (cropX) cropX.value = "0";
        if (cropY) cropY.value = "0";
        this.drawProfileCropCanvas();
        this.renderProfileModalPreview();
        this.showOverlay(modal);
    },

    closeProfileModal() {
        const modal = document.getElementById(PROFILE_MODAL_ID);
        if (modal) this.hideOverlay(modal);
        this.closeProfileCropModal();
    },

    renderProfileModalPreview() {
        const nameInput = document.getElementById("profile-modal-name");
        const previewAvatar = document.getElementById("profile-modal-preview-avatar");
        const previewName = document.getElementById("profile-modal-preview-name");

        const name = String(nameInput?.value || "").trim() || "AimerWT";
        const avatar = this.getProfileAvatarFromModal() || FALLBACK_AVATAR;
        if (previewName) previewName.textContent = name;
        if (previewAvatar) {
            previewAvatar.src = avatar;
            previewAvatar.onerror = () => { previewAvatar.src = FALLBACK_AVATAR; };
        }
    },

    saveProfileModal() {
        const nameInput = document.getElementById("profile-modal-name");
        this.state.profile.name = String(nameInput?.value || "").trim() || "AimerWT";
        this.state.profile.avatar = this.getProfileAvatarFromModal() || FALLBACK_AVATAR;
        this.persistState();
        this.homeSaved = true;
        this.refreshSaveButton();
        this.renderHomeProfile();
        this.renderPreviewLists();
        this.closeProfileModal();
        this.notifyToast("success", "保存成功");
    },

    getProfileAvatarFromModal() {
        if (this._profileCrop.dataUrl) return this._profileCrop.dataUrl;
        return String(this._profilePendingAvatar || "").trim() || FALLBACK_AVATAR;
    },

    onCropSliderChange(field, value) {
        if (field === "zoom") this._profileCrop.zoom = Math.max(1, Number(value || 100) / 100);
        if (field === "x") this._profileCrop.x = Math.max(-1, Math.min(1, Number(value || 0) / 100));
        if (field === "y") this._profileCrop.y = Math.max(-1, Math.min(1, Number(value || 0) / 100));
        this.drawProfileCropCanvas();
        this.renderProfileModalPreview();
    },

    async handleProfileAvatarFile(e) {
        const file = e?.target?.files?.[0];
        if (!file) return;
        if (!file.type || !file.type.startsWith("image/")) {
            this.notifyToast("warn", "请选择图片文件");
            return;
        }

        try {
            const reader = new FileReader();
            const dataUrl = await new Promise((resolve, reject) => {
                reader.onload = () => resolve(String(reader.result || ""));
                reader.onerror = reject;
                reader.readAsDataURL(file);
            });
            const image = await this.loadImage(dataUrl);
            this._profileCrop.image = image;
            this._profileCrop.zoom = 1;
            this._profileCrop.x = 0;
            this._profileCrop.y = 0;
            this._profileCrop.dataUrl = "";
            const cropZoom = document.getElementById("profile-crop-zoom");
            const cropX = document.getElementById("profile-crop-x");
            const cropY = document.getElementById("profile-crop-y");
            if (cropZoom) cropZoom.value = "100";
            if (cropX) cropX.value = "0";
            if (cropY) cropY.value = "0";
            this.drawProfileCropCanvas();
            this.openProfileCropModal();
        } catch (_e) {
            this.notifyToast("warn", "头像读取失败");
        }
    },

    async openProfileCropFromCurrentAvatar() {
        const current = this.getProfileAvatarFromModal();
        if (!current || current === FALLBACK_AVATAR) {
            const fileInput = document.getElementById("profile-modal-avatar-file");
            if (fileInput) fileInput.click();
            return;
        }
        try {
            const image = await this.loadImage(current);
            this._profileCrop.image = image;
            this._profileCrop.zoom = 1;
            this._profileCrop.x = 0;
            this._profileCrop.y = 0;
            this._profileCrop.dataUrl = "";
            const cropZoom = document.getElementById("profile-crop-zoom");
            const cropX = document.getElementById("profile-crop-x");
            const cropY = document.getElementById("profile-crop-y");
            if (cropZoom) cropZoom.value = "100";
            if (cropX) cropX.value = "0";
            if (cropY) cropY.value = "0";
            this.drawProfileCropCanvas();
            this.openProfileCropModal();
        } catch (_e) {
            this.notifyToast("warn", "头像读取失败");
        }
    },

    openProfileCropModal() {
        const modal = document.getElementById(PROFILE_CROP_MODAL_ID);
        if (modal) this.showOverlay(modal);
    },

    closeProfileCropModal() {
        const modal = document.getElementById(PROFILE_CROP_MODAL_ID);
        if (modal) this.hideOverlay(modal);
    },

    applyProfileCropModal() {
        if (this._profileCrop.dataUrl) {
            this._profilePendingAvatar = this._profileCrop.dataUrl;
            this.renderProfileModalPreview();
        }
        this.closeProfileCropModal();
    },

    loadImage(src) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = reject;
            img.src = src;
        });
    },

    readFileAsDataUrl(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result || ""));
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    },

    bindCropCanvasDrag() {
        const canvas = document.getElementById("profile-crop-canvas");
        if (!canvas || canvas.dataset.dragBound === "1") return;
        canvas.dataset.dragBound = "1";

        let dragging = false;
        let startX = 0;
        let startY = 0;
        let baseX = 0;
        let baseY = 0;

        const onMove = (clientX, clientY) => {
            if (!dragging) return;
            const dx = (clientX - startX) / Math.max(canvas.width, 1);
            const dy = (clientY - startY) / Math.max(canvas.height, 1);
            this._profileCrop.x = Math.max(-1, Math.min(1, baseX + dx * 2));
            this._profileCrop.y = Math.max(-1, Math.min(1, baseY + dy * 2));
            const cropX = document.getElementById("profile-crop-x");
            const cropY = document.getElementById("profile-crop-y");
            if (cropX) cropX.value = String(Math.round(this._profileCrop.x * 100));
            if (cropY) cropY.value = String(Math.round(this._profileCrop.y * 100));
            this.drawProfileCropCanvas();
            this.renderProfileModalPreview();
        };

        canvas.addEventListener("mousedown", (e) => {
            if (!this._profileCrop.image) return;
            dragging = true;
            startX = e.clientX;
            startY = e.clientY;
            baseX = this._profileCrop.x;
            baseY = this._profileCrop.y;
        });
        window.addEventListener("mousemove", (e) => onMove(e.clientX, e.clientY));
        window.addEventListener("mouseup", () => { dragging = false; });

        canvas.addEventListener("touchstart", (e) => {
            if (!this._profileCrop.image) return;
            const t = e.touches?.[0];
            if (!t) return;
            dragging = true;
            startX = t.clientX;
            startY = t.clientY;
            baseX = this._profileCrop.x;
            baseY = this._profileCrop.y;
        }, { passive: true });

        window.addEventListener("touchmove", (e) => {
            const t = e.touches?.[0];
            if (!t) return;
            onMove(t.clientX, t.clientY);
        }, { passive: true });
        window.addEventListener("touchend", () => { dragging = false; });
    },

    drawProfileCropCanvas() {
        const canvas = document.getElementById("profile-crop-canvas");
        if (!canvas) return;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        const w = canvas.width;
        const h = canvas.height;
        ctx.clearRect(0, 0, w, h);
        ctx.fillStyle = "#0f172a";
        ctx.fillRect(0, 0, w, h);

        const image = this._profileCrop.image;
        if (!image) {
            this._profileCrop.dataUrl = "";
            ctx.fillStyle = "#94a3b8";
            ctx.font = "14px sans-serif";
            ctx.textAlign = "center";
            ctx.fillText("上传头像后可拖拽裁剪", w / 2, h / 2);
            return;
        }

        const baseScale = Math.max(w / image.width, h / image.height);
        const scale = baseScale * (this._profileCrop.zoom || 1);
        const drawW = image.width * scale;
        const drawH = image.height * scale;
        const cx = w / 2 + this._profileCrop.x * (w * 0.35);
        const cy = h / 2 + this._profileCrop.y * (h * 0.35);
        const drawX = cx - drawW / 2;
        const drawY = cy - drawH / 2;

        ctx.drawImage(image, drawX, drawY, drawW, drawH);
        ctx.strokeStyle = "rgba(255,255,255,0.9)";
        ctx.lineWidth = 2;
        ctx.strokeRect(1, 1, w - 2, h - 2);
        this._profileCrop.dataUrl = canvas.toDataURL("image/png", 0.92);
    },

    markHomeUnsaved() {
        this.homeSaved = false;
        this.refreshSaveButton();
        this.persistState();
    },

    renderHomeProfile() {
        const profile = this.state.profile;
        const name = String(profile.name || "AimerWT").trim() || "AimerWT";
        const desc = String(profile.desc || "").trim() || DEFAULT_STATE.profile.desc;
        const avatar = String(profile.avatar || "").trim() || FALLBACK_AVATAR;

        const homeName = document.getElementById("home-name");
        const homeDesc = document.getElementById("home-desc");
        const homeAvatar = document.getElementById("home-avatar");
        if (homeName) homeName.textContent = name;
        if (homeDesc) homeDesc.textContent = desc;
        if (homeAvatar) {
            homeAvatar.src = avatar;
            homeAvatar.onerror = () => { homeAvatar.src = FALLBACK_AVATAR; };
        }
    }, renderHomeLinks() {
        const grid = document.getElementById("home-links-grid");
        if (!grid) return;

        const activeInput = document.activeElement && document.activeElement.classList.contains("home-link-input")
            ? document.activeElement
            : null;
        const activeId = activeInput ? activeInput.getAttribute("data-link-id") : null;
        const cursorPos = activeInput ? activeInput.selectionStart : null;

        grid.innerHTML = `
            <div class="home-links-card">
                ${HOME_LINK_META.map((item) => {
            const raw = this.state.profile.links[item.id] || "";
            const safeValue = this.escapeHtml(raw);
            const openUrl = this.normalizeLink(raw);
            const openLink = openUrl
                ? `<a class="home-link-open" href="${this.escapeHtml(openUrl)}" target="_blank" rel="noreferrer" title="打开链接"><i class="ri-external-link-line"></i></a>`
                : "";

            return `
                        <div class="home-link-row">
                            <div class="home-link-head">
                                <span class="home-link-label">${this.escapeHtml(item.name)}</span>
                                ${openLink}
                            </div>
                            <div class="home-link-input-wrap">
                                <div class="home-link-icon ${this.escapeHtml(item.tone)}"><i class="${this.escapeHtml(item.icon)}"></i></div>
                                <input
                                    class="home-link-input"
                                    data-link-id="${this.escapeHtml(item.id)}"
                                    type="text"
                                    value="${safeValue}"
                                    placeholder="请输入${this.escapeHtml(item.name)}地址"
                                >
                            </div>
                        </div>
                    `;
        }).join("")}
            </div>
        `;

        grid.querySelectorAll(".home-link-input").forEach((input) => {
            input.addEventListener("input", (e) => {
                const id = e.target.getAttribute("data-link-id");
                this.state.profile.links[id] = e.target.value;
                this.markHomeUnsaved();
                this.renderHomeLinks();
                this.renderPreviewLists();
                this.refreshHomeInfoCards();
            });
        });

        if (activeId) {
            const input = grid.querySelector(`.home-link-input[data-link-id="${activeId}"]`);
            if (input) {
                input.focus();
                const pos = Math.min(cursorPos ?? input.value.length, input.value.length);
                input.setSelectionRange(pos, pos);
            }
        }
    },

    refreshSaveButton() {
        const btn = document.getElementById("home-save-btn");
        if (!btn) return;
        btn.classList.toggle("saved", this.homeSaved);
        btn.innerHTML = '<i class="ri-save-3-line"></i><span>保存</span>';
    },

    refreshHomeInfoCards(appInfo = null) {
        const _info = appInfo || this._appInfoCache || {};
        const version = "v1 Beta 作者端";
        const homepageUrl = "https://space.bilibili.com/1379084732?spm_id_from=333.337.0.0";
        const updated = String(this.state?.modForm?.date || "-") || "-";

        this.updateInfo("info-version", version);
        this.updateInfoLink("info-author-link", "作者主页", homepageUrl);
        this.updateInfoLink("info-fans-link", "1080968086", homepageUrl);
        this.updateInfo("info-updated", updated);
    },

    bindVoiceInfoEditor() {
        if (this._voiceInfoBound) return;

        document.querySelectorAll("[data-mod-field]").forEach((el) => {
            if (el.hasAttribute("readonly")) return;
            const handler = () => {
                const key = el.getAttribute("data-mod-field");
                this.state.modForm[key] = el.value;
                this.persistState();
                this.renderPreviewLists();
            };
            el.addEventListener("input", handler);
            el.addEventListener("change", handler);
        });

        const addVersionBtn = document.getElementById("btn-add-version-note");
        if (addVersionBtn) {
            addVersionBtn.addEventListener("click", () => {
                this.state.modForm.version_note.push({ version: this.normalizeVersion(this.state.modForm.version), note: "" });
                this.persistState();
                this.renderVersionNoteEditor();
                this.renderPreviewLists();
            });
        }

        this.bindModCoverUpload();
        this._voiceInfoBound = true;
    },

    syncVoiceFormInputs() {
        document.querySelectorAll("[data-mod-field]").forEach((el) => {
            const key = el.getAttribute("data-mod-field");
            const value = this.state.modForm[key] ?? "";
            if (el.value !== value) el.value = value;
        });
        this.updateModCoverFileHint();
        this.renderMainPreviewAudioEditor();
        this.renderRelatedPackEditor();
    },

    bindModCoverUpload() {
        const fileInput = document.getElementById("mod-cover-file");
        const clearBtn = document.getElementById("btn-mod-cover-clear");

        if (fileInput && fileInput.dataset.bound !== "1") {
            fileInput.dataset.bound = "1";
            fileInput.addEventListener("change", (e) => this.handleModCoverFileChange(e));
        }

        if (clearBtn && clearBtn.dataset.bound !== "1") {
            clearBtn.dataset.bound = "1";
            clearBtn.addEventListener("click", () => this.clearModCoverImage());
        }

        this.updateModCoverFileHint();
    },

    async handleModCoverFileChange(e) {
        const file = e?.target?.files?.[0];
        if (!file) return;
        if (!file.type || !file.type.startsWith("image/")) {
            this.notifyToast("warn", "请选择图片文件");
            return;
        }
        try {
            const reader = new FileReader();
            const dataUrl = await new Promise((resolve, reject) => {
                reader.onload = () => resolve(String(reader.result || ""));
                reader.onerror = reject;
                reader.readAsDataURL(file);
            });
            if (!dataUrl || !String(dataUrl).startsWith("data:image/")) throw new Error("invalid_image_data");
            this.state.modForm.cover_url = dataUrl;
            this.persistState();
            this.renderPreviewLists();
            this.updateModCoverFileHint(file.name);
            this.notifyToast("success", "封面图已更新");
        } catch (_e) {
            this.notifyToast("error", "封面图读取失败");
        }
    },

    clearModCoverImage() {
        const fileInput = document.getElementById("mod-cover-file");
        this.state.modForm.cover_url = "";
        if (fileInput) fileInput.value = "";
        this.persistState();
        this.renderPreviewLists();
        this.updateModCoverFileHint();
        this.notifyToast("info", "已恢复默认封面");
    },

    updateModCoverFileHint(fileName = "") {
        const hint = document.getElementById("mod-cover-file-name");
        if (!hint) return;
        const cover = String(this.state?.modForm?.cover_url || "").trim();
        if (fileName) {
            hint.textContent = `当前：${fileName}`;
            return;
        }
        if (!cover) {
            hint.textContent = "当前：默认封面";
            return;
        }
        if (cover.startsWith("data:image/")) {
            hint.textContent = "当前：已上传图片";
            return;
        }
        hint.textContent = "当前：已设置封面";
    },

    renderTagChoices() {
        const wrap = document.getElementById("mod-tags-choices");
        if (!wrap) return;
        const selected = this.state.modForm.tags || [];

        wrap.innerHTML = AVAILABLE_TAGS.map((tag) => {
            const active = selected.includes(tag);
            return `<button class="choice-chip tag-chip${active ? " active" : ""}" type="button" data-tag-value="${this.escapeHtml(tag)}">${this.escapeHtml(tag)}</button>`;
        }).join("");

        wrap.querySelectorAll("[data-tag-value]").forEach((btn) => {
            btn.addEventListener("click", () => {
                const value = btn.getAttribute("data-tag-value") || "";
                const tags = Array.isArray(this.state.modForm.tags) ? [...this.state.modForm.tags] : [];
                const exists = tags.includes(value);
                this.state.modForm.tags = exists ? tags.filter((t) => t !== value) : [...tags, value];
                if (!this.state.modForm.tags.length) this.state.modForm.tags = ["陆战"];
                this.persistState();
                this.renderTagChoices();
                this.renderPreviewLists();
            });
        });
    },

    renderLanguageChoices() {
        const wrap = document.getElementById("mod-language-choices");
        const counter = document.getElementById("lang-count");
        if (!wrap) return;
        const selected = Array.isArray(this.state.modForm.language) ? this.state.modForm.language : [];
        if (counter) counter.textContent = `${selected.length} / ${MAX_LANGUAGE_COUNT}`;

        wrap.innerHTML = AVAILABLE_LANGS.map((lang) => {
            const active = selected.includes(lang.value);
            const locked = !active && selected.length >= MAX_LANGUAGE_COUNT;
            return `
                <button
                    class="choice-chip lang-chip${active ? " active" : ""}${locked ? " disabled" : ""}"
                    type="button"
                    data-lang-value="${this.escapeHtml(lang.value)}"
                    ${locked ? "disabled" : ""}
                >
                    ${this.escapeHtml(lang.label)}
                </button>
            `;
        }).join("");

        wrap.querySelectorAll("[data-lang-value]").forEach((btn) => {
            btn.addEventListener("click", () => {
                const value = btn.getAttribute("data-lang-value") || "";
                const langs = Array.isArray(this.state.modForm.language) ? [...this.state.modForm.language] : [];
                const exists = langs.includes(value);
                if (exists) this.state.modForm.language = langs.filter((item) => item !== value);
                else if (langs.length < MAX_LANGUAGE_COUNT) this.state.modForm.language = [...langs, value];
                this.persistState();
                this.renderLanguageChoices();
                this.renderPreviewLists();
            });
        });
    },
    renderVersionNoteEditor() {
        const wrap = document.getElementById("mod-version-note-list");
        if (!wrap) return;

        const notes = Array.isArray(this.state.modForm.version_note) ? this.state.modForm.version_note : [];
        if (!notes.length) this.state.modForm.version_note = [{ version: this.normalizeVersion(this.state.modForm.version), note: "" }];
        const finalNotes = this.state.modForm.version_note;

        wrap.innerHTML = finalNotes.map((item, index) => {
            const version = this.escapeHtml(item.version || "");
            const note = this.escapeHtml(item.note || "");
            return `
                <div class="version-note-item" data-note-index="${index}">
                    <div class="version-note-head">
                        <input class="voiceinfo-input version-note-version" type="text" value="${version}" placeholder="版本号 2.53">
                        <button class="chip-action-btn danger" type="button" data-note-delete="${index}">
                            <i class="ri-delete-bin-line"></i>
                            <span>删除</span>
                        </button>
                    </div>
                    <textarea class="voiceinfo-textarea version-note-text" rows="3" placeholder="填写该版本更新内容...">${note}</textarea>
                </div>
            `;
        }).join("");

        wrap.querySelectorAll(".version-note-item").forEach((row) => {
            const idx = Number(row.getAttribute("data-note-index"));
            const versionInput = row.querySelector(".version-note-version");
            const noteInput = row.querySelector(".version-note-text");
            const deleteBtn = row.querySelector("[data-note-delete]");

            if (versionInput) {
                versionInput.addEventListener("input", (e) => {
                    if (!this.state.modForm.version_note[idx]) return;
                    this.state.modForm.version_note[idx].version = this.normalizeVersion(e.target.value || "");
                    this.persistState();
                    this.renderPreviewLists();
                });
            }

            if (noteInput) {
                noteInput.addEventListener("input", (e) => {
                    if (!this.state.modForm.version_note[idx]) return;
                    this.state.modForm.version_note[idx].note = e.target.value;
                    this.persistState();
                    this.renderPreviewLists();
                });
            }

            if (deleteBtn) {
                deleteBtn.addEventListener("click", () => {
                    this.state.modForm.version_note = this.state.modForm.version_note.filter((_, i) => i !== idx);
                    if (!this.state.modForm.version_note.length) {
                        this.state.modForm.version_note = [{ version: this.normalizeVersion(this.state.modForm.version), note: "" }];
                    }
                    this.persistState();
                    this.renderVersionNoteEditor();
                    this.renderPreviewLists();
                });
            }
        });
    },

    renderMainPreviewAudioEditor() {
        const wrap = document.getElementById("mod-main-preview-audio-list");
        const manualFields = document.getElementById("main-preview-audio-manual-fields");
        const modeBtn = document.getElementById("btn-main-preview-mode");
        const modeHint = document.getElementById("main-preview-mode-hint");
        if (!wrap) return;
        const list = this.normalizePreviewAudioList(this.state.modForm.preview_audio_files);
        this.state.modForm.preview_audio_files = list;
        const useRandom = this.normalizePreviewUseRandomBank(
            this.state.modForm.preview_use_random_bank,
            null,
            list
        );
        this.state.modForm.preview_use_random_bank = useRandom;

        if (modeBtn) {
            modeBtn.classList.toggle("active", useRandom);
            modeBtn.textContent = useRandom ? "已开启随机试听" : "作者自定义试听";
        }
        if (modeHint) {
            modeHint.textContent = useRandom
                ? "主软件会从语音包里的全部可试听条目中随机抽取试听，不再需要单独上传主语音包试听文件。"
                : "当前使用作者自定义试听文件，主软件只会播放你在这里提供的样音。";
        }
        if (manualFields) manualFields.hidden = useRandom;

        if (useRandom) {
            wrap.innerHTML = '<div class="preview-audio-hint">已启用随机试听，主软件将自动从全部语音条目中随机抽取。</div>';
            return;
        }

        if (!list.length) {
            wrap.innerHTML = '<div class="preview-audio-hint">暂无试听文件，点击“添加试听”可添加 mp3/wav。</div>';
            return;
        }

        wrap.innerHTML = list.map((item, idx) => {
            const display = this.escapeHtml(item.display_name || "");
            const sourceName = this.escapeHtml(item.source_name || "未选择文件");
            return `
                <div class="preview-audio-item" data-preview-index="${idx}">
                    <div>
                        <div class="preview-audio-index">第 ${idx + 1} 个文件</div>
                        <div class="preview-audio-hint">导出别名后缀 Preview_${idx + 1}</div>
                    </div>
                    <div class="voiceinfo-field">
                        <input class="voiceinfo-input" type="text" data-action="preview-name" value="${display}" placeholder="例如：车长音频${idx + 1}">
                        <input class="voiceinfo-input" type="file" data-action="preview-file" accept=".mp3,.wav,audio/mpeg,audio/wav">
                        <small class="preview-audio-hint">当前文件：${sourceName}</small>
                    </div>
                    <button class="chip-action-btn danger" type="button" data-action="preview-remove">
                        <i class="ri-delete-bin-line"></i><span>删除</span>
                    </button>
                </div>
            `;
        }).join("");

        wrap.querySelectorAll(".preview-audio-item").forEach((row) => {
            const idx = Number(row.getAttribute("data-preview-index"));
            const nameInput = row.querySelector('[data-action="preview-name"]');
            const fileInput = row.querySelector('[data-action="preview-file"]');
            const removeBtn = row.querySelector('[data-action="preview-remove"]');

            if (nameInput) {
                nameInput.addEventListener("input", (e) => {
                    if (!this.state.modForm.preview_audio_files[idx]) return;
                    this.state.modForm.preview_audio_files[idx].display_name = String(e.target.value || "").trim();
                    this.persistState();
                });
            }

            if (fileInput) {
                fileInput.addEventListener("change", async (e) => {
                    const file = e?.target?.files?.[0];
                    if (!file) return;
                    if (!/\.(mp3|wav)$/i.test(file.name || "")) {
                        this.notifyToast("warn", "试听文件仅支持 mp3/wav");
                        return;
                    }
                    const dataUrl = await this.readFileAsDataUrl(file);
                    if (!this.state.modForm.preview_audio_files[idx]) return;
                    const ext = String(file.name.split(".").pop() || "").toLowerCase();
                    this.state.modForm.preview_audio_files[idx].source_name = file.name;
                    this.state.modForm.preview_audio_files[idx].ext = ext;
                    this.state.modForm.preview_audio_files[idx].audio_data_url = dataUrl;
                    this.persistState();
                    this.renderMainPreviewAudioEditor();
                });
            }

            if (removeBtn) {
                removeBtn.addEventListener("click", () => {
                    this.state.modForm.preview_audio_files = this.state.modForm.preview_audio_files.filter((_, i) => i !== idx);
                    this.persistState();
                    this.renderMainPreviewAudioEditor();
                });
            }
        });
    },

    renderRelatedPackEditor() {
        const wrap = document.getElementById("mod-related-pack-list");
        if (!wrap) return;
        const rows = this.normalizeRelatedVoicepacks(this.state.modForm.related_voicepacks);
        this.state.modForm.related_voicepacks = rows;

        if (!rows.length) {
            wrap.innerHTML = '<div class="preview-audio-hint">暂无关联语音包，点击“添加关联语音包”开始配置。</div>';
            return;
        }

        wrap.innerHTML = rows.map((item, idx) => {
            const name = this.escapeHtml(item.name || "");
            const desc = this.escapeHtml(item.description || "");
            const link = this.escapeHtml(item.link || "");
            const avatar = this.escapeHtml(item.avatar_url || RELATED_AVATAR_FALLBACK);
            const previews = this.normalizePreviewAudioList(item.preview_audio_files || []);

            return `
                <div class="related-pack-item" data-related-index="${idx}">
                    <div class="related-pack-head">
                        <strong>关联语音包 #${idx + 1}</strong>
                        <button class="chip-action-btn danger" type="button" data-action="related-remove">
                            <i class="ri-delete-bin-line"></i><span>删除</span>
                        </button>
                    </div>
                    <div class="related-pack-grid">
                        <label class="voiceinfo-field">
                            <span>名称</span>
                            <input class="voiceinfo-input" type="text" data-action="related-name" value="${name}">
                        </label>
                        <label class="voiceinfo-field">
                            <span>关联链接</span>
                            <input class="voiceinfo-input" type="text" data-action="related-link" value="${link}" placeholder="https://">
                        </label>
                        <label class="voiceinfo-field full">
                            <span>说明（50字以内）</span>
                            <textarea class="voiceinfo-textarea" rows="2" maxlength="${MAX_RELATED_DESC_LENGTH}" data-action="related-desc">${desc}</textarea>
                        </label>
                        <div class="voiceinfo-field full">
                            <span>头像</span>
                            <div class="related-avatar-row">
                                <img class="related-avatar-preview" src="${avatar}" alt="avatar" onerror="this.src='${RELATED_AVATAR_FALLBACK}'">
                                <input class="voiceinfo-input" type="file" data-action="related-avatar-file" accept="image/*">
                            </div>
                        </div>
                        <div class="voiceinfo-field full">
                            <div class="choice-head-row">
                                <span>试听音频（最多 3 个）</span>
                                <button class="chip-action-btn" type="button" data-action="related-add-preview">
                                    <i class="ri-add-line"></i><span>添加</span>
                                </button>
                            </div>
                            <div class="preview-audio-list">
                                ${previews.map((audio, pidx) => `
                                    <div class="preview-audio-item" data-preview-index="${pidx}">
                                        <div>
                                            <div class="preview-audio-index">第 ${pidx + 1} 个文件</div>
                                            <div class="preview-audio-hint">关联试听音频</div>
                                        </div>
                                        <div class="voiceinfo-field">
                                            <input class="voiceinfo-input" type="text" data-action="related-preview-name" value="${this.escapeHtml(audio.display_name || "")}" placeholder="例如：关联试听${pidx + 1}">
                                            <input class="voiceinfo-input" type="file" data-action="related-preview-file" accept=".mp3,.wav,audio/mpeg,audio/wav">
                                            <small class="preview-audio-hint">当前文件：${this.escapeHtml(audio.source_name || "未选择文件")}</small>
                                        </div>
                                        <button class="chip-action-btn danger" type="button" data-action="related-preview-remove">
                                            <i class="ri-delete-bin-line"></i><span>删除</span>
                                        </button>
                                    </div>
                                `).join("")}
                            </div>
                        </div>
                    </div>
                </div>
            `;
        }).join("");

        wrap.querySelectorAll(".related-pack-item").forEach((card) => {
            const ridx = Number(card.getAttribute("data-related-index"));
            const setDirty = () => { this.persistState(); };

            const nameInput = card.querySelector('[data-action="related-name"]');
            const descInput = card.querySelector('[data-action="related-desc"]');
            const linkInput = card.querySelector('[data-action="related-link"]');
            const avatarInput = card.querySelector('[data-action="related-avatar-file"]');
            const removeBtn = card.querySelector('[data-action="related-remove"]');
            const addPreviewBtn = card.querySelector('[data-action="related-add-preview"]');

            if (nameInput) {
                nameInput.addEventListener("input", (e) => {
                    if (!this.state.modForm.related_voicepacks[ridx]) return;
                    this.state.modForm.related_voicepacks[ridx].name = String(e.target.value || "");
                    setDirty();
                });
            }
            if (descInput) {
                descInput.addEventListener("input", (e) => {
                    if (!this.state.modForm.related_voicepacks[ridx]) return;
                    this.state.modForm.related_voicepacks[ridx].description = String(e.target.value || "").slice(0, MAX_RELATED_DESC_LENGTH);
                    setDirty();
                });
            }
            if (linkInput) {
                linkInput.addEventListener("input", (e) => {
                    if (!this.state.modForm.related_voicepacks[ridx]) return;
                    this.state.modForm.related_voicepacks[ridx].link = String(e.target.value || "").trim();
                    setDirty();
                });
            }
            if (avatarInput) {
                avatarInput.addEventListener("change", async (e) => {
                    const file = e?.target?.files?.[0];
                    if (!file || !file.type.startsWith("image/")) return;
                    const dataUrl = await this.readFileAsDataUrl(file);
                    if (!this.state.modForm.related_voicepacks[ridx]) return;
                    this.state.modForm.related_voicepacks[ridx].avatar_url = dataUrl;
                    setDirty();
                    this.renderRelatedPackEditor();
                });
            }
            if (removeBtn) {
                removeBtn.addEventListener("click", () => {
                    this.state.modForm.related_voicepacks = this.state.modForm.related_voicepacks.filter((_, i) => i !== ridx);
                    setDirty();
                    this.renderRelatedPackEditor();
                });
            }
            if (addPreviewBtn) {
                addPreviewBtn.addEventListener("click", () => {
                    const related = this.state.modForm.related_voicepacks[ridx];
                    if (!related) return;
                    const list = this.normalizePreviewAudioList(related.preview_audio_files || []);
                    if (list.length >= MAX_PREVIEW_AUDIO_COUNT) {
                        this.notifyToast("warn", "单个关联语音包最多 3 个试听文件");
                        return;
                    }
                    list.push(this.createEmptyPreviewAudio(list.length + 1));
                    related.preview_audio_files = list;
                    setDirty();
                    this.renderRelatedPackEditor();
                });
            }

            card.querySelectorAll(".preview-audio-item").forEach((row) => {
                const pidx = Number(row.getAttribute("data-preview-index"));
                const nameEl = row.querySelector('[data-action="related-preview-name"]');
                const fileEl = row.querySelector('[data-action="related-preview-file"]');
                const removeEl = row.querySelector('[data-action="related-preview-remove"]');

                if (nameEl) {
                    nameEl.addEventListener("input", (e) => {
                        const related = this.state.modForm.related_voicepacks[ridx];
                        if (!related?.preview_audio_files?.[pidx]) return;
                        related.preview_audio_files[pidx].display_name = String(e.target.value || "");
                        setDirty();
                    });
                }
                if (fileEl) {
                    fileEl.addEventListener("change", async (e) => {
                        const file = e?.target?.files?.[0];
                        if (!file || !/\.(mp3|wav)$/i.test(file.name || "")) {
                            this.notifyToast("warn", "试听文件仅支持 mp3/wav");
                            return;
                        }
                        const dataUrl = await this.readFileAsDataUrl(file);
                        const related = this.state.modForm.related_voicepacks[ridx];
                        if (!related?.preview_audio_files?.[pidx]) return;
                        related.preview_audio_files[pidx].source_name = file.name;
                        related.preview_audio_files[pidx].ext = String(file.name.split(".").pop() || "").toLowerCase();
                        related.preview_audio_files[pidx].audio_data_url = dataUrl;
                        setDirty();
                        this.renderRelatedPackEditor();
                    });
                }
                if (removeEl) {
                    removeEl.addEventListener("click", () => {
                        const related = this.state.modForm.related_voicepacks[ridx];
                        if (!related) return;
                        related.preview_audio_files = (related.preview_audio_files || []).filter((_, i) => i !== pidx);
                        setDirty();
                        this.renderRelatedPackEditor();
                    });
                }
            });
        });
    },

    bindStaticButtons() {
        if (this._staticButtonsBound) return;

        const useDefaultsBtn = document.getElementById("btn-use-profile-defaults");
        if (useDefaultsBtn) {
            useDefaultsBtn.addEventListener("click", () => {
                const profile = this.state.profile;
                const form = this.state.modForm;

                form.author = String(profile.name || "").trim();
                form.link_bilibili = profile.links.bilibili || "";
                form.link_wtlive = profile.links.wtlive || "";
                form.link_liker = profile.links.wtliker || "";
                form.link_qq_group = profile.links.fans || "";
                form.link_feedback = profile.links.contact || "";

                this.syncVoiceFormInputs();
                this.persistState();
                this.renderPreviewLists();
                this.notifyToast("success", "已应用默认信息到语音包编辑栏位");
            });
        }

        const voiceinfoRefresh = document.getElementById("btn-voiceinfo-refresh");
        if (voiceinfoRefresh) voiceinfoRefresh.addEventListener("click", () => this.renderPreviewLists());

        const saveVoicepackBtn = document.getElementById("btn-save-voicepack-info");
        if (saveVoicepackBtn) {
            saveVoicepackBtn.addEventListener("click", () => this.saveCurrentVoicepackInfo());
        }

        const exportBankBtn = document.getElementById("btn-export-voicepack-bank");
        if (exportBankBtn) {
            exportBankBtn.addEventListener("click", () => this.exportCurrentVoicepackBank());
        }

        const addMainPreviewBtn = document.getElementById("btn-add-main-preview-audio");
        if (addMainPreviewBtn) {
            addMainPreviewBtn.addEventListener("click", () => {
                const useRandom = this.normalizePreviewUseRandomBank(
                    this.state.modForm.preview_use_random_bank,
                    null,
                    this.state.modForm.preview_audio_files
                );
                if (useRandom) {
                    this.notifyToast("info", "当前已启用随机试听，如需添加试听文件请先切换到作者自定义试听");
                    return;
                }
                const list = this.normalizePreviewAudioList(this.state.modForm.preview_audio_files);
                if (list.length >= MAX_PREVIEW_AUDIO_COUNT) {
                    this.notifyToast("warn", "试听文件最多只能添加 3 个");
                    return;
                }
                list.push(this.createEmptyPreviewAudio(list.length + 1));
                this.state.modForm.preview_audio_files = list;
                this.persistState();
                this.renderMainPreviewAudioEditor();
            });
        }

        const previewModeBtn = document.getElementById("btn-main-preview-mode");
        if (previewModeBtn) {
            previewModeBtn.addEventListener("click", () => {
                const nextValue = !this.normalizePreviewUseRandomBank(
                    this.state.modForm.preview_use_random_bank,
                    null,
                    this.state.modForm.preview_audio_files
                );
                this.state.modForm.preview_use_random_bank = nextValue;
                this.persistState();
                this.renderMainPreviewAudioEditor();
                this.renderPreviewLists();
            });
        }

        const addRelatedPackBtn = document.getElementById("btn-add-related-pack");
        if (addRelatedPackBtn) {
            addRelatedPackBtn.addEventListener("click", () => {
                const rows = this.normalizeRelatedVoicepacks(this.state.modForm.related_voicepacks);
                if (rows.length >= MAX_RELATED_PACK_COUNT) {
                    this.notifyToast("warn", "关联语音包最多只能添加 2 个");
                    return;
                }
                rows.push(this.createEmptyRelatedPack(rows.length + 1));
                this.state.modForm.related_voicepacks = rows;
                this.persistState();
                this.renderRelatedPackEditor();
            });
        }

        this._staticButtonsBound = true;
    },

    // =====================================================================
    //  工具箱模块 - 图片转 WebP
    // =====================================================================

    bindToolboxDropdown() {
        // 新版工具箱不再使用下拉切换，绑定新 UI 交互
        if (this._toolboxBound) return;
        this._toolboxBound = true;
        this._toolboxFiles = [];        // { path, name, sizeKB, thumb, status, result }
        this._toolboxLastFolder = "";   // 最后一次输出目录（用于"打开目录"按钮）
        this._toolboxConverting = false;

        this._bindToolboxFileSelect();
        this._bindToolboxDropzone();
        this._bindToolboxQualitySlider();
        this._bindToolboxLossless();
        this._bindToolboxSaveMode();
        this._bindToolboxActionButtons();
        this._updateToolboxUI();
    },

    // —— 文件选择 ——
    _bindToolboxFileSelect() {
        const btn = document.getElementById("btn-toolbox-select-files");
        const input = document.getElementById("toolbox-file-input");
        if (btn) btn.addEventListener("click", () => {
            // 优先用 pywebview 原生对话框，降级到 file input
            this._toolboxPickFilesNative();
        });
        if (input) input.addEventListener("change", (e) => {
            const files = Array.from(e.target.files || []);
            this._toolboxAddBrowserFiles(files);
            input.value = "";
        });
    },

    async _toolboxPickFilesNative() {
        if (!window.pywebview?.api?.toolbox_select_files) {
            // 浏览器降级：触发 file input
            const input = document.getElementById("toolbox-file-input");
            if (input) input.click();
            return;
        }
        try {
            const res = await window.pywebview.api.toolbox_select_files();
            if (res && res.success && res.files && res.files.length > 0) {
                await this._toolboxAddNativeFiles(res.files);
            }
        } catch (e) {
            this.notifyToast("warn", "系统文件选择失败，请重试");
        }
    },

    // 添加由 pywebview 原生对话框选取的文件路径列表
    async _toolboxAddNativeFiles(paths) {
        const supported = [".png", ".jpg", ".jpeg", ".bmp", ".gif", ".tiff", ".tif", ".webp"];
        const existing = new Set(this._toolboxFiles.map(f => f.path));
        let added = 0;
        for (const p of paths) {
            if (existing.has(p)) continue;
            const ext = p.lastIndexOf(".") >= 0 ? p.slice(p.lastIndexOf(".")).toLowerCase() : "";
            if (!supported.includes(ext)) continue;
            const name = p.replace(/\\/g, "/").split("/").pop();
            const entry = { path: p, name, sizeKB: 0, thumb: "", status: "pending", result: null };
            this._toolboxFiles.push(entry);
            existing.add(p);
            added++;
        }
        this._updateToolboxUI();
        if (added > 0) this._toolboxLoadThumbs();
    },

    // 浏览器 File 对象降级（pywebview 下 File 没有绝对路径，可简单预览）
    _toolboxAddBrowserFiles(fileList) {
        const supported = ["image/png", "image/jpeg", "image/bmp", "image/gif", "image/tiff", "image/webp"];
        const existing = new Set(this._toolboxFiles.map(f => f.name + "_" + f.sizeKB));
        for (const file of fileList) {
            if (!supported.includes(file.type)) continue;
            const key = file.name + "_" + Math.round(file.size / 1024);
            if (existing.has(key)) continue;
            const sizeKB = Math.round(file.size / 1024);
            const virtualPath = window.pywebview
                ? `upload://${Date.now()}_${Math.random().toString(36).slice(2)}/${file.name}`
                : file.name;
            const entry = { path: virtualPath, name: file.name, sizeKB, thumb: "", status: "pending", result: null, _file: file };
            this._toolboxFiles.push(entry);
            existing.add(key);
            // 做本地 URL 缩略图
            const url = URL.createObjectURL(file);
            entry.thumb = url;
        }
        this._updateToolboxUI();
    },

    _toolboxExtractNativeDropPaths(fileList) {
        const out = [];
        for (const file of Array.from(fileList || [])) {
            const path = String(file?.path || file?._path || "").trim();
            if (path) out.push(path);
        }
        return out;
    },

    async _toolboxBuildUploadPayload(entries) {
        const uploads = [];
        for (const entry of Array.from(entries || [])) {
            if (!entry?._file) continue;
            const dataUrl = await this.readFileAsDataUrl(entry._file);
            uploads.push({
                client_id: String(entry.path || ""),
                name: String(entry.name || entry._file?.name || "upload.png"),
                data_url: String(dataUrl || "")
            });
        }
        return uploads;
    },

    // —— 拖拽 ——
    _bindToolboxDropzone() {
        const zone = document.getElementById("toolbox-dropzone");
        if (!zone) return;
        zone.addEventListener("dragover", (e) => { e.preventDefault(); zone.classList.add("drag-over"); });
        zone.addEventListener("dragleave", () => zone.classList.remove("drag-over"));
        zone.addEventListener("drop", async (e) => {
            e.preventDefault();
            zone.classList.remove("drag-over");
            const files = Array.from(e.dataTransfer.files || []);
            if (window.pywebview) {
                const nativePaths = this._toolboxExtractNativeDropPaths(files);
                if (nativePaths.length > 0) {
                    await this._toolboxAddNativeFiles(nativePaths);
                    return;
                }
                if (files.length > 0) {
                    this._toolboxAddBrowserFiles(files);
                    this.notifyToast("info", "已接收拖拽文件，转换时将输出到所选目录或工具箱默认目录");
                }
                return;
            }
            if (files.length > 0) {
                this._toolboxAddBrowserFiles(files);
            }
        });
        // 点击拖拽区也触发选文件
        zone.addEventListener("click", (e) => {
            if (e.target.tagName === "BUTTON" || e.target.closest("button")) return;
            this._toolboxPickFilesNative();
        });
    },

    // —— 质量滑块 ——
    _bindToolboxQualitySlider() {
        const slider = document.getElementById("toolbox-quality-slider");
        const badge = document.getElementById("toolbox-quality-badge");
        if (!slider || !badge) return;
        const update = () => {
            const v = parseInt(slider.value, 10);
            badge.textContent = v;
            // 更新滑轨渐变
            const pct = ((v - 1) / 99 * 100).toFixed(1) + "%";
            slider.style.background = `linear-gradient(to right, var(--primary) ${pct}, #e2e8f0 ${pct})`;
        };
        slider.addEventListener("input", update);
        update();
    },

    // —— 无损复选框 ——
    _bindToolboxLossless() {
        const cb = document.getElementById("toolbox-lossless");
        const slider = document.getElementById("toolbox-quality-slider");
        const badge = document.getElementById("toolbox-quality-badge");
        if (!cb) return;
        cb.addEventListener("change", () => {
            const lossless = cb.checked;
            if (slider) slider.disabled = lossless;
            if (badge) badge.style.opacity = lossless ? "0.4" : "1";
        });
    },

    // —— 保存模式 ——
    _bindToolboxSaveMode() {
        const radios = document.querySelectorAll("input[name='toolbox-save-mode']");
        const folderRow = document.getElementById("toolbox-folder-row");
        const pickBtn = document.getElementById("btn-toolbox-pick-folder");
        radios.forEach(r => {
            r.addEventListener("change", () => {
                if (folderRow) folderRow.style.display = r.value === "folder" && r.checked ? "" : "none";
            });
        });
        if (pickBtn) pickBtn.addEventListener("click", () => this._toolboxPickOutputFolder());
    },

    async _toolboxPickOutputFolder() {
        if (!window.pywebview) {
            this.notifyToast("warn", "请在电脑端运行以使用文件夹选择功能");
            return;
        }
        try {
            const res = await window.pywebview.api.toolbox_select_folder();
            if (res && res.success && res.path) {
                const input = document.getElementById("toolbox-output-folder");
                if (input) input.value = res.path;
            }
        } catch (e) {
            this.notifyToast("error", "文件夹选择失败：" + String(e));
        }
    },

    // —— 操作按钮 ——
    _bindToolboxActionButtons() {
        const clearBtn = document.getElementById("btn-toolbox-clear-list");
        const convertBtn = document.getElementById("btn-toolbox-convert");
        const openBtn = document.getElementById("btn-toolbox-open-last-folder");
        if (clearBtn) clearBtn.addEventListener("click", () => this._toolboxClearList());
        if (convertBtn) convertBtn.addEventListener("click", () => this._toolboxStartConvert());
        if (openBtn) openBtn.addEventListener("click", () => this._toolboxOpenLastFolder());
    },

    _toolboxClearList() {
        this._toolboxFiles = [];
        this._toolboxLastFolder = "";
        const resultBar = document.getElementById("toolbox-result-bar");
        if (resultBar) resultBar.style.display = "none";
        const openBtn = document.getElementById("btn-toolbox-open-last-folder");
        if (openBtn) openBtn.style.display = "none";
        this._updateToolboxUI();
    },

    async _toolboxStartConvert() {
        if (this._toolboxConverting) return;
        const pending = this._toolboxFiles.filter(f => f.status === "pending" || f.status === "fail");
        if (pending.length === 0) {
            this.notifyToast("warn", "没有待转换的文件");
            return;
        }

        // 验证"指定目录"模式
        const saveMode = this._toolboxGetSaveMode();
        let outputFolder = "";
        if (saveMode === "folder") {
            outputFolder = (document.getElementById("toolbox-output-folder")?.value || "").trim();
            if (!outputFolder) {
                this.notifyToast("warn", "请先选择输出目录");
                return;
            }
        }

        // 替换模式：二次确认
        if (saveMode === "replace") {
            const ok = await this.showConfirmDialog({
                title: "确认替换",
                message: `即将对 ${pending.length} 个文件进行转换，\n转换成功后会删除原始图片，此操作不可撤销。\n\n确定继续吗？`,
                confirmText: "继续转换",
                cancelText: "取消"
            });
            if (!ok) return;
        }

        if (!window.pywebview) {
            this.notifyToast("warn", "当前为浏览器预览模式，实际转换需在客户端运行");
            return;
        }

        this._toolboxConverting = true;
        const convertBtn = document.getElementById("btn-toolbox-convert");
        if (convertBtn) { convertBtn.disabled = true; convertBtn.querySelector("span").textContent = "转换中…"; }

        const quality = parseInt(document.getElementById("toolbox-quality-slider")?.value || "85", 10);
        const lossless = document.getElementById("toolbox-lossless")?.checked || false;
        const nativeFiles = pending.filter(f => !f._file).map(f => f.path);
        const uploadEntries = pending.filter(f => !!f._file);
        if (uploadEntries.length > 0 && saveMode !== "folder") {
            this.notifyToast("info", "拖拽导入文件无法保留原目录，已改为输出到工具箱目录");
        }

        // 标记为转换中
        pending.forEach(f => { f.status = "converting"; });
        this._renderToolboxFileList();

        try {
            const allResults = [];
            const responseMessages = [];
            const outputFolders = [];

            if (nativeFiles.length > 0) {
                const nativeRes = await window.pywebview.api.toolbox_convert_webp({
                    files: nativeFiles,
                    uploads: [],
                    quality,
                    lossless,
                    save_mode: saveMode,
                    output_folder: outputFolder
                });
                if (nativeRes?.results) allResults.push(...nativeRes.results);
                if (nativeRes?.msg) responseMessages.push(String(nativeRes.msg));
                if (nativeRes?.output_folder_used) outputFolders.push(String(nativeRes.output_folder_used));
            }

            if (uploadEntries.length > 0) {
                const uploads = await this._toolboxBuildUploadPayload(uploadEntries);
                const uploadRes = await window.pywebview.api.toolbox_convert_webp({
                    files: [],
                    uploads,
                    quality,
                    lossless,
                    save_mode: saveMode,
                    output_folder: outputFolder
                });
                if (uploadRes?.results) allResults.push(...uploadRes.results);
                if (uploadRes?.msg) responseMessages.push(String(uploadRes.msg));
                if (uploadRes?.output_folder_used) outputFolders.push(String(uploadRes.output_folder_used));
            }

            if (allResults.length > 0) {
                const resultMap = new Map(allResults.map(r => [r.src, r]));
                this._toolboxFiles.forEach(f => {
                    if (f.status !== "converting") return;
                    const r = resultMap.get(f.path);
                    if (!r) return;
                    f.status = r.ok ? "success" : "fail";
                    f.result = r;
                    if (r.ok && r.dst) {
                        const parts = r.dst.replace(/\\/g, "/").split("/");
                        parts.pop();
                        this._toolboxLastFolder = parts.join("/");
                    }
                });
            }
            if (outputFolders.length > 0) {
                this._toolboxLastFolder = outputFolders[outputFolders.length - 1];
            }
            if (responseMessages.length > 0) {
                this.notifyToast("info", responseMessages[responseMessages.length - 1]);
            }
        } catch (e) {
            pending.forEach(f => { if (f.status === "converting") { f.status = "fail"; f.result = { ok: false, error: String(e) }; } });
            this.notifyToast("error", "转换出错：" + String(e));
        }

        this._toolboxConverting = false;
        if (convertBtn) { convertBtn.disabled = false; convertBtn.querySelector("span").textContent = "开始转换"; }
        this._updateToolboxUI();
        this._showToolboxResultBar();
    },

    _toolboxGetSaveMode() {
        const active = document.querySelector("input[name='toolbox-save-mode']:checked");
        return active ? active.value : "beside";
    },

    _showToolboxResultBar() {
        const bar = document.getElementById("toolbox-result-bar");
        const statSuccess = document.getElementById("toolbox-stat-success");
        const statFail = document.getElementById("toolbox-stat-fail");
        const failWrap = document.getElementById("toolbox-stat-fail-wrap");
        const openBtn = document.getElementById("btn-toolbox-open-last-folder");

        const successCnt = this._toolboxFiles.filter(f => f.status === "success").length;
        const failCnt = this._toolboxFiles.filter(f => f.status === "fail").length;

        if (statSuccess) statSuccess.textContent = `${successCnt} 成功`;
        if (statFail) statFail.textContent = `${failCnt} 失败`;
        if (failWrap) failWrap.style.display = failCnt > 0 ? "" : "none";
        if (bar) bar.style.display = "";
        if (openBtn) openBtn.style.display = this._toolboxLastFolder ? "" : "none";

        if (failCnt === 0) {
            this.notifyToast("success", `全部 ${successCnt} 张图片转换成功`);
        } else if (successCnt > 0) {
            this.notifyToast("warn", `${successCnt} 张成功，${failCnt} 张失败`);
        } else {
            this.notifyToast("error", `全部 ${failCnt} 张转换失败`);
        }
    },

    async _toolboxOpenLastFolder() {
        if (!this._toolboxLastFolder || !window.pywebview) return;
        try {
            await window.pywebview.api.toolbox_open_folder(this._toolboxLastFolder);
        } catch (e) {
            this.notifyToast("error", "无法打开目录");
        }
    },

    // —— 缩略图加载 ——
    async _toolboxLoadThumbs() {
        if (!window.pywebview) return;
        const pending = this._toolboxFiles.filter(f => !f.thumb && f.path);
        for (const entry of pending) {
            try {
                const res = await window.pywebview.api.toolbox_get_preview(entry.path);
                if (res && res.success && res.data_url) {
                    entry.thumb = res.data_url;
                    // 仅更新这个项的缩略图 DOM
                    const itemEl = document.querySelector(`.toolbox-file-item[data-path="${CSS.escape(entry.path)}"]`);
                    if (itemEl) {
                        const placeholder = itemEl.querySelector(".toolbox-thumb-placeholder");
                        if (placeholder) {
                            const img = document.createElement("img");
                            img.className = "toolbox-thumb";
                            img.src = res.data_url;
                            img.alt = entry.name;
                            placeholder.replaceWith(img);
                        }
                    }
                }
            } catch (_e) { /* 缩略图失败不影响流程 */ }
        }
    },

    // —— UI 渲染 ——
    _updateToolboxUI() {
        const emptyState = document.getElementById("toolbox-empty-state");
        const fileList = document.getElementById("toolbox-file-list");
        const countEl = document.getElementById("toolbox-file-count");
        const convertBtn = document.getElementById("btn-toolbox-convert");

        const count = this._toolboxFiles.length;
        if (emptyState) emptyState.style.display = count === 0 ? "" : "none";
        if (fileList) fileList.style.display = count === 0 ? "none" : "";
        if (countEl) countEl.textContent = `${count} 个文件`;
        if (convertBtn) convertBtn.disabled = count === 0 || this._toolboxConverting;

        this._renderToolboxFileList();
    },

    _renderToolboxFileList() {
        const container = document.getElementById("toolbox-file-list");
        if (!container) return;

        // 对齐现有 DOM 与数据列表（增量更新避免闪烁）
        const existingItems = Array.from(container.querySelectorAll(".toolbox-file-item"));
        const existingPaths = existingItems.map(el => el.dataset.path);
        const currentPaths = this._toolboxFiles.map(f => f.path);

        // 删除已移除的项
        existingItems.forEach(el => {
            if (!currentPaths.includes(el.dataset.path)) el.remove();
        });

        // 插入新项 / 更新状态
        this._toolboxFiles.forEach((entry, idx) => {
            let itemEl = container.querySelector(`.toolbox-file-item[data-path="${CSS.escape(entry.path)}"]`);
            if (!itemEl) {
                itemEl = this._createToolboxFileItem(entry);
                // 插入到正确位置
                const sibling = container.children[idx];
                if (sibling) container.insertBefore(itemEl, sibling);
                else container.appendChild(itemEl);
            } else {
                // 更新状态 class & 状态行
                this._updateToolboxItemStatus(itemEl, entry);
            }
        });
    },

    _createToolboxFileItem(entry) {
        const el = document.createElement("div");
        el.className = `toolbox-file-item status-${entry.status}`;
        el.dataset.path = entry.path;

        // 缩略图
        let thumbHtml;
        if (entry.thumb) {
            thumbHtml = `<img class="toolbox-thumb" src="${this.escapeHtml(entry.thumb)}" alt="${this.escapeHtml(entry.name)}">`;
        } else {
            thumbHtml = `<div class="toolbox-thumb-placeholder"><i class="ri-image-line"></i></div>`;
        }

        const sizeStr = entry.sizeKB > 0 ? `${entry.sizeKB} KB` : "";
        const extStr = entry.name.lastIndexOf(".") >= 0 ? entry.name.slice(entry.name.lastIndexOf(".") + 1).toUpperCase() : "";

        el.innerHTML = `
            ${thumbHtml}
            <div class="toolbox-file-info">
                <div class="toolbox-file-name" title="${this.escapeHtml(entry.path)}">${this.escapeHtml(entry.name)}</div>
                <div class="toolbox-file-meta">${[extStr, sizeStr].filter(Boolean).join(" · ")}</div>
                <div class="toolbox-file-status ${this._toolboxStatusClass(entry)}">
                    ${this._toolboxStatusHtml(entry)}
                </div>
            </div>
            <div class="toolbox-file-actions">
                <button class="toolbox-item-btn danger" title="从列表移除" data-action="remove">
                    <i class="ri-close-line"></i>
                </button>
            </div>`;

        el.querySelector("[data-action='remove']").addEventListener("click", () => {
            this._toolboxFiles = this._toolboxFiles.filter(f => f.path !== entry.path);
            el.remove();
            this._updateToolboxUI();
        });
        return el;
    },

    _updateToolboxItemStatus(el, entry) {
        el.className = `toolbox-file-item status-${entry.status}`;
        const statusEl = el.querySelector(".toolbox-file-status");
        if (statusEl) {
            statusEl.className = `toolbox-file-status ${this._toolboxStatusClass(entry)}`;
            statusEl.innerHTML = this._toolboxStatusHtml(entry);
        }
    },

    _toolboxStatusClass(entry) {
        const map = { success: "ok", fail: "fail", pending: "pending", converting: "converting" };
        return map[entry.status] || "pending";
    },

    _toolboxStatusHtml(entry) {
        if (entry.status === "success" && entry.result) {
            const r = entry.result;
            const saved = r.ratio > 0 ? `节省 ${r.ratio}%` : `+${Math.abs(r.ratio)}%`;
            return `<i class="ri-checkbox-circle-line"></i> 完成 · ${r.dst_kb} KB (${saved})`;
        }
        if (entry.status === "fail" && entry.result) {
            return `<i class="ri-error-warning-line"></i> 失败：${this.escapeHtml(entry.result.error || "未知错误")}`;
        }
        if (entry.status === "converting") {
            return `<i class="ri-loader-4-line"></i> 转换中…`;
        }
        return `<i class="ri-time-line"></i> 等待转换`;
    },

    setCurrentVoicepackContext(name) {
        this.currentVoicepackName = String(name || "").trim();
        const label = document.getElementById("voiceinfo-current-pack");
        const saveBtn = document.getElementById("btn-save-voicepack-info");
        const exportBtn = document.getElementById("btn-export-voicepack-bank");
        if (label) {
            if (this.currentVoicepackName) {
                label.innerHTML = `当前编辑语音包：<strong>${this.escapeHtml(this.currentVoicepackName)}</strong>`;
            } else {
                label.textContent = "当前编辑语音包：未关联（仅本地预览）";
            }
        }
        if (saveBtn) saveBtn.disabled = !this.currentVoicepackName;
        if (exportBtn) exportBtn.disabled = !this.currentVoicepackName;
    },

    applyVoicepackToEditor(payload) {
        const modName = String(payload?.mod_name || "").trim();
        const modData = payload?.mod_data || {};
        const form = this.state.modForm;

        form.title = String(modData.title || "").trim() || "未命名语音包";
        form.author = String(modData.author || "").trim();
        form.version = this.normalizeVersion(modData.version || "1.0");
        form.date = this.normalizeDateInput(modData.date);
        form.size_str = String(modData.size_str || "").trim() || "<1 MB";
        form.tags = this.normalizeTagList(modData.tags);
        form.language = this.normalizeLanguageList(modData.language);
        form.note = String(modData.note || "").trim();
        form.full_desc = String(modData.full_desc || modData.note || "").trim();
        form.version_note = this.normalizeVersionNoteArray(modData.version_note, form.version);
        form.cover_url = String(modData.cover_url || "").trim();
        form.link_bilibili = String(modData.link_bilibili || "").trim();
        form.link_wtlive = String(modData.link_wtlive || "").trim();
        form.link_video = String(modData.link_video || "").trim();
        form.link_qq_group = String(modData.link_qq_group || "").trim();
        form.link_liker = String(modData.link_liker || "").trim();
        form.link_feedback = String(modData.link_feedback || "").trim();
        form.preview_use_random_bank = this.normalizePreviewUseRandomBank(
            modData.preview_use_random_bank,
            null,
            modData.preview_audio_files || []
        );
        form.preview_audio_files = this.normalizePreviewAudioList(modData.preview_audio_files || []);
        form.related_voicepacks = this.normalizeRelatedVoicepacks(modData.related_voicepacks || []);

        this.persistState();
        this.syncVoiceFormInputs();
        this.renderTagChoices();
        this.renderLanguageChoices();
        this.renderVersionNoteEditor();
        this.renderMainPreviewAudioEditor();
        this.renderRelatedPackEditor();
        this.renderPreviewLists();
        this.setCurrentVoicepackContext(modName);
    },

    buildVoicepackInfoPayload() {
        const f = this.state.modForm || {};
        return {
            title: String(f.title || "").trim() || "未命名语音包",
            author: String(f.author || "").trim(),
            version: this.normalizeVersion(f.version || "1.0"),
            date: this.normalizeDateInput(f.date),
            note: String(f.note || "").trim(),
            version_note: this.normalizeVersionNoteArray(f.version_note, f.version),
            link_bilibili: this.normalizeLink(String(f.link_bilibili || "").trim()),
            link_qq_group: this.normalizeLink(String(f.link_qq_group || "").trim()),
            link_wtlive: this.normalizeLink(String(f.link_wtlive || "").trim()),
            link_liker: this.normalizeLink(String(f.link_liker || "").trim()),
            link_feedback: this.normalizeLink(String(f.link_feedback || "").trim()),
            link_video: this.normalizeLink(String(f.link_video || "").trim()),
            tags: this.normalizeTagList(f.tags),
            language: this.normalizeLanguageList(f.language),
            cover_url: String(f.cover_url || "").trim(),
            full_desc: String(f.full_desc || "").trim(),
            preview_use_random_bank: this.normalizePreviewUseRandomBank(
                f.preview_use_random_bank,
                null,
                f.preview_audio_files || []
            ),
            preview_audio_files: this.normalizePreviewAudioList(f.preview_audio_files || []),
            related_voicepacks: this.normalizeRelatedVoicepacks(f.related_voicepacks || []),
        };
    },

    async saveCurrentVoicepackInfo() {
        const modName = String(this.currentVoicepackName || "").trim();
        if (!modName) {
            this.notifyToast("warn", "请先在语音包库中选择一个语音包");
            return;
        }
        if (!window.pywebview?.api?.save_voicepack_info) {
            this.notifyToast("warn", "后端 API 不可用");
            return;
        }

        const payload = this.buildVoicepackInfoPayload();
        try {
            const res = await window.pywebview.api.save_voicepack_info(modName, payload);
            if (!res?.success) {
                this.notifyToast("warn", res?.msg || "保存失败");
                return;
            }
            if (res.size_str) this.state.modForm.size_str = String(res.size_str);
            if (res.date) this.state.modForm.date = this.normalizeDateInput(res.date);
            this.persistState();
            this.syncVoiceFormInputs();
            this.renderPreviewLists();
            this.notifyToast("success", `已保存到 ${modName}/info.json`);
            const vpMod = this.pageModules.get("voicepack");
            if (vpMod && typeof vpMod.refreshList === "function") vpMod.refreshList();
        } catch (_e) {
            this.notifyToast("warn", "保存失败");
        }
    },

    async exportCurrentVoicepackBank() {
        const modName = String(this.currentVoicepackName || "").trim();
        if (!modName) {
            this.notifyToast("warn", "请先选择语音包");
            return;
        }
        if (!window.pywebview?.api?.export_voicepack_bank) {
            this.notifyToast("warn", "后端导出 API 不可用");
            return;
        }

        await this.saveCurrentVoicepackInfo();
        const dialogRes = await this.showChoiceInputDialog({
            title: "导出 BANK 包",
            message: "请选择导出方式，并输入导出的文件名（不需要后缀）",
            inputLabel: "文件名",
            value: modName,
            placeholder: "例如：莉可丽丝",
            choiceValue: "full",
            choices: [
                {
                    value: "full",
                    title: "完整导出",
                    description: "保留现有规则，语音包文件也会一并打进 .bank。"
                },
                {
                    value: "split",
                    title: "分离导出",
                    description: "仅配置和图片打进 .bank，语音包文件会单独放进同名文件夹。"
                }
            ],
            choicesCompact: true,
            confirmText: "开始导出"
        });
        if (!dialogRes?.ok) return;
        const packageName = String(dialogRes.value || "").trim() || modName;
        const exportMode = String(dialogRes.choice || "full").trim() || "full";

        try {
            const res = await window.pywebview.api.export_voicepack_bank(modName, packageName, exportMode);
            if (!res?.success) {
                this.notifyToast("warn", res?.msg || "导出失败");
                return;
            }
            if (res.export_mode === "split") {
                this.notifyToast("success", `分离导出完成：${res.folder_name || res.file_name || ""}`);
            } else {
                this.notifyToast("success", `导出完成：${res.file_name || ""}`);
            }
        } catch (_e) {
            this.notifyToast("warn", "导出失败");
        }
    },

    buildPreviewMod() {
        const profile = this.state.profile;
        const f = this.state.modForm;
        const title = String(f.title || "").trim() || "未命名语音包";
        const author = String(f.author || "").trim() || String(profile.name || "").trim() || "未知作者";
        const version = this.normalizeVersion(f.version || "1.0");
        const date = String(f.date || "").trim() || new Date().toISOString().split("T")[0];
        const sizeStr = String(f.size_str || "").trim() || "<1 MB";
        const tags = this.normalizeTagList(f.tags);
        const language = this.normalizeLanguageList(f.language);

        return {
            id: "preview-main",
            title,
            author,
            version,
            date,
            size_str: sizeStr,
            tags,
            language,
            note: String(f.note || "").trim() || "暂无作者留言",
            full_desc: String(f.full_desc || "").trim() || String(f.note || "").trim() || "暂无详细介绍",
            version_note: this.normalizeVersionNoteArray(f.version_note, version),
            cover_url: String(f.cover_url || "").trim() || DEFAULT_COVER,
            link_bilibili: this.normalizeLink(String(f.link_bilibili || "").trim() || profile.links.bilibili || ""),
            link_wtlive: this.normalizeLink(String(f.link_wtlive || "").trim() || profile.links.wtlive || ""),
            link_video: this.normalizeLink(String(f.link_video || "").trim()),
            link_qq_group: this.normalizeLink(String(f.link_qq_group || "").trim() || profile.links.fans || ""),
            link_liker: this.normalizeLink(String(f.link_liker || "").trim() || profile.links.wtliker || ""),
            link_feedback: this.normalizeLink(String(f.link_feedback || "").trim() || profile.links.contact || ""),
            preview_use_random_bank: this.normalizePreviewUseRandomBank(
                f.preview_use_random_bank,
                null,
                f.preview_audio_files || []
            ),
            preview_audio_files: this.normalizePreviewAudioList(f.preview_audio_files || []),
            related_voicepacks: this.normalizeRelatedVoicepacks(f.related_voicepacks || []),
            capabilities: this.tagsToCapabilities(tags)
        };
    },

    getPreviewMods() {
        return [this.buildPreviewMod()];
    },

    renderPreviewLists() {
        const mods = this.getPreviewMods();
        this.previewModMap = new Map(mods.map((mod) => [String(mod.id), mod]));
        this.renderVoiceinfoList(mods);
        this.refreshHomeInfoCards();
    },

    renderVoiceinfoList(mods = null) {
        const list = document.getElementById("voiceinfo-list");
        if (!list) return;
        this.renderListToContainer(list, mods || this.getPreviewMods());
    },

    renderListToContainer(container, mods) {
        if (!Array.isArray(mods) || !mods.length) {
            container.innerHTML = `
                <div class="empty-state" style="grid-column: 1 / -1;">
                    <i class="ri-inbox-archive-line"></i>
                    <h3>暂无预览语音包</h3>
                    <p>请在左侧继续编辑语音包信息</p>
                </div>
            `;
            return;
        }

        container.innerHTML = "";
        mods.forEach((mod, index) => {
            const card = this.createModCard(mod);
            card.style.animationDelay = `${Math.min(index * 0.05, 0.4)}s`;
            container.appendChild(card);
        });
    },

    createModCard(mod) {
        const div = document.createElement("div");
        div.className = "card mod-card";
        div.dataset.id = String(mod.id || "");

        const imgUrl = this.escapeHtml(mod.cover_url || DEFAULT_COVER);
        const updateDate = this.escapeHtml(mod.date || "未知日期");
        const noteText = this.escapeHtml(mod.note || "暂无留言");

        const fullLangList = Array.isArray(mod.language) ? mod.language : [String(mod.language || "中")];
        let displayLangs = fullLangList.filter((lang) => ["中", "英", "美", "俄", "德", "日", "法"].includes(lang));
        if (displayLangs.length === 0) displayLangs = fullLangList.slice(0, 2);

        const langHtml = displayLangs.map((lang) => {
            const cls = LANG_CLASS_MAP[lang] || "";
            return `<span class="lang-text ${this.escapeHtml(cls)}">${this.escapeHtml(lang)}</span>`;
        }).join('<span style="margin:0 2px">/</span>');

        const tagsHtml = (mod.tags || []).map((tag) => {
            const cls = this.resolveTagClass(tag);
            return `<span class="tag ${this.escapeHtml(cls)}">${this.escapeHtml(tag)}</span>`;
        }).join("");

        const clsVideo = mod.link_video ? "video" : "disabled";
        const clsWt = mod.link_wtlive ? "wt" : "disabled";
        const clsBili = mod.link_bilibili ? "bili" : "disabled";
        const displayVersion = this.normalizeVersion(mod.version);
        div.innerHTML = `
            <div class="mod-img-area">
                <img src="${imgUrl}" class="mod-img" alt="cover" onerror="this.src='${this.escapeHtml(DEFAULT_COVER)}'">
            </div>
            <div class="mod-info-area">
                <div class="mod-ver">v${this.escapeHtml(displayVersion)}</div>
                <div class="mod-title-row">
                    <div class="mod-title" title="${this.escapeHtml(mod.title)}">${this.escapeHtml(mod.title)}</div>
                </div>
                <div class="mod-author-row">
                    <i class="ri-user-3-line"></i> <span>${this.escapeHtml(mod.author)}</span>
                    <span class="sep">|</span>
                    <i class="ri-hard-drive-2-line"></i> <span>${this.escapeHtml(mod.size_str)}</span>
                    <span class="sep">|</span>
                    <div class="mod-lang-wrap" title="支持语言: ${this.escapeHtml(fullLangList.join(", "))}">
                        <i class="ri-translate"></i>
                        <span style="margin-left:2px">${langHtml || "未知"}</span>
                    </div>
                </div>
                <div class="mod-meta-row">${tagsHtml || '<span class="tag default">暂无标签</span>'}</div>
                <div class="mod-update-row"><i class="ri-time-line"></i> 更新于 ${updateDate}</div>
                <div class="mod-note" data-note="${noteText}">
                    <i class="ri-chat-1-line"></i>
                    ${noteText}
                </div>
            </div>
            <div class="mod-actions-col">
                <div class="action-icon action-btn-del" title="删除预览（仅提示）" data-action="delete-preview"><i class="ri-delete-bin-line"></i></div>
                <div style="flex:1"></div>
                <div class="action-icon ${clsVideo}" title="观看介绍视频" data-action="open-video"><i class="ri-play-circle-line"></i></div>
                <div class="action-icon ${clsWt}" title="访问 WT Live" data-action="open-wtlive"><i class="ri-global-line"></i></div>
                <div class="action-icon ${clsBili}" title="访问 Bilibili" data-action="open-bili"><i class="ri-bilibili-line"></i></div>
                <button class="action-btn-load" type="button" title="查看详情" data-action="open-detail"><i class="ri-play-circle-line"></i></button>
            </div>
        `;

        div.querySelectorAll("[data-action]").forEach((actionEl) => {
            actionEl.addEventListener("click", (e) => {
                e.stopPropagation();
                this.handleCardAction(actionEl.getAttribute("data-action"), mod);
            });
        });

        return div;
    },

    handleCardAction(action, mod) {
        if (action === "delete-preview") {
            this.notifyToast("info", "预览卡片不执行真实删除，仅用于样式验证");
            return;
        }
        if (action === "open-video") {
            if (mod.link_video) this.openExternal(mod.link_video);
            return;
        }
        if (action === "open-wtlive") {
            if (mod.link_wtlive) this.openExternal(mod.link_wtlive);
            return;
        }
        if (action === "open-bili") {
            if (mod.link_bilibili) this.openExternal(mod.link_bilibili);
            return;
        }
        if (action === "open-detail") this.openModPreview(mod);
    },

    bindCardPreviewClick() {
        if (this._previewBound) return;

        const clickHandler = (e) => {
            if (e.button !== 0) return;
            if (this.shouldIgnoreCardClick(e.target)) return;
            const card = e.target.closest(".mod-card");
            if (!card) return;
            const modId = card.dataset.id;
            if (modId) this.openModPreviewById(modId);
        };

        const viList = document.getElementById("voiceinfo-list");
        if (viList) viList.addEventListener("click", clickHandler);

        this._previewBound = true;
    },

    shouldIgnoreCardClick(target) {
        return !!target.closest(".mod-actions-col, .action-icon, .action-btn-load, .mod-copy-action, button, a");
    },

    openModPreviewById(modId) {
        const mod = this.previewModMap.get(String(modId));
        if (mod) this.openModPreview(mod);
    },

    ensurePreviewModal() {
        let overlay = document.getElementById(MODAL_ID);
        if (overlay) return overlay;

        overlay = document.createElement("div");
        overlay.id = MODAL_ID;
        overlay.className = "modal-overlay mod-preview-overlay";
        overlay.innerHTML = `
            <div class="modal-content mod-preview-modal-v2">
                <div class="mod-preview-topbar">
                    <div class="mod-preview-head-main">
                        <img class="mod-preview-author-avatar" id="mod-preview-author-avatar" src="${FALLBACK_AVATAR}" alt="author avatar">
                        <div class="mod-preview-head-text">
                            <div class="mod-preview-title-wrap">
                                <div class="mod-preview-title" id="mod-preview-title"></div>
                                <span class="mod-preview-version" id="mod-preview-version"></span>
                            </div>
                            <div class="mod-preview-subline">
                                <span class="meta-item"><i class="ri-user-3-line"></i> <span id="mod-preview-author"></span></span>
                                <span class="dot"></span>
                                <span class="meta-item"><i class="ri-time-line"></i> <span id="mod-preview-date"></span></span>
                            </div>
                        </div>
                    </div>
                    <button class="mod-preview-close-btn" type="button" title="关闭"><i class="ri-close-line"></i></button>
                </div>
                <div class="mod-preview-body">
                    <div class="mod-preview-left">
                        <div class="mod-preview-cover-box"><img class="mod-preview-cover" id="mod-preview-cover" src="" alt="语音包封面"></div>
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
                        <div class="mod-preview-top-stack">
                            <section class="mod-preview-card mod-preview-tags-card">
                                <h4><i class="ri-price-tag-3-line"></i> 包含内容</h4>
                                <div class="mod-preview-tags-scroll" id="mod-preview-tags"></div>
                            </section>
                            <section class="mod-preview-card mod-preview-desc-card">
                                <h4><i class="ri-information-line"></i> 详细介绍</h4>
                                <div class="mod-preview-desc" id="mod-preview-desc"></div>
                            </section>
                        </div>
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
                                    <button class="mod-preview-link-btn other-works" type="button" data-link-action="otherworks"><i class="ri-apps-2-line"></i> 作者其他语音包</button>
                                    <button class="mod-preview-link-btn feedback" type="button" data-link-action="feedback"><i class="ri-mail-send-line"></i> 联系作者反馈</button>
                                </div>
                            </section>
                        </div>
                    </div>
                </div>
                <div class="mod-preview-footer">
                    <div class="mod-preview-footer-actions">
                        <button class="btn secondary" type="button" data-action="delete"><i class="ri-delete-bin-line"></i> 删除</button>
                        <button class="btn secondary" type="button" data-action="open-folder"><i class="ri-folder-open-line"></i> 打开</button>
                        <button class="btn secondary" type="button" data-action="audition"><i class="ri-play-circle-line"></i> 试听语音</button>
                        <button class="btn primary" type="button" data-action="apply"><i class="ri-check-line"></i> 应用语音包</button>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);
        overlay.addEventListener("click", (e) => { if (e.target === overlay) this.closeModPreview(); });
        const closeBtn = overlay.querySelector(".mod-preview-close-btn");
        if (closeBtn) closeBtn.addEventListener("click", () => this.closeModPreview());

        return overlay;
    },
    openModPreview(mod) {
        const overlay = this.ensurePreviewModal();
        const title = String(mod?.title || "未命名语音包");
        const author = String(mod?.author || "未知作者");
        const date = String(mod?.date || "未知日期");
        const authorAvatar = String(mod?.author_avatar || this.state?.profile?.avatar || FALLBACK_AVATAR).trim() || FALLBACK_AVATAR;
        const sizeText = String(mod?.size_str || "未知大小");
        const cover = String(mod?.cover_url || DEFAULT_COVER);
        const version = this.normalizeVersion(mod?.version);
        const desc = String(mod?.full_desc || mod?.note || "暂无详细介绍").trim();
        const tagHtml = this.buildTagHtml(mod);
        const versionNoteHtml = this.buildVersionNoteHtml(mod);
        const tagCount = Array.isArray(mod?.tags) ? mod.tags.length : 0;
        this.fillText(overlay, "#mod-preview-title", title);
        this.fillText(overlay, "#mod-preview-version", `v${version}`);
        this.fillText(overlay, "#mod-preview-author", author);
        this.fillText(overlay, "#mod-preview-date", date);
        this.fillText(overlay, "#mod-preview-size", sizeText);
        this.fillHtml(overlay, "#mod-preview-lang", this.buildLangHtml(mod));
        this.fillText(overlay, "#mod-preview-tag-count", `${tagCount} 个`);
        this.fillHtml(overlay, "#mod-preview-tags", tagHtml || '<span class="mod-preview-empty">暂无标签</span>');
        this.fillText(overlay, "#mod-preview-desc", desc);
        this.fillHtml(overlay, "#mod-preview-version-note", versionNoteHtml);

        const coverEl = overlay.querySelector("#mod-preview-cover");
        if (coverEl) {
            coverEl.src = cover;
            coverEl.onerror = () => { coverEl.src = DEFAULT_COVER; };
        }
        const authorAvatarEl = overlay.querySelector("#mod-preview-author-avatar");
        if (authorAvatarEl) {
            authorAvatarEl.src = authorAvatar;
            authorAvatarEl.onerror = () => { authorAvatarEl.src = FALLBACK_AVATAR; };
        }

        this.bindPreviewFooterActions(overlay, mod);
        this.bindPreviewLinkActions(overlay, mod);
        this.showOverlay(overlay);
    },

    bindPreviewFooterActions(overlay, mod) {
        const applyBtn = overlay.querySelector('[data-action="apply"]');
        const deleteBtn = overlay.querySelector('[data-action="delete"]');
        const openFolderBtn = overlay.querySelector('[data-action="open-folder"]');
        const auditionBtn = overlay.querySelector('[data-action="audition"]');
        const canOpenFolder = Boolean(String(this.currentVoicepackName || "").trim());

        if (applyBtn) applyBtn.onclick = () => this.notifyToast("success", `预览动作：应用语音包 [${mod.title}]`);
        if (deleteBtn) deleteBtn.onclick = () => this.notifyToast("info", "预览卡片不执行真实删除，仅用于样式验证");
        if (openFolderBtn) {
            openFolderBtn.disabled = !canOpenFolder;
            openFolderBtn.onclick = async () => {
                const name = String(this.currentVoicepackName || "").trim();
                if (!name) {
                    this.notifyToast("warn", "请先在语音包库中选择一个语音包");
                    return;
                }
                try {
                    const res = await window.pywebview?.api?.open_voicepack_item?.(name);
                    if (!res?.success) this.notifyToast("warn", res?.msg || "打开目录失败");
                } catch (_e) {
                    this.notifyToast("warn", "打开目录失败");
                }
            };
        }
        if (auditionBtn) {
            auditionBtn.onclick = async () => {
                if (String(mod?.id || "").startsWith("author-related-")) {
                    this.notifyToast("warn", "关联语音包详情不支持本地试听");
                    return;
                }
                const modName = String(this.currentVoicepackName || "").trim();
                if (!modName) {
                    this.notifyToast("warn", "请先在语音包库中选择一个语音包");
                    return;
                }
                try {
                    await this.saveCurrentVoicepackInfo();
                    const manualPreviewItems = this.normalizePreviewAudioList(mod?.preview_audio_files || [])
                        .map((item, idx) => ({ ...item, preview_index: idx }));
                    const useRandomPreview = mod?.preview_use_random_bank !== false || !manualPreviewItems.length;
                    if (mod?.preview_use_random_bank === false && !manualPreviewItems.length) {
                        this.notifyToast("info", "未配置作者试听文件，已回退到随机试听");
                    }
                    if (!useRandomPreview) {
                        this.openAuthorPreviewAudioPicker(modName, manualPreviewItems);
                        return;
                    }
                    if (!window.pywebview?.api?.start_mod_audition_scan || !window.pywebview?.api?.get_mod_audition_categories_snapshot) {
                        this.notifyToast("warn", "后端试听接口不可用");
                        return;
                    }

                    auditionBtn.disabled = true;
                    const oldHtml = auditionBtn.innerHTML;
                    auditionBtn.innerHTML = '<i class="ri-loader-2-line"></i> 初始化试听...';
                    const currentState = window.__auditionPickerState;
                    if (currentState && currentState.modId === modName) {
                        auditionBtn.innerHTML = oldHtml;
                        auditionBtn.disabled = false;
                        this.notifyToast("info", "该语音包试听窗口已打开");
                        return;
                    }
                    if (currentState && typeof currentState.close === "function") {
                        currentState.close(true);
                    }
                    this.openAuditionPicker(modName, []);
                    await pywebview.api.start_mod_audition_scan(modName);
                    const snap = await pywebview.api.get_mod_audition_categories_snapshot(modName);
                    auditionBtn.innerHTML = oldHtml;
                    auditionBtn.disabled = false;
                    if (!snap || !snap.success) {
                        this.notifyToast("warn", snap?.msg || "试听初始化失败");
                        return;
                    }
                    if (window.__auditionPickerState && typeof window.__auditionPickerState.update === "function") {
                        window.__auditionPickerState.update(snap);
                    }
                } catch (_e) {
                    auditionBtn.disabled = false;
                    auditionBtn.innerHTML = '<i class="ri-play-circle-line"></i> 试听语音';
                    this.notifyToast("warn", "试听失败");
                }
            };
        }
    },

    formatAuditionDuration(sec) {
        const n = Number(sec || 0);
        if (!Number.isFinite(n) || n <= 0) return "0:00";
        const m = Math.floor(n / 60);
        const s = Math.floor(n % 60);
        return `${m}:${String(s).padStart(2, "0")}`;
    },

    openAuditionPicker(modName, categories) {
        const overlay = document.createElement("div");
        overlay.className = "modal-overlay show";
        overlay.style.zIndex = "10002";
        let categoriesData = Array.isArray(categories) ? [...categories] : [];
        let snapshotStatusText = "准备中...";

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

        const selectEl = overlay.querySelector("#audition-select");
        const searchEl = overlay.querySelector("#audition-search");
        const countEl = overlay.querySelector("#audition-count");
        const progressTextEl = overlay.querySelector("#audition-progress-text");
        const progressBarEl = overlay.querySelector("#audition-progress-bar");
        const playBtn = overlay.querySelector("#audition-play-btn");
        const closeBtn = overlay.querySelector("#audition-close-btn");
        const pauseBtn = overlay.querySelector("#audition-pause-btn");

        const close = (switching = false) => {
            if (window.__aimerAuditionAudio) {
                try {
                    window.__aimerAuditionAudio.pause();
                    window.__aimerAuditionAudio.currentTime = 0;
                    window.__aimerAuditionAudio.src = "";
                } catch (_e) {
                }
            }
            if (window.pywebview?.api?.stop_mod_audition_scan) {
                pywebview.api.stop_mod_audition_scan(modName).catch(() => { });
            }
            if (window.pywebview?.api?.clear_audition_cache) {
                pywebview.api.clear_audition_cache(modName).catch(() => { });
            }
            if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
            if (window.__auditionPickerState && window.__auditionPickerState.modId === modName) {
                window.__auditionPickerState = null;
            }
            if (!switching) {
                this.notifyToast("info", "已关闭试听窗口");
            }
        };

        const rebuildOptions = (keyword) => {
            const q = String(keyword || "").trim().toLowerCase();
            let visible = 0;
            selectEl.innerHTML = categoriesData.map((it, idx) => {
                const name = String(it.name || "");
                const code = String(it.code || "");
                const hit = !q || name.toLowerCase().includes(q) || code.toLowerCase().includes(q);
                if (!hit) return "";
                visible += 1;
                const label = `${this.escapeHtml(name)} (${Number(it.count || 0)} 条) [${this.escapeHtml(code)}]`;
                return `<option value="${idx}">${label}</option>`;
            }).join("");
            if (progressTextEl) {
                const base = snapshotStatusText || "解析中...";
                progressTextEl.textContent = visible !== categoriesData.length
                    ? `${base} · 当前筛选 ${visible}/${categoriesData.length} 类`
                    : base;
            }
        };

        const updateFromSnapshot = (snap) => {
            if (!snap) return;
            if (Array.isArray(snap.categories)) categoriesData = snap.categories;
            if (countEl) {
                const p = Number(snap.progress || 0);
                const msg = String(snap.message || "");
                countEl.textContent = `${categoriesData.length} 类 / ${Number(snap.count || 0)} 条`;
                snapshotStatusText = `${msg || "解析中"} (${p}%)`;
                if (snap.done) {
                    snapshotStatusText = snap.error
                        ? `解析结束：${snap.error}`
                        : `解析完成：${categoriesData.length} 类，${Number(snap.count || 0)} 条语音`;
                }
                if (progressTextEl) progressTextEl.textContent = snapshotStatusText;
                if (progressBarEl) progressBarEl.style.width = `${Math.max(0, Math.min(100, p))}%`;
            }
            rebuildOptions(searchEl ? searchEl.value : "");
            if (pauseBtn) {
                if (snap.done) {
                    pauseBtn.disabled = true;
                    pauseBtn.textContent = "解析已完成";
                } else {
                    pauseBtn.disabled = false;
                    pauseBtn.textContent = snap.paused ? "继续解析" : "暂停解析";
                }
            }
        };

        const playSelected = async () => {
            try {
                if (!selectEl || !selectEl.value) {
                    this.notifyToast("warn", "请先选择一个分类");
                    return;
                }
                const selected = categoriesData[Number(selectEl.value)];
                if (!selected) return;
                if (String(selected.code || "").toLowerCase() === "preview") {
                    if (!window.pywebview?.api?.list_mod_audition_items_by_type) {
                        this.notifyToast("warn", "后端手动试听接口不可用");
                        return;
                    }
                    playBtn.disabled = true;
                    const oldHtml = playBtn.innerHTML;
                    playBtn.innerHTML = '<i class="ri-loader-2-line"></i> 加载试听条目...';
                    const listRes = await pywebview.api.list_mod_audition_items_by_type(modName, selected.code);
                    playBtn.disabled = false;
                    playBtn.innerHTML = oldHtml;
                    if (!listRes || !listRes.success || !Array.isArray(listRes.items) || !listRes.items.length) {
                        this.notifyToast("warn", listRes?.msg || "未获取到可试听条目");
                        return;
                    }
                    this.openManualPreviewPicker(modName, selected, listRes.items);
                    return;
                }

                if (!window.pywebview?.api?.audition_mod_random_by_type) {
                    this.notifyToast("warn", "后端试听接口不可用");
                    return;
                }
                playBtn.disabled = true;
                const oldHtml = playBtn.innerHTML;
                playBtn.innerHTML = '<i class="ri-loader-2-line"></i> 随机抽取中...';
                const res = await pywebview.api.audition_mod_random_by_type(modName, selected.code, 12);
                playBtn.disabled = false;
                playBtn.innerHTML = oldHtml;
                if (!res || !res.success || !res.audio_url) {
                    this.notifyToast("warn", res?.msg || "试听失败");
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
                this.notifyToast("success", `正在播放：${String(res.picked_name || "随机语音")}`);
            } catch (_e) {
                playBtn.disabled = false;
                playBtn.innerHTML = '<i class="ri-play-circle-line"></i> 随机试听该分类';
                this.notifyToast("warn", "试听失败");
            }
        };

        overlay.addEventListener("click", (e) => {
            if (e.target === overlay) close();
        });
        if (searchEl) searchEl.addEventListener("input", (e) => rebuildOptions(e.target.value));
        if (closeBtn) closeBtn.addEventListener("click", close);
        if (pauseBtn) {
            pauseBtn.addEventListener("click", async () => {
                try {
                    if (!window.pywebview?.api?.set_mod_audition_scan_paused) {
                        this.notifyToast("warn", "后端暂停接口不可用");
                        return;
                    }
                    const willPause = pauseBtn.textContent.includes("暂停");
                    pauseBtn.disabled = true;
                    const res = await pywebview.api.set_mod_audition_scan_paused(modName, willPause);
                    if (!res || !res.success) {
                        this.notifyToast("warn", res?.msg || "操作失败");
                        pauseBtn.disabled = false;
                        return;
                    }
                    pauseBtn.textContent = res.paused ? "继续解析" : "暂停解析";
                    pauseBtn.disabled = false;
                } catch (_e) {
                    pauseBtn.disabled = false;
                    this.notifyToast("warn", "操作失败");
                }
            });
        }
        if (playBtn) playBtn.addEventListener("click", playSelected);
        if (selectEl) selectEl.addEventListener("dblclick", playSelected);

        window.__auditionPickerState = {
            modId: modName,
            update: updateFromSnapshot,
            close,
        };
        updateFromSnapshot({ categories: categoriesData, progress: 0, message: "等待解析", done: false, count: 0 });
    },

    openManualPreviewPicker(modName, category, items) {
        const overlay = document.createElement("div");
        overlay.className = "modal-overlay show";
        overlay.style.zIndex = "10003";
        let viewItems = [...items];

        overlay.innerHTML = `
            <div class="modal-content" style="max-width:980px;width:min(94vw,980px);padding:20px;max-height:86vh;display:flex;flex-direction:column;">
                <h3 style="margin:0 0 12px 0;">手动选择试听语音 - ${this.escapeHtml(String(category?.name || "试听"))}</h3>
                <div style="display:flex;gap:8px;margin-bottom:10px;">
                    <input id="manual-preview-search" type="text" placeholder="搜索语音名 / bank 文件名" style="flex:1;padding:10px;border:1px solid var(--border-color);border-radius:10px;">
                    <span id="manual-preview-count" style="align-self:center;color:var(--text-secondary);font-size:13px;line-height:1;padding:8px 10px;border:1px solid var(--border-color);border-radius:8px;white-space:nowrap;">共 ${items.length} 条</span>
                </div>
                <select id="manual-preview-select" size="22" style="width:100%;flex:1;min-height:320px;font-family:Consolas, monospace;padding:10px;border:1px solid var(--border-color);border-radius:10px;"></select>
                <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:12px;">
                    <button class="btn secondary" type="button" id="manual-preview-close-btn">关闭</button>
                    <button class="btn primary" type="button" id="manual-preview-play-btn"><i class="ri-play-circle-line"></i> 播放选中语音</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);

        const selectEl = overlay.querySelector("#manual-preview-select");
        const searchEl = overlay.querySelector("#manual-preview-search");
        const countEl = overlay.querySelector("#manual-preview-count");
        const playBtn = overlay.querySelector("#manual-preview-play-btn");
        const closeBtn = overlay.querySelector("#manual-preview-close-btn");

        const rebuild = (keyword) => {
            const q = String(keyword || "").trim().toLowerCase();
            viewItems = items.filter((it) => {
                const n = String(it.name || "").toLowerCase();
                const b = String(it.bank_file || "").toLowerCase();
                return !q || n.includes(q) || b.includes(q);
            });
            selectEl.innerHTML = viewItems.map((it, idx) => {
                const nm = this.escapeHtml(String(it.name || `stream_${it.stream_index}`));
                const bk = this.escapeHtml(String(it.bank_file || "unknown.bank"));
                const d = this.formatAuditionDuration(it.duration_sec);
                return `<option value="${idx}">#${idx + 1} ${nm} (${d}) [${bk}]</option>`;
            }).join("");
            if (countEl) countEl.textContent = `显示 ${viewItems.length} / ${items.length} 条`;
        };

        const close = () => {
            if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
        };

        const playSelected = async () => {
            try {
                if (!selectEl || !selectEl.value) {
                    this.notifyToast("warn", "请先选择一条语音");
                    return;
                }
                if (!window.pywebview?.api?.audition_mod_stream) {
                    this.notifyToast("warn", "后端播放接口不可用");
                    return;
                }
                const selected = viewItems[Number(selectEl.value)];
                if (!selected) return;
                playBtn.disabled = true;
                const oldHtml = playBtn.innerHTML;
                playBtn.innerHTML = '<i class="ri-loader-2-line"></i> 解析中...';
                const res = await pywebview.api.audition_mod_stream(
                    modName,
                    selected.bank_rel,
                    selected.chunk_index,
                    selected.stream_index,
                    12
                );
                playBtn.disabled = false;
                playBtn.innerHTML = oldHtml;
                if (!res || !res.success || !res.audio_url) {
                    this.notifyToast("warn", res?.msg || "试听失败");
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
                this.notifyToast("success", `正在播放：${selected.name || ("#" + selected.stream_index)}`);
            } catch (_e) {
                playBtn.disabled = false;
                playBtn.innerHTML = '<i class="ri-play-circle-line"></i> 播放选中语音';
                this.notifyToast("warn", "试听失败");
            }
        };

        overlay.addEventListener("click", (e) => {
            if (e.target === overlay) close();
        });
        if (closeBtn) closeBtn.addEventListener("click", close);
        if (playBtn) playBtn.addEventListener("click", playSelected);
        if (selectEl) selectEl.addEventListener("dblclick", playSelected);
        if (searchEl) searchEl.addEventListener("input", (e) => rebuild(e.target.value));
        rebuild("");
    },

    openAuthorPreviewAudioPicker(modName, items) {
        const overlay = document.createElement("div");
        overlay.className = "modal-overlay show";
        overlay.style.zIndex = "10003";
        let viewItems = [...items];

        overlay.innerHTML = `
            <div class="modal-content" style="max-width:980px;width:min(94vw,980px);padding:20px;max-height:86vh;display:flex;flex-direction:column;">
                <h3 style="margin:0 0 12px 0;">作者提供的试听文件</h3>
                <div style="display:flex;gap:8px;margin-bottom:10px;">
                    <input id="author-preview-search" type="text" placeholder="搜索试听名称 / 文件名" style="flex:1;padding:10px;border:1px solid var(--border-color);border-radius:10px;">
                    <span id="author-preview-count" style="align-self:center;color:var(--text-secondary);font-size:13px;line-height:1;padding:8px 10px;border:1px solid var(--border-color);border-radius:8px;white-space:nowrap;">共 ${items.length} 条</span>
                </div>
                <select id="author-preview-select" size="18" style="width:100%;flex:1;min-height:280px;font-family:Consolas, monospace;padding:10px;border:1px solid var(--border-color);border-radius:10px;"></select>
                <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:12px;">
                    <button class="btn secondary" type="button" id="author-preview-close-btn">关闭</button>
                    <button class="btn primary" type="button" id="author-preview-play-btn"><i class="ri-play-circle-line"></i> 播放选中试听</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);

        const selectEl = overlay.querySelector("#author-preview-select");
        const searchEl = overlay.querySelector("#author-preview-search");
        const countEl = overlay.querySelector("#author-preview-count");
        const playBtn = overlay.querySelector("#author-preview-play-btn");
        const closeBtn = overlay.querySelector("#author-preview-close-btn");

        const rebuild = (keyword) => {
            const q = String(keyword || "").trim().toLowerCase();
            viewItems = items.filter((it) => {
                const name = String(it.display_name || "").toLowerCase();
                const source = String(it.source_name || it.source_file || "").toLowerCase();
                return !q || name.includes(q) || source.includes(q);
            });
            selectEl.innerHTML = viewItems.map((it, idx) => {
                const nm = this.escapeHtml(String(it.display_name || `试听音频${idx + 1}`));
                const src = this.escapeHtml(String(it.source_name || it.source_file || "unknown"));
                return `<option value="${idx}">#${idx + 1} ${nm} [${src}]</option>`;
            }).join("");
            if (countEl) countEl.textContent = `显示 ${viewItems.length} / ${items.length} 条`;
        };

        const close = () => {
            if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
        };

        const playSelected = async () => {
            try {
                if (!selectEl || !selectEl.value) {
                    this.notifyToast("warn", "请先选择一个试听文件");
                    return;
                }
                if (!window.pywebview?.api?.audition_mod_preview_audio) {
                    this.notifyToast("warn", "后端试听接口不可用");
                    return;
                }
                const selected = viewItems[Number(selectEl.value)];
                if (!selected) return;
                playBtn.disabled = true;
                const oldHtml = playBtn.innerHTML;
                playBtn.innerHTML = '<i class="ri-loader-2-line"></i> 加载试听...';
                const res = await pywebview.api.audition_mod_preview_audio(modName, selected.preview_index);
                playBtn.disabled = false;
                playBtn.innerHTML = oldHtml;
                if (!res || !res.success || !res.audio_url) {
                    this.notifyToast("warn", res?.msg || "试听失败");
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
                this.notifyToast("success", `正在播放：${res.preview_name || selected.display_name}`);
            } catch (_e) {
                playBtn.disabled = false;
                playBtn.innerHTML = '<i class="ri-play-circle-line"></i> 播放选中试听';
                this.notifyToast("warn", "试听失败");
            }
        };

        overlay.addEventListener("click", (e) => {
            if (e.target === overlay) close();
        });
        if (closeBtn) closeBtn.addEventListener("click", close);
        if (playBtn) playBtn.addEventListener("click", playSelected);
        if (selectEl) selectEl.addEventListener("dblclick", playSelected);
        if (searchEl) searchEl.addEventListener("input", (e) => rebuild(e.target.value));
        rebuild("");
    },

    onAuditionScanUpdate(modId, payload) {
        try {
            const st = window.__auditionPickerState;
            if (!st || !payload) return;
            if (String(st.modId || "") !== String(modId || "")) return;
            if (typeof st.update === "function") st.update(payload);
        } catch (_e) {
        }
    },

    bindPreviewLinkActions(overlay, mod) {
        const getLink = (action) => {
            if (action === "bili") return String(mod?.link_bilibili || "").trim();
            if (action === "qq") return String(mod?.link_qq_group || "").trim();
            if (action === "wtlive") return String(mod?.link_wtlive || "").trim();
            if (action === "liker") return String(mod?.link_liker || "").trim();
            if (action === "feedback") return String(mod?.link_feedback || "").trim();
            return "";
        };

        overlay.querySelectorAll("[data-link-action]").forEach((btn) => {
            const action = btn.dataset.linkAction;
            if (action === "otherworks") {
                const works = this.collectAuthorWorks();
                const enabled = works.length > 0;
                btn.classList.toggle("disabled", !enabled);
                btn.disabled = !enabled;
                btn.innerHTML = `<i class="ri-music-2-line"></i> 查看作者其他语音包 (${works.length})`;
                btn.onclick = () => {
                    if (!enabled) return;
                    this.openAuthorWorksModal(mod, works);
                };
                return;
            }
            const url = getLink(action);
            const enabled = Boolean(url);
            btn.classList.toggle("disabled", !enabled);
            btn.disabled = !enabled;
            btn.onclick = () => { if (enabled) this.openExternal(url); };
        });
    },

    ensureAuthorWorksModal() {
        let overlay = document.getElementById(AUTHOR_WORKS_MODAL_ID);
        if (overlay) return overlay;

        overlay = document.createElement("div");
        overlay.id = AUTHOR_WORKS_MODAL_ID;
        overlay.className = "modal-overlay author-works-overlay";
        overlay.innerHTML = `
            <div class="modal-content author-works-modal">
                <div class="author-works-header">
                    <div class="author-works-title-wrap">
                        <span class="author-works-icon"><i class="ri-user-3-line"></i></span>
                        <div>
                            <h3 id="author-works-title">作者其他语音包</h3>
                            <p id="author-works-subtitle">发现更多高质量语音包</p>
                        </div>
                    </div>
                    <button class="mod-preview-close-btn" type="button" id="btn-author-works-close" title="关闭"><i class="ri-close-line"></i></button>
                </div>
                <div class="author-works-body">
                    <div class="author-works-grid" id="author-works-grid"></div>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);
        overlay.addEventListener("click", (e) => { if (e.target === overlay) this.closeAuthorWorksModal(); });
        const closeBtn = overlay.querySelector("#btn-author-works-close");
        if (closeBtn) closeBtn.addEventListener("click", () => this.closeAuthorWorksModal());
        return overlay;
    },

    collectAuthorWorks(mod) {
        const current = mod || this.buildPreviewMod();
        const currentVersion = this.normalizeVersion(current?.version || "1.0");
        const currentDate = String(current?.date || "").trim() || new Date().toISOString().split("T")[0];
        const currentSize = String(current?.size_str || "<1 MB").trim() || "<1 MB";
        const currentAuthor = String(current?.author || this.state?.profile?.name || "未知作者").trim() || "未知作者";
        const author = String(current?.author || this.state?.profile?.name || "作者").trim();
        const related = this.normalizeRelatedVoicepacks(current?.related_voicepacks || []);
        return related.map((item, idx) => {
            const title = String(item?.name || `关联语音包${idx + 1}`).trim() || `关联语音包${idx + 1}`;
            const description = String(item?.description || "").trim() || "作者推荐语音包";
            const link = this.normalizeLink(String(item?.link || "").trim());
            const coverUrl = String(item?.avatar_url || "").trim() || DEFAULT_COVER;
            return {
                title,
                description,
                cover_url: coverUrl,
                link,
                detail_mod: {
                    id: `author-related-${idx + 1}`,
                    title,
                    author,
                    version: currentVersion,
                    date: currentDate,
                    size_str: currentSize,
                    tags: [],
                    language: ["中"],
                    note: description,
                    full_desc: description,
                    version_note: [{ version: currentVersion, note: "来自关联语音包配置。" }],
                    cover_url: coverUrl,
                    link_bilibili: link,
                    link_wtlive: "",
                    link_video: "",
                    link_qq_group: "",
                    link_liker: "",
                    link_feedback: "",
                    related_voicepacks: [],
                    capabilities: {},
                    author_avatar: this.state?.profile?.avatar || FALLBACK_AVATAR
                },
                meta: `by ${currentAuthor}`
            };
        });
    },

    renderAuthorWorksGrid(overlay, items) {
        const grid = overlay?.querySelector("#author-works-grid");
        if (!grid) return;

        if (!Array.isArray(items) || !items.length) {
            grid.innerHTML = '<div class="author-works-empty">暂无可展示的语音包</div>';
            return;
        }

        grid.innerHTML = items.map((item, idx) => {
            const title = this.escapeHtml(String(item?.title || "未命名语音包").trim() || "未命名语音包");
            const desc = this.escapeHtml(String(item?.description || "暂无描述").trim() || "暂无描述");
            const cover = this.escapeHtml(String(item?.cover_url || DEFAULT_COVER).trim() || DEFAULT_COVER);
            const hasCover = String(item?.cover_url || "").trim().length > 0;
            const canDetail = Boolean(item?.detail_mod || String(item?.link || "").trim());
            return `
                <article class="author-work-card" data-work-index="${idx}">
                    ${hasCover
                    ? `<img class="author-work-cover" src="${cover}" alt="${title}" onerror="this.src='${this.escapeHtml(DEFAULT_COVER)}'">`
                    : `<div class="author-work-cover author-work-cover-placeholder"><div class="author-work-no-image">没有图片</div><div class="author-work-no-image-deco"></div></div>`
                }
                    <div class="author-work-mask"></div>
                    <div class="author-work-info">
                        <h4>${title}</h4>
                        <p>${desc}</p>
                        <div class="author-work-actions">
                            <button class="author-work-btn dark disabled" type="button" data-work-action="audition"><i class="ri-play-line"></i> 试听</button>
                            <button class="author-work-btn light ${canDetail ? "" : "disabled"}" type="button" data-work-action="detail">详情 <i class="ri-external-link-line"></i></button>
                        </div>
                    </div>
                </article>
            `;
        }).join("");

        grid.querySelectorAll(".author-work-card").forEach((card) => {
            const idx = Number(card.getAttribute("data-work-index"));
            if (!Number.isFinite(idx)) return;
            const item = items[idx];
            card.querySelectorAll("[data-work-action]").forEach((btn) => {
                btn.addEventListener("click", (e) => {
                    e.stopPropagation();
                    const action = btn.getAttribute("data-work-action");
                    if (action === "audition") {
                        this.notifyToast("warn", "该语音包未配置试听链接");
                        return;
                    }
                    if (action === "detail") {
                        if (item?.detail_mod) {
                            this.closeAuthorWorksModal();
                            this.openModPreview(item.detail_mod);
                            return;
                        }
                        const link = String(item?.link || "").trim();
                        if (link) this.openExternal(link);
                        else this.notifyToast("warn", "该语音包暂未配置详情入口");
                    }
                });
            });
        });
    },

    openAuthorWorksModal(mod, prebuiltItems = null) {
        const overlay = this.ensureAuthorWorksModal();
        const current = this.buildPreviewMod();
        const author = String(mod?.author || current?.author || this.state?.profile?.name || "作者").trim() || "作者";

        const avatarUrl = String(this.state?.profile?.avatar || "").trim() || FALLBACK_AVATAR;
        const iconEl = overlay.querySelector(".author-works-icon");
        if (iconEl) {
            iconEl.innerHTML = `<img src="${avatarUrl}" alt="Avatar" style="width:100%;height:100%;object-fit:cover;border-radius:50%;display:block;" onerror="this.src='${FALLBACK_AVATAR}'">`;
            // 如果是图片，移除背景色和内边距可能更好，或者保持原样。
            // 原样式有 background: #eff6ff; color: #3b82f6; display: inline-flex; ...
            // img 盖在上面即可。
        }

        this.fillText(overlay, "#author-works-title", `${author} 的其他作品`);
        this.fillText(overlay, "#author-works-subtitle", "发现更多高质量语音包");
        const items = Array.isArray(prebuiltItems) ? prebuiltItems : this.collectAuthorWorks();
        if (!items.length) {
            this.notifyToast("info", "作者未配置可关联语音包");
            return;
        }
        this.renderAuthorWorksGrid(overlay, items);
        this.showOverlay(overlay);
    },

    closeAuthorWorksModal() {
        const overlay = document.getElementById(AUTHOR_WORKS_MODAL_ID);
        if (overlay) this.hideOverlay(overlay);
    },

    closeModPreview() {
        const overlay = document.getElementById(MODAL_ID);
        if (overlay) this.hideOverlay(overlay);
    },

    showOverlay(overlay) {
        if (!overlay) return;
        const timer = this._modalTimers.get(overlay.id);
        if (timer) {
            clearTimeout(timer);
            this._modalTimers.delete(overlay.id);
        }
        overlay.classList.remove("hiding");
        overlay.classList.add("show");
    },

    hideOverlay(overlay) {
        if (!overlay || !overlay.classList.contains("show")) return;
        overlay.classList.remove("show");
        overlay.classList.add("hiding");
        const timer = setTimeout(() => {
            overlay.classList.remove("hiding");
            this._modalTimers.delete(overlay.id);
        }, MODAL_FADE_MS);
        this._modalTimers.set(overlay.id, timer);
    },

    buildLangHtml(mod) {
        const langs = Array.isArray(mod?.language) ? mod.language : [];
        if (!langs.length) return `<span class="lang-text">未设置</span>`;
        return langs.map((lang) => {
            const cls = LANG_CLASS_MAP[lang] || "";
            return `<span class="lang-text ${this.escapeHtml(cls)}">${this.escapeHtml(lang)}</span>`;
        }).join('<span class="mod-preview-lang-sep">/</span>');
    },

    buildTagHtml(mod) {
        const tags = Array.isArray(mod?.tags) ? mod.tags : [];
        return tags.map((text) => {
            const cls = this.resolveTagClass(text);
            return `<span class="tag ${this.escapeHtml(cls)}">${this.escapeHtml(text)}</span>`;
        }).join("");
    },

    splitVersionNoteText(raw) {
        return String(raw || "")
            .split(/\n{2,}/)
            .map((block) => block.trim())
            .filter(Boolean)
            .map((block) => {
                const lines = block.split("\n");
                const firstLine = String(lines[0] || "").trim();
                const isPureVersion = /^v?\d+(?:\.\d+)*$/i.test(firstLine);
                if (isPureVersion) return { version: this.normalizeVersion(firstLine), note: lines.slice(1).join("\n").trim() };
                return { version: "", note: block };
            })
            .filter((item) => item.version || item.note);
    },

    resolveVersionNoteEntries(mod) {
        const entries = this.normalizeVersionNoteArray(mod?.version_note, mod?.version);
        return entries.map((item) => ({
            version: item.version ? `v${this.normalizeVersion(item.version)}` : "",
            note: String(item.note || "").trim()
        }));
    },

    buildVersionNoteHtml(mod) {
        const entries = this.resolveVersionNoteEntries(mod);
        if (!entries.length) return '<span class="mod-preview-empty">暂无详细更新日志。</span>';
        return entries.map((item) => {
            const versionHtml = item.version ? `<div class="mod-preview-note-version">${this.escapeHtml(item.version)}</div>` : "";
            const noteHtml = item.note ? `<div class="mod-preview-note-text">${this.escapeHtml(item.note)}</div>` : "";
            return `<div class="mod-preview-note-item">${versionHtml}${noteHtml || '<div class="mod-preview-note-text">暂无详细更新日志。</div>'}</div>`;
        }).join("");
    },

    fillText(root, selector, value) {
        const el = root.querySelector(selector);
        if (el) el.textContent = value || "";
    },

    fillHtml(root, selector, value) {
        const el = root.querySelector(selector);
        if (el) el.innerHTML = value || "";
    },
    parseList(text) {
        return String(text || "").split(/[,，/、\n\r]+/).map((s) => s.trim()).filter(Boolean);
    },

    normalizeVersion(value) {
        let version = String(value || "1.0").trim();
        if (version.toLowerCase().startsWith("v")) version = version.slice(1);
        return version || "1.0";
    },

    normalizeDateInput(value) {
        const raw = String(value || "").trim();
        if (!raw) return new Date().toISOString().split("T")[0];
        const slash = raw.replaceAll("/", "-");
        const m = slash.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
        if (!m) return new Date().toISOString().split("T")[0];
        const y = m[1];
        const mm = m[2].padStart(2, "0");
        const dd = m[3].padStart(2, "0");
        return `${y}-${mm}-${dd}`;
    },

    normalizeLink(value) {
        const v = String(value || "").trim();
        if (!v) return "";
        if (/^https?:\/\//i.test(v)) return v;
        return "";
    },

    tagsToCapabilities(tags) {
        const result = { tank: false, air: false, naval: false, radio: false, missile: false, music: false, noise: false, pilot: false };
        tags.forEach((tag) => {
            const cls = this.resolveTagClass(tag);
            if (cls && Object.prototype.hasOwnProperty.call(result, cls)) result[cls] = true;
        });
        if (!Object.values(result).some(Boolean)) result.tank = true;
        return result;
    },

    resolveTagClass(text) {
        const keyText = String(text || "").replace(/\s+/g, "").toLowerCase();
        const alias = [
            { cls: "tank", words: ["陆战", "坦克", "ground", "tank"] },
            { cls: "air", words: ["空战", "空军", "air"] },
            { cls: "naval", words: ["海战", "海军", "naval", "ship"] },
            { cls: "radio", words: ["无线电", "局域", "radio"] },
            { cls: "missile", words: ["导弹", "missile"] },
            { cls: "music", words: ["音乐", "music"] },
            { cls: "noise", words: ["降噪", "noise"] },
            { cls: "pilot", words: ["飞行员", "pilot"] }
        ];
        for (const item of alias) {
            if (item.words.some((word) => keyText.includes(String(word).toLowerCase()))) return item.cls;
        }
        return "default";
    },

    escapeHtml(text) {
        return String(text ?? "")
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&#39;");
    },

    async copyText(text) {
        try {
            if (navigator.clipboard && window.isSecureContext) {
                await navigator.clipboard.writeText(String(text || ""));
                return true;
            }
        } catch (_e) {
            // continue
        }

        try {
            const ta = document.createElement("textarea");
            ta.value = String(text || "");
            ta.style.position = "fixed";
            ta.style.left = "-9999px";
            document.body.appendChild(ta);
            ta.select();
            document.execCommand("copy");
            document.body.removeChild(ta);
            return true;
        } catch (_e) {
            return false;
        }
    },

    notifyToast(level, message) {
        let stack = document.getElementById("author-toast-stack");
        if (!stack) {
            stack = document.createElement("div");
            stack.id = "author-toast-stack";
            stack.className = "toast-stack";
            document.body.appendChild(stack);
        }

        const item = document.createElement("div");
        item.className = `toast-item ${level || "info"}`;
        item.textContent = message;
        stack.appendChild(item);

        setTimeout(() => {
            item.classList.add("leaving");
            setTimeout(() => item.remove(), 260);
        }, 2000);
    },

    openExternal(url) {
        const safeUrl = this.normalizeLink(url);
        if (!safeUrl) {
            this.notifyToast("warn", "链接无效，需以 http/https 开头");
            return;
        }
        try {
            window.open(safeUrl, "_blank", "noopener");
        } catch (_e) {
            this.notifyToast("warn", "打开链接失败");
        }
    },

    togglePin() {
        const btn = document.getElementById("btn-pin-title");
        if (!btn) return;
        btn.classList.toggle("active");
        const isTop = btn.classList.contains("active");
        btn.innerHTML = isTop ? '<i class="ri-pushpin-fill"></i>' : '<i class="ri-pushpin-line"></i>';
        if (window.pywebview?.api?.toggle_topmost) window.pywebview.api.toggle_topmost(isTop);
    },

    minimizeApp() {
        if (window.pywebview?.api?.minimize_window) window.pywebview.api.minimize_window();
    },

    closeApp() {
        if (window.pywebview?.api?.close_window) window.pywebview.api.close_window();
    },

    async loadAppInfo() {
        if (!window.pywebview?.api?.get_app_info) return;
        try {
            const info = await window.pywebview.api.get_app_info();
            this._appInfoCache = info || {};
            this.refreshHomeInfoCards(this._appInfoCache);
        } catch (_e) {
            this._appInfoCache = { version: "-" };
            this.refreshHomeInfoCards(this._appInfoCache);
        }
    },

    initGuideSystem() {
        if (this._guideReady) return;
        if (!window.AuthorGuide || typeof window.AuthorGuide.init !== "function") return;
        window.AuthorGuide.init(this, { autoStart: true });
        this._guideReady = true;
    },

    startGuide(force = false) {
        this.initGuideSystem();
        if (!window.AuthorGuide || typeof window.AuthorGuide.start !== "function") return;
        window.AuthorGuide.start({ force: Boolean(force) });
    },

    updateInfo(id, value) {
        const el = document.getElementById(id);
        if (el) el.textContent = value || "-";
    },

    updateInfoLink(id, label, href) {
        const el = document.getElementById(id);
        if (!el) return;
        const safeUrl = this.normalizeLink(href);
        if (!safeUrl) {
            el.textContent = label || "-";
            return;
        }
        el.innerHTML = "";
        const a = document.createElement("a");
        a.href = safeUrl;
        a.target = "_blank";
        a.rel = "noreferrer";
        a.className = "home-runtime-link";
        a.textContent = label || safeUrl;
        a.addEventListener("click", (e) => {
            e.preventDefault();
            this.openExternal(safeUrl);
        });
        el.appendChild(a);
    }
};

window.addEventListener("DOMContentLoaded", () => app.init());
window.addEventListener("pywebviewready", () => app.init());
