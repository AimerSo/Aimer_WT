/* 日常/维护/活动公告弹窗模板 */
(function () {
    function renderArticleBlock(block, helpers) {
        if (!block) return '';
        if (block.type === 'h2') {
            return '<h4 class="notice-article-h2"><span class="notice-article-h2-bar"></span>' + helpers.renderInlineBasic(block.text) + '</h4>';
        }
        if (block.type === 'quote') {
            return '<div class="notice-article-quote"><i class="ri-information-line"></i><div>' + helpers.renderInlineBasic(block.text) + '</div></div>';
        }
        if (block.type === 'list') {
            const items = (block.items || []).map((x) => '<li>' + helpers.renderInlineBasic(x) + '</li>').join('');
            return '<ul class="notice-article-list">' + items + '</ul>';
        }
        return '<p class="notice-article-p">' + helpers.renderInlineBasic(block.text) + '</p>';
    }

    function renderGeneralTemplate(item, helpers) {
        const data = helpers.parseArticleMarkdown(item.content || '', item.title || '公告详情');
        const blocksHtml = (data.content || []).map((block) => renderArticleBlock(block, helpers)).join('');
        return '' +
            '<div class="modal-content notice-detail-modal notice-article-modal">' +
            '  <div class="notice-article-header">' +
            '    <div class="notice-article-head-left">' +
            '      <div class="notice-article-bell"><i class="ri-notification-3-line"></i></div>' +
            '      <div>' +
            '        <h3 class="notice-article-title">' + helpers.escapeHtml(data.title || '公告详情') + '</h3>' +
            '        <div class="notice-article-date">Release Date: ' + helpers.escapeHtml(item.date || data.date || '') + '</div>' +
            '      </div>' +
            '    </div>' +
            '    <button class="notice-detail-close" type="button" data-notice-close="1" aria-label="关闭"><i class="ri-close-line"></i></button>' +
            '  </div>' +
            '  <div class="notice-article-content custom-scrollbar">' + blocksHtml + '</div>' +
            '  <div class="notice-article-footer">' +
            '    <p>Aimer WT • 感谢支持，正在努力开发中！</p>' +
            '    <button class="notice-ack-btn" type="button" data-notice-close="1"><i class="ri-check-line"></i> 我已知晓</button>' +
            '  </div>' +
            '</div>';
    }

    window.NoticeGeneralTemplate = {
        render: renderGeneralTemplate
    };
})();
