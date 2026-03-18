(function () {
    var activeInstance = null;

    function openAdUrl(url, adId) {
        if (!url) return;
        var tracked = (window.AimerUtm && window.AimerUtm.appendUtm)
            ? window.AimerUtm.appendUtm(url, 'carousel', adId)
            : url;
        if (window.AimerUtm && window.AimerUtm.reportClick) {
            window.AimerUtm.reportClick('carousel', adId || '', url);
        }
        if (window.app && typeof window.app.openExternal === "function") {
            window.app.openExternal(tracked);
            return;
        }
        window.open(tracked, "_blank");
    }

    function createEl(tag, className) {
        var el = document.createElement(tag);
        if (className) el.className = className;
        return el;
    }

    function destroyCurrent() {
        if (activeInstance && typeof activeInstance.destroy === "function") {
            activeInstance.destroy();
        }
    }

    function initAdCarousel() {
        var host = document.getElementById("home-ad-carousel");
        if (!host) return;
        if (activeInstance && activeInstance.host === host && host.dataset.adCarouselReady === "1") {
            return;
        }
        if (activeInstance && activeInstance.host !== host) {
            destroyCurrent();
        }
        host.dataset.adCarouselReady = "1";

        var cfg = window.AIMER_AD_CAROUSEL_CONFIG || {};
        var items = Array.isArray(cfg.items) ? cfg.items.filter(function (x) {
            return x && x.image;
        }) : [];

        if (!items.length) {
            host.textContent = "暂无可用广告";
            return;
        }

        var intervalMs = Number(cfg.autoPlayIntervalMs) > 1000 ? Number(cfg.autoPlayIntervalMs) : 4500;
        var current = 0;
        var timer = null;
        var transitionFallbackTimer = null;
        var hovered = false;
        var isAnimating = false;
        var total = items.length;

        var track = createEl("div", "ad-carousel-track");
        var dotsWrap = createEl("div", "ad-dots");
        var prevBtn = createEl("button", "ad-nav prev");
        var nextBtn = createEl("button", "ad-nav next");
        prevBtn.type = "button";
        nextBtn.type = "button";
        prevBtn.setAttribute("aria-label", "previous ad");
        nextBtn.setAttribute("aria-label", "next ad");
        prevBtn.textContent = "<";
        nextBtn.textContent = ">";

        function appendSlide(item, index) {
            var link = createEl("a", "ad-slide");
            link.href = item.url || "#";
            link.dataset.index = String(index);

            var img = document.createElement("img");
            img.src = item.image;
            img.alt = item.alt || ("ad-" + (index + 1));
            var px = item.position_x != null ? item.position_x : 50;
            var py = item.position_y != null ? item.position_y : 50;
            img.style.objectPosition = px + "% " + py + "%";
            link.appendChild(img);

            link.addEventListener("click", function (event) {
                event.preventDefault();
                openAdUrl(item.url, item.id);
            });

            track.appendChild(link);
        }

        // real slides
        for (var i = 0; i < total; i += 1) {
            appendSlide(items[i], i);
        }
        // clone first slide at tail for seamless rightward wrap
        if (total > 1) {
            appendSlide(items[0], total);
        }

        for (var d = 0; d < total; d += 1) {
            (function (index) {
                var dot = createEl("button", "ad-dot");
                dot.type = "button";
                dot.setAttribute("aria-label", "go to ad " + (index + 1));
                dot.dataset.index = String(index);
                dot.addEventListener("click", function () {
                    goTo(index, true);
                    resetTimer();
                });
                dotsWrap.appendChild(dot);
            })(d);
        }

        function activeRealIndex() {
            return current >= total ? 0 : current;
        }

        function clearTransitionFallback() {
            if (transitionFallbackTimer) {
                clearTimeout(transitionFallbackTimer);
                transitionFallbackTimer = null;
            }
        }

        function armTransitionFallback() {
            clearTransitionFallback();
            transitionFallbackTimer = setTimeout(function () {
                if (!isAnimating) return;
                if (current === total) {
                    goTo(0, false);
                }
                isAnimating = false;
            }, 900);
        }

        function isHostVisible() {
            if (!host || !host.isConnected) return false;
            if (host.offsetParent === null) return false;
            var rect = host.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
        }

        function render(animate) {
            track.style.transition = animate === false ? "none" : "";
            track.style.transform = "translateX(-" + (current * 100) + "%)";

            var dots = dotsWrap.querySelectorAll(".ad-dot");
            var real = activeRealIndex();
            for (var k = 0; k < dots.length; k += 1) {
                dots[k].classList.toggle("active", k === real);
            }

            if (animate === false) {
                void track.offsetWidth;
                track.style.transition = "";
                clearTransitionFallback();
            }
        }

        function goTo(index, animate) {
            current = index;
            render(animate);
        }

        function next() {
            if (total <= 1 || isAnimating) return;
            isAnimating = true;
            armTransitionFallback();

            if (current === total - 1) {
                goTo(total, true);
            } else {
                goTo(current + 1, true);
            }
        }

        function prev() {
            if (total <= 1 || isAnimating) return;
            isAnimating = true;
            armTransitionFallback();

            if (current === 0) {
                goTo(total - 1, false);
                isAnimating = false;
                clearTransitionFallback();
            } else if (current === total) {
                goTo(total - 1, false);
                isAnimating = false;
                clearTransitionFallback();
            } else {
                goTo(current - 1, true);
            }
        }

        function stopTimer() {
            if (timer) {
                clearInterval(timer);
                timer = null;
            }
        }

        function startTimer() {
            stopTimer();
            if (total <= 1) return;
            timer = setInterval(function () {
                if (!isHostVisible()) {
                    hovered = false;
                    return;
                }
                if (!hovered) next();
            }, intervalMs);
        }

        function resetTimer() {
            startTimer();
        }

        function onPrevClick() {
            prev();
            resetTimer();
        }

        function onNextClick() {
            next();
            resetTimer();
        }

        function onMouseEnter() {
            hovered = true;
        }

        function onMouseLeave() {
            hovered = false;
        }

        function onPointerEnter() {
            hovered = true;
        }

        function onPointerLeave() {
            hovered = false;
        }

        function onTransitionEnd(evt) {
            if (evt && evt.propertyName && evt.propertyName !== "transform") return;
            if (current === total) {
                goTo(0, false);
            }
            isAnimating = false;
            clearTransitionFallback();
        }

        function onVisibilityChange() {
            if (document.hidden) {
                stopTimer();
                hovered = false;
                clearTransitionFallback();
                isAnimating = false;
                return;
            }
            hovered = false;
            if (current >= total) {
                goTo(0, false);
            } else {
                render(false);
            }
            startTimer();
        }

        prevBtn.addEventListener("click", onPrevClick);
        nextBtn.addEventListener("click", onNextClick);
        host.addEventListener("mouseenter", onMouseEnter);
        host.addEventListener("mouseleave", onMouseLeave);
        host.addEventListener("pointerenter", onPointerEnter);
        host.addEventListener("pointerleave", onPointerLeave);
        track.addEventListener("transitionend", onTransitionEnd);
        document.addEventListener("visibilitychange", onVisibilityChange);

        host.appendChild(track);
        host.appendChild(prevBtn);
        host.appendChild(nextBtn);
        host.appendChild(dotsWrap);

        if (total <= 1) {
            prevBtn.style.display = "none";
            nextBtn.style.display = "none";
            dotsWrap.style.display = "none";
        }

        render(false);
        startTimer();

        activeInstance = {
            host: host,
            destroy: function () {
                stopTimer();
                clearTransitionFallback();
                prevBtn.removeEventListener("click", onPrevClick);
                nextBtn.removeEventListener("click", onNextClick);
                host.removeEventListener("mouseenter", onMouseEnter);
                host.removeEventListener("mouseleave", onMouseLeave);
                host.removeEventListener("pointerenter", onPointerEnter);
                host.removeEventListener("pointerleave", onPointerLeave);
                track.removeEventListener("transitionend", onTransitionEnd);
                document.removeEventListener("visibilitychange", onVisibilityChange);
                host.innerHTML = "";
                delete host.dataset.adCarouselReady;
                if (activeInstance && activeInstance.host === host) {
                    activeInstance = null;
                }
            }
        };
    }

    function refreshAdCarousel() {
        destroyCurrent();
        initAdCarousel();
    }

    window.AdCarouselModule = {
        init: initAdCarousel,
        refresh: refreshAdCarousel
    };

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", initAdCarousel);
    } else {
        initAdCarousel();
    }
})();
