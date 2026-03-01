/* 更新公告弹窗模板 */
(function () {
    function renderUpdateTemplate(item, helpers) {
        const data = helpers.parseMarkdown(item.content || '');
        const title = data.title || item.title || '更新日志';
        const version = data.version || 'Latest';
        const intro = item.summary || 'V3 版本聚焦于交互优化、稳定性提升与功能扩展，带来更顺滑的使用体验与更完整的内容管理能力。';

        const sections = (data.sections || []).map((section) => {
            const colorClass = section.color === 'blue'
                ? 'notice-react-sec-blue'
                : section.color === 'green'
                    ? 'notice-react-sec-green'
                    : section.color === 'red'
                        ? 'notice-react-sec-red'
                        : 'notice-react-sec-gray';

            const itemsHtml = (section.items || []).map((line) => {
                return '' +
                    '<li class="notice-react-item">' +
                    '  <div class="notice-react-item-dot"></div>' +
                    '  <div class="notice-react-item-text">' + helpers.parseLogTextHtml(line) + '</div>' +
                    '</li>';
            }).join('');

            return '' +
                '<section class="notice-react-section">' +
                '  <div class="notice-react-sec-head">' +
                '    <div class="notice-react-sec-icon ' + colorClass + '"><i class="' + helpers.escapeHtml(section.icon) + '"></i></div>' +
                '    <h3>' + helpers.escapeHtml(section.title) + '</h3>' +
                '  </div>' +
                '  <ul class="notice-react-list">' + itemsHtml + '</ul>' +
                '</section>';
        }).join('');

        const bodyHtml = sections || ('<div class="notice-react-fallback">' + helpers.renderMarkdownSafe(item.content || '') + '</div>');

        return '' +
            '<div class="modal-content notice-detail-modal notice-react-update-modal">' +
            '  <div class="notice-react-header">' +
            '    <div>' +
            '      <h2 class="notice-react-title">' + helpers.escapeHtml(title) + '</h2>' +
            '      <div class="notice-react-subline">' +
            '        <span class="notice-react-pulse"></span>' +
            '        <span>更新时间: 2026年2月28日 ' + helpers.escapeHtml(version) + '</span>' +
            '      </div>' +
            '      <p class="notice-react-intro">' + helpers.escapeHtml(intro) + '</p>' +
            '    </div>' +
            '    <button class="notice-react-close" type="button" data-notice-close="1" aria-label="关闭"><i class="ri-close-line"></i></button>' +
            '  </div>' +
            '  <div class="notice-react-content custom-scrollbar">' + bodyHtml + '</div>' +
            '  <div class="notice-react-footer">' +
            '    <p>Aimer WT • 感谢支持，正在努力开发中！</p>' +
            '    <button class="notice-react-ack" type="button" data-notice-close="1"><i class="ri-check-line"></i> 我已知晓</button>' +
            '  </div>' +
            '</div>';
    }

    window.NoticeUpdateTemplate = {
        render: renderUpdateTemplate
    };
})();
