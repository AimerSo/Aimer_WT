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
        const data = helpers.parseArticleMarkdown(item.content || '', item.title || '');
        const title = item.title || data.title || '';
        const blocksHtml = (data.content || []).map((block) => renderArticleBlock(block, helpers)).join('');
        const commentEnabled = helpers.isFeatureEnabled ? helpers.isFeatureEnabled('notice_comment_enabled') : true;
        const modalClass = commentEnabled
            ? 'modal-content notice-detail-modal notice-article-modal nc-split-layout'
            : 'modal-content notice-detail-modal notice-article-modal';
        const titleHtml = title
            ? ('        <h3 class="notice-article-title">' + helpers.escapeHtml(title) + '</h3>')
            : '';
        return '' +
            '<div class="' + modalClass + '">' +
            '  <div class="nc-left-col">' +
            '  <div class="notice-article-header">' +
            '    <div class="notice-article-head-left">' +
            '      <div class="notice-article-bell"><i class="ri-notification-3-line"></i></div>' +
            '      <div>' +
            titleHtml +
            '        <div class="notice-article-date">Release Date: ' + helpers.escapeHtml(item.date || data.date || '') + '</div>' +
            '      </div>' +
            '    </div>' +
            '    <button class="notice-detail-close" type="button" data-notice-close="1" aria-label="关闭"><i class="ri-close-line"></i></button>' +
            '  </div>' +
            '  <div class="notice-article-content custom-scrollbar">' + blocksHtml + '</div>' +
            '  <div class="notice-article-footer">' +
            '    <p>Aimer WT • 感谢支持</p>' +
            '    <button class="notice-ack-btn" type="button" data-notice-close="1"><i class="ri-check-line"></i> 我已知晓</button>' +
            '  </div>' +
            '  </div>' +
            (commentEnabled ? ('  <div class="nc-panel" data-nc-notice-id="' + (item.id || '') + '"></div>') : '') +
            '</div>';
    }

    window.NoticeGeneralTemplate = {
        render: renderGeneralTemplate
    };
})();
