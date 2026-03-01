/* 公告栏渲染与交互模块 */
(function () {
    function escapeHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function getTypeMeta(type) {
        if (window.NoticeDataModule && typeof window.NoticeDataModule.getNoticeTypeMeta === 'function') {
            return window.NoticeDataModule.getNoticeTypeMeta(type);
        }
        return { tagClass: 'notice-tag-normal', iconClass: 'ri-notification-3-line' };
    }

    function normalizeData(data) {
        if (window.NoticeDataModule && typeof window.NoticeDataModule.normalizeNoticeData === 'function') {
            return window.NoticeDataModule.normalizeNoticeData(data);
        }
        return Array.isArray(data) ? data : [];
    }

    function buildPinnedPreview(item) {
        const summary = String(item && item.summary ? item.summary : '').trim();
        if (summary) return summary;

        const content = String(item && item.content ? item.content : '');
        if (!content) return '';

        // Fallback: strip common markdown markers so card preview never shows raw MD symbols.
        const plain = content
            .replace(/\r\n?/g, '\n')
            .replace(/```[\s\S]*?```/g, ' ')
            .replace(/^#{1,6}\s+/gm, '')
            .replace(/^\s*[-*+]\s+/gm, '')
            .replace(/^\s*\d+\.\s+/gm, '')
            .replace(/^>\s?/gm, '')
            .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')
            .replace(/[`*_~]/g, '')
            .replace(/\s+/g, ' ')
            .trim();
        return plain;
    }

    function openNoticeDetail(item, app) {
        if (window.NoticeModalModule && typeof window.NoticeModalModule.openNoticeDetail === 'function') {
            window.NoticeModalModule.openNoticeDetail(item);
            return;
        }
        if (app && typeof app.showAlert === 'function') {
            app.showAlert(item && item.title ? item.title : '公告详情', item && item.content ? escapeHtml(item.content) : '', 'info');
        }
    }

    function bindEvents(app) {
        if (!app || app._noticeEventsBound) return;
        const container = document.getElementById('notice-board') || document.querySelector('.notice-content');
        if (!container) return;

        container.addEventListener('click', (e) => {
            const target = e.target.closest('.notice-hero, .notice-item');
            if (!target) return;
            const id = String(target.getAttribute('data-notice-id') || '');
            if (!id) return;
            const map = app._noticeMap || {};
            const item = map[id];
            if (!item) return;
            openNoticeDetail(item, app);
        });

        app._noticeEventsBound = true;
    }

    function renderNoticeBoard(app) {
        const container = document.getElementById('notice-board') || document.querySelector('.notice-content');
        if (!container) return;

        const data = normalizeData(app && Array.isArray(app.noticeData) ? app.noticeData : []);
        if (!data.length) {
            container.innerHTML = '';
            return;
        }

        const pinned = data.find((item) => item.isPinned) || data[0];
        const others = data.filter((item) => String(item.id) !== String(pinned.id));
        const pinnedMeta = getTypeMeta(pinned.type);
        const map = {};
        data.forEach((item) => {
            map[String(item.id)] = item;
        });
        if (app) app._noticeMap = map;

        const listHtml = others.map((item) => {
            const meta = getTypeMeta(item.type);
            return `
                <div class="notice-item" data-type="${escapeHtml(item.type)}" data-notice-id="${escapeHtml(item.id)}">
                    <div class="notice-item-main">
                        <span class="notice-tag ${escapeHtml(meta.tagClass)}">${escapeHtml(item.tag)}</span>
                        <span class="notice-item-title">${escapeHtml(item.title)}</span>
                    </div>
                    <i class="ri-arrow-right-s-line notice-item-arrow"></i>
                </div>
            `;
        }).join('');

        const pinnedPreview = buildPinnedPreview(pinned);
        const connected = !!(app && app.telemetryConnected);
        const footerText = connected ? '已连接服务器' : '未连接到服务器';
        const dotClass = connected ? 'connected' : 'disconnected';
        container.innerHTML = `
            <div class="notice-hero" data-type="${escapeHtml(pinned.type)}" data-notice-id="${escapeHtml(pinned.id)}">
                <div class="notice-hero-deco"><i class="${escapeHtml(pinnedMeta.iconClass)}"></i></div>
                <div class="notice-hero-top">
                    <span class="notice-hero-pin"><i class="ri-pushpin-2-fill"></i> 置顶公告</span>
                    <span class="notice-hero-date">${escapeHtml(pinned.date)}</span>
                </div>
                <div class="notice-hero-title">${escapeHtml(pinned.title)}</div>
                <div class="notice-hero-desc">${escapeHtml(pinnedPreview)}</div>
            </div>
            <div class="notice-section">
                <span class="notice-section-text">往期动态</span>
                <span class="notice-section-line"></span>
            </div>
            <div class="notice-history custom-scrollbar">
                ${listHtml}
            </div>
            <div class="notice-footer" id="notice-server-status" data-connected="${connected ? '1' : '0'}">
                <span class="notice-footer-dot ${dotClass}" aria-hidden="true"></span>
                <span class="notice-footer-text">${footerText}</span>
            </div>
        `;

        bindEvents(app);
    }

    function updateNoticeBar(contentHtml) {
        const container = document.querySelector('.notice-content');
        if (container && contentHtml) {
            container.innerHTML = contentHtml;
        }
    }

    function updateServerStatusFooter(connected) {
        const footer = document.getElementById('notice-server-status');
        if (!footer) return;
        const dot = footer.querySelector('.notice-footer-dot');
        const text = footer.querySelector('.notice-footer-text');
        const isConnected = !!connected;

        footer.setAttribute('data-connected', isConnected ? '1' : '0');
        if (dot) {
            dot.classList.toggle('connected', isConnected);
            dot.classList.toggle('disconnected', !isConnected);
        }
        if (text) {
            text.textContent = isConnected ? '已连接服务器' : '未连接到服务器';
        }
    }

    window.NoticeBoardModule = {
        renderNoticeBoard: renderNoticeBoard,
        updateNoticeBar: updateNoticeBar,
        bindEvents: bindEvents,
        updateServerStatusFooter: updateServerStatusFooter
    };
})();
