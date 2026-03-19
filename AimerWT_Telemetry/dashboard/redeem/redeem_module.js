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

    /** 从预设 payload JSON 中解析出可读的奖励列表 */
    parsePayloadRewards(payloadStr, forPopup = false) {
        try {
            const p = typeof payloadStr === 'string' ? JSON.parse(payloadStr) : payloadStr;
            const rewards = [];
            if (p.theme) {
                const themeName = this._themeDisplayNames[p.theme] || p.theme;
                rewards.push({ icon: '🎨', text: '解锁' + themeName, type: 'theme' });
            }
            if (p.bonus && p.bonus > 0) rewards.push({ icon: '💬', text: p.bonus + ' 次AI永久额度', type: 'bonus' });
            if (p.daily_limit_bonus && p.daily_limit_bonus > 0) {
                const dlbText = forPopup ? '每日对话额度增加' : '每日对话额度增加 +' + p.daily_limit_bonus;
                rewards.push({ icon: '📈', text: dlbText, type: 'bonus' });
            }
            if (p.tag) {
                const tagLabel = this._tagLabelMap[p.tag] || p.tag;
                rewards.push({ icon: '🏷️', text: '称号: ' + tagLabel, type: 'tag' });
            }
            if (rewards.length === 0) rewards.push({ icon: '🎁', text: '无特殊奖励', type: 'bonus' });
            return rewards;
        } catch { return [{ icon: '🎁', text: '自定义内容', type: 'bonus' }]; }
    },

    // ═══════════════════════════════════════════════════════
    // 生成兑换码视图
    // ═══════════════════════════════════════════════════════

    async initGenerate() {
        await this._loadPresets();
        this._renderPresetGrid();
        this.updatePreview();
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

    /** 渲染预设类型卡片 */
    _renderPresetGrid() {
        const grid = document.getElementById('redeemPresetGrid');
        if (!grid) return;

        const cards = this._presets.map((p, idx) => {
            const rewards = this.parsePayloadRewards(p.payload);
            const rewardHtml = rewards.map(r =>
                `<div class="preset-reward-item">
                    <div class="reward-icon ${r.type}">${r.icon}</div>
                    <span>${r.text}</span>
                </div>`
            ).join('');

            return `<div class="redeem-preset-card" data-idx="${idx}" onclick="redeemModule.selectPreset(${idx})">
                <div class="preset-name">${p.label}</div>
                <div class="preset-type">${p.type}</div>
                <div class="preset-rewards">${rewardHtml}</div>
            </div>`;
        }).join('');

        // 自定义卡片
        const customCard = `<div class="redeem-preset-card" data-idx="custom" onclick="redeemModule.selectPreset('custom')" style="border-style: dashed;">
            <div class="preset-name">✨ 自定义</div>
            <div class="preset-type">custom</div>
            <div class="preset-rewards">
                <div class="preset-reward-item">
                    <div class="reward-icon bonus">⚙️</div>
                    <span>自由配置所有参数</span>
                </div>
            </div>
        </div>`;

        grid.innerHTML = cards + customCard;
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
        if (idx !== 'custom') {
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
            const styleSelect = document.getElementById('redeemPopupStyleSelect');
            if (styleSelect) styleSelect.value = savedDefaults.popup_style_select || 'default';
            const logoSelect = document.getElementById('redeemPopupLogo');
            if (logoSelect) logoSelect.value = savedDefaults.popup_logo || 'default';
            // 主播相关字段
            const noteTagEl = document.getElementById('redeemNoteTag');
            if (noteTagEl) noteTagEl.value = savedDefaults.note_tag || '';
            const streamerIdEl = document.getElementById('redeemStreamerId');
            if (streamerIdEl) streamerIdEl.value = savedDefaults.streamer_id || '';
        } else if (idx !== 'custom') {
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
            const styleSelect = document.getElementById('redeemPopupStyleSelect');
            if (styleSelect) styleSelect.value = 'default';
            const logoSelect = document.getElementById('redeemPopupLogo');
            if (logoSelect) logoSelect.value = 'default';
        }

        // 根据预设类型显示/隐藏主播相关行
        this._updateStreamerRows(presetType);
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

        // 构建奖励列表 HTML
        const rewards = this.parsePayloadRewards(this._buildPayload(), true);
        const rewardItemsHtml = rewards.map(r =>
            `<div style="display:flex; align-items:center; gap:8px; margin-bottom:6px; font-size:13px;">` +
            `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink:0; opacity:0.6;"><path d="M20 6L9 17l-5-5"/></svg>` +
            `<span>${r.text}</span></div>`
        ).join('');

        const displayTitle = customTitle || '兑换成功';
        const displayRewards = customMsg
            ? `<div style="font-size:13px; line-height:1.6; white-space:pre-line;">${customMsg}</div>`
            : rewardItemsHtml;

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
            html = html.replace('{{TITLE}}', displayTitle).replace('{{REWARDS}}', displayRewards).replace('{{BUTTON}}', displayButton);

            // Logo 替换：如果用户选择了自定义 Logo→替换模板中的 SVG
            const logoVal = document.getElementById('redeemPopupLogo')?.value || 'default';
            if (logoVal !== 'default' && this._logoSvgMap[logoVal]) {
                html = html.replace(/<svg[^>]*>.*?<\/svg>/is, this._logoSvgMap[logoVal]);
            }

            // 主播分享文案替换：将“分享福利”替换为“来自xxx的分享”
            const streamerId = document.getElementById('redeemStreamerId')?.value?.trim() || '';
            if (streamerId && (presetType === 'streamer_share' || styleName === 'style_streamer_share')) {
                html = html.replace('· 分享福利 ·', `· 来自${streamerId}的分享 ·`);
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
        document.getElementById('redeemPayloadTag').value = '';
        document.getElementById('redeemGenCount').value = 1;
        document.getElementById('redeemGenMaxUses').value = 1;
        document.getElementById('redeemGenExpireIn').value = 0;
        document.getElementById('redeemGenNote').value = '';
        document.getElementById('redeemPopupTitle').value = '';
        document.getElementById('redeemPopupMessage').value = '';
        const btnEl = document.getElementById('redeemPopupButton');
        if (btnEl) btnEl.value = '';
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

        // 备注标签和主播ID拼接到备注中
        const noteTag = document.getElementById('redeemNoteTag')?.value?.trim() || '';
        const streamerId = document.getElementById('redeemStreamerId')?.value?.trim() || '';
        if (noteTag) note = note ? `${note} [主播: ${noteTag}]` : `[主播: ${noteTag}]`;
        if (streamerId) note = note ? `${note} [分享来源: ${streamerId}]` : `[分享来源: ${streamerId}]`;

        let type;
        if (this._selectedPreset === 'custom') {
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
                    popup_style: popupStyle
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
        await this._loadPresets();
        await this._loadAllCodes();
        this._renderStatsCards();
        this._renderCategoryTabs();
        this._renderFilteredCodes();
        this.switchStatsTab('codes');
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
            { label: '总数', value: total, color: 'var(--primary)' },
            { label: '可用', value: active, color: 'var(--secondary)' },
            { label: '已用完', value: used, color: 'var(--warning)' },
            { label: '已过期', value: expired, color: 'var(--danger)' },
            { label: '已停用', value: disabled, color: 'var(--text-muted)' },
            { label: '总使用次数', value: totalUsed, color: '#8b5cf6' },
        ];

        container.innerHTML = stats.map(s =>
            `<div class="redeem-stat-card">
                <div class="stat-label">${s.label}</div>
                <div class="stat-value" style="color: ${s.color};">${s.value}</div>
            </div>`
        ).join('');
    },

    /** 渲染分类标签栏 */
    _renderCategoryTabs() {
        const container = document.getElementById('redeemCategoryTabs');
        if (!container) return;

        // 统计每种类型的数量
        const typeCounts = {};
        this._allCodes.forEach(c => {
            typeCounts[c.type] = (typeCounts[c.type] || 0) + 1;
        });

        // 预设类型 label 映射
        const typeLabels = {};
        this._presets.forEach(p => { typeLabels[p.type] = p.label; });

        // 构建标签
        const allTab = `<div class="redeem-category-tab ${this._currentCategory === 'all' ? 'active' : ''}"
            onclick="redeemModule.filterByCategory('all')">
            全部 <span class="tab-count">${this._allCodes.length}</span>
        </div>`;

        const typeTabs = Object.keys(typeCounts).map(type => {
            const label = typeLabels[type] || type;
            const isActive = this._currentCategory === type;
            return `<div class="redeem-category-tab ${isActive ? 'active' : ''}"
                onclick="redeemModule.filterByCategory('${type}')">
                ${label} <span class="tab-count">${typeCounts[type]}</span>
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

    /** 渲染过滤后的兑换码列表 */
    _renderFilteredCodes() {
        const tbody = document.getElementById('statsCodesBody');
        if (!tbody) return;

        const codes = this._currentCategory === 'all'
            ? this._allCodes
            : this._allCodes.filter(c => c.type === this._currentCategory);

        if (codes.length === 0) {
            tbody.innerHTML = '<tr><td colspan="8" style="text-align: center; color: var(--text-muted); padding: 40px;">该类型暂无兑换码</td></tr>';
            return;
        }

        const typeLabels = {};
        this._presets.forEach(p => { typeLabels[p.type] = p.label; });

        tbody.innerHTML = codes.map(code => {
            const statusMap = {
                'active': '<span style="color: var(--secondary);">可用</span>',
                'used': '<span style="color: var(--warning);">已用完</span>',
                'expired': '<span style="color: var(--danger);">已过期</span>',
                'disabled': '<span style="color: var(--text-muted);">已停用</span>',
            };
            const statusHtml = statusMap[code.status] || code.status;
            const typeLabel = typeLabels[code.type] || code.type;
            const usageText = code.max_uses > 0 ? `${code.used_count} / ${code.max_uses}` : `${code.used_count} / ∞`;

            // 解析奖励描述
            const rewards = this.parsePayloadRewards(code.payload);
            const rewardText = rewards.map(r => r.icon + ' ' + r.text).join('、');

            const activeBtn = code.is_active
                ? `<button class="btn" onclick="event.stopPropagation(); redeemModule.toggleActive(${code.id}, false)" style="font-size:11px; padding:2px 8px;">停用</button>`
                : `<button class="btn" onclick="event.stopPropagation(); redeemModule.toggleActive(${code.id}, true)" style="font-size:11px; padding:2px 8px;">启用</button>`;

            return `<tr onclick="redeemModule.showDetail(${code.id})">
                <td style="font-family: monospace; font-size: 13px; font-weight: 600; letter-spacing: 1px; cursor: pointer;" title="点击查看详情">${code.code}</td>
                <td><span style="padding: 2px 8px; border-radius: 8px; font-size: 11px; background: var(--bg); border: 1px solid var(--border);">${typeLabel}</span></td>
                <td style="font-size: 12px; max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${rewardText}">${rewardText}</td>
                <td>${usageText}</td>
                <td>${statusHtml}</td>
                <td style="max-width: 100px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${code.note || ''}">${code.note || '-'}</td>
                <td style="font-size: 12px; color: var(--text-muted);">${(code.created_at || '').replace('T', ' ').substring(0, 19)}</td>
                <td style="display: flex; gap: 4px;" onclick="event.stopPropagation();">
                    ${activeBtn}
                    <button class="btn" onclick="redeemModule.deleteCode(${code.id})" style="font-size:11px; padding:2px 8px; color: var(--danger); border-color: var(--danger);">删除</button>
                </td>
            </tr>`;
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
            if (codesBtn) codesBtn.style.fontWeight = '600';
            if (recordsBtn) recordsBtn.style.fontWeight = '';
        } else {
            if (codesPanel) codesPanel.style.display = 'none';
            if (recordsPanel) recordsPanel.style.display = '';
            if (codesBtn) codesBtn.style.fontWeight = '';
            if (recordsBtn) recordsBtn.style.fontWeight = '600';
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
                tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: var(--text-muted); padding: 40px;">暂无使用记录</td></tr>';
                return;
            }

            tbody.innerHTML = records.map(r => {
                const hwid = r.machine_id || '-';
                const displayHwid = hwid.length > 12 ? hwid.substring(0, 6) + '...' + hwid.substring(hwid.length - 4) : hwid;
                const userDisplay = r.alias || displayHwid;
                return `<tr>
                    <td style="font-family: monospace; font-size: 13px; font-weight: 600;">${r.code}</td>
                    <td>${userDisplay}</td>
                    <td style="font-family: monospace; font-size: 12px;" title="${hwid}">${displayHwid}</td>
                    <td style="font-size: 12px; color: var(--text-muted);">${r.created_at || '-'}</td>
                </tr>`;
            }).join('');
        } catch {
            tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: var(--danger);">加载失败</td></tr>';
        }
    },

    // ─────────── 码详情弹窗 ───────────

    /** 展示兑换码详情 */
    showDetail(codeId) {
        const code = this._allCodes.find(c => c.id === codeId);
        if (!code) return;
        this._editingCodeId = codeId;

        const typeLabels = {};
        this._presets.forEach(p => { typeLabels[p.type] = p.label; });

        const rewards = this.parsePayloadRewards(code.payload);
        const rewardHtml = rewards.map(r =>
            `<span style="display: inline-flex; align-items: center; gap: 4px; margin-right: 12px;">${r.icon} ${r.text}</span>`
        ).join('');

        const statusMap = {
            'active': '<span style="color: var(--secondary); font-weight: 600;">✅ 可用</span>',
            'used': '<span style="color: var(--warning); font-weight: 600;">⚠️ 已用完</span>',
            'expired': '<span style="color: var(--danger); font-weight: 600;">⏰ 已过期</span>',
            'disabled': '<span style="color: var(--text-muted); font-weight: 600;">🚫 已停用</span>',
        };

        const body = document.getElementById('redeemDetailBody');
        body.innerHTML = `
            <div class="redeem-detail-grid">
                <div class="detail-label">兑换码</div>
                <div class="detail-value mono" style="cursor: pointer;" onclick="navigator.clipboard.writeText('${code.code}'); app.showAlert('已复制', 'success');" title="点击复制">${code.code}</div>

                <div class="detail-label">类型</div>
                <div class="detail-value">${typeLabels[code.type] || code.type}</div>

                <div class="detail-label">状态</div>
                <div class="detail-value">${statusMap[code.status] || code.status}</div>

                <div class="detail-label">使用次数</div>
                <div class="detail-value">${code.max_uses > 0 ? code.used_count + ' / ' + code.max_uses : code.used_count + ' / ∞'}</div>

                <div class="detail-label">奖励内容</div>
                <div class="detail-value">${rewardHtml}</div>

                <div class="detail-label">创建时间</div>
                <div class="detail-value">${(code.created_at || '').replace('T', ' ').substring(0, 19)}</div>

                <div class="detail-label">过期时间</div>
                <div class="detail-value">${code.expires_at ? code.expires_at.replace('T', ' ').substring(0, 19) : '永不过期'}</div>

                <div class="detail-label">备注</div>
                <div class="detail-value">${code.note || '-'}</div>
            </div>

            <div style="margin-top: 20px; padding-top: 16px; border-top: 1px solid var(--border);">
                <div style="font-size: 14px; font-weight: 600; margin-bottom: 12px;">编辑奖励参数</div>
                <div class="payload-editor">
                    <div class="payload-row">
                        <div class="payload-label"><span class="label-icon">🎨</span> 主题</div>
                        <input type="text" class="input" style="flex: 1;" id="detailPayloadTheme" value="${this._parseField(code.payload, 'theme')}">
                    </div>
                    <div class="payload-row">
                        <div class="payload-label"><span class="label-icon">💬</span> AI额度</div>
                        <input type="number" class="input" style="flex: 1; max-width: 120px;" id="detailPayloadBonus" value="${this._parseField(code.payload, 'bonus') || 0}" min="0">
                    </div>
                    <div class="payload-row">
                        <div class="payload-label"><span class="label-icon">🏷️</span> 标签</div>
                        <input type="text" class="input" style="flex: 1;" id="detailPayloadTag" value="${this._parseField(code.payload, 'tag')}">
                    </div>
                </div>
            </div>

            <div style="margin-top: 16px;">
                <div style="font-size: 14px; font-weight: 600; margin-bottom: 12px;">自定义兑换弹窗</div>
                <div class="redeem-form-grid">
                    <div class="form-group">
                        <label>弹窗标题</label>
                        <input type="text" class="input" style="width: 100%;" id="detailPopupTitle" value="${code.popup_title || ''}" placeholder="留空则用默认">
                    </div>
                    <div class="form-group">
                        <label>弹窗样式</label>
                        <select class="select" style="width: 100%;" id="detailPopupStyle">
                            <option value="default" ${(code.popup_style || 'default') === 'default' ? 'selected' : ''}>默认</option>
                            <option value="celebration" ${code.popup_style === 'celebration' ? 'selected' : ''}>🎉 庆祝</option>
                            <option value="premium" ${code.popup_style === 'premium' ? 'selected' : ''}>💎 高级</option>
                        </select>
                    </div>
                    <div class="form-group full-width">
                        <label>弹窗内容</label>
                        <textarea class="input" style="width: 100%; height: 60px; resize: vertical;" id="detailPopupMessage" placeholder="留空则自动生成">${code.popup_message || ''}</textarea>
                    </div>
                </div>
            </div>`;

        document.getElementById('redeemDetailSaveBtn').style.display = '';
        document.getElementById('redeemDetailMask').style.display = '';
        document.getElementById('redeemDetailMask').classList.add('show');
        document.getElementById('redeemDetailModal').classList.add('show');
    },

    _parseField(payloadStr, field) {
        try { return JSON.parse(payloadStr)[field] || ''; } catch { return ''; }
    },

    /** 关闭详情弹窗 */
    closeDetail() {
        document.getElementById('redeemDetailMask').classList.remove('show');
        document.getElementById('redeemDetailModal').classList.remove('show');
        setTimeout(() => {
            const mask = document.getElementById('redeemDetailMask');
            if (mask) mask.style.display = 'none';
        }, 200);
        this._editingCodeId = null;
    },

    /** 保存详情修改 */
    async saveDetail() {
        if (!this._editingCodeId) return;

        const theme = document.getElementById('detailPayloadTheme')?.value?.trim() || '';
        const bonus = parseInt(document.getElementById('detailPayloadBonus')?.value) || 0;
        const tag = document.getElementById('detailPayloadTag')?.value?.trim() || '';
        const payload = JSON.stringify({ theme, bonus, tag });

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
        app.showAlert('导出成功', 'success');
    },

    // ═══════════════════════════════════════════════════
    // 预设默认值保存/恢复（localStorage）
    // ═══════════════════════════════════════════════════

    /** 获取当前选中的预设类型名 */
    _getCurrentPresetType() {
        if (this._selectedPreset === null) return null;
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
            note_tag: document.getElementById('redeemNoteTag')?.value?.trim() || '',
            streamer_id: document.getElementById('redeemStreamerId')?.value?.trim() || '',
        };
    },

    /** 保存当前配置为该预设类型的默认值 */
    savePresetDefaults() {
        const presetType = this._getCurrentPresetType();
        if (!presetType) {
            app.showAlert('请先选择一个预设类型', 'warning');
            return;
        }
        const data = this._collectFormData();
        const key = `redeem_preset_${presetType}`;
        localStorage.setItem(key, JSON.stringify(data));
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
    }
};
