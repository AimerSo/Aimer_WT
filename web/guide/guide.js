(function () {
    const GUIDE_STATE_KEY = "aimerwt_main_guide_state_v1";
    const AUTO_START_DELAY_MS = 380;
    const STEP_WAIT_MAX_MS = 1400;
    const STEP_STABLE_DELTA = 0.9;
    const STEP_STABLE_FRAMES = 2;
    const STEP_RETRY_MAX = 14;
    const CARD_FADE_OUT_MS = 220;
    const CARD_FADE_IN_MS = 280;
    const CARD_SWITCH_GAP_MS = 180;
    const STEP_SWITCH_TOTAL_MS = CARD_FADE_OUT_MS + CARD_SWITCH_GAP_MS + CARD_FADE_IN_MS + 40;

    const STEPS = [
        {
            title: "欢迎使用 Aimer WT",
            description: "下面会用分步引导带你熟悉一下流程，方便你快速了解本软件。",
            detail: "这是引导前置说明页，不会高亮任何按钮。",
            position: { mode: "center", arrow: "none", offsetY: -60 },
            beforeShow(app) {
                if (app && typeof app.switchTab === "function") app.switchTab("home");
            }
        },
        {
            target: ".header-nav",
            title: "第一步：顶部导航总览",
            description: "主页、语音包库、副功能库、信息库、设置都在这里切换。",
            detail: "接下来会依次进入这些页面，高亮只会指向当前步骤。",
            beforeShow(app) {
                if (app && typeof app.switchTab === "function") app.switchTab("home");
            }
        },
        {
            target: ".notice-card",
            title: "第二步：公告栏支持联网更新",
            description: "公告栏会自动更新最新公告与活动，看到提示可以直接点击查看。",
            detail: "联网后这里会刷新内容，重要通知也会优先展示。",
            beforeShow(app) {
                if (app && typeof app.switchTab === "function") app.switchTab("home");
            }
        },
        {
            target: "#btn-auto-search",
            title: "第三步：自动搜索游戏路径",
            description: "点击自动搜索，不出意外的话，可以帮你快速定位 War Thunder 游戏目录。",
            detail: "路径正确后，导入、安装、启动流程更稳定。",
            beforeShow(app) {
                if (app && typeof app.switchTab === "function") app.switchTab("home");
            }
        },
        {
            target: "#btn-start-game",
            title: "第四步：从软件直接开始游戏",
            description: "配置完成后可在这里一键启动游戏。",
            detail: "点击“开始游戏”会使用你选择的启动方式。",
            beforeShow(app) {
                if (app && typeof app.switchTab === "function") app.switchTab("home");
            }
        },
        {
            target: ".game-status-bar .btn.secondary.icon-only",
            title: "第五步：启动方式可修改",
            description: "需要时可以在这里调整启动方式。",
            detail: "修改后会记住，下次直接按“开始游戏”即可。",
            beforeShow(app) {
                if (app && typeof app.switchTab === "function") app.switchTab("home");
            }
        },
        {
            target: "#btn-lib",
            title: "第六步：进入语音包库",
            description: "语音包库是主工作区，导入、安装、管理都在这里完成。",
            detail: "先进入语音包库，再开始导入。",
            beforeShow(app) {
                if (app && typeof app.switchTab === "function") app.switchTab("lib");
            }
        },
        {
            target: ".toolbar-v2 .btn-v2.primary",
            title: "第七步：导入压缩包入口",
            description: "点击导入压缩包，目前支持导入 ZIP / RAR / 7Z 语音包。",
            detail: "导入成功后会在列表里显示。",
            beforeShow(app) {
                if (app && typeof app.switchTab === "function") app.switchTab("lib");
            }
        },
        {
            target: "#lib-list",
            title: "第八步：语音包列表",
            description: "这里会展示你已导入的语音包，可以安装、卸载或刷新，你也可以直接点击一个卡片来查看详情页。",
            detail: "如果为空，先导入再刷新。",
            beforeShow(app) {
                if (app && typeof app.switchTab === "function") app.switchTab("lib");
            }
        },
        {
            target: "#btn-camo",
            title: "第九步：进入副功能库",
            description: "副功能库集合了涂装、炮镜、任务、模型、机库、自定义文本等资源。",
            detail: "这里是扩展资源的集中入口。",
            beforeShow(app) {
                if (app && typeof app.switchTab === "function") app.switchTab("camo");
            }
        },
        {
            target: ".resource-nav",
            title: "第十步：左侧资源导航",
            description: "左侧导航栏相比V2版本，新增了任务库、模型库、机库等管理框架。",
            detail: "在这里切换不同资源类型。",
            beforeShow(app) {
                if (app && typeof app.switchTab === "function") app.switchTab("camo");
            }
        },
        {
            target: ".resource-nav-item[data-target='custom_text']",
            title: "第十一步：自定义文本入口",
            description: "自定义文本功能非常强大，可编辑大量文本内容！",
            detail: "适合做精细化文本调整与个性化。",
            beforeShow(app) {
                if (app && typeof app.switchTab === "function") app.switchTab("camo");
                if (app && typeof app.switchResourceView === "function") {
                    app.switchResourceView("custom_text");
                }
            }
        },
        {
            target: "#view-custom_text .custom-text-main",
            title: "第十二步：自定义文本编辑区",
            description: "这里按分组与搜索筛选文本，编辑后可保存当前语言。",
            detail: "改动多、边界多时，这里最方便。",
            beforeShow(app) {
                if (app && typeof app.switchTab === "function") app.switchTab("camo");
                if (app && typeof app.switchResourceView === "function") {
                    app.switchResourceView("custom_text");
                }
            }
        },
        {
            target: "#page-sight .info-stats-grid",
            title: "第十三步：信息库快捷入口",
            description: "这里有常用网站与活动入口，点卡片即可跳转，有活动的话也会放在这里。",
            detail: "活动通知也会集中在这里显示。",
            beforeShow(app) {
                if (app && typeof app.switchTab === "function") app.switchTab("sight");
            }
        },
        {
            target: "#btn-settings",
            title: "第十四步：设置页",
            description: "主题、启动方式、托盘行为、关闭提示等都在这里管理。",
            detail: "需要细调时再回来设置即可。",
            beforeShow(app) {
                if (app && typeof app.switchTab === "function") app.switchTab("settings");
            }
        },
        {
            target: "#btn-guide-help",
            title: "第十五步：随时重开教程",
            description: "鼠标移动到左下角时会出现问号，点击问号可以随时重开引导，快速回顾流程。当鼠标移开的时候，为了美观问号会消失，",
            detail: "不会修改你的路径、配置或语音包数据。",
            beforeShow(app) {
                if (app && typeof app.switchTab === "function") app.switchTab("home");
            }
        }
    ];

    const state = {
        inited: false,
        active: false,
        index: 0,
        app: null,
        overlay: null,
        focus: null,
        card: null,
        titleEl: null,
        descEl: null,
        stepEl: null,
        detailBtn: null,
        skipBtn: null,
        prevBtn: null,
        nextBtn: null,
        highlighted: null,
        forceVisibleHelpBtn: false,
        helpBtn: null,
        helpProximityBound: false,
        stepRetryTimer: 0,
        stepRetryCount: 0,
        renderToken: 0,
        relayoutTimers: [],
        relayoutRaf: 0,
        relayoutStartTimer: 0,
        cardTransitionTimer: 0,
        lastRenderedStep: -1
    };

    function getGuideState() {
        const fallback = { completed: false, firstOpenHandled: false };
        try {
            const raw = localStorage.getItem(GUIDE_STATE_KEY);
            if (!raw) return fallback;
            const parsed = JSON.parse(raw);
            return {
                completed: Boolean(parsed?.completed),
                firstOpenHandled: Boolean(parsed?.firstOpenHandled)
            };
        } catch (_e) {
            return fallback;
        }
    }

    function setGuideState(next) {
        try {
            const curr = getGuideState();
            localStorage.setItem(GUIDE_STATE_KEY, JSON.stringify({ ...curr, ...next }));
        } catch (_e) {
        }
    }

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

    function updateHelpProximity(clientX, clientY) {
        const btn = getHelpButton();
        if (!btn) return;
        const rect = btn.getBoundingClientRect();
        const pad = 50;
        const insideExpanded =
            clientX >= rect.left - pad &&
            clientX <= rect.right + pad &&
            clientY >= rect.top - pad &&
            clientY <= rect.bottom + pad;
        btn.classList.toggle("near", insideExpanded);
    }

    function bindHelpProximity() {
        if (state.helpProximityBound) return;
        const btn = getHelpButton();
        if (!btn) return;
        state.helpProximityBound = true;
        document.addEventListener("mousemove", (e) => {
            updateHelpProximity(e.clientX, e.clientY);
        });
        window.addEventListener("resize", () => {
            btn.classList.remove("near");
        });
    }

    function clearHighlight() {
        if (state.highlighted && state.highlighted.classList) {
            state.highlighted.classList.remove("author-guide-target-active");
        }
        state.highlighted = null;
        const btn = getHelpButton();
        if (btn) btn.classList.remove("guide-force-visible");
        state.forceVisibleHelpBtn = false;
    }

    function clearRelayoutQueue() {
        if (state.relayoutStartTimer) {
            window.clearTimeout(state.relayoutStartTimer);
            state.relayoutStartTimer = 0;
        }
        if (state.relayoutRaf) {
            window.cancelAnimationFrame(state.relayoutRaf);
            state.relayoutRaf = 0;
        }
        if (state.relayoutTimers.length) {
            state.relayoutTimers.forEach((id) => window.clearTimeout(id));
            state.relayoutTimers = [];
        }
    }

    function clearCardTransitionTimer() {
        if (!state.cardTransitionTimer) return;
        window.clearTimeout(state.cardTransitionTimer);
        state.cardTransitionTimer = 0;
    }

    function ensureOverlay() {
        if (state.overlay) return;
        const overlay = document.createElement("div");
        overlay.className = "author-guide-overlay";
        overlay.id = "author-guide-overlay";
        overlay.innerHTML = `
            <div class="author-guide-backdrop"></div>
            <div class="author-guide-blocker"></div>
            <div class="author-guide-focus"></div>
            <section class="author-guide-card arrow-none" role="dialog" aria-modal="true" aria-label="新手教程">
                <div class="author-guide-pointer"></div>
                <div class="author-guide-head">
                    <h3 class="author-guide-title"></h3>
                    <div class="author-guide-step-pill"></div>
                </div>
                <p class="author-guide-desc"></p>
                <div class="author-guide-foot">
                    <button class="author-guide-detail-btn" type="button">查看提示</button>
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
        state.focus = overlay.querySelector(".author-guide-focus");
        state.card = overlay.querySelector(".author-guide-card");
        state.titleEl = overlay.querySelector(".author-guide-title");
        state.descEl = overlay.querySelector(".author-guide-desc");
        state.stepEl = overlay.querySelector(".author-guide-step-pill");
        state.detailBtn = overlay.querySelector(".author-guide-detail-btn");
        if (state.detailBtn) {
            state.detailBtn.disabled = true;
            state.detailBtn.style.visibility = "hidden";
            state.detailBtn.style.pointerEvents = "none";
        }
        state.skipBtn = overlay.querySelector(".author-guide-btn.skip");
        state.prevBtn = overlay.querySelector(".author-guide-btn.prev");
        state.nextBtn = overlay.querySelector(".author-guide-btn.next");
        syncBackdropInset();
    }

    function getHeaderHeight() {
        const header = document.querySelector(".app-header");
        if (!header || !document.body.contains(header)) return 56;
        const rect = header.getBoundingClientRect();
        const h = Number(rect?.height || 0);
        return h > 0 ? Math.ceil(h) : 56;
    }

    function syncBackdropInset() {
        if (!state.overlay) return;
        state.overlay.style.setProperty("--guide-backdrop-top", `${getHeaderHeight()}px`);
    }

    function placeCard(targetRect) {
        const cardRect = state.card.getBoundingClientRect();
        const margin = 12;
        const viewW = window.innerWidth;
        const viewH = window.innerHeight;
        const pointerWidth = 14;
        const pointerEdgePad = 16;
        const targetCenterX = targetRect.left + (targetRect.width / 2);
        const minLeft = margin;
        const maxLeft = viewW - cardRect.width - margin;
        let left = targetCenterX - (cardRect.width / 2);
        let top = targetRect.bottom + 10;
        let arrow = "arrow-up";

        if (top + cardRect.height > viewH - margin) {
            top = targetRect.top - cardRect.height - 10;
            arrow = "arrow-down";
        }
        left = Math.min(Math.max(minLeft, left), maxLeft);
        top = Math.min(Math.max(margin, top), viewH - cardRect.height - margin);

        // Keep arrow strictly aligned to highlight center, and prefer not to sit in card middle
        // by shifting the card itself (never by "fake" pointer offset).
        const minPointerX = pointerEdgePad;
        const maxPointerX = cardRect.width - pointerEdgePad - pointerWidth;
        const midBandMin = cardRect.width * 0.42;
        const midBandMax = cardRect.width * 0.58;
        const pointerIfCurrent = targetCenterX - left - (pointerWidth / 2);
        if (pointerIfCurrent >= midBandMin && pointerIfCurrent <= midBandMax) {
            const preferPointerX = targetCenterX >= (viewW / 2)
                ? (cardRect.width * 0.72)
                : (cardRect.width * 0.28);

            // left needed for exact alignment at preferred pointer x:
            // pointerX = targetCenterX - left - pointerWidth/2
            // => left = targetCenterX - pointerWidth/2 - pointerX
            const preferredLeft = targetCenterX - (pointerWidth / 2) - preferPointerX;

            // Feasible left interval that keeps pointer in card bounds while still exact.
            const feasibleLeftMin = targetCenterX - (pointerWidth / 2) - maxPointerX;
            const feasibleLeftMax = targetCenterX - (pointerWidth / 2) - minPointerX;

            const leftLower = Math.max(minLeft, feasibleLeftMin);
            const leftUpper = Math.min(maxLeft, feasibleLeftMax);
            if (leftLower <= leftUpper) {
                left = Math.min(Math.max(preferredLeft, leftLower), leftUpper);
            }
        }

        state.card.style.left = `${left}px`;
        state.card.style.top = `${top}px`;
        state.card.classList.remove("arrow-up", "arrow-down", "arrow-left", "arrow-right", "arrow-none");
        state.card.classList.add(arrow);

        // Final pointer position: always derived from geometry (strict alignment).
        const pointerLeft = targetCenterX - left - (pointerWidth / 2);
        state.card.style.setProperty("--guide-pointer-left", `${pointerLeft}px`);
    }

    function placeCardCenter(step) {
        const cardRect = state.card.getBoundingClientRect();
        const margin = 12;
        const viewW = window.innerWidth;
        const viewH = window.innerHeight;
        const offsetY = Number(step?.position?.offsetY || 0);
        const left = Math.min(Math.max(margin, (viewW - cardRect.width) / 2), viewW - cardRect.width - margin);
        const top = Math.min(
            Math.max(margin, ((viewH - cardRect.height) / 2) + offsetY),
            viewH - cardRect.height - margin
        );
        state.card.style.left = `${left}px`;
        state.card.style.top = `${top}px`;
        state.card.classList.remove("arrow-up", "arrow-down", "arrow-left", "arrow-right");
        state.card.classList.add("arrow-none");
    }

    function isRectReady(rect) {
        return Boolean(rect) && rect.width >= 6 && rect.height >= 6;
    }

    function rectDistance(a, b) {
        return Math.max(
            Math.abs(a.left - b.left),
            Math.abs(a.top - b.top),
            Math.abs(a.width - b.width),
            Math.abs(a.height - b.height)
        );
    }

    function getTargetRect(target) {
        if (!target || !document.body.contains(target)) return null;
        const rect = target.getBoundingClientRect();
        return isRectReady(rect) ? rect : null;
    }

    function renderCardTexts(step) {
        state.titleEl.textContent = step.title || "";
        state.descEl.textContent = step.description || "";
        state.stepEl.textContent = `${state.index + 1}/${STEPS.length}`;
        state.detailBtn.onclick = () => {
            if (step.detail) alert(step.detail);
        };
        updateButtons();
    }

    function runCardTransition(animate, token, doRender) {
        if (animate) clearCardTransitionTimer();

        if (!animate) {
            if (!state.card.classList.contains("step-switch-out") && !state.card.classList.contains("step-switch-in")) {
                state.card.classList.remove("step-switch-out");
                state.card.classList.remove("step-switch-in");
            }
            doRender();
            return;
        }

        // Sequence:
        // 1) card fades out
        // 2) update position/target while card hidden
        // 3) card fades in
        void state.card.offsetWidth;
        state.card.classList.remove("step-switch-in");
        state.card.classList.add("step-switch-out");
        state.cardTransitionTimer = window.setTimeout(() => {
            state.cardTransitionTimer = 0;
            if (!state.active || token !== state.renderToken) return;

            doRender();

            state.cardTransitionTimer = window.setTimeout(() => {
                state.cardTransitionTimer = 0;
                if (!state.active || token !== state.renderToken) return;
                state.card.classList.remove("step-switch-out");
                void state.card.offsetWidth;
                state.card.classList.add("step-switch-in");
                state.cardTransitionTimer = window.setTimeout(() => {
                    state.cardTransitionTimer = 0;
                    state.card.classList.remove("step-switch-in");
                }, CARD_FADE_IN_MS + 40);
            }, CARD_SWITCH_GAP_MS);
        }, CARD_FADE_OUT_MS);
    }

    function applyIntroLayout(step, token, options = {}) {
        if (!state.active || token !== state.renderToken) return;
        const animate = options.animate === true;

        const doRender = () => {
            if (!state.active || token !== state.renderToken) return;
            clearHighlight();
            if (state.focus) {
                state.focus.style.display = "none";
                state.focus.classList.remove("active");
            }
            state.overlay.classList.add("intro-step");
            renderCardTexts(step);
            placeCardCenter(step);
            state.lastRenderedStep = state.index;
        };

        runCardTransition(animate, token, doRender);
    }

    function applyHighlightLayout(step, target, rect, token, options = {}) {
        if (!state.active || token !== state.renderToken) return;
        if (!target || !document.body.contains(target)) return;
        if (!isRectReady(rect)) return;

        const animate = options.animate === true;

        const doRender = () => {
            if (!state.active || token !== state.renderToken) return;
            clearHighlight();
            state.highlighted = target;
            state.highlighted.classList.add("author-guide-target-active");
            state.overlay.classList.remove("intro-step");

            state.focus.style.display = "block";
            state.focus.style.left = `${rect.left - 6}px`;
            state.focus.style.top = `${rect.top - 6}px`;
            state.focus.style.width = `${rect.width + 12}px`;
            state.focus.style.height = `${rect.height + 12}px`;
            state.focus.classList.add("active");

            if (target.id === "btn-guide-help") {
                const btn = getHelpButton();
                if (btn) {
                    btn.classList.add("guide-force-visible");
                    state.forceVisibleHelpBtn = true;
                }
            }

            renderCardTexts(step);
            placeCard(rect);
            state.lastRenderedStep = state.index;
        };

        runCardTransition(animate, token, doRender);
    }

    function scheduleRelayout(step, target, token) {
        clearRelayoutQueue();
        const relayout = () => {
            if (!state.active || token !== state.renderToken) return;
            const rect = getTargetRect(target);
            if (!rect) return;
            applyHighlightLayout(step, target, rect, token, { animate: false });
        };

        state.relayoutRaf = window.requestAnimationFrame(() => {
            state.relayoutRaf = 0;
            relayout();
        });

        [90, 180, 320, 520].forEach((delay) => {
            const timerId = window.setTimeout(relayout, delay);
            state.relayoutTimers.push(timerId);
        });
    }

    function updateButtons() {
        const isFirst = state.index === 0;
        const isLast = state.index === STEPS.length - 1;
        state.prevBtn.disabled = isFirst;
        state.nextBtn.textContent = isLast ? "完成" : "继续";
    }

    function renderCurrentStep() {
        const token = ++state.renderToken;
        const step = STEPS[state.index];
        if (!step) return stop({ markCompleted: true });
        if (typeof step.beforeShow === "function") step.beforeShow(state.app);

        if (!step.target) {
            state.stepRetryCount = 0;
            if (state.stepRetryTimer) {
                window.clearTimeout(state.stepRetryTimer);
                state.stepRetryTimer = 0;
            }
            const shouldAnimate = state.lastRenderedStep !== state.index;
            applyIntroLayout(step, token, { animate: shouldAnimate });
            return;
        }

        const target = document.querySelector(step.target);
        if (!target) {
            if (state.stepRetryCount < STEP_RETRY_MAX) {
                state.stepRetryCount += 1;
                if (state.stepRetryTimer) window.clearTimeout(state.stepRetryTimer);
                state.stepRetryTimer = window.setTimeout(() => {
                    state.stepRetryTimer = 0;
                    if (state.active && token === state.renderToken) renderCurrentStep();
                }, 80);
                return;
            }
            state.stepRetryCount = 0;
            state.index += 1;
            if (state.index >= STEPS.length) return stop({ markCompleted: true });
            if (state.stepRetryTimer) window.clearTimeout(state.stepRetryTimer);
            state.stepRetryTimer = 0;
            window.setTimeout(() => {
                if (state.active) renderCurrentStep();
            }, 40);
            return;
        }
        state.stepRetryCount = 0;

        if (state.stepRetryTimer) {
            window.clearTimeout(state.stepRetryTimer);
            state.stepRetryTimer = 0;
        }

        const start = (window.performance && performance.now) ? performance.now() : Date.now();
        let lastRect = null;
        let stableFrames = 0;

        const tick = () => {
            if (!state.active || token !== state.renderToken) return;
            const now = (window.performance && performance.now) ? performance.now() : Date.now();
            const rect = getTargetRect(target);

            if (!rect) {
                if (now - start > STEP_WAIT_MAX_MS) {
                    renderCurrentStep();
                    return;
                }
                window.requestAnimationFrame(tick);
                return;
            }

            if (lastRect && rectDistance(lastRect, rect) <= STEP_STABLE_DELTA) {
                stableFrames += 1;
            } else {
                stableFrames = 0;
            }
            lastRect = rect;

            if (stableFrames >= STEP_STABLE_FRAMES || now - start > STEP_WAIT_MAX_MS) {
                const shouldAnimate = state.lastRenderedStep !== state.index;
                applyHighlightLayout(step, target, rect, token, { animate: shouldAnimate });
                if (shouldAnimate) {
                    state.relayoutStartTimer = window.setTimeout(() => {
                        state.relayoutStartTimer = 0;
                        if (!state.active || token !== state.renderToken) return;
                        scheduleRelayout(step, target, token);
                    }, STEP_SWITCH_TOTAL_MS);
                } else {
                    scheduleRelayout(step, target, token);
                }
                return;
            }
            window.requestAnimationFrame(tick);
        };

        window.requestAnimationFrame(tick);
    }

    function stop(opts = {}) {
        state.active = false;
        state.renderToken += 1;
        clearRelayoutQueue();
        clearCardTransitionTimer();
        if (state.stepRetryTimer) {
            window.clearTimeout(state.stepRetryTimer);
            state.stepRetryTimer = 0;
        }
        state.stepRetryCount = 0;
        clearHighlight();
        if (state.overlay) state.overlay.classList.remove("intro-step");
        if (state.focus) {
            state.focus.style.display = "none";
            state.focus.classList.remove("active");
        }
        if (state.overlay) state.overlay.classList.remove("active");
        if (opts.markCompleted) {
            setGuideState({ completed: true, firstOpenHandled: true });
            setHelpPulse(false);
        }
    }

    function start(options = {}) {
        ensureOverlay();
        const force = Boolean(options.force);
        const guideState = getGuideState();
        if (!force && guideState.completed) return false;

        setGuideState({ firstOpenHandled: true });
        state.active = true;
        state.index = 0;
        state.overlay.classList.add("active");
        syncBackdropInset();
        setHelpPulse(false);
        renderCurrentStep();
        return true;
    }

    function bindEvents() {
        if (!state.overlay) return;
        state.skipBtn.addEventListener("click", () => stop({ markCompleted: false }));
        state.prevBtn.addEventListener("click", () => {
            if (state.index <= 0) return;
            state.index -= 1;
            renderCurrentStep();
        });
        state.nextBtn.addEventListener("click", () => {
            if (state.index >= STEPS.length - 1) {
                stop({ markCompleted: true });
                return;
            }
            state.index += 1;
            renderCurrentStep();
        });
        window.addEventListener("resize", () => {
            syncBackdropInset();
            if (state.active) renderCurrentStep();
        });
        document.addEventListener("keydown", (e) => {
            if (!state.active) return;
            if (e.key === "Escape") stop({ markCompleted: false });
        });
    }

    function init(app, options = {}) {
        if (state.inited) return;
        state.app = app || null;
        bindHelpProximity();
        ensureOverlay();
        bindEvents();
        state.inited = true;

        const autoStart = options.autoStart !== false;
        if (autoStart) {
            window.setTimeout(() => {
                const guideState = getGuideState();
                if (guideState.completed) return;
                if (!guideState.firstOpenHandled) {
                    start({ force: true });
                    return;
                }
                setHelpPulse(true);
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
            setGuideState({ completed: false, firstOpenHandled: false });
            setHelpPulse(true);
        }
    };
})();
