/**
 * 兑换码管理模块
 * 独立于 app.js，处理「生成兑换码」和「兑换码统计」两个子视图
 */

const redeemModule = {
    _presets: [],
    _allCodes: [],
    _selectedPreset: null,
    _currentCategory: 'all',
    _statsTab: 'codes',
    _editingCodeId: null,
    _popupStyleCache: {},
    _pendingRewardLabels: null,
    _searchKeyword: '',
    _selectedCodeIds: new Set(),
    _customPresets: [],
    _categoryNotes: {},
    _presetGroups: [],
    _presetGroupCollapsed: {},

    // 默认分组定义（type → group 映射）
    _defaultPresetGroups: [
        { id: 'sponsor', name: '支持者系列', types: ['sponsor_1', 'sponsor_2', 'sponsor_3', 'sponsor_4'], color: '#ec4899' },
        { id: 'streamer', name: '主播系列', types: ['streamer', 'streamer_share'], color: '#06b6d4' }
    ],

    // 预设类型 → 弹窗样式文件映射
    _popupStyleMap: {
        'sponsor_1': 'style_sponsor_1',
        'sponsor_2': 'style_sponsor_2',
        'sponsor_3': 'style_sponsor_3',
        'sponsor_4': 'style_sponsor_4',
        'streamer': 'style_streamer',
        'streamer_share': 'style_streamer_share',
        'custom': 'style_sponsor_1',
    },

    // Logo SVG 映射（弹窗中的图标）
    _logoSvgMap: {
        'gift': '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 12 20 22 4 22 4 12"/><rect x="2" y="7" width="20" height="5"/><line x1="12" y1="22" x2="12" y2="7"/><path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z"/><path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z"/></svg>',
        'star': '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>',
        'crown': '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 4l3 12h14l3-12-6 7-4-9-4 9-6-7z"/><path d="M3 20h18"/></svg>',
        'trophy': '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h2"/><path d="M18 9h2a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2h-2"/><path d="M6 3h12v7a6 6 0 0 1-12 0V3z"/><path d="M12 16v2"/><path d="M8 22h8"/><path d="M8 22v-2h8v2"/></svg>',
        'mic': '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="22"/><line x1="8" y1="22" x2="16" y2="22"/></svg>',
        'users': '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
    },

    _defaultSubtitleMap: {
        'sponsor_1': '· 感谢支持 ·',
        'sponsor_2': '· 感谢支持 ·',
        'sponsor_3': '· 感谢支持 ·',
        'sponsor_4': '· 感谢支持 ·',
        'streamer': '· 专属福利 ·',
        'streamer_share': '· 分享福利 ·',
        'custom': '· 感谢支持 ·',
    },

    _defaultIconColorMap: {
        'sponsor_1': '#64748b',
        'sponsor_2': '#0d9488',
        'sponsor_3': '#e8c9a0',
        'sponsor_4': '#fde68a',
        'streamer': '#fcd34d',
        'streamer_share': '#fde68a',
        'custom': '#64748b',
    },

    // ─────────── 预设类型定义（与后端 redeemPresets 映射） ───────────

    // 主题文件名 → 中文显示名
    _themeDisplayNames: {
        'supporter.json': '支持者主题',
        'bi_an.json': '彼岸主题',
        'beiku.json': 'beiku 主题',
        'lianying.json': '爱樱主题',
        'chifeng.json': '赤峰主题',
    },

    // 标签内部名 → 中文显示名
    _tagLabelMap: {
        'sponsor_1': '一级支持者',
        'sponsor_2': '二级支持者',
        'sponsor_3': '三级支持者',
        'sponsor_4': '四级支持者',
        'streamer': '主播',
    },

    _escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    },

    _getPopupStyleOptions(selectedValue = 'default') {
        const options = [
            { value: 'default', label: '跟随预设类型' },
            { value: 'style_sponsor_1', label: '支持者一级' },
            { value: 'style_sponsor_2', label: '支持者二级' },
            { value: 'style_sponsor_3', label: '支持者三级' },
            { value: 'style_sponsor_4', label: '支持者四级' },
            { value: 'style_streamer', label: '主播专属' },
            { value: 'style_streamer_share', label: '主播分享' },
        ];
        if (selectedValue && !options.some((opt) => opt.value === selectedValue)) {
            options.push({ value: selectedValue, label: `保留当前值 (${selectedValue})` });
        }
        return options.map((opt) =>
            `<option value="${this._escapeHtml(opt.value)}" ${opt.value === selectedValue ? 'selected' : ''}>${this._escapeHtml(opt.label)}</option>`
        ).join('');
    },

    /** 从预设 payload JSON 中解析出可读的奖励列表，customLabels 可覆盖各项的默认文案 */
    parsePayloadRewards(payloadStr, forPopup = false, customLabels = null) {
        try {
            const p = typeof payloadStr === 'string' ? JSON.parse(payloadStr) : payloadStr;
            const rewards = [];
            if (p.theme) {
                const themeName = this._themeDisplayNames[p.theme] || p.theme;
                const defaultText = '解锁' + themeName;
                const text = (customLabels && customLabels.theme) || defaultText;
                rewards.push({ icon: '🎨', text, type: 'theme', key: 'theme', defaultText });
            }
            if (p.bonus && p.bonus > 0) {
                const defaultText = p.bonus + ' 次AI永久额度';
                const text = (customLabels && customLabels.bonus) || defaultText;
                rewards.push({ icon: '💬', text, type: 'bonus', key: 'bonus', defaultText });
            }
            if (p.daily_limit_bonus && p.daily_limit_bonus > 0) {
                const defaultText = forPopup ? '每日对话额度增加' : '每日对话额度增加 +' + p.daily_limit_bonus;
                const text = (customLabels && customLabels.daily_limit_bonus) || defaultText;
                rewards.push({ icon: '📈', text, type: 'bonus', key: 'daily_limit_bonus', defaultText });
            }
            if (p.tag) {
                let tagLabel = this._tagLabelMap[p.tag] || p.tag;
                if (this._allTagDefs) {
                    const def = this._allTagDefs.find(t => t.name === p.tag);
                    if (def) tagLabel = this._stripEmoji(def.display_name);
                }
                const defaultText = '称号: ' + tagLabel;
                const text = (customLabels && customLabels.tag) || defaultText;
                rewards.push({ icon: '🏷️', text, type: 'tag', key: 'tag', defaultText });
            }
            if (rewards.length === 0) rewards.push({ icon: '🎁', text: '无特殊奖励', type: 'bonus', key: 'none', defaultText: '无特殊奖励' });
            return rewards;
        } catch { return [{ icon: '🎁', text: '自定义内容', type: 'bonus', key: 'none', defaultText: '自定义内容' }]; }
    },

    /** 根据当前 payload 配置，动态渲染奖励文案输入行 */
    _renderRewardLabelFields() {
        const container = document.getElementById('rewardLabelFields');
        if (!container) return;
        const rewards = this.parsePayloadRewards(this._buildPayload(), true);
        if (rewards.length === 1 && rewards[0].key === 'none') {
            container.innerHTML = '<div style="font-size: 12px; color: var(--text-muted); padding: 8px 0;">当前无奖励项</div>';
            this._pendingRewardLabels = null;
            return;
        }
        const pending = this._pendingRewardLabels || {};
        const iconMap = { theme: '🎨', bonus: '💬', daily_limit_bonus: '📈', tag: '🏷️' };
        container.innerHTML = rewards.map(r => {
            const existingEl = document.getElementById('rewardLabel_' + r.key);
            const val = existingEl ? existingEl.value : (pending[r.key] || '');
            return `<div class="reward-label-row">
                <span class="reward-label-icon">${iconMap[r.key] || '🎁'}</span>
                <input type="text" class="input" id="rewardLabel_${r.key}"
                    value="${this._escapeHtml(val)}"
                    placeholder="${this._escapeHtml(r.defaultText)}"
                    oninput="redeemModule.updatePreview()">
            </div>`;
        }).join('');
        this._pendingRewardLabels = null;
    },

    /** 收集文案输入框中的自定义文案 */
    _collectRewardLabels() {
        const labels = {};
        ['theme', 'bonus', 'daily_limit_bonus', 'tag'].forEach(key => {
            const el = document.getElementById('rewardLabel_' + key);
            if (el && el.value.trim()) labels[key] = el.value.trim();
        });
        return Object.keys(labels).length > 0 ? labels : null;
    },

    /** 根据自定义文案生成弹窗中的奖励文本（用于 popup_message） */
    _buildPopupMessageFromLabels(customLabels) {
        const rewards = this.parsePayloadRewards(this._buildPayload(), true, customLabels);
        if (rewards.length === 1 && rewards[0].key === 'none') return '';
        return rewards.map(r => '✓ ' + r.text).join('\n');
    },

    // ═══════════════════════════════════════════════════════
    // 生成兑换码视图
    // ═══════════════════════════════════════════════════════

    async initGenerate() {
        await this._loadPresets();
        await this._loadTagOptions();
        this._renderPresetGrid();
        this.updatePreview();
    },

    /** 加载标签选项并填充下拉框 */
    async _loadTagOptions() {
        const select = document.getElementById('redeemPayloadTag');
        if (!select) return;
        try {
            const res = await fetch(`${app.config.apiBase}/admin/tags`);
            if (!res.ok) return;
            const data = await res.json();
            const tags = data.tags || [];
            this._allTagDefs = tags;
            const current = select.value;
            while (select.options.length > 1) select.remove(1);
            tags.forEach(tag => {
                const opt = document.createElement('option');
                opt.value = tag.name;
                opt.textContent = this._stripEmoji(tag.display_name);
                select.appendChild(opt);
            });
            select.value = current || '';
        } catch {}
    },

    _stripEmoji(text) {
        if (!text) return '';
        return text.replace(/^[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B50}\u{FE0F}\u{200D}\u{20E3}\u{2702}-\u{27B0}\u{26A0}]+\s*/u, '').trim();
    },

    async _loadPresets() {
        try {
            const res = await fetch(`${app.config.apiBase}/admin/redeem/presets`);
            if (res.ok) {
                const data = await res.json();
                this._presets = data.presets || [];
            }
        } catch {}
    },

    /** 渲染预设类型卡片（优先使用 localStorage 中的自定义配置） */
    _renderPresetGrid() {
        const grid = document.getElementById('redeemPresetGrid');
        if (!grid) return;

        this._loadCustomPresets();
        this._loadCategoryNotes();
        this._loadPresetGroups();

        // 构建所有预设卡片 HTML 的辅助方法
        const buildCard = (p, idx, isCustom = false) => {
            let displayPayload = isCustom ? JSON.stringify(p.payload) : p.payload;
            if (!isCustom) {
                const savedDefaults = this._loadSavedDefaults(p.type);
                if (savedDefaults) {
                    displayPayload = JSON.stringify({
                        theme: savedDefaults.theme || '',
                        bonus: savedDefaults.bonus || 0,
                        daily_limit_bonus: savedDefaults.daily_limit_bonus || 0,
                        tag: savedDefaults.tag || ''
                    });
                }
            }
            const rewards = this.parsePayloadRewards(displayPayload);
            const rewardHtml = rewards.map(r =>
                `<div class="preset-reward-item">
                    <div class="reward-icon ${r.type}">${r.icon}</div>
                    <span>${r.text}</span>
                </div>`
            ).join('');
            const dataIdx = isCustom ? `cp_${idx}` : idx;
            const onclickVal = isCustom ? `redeemModule.selectPreset('cp_${idx}')` : `redeemModule.selectPreset(${idx})`;
            const deleteBtn = isCustom ? `<button class="preset-delete-btn" onclick="event.stopPropagation(); redeemModule.deleteCustomPreset(${idx})" title="删除此预设">✕</button>` : '';
            return `<div class="redeem-preset-card" data-idx="${dataIdx}" onclick="${onclickVal}">
                <div class="preset-name">${this._escapeHtml(isCustom ? p.name : p.label)}</div>
                <div class="preset-type">${this._escapeHtml(isCustom ? p.type : p.type)}</div>
                <div class="preset-rewards">${rewardHtml}</div>
                ${deleteBtn}
            </div>`;
        };

        // 分组索引：type → groupId
        const typeToGroup = {};
        this._presetGroups.forEach(g => {
            (g.types || []).forEach(t => { typeToGroup[t] = g.id; });
        });

        // 收集各组的卡片
        const groupCards = {};
        this._presetGroups.forEach(g => { groupCards[g.id] = []; });
        const ungrouped = [];

        // 后端预设
        this._presets.forEach((p, idx) => {
            const gid = typeToGroup[p.type];
            const html = buildCard(p, idx, false);
            if (gid && groupCards[gid]) {
                groupCards[gid].push(html);
            } else {
                ungrouped.push(html);
            }
        });

        // 自定义预设
        this._customPresets.forEach((cp, idx) => {
            const gid = typeToGroup[cp.type];
            const html = buildCard(cp, idx, true);
            if (gid && groupCards[gid]) {
                groupCards[gid].push(html);
            } else {
                ungrouped.push(html);
            }
        });

        // 渲染分组
        let html = '';
        this._presetGroups.forEach(g => {
            const cards = groupCards[g.id] || [];
            if (cards.length === 0) return;
            const collapsed = this._presetGroupCollapsed[g.id];
            const chevronIcon = collapsed ? 'ri-arrow-right-s-line' : 'ri-arrow-down-s-line';
            html += `<div class="preset-group-section">
                <div class="preset-group-header" onclick="redeemModule.togglePresetGroup('${g.id}')">
                    <i class="${chevronIcon} preset-group-chevron"></i>
                    <span class="preset-group-dot" style="background:${g.color || '#94a3b8'}"></span>
                    <span class="preset-group-name" id="pgName_${g.id}">${this._escapeHtml(g.name)}</span>
                    <span class="preset-group-count">${cards.length}</span>
                    <div class="preset-group-actions">
                        <button class="preset-group-action-btn" onclick="event.stopPropagation(); redeemModule.startRenameGroup('${g.id}')" title="重命名"><i class="ri-pencil-line"></i></button>
                        <button class="preset-group-action-btn danger" onclick="event.stopPropagation(); redeemModule.deletePresetGroup('${g.id}')" title="删除分组"><i class="ri-delete-bin-line"></i></button>
                    </div>
                </div>
                <div class="redeem-preset-grid preset-group-grid" style="${collapsed ? 'display:none;' : ''}">
                    ${cards.join('')}
                </div>
            </div>`;
        });

        // 未分组
        if (ungrouped.length > 0) {
            const collapsed = this._presetGroupCollapsed['__ungrouped'];
            const chevronIcon = collapsed ? 'ri-arrow-right-s-line' : 'ri-arrow-down-s-line';
            html += `<div class="preset-group-section">
                <div class="preset-group-header" onclick="redeemModule.togglePresetGroup('__ungrouped')">
                    <i class="${chevronIcon} preset-group-chevron"></i>
                    <span class="preset-group-dot" style="background:#94a3b8"></span>
                    <span class="preset-group-name">其他</span>
                    <span class="preset-group-count">${ungrouped.length}</span>
                </div>
                <div class="redeem-preset-grid preset-group-grid" style="${collapsed ? 'display:none;' : ''}">
                    ${ungrouped.join('')}
                </div>
            </div>`;
        }

        // 自定义卡片（始终显示在最后）
        html += `<div style="margin-top:8px;"><div class="redeem-preset-grid"><div class="redeem-preset-card" data-idx="custom" onclick="redeemModule.selectPreset('custom')" style="border-style: dashed;">
            <div class="preset-name">✨ 自定义</div>
            <div class="preset-type">custom</div>
            <div class="preset-rewards">
                <div class="preset-reward-item">
                    <div class="reward-icon bonus">⚙️</div>
                    <span>自由配置所有参数</span>
                </div>
            </div>
        </div></div></div>`;

        grid.innerHTML = html;
    },

    /** 选中预设类型 */
    selectPreset(idx) {
        this._selectedPreset = idx;

        // 高亮选中卡片
        document.querySelectorAll('.redeem-preset-card').forEach(c => c.classList.remove('selected'));
        const card = document.querySelector(`.redeem-preset-card[data-idx="${idx}"]`);
        if (card) card.classList.add('selected');

        // 展开配置面板
        const panel = document.getElementById('redeemGenPanel');
        if (panel) panel.style.display = '';

        // 获取预设类型名
        let presetType = 'custom';
        if (typeof idx === 'string' && idx.startsWith('cp_')) {
            const cpIdx = parseInt(idx.replace('cp_', ''));
            const cp = this._customPresets[cpIdx];
            if (cp) presetType = cp.type;
        } else if (idx !== 'custom') {
            const preset = this._presets[idx];
            if (preset) presetType = preset.type;
        }

        // 尝试从 localStorage 加载保存的默认预设
        const savedDefaults = this._loadSavedDefaults(presetType);

        if (savedDefaults) {
            // 使用保存的默认值
            document.getElementById('redeemPayloadTheme').value = savedDefaults.theme || '';
            document.getElementById('redeemPayloadBonus').value = savedDefaults.bonus || 0;
            document.getElementById('redeemPayloadDailyBonus').value = savedDefaults.daily_limit_bonus || 0;
            document.getElementById('redeemPayloadTag').value = savedDefaults.tag || '';
            document.getElementById('redeemGenMaxUses').value = savedDefaults.max_uses || 1;
            // 弹窗自定义字段
            document.getElementById('redeemPopupTitle').value = savedDefaults.popup_title || '';
            document.getElementById('redeemPopupButton').value = savedDefaults.popup_button || '';
            document.getElementById('redeemPopupMessage').value = savedDefaults.popup_message || '';
            const subtitleEl = document.getElementById('redeemPopupSubtitle');
            if (subtitleEl) subtitleEl.value = savedDefaults.popup_subtitle || '';
            const iconColorEl = document.getElementById('redeemPopupIconColor');
            if (iconColorEl) iconColorEl.value = savedDefaults.popup_icon_color || this._defaultIconColorMap[presetType] || '#64748b';
            const styleSelect = document.getElementById('redeemPopupStyleSelect');
            if (styleSelect) styleSelect.value = savedDefaults.popup_style_select || 'default';
            const logoSelect = document.getElementById('redeemPopupLogo');
            if (logoSelect) logoSelect.value = savedDefaults.popup_logo || 'default';
            // 主播相关字段
            const noteTagEl = document.getElementById('redeemNoteTag');
            if (noteTagEl) noteTagEl.value = savedDefaults.note_tag || '';
            const streamerIdEl = document.getElementById('redeemStreamerId');
            if (streamerIdEl) streamerIdEl.value = savedDefaults.streamer_id || '';
            // 暂存自定义文案以供 _renderRewardLabelFields 回填
            this._pendingRewardLabels = savedDefaults.reward_labels || null;
        } else if (idx !== 'custom' && !(typeof idx === 'string' && idx.startsWith('cp_'))) {
            // 使用服务器预设默认值
            const preset = this._presets[idx];
            if (preset) {
                try {
                    const p = JSON.parse(preset.payload);
                    document.getElementById('redeemPayloadTheme').value = p.theme || '';
                    document.getElementById('redeemPayloadBonus').value = p.bonus || 0;
                    document.getElementById('redeemPayloadDailyBonus').value = p.daily_limit_bonus || 0;
                    document.getElementById('redeemPayloadTag').value = p.tag || '';
                } catch {}
                document.getElementById('redeemGenMaxUses').value = preset.max_uses || 1;
            }
            // 清空弹窗自定义字段
            document.getElementById('redeemPopupTitle').value = '';
            document.getElementById('redeemPopupButton').value = '';
            document.getElementById('redeemPopupMessage').value = '';
            const subtitleEl2 = document.getElementById('redeemPopupSubtitle');
            if (subtitleEl2) subtitleEl2.value = '';
            const iconColorEl2 = document.getElementById('redeemPopupIconColor');
            if (iconColorEl2) iconColorEl2.value = this._defaultIconColorMap[presetType] || '#64748b';
            const styleSelect = document.getElementById('redeemPopupStyleSelect');
            if (styleSelect) styleSelect.value = 'default';
            const logoSelect = document.getElementById('redeemPopupLogo');
            if (logoSelect) logoSelect.value = 'default';
        } else {
            document.getElementById('redeemPayloadTheme').value = '';
            document.getElementById('redeemPayloadBonus').value = 0;
            document.getElementById('redeemPayloadDailyBonus').value = 0;
            document.getElementById('redeemPayloadTag').value = '';
            document.getElementById('redeemGenMaxUses').value = 1;
            document.getElementById('redeemPopupTitle').value = '';
            document.getElementById('redeemPopupButton').value = '';
            document.getElementById('redeemPopupMessage').value = '';
            const subtitleEl3 = document.getElementById('redeemPopupSubtitle');
            if (subtitleEl3) subtitleEl3.value = '';
            const iconColorEl3 = document.getElementById('redeemPopupIconColor');
            if (iconColorEl3) iconColorEl3.value = '#64748b';
            const styleSelect = document.getElementById('redeemPopupStyleSelect');
            if (styleSelect) styleSelect.value = 'default';
            const logoSelect = document.getElementById('redeemPopupLogo');
            if (logoSelect) logoSelect.value = 'default';
        }

        // 根据预设类型显示/隐藏主播相关行
        this._updateStreamerRows(presetType);
        this._renderRewardLabelFields();
        this.updatePreview();
    },

    /** 标签下拉变更时显示/隐藏主播相关输入行 */
    onTagChange() {
        const tag = document.getElementById('redeemPayloadTag')?.value || '';
        const noteRow = document.getElementById('redeemNoteTagRow');
        if (noteRow) noteRow.style.display = tag === 'streamer' ? '' : 'none';
        this.updatePreview();
    },

    /** 根据预设类型显示/隐藏主播相关行 */
    _updateStreamerRows(presetType) {
        const noteRow = document.getElementById('redeemNoteTagRow');
        const streamerIdRow = document.getElementById('redeemStreamerIdRow');
        const tag = document.getElementById('redeemPayloadTag')?.value || '';
        // 备注标签行：主播类型或标签选为“主播”时显示
        if (noteRow) noteRow.style.display = (presetType === 'streamer' || presetType === 'streamer_share' || tag === 'streamer') ? '' : 'none';
        // 主播ID行：仅主播分享类型时显示
        if (streamerIdRow) streamerIdRow.style.display = presetType === 'streamer_share' ? '' : 'none';
    },

    /** 收集当前 payload JSON */
    _buildPayload() {
        const theme = document.getElementById('redeemPayloadTheme')?.value?.trim() || '';
        const bonus = parseInt(document.getElementById('redeemPayloadBonus')?.value) || 0;
        const daily_limit_bonus = parseInt(document.getElementById('redeemPayloadDailyBonus')?.value) || 0;
        const tag = document.getElementById('redeemPayloadTag')?.value?.trim() || '';
        return JSON.stringify({ theme, bonus, daily_limit_bonus, tag });
    },

    /** 更新弹窗预览（加载对应预设类型的 HTML 模板） */
    async updatePreview() {
        const frame = document.getElementById('popupPreviewFrame');
        if (!frame) return;

        // 确定当前选中的预设类型
        let presetType = 'sponsor_1';
        if (this._selectedPreset !== null && this._selectedPreset !== 'custom') {
            const preset = this._presets[this._selectedPreset];
            if (preset) presetType = preset.type;
        } else if (this._selectedPreset === 'custom') {
            presetType = 'custom';
        }

        // 弹窗样式：优先使用自定义选择，否则跟随预设类型
        const styleSelectVal = document.getElementById('redeemPopupStyleSelect')?.value || 'default';
        let styleName;
        if (styleSelectVal !== 'default') {
            styleName = styleSelectVal;
        } else {
            styleName = this._popupStyleMap[presetType] || 'style_sponsor_1';
        }

        const customTitle = document.getElementById('redeemPopupTitle')?.value?.trim() || '';
        const customMsg = document.getElementById('redeemPopupMessage')?.value?.trim() || '';

        // 构建奖励列表 HTML（使用自定义文案）
        const customLabels = this._collectRewardLabels();
        const rewards = this.parsePayloadRewards(this._buildPayload(), true, customLabels);
        const rewardItemsHtml = rewards.map(r =>
            `<div style="display:flex; align-items:center; gap:8px; margin-bottom:6px; font-size:13px;">` +
            `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink:0; opacity:0.6;"><path d="M20 6L9 17l-5-5"/></svg>` +
            `<span>${r.text}</span></div>`
        ).join('');

        const displayTitle = customTitle || '兑换成功';
        const displayRewards = customMsg
            ? `<div style="font-size:13px; line-height:1.6; white-space:pre-line;">${customMsg}</div>`
            : rewardItemsHtml;

        const customSubtitle = document.getElementById('redeemPopupSubtitle')?.value?.trim() || '';
        const displaySubtitle = customSubtitle || this._defaultSubtitleMap[presetType] || '· 感谢支持 ·';

        const iconColorEl = document.getElementById('redeemPopupIconColor');
        const defaultColor = this._defaultIconColorMap[presetType] || '#64748b';
        const displayIconColor = iconColorEl?.value || defaultColor;
        const colorLabel = document.getElementById('redeemPopupIconColorLabel');
        if (colorLabel) colorLabel.textContent = displayIconColor;

        // 按钮文字：优先使用自定义，否则用默认值
        const customButton = document.getElementById('redeemPopupButton')?.value?.trim() || '';
        const defaultButtons = {
            sponsor_1: '我们是好朋友', sponsor_2: '永远的好朋友', sponsor_3: '永远的好朋友',
            sponsor_4: '永远的好朋友', streamer: '确认领取',
            streamer_share: '好的', custom: '确定'
        };
        const displayButton = customButton || defaultButtons[presetType] || '确定';

        // 加载模板
        try {
            const res = await fetch(`redeem/popup_styles/${styleName}.html?t=${Date.now()}`);
            if (res.ok) this._popupStyleCache[styleName] = await res.text();
            let html = this._popupStyleCache[styleName] || '';
            html = html.replace('{{TITLE}}', displayTitle)
                       .replace('{{REWARDS}}', displayRewards)
                       .replace('{{BUTTON}}', displayButton)
                       .replace('{{SUBTITLE}}', displaySubtitle)
                       .replace('{{ICON_COLOR}}', displayIconColor);

            // Logo 替换：如果用户选择了自定义 Logo→替换模板中的 SVG
            const logoVal = document.getElementById('redeemPopupLogo')?.value || 'default';
            if (logoVal !== 'default' && this._logoSvgMap[logoVal]) {
                html = html.replace(/<svg[^>]*>.*?<\/svg>/is, this._logoSvgMap[logoVal]);
            }

            // 主播分享文案替换：将“分享福利”替换为“来自xxx的分享”
            const streamerId = document.getElementById('redeemStreamerId')?.value?.trim() || '';
            if (streamerId && (presetType === 'streamer_share' || styleName === 'style_streamer_share')) {
                const currentSubtitle = customSubtitle || this._defaultSubtitleMap['streamer_share'];
                html = html.replace(currentSubtitle, `· 来自${streamerId}的分享 ·`);
            }

            frame.innerHTML = html;
        } catch {
            frame.innerHTML = '<div style="color:#94a3b8; font-size:13px;">预览加载失败</div>';
        }
    },

    /** 重置表单 */
    resetForm() {
        this._selectedPreset = null;
        document.querySelectorAll('.redeem-preset-card').forEach(c => c.classList.remove('selected'));
        document.getElementById('redeemGenPanel').style.display = 'none';
        document.getElementById('redeemPayloadTheme').value = '';
        document.getElementById('redeemPayloadBonus').value = 0;
        document.getElementById('redeemPayloadDailyBonus').value = 0;
        // 清空文案输入
        const labelFields = document.getElementById('rewardLabelFields');
        if (labelFields) labelFields.innerHTML = '';
        document.getElementById('redeemPayloadTag').value = '';
        document.getElementById('redeemGenCount').value = 1;
        document.getElementById('redeemGenMaxUses').value = 1;
        document.getElementById('redeemGenExpireIn').value = 0;
        document.getElementById('redeemGenNote').value = '';
        document.getElementById('redeemPopupTitle').value = '';
        document.getElementById('redeemPopupMessage').value = '';
        const btnEl = document.getElementById('redeemPopupButton');
        if (btnEl) btnEl.value = '';
        const subtitleEl = document.getElementById('redeemPopupSubtitle');
        if (subtitleEl) subtitleEl.value = '';
        const iconColorEl = document.getElementById('redeemPopupIconColor');
        if (iconColorEl) iconColorEl.value = '#64748b';
        const styleSelect = document.getElementById('redeemPopupStyleSelect');
        if (styleSelect) styleSelect.value = 'default';
        const logoSelect = document.getElementById('redeemPopupLogo');
        if (logoSelect) logoSelect.value = 'default';
        // 主播相关字段
        const noteTag = document.getElementById('redeemNoteTag');
        if (noteTag) noteTag.value = '';
        const streamerId = document.getElementById('redeemStreamerId');
        if (streamerId) streamerId.value = '';
        const noteRow = document.getElementById('redeemNoteTagRow');
        if (noteRow) noteRow.style.display = 'none';
        const streamerRow = document.getElementById('redeemStreamerIdRow');
        if (streamerRow) streamerRow.style.display = 'none';
        const resultDiv = document.getElementById('redeemGenResult');
        if (resultDiv) resultDiv.style.display = 'none';
        this.updatePreview();
    },

    /** 提交生成 */
    async submitGenerate() {
        if (this._selectedPreset === null) {
            app.showAlert('请先选择一个预设类型', 'warning');
            return;
        }

        const payload = this._buildPayload();
        const count = parseInt(document.getElementById('redeemGenCount')?.value) || 1;
        const maxUses = parseInt(document.getElementById('redeemGenMaxUses')?.value) || 1;
        const expireIn = parseInt(document.getElementById('redeemGenExpireIn')?.value) || 0;
        let note = document.getElementById('redeemGenNote')?.value?.trim() || '';
        const popupTitle = document.getElementById('redeemPopupTitle')?.value?.trim() || '';
        let popupMessage = document.getElementById('redeemPopupMessage')?.value?.trim() || '';

        // 将自定义奖励文案组装为 popup_message（仅在用户没有手动填写弹窗内容时）
        if (!popupMessage) {
            const customLabels = this._collectRewardLabels();
            if (customLabels) {
                popupMessage = this._buildPopupMessageFromLabels(customLabels);
            }
        }

        // 备注标签和主播ID拼接到备注中
        const noteTag = document.getElementById('redeemNoteTag')?.value?.trim() || '';
        const streamerId = document.getElementById('redeemStreamerId')?.value?.trim() || '';
        if (noteTag) note = note ? `${note} [主播: ${noteTag}]` : `[主播: ${noteTag}]`;
        if (streamerId) note = note ? `${note} [分享来源: ${streamerId}]` : `[分享来源: ${streamerId}]`;

        let type;
        // 自定义类别输入框优先
        const customTypeInput = document.getElementById('redeemCustomType')?.value?.trim() || '';
        if (customTypeInput) {
            type = customTypeInput;
            // 处理类别备注
            const categoryNote = document.getElementById('redeemCategoryNote')?.value?.trim() || '';
            if (categoryNote) {
                this._saveCategoryNote(type, categoryNote);
                note = note ? `${note} [类别备注: ${categoryNote}]` : `[类别备注: ${categoryNote}]`;
            }
        } else if (typeof this._selectedPreset === 'string' && this._selectedPreset.startsWith('cp_')) {
            const cpIdx = parseInt(this._selectedPreset.replace('cp_', ''));
            const cp = this._customPresets[cpIdx];
            type = cp ? cp.type : 'custom';
        } else if (this._selectedPreset === 'custom') {
            type = 'custom';
        } else {
            const preset = this._presets[this._selectedPreset];
            type = preset ? preset.type : 'custom';
        }

        // popup_style：优先使用自定义选择，否则跟随预设类型
        const styleSelectVal = document.getElementById('redeemPopupStyleSelect')?.value || 'default';
        const popupStyle = styleSelectVal !== 'default' ? styleSelectVal : (this._popupStyleMap[type] || 'style_sponsor_1');

        // 主播分享文案替换
        if (streamerId && (type === 'streamer_share')) {
            if (!popupMessage) popupMessage = '';
        }

        try {
            const res = await fetch(`${app.config.apiBase}/admin/redeem`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    type, payload, max_uses: maxUses, count,
                    expire_in: expireIn, note,
                    popup_title: popupTitle,
                    popup_message: popupMessage,
                    popup_style: popupStyle,
                    popup_subtitle: document.getElementById('redeemPopupSubtitle')?.value?.trim() || '',
                    popup_logo: document.getElementById('redeemPopupLogo')?.value || 'default',
                    popup_icon_color: document.getElementById('redeemPopupIconColor')?.value || ''
                })
            });

            if (res.ok) {
                const data = await res.json();
                const codes = data.codes || [];
                app.showAlert(`已生成 ${codes.length} 个兑换码`, 'success');
                this._showGeneratedCodes(codes);
            } else {
                throw new Error();
            }
        } catch { app.showAlert('生成失败', 'danger'); }
    },

    /** 展示已生成的兑换码列表 */
    _showGeneratedCodes(codes) {
        const div = document.getElementById('redeemGenResult');
        if (!div) return;

        const codeItems = codes.map(c =>
            `<div class="code-item">
                <span class="code-text">${c.code}</span>
                <button class="copy-btn" onclick="navigator.clipboard.writeText('${c.code}'); app.showAlert('已复制', 'success');">复制</button>
            </div>`
        ).join('');

        div.innerHTML = `
            <div style="margin-top: 24px; border-top: 1px solid var(--border); padding-top: 20px;">
                <div style="font-size: 14px; font-weight: 600; margin-bottom: 12px; display: flex; align-items: center; justify-content: space-between;">
                    <span>✅ 已生成 ${codes.length} 个兑换码</span>
                    <button class="btn" onclick="redeemModule._copyAllCodes()" style="font-size: 11px; padding: 4px 12px;">全部复制</button>
                </div>
                <div class="generated-codes-list">${codeItems}</div>
            </div>`;
        div.style.display = '';

        // 缓存用于全部复制
        this._lastGeneratedCodes = codes.map(c => c.code);
    },

    _copyAllCodes() {
        if (this._lastGeneratedCodes?.length) {
            navigator.clipboard.writeText(this._lastGeneratedCodes.join('\n'));
            app.showAlert('已复制全部兑换码', 'success');
        }
    },

    // ═══════════════════════════════════════════════════════
    // 兑换码统计视图
    // ═══════════════════════════════════════════════════════

    async initStats() {
        this._statsTab = 'codes';
        this._searchKeyword = '';
        this._selectedCodeIds.clear();
        await this._loadPresets();
        await this._loadAllCodes();
        this._loadCategoryNotes();
        this._renderStatsCards();
        this._renderCategoryTabs();
        this._renderFilteredCodes();
        this.switchStatsTab('codes');
    },

    /** 搜索输入回调 */
    onSearchInput() {
        this._searchKeyword = (document.getElementById('redeemSearchInput')?.value || '').trim().toLowerCase();
        this._renderFilteredCodes();
    },

    /** 刷新统计数据 */
    async refreshStats() {
        await this._loadAllCodes();
        this._renderStatsCards();
        this._renderCategoryTabs();
        this._renderFilteredCodes();
        app.showAlert('已刷新', 'success');
    },

    async _loadAllCodes() {
        try {
            const res = await fetch(`${app.config.apiBase}/admin/redeem`);
            if (res.ok) {
                const data = await res.json();
                this._allCodes = data.codes || [];
            }
        } catch {}
    },

    /** 渲染统计概览卡片 */
    _renderStatsCards() {
        const container = document.getElementById('redeemStatsCards');
        if (!container) return;

        const codes = this._allCodes;
        const total = codes.length;
        const active = codes.filter(c => c.status === 'active').length;
        const used = codes.filter(c => c.status === 'used').length;
        const expired = codes.filter(c => c.status === 'expired').length;
        const disabled = codes.filter(c => c.status === 'disabled').length;
        const totalUsed = codes.reduce((s, c) => s + (c.used_count || 0), 0);

        const stats = [
            { label: '总数', value: total, color: 'var(--primary)', icon: '📦', bg: 'rgba(59,130,246,0.08)' },
            { label: '可用', value: active, color: '#10b981', icon: '✅', bg: 'rgba(16,185,129,0.08)' },
            { label: '已用完', value: used, color: '#f59e0b', icon: '⚡', bg: 'rgba(245,158,11,0.08)' },
            { label: '已过期', value: expired, color: '#ef4444', icon: '⏰', bg: 'rgba(239,68,68,0.08)' },
            { label: '已停用', value: disabled, color: '#94a3b8', icon: '🚫', bg: 'rgba(148,163,184,0.08)' },
            { label: '总使用次数', value: totalUsed, color: '#8b5cf6', icon: '📊', bg: 'rgba(139,92,246,0.08)' },
        ];

        container.innerHTML = stats.map(s =>
            `<div class="rs-stat-card" style="--accent-color: ${s.color};">
                <div class="rs-stat-header">
                    <span class="rs-stat-label">${s.label}</span>
                    <span class="rs-stat-icon" style="--icon-bg: ${s.bg};">${s.icon}</span>
                </div>
                <div class="rs-stat-value">${s.value}</div>
            </div>`
        ).join('');
    },

    /** 渲染分类标签栏（含备注tooltip + 导出按钮） */
    _renderCategoryTabs() {
        const container = document.getElementById('redeemCategoryTabs');
        if (!container) return;

        const typeCounts = {};
        this._allCodes.forEach(c => {
            typeCounts[c.type] = (typeCounts[c.type] || 0) + 1;
        });

        const typeLabels = {};
        this._presets.forEach(p => { typeLabels[p.type] = p.label; });

        this._loadCategoryNotes();

        const allTab = `<div class="rs-cat-tab ${this._currentCategory === 'all' ? 'active' : ''}"
            onclick="redeemModule.filterByCategory('all')">
            全部 <span class="tab-count">${this._allCodes.length}</span>
        </div>`;

        const typeTabs = Object.keys(typeCounts).map(type => {
            const label = typeLabels[type] || type;
            const isActive = this._currentCategory === type;
            const noteText = this._categoryNotes[type] || '';
            const noteTooltip = noteText ? ` title="备注: ${this._escapeHtml(noteText)}"` : '';
            const noteIcon = noteText ? '<span class="rs-cat-note-dot"></span>' : '';
            return `<div class="rs-cat-tab ${isActive ? 'active' : ''}"
                onclick="redeemModule.filterByCategory('${type}')"${noteTooltip}>
                ${label} ${noteIcon} <span class="tab-count">${typeCounts[type]}</span>
                <button class="rs-cat-action-btn" onclick="event.stopPropagation(); redeemModule.editCategoryNote('${type}')" title="编辑备注">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                </button>
                <button class="rs-cat-action-btn" onclick="event.stopPropagation(); redeemModule.exportCodesForDistribution('${type}')" title="导出该类别">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                </button>
            </div>`;
        }).join('');

        container.innerHTML = allTab + typeTabs;
    },

    /** 按类型过滤 */
    filterByCategory(category) {
        this._currentCategory = category;
        this._renderCategoryTabs();
        this._renderFilteredCodes();
    },

    /** 渲染过滤后的兑换码列表（卡片式） */
    _renderFilteredCodes() {
        const container = document.getElementById('statsCodesBody');
        if (!container) return;

        let codes = this._currentCategory === 'all'
            ? this._allCodes
            : this._allCodes.filter(c => c.type === this._currentCategory);

        // 搜索过滤
        if (this._searchKeyword) {
            const kw = this._searchKeyword;
            codes = codes.filter(c =>
                (c.code || '').toLowerCase().includes(kw) ||
                (c.note || '').toLowerCase().includes(kw) ||
                (c.type || '').toLowerCase().includes(kw)
            );
        }

        if (codes.length === 0) {
            container.innerHTML = `<div class="rs-empty">
                <div class="rs-empty-icon">📭</div>
                <div class="rs-empty-text">${this._searchKeyword ? '未找到匹配的兑换码' : '该类型暂无兑换码'}</div>
            </div>`;
            return;
        }

        const typeLabels = {};
        this._presets.forEach(p => { typeLabels[p.type] = p.label; });

        const statusTextMap = {
            'active': '可用', 'used': '已用完', 'expired': '已过期', 'disabled': '已停用',
        };
        const statusClassMap = {
            'active': 's-active', 'used': 's-used', 'expired': 's-expired', 'disabled': 's-disabled',
        };

        container.innerHTML = codes.map((code, idx) => {
            const typeLabel = typeLabels[code.type] || code.type;
            const usageText = code.max_uses > 0 ? `${code.used_count}/${code.max_uses}` : `${code.used_count}/∞`;
            const usagePct = code.max_uses > 0 ? Math.min(100, (code.used_count / code.max_uses) * 100) : 0;
            const isFull = code.max_uses > 0 && code.used_count >= code.max_uses;

            const rewards = this.parsePayloadRewards(code.payload);
            const rewardSummary = rewards.map(r => r.icon + ' ' + r.text).join(' · ');
            const safeCreatedAt = (code.created_at || '').replace('T', ' ').substring(0, 16);

            const toggleSvg = code.is_active
                ? '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="4" y1="4" x2="20" y2="20"/></svg>'
                : '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>';

            return `<div class="rs-code-card status-${code.status}" onclick="redeemModule.showCodeDetailPage(${code.id})" style="animation-delay: ${idx * 0.03}s">
                <input type="checkbox" class="rs-code-checkbox" data-id="${code.id}" ${this._selectedCodeIds.has(code.id) ? 'checked' : ''} onclick="event.stopPropagation(); redeemModule.toggleSelectCode(${code.id}, event)">
                <div class="rs-code-main">
                    <span class="rs-code-text">${code.code}</span>
                    <div class="rs-code-meta">
                        <span class="rs-type-badge">${this._escapeHtml(typeLabel)}</span>
                        <span class="rs-reward-summary" title="${this._escapeHtml(rewardSummary)}">${this._escapeHtml(rewardSummary)}</span>
                    </div>
                    ${code.note ? `<div class="rs-code-note" title="${this._escapeHtml(code.note)}">📝 ${this._escapeHtml(code.note)}</div>` : ''}
                </div>
                <div class="rs-code-right">
                    <div class="rs-usage-pill">
                        <div class="rs-usage-bar"><div class="rs-usage-fill${isFull ? ' full' : ''}" style="width:${usagePct}%"></div></div>
                        <span>${usageText}</span>
                    </div>
                    <span class="rs-status-dot ${statusClassMap[code.status] || ''}">${statusTextMap[code.status] || code.status}</span>
                    <span class="rs-code-time">${safeCreatedAt}</span>
                    <div class="rs-code-actions" onclick="event.stopPropagation();">
                        <button class="rs-action-btn" onclick="redeemModule.toggleActive(${code.id}, ${!code.is_active})" title="${code.is_active ? '停用' : '启用'}">${toggleSvg}</button>
                        <button class="rs-action-btn danger" onclick="redeemModule.deleteCode(${code.id})" title="删除"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>
                    </div>
                </div>
            </div>`;
        }).join('');
    },

    /** 切换 codes / records 标签 */
    switchStatsTab(tab) {
        this._statsTab = tab;
        const codesPanel = document.getElementById('statsCodesPanel');
        const recordsPanel = document.getElementById('statsRecordsPanel');
        const codesBtn = document.getElementById('statsTabCodes');
        const recordsBtn = document.getElementById('statsTabRecords');

        if (tab === 'codes') {
            if (codesPanel) codesPanel.style.display = '';
            if (recordsPanel) recordsPanel.style.display = 'none';
            if (codesBtn) { codesBtn.classList.add('active'); }
            if (recordsBtn) { recordsBtn.classList.remove('active'); }
        } else {
            if (codesPanel) codesPanel.style.display = 'none';
            if (recordsPanel) recordsPanel.style.display = '';
            if (codesBtn) { codesBtn.classList.remove('active'); }
            if (recordsBtn) { recordsBtn.classList.add('active'); }
            this._loadRecords();
        }
    },

    /** 加载使用记录 */
    async _loadRecords() {
        const tbody = document.getElementById('statsRecordsBody');
        if (!tbody) return;
        try {
            const res = await fetch(`${app.config.apiBase}/admin/redeem/records`);
            if (!res.ok) return;
            const data = await res.json();
            const records = data.records || [];

            if (records.length === 0) {
                tbody.innerHTML = `<div class="rs-empty">
                    <div class="rs-empty-icon">📝</div>
                    <div class="rs-empty-text">暂无使用记录</div>
                </div>`;
                return;
            }

            tbody.innerHTML = records.map((r, idx) => {
                const hwid = r.machine_id || '-';
                const displayHwid = hwid.length > 12 ? hwid.substring(0, 6) + '...' + hwid.substring(hwid.length - 4) : hwid;
                const userDisplay = r.alias || displayHwid;
                const encodedMachineId = encodeURIComponent(hwid);
                return `<div class="rs-record-card" style="animation-delay: ${idx * 0.03}s;">
                    <div class="rs-record-code">${this._escapeHtml(r.code || '-')}</div>
                    <div class="rs-record-info">
                        <span class="rs-record-user rs-record-alias-link"
                              onclick="event.stopPropagation(); redeemModule.openRecordUser('${encodedMachineId}')"
                              title="查看用户详情">${this._escapeHtml(userDisplay)}</span>
                        <span class="rs-record-hwid" title="${this._escapeHtml(hwid)}">${this._escapeHtml(displayHwid)}</span>
                    </div>
                    <div class="rs-record-time">${this._escapeHtml(r.created_at || '-')}</div>
                </div>`;
            }).join('');
        } catch {
            tbody.innerHTML = '<div style="text-align: center; color: var(--danger); padding: 32px;">加载失败</div>';
        }
    },

    // ─────────── 码详情弹窗 ───────────

    /** 展示兑换码详情（侧面板） */
    showDetail(codeId) {
        this.showCodeDetailPage(codeId);
    },

    /** 加载指定兑换码的使用记录 */
    async _loadCodeRecords(codeStr) {
        const container = document.getElementById('detailRecordsList');
        if (!container) return;
        try {
            const res = await fetch(`${app.config.apiBase}/admin/redeem/records`);
            if (!res.ok) { container.innerHTML = '<div style="color:var(--text-muted); font-size:12px;">加载失败</div>'; return; }
            const data = await res.json();
            const records = (data.records || []).filter(r => r.code === codeStr);
            if (records.length === 0) {
                container.innerHTML = '<div style="color:var(--text-muted); font-size:12px;">暂无使用记录</div>';
                return;
            }
            container.innerHTML = records.map(r => {
                const userDisplay = r.alias || (r.machine_id ? r.machine_id.substring(0, 8) + '...' : '-');
                const machineId = encodeURIComponent(r.machine_id || '');
                const avatarText = this._escapeHtml((userDisplay || '?').substring(0, 1).toUpperCase());
                return `<div class="rs-detail-record-item" onclick="redeemModule.openRecordUser('${machineId}')">
                    <div class="rs-detail-record-left">
                        <div class="rs-detail-record-avatar">${avatarText}</div>
                        <div class="rs-detail-record-info">
                            <div class="rs-detail-record-user">${this._escapeHtml(userDisplay)}</div>
                            <div class="rs-detail-record-mid">${this._escapeHtml(r.machine_id || '-')}</div>
                        </div>
                    </div>
                    <span class="rs-detail-record-time">${this._escapeHtml(r.created_at || '-')}</span>
                </div>`;
            }).join('');
        } catch {
            container.innerHTML = '<div style="color:var(--text-muted); font-size:12px;">加载失败</div>';
        }
    },

    _parseField(payloadStr, field) {
        try { return JSON.parse(payloadStr)[field] || ''; } catch { return ''; }
    },

    /** 关闭详情侧面板 */
    closeDetail() {
        const overlay = document.getElementById('rsDetailOverlay');
        const panel = document.getElementById('rsDetailPanel');
        if (overlay) overlay.classList.remove('show');
        if (panel) panel.classList.remove('show');
        this._editingCodeId = null;
    },

    /** 保存详情修改 */
    async saveDetail() {
        if (!this._editingCodeId) return;

        const theme = document.getElementById('detailPayloadTheme')?.value?.trim() || '';
        const bonus = parseInt(document.getElementById('detailPayloadBonus')?.value) || 0;
        const daily_limit_bonus = parseInt(document.getElementById('detailPayloadDailyBonus')?.value) || 0;
        const tag = document.getElementById('detailPayloadTag')?.value?.trim() || '';
        const payload = JSON.stringify({ theme, bonus, daily_limit_bonus, tag });

        const popupTitle = document.getElementById('detailPopupTitle')?.value?.trim() || '';
        const popupMessage = document.getElementById('detailPopupMessage')?.value?.trim() || '';
        const popupStyle = document.getElementById('detailPopupStyle')?.value || 'default';

        try {
            const res = await fetch(`${app.config.apiBase}/admin/redeem/${this._editingCodeId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    payload, popup_title: popupTitle,
                    popup_message: popupMessage, popup_style: popupStyle
                })
            });
            if (res.ok) {
                app.showAlert('已保存', 'success');
                this.closeDetail();
                await this._loadAllCodes();
                this._renderStatsCards();
                this._renderCategoryTabs();
                this._renderFilteredCodes();
            } else throw new Error();
        } catch { app.showAlert('保存失败', 'danger'); }
    },

    // ═══════════════════════════════════════════════════
    // 独立详情页（redeem_detail.html）
    // ═══════════════════════════════════════════════════

    async initDetail() {
        const codeId = this._pendingDetailCodeId;
        if (!codeId) {
            document.getElementById('rdContent').innerHTML = '<div style="text-align:center;padding:80px;color:var(--text-muted);"><h3>未指定兑换码</h3><p>请从兑换码统计页面进入</p></div>';
            return;
        }
        this._editingCodeId = codeId;
        try {
            await this._loadPresets();
            await this._loadAllCodes();
            const code = this._allCodes.find(c => c.id === codeId);
            if (!code) {
                document.getElementById('rdContent').innerHTML = '<div style="text-align:center;padding:80px;color:var(--text-muted);"><h3>兑换码不存在</h3></div>';
                return;
            }
            this._renderFullDetailPage(code);
        } catch (e) {
            document.getElementById('rdContent').innerHTML = `<div style="text-align:center;padding:80px;color:var(--text-muted);"><h3>加载失败</h3><p>${e.message}</p></div>`;
        }
    },

    showCodeDetailPage(codeId) {
        this._pendingDetailCodeId = codeId;
        app.switchView('redeem_detail', document.querySelector('[data-view="redeem_detail"]'));
    },

    _renderFullDetailPage(code) {
        const typeLabels = {};
        this._presets.forEach(p => { typeLabels[p.type] = p.label; });
        const typeLabel = typeLabels[code.type] || code.type || '自定义';
        const statusMap = { active: '可用', disabled: '已停用', expired: '已过期', used: '已用完' };
        const statusLabel = statusMap[code.status] || code.status;
        const statusDotClass = { active: 'rd-dot-active', disabled: 'rd-dot-disabled', expired: 'rd-dot-expired', used: 'rd-dot-used' }[code.status] || '';

        const safeNote = this._escapeHtml(code.note || '');
        const safePopupTitle = this._escapeHtml(code.popup_title || '');
        const safePopupMessage = this._escapeHtml(code.popup_message || '');
        const safePopupSubtitle = this._escapeHtml(code.popup_subtitle || '');
        const safeTag = this._escapeHtml(this._parseField(code.payload, 'tag'));
        const safeTheme = this._escapeHtml(this._parseField(code.payload, 'theme'));

        const rewards = this.parsePayloadRewards(code.payload, false);
        const usedPercent = code.max_uses > 0 ? Math.min(100, Math.round((code.used_count / code.max_uses) * 100)) : 0;
        const isFull = code.max_uses > 0 && code.used_count >= code.max_uses;

        // 顶栏信息
        const codeDisplay = document.getElementById('rdCodeDisplay');
        const statusBadge = document.getElementById('rdStatusBadge');
        if (codeDisplay) codeDisplay.textContent = code.code;
        if (statusBadge) {
            statusBadge.className = `rd-title-status ${statusDotClass}`;
            statusBadge.textContent = statusLabel;
        }

        const toggleBtn = document.getElementById('rdToggleBtn');
        if (toggleBtn) {
            toggleBtn.innerHTML = code.is_active
                ? '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="4" y1="4" x2="20" y2="20"/></svg> 停用'
                : '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg> 启用';
        }

        // 奖励卡片
        const rewardsHtml = rewards.map(r => {
            const iconBg = { theme: 'rd-reward-theme', bonus: 'rd-reward-bonus', tag: 'rd-reward-tag' }[r.type] || 'rd-reward-bonus';
            return `<div class="rd-reward-chip">
                <span class="rd-reward-icon ${iconBg}">${r.icon}</span>
                <span class="rd-reward-text">${r.text}</span>
            </div>`;
        }).join('');

        // 信息行
        const safeCreatedAt = (code.created_at || '').replace('T', ' ').substring(0, 19);
        const safeExpiresAt = code.expires_at ? code.expires_at.replace('T', ' ').substring(0, 19) : '';

        document.getElementById('rdContent').innerHTML = `
            <div class="rd-grid">
                <!-- 左栏：信息展示 -->
                <div class="rd-col">
                    <div class="rd-card">
                        <div class="rd-card-title">
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                            基本信息
                        </div>
                        <div class="rd-info-grid">
                            <div class="rd-info-row">
                                <span class="rd-info-label">兑换码</span>
                                <span class="rd-info-value rd-mono">${code.code}</span>
                            </div>
                            <div class="rd-info-row">
                                <span class="rd-info-label">预设类型</span>
                                <span class="rd-info-value"><span class="rd-type-tag">${typeLabel}</span></span>
                            </div>
                            <div class="rd-info-row">
                                <span class="rd-info-label">当前状态</span>
                                <span class="rd-info-value"><span class="rd-status-pill ${statusDotClass}">${statusLabel}</span></span>
                            </div>
                            <div class="rd-info-row">
                                <span class="rd-info-label">创建时间</span>
                                <span class="rd-info-value">${safeCreatedAt}</span>
                            </div>
                            <div class="rd-info-row">
                                <span class="rd-info-label">过期时间</span>
                                <span class="rd-info-value">${safeExpiresAt || '<span class="rd-tag-forever">永不过期</span>'}</span>
                            </div>
                            ${safeNote ? `<div class="rd-info-row">
                                <span class="rd-info-label">备注</span>
                                <span class="rd-info-value">${safeNote}</span>
                            </div>` : ''}
                        </div>
                    </div>

                    <div class="rd-card">
                        <div class="rd-card-title">
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 12V8H6a2 2 0 0 1-2-2c0-1.1.9-2 2-2h12v4"/><path d="M4 6v12c0 1.1.9 2 2 2h14v-4"/><path d="M18 12a2 2 0 0 0-2 2c0 1.1.9 2 2 2h4v-4h-4z"/></svg>
                            奖励内容
                        </div>
                        <div class="rd-reward-list">
                            ${rewardsHtml || '<div style="color:var(--text-muted); font-size:13px;">无奖励内容</div>'}
                        </div>
                    </div>

                    <div class="rd-card">
                        <div class="rd-card-title">
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>
                            使用情况
                        </div>
                        <div class="rd-usage-section">
                            <div class="rd-usage-header">
                                <span class="rd-usage-text">已使用 <strong>${code.used_count}</strong> / ${code.max_uses || '∞'}</span>
                                <span class="rd-usage-pct">${usedPercent}%</span>
                            </div>
                            <div class="rd-progress-track">
                                <div class="rd-progress-fill ${isFull ? 'full' : ''}" style="width:${usedPercent}%"></div>
                            </div>
                        </div>
                    </div>

                    <div class="rd-card">
                        <div class="rd-card-title">
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
                            使用记录
                        </div>
                        <div class="rs-detail-records" id="detailRecordsList">
                            <div style="text-align:center; padding:20px; color:var(--text-muted); font-size:13px;">加载中...</div>
                        </div>
                    </div>
                </div>

                <!-- 右栏：编辑表单 -->
                <div class="rd-col">
                    <div class="rd-card">
                        <div class="rd-card-title">
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                            编辑基本信息
                        </div>
                        <div class="rd-form-group">
                            <div class="rd-form-row">
                                <label class="rd-form-label">备注</label>
                                <input type="text" class="input rd-input" id="detailNote" value="${safeNote}" placeholder="备注说明">
                            </div>
                            <div class="rd-form-row">
                                <label class="rd-form-label">最大使用次数</label>
                                <input type="number" class="input rd-input rd-input-short" id="detailMaxUses" value="${code.max_uses || 0}" min="0">
                            </div>
                        </div>
                    </div>

                    <div class="rd-card">
                        <div class="rd-card-title">
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 12 20 22 4 22 4 12"/><rect x="2" y="7" width="20" height="5"/><line x1="12" y1="22" x2="12" y2="7"/><path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z"/><path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z"/></svg>
                            编辑奖励参数
                        </div>
                        <div class="rd-form-group">
                            <div class="rd-form-row">
                                <label class="rd-form-label">主题</label>
                                <input type="text" class="input rd-input" id="detailPayloadTheme" value="${safeTheme}" placeholder="如 supporter.json">
                            </div>
                            <div class="rd-form-row-inline">
                                <div class="rd-form-row" style="flex:1;">
                                    <label class="rd-form-label">AI永久额度</label>
                                    <input type="number" class="input rd-input" id="detailPayloadBonus" value="${this._parseField(code.payload, 'bonus') || 0}" min="0">
                                </div>
                                <div class="rd-form-row" style="flex:1;">
                                    <label class="rd-form-label">每日额度加成</label>
                                    <input type="number" class="input rd-input" id="detailPayloadDailyBonus" value="${this._parseField(code.payload, 'daily_limit_bonus') || 0}" min="0">
                                </div>
                            </div>
                            <div class="rd-form-row">
                                <label class="rd-form-label">用户标签</label>
                                <input type="text" class="input rd-input" id="detailPayloadTag" value="${safeTag}" placeholder="如 sponsor_1">
                            </div>
                        </div>
                    </div>

                    <div class="rd-card">
                        <div class="rd-card-title">
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg>
                            自定义兑换弹窗
                        </div>
                        <div class="rd-form-group">
                            <div class="rd-form-row-inline">
                                <div class="rd-form-row" style="flex:1;">
                                    <label class="rd-form-label">弹窗标题</label>
                                    <input type="text" class="input rd-input" id="detailPopupTitle" value="${safePopupTitle}" placeholder="留空则用默认">
                                </div>
                                <div class="rd-form-row" style="flex:1;">
                                    <label class="rd-form-label">弹窗副标题</label>
                                    <input type="text" class="input rd-input" id="detailPopupSubtitle" value="${safePopupSubtitle}" placeholder="留空则用默认">
                                </div>
                            </div>
                            <div class="rd-form-row-inline">
                                <div class="rd-form-row" style="flex:1;">
                                    <label class="rd-form-label">弹窗样式</label>
                                    <select class="select rd-input" id="detailPopupStyle">
                                        ${this._getPopupStyleOptions(code.popup_style || 'default')}
                                    </select>
                                </div>
                                <div class="rd-form-row" style="flex:0 0 auto;">
                                    <label class="rd-form-label">图标颜色</label>
                                    <div class="color-picker-group">
                                        <input type="color" class="color-input" id="detailPopupIconColor" value="${code.popup_icon_color || this._defaultIconColorMap[code.type] || '#64748b'}" oninput="this.nextElementSibling.textContent=this.value">
                                        <span class="color-hex-label">${code.popup_icon_color || this._defaultIconColorMap[code.type] || '#64748b'}</span>
                                    </div>
                                </div>
                            </div>
                            <div class="rd-form-row">
                                <label class="rd-form-label">弹窗内容</label>
                                <textarea class="input rd-input rd-textarea" id="detailPopupMessage" placeholder="留空则自动生成奖励描述">${safePopupMessage}</textarea>
                            </div>
                        </div>
                        <div class="rd-save-row">
                            <button class="btn" onclick="redeemModule.backToStats()">取消</button>
                            <button class="btn primary" onclick="redeemModule.saveDetailPage()">
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
                                保存修改
                            </button>
                        </div>
                    </div>
                </div>
            </div>`;

        this._loadCodeRecords(code.code);
    },

    async openRecordUser(encodedMachineId) {
        const machineId = decodeURIComponent(encodedMachineId || '').trim();
        if (!machineId) {
            app.showAlert('缺少用户标识', 'warning');
            return;
        }
        await app.openUserDetailByMachineId(machineId);
    },

    backToStats() {
        this._pendingDetailCodeId = null;
        this._editingCodeId = null;
        app.switchView('redeem_stats', document.querySelector('[data-view="redeem_stats"]'));
    },

    copyDetailCode() {
        const code = this._allCodes.find(c => c.id === this._editingCodeId);
        if (!code) return;
        navigator.clipboard.writeText(code.code).then(() => {
            app.showAlert('已复制兑换码', 'success');
        }).catch(() => {
            app.showAlert('复制失败', 'danger');
        });
    },

    async toggleDetailActive() {
        const code = this._allCodes.find(c => c.id === this._editingCodeId);
        if (!code) return;
        const newActive = !code.is_active;
        try {
            const res = await fetch(`${app.config.apiBase}/admin/redeem/${this._editingCodeId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ is_active: newActive })
            });
            if (res.ok) {
                app.showAlert(newActive ? '已启用' : '已停用', 'success');
                await this._loadAllCodes();
                const updated = this._allCodes.find(c => c.id === this._editingCodeId);
                if (updated) this._renderFullDetailPage(updated);
            }
        } catch { app.showAlert('操作失败', 'danger'); }
    },

    async deleteDetailCode() {
        if (!confirm('确定要删除此兑换码？')) return;
        try {
            const res = await fetch(`${app.config.apiBase}/admin/redeem/${this._editingCodeId}`, { method: 'DELETE' });
            if (res.ok) {
                app.showAlert('已删除', 'success');
                this.backToStats();
            }
        } catch { app.showAlert('删除失败', 'danger'); }
    },

    async saveDetailPage() {
        if (!this._editingCodeId) return;
        const theme = document.getElementById('detailPayloadTheme')?.value?.trim() || '';
        const bonus = parseInt(document.getElementById('detailPayloadBonus')?.value) || 0;
        const daily_limit_bonus = parseInt(document.getElementById('detailPayloadDailyBonus')?.value) || 0;
        const tag = document.getElementById('detailPayloadTag')?.value?.trim() || '';
        const payload = JSON.stringify({ theme, bonus, daily_limit_bonus, tag });
        const note = document.getElementById('detailNote')?.value?.trim() || '';
        const maxUses = parseInt(document.getElementById('detailMaxUses')?.value) || 0;
        const popupTitle = document.getElementById('detailPopupTitle')?.value?.trim() || '';
        const popupMessage = document.getElementById('detailPopupMessage')?.value?.trim() || '';
        const popupStyle = document.getElementById('detailPopupStyle')?.value || 'default';
        try {
            const res = await fetch(`${app.config.apiBase}/admin/redeem/${this._editingCodeId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    payload, note, max_uses: maxUses,
                    popup_title: popupTitle,
                    popup_message: popupMessage,
                    popup_style: popupStyle,
                    popup_subtitle: document.getElementById('detailPopupSubtitle')?.value?.trim() || '',
                    popup_icon_color: document.getElementById('detailPopupIconColor')?.value || ''
                })
            });
            if (res.ok) {
                app.showAlert('已保存', 'success');
                await this._loadAllCodes();
                const updated = this._allCodes.find(c => c.id === this._editingCodeId);
                if (updated) this._renderFullDetailPage(updated);
            } else throw new Error();
        } catch { app.showAlert('保存失败', 'danger'); }
    },


    // ─────────── 通用操作 ───────────

    async toggleActive(id, active) {
        try {
            const res = await fetch(`${app.config.apiBase}/admin/redeem/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ is_active: active })
            });
            if (res.ok) {
                app.showAlert(active ? '已启用' : '已停用', 'success');
                await this._loadAllCodes();
                this._renderStatsCards();
                this._renderCategoryTabs();
                this._renderFilteredCodes();
            }
        } catch { app.showAlert('操作失败', 'danger'); }
    },

    async deleteCode(id) {
        if (!confirm('确定要删除此兑换码？相关使用记录不会被删除。')) return;
        try {
            const res = await fetch(`${app.config.apiBase}/admin/redeem/${id}`, { method: 'DELETE' });
            if (res.ok) {
                app.showAlert('已删除', 'success');
                await this._loadAllCodes();
                this._renderStatsCards();
                this._renderCategoryTabs();
                this._renderFilteredCodes();
            }
        } catch { app.showAlert('删除失败', 'danger'); }
    },

    /** 导出兑换码为 CSV */
    exportCodes() {
        this._exportCodesAs('csv');
    },

    /** 导出当前分类的兑换码为适合分发的文本格式 */
    exportCodesForDistribution(category) {
        const targetCategory = category || this._currentCategory;
        const codes = targetCategory === 'all'
            ? this._allCodes
            : this._allCodes.filter(c => c.type === targetCategory);

        if (codes.length === 0) { app.showAlert('没有可导出的数据', 'warning'); return; }

        const typeLabels = {};
        this._presets.forEach(p => { typeLabels[p.type] = p.label; });
        const categoryLabel = typeLabels[targetCategory] || targetCategory || '全部';

        // 获取该类别的备注
        this._loadCategoryNotes();
        const categoryNote = this._categoryNotes[targetCategory] || '';

        // 获取奖励内容描述（取第一个码的 payload）
        const sampleCode = codes[0];
        const rewards = this.parsePayloadRewards(sampleCode.payload);
        const rewardText = rewards.map(r => r.icon + ' ' + r.text).join(' · ');

        // 构建分发格式
        const activeCodes = codes.filter(c => c.status === 'active');
        let content = `【类别名称】${categoryLabel}\n`;
        if (categoryNote) content += `【备注】${categoryNote}\n`;
        content += `【奖励内容】${rewardText}\n`;
        content += `【总数/可用】${codes.length} 个 / ${activeCodes.length} 个可用\n`;
        content += `──────────────────\n`;
        content += activeCodes.map(c => c.code).join('\n');
        content += '\n';

        const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `兑换码_${categoryLabel}_${new Date().toISOString().slice(0, 10)}.txt`;
        link.click();
        URL.revokeObjectURL(link.href);
        app.showAlert(`已导出 ${activeCodes.length} 个可用码`, 'success');
    },

    /** 导出指定格式 */
    _exportCodesAs(format) {
        const codes = this._currentCategory === 'all'
            ? this._allCodes
            : this._allCodes.filter(c => c.type === this._currentCategory);

        if (codes.length === 0) { app.showAlert('没有可导出的数据', 'warning'); return; }

        const typeLabels = {};
        this._presets.forEach(p => { typeLabels[p.type] = p.label; });

        const header = '兑换码,类型,状态,使用次数,最大次数,备注,创建时间\n';
        const rows = codes.map(c =>
            `${c.code},${typeLabels[c.type] || c.type},${c.status},${c.used_count},${c.max_uses},${(c.note || '').replace(/,/g, '，')},${(c.created_at || '').substring(0, 19)}`
        ).join('\n');

        const blob = new Blob(['\ufeff' + header + rows], { type: 'text/csv;charset=utf-8' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `redeem_codes_${new Date().toISOString().slice(0, 10)}.csv`;
        link.click();
        URL.revokeObjectURL(link.href);
        app.showAlert('CSV 导出成功', 'success');
    },

    // ═══════════════════════════════════════════════════
    // 批量操作
    // ═══════════════════════════════════════════════════

    /** 切换单个兑换码的选中状态 */
    toggleSelectCode(id, event) {
        if (event) event.stopPropagation();
        if (this._selectedCodeIds.has(id)) {
            this._selectedCodeIds.delete(id);
        } else {
            this._selectedCodeIds.add(id);
        }
        this._updateBatchUI();
    },

    /** 全选/取消全选当前显示的兑换码 */
    toggleSelectAll() {
        let codes = this._currentCategory === 'all'
            ? this._allCodes
            : this._allCodes.filter(c => c.type === this._currentCategory);
        if (this._searchKeyword) {
            const kw = this._searchKeyword;
            codes = codes.filter(c =>
                (c.code || '').toLowerCase().includes(kw) ||
                (c.note || '').toLowerCase().includes(kw) ||
                (c.type || '').toLowerCase().includes(kw)
            );
        }
        const allIds = codes.map(c => c.id);
        const allSelected = allIds.every(id => this._selectedCodeIds.has(id));
        if (allSelected) {
            allIds.forEach(id => this._selectedCodeIds.delete(id));
        } else {
            allIds.forEach(id => this._selectedCodeIds.add(id));
        }
        this._updateBatchUI();
    },

    /** 清空选择 */
    clearSelection() {
        this._selectedCodeIds.clear();
        this._updateBatchUI();
    },

    /** 更新批量操作 UI 状态（checkbox + 顶部工具栏） */
    _updateBatchUI() {
        // 更新所有 checkbox
        document.querySelectorAll('.rs-code-checkbox').forEach(cb => {
            const id = parseInt(cb.dataset.id);
            cb.checked = this._selectedCodeIds.has(id);
        });
        // 更新批量操作栏
        const batchBar = document.getElementById('rsBatchBar');
        if (batchBar) {
            const count = this._selectedCodeIds.size;
            batchBar.style.display = count > 0 ? '' : 'none';
            const countEl = document.getElementById('rsBatchCount');
            if (countEl) countEl.textContent = count;
        }
        // 更新全选 checkbox
        const selectAllCb = document.getElementById('rsSelectAll');
        if (selectAllCb) {
            let codes = this._currentCategory === 'all'
                ? this._allCodes
                : this._allCodes.filter(c => c.type === this._currentCategory);
            const allIds = codes.map(c => c.id);
            selectAllCb.checked = allIds.length > 0 && allIds.every(id => this._selectedCodeIds.has(id));
        }
    },

    /** 批量删除 */
    async batchDelete() {
        const ids = [...this._selectedCodeIds];
        if (ids.length === 0) return;
        if (!confirm(`确定要删除选中的 ${ids.length} 个兑换码？`)) return;
        try {
            const res = await fetch(`${app.config.apiBase}/admin/redeem/batch/delete`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ids })
            });
            if (res.ok) {
                const data = await res.json();
                app.showAlert(`已删除 ${data.deleted || ids.length} 个兑换码`, 'success');
                this._selectedCodeIds.clear();
                await this._loadAllCodes();
                this._renderStatsCards();
                this._renderCategoryTabs();
                this._renderFilteredCodes();
            } else throw new Error();
        } catch { app.showAlert('批量删除失败', 'danger'); }
    },

    /** 批量启用/停用 */
    async batchToggleActive(active) {
        const ids = [...this._selectedCodeIds];
        if (ids.length === 0) return;
        const action = active ? '启用' : '停用';
        if (!confirm(`确定要${action}选中的 ${ids.length} 个兑换码？`)) return;
        try {
            const res = await fetch(`${app.config.apiBase}/admin/redeem/batch`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ids, is_active: active })
            });
            if (res.ok) {
                const data = await res.json();
                app.showAlert(`已${action} ${data.updated || ids.length} 个兑换码`, 'success');
                this._selectedCodeIds.clear();
                await this._loadAllCodes();
                this._renderStatsCards();
                this._renderCategoryTabs();
                this._renderFilteredCodes();
            } else throw new Error();
        } catch { app.showAlert(`批量${action}失败`, 'danger'); }
    },

    // ═══════════════════════════════════════════════════
    // 预设默认值保存/恢复（localStorage）
    // ═══════════════════════════════════════════════════

    /** 获取当前选中的预设类型名 */
    _getCurrentPresetType() {
        if (this._selectedPreset === null) return null;
        if (typeof this._selectedPreset === 'string' && this._selectedPreset.startsWith('cp_')) {
            const cpIdx = parseInt(this._selectedPreset.replace('cp_', ''));
            const cp = this._customPresets[cpIdx];
            return cp ? cp.type : null;
        }
        if (this._selectedPreset === 'custom') return 'custom';
        const preset = this._presets[this._selectedPreset];
        return preset ? preset.type : null;
    },

    /** 收集当前表单全部配置 */
    _collectFormData() {
        return {
            theme: document.getElementById('redeemPayloadTheme')?.value || '',
            bonus: parseInt(document.getElementById('redeemPayloadBonus')?.value) || 0,
            daily_limit_bonus: parseInt(document.getElementById('redeemPayloadDailyBonus')?.value) || 0,
            tag: document.getElementById('redeemPayloadTag')?.value || '',
            max_uses: parseInt(document.getElementById('redeemGenMaxUses')?.value) || 1,
            popup_title: document.getElementById('redeemPopupTitle')?.value?.trim() || '',
            popup_button: document.getElementById('redeemPopupButton')?.value?.trim() || '',
            popup_message: document.getElementById('redeemPopupMessage')?.value?.trim() || '',
            popup_style_select: document.getElementById('redeemPopupStyleSelect')?.value || 'default',
            popup_logo: document.getElementById('redeemPopupLogo')?.value || 'default',
            popup_subtitle: document.getElementById('redeemPopupSubtitle')?.value?.trim() || '',
            popup_icon_color: document.getElementById('redeemPopupIconColor')?.value || '',
            note_tag: document.getElementById('redeemNoteTag')?.value?.trim() || '',
            streamer_id: document.getElementById('redeemStreamerId')?.value?.trim() || '',
            reward_labels: this._collectRewardLabels() || {},
        };
    },

    resetIconColor() {
        const presetType = this._getCurrentPresetType() || 'custom';
        const defaultColor = this._defaultIconColorMap[presetType] || '#64748b';
        const el = document.getElementById('redeemPopupIconColor');
        if (el) el.value = defaultColor;
        this.updatePreview();
    },

    savePresetDefaults() {
        const presetType = this._getCurrentPresetType();
        if (!presetType) {
            app.showAlert('请先选择一个预设类型', 'warning');
            return;
        }
        const data = this._collectFormData();
        const key = `redeem_preset_${presetType}`;
        localStorage.setItem(key, JSON.stringify(data));
        // 刷新预设卡片以实时反映保存的配置
        this._renderPresetGrid();
        // 重新高亮当前选中的卡片
        const card = document.querySelector(`.redeem-preset-card[data-idx="${this._selectedPreset}"]`);
        if (card) card.classList.add('selected');
        app.showAlert(`已保存「${presetType}」的默认预设`, 'success');
    },

    /** 恢复该预设类型的出厂默认配置（删除 localStorage 中保存的默认值） */
    restorePresetDefaults() {
        const presetType = this._getCurrentPresetType();
        if (!presetType) {
            app.showAlert('请先选择一个预设类型', 'warning');
            return;
        }
        const key = `redeem_preset_${presetType}`;
        localStorage.removeItem(key);
        // 刷新卡片
        this._renderPresetGrid();
        // 重新选中该预设以加载服务器默认值
        this.selectPreset(this._selectedPreset);
        app.showAlert(`已恢复「${presetType}」的默认配置`, 'success');
    },

    /** 从 localStorage 加载保存的默认值 */
    _loadSavedDefaults(presetType) {
        const key = `redeem_preset_${presetType}`;
        try {
            const saved = localStorage.getItem(key);
            return saved ? JSON.parse(saved) : null;
        } catch { return null; }
    },

    // ═══════════════════════════════════════════════════
    // 自定义预设管理（localStorage 持久化）
    // ═══════════════════════════════════════════════════

    /** 从 localStorage 加载自定义预设列表 */
    _loadCustomPresets() {
        try {
            const saved = localStorage.getItem('redeem_custom_presets');
            this._customPresets = saved ? JSON.parse(saved) : [];
        } catch { this._customPresets = []; }
    },

    /** 保存自定义预设列表到 localStorage */
    _saveCustomPresets() {
        localStorage.setItem('redeem_custom_presets', JSON.stringify(this._customPresets));
    },

    /** 另存为新预设 */
    saveAsNewPreset() {
        const name = prompt('请输入新预设的名称:');
        if (!name || !name.trim()) return;
        const formData = this._collectFormData();
        const typeName = prompt('请输入类型标识（英文，用于分类）:', 'custom_' + Date.now().toString(36));
        if (!typeName || !typeName.trim()) return;

        this._loadCustomPresets();
        this._customPresets.push({
            name: name.trim(),
            type: typeName.trim(),
            payload: {
                theme: formData.theme,
                bonus: formData.bonus,
                daily_limit_bonus: formData.daily_limit_bonus,
                tag: formData.tag
            },
            max_uses: formData.max_uses,
            formData: formData
        });
        this._saveCustomPresets();
        // 同时保存为该类型的默认预设
        const key = `redeem_preset_${typeName.trim()}`;
        localStorage.setItem(key, JSON.stringify(formData));
        this._renderPresetGrid();
        app.showAlert(`已创建新预设「${name.trim()}」`, 'success');
    },

    /** 删除自定义预设 */
    deleteCustomPreset(idx) {
        if (!confirm('确定要删除此自定义预设？')) return;
        this._loadCustomPresets();
        const cp = this._customPresets[idx];
        if (cp) {
            localStorage.removeItem(`redeem_preset_${cp.type}`);
        }
        this._customPresets.splice(idx, 1);
        this._saveCustomPresets();
        this._renderPresetGrid();
        app.showAlert('已删除自定义预设', 'success');
    },

    // ═══════════════════════════════════════════════════
    // 分类备注管理（localStorage 持久化）
    // ═══════════════════════════════════════════════════

    /** 从 localStorage 加载分类备注 */
    _loadCategoryNotes() {
        try {
            const saved = localStorage.getItem('redeem_category_notes');
            this._categoryNotes = saved ? JSON.parse(saved) : {};
        } catch { this._categoryNotes = {}; }
    },

    /** 保存单个分类的备注 */
    _saveCategoryNote(type, note) {
        this._loadCategoryNotes();
        if (note) {
            this._categoryNotes[type] = note;
        } else {
            delete this._categoryNotes[type];
        }
        localStorage.setItem('redeem_category_notes', JSON.stringify(this._categoryNotes));
    },

    /** 编辑分类备注 */
    editCategoryNote(type) {
        this._loadCategoryNotes();
        const current = this._categoryNotes[type] || '';
        const note = prompt(`编辑「${type}」类别的备注:`, current);
        if (note === null) return;
        this._saveCategoryNote(type, note.trim());
        this._renderCategoryTabs();
        app.showAlert(note.trim() ? '备注已保存' : '备注已清除', 'success');
    },

    // ═══════════════════════════════════════════════════
    // 预设分组管理（localStorage 持久化）
    // ═══════════════════════════════════════════════════

    /** 从 localStorage 加载分组配置，首次使用默认分组 */
    _loadPresetGroups() {
        try {
            const saved = localStorage.getItem('redeem_preset_groups');
            if (saved) {
                this._presetGroups = JSON.parse(saved);
            } else {
                this._presetGroups = JSON.parse(JSON.stringify(this._defaultPresetGroups));
            }
        } catch {
            this._presetGroups = JSON.parse(JSON.stringify(this._defaultPresetGroups));
        }
        // 折叠状态
        try {
            const saved = localStorage.getItem('redeem_preset_group_collapsed');
            this._presetGroupCollapsed = saved ? JSON.parse(saved) : {};
        } catch { this._presetGroupCollapsed = {}; }
    },

    /** 保存分组配置到 localStorage */
    _savePresetGroups() {
        localStorage.setItem('redeem_preset_groups', JSON.stringify(this._presetGroups));
    },

    /** 保存折叠状态 */
    _saveGroupCollapsed() {
        localStorage.setItem('redeem_preset_group_collapsed', JSON.stringify(this._presetGroupCollapsed));
    },

    /** 折叠/展开分组 */
    togglePresetGroup(groupId) {
        this._presetGroupCollapsed[groupId] = !this._presetGroupCollapsed[groupId];
        this._saveGroupCollapsed();
        this._renderPresetGrid();
    },

    /** 编辑分组（弹窗操作菜单） */
    editPresetGroup(groupId) {
        this._loadPresetGroups();
        const group = this._presetGroups.find(g => g.id === groupId);
        if (!group) return;

        const action = prompt(
            `分组「${group.name}」操作：\n1. 重命名\n2. 删除分组\n3. 取消\n\n请输入数字:`,
            '1'
        );
        if (!action) return;

        switch (action.trim()) {
            case '1':
                this.renamePresetGroup(groupId);
                break;
            case '2':
                this.deletePresetGroup(groupId);
                break;
        }
    },

    /** 在分组标题旁 inline 重命名（双击或按钮触发） */
    startRenameGroup(groupId) {
        this._loadPresetGroups();
        const group = this._presetGroups.find(g => g.id === groupId);
        if (!group) return;

        const nameEl = document.getElementById(`pgName_${groupId}`);
        if (!nameEl) return;

        const oldName = group.name;
        nameEl.innerHTML = `<input type="text" class="preset-group-rename-input" value="${this._escapeHtml(oldName)}" 
            onclick="event.stopPropagation()" 
            onkeydown="if(event.key==='Enter'){redeemModule.confirmRenameGroup('${groupId}',this.value);} if(event.key==='Escape'){redeemModule._renderPresetGrid();}"
            onblur="redeemModule.confirmRenameGroup('${groupId}',this.value)">`;
        const input = nameEl.querySelector('input');
        if (input) { input.focus(); input.select(); }
    },

    /** 确认 inline 重命名 */
    confirmRenameGroup(groupId, newName) {
        if (!newName || !newName.trim()) {
            this._renderPresetGrid();
            return;
        }
        this._loadPresetGroups();
        const group = this._presetGroups.find(g => g.id === groupId);
        if (!group) return;
        group.name = newName.trim();
        this._savePresetGroups();
        this._renderPresetGrid();
        app.showAlert(`分组已重命名为「${newName.trim()}」`, 'success');
    },

    /** 创建新分组 */
    createPresetGroup() {
        const name = prompt('请输入新分组的名称:');
        if (!name || !name.trim()) return;
        const id = 'group_' + Date.now().toString(36);
        this._loadPresetGroups();
        this._presetGroups.push({ id, name: name.trim(), types: [], color: '#' + Math.floor(Math.random() * 0xFFFFFF).toString(16).padStart(6, '0') });
        this._savePresetGroups();
        this._renderPresetGrid();
        app.showAlert(`已创建分组「${name.trim()}」`, 'success');
    },

    /** 重命名分组（prompt 方式，作为后备） */
    renamePresetGroup(groupId) {
        this._loadPresetGroups();
        const group = this._presetGroups.find(g => g.id === groupId);
        if (!group) return;
        const newName = prompt(`重命名分组「${group.name}」:`, group.name);
        if (!newName || !newName.trim()) return;
        group.name = newName.trim();
        this._savePresetGroups();
        this._renderPresetGrid();
        app.showAlert(`分组已重命名为「${newName.trim()}」`, 'success');
    },

    /** 删除分组（预设卡片回到未分组） */
    deletePresetGroup(groupId) {
        this._loadPresetGroups();
        if (!confirm('确定要删除此分组？分组内的预设将移至「其他」。')) return;
        this._presetGroups = this._presetGroups.filter(g => g.id !== groupId);
        this._savePresetGroups();
        this._renderPresetGrid();
        app.showAlert('分组已删除', 'success');
    },

    /** 显示分组管理面板（弹窗） */
    showGroupManager() {
        this._loadPresetGroups();
        const allTypes = this._presets.map(p => ({ type: p.type, label: p.label }));
        this._customPresets.forEach(cp => {
            if (!allTypes.find(t => t.type === cp.type)) {
                allTypes.push({ type: cp.type, label: cp.name });
            }
        });

        // 构建 type → 当前所属 group 映射
        const typeToGroup = {};
        this._presetGroups.forEach(g => {
            (g.types || []).forEach(t => { typeToGroup[t] = g.id; });
        });

        let groupListHtml = this._presetGroups.map(g => {
            const memberHtml = (g.types || []).map(t => {
                const label = allTypes.find(at => at.type === t)?.label || t;
                return `<span class="pgm-member">${this._escapeHtml(label)} <span class="pgm-member-remove" onclick="redeemModule._pgmRemoveType('${g.id}','${t}')">×</span></span>`;
            }).join('');
            return `<div class="pgm-group">
                <div class="pgm-group-header">
                    <span class="preset-group-dot" style="background:${g.color || '#94a3b8'}"></span>
                    <span class="pgm-group-name">${this._escapeHtml(g.name)}</span>
                    <button class="pgm-btn" onclick="redeemModule.renamePresetGroup('${g.id}'); redeemModule.showGroupManager();">重命名</button>
                    <button class="pgm-btn danger" onclick="redeemModule.deletePresetGroup('${g.id}'); redeemModule._pgmClose();">删除</button>
                </div>
                <div class="pgm-members">${memberHtml || '<span style="color:var(--text-muted);font-size:11px;">空分组</span>'}</div>
                <div class="pgm-add-row">
                    <select class="input pgm-add-select" id="pgmAddSelect_${g.id}" style="font-size:11px;padding:3px 6px;">
                        <option value="">添加预设到此组...</option>
                        ${allTypes.filter(t => !typeToGroup[t.type] || typeToGroup[t.type] !== g.id).map(t =>
                            `<option value="${t.type}">${this._escapeHtml(t.label)} (${t.type})</option>`
                        ).join('')}
                    </select>
                    <button class="pgm-btn primary" onclick="redeemModule._pgmAddType('${g.id}')">添加</button>
                </div>
            </div>`;
        }).join('');

        const modalHtml = `
            <div class="modal-mask show" id="pgmMask" onclick="redeemModule._pgmClose()"></div>
            <div class="modal show" id="pgmModal" style="width:520px;">
                <div class="modal-header">
                    <h3>管理预设分组</h3>
                    <button class="btn" onclick="redeemModule._pgmClose()" style="padding:4px 8px;">✕</button>
                </div>
                <div class="modal-body" style="max-height:60vh;overflow-y:auto;">
                    ${groupListHtml}
                    <button class="btn primary" onclick="redeemModule.createPresetGroup(); redeemModule.showGroupManager();" style="margin-top:12px;width:100%;">
                        + 新建分组
                    </button>
                </div>
            </div>`;

        // 移除旧弹窗
        this._pgmClose();
        document.body.insertAdjacentHTML('beforeend', modalHtml);
    },

    /** 分组管理弹窗：关闭 */
    _pgmClose() {
        document.getElementById('pgmMask')?.remove();
        document.getElementById('pgmModal')?.remove();
        this._renderPresetGrid();
    },

    /** 分组管理弹窗：添加 type 到组 */
    _pgmAddType(groupId) {
        const select = document.getElementById(`pgmAddSelect_${groupId}`);
        const type = select?.value;
        if (!type) return;
        // 从其他组移除
        this._presetGroups.forEach(g => {
            g.types = (g.types || []).filter(t => t !== type);
        });
        const group = this._presetGroups.find(g => g.id === groupId);
        if (group) {
            group.types.push(type);
        }
        this._savePresetGroups();
        this.showGroupManager();
    },

    /** 分组管理弹窗：从组中移除 type */
    _pgmRemoveType(groupId, type) {
        const group = this._presetGroups.find(g => g.id === groupId);
        if (group) {
            group.types = (group.types || []).filter(t => t !== type);
            this._savePresetGroups();
            this.showGroupManager();
        }
    },
};

