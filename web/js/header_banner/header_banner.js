/**
 * Header Banner 信息带模块
 *
 * 功能定位:
 * - 在 Header 空白区域轮播展示更新提示、系统公告、广告标语。
 * - 完全独立，删除此文件夹不影响主程序运行。
 *
 * 优先级: 更新提示 > 系统公告 > 广告标语
 *
 * 数据来源:
 * - 广告标语: 本地默认配置
 * - 更新提示/系统公告: 由外部通过 HeaderBannerModule.pushUpdate / pushAnnouncement 注入
 */
(function () {
    'use strict';

    var ROTATE_INTERVAL = 6000;
    var _container = null;
    var _items = [];
    var _currentIndex = 0;
    var _timer = null;
    var _update_dismissed = false;
    var _currentUpdateKey = null;

    var DEFAULT_SLOGANS = [];

    function escapeHtml(str) {
        var div = document.createElement('div');
        div.textContent = str || '';
        return div.innerHTML;
    }

    function getSortedItems() {
        var priority = { update: 0, announcement: 1, slogan: 2 };
        var sorted = _items.slice();
        sorted.sort(function (a, b) {
            return (priority[a.type] || 9) - (priority[b.type] || 9);
        });
        return sorted;
    }

    function syncContainerState(hasContent) {
        if (!_container) return;
        _container.classList.toggle('has-content', !!hasContent);
    }

    function renderItem(item) {
        if (!_container) return;

        var hasDot = (item.type === 'announcement');

        var html = '<div class="header_banner banner_fade_in" data-type="' + escapeHtml(item.type) + '"'
            + (item.action ? ' data-action-type="' + escapeHtml(item.action.type || '') + '"' : '')
            + '>'
            + (hasDot ? '<span class="header_banner_dot"></span>' : '')
            + '<i class="' + escapeHtml(item.icon || 'ri-information-line') + '"></i>'
            + '<span class="header_banner_text_clip"><span class="header_banner_text">' + escapeHtml(item.text) + '</span></span>'
            + (item.type === 'update' ? '<button class="header_banner_close" title="本次不再提示"><i class="ri-close-line"></i></button>' : '')
            + '</div>';

        _container.innerHTML = html;

        var el = _container.querySelector('.header_banner');
        if (!el) return;

        if (item.action) {
            el.style.cursor = 'pointer';
            el.addEventListener('click', function () {
                handleAction(item.action);
            });
        }

        if (item.color) el.style.setProperty('--banner_text_color', item.color);
        if (item.icon_color) el.style.setProperty('--banner_icon_color', item.icon_color);

        var closeBtn = el.querySelector('.header_banner_close');
        if (closeBtn) {
            closeBtn.addEventListener('click', function (e) {
                e.stopPropagation();
                clearUpdate();
            });
        }

        // 仅当文字宽度超出容器时才启用滚动动画（所有类型统一逻辑）
        requestAnimationFrame(function () {
            var textEl = el.querySelector('.header_banner_text');
            if (!textEl) return;
            var clipWidth = textEl.parentElement.clientWidth;
            var textWidth = textEl.scrollWidth;
            // 文字能够完全容纳在容器内，则静态显示
            if (textWidth <= clipWidth + 2) return;
            // 文字超出容器，启用滚动
            textEl.style.setProperty('--clip-width', clipWidth + 'px');
            textEl.style.setProperty('--scroll-offset', '-' + textWidth + 'px');
            var totalTravel = clipWidth + textWidth;
            var duration = Math.max(5, totalTravel / 30);
            textEl.style.setProperty('--scroll-duration', duration + 's');
            textEl.classList.add('is_scrolling');
        });

        // Hover tooltip
        el.addEventListener('mouseenter', function () {
            showTooltip(item.text);
        });
        el.addEventListener('mouseleave', function () {
            hideTooltip();
        });
    }

    var _tooltipEl = null;

    function showTooltip(text) {
        if (!_container) return;
        if (!_tooltipEl) {
            _tooltipEl = document.createElement('div');
            _tooltipEl.className = 'header_banner_tooltip';
            document.body.appendChild(_tooltipEl);
        }
        _tooltipEl.textContent = text;
        var rect = _container.getBoundingClientRect();
        _tooltipEl.style.left = rect.left + 'px';
        _tooltipEl.style.top = (rect.bottom + 6) + 'px';
        requestAnimationFrame(function () {
            if (_tooltipEl) _tooltipEl.classList.add('visible');
        });
    }

    function hideTooltip() {
        if (_tooltipEl) {
            _tooltipEl.classList.remove('visible');
        }
    }

    function handleAction(action) {
        if (!action) return;

        if (action.type === 'url' && action.url) {
            if (window.app && typeof window.app.openExternal === 'function') {
                window.app.openExternal(action.url);
            } else {
                window.open(action.url, '_blank');
            }
        } else if (action.type === 'alert') {
            if (window.app && typeof window.app.showAlert === 'function') {
                window.app.showAlert(
                    action.title || '系统通知',
                    action.content || '',
                    action.level || 'info',
                    action.url || ''
                );
            }
        }
    }

    function rotateNext() {
        var sorted = getSortedItems();
        if (!sorted.length) return;

        var el = _container && _container.querySelector('.header_banner');
        if (el) {
            el.classList.remove('banner_fade_in');
            el.classList.add('banner_fade_out');
        }

        setTimeout(function () {
            _currentIndex = (_currentIndex + 1) % sorted.length;
            renderItem(sorted[_currentIndex]);
        }, 300);
    }

    function startRotation() {
        stopRotation();
        var sorted = getSortedItems();
        if (sorted.length <= 1) return;

        _timer = setInterval(rotateNext, ROTATE_INTERVAL);
    }

    function stopRotation() {
        if (_timer) {
            clearInterval(_timer);
            _timer = null;
        }
    }

    function refreshDisplay() {
        var sorted = getSortedItems();
        if (!sorted.length) {
            if (_container) _container.innerHTML = '';
            syncContainerState(false);
            return;
        }

        syncContainerState(true);
        _currentIndex = 0;
        renderItem(sorted[0]);
        startRotation();
    }

    function calcMaxWidth() {
        if (!_container) return;
        var headerLeft = document.querySelector('.header-left');
        var headerNav = document.querySelector('.header-nav');
        var header = document.querySelector('.app-header');
        if (headerLeft && headerNav && header) {
            var headerRect = header.getBoundingClientRect();
            var pl = parseFloat(getComputedStyle(header).paddingLeft) || 0;
            var leftEnd = headerLeft.getBoundingClientRect().right - headerRect.left - pl;
            var navStart = headerNav.getBoundingClientRect().left - headerRect.left - pl;
            var available = navStart - leftEnd - 8;
            _container.style.left = (leftEnd + 4) + 'px';
            _container.style.width = Math.max(available, 0) + 'px';
        }
    }

    function init() {
        _container = document.getElementById('header_banner_slot');
        if (!_container) return;

        calcMaxWidth();
        window.addEventListener('resize', calcMaxWidth);

        _items = DEFAULT_SLOGANS.slice();
        refreshDisplay();
    }

    // === 公开 API ===

    function pushUpdate(text, url) {
        var updateKey = (text || '') + '|' + (url || '');
        try {
            if (localStorage.getItem('dismissed_update_key') === updateKey) return;
        } catch (e) {}
        if (_update_dismissed) return;
        _currentUpdateKey = updateKey;
        removeByType('update');
        _items.unshift({
            type: 'update',
            icon: 'ri-error-warning-line',
            text: '有新版本',
            action: {
                type: url ? 'url' : 'alert',
                url: url || '',
                title: '发现新版本',
                content: text || '发现新版本，请前往下载更新。',
                level: 'success'
            }
        });
        _currentIndex = 0;
        refreshDisplay();
    }

    function pushAnnouncement(text, action, append) {
        var appendMode = !!append;
        if (!appendMode) {
            removeByType('announcement');
        }
        var item = {
            type: 'announcement',
            icon: 'ri-megaphone-line',
            text: text || '系统公告'
        };
        if (action) {
            item.action = action;
        } else {
            item.action = {
                type: 'alert',
                title: '系统公告',
                content: text || '',
                level: 'info'
            };
        }
        if (appendMode) {
            _items.push(item);
        } else {
            _items.unshift(item);
        }
        _currentIndex = 0;
        refreshDisplay();
    }

    function removeByType(type) {
        _items = _items.filter(function (it) { return it.type !== type; });
    }

    function clearUpdate() {
        _update_dismissed = true;
        if (_currentUpdateKey) {
            try { localStorage.setItem('dismissed_update_key', _currentUpdateKey); } catch (e) {}
        }
        removeByType('update');
        refreshDisplay();
    }

    function clearAnnouncement() {
        removeByType('announcement');
        refreshDisplay();
    }

    function setRotateInterval(intervalMs) {
        var nextInterval = Number(intervalMs);
        if (!Number.isFinite(nextInterval) || nextInterval < 3000) {
            nextInterval = 6000;
        }
        ROTATE_INTERVAL = nextInterval;
        startRotation();
    }

    // DOM 就绪后初始化
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    window.HeaderBannerModule = {
        init: init,
        pushUpdate: pushUpdate,
        pushAnnouncement: pushAnnouncement,
        clearUpdate: clearUpdate,
        clearAnnouncement: clearAnnouncement,
        _setInterval: setRotateInterval
    };
})();
