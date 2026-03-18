/*
 * 通用 Markdown 渲染模块
 * 基于 marked.js 提供完整 Markdown 渲染能力，含自定义扩展（@用户、#issue、剧透）
 * 同时保留对现有 notice 模块的兼容接口（parseChangelog / parseLogTextHtml 等）
 */
(function () {
    'use strict';

    /* ── 安全辅助 ─────────────────────────────────────────── */

    function escapeHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function sanitizeUrl(url) {
        var raw = String(url || '').trim();
        if (!raw) return '';
        if (/^(https?:|mailto:)/i.test(raw)) return raw;
        if (/^\.{0,2}\//.test(raw)) return raw;
        return '';
    }

    /* ── marked.js 配置 ───────────────────────────────────── */

    var markedInstance = null;

    function getMarked() {
        if (markedInstance) return markedInstance;
        if (typeof marked === 'undefined' || !marked.Marked) {
            return null;
        }
        markedInstance = new marked.Marked();
        configureMarked(markedInstance);
        return markedInstance;
    }

    function configureMarked(m) {
        var renderer = new marked.Renderer();

        /* 链接：安全过滤 + target=_blank */
        renderer.link = function (token) {
            var href = sanitizeUrl(token.href);
            if (!href) return token.text || '';
            return '<a href="' + escapeHtml(href) + '" target="_blank" rel="noopener noreferrer">' +
                (token.text || href) + '</a>';
        };

        /* 图片：添加懒加载、圆角样式 */
        renderer.image = function (token) {
            var src = sanitizeUrl(token.href);
            if (!src) return token.text || '';
            var alt = escapeHtml(token.text || '');
            var title = token.title ? ' title="' + escapeHtml(token.title) + '"' : '';
            return '<img src="' + escapeHtml(src) + '" alt="' + alt + '"' + title +
                ' loading="lazy" class="md-img">';
        };

        /* 代码块：集成 highlight.js */
        renderer.code = function (token) {
            var code = token.text || '';
            var lang = (token.lang || '').toLowerCase();
            if (typeof hljs !== 'undefined' && lang && hljs.getLanguage(lang)) {
                try {
                    var result = hljs.highlight(code, { language: lang });
                    return '<pre><code class="hljs language-' + escapeHtml(lang) + '">' +
                        result.value + '</code></pre>';
                } catch (_) { /* fallback */ }
            }
            if (typeof hljs !== 'undefined' && !lang) {
                try {
                    var auto = hljs.highlightAuto(code);
                    return '<pre><code class="hljs">' + auto.value + '</code></pre>';
                } catch (_) { /* fallback */ }
            }
            return '<pre><code>' + escapeHtml(code) + '</code></pre>';
        };

        /* 自定义扩展：||剧透内容|| */
        var spoilerExtension = {
            name: 'spoiler',
            level: 'inline',
            start: function (src) {
                return src.indexOf('||');
            },
            tokenizer: function (src) {
                var match = src.match(/^\|\|(.+?)\|\|/);
                if (match) {
                    return {
                        type: 'spoiler',
                        raw: match[0],
                        text: match[1]
                    };
                }
            },
            renderer: function (token) {
                return '<span class="md-spoiler">' + escapeHtml(token.text) + '</span>';
            }
        };

        m.use({
            renderer: renderer,
            extensions: [spoilerExtension],
            gfm: true,
            breaks: false
        });
    }

    /* ── 渲染接口 ─────────────────────────────────────────── */

    /**
     * 完整 Markdown → HTML
     * @param {string} markdownText
     * @returns {string} HTML 字符串，外层已包含 md-content class
     */
    function render(markdownText) {
        var src = String(markdownText == null ? '' : markdownText);
        if (!src.trim()) return '';

        var m = getMarked();
        if (m) {
            try {
                var html = m.parse(src);
                return postProcess(html);
            } catch (e) {
                console.warn('[MarkdownRenderer] marked.parse error, fallback', e);
            }
        }
        return fallbackRender(src);
    }

    /**
     * 行内 Markdown → HTML（不产生 <p> 等块级标签）
     * @param {string} text
     * @returns {string}
     */
    function renderInline(text) {
        var src = String(text == null ? '' : text);
        if (!src.trim()) return '';

        var m = getMarked();
        if (m && typeof m.parseInline === 'function') {
            try {
                return postProcess(m.parseInline(src));
            } catch (_) { /* fallback */ }
        }
        return fallbackRenderInline(src);
    }

    /**
     * 后处理：@用户 和 #issue 高亮（在已渲染 HTML 的纯文本部分做替换）
     */
    function postProcess(html) {
        /* 在非 HTML 标签内寻找 @username 和 #数字 */
        return html.replace(/(>|^)([^<]+)(?=<|$)/g, function (full, prefix, text) {
            var processed = text.replace(/@([a-zA-Z0-9_]+)/g,
                '<span class="md-mention">@$1</span>');
            processed = processed.replace(/#(\d+)/g,
                '<span class="md-issue">#$1</span>');
            return prefix + processed;
        });
    }

    /* ── 兼容接口：changelog 专用解析 ─────────────────────── */

    /**
     * 解析更新日志 Markdown → 结构化 sections 数据（兼容 update_notice_template.js）
     * 与原 parseMarkdown() 输出格式一致
     */
    function parseChangelog(md) {
        var lines = String(md || '').split('\n');
        var data = { title: '更新日志', version: 'Latest', sections: [] };
        var currentSection = null;

        lines.forEach(function (line) {
            var trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('---') || trimmed.startsWith('***')) return;

            if (trimmed.startsWith('# ')) {
                data.title = trimmed.substring(2).trim() || data.title;
                var vMatch = data.title.match(/[Vv]\d+(\.\d+)*/i);
                if (vMatch) data.version = vMatch[0].toUpperCase();
            } else if (trimmed.startsWith('## ')) {
                if (currentSection) data.sections.push(currentSection);
                var secTitle = trimmed.substring(3).trim();
                var typeData = { icon: 'ri-rocket-line', color: 'gray' };
                if (secTitle.indexOf('优化') >= 0) typeData = { icon: 'ri-tools-line', color: 'blue' };
                else if (secTitle.indexOf('新增') >= 0) typeData = { icon: 'ri-add-circle-line', color: 'green' };
                else if (secTitle.indexOf('修复') >= 0) typeData = { icon: 'ri-bug-line', color: 'red' };
                currentSection = { title: secTitle, icon: typeData.icon, color: typeData.color, items: [] };
            } else if (trimmed.startsWith('* ') || trimmed.startsWith('- ')) {
                if (currentSection) currentSection.items.push(trimmed.substring(2).trim());
            }
        });

        if (currentSection) data.sections.push(currentSection);
        return data;
    }

    /**
     * 解析日志行文本，将 （@用户，#issue） 部分渲染为带样式的 span
     * 兼容 update_notice_template.js 中的 helpers.parseLogTextHtml
     */
    function parseLogTextHtml(text) {
        var safeText = escapeHtml(String(text || ''));
        var parts = safeText.split(/(（.*?）)/g);
        return parts.map(function (part) {
            if (part.startsWith('（') && part.endsWith('）')) {
                var innerText = part.slice(1, -1);
                var tokens = innerText.split(/(@[a-zA-Z0-9_]+|#[0-9]+)/g);
                var tokenHtml = tokens.map(function (token) {
                    if (!token) return '';
                    if (token.startsWith('@') || token.startsWith('#')) {
                        return '<span class="notice-react-token">' + token + '</span>';
                    }
                    return token;
                }).join('');
                return '<span class="notice-react-inline-meta">（' + tokenHtml + '）</span>';
            }
            return part;
        }).join('');
    }

    /**
     * 解析文章类 Markdown（兼容 general_notice_template.js）
     */
    function parseArticleMarkdown(md, fallbackTitle) {
        var blocks = String(md || '').split(/\n{2,}/);
        var data = {
            title: fallbackTitle || '日常公告',
            date: new Date().toLocaleDateString(),
            content: []
        };

        blocks.forEach(function (block) {
            var text = block.trim();
            if (!text || text.startsWith('---')) return;

            if (text.startsWith('# ')) {
                data.title = text.substring(2).trim() || data.title;
                return;
            }
            if (text.startsWith('## ')) {
                data.content.push({ type: 'h2', text: text.substring(3).trim() });
                return;
            }
            if (text.startsWith('> ')) {
                var quoteText = text.split('\n').map(function (l) {
                    return l.replace(/^>\s*/, '').trim();
                }).join('\n');
                data.content.push({ type: 'quote', text: quoteText });
                return;
            }
            if (text.startsWith('* ') || text.startsWith('- ')) {
                var items = text.split('\n').map(function (l) {
                    return l.replace(/^[-*]\s/, '').trim();
                }).filter(Boolean);
                data.content.push({ type: 'list', items: items });
                return;
            }
            data.content.push({ type: 'paragraph', text: text });
        });

        if (!data.content.length && md) {
            data.content.push({ type: 'paragraph', text: String(md) });
        }
        return data;
    }

    /* ── 降级渲染（marked 不可用时的兜底） ────────────────── */

    function fallbackRender(src) {
        src = src.replace(/\r\n?/g, '\n');
        var lines = src.split('\n');
        var out = [];
        var paragraph = [];
        var inCode = false;
        var codeBuffer = [];
        var inUl = false;
        var inOl = false;

        function closeLists() {
            if (inUl) { out.push('</ul>'); inUl = false; }
            if (inOl) { out.push('</ol>'); inOl = false; }
        }
        function flushP() {
            if (!paragraph.length) return;
            out.push('<p>' + paragraph.map(function (l) { return fallbackRenderInline(l); }).join('<br>') + '</p>');
            paragraph.length = 0;
        }

        lines.forEach(function (line) {
            if (/^\s*```/.test(line)) { flushP(); closeLists(); if (inCode) { out.push('<pre><code>' + escapeHtml(codeBuffer.join('\n')) + '</code></pre>'); codeBuffer = []; inCode = false; } else { inCode = true; } return; }
            if (inCode) { codeBuffer.push(line); return; }
            if (/^\s*$/.test(line)) { flushP(); closeLists(); return; }
            var h = line.match(/^\s*(#{1,6})\s+(.+?)\s*$/);
            if (h) { flushP(); closeLists(); var level = Math.min(h[1].length, 6); out.push('<h' + level + '>' + fallbackRenderInline(h[2]) + '</h' + level + '>'); return; }
            var bq = line.match(/^\s*>\s?(.*)$/);
            if (bq) { flushP(); closeLists(); out.push('<blockquote>' + fallbackRenderInline(bq[1]) + '</blockquote>'); return; }
            var ul = line.match(/^\s*[-*+]\s+(.+)$/);
            if (ul) { flushP(); if (inOl) { out.push('</ol>'); inOl = false; } if (!inUl) { out.push('<ul>'); inUl = true; } out.push('<li>' + fallbackRenderInline(ul[1]) + '</li>'); return; }
            var ol = line.match(/^\s*\d+\.\s+(.+)$/);
            if (ol) { flushP(); if (inUl) { out.push('</ul>'); inUl = false; } if (!inOl) { out.push('<ol>'); inOl = true; } out.push('<li>' + fallbackRenderInline(ol[1]) + '</li>'); return; }
            closeLists();
            paragraph.push(line);
        });

        if (inCode) out.push('<pre><code>' + escapeHtml(codeBuffer.join('\n')) + '</code></pre>');
        flushP();
        if (inUl) out.push('</ul>');
        if (inOl) out.push('</ol>');
        return out.join('');
    }

    function fallbackRenderInline(text) {
        var html = escapeHtml(text);
        html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
        html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
        html = html.replace(/(^|[^*])\*([^*]+)\*(?!\*)/g, '$1<em>$2</em>');
        html = html.replace(/~~([^~]+)~~/g, '<del>$1</del>');
        html = html.replace(/\|\|(.+?)\|\|/g, '<span class="md-spoiler">$1</span>');
        html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, function (_, label, href) {
            var safeHref = sanitizeUrl(href);
            if (!safeHref) return label;
            return '<a href="' + escapeHtml(safeHref) + '" target="_blank" rel="noopener noreferrer">' + label + '</a>';
        });
        return html;
    }

    /* ── 暴露全局接口 ─────────────────────────────────────── */

    window.MarkdownRenderer = {
        render: render,
        renderInline: renderInline,
        escapeHtml: escapeHtml,
        sanitizeUrl: sanitizeUrl,
        parseChangelog: parseChangelog,
        parseLogTextHtml: parseLogTextHtml,
        parseArticleMarkdown: parseArticleMarkdown
    };
})();
