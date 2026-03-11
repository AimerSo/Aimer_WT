(function () {
    const GUIDE_STATE_KEY = "aimerwt_author_guide_state_v2";
    const AUTO_START_DELAY_MS = 360;
    const CARD_MAX_WIDTH = 358;
    const STEP_FADE_OUT_MS = 220;
    const STEP_SWITCH_GAP_MS = 140;
    const HIGHLIGHT_SETTLE_MS = 200;

    const STEPS = [
        {
            target: "#btn-profile-edit",
            beforeShow(app) {
                if (app && typeof app.switchPage === "function") app.switchPage("home");
            },
            title: "第一步：个人主页可直接维护资料 ↗",
            description: "先在这里完善昵称、头像和主页链接，后面编辑语音包时会自动复用这些信息。",
            detail: "建议优先维护主页资料，能明显减少重复填写。"
        },
        {
            target: "#page-voicepack .voicepack-main",
            beforeShow(app) {
                if (app && typeof app.switchPage === "function") app.switchPage("voicepack");
            },
            title: "第二步：语音包库",
            description: "这里就是语音包库主界面，你可以在这里选择要编辑的语音包。",
            detail: "语音包库负责目录管理与选择入口。"
        },
        {
            target: "#btn-voicepack-open-library",
            beforeShow(app) {
                if (app && typeof app.switchPage === "function") app.switchPage("voicepack");
            },
            title: "可以]直接打开语音包目录",
            description: "点击“打开目录”可以打开存放语音包的文件夹，下方列表会显示该目录中的语音包。",
            detail: "先确认语音包文件夹位置，再进入信息编辑会更顺。"
        },
        {
            target: "#page-voiceinfo .voiceinfo-editor-title-row h2",
            beforeShow(app) {
                if (app && typeof app.switchPage === "function") app.switchPage("voiceinfo");
            },
            title: "接下来：语音包信息界面",
            description: "下面几步会介绍信息编辑区和预览区，帮助你快速完成发布前检查。",
            detail: "语音包信息页分为左侧编辑和右侧预览两块。",
            position: { mode: "below", arrow: "up", offsetY: 8 }
        },
        {
            target: "#page-voiceinfo .voiceinfo-editor",
            beforeShow(app) {
                if (app && typeof app.switchPage === "function") app.switchPage("voiceinfo");
            },
            title: "左侧是信息编辑区",
            description: "在这里填写标题、作者、封面、描述、标签、试听等内容，并保存到语音包配置。",
            detail: "建议先填基础信息，再补充试听和关联内容。",
            position: { mode: "right", arrow: "left", align: "top", offsetY: 10, pointerTop: 28 }
        },
        {
            target: "#page-voiceinfo .cover-upload-row",
            beforeShow(app) {
                if (app && typeof app.switchPage === "function") app.switchPage("voiceinfo");
            },
            title: "封面图上传",
            description: "封面图和其他图片不要超过1MB大小，越小越好，过大并不会让清晰度增加，反而会增加玩家电脑负担造成卡顿。不设置强制限制。",
            detail: "建议优先优化图片体积，保证加载速度和显示体验。",
            position: { mode: "above", arrow: "down" }
        },
        {
            target: "#btn-voiceinfo-preview-toggle",
            beforeShow(app) {
                if (app && typeof app.switchPage === "function") app.switchPage("voiceinfo");
            },
            title: "右侧是实时预览区",
            description: "编辑后可在这里立即查看卡片展示效果，便于发布前自检。",
            detail: "预览正常后再导出 BANK，可减少返工。",
            position: { mode: "left", arrow: "right", offsetY: -28 }
        },
        {
            target: "#btn-guide-help",
            title: "最后：问号按钮可重新开启教程",
            description: "点击顶部问号按钮即可重新打开教程，不影响你已填写的数据。",
            detail: "需要复习流程时，随时点问号重新开始。"
        },
        {
            target: "#btn-profile-edit",
            beforeShow(app) {
                if (app && typeof app.switchPage === "function") app.switchPage("home");
            },
            title: "现在回到主页开始填写基础信息",
            description: "接下来开始编辑个人信息吧！从个人主页先填写昵称、头像和常用链接，再继续编辑语音包会更高效。",
            detail: "基础信息建议先完善，后续多个语音包都能复用。"
        }
    ];

    const state = {
        inited: false,
        starting: false,
        active: false,
        index: 0,
        app: null,
        overlay: null,
        backdrop: null,
        focus: null,
        card: null,
        pointer: null,
        titleEl: null,
        descEl: null,
        stepEl: null,
        detailBtn: null,
        skipBtn: null,
        prevBtn: null,
        nextBtn: null,
        highlighted: null,
        renderToken: 0,
        relayoutTimers: [],
        relayoutRaf: 0,
        helpBtn: null,
        stepTransitionTimer: 0,
        cardInTimer: 0,
        stepTransitioning: false
    };

    function getHelpButton() {
        if (state.helpBtn && document.body.contains(state.helpBtn)) return state.helpBtn;
        state.helpBtn = document.getElementById("btn-guide-help");
        return state.helpBtn;
    }

    function setHelpPulse(active) {
        const btn = getHelpButton();
        if (!btn) return;
        btn.classList.toggle("guide-help-pulse", Boolean(active));
    }

    function updateFocus(target) {
        if (!state.focus) return;
        if (!state.active || !target) {
            state.focus.classList.remove("active");
            return;
        }
        const rect = target.getBoundingClientRect();
        const pad = 8;
        const left = Math.max(0, rect.left - pad);
        const top = Math.max(0, rect.top - pad);
        const width = Math.max(0, rect.width + pad * 2);
        const height = Math.max(0, rect.height + pad * 2);
        state.focus.style.left = `${Math.round(left)}px`;
        state.focus.style.top = `${Math.round(top)}px`;
        state.focus.style.width = `${Math.round(width)}px`;
        state.focus.style.height = `${Math.round(height)}px`;
        state.focus.classList.add("active");
    }

    function getGuideState() {
        const fallback = { completed: false, skipCount: 0, firstOpenHandled: false, introShown: false };
        try {
            const raw = localStorage.getItem(GUIDE_STATE_KEY);
            if (!raw) return fallback;
            const parsed = JSON.parse(raw);
            return {
                completed: Boolean(parsed?.completed),
                skipCount: Math.max(0, Number(parsed?.skipCount) || 0),
                firstOpenHandled: Boolean(parsed?.firstOpenHandled),
                introShown: Boolean(parsed?.introShown)
            };
        } catch (_e) {
            return fallback;
        }
    }

    function setGuideState(next) {
        try {
            const curr = getGuideState();
            const merged = { ...curr, ...(next || {}) };
            localStorage.setItem(GUIDE_STATE_KEY, JSON.stringify(merged));
        } catch (_e) {
            // ignore
        }
    }

    function markGuideCompleted() {
        setGuideState({ completed: true, firstOpenHandled: true });
    }

    function markGuideSkipped() {
        const curr = getGuideState();
        const skipCount = curr.skipCount + 1;
        const completed = skipCount >= 2;
        setGuideState({ skipCount, completed, firstOpenHandled: true });
        return { skipCount, completed };
    }

    function clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
    }

    function removeHighlight() {
        if (!state.highlighted) return;
        state.highlighted.classList.remove("author-guide-target-active");
        state.highlighted = null;
    }

    function syncHighlight(step) {
        const selector = step ? step.target : "";
        if (!selector) {
            removeHighlight();
            return null;
        }
        const target = document.querySelector(selector);
        if (!target) {
            removeHighlight();
            return null;
        }
        if (state.highlighted !== target) {
            removeHighlight();
            target.classList.add("author-guide-target-active");
            state.highlighted = target;
            return target;
        }
        if (!target.classList.contains("author-guide-target-active")) {
            target.classList.add("author-guide-target-active");
        }
        return target;
    }

    function clearRelayoutQueue() {
        state.relayoutTimers.forEach((id) => window.clearTimeout(id));
        state.relayoutTimers = [];
        if (state.relayoutRaf) {
            window.cancelAnimationFrame(state.relayoutRaf);
            state.relayoutRaf = 0;
        }
    }

    function relayoutStep(step, token) {
        if (!state.active || token !== state.renderToken) return;
        const target = syncHighlight(step);
        updateFocus(target);
        positionCard(target, step);
    }

    function scheduleRelayout(step, token) {
        clearRelayoutQueue();
        window.requestAnimationFrame(() => {
            relayoutStep(step, token);
            window.requestAnimationFrame(() => relayoutStep(step, token));
        });
        [90, 220, 380].forEach((delay) => {
            const timerId = window.setTimeout(() => relayoutStep(step, token), delay);
            state.relayoutTimers.push(timerId);
        });
    }

    function requestActiveRelayout() {
        if (!state.active || state.relayoutRaf) return;
        state.relayoutRaf = window.requestAnimationFrame(() => {
            state.relayoutRaf = 0;
            const step = STEPS[state.index];
            relayoutStep(step, state.renderToken);
        });
    }

    function clearStepTransitionTimer() {
        if (!state.stepTransitionTimer) return;
        window.clearTimeout(state.stepTransitionTimer);
        state.stepTransitionTimer = 0;
    }

    function clearCardInTimer() {
        if (!state.cardInTimer) return;
        window.clearTimeout(state.cardInTimer);
        state.cardInTimer = 0;
    }

    function showIntroModal(config) {
        const title = String(config?.title || "");
        const description = String(config?.description || "");
        const primaryText = String(config?.primaryText || "好的");
        const secondaryText = config?.secondaryText ? String(config.secondaryText) : "";

        return new Promise((resolve) => {
            const overlay = document.createElement("div");
            overlay.className = "author-guide-intro-overlay";
            overlay.innerHTML = `
                <section class="author-guide-card author-guide-intro-card arrow-none" role="dialog" aria-modal="true" aria-label="提示">
                    <div class="author-guide-head pywebview-drag-region">
                        <h3 class="author-guide-title"></h3>
                    </div>
                    <p class="author-guide-desc author-guide-intro-desc"></p>
                    <div class="author-guide-intro-actions">
                        ${secondaryText ? '<button class="author-guide-btn prev intro-secondary pywebview-ignore" type="button"></button>' : ""}
                        <button class="author-guide-btn next intro-primary pywebview-ignore" type="button"></button>
                    </div>
                </section>
            `;
            document.body.appendChild(overlay);

            const titleEl = overlay.querySelector(".author-guide-title");
            const descEl = overlay.querySelector(".author-guide-intro-desc");
            const primaryBtn = overlay.querySelector(".intro-primary");
            const secondaryBtn = overlay.querySelector(".intro-secondary");

            if (titleEl) titleEl.textContent = title;
            if (descEl) descEl.textContent = description;
            if (primaryBtn) primaryBtn.textContent = primaryText;
            if (secondaryBtn) secondaryBtn.textContent = secondaryText;

            const cleanup = (result) => {
                overlay.remove();
                resolve(result);
            };

            if (primaryBtn) {
                primaryBtn.addEventListener("click", () => cleanup("primary"));
            }
            if (secondaryBtn) {
                secondaryBtn.addEventListener("click", () => cleanup("secondary"));
            }
        });
    }

    async function runPreGuideIntro() {
        await showIntroModal({
            title: "欢迎使用作者端 v1 客户端版本",
            description: "本次作者端升级包括：可直接预览语音包卡片、可直接管理语音包、可将主页信息自动注入语音包内。本软件还有一些不足和 Bug，如遇到问题欢迎向我反馈。",
            primaryText: "好的"
        });

        const result = await showIntroModal({
            title: "接下来将进入引导教程",
            description: "为了帮你迅速了解本软件的使用方式，接下来会有一个引导教程。你可以选择现在开始，或稍后点击右上角问号按钮手动开启教程。",
            primaryText: "现在开始",
            secondaryText: "稍后再说"
        });
        return result === "primary";
    }

    function ensureHomeContext() {
        if (!state.app) return;
        if (typeof state.app.forceSidebarCollapsed === "function") {
            state.app.forceSidebarCollapsed(false);
        }
        if (typeof state.app.switchPage === "function" && state.app.currentPage !== "home") {
            state.app.switchPage("home");
        }
    }

    function updateButtons() {
        const isFirst = state.index === 0;
        const isLast = state.index === STEPS.length - 1;
        if (state.prevBtn) state.prevBtn.disabled = isFirst;
        if (state.nextBtn) state.nextBtn.textContent = isLast ? "完成" : "继续";
    }

    function animateCardIn() {
        if (!state.card) return;
        state.card.classList.remove("step-fade-out", "step-fade-in");
        void state.card.offsetWidth;
        state.card.classList.add("step-fade-in");
    }

    function animateCardOut(onDone) {
        if (!state.card) {
            if (typeof onDone === "function") onDone();
            return;
        }
        if (state.stepTransitioning) return;
        state.stepTransitioning = true;
        state.card.classList.remove("step-fade-in", "step-fade-out");
        void state.card.offsetWidth;
        state.card.classList.add("step-fade-out");
        clearStepTransitionTimer();
        state.stepTransitionTimer = window.setTimeout(() => {
            state.stepTransitionTimer = 0;
            state.stepTransitioning = false;
            if (typeof onDone === "function") onDone();
        }, STEP_FADE_OUT_MS + STEP_SWITCH_GAP_MS);
    }

    function positionCard(target, step) {
        if (!state.card) return;
        const card = state.card;
        const pointer = state.pointer;
        const position = step && step.position ? step.position : null;
        const margin = 10;
        const viewportW = window.innerWidth;
        const viewportH = window.innerHeight;

        card.style.left = `${margin}px`;
        card.style.top = `${margin}px`;
        card.classList.remove("arrow-left", "arrow-right", "arrow-up", "arrow-down", "arrow-none");

        const cardWidth = Math.min(CARD_MAX_WIDTH, viewportW - margin * 2);
        card.style.width = `${cardWidth}px`;
        const cardHeight = card.offsetHeight || 176;

        if (!target) {
            updateFocus(null);
            const x = clamp((viewportW - cardWidth) / 2, margin, viewportW - cardWidth - margin);
            const y = clamp((viewportH - cardHeight) / 2, margin, viewportH - cardHeight - margin);
            card.style.left = `${Math.round(x)}px`;
            card.style.top = `${Math.round(y)}px`;
            card.classList.add("arrow-none");
            return;
        }

        const rect = target.getBoundingClientRect();
        const gap = 11;

        let x = rect.right + gap;
        let y = rect.top + rect.height / 2 - cardHeight / 2;
        let arrowSide = "left";

        if (position && position.mode === "below") {
            x = rect.left + rect.width / 2 - cardWidth / 2;
            y = rect.bottom + gap;
            arrowSide = position.arrow || "none";
        } else if (position && position.mode === "above") {
            x = rect.left + rect.width / 2 - cardWidth / 2;
            y = rect.top - cardHeight - gap;
            arrowSide = position.arrow || "down";
        } else if (position && position.mode === "right") {
            x = rect.right + gap;
            if (position.align === "top") y = rect.top;
            else if (position.align === "bottom") y = rect.bottom - cardHeight;
            else y = rect.top + rect.height / 2 - cardHeight / 2;
            arrowSide = position.arrow || "left";
        } else if (position && position.mode === "left") {
            x = rect.left - cardWidth - gap;
            if (position.align === "top") y = rect.top;
            else if (position.align === "bottom") y = rect.bottom - cardHeight;
            else y = rect.top + rect.height / 2 - cardHeight / 2;
            arrowSide = position.arrow || "right";
        }

        if (position && Number.isFinite(position.offsetX)) x += position.offsetX;
        if (position && Number.isFinite(position.offsetY)) y += position.offsetY;

        if (!position && x + cardWidth > viewportW - margin) {
            x = rect.left - cardWidth - gap;
            arrowSide = "right";
        }

        if (!position && x < margin) {
            x = clamp(rect.left + rect.width / 2 - cardWidth / 2, margin, viewportW - cardWidth - margin);
            arrowSide = "none";
        }

        x = clamp(x, margin, viewportW - cardWidth - margin);
        y = clamp(y, margin, viewportH - cardHeight - margin);

        card.style.left = `${Math.round(x)}px`;
        card.style.top = `${Math.round(y)}px`;
        card.classList.add(`arrow-${arrowSide}`);

        if (pointer && arrowSide !== "none") {
            if (arrowSide === "left" || arrowSide === "right") {
                const pointerTop = Number.isFinite(position?.pointerTop)
                    ? clamp(position.pointerTop, 20, cardHeight - 20)
                    : clamp(rect.top + rect.height / 2 - y, 20, cardHeight - 20);
                pointer.style.top = `${Math.round(pointerTop)}px`;
                pointer.style.left = "";
            } else if (arrowSide === "up" || arrowSide === "down") {
                const pointerLeft = Number.isFinite(position?.pointerLeft)
                    ? clamp(position.pointerLeft, 20, cardWidth - 20)
                    : clamp(rect.left + rect.width / 2 - x, 20, cardWidth - 20);
                pointer.style.left = `${Math.round(pointerLeft)}px`;
                pointer.style.top = "";
            }
        }
    }

    function render(options = {}) {
        if (!state.active) return;
        const step = STEPS[state.index];
        if (!step) return;
        const animateIn = options.animateIn !== false;
        const animateInDelayMs = Math.max(0, Number(options.animateInDelayMs) || 0);

        if (state.titleEl) state.titleEl.textContent = step.title;
        if (state.descEl) state.descEl.textContent = step.description;
        if (state.stepEl) state.stepEl.textContent = `第 ${state.index + 1} 步（共 ${STEPS.length} 步）`;
        updateButtons();

        if (typeof step.beforeShow === "function") {
            step.beforeShow(state.app);
        }
        const token = ++state.renderToken;
        relayoutStep(step, token);
        scheduleRelayout(step, token);
        if (animateIn) {
            window.requestAnimationFrame(() => {
                window.requestAnimationFrame(() => {
                    if (!state.active || token !== state.renderToken) return;
                    clearCardInTimer();
                    state.cardInTimer = window.setTimeout(() => {
                        state.cardInTimer = 0;
                        if (!state.active || token !== state.renderToken) return;
                        animateCardIn();
                    }, animateInDelayMs);
                });
            });
        }
    }

    function stop(options = {}) {
        if (!state.active) return;
        const pulseAfterStop = Boolean(options.pulseAfterStop);
        const markCompleted = Boolean(options.markCompleted);
        state.active = false;
        state.stepTransitioning = false;
        clearStepTransitionTimer();
        clearCardInTimer();
        state.renderToken += 1;
        clearRelayoutQueue();
        if (state.overlay) state.overlay.classList.remove("active");
        if (state.focus) state.focus.classList.remove("active");
        if (state.card) state.card.classList.remove("step-fade-in", "step-fade-out");
        removeHighlight();
        if (markCompleted) markGuideCompleted();
        setHelpPulse(pulseAfterStop);
    }

    function skipGuide() {
        const result = markGuideSkipped();
        stop({ markCompleted: result.completed, pulseAfterStop: !result.completed });
    }

    function next() {
        if (!state.active) return;
        if (state.stepTransitioning) return;
        if (state.index >= STEPS.length - 1) {
            stop({ markCompleted: true, pulseAfterStop: false });
            return;
        }
        animateCardOut(() => {
            if (!state.active) return;
            state.index += 1;
            render({ animateIn: true, animateInDelayMs: HIGHLIGHT_SETTLE_MS });
        });
    }

    function prev() {
        if (!state.active) return;
        if (state.stepTransitioning) return;
        if (state.index <= 0) return;
        animateCardOut(() => {
            if (!state.active) return;
            state.index -= 1;
            render({ animateIn: true, animateInDelayMs: HIGHLIGHT_SETTLE_MS });
        });
    }

    function showDetail() {
        const step = STEPS[state.index];
        if (!step) return;
        const detail = String(step.detail || "按步骤继续即可。");
        if (state.app && typeof state.app.notifyToast === "function") {
            state.app.notifyToast("info", detail);
            return;
        }
        console.info(`[Guide] ${detail}`);
    }

    function start(options = {}) {
        if (!state.inited || state.starting || state.active) return false;
        const force = Boolean(options.force);
        const showIntro = options.showIntro !== false;

        state.starting = true;

        (async () => {
            try {
                const guideState = getGuideState();
                if (!force && guideState.completed) return;

                if (showIntro && !guideState.introShown) {
                    const proceed = await runPreGuideIntro();
                    setGuideState({ introShown: true, firstOpenHandled: true });
                    if (!proceed) {
                        setHelpPulse(true);
                        return;
                    }
                }

                setGuideState({ firstOpenHandled: true });
                setHelpPulse(false);
                ensureHomeContext();
                state.index = 0;
                state.active = true;
                state.stepTransitioning = false;
                clearStepTransitionTimer();
                if (state.overlay) state.overlay.classList.add("active");
                render({ animateIn: true });
            } finally {
                state.starting = false;
            }
        })();

        return true;
    }

    function bindEvents() {
        if (state.skipBtn) state.skipBtn.addEventListener("click", () => skipGuide());
        if (state.prevBtn) state.prevBtn.addEventListener("click", () => prev());
        if (state.nextBtn) state.nextBtn.addEventListener("click", () => next());
        if (state.detailBtn) state.detailBtn.addEventListener("click", () => showDetail());

        if (state.backdrop) {
            state.backdrop.addEventListener("click", (e) => {
                e.preventDefault();
                e.stopPropagation();
            });
        }

        window.addEventListener("resize", () => {
            requestActiveRelayout();
        });
        window.addEventListener("scroll", () => {
            requestActiveRelayout();
        }, true);
        window.addEventListener("keydown", (e) => {
            if (!state.active) return;
            if (e.key === "Escape") {
                e.preventDefault();
                skipGuide();
            } else if (e.key === "ArrowRight" || e.key === "Enter") {
                e.preventDefault();
                next();
            } else if (e.key === "ArrowLeft") {
                e.preventDefault();
                prev();
            }
        });
    }

    function buildDom() {
        const overlay = document.createElement("div");
        overlay.className = "author-guide-overlay";
        overlay.id = "author-guide-overlay";
        overlay.innerHTML = `
            <div class="author-guide-backdrop"></div>
            <div class="author-guide-focus"></div>
            <section class="author-guide-card arrow-none" role="dialog" aria-modal="true" aria-label="新手教程">
                <div class="author-guide-pointer"></div>
                <div class="author-guide-head">
                    <h3 class="author-guide-title"></h3>
                    <div class="author-guide-step-pill"></div>
                </div>
                <p class="author-guide-desc"></p>
                <div class="author-guide-foot">
                    <button class="author-guide-detail-btn" type="button">
                        <span>了解详情</span>
                        <i class="ri-external-link-line"></i>
                    </button>
                    <div class="author-guide-actions">
                        <button class="author-guide-btn skip" type="button">跳过导航</button>
                        <button class="author-guide-btn prev" type="button">上一步</button>
                        <button class="author-guide-btn next" type="button">继续</button>
                    </div>
                </div>
            </section>
        `;
        document.body.appendChild(overlay);

        state.overlay = overlay;
        state.backdrop = overlay.querySelector(".author-guide-backdrop");
        state.focus = overlay.querySelector(".author-guide-focus");
        state.card = overlay.querySelector(".author-guide-card");
        state.pointer = overlay.querySelector(".author-guide-pointer");
        state.titleEl = overlay.querySelector(".author-guide-title");
        state.descEl = overlay.querySelector(".author-guide-desc");
        state.stepEl = overlay.querySelector(".author-guide-step-pill");
        state.detailBtn = overlay.querySelector(".author-guide-detail-btn");
        state.skipBtn = overlay.querySelector(".author-guide-btn.skip");
        state.prevBtn = overlay.querySelector(".author-guide-btn.prev");
        state.nextBtn = overlay.querySelector(".author-guide-btn.next");
    }

    function init(app, options = {}) {
        if (state.inited) return;
        state.app = app || null;
        buildDom();
        bindEvents();
        state.inited = true;

        const autoStart = options.autoStart !== false;
        if (autoStart) {
            window.setTimeout(() => {
                const guideState = getGuideState();
                if (guideState.completed) {
                    setHelpPulse(false);
                    return;
                }
                if (!guideState.firstOpenHandled) {
                    start({ force: true });
                    return;
                }
                setHelpPulse(guideState.skipCount > 0);
            }, AUTO_START_DELAY_MS);
        }
    }

    window.AuthorGuide = {
        init,
        start,
        stop,
        restart() {
            return start({ force: true });
        },
        resetSeen() {
            setGuideState({ completed: false, skipCount: 0, firstOpenHandled: false, introShown: false });
            if (!state.active) setHelpPulse(true);
        }
    };
})();
