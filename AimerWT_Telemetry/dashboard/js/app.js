
/**
 * AimerWT Dashboard 核心应用
 * 功能：路由管理、视图加载、API 通信、全局状态
 */

const app = {
    // 配置
    config: {
        apiBase: '',
        updateInterval: 300 // 5分钟
    },

    // 状态
    state: {
        currentView: null,
        charts: {},
        dashboardData: null,
        latestUsersData: [],
        selectedUser: null,
        markedUsers: new Set(),
        adminUsers: new Set(),
        updateTimerInterval: null,
        updateElapsedSeconds: 0,
        notes: [],
        aiUsageData: [],
        aiUsageStats: null,
        aiModelDistribution: [],
        usageCurrentPage: 1,
        usagePageSize: 10
    },

    // 颜色配置
    colors: {
        primary: '#2563eb',
        secondary: '#10b981',
        warning: '#f59e0b',
        danger: '#ef4444',
        muted: '#94a3b8'
    },

    /**
     * 初始化应用
     */
    init() {
        this.setupEventListeners();
        this.startUpdateTimer();
        // 默认加载主页
        this.switchView('dashboard', document.querySelector('[data-view="dashboard"]'));
        // 启动定时刷新
        setInterval(() => this.fetchData(), 300000);
    },

    /**
     * 设置事件监听
     */
    setupEventListeners() {
        window.addEventListener('resize', this.debounce(() => {
            Object.values(this.state.charts).forEach(chart => chart && chart.resize());
        }, 200));

        // HWID tooltip 事件委托
        document.addEventListener('mouseover', (e) => {
            const cell = e.target.closest('.hwid-cell');
            if (cell && !this.hwidTooltip) {
                this.showHwidTooltip(cell);
            }
        });

        document.addEventListener('mouseout', (e) => {
            const cell = e.target.closest('.hwid-cell');
            if (cell && this.hwidTooltip) {
                this.hideHwidTooltip();
            }
        });
    },

    /**
     * 显示 HWID tooltip
     */
    showHwidTooltip(cell) {
        const hwid = cell.dataset.hwid;
        if (!hwid || hwid === '-') return;

        const tooltip = document.createElement('div');
        tooltip.className = 'hwid-toast show';
        tooltip.textContent = hwid;
        document.body.appendChild(tooltip);

        const rect = cell.getBoundingClientRect();
        tooltip.style.left = `${rect.left + rect.width / 2 - tooltip.offsetWidth / 2}px`;
        tooltip.style.top = `${rect.top - tooltip.offsetHeight - 8}px`;

        this.hwidTooltip = tooltip;
    },

    /**
     * 隐藏 HWID tooltip
     */
    hideHwidTooltip() {
        if (this.hwidTooltip) {
            this.hwidTooltip.remove();
            this.hwidTooltip = null;
        }
    },

    /**
     * 防抖函数
     */
    debounce(fn, wait) {
        let timer;
        return (...args) => {
            clearTimeout(timer);
            timer = setTimeout(() => fn(...args), wait);
        };
    },

    /**
     * 处理控制菜单点击
     */
    handleControlMenuClick(menuItem) {
        const isExpanded = menuItem.classList.contains('expanded');
        const submenu = document.getElementById('controlSubmenu');

        if (isExpanded) {
            menuItem.classList.remove('expanded');
            submenu.classList.remove('show');
        } else {
            menuItem.classList.add('expanded');
            submenu.classList.add('show');
        }

        // 展开后自动选择第一个子菜单项（通知）
        const firstSubmenuItem = submenu.querySelector('.submenu-item');
        if (firstSubmenuItem) {
            this.switchView('notification', firstSubmenuItem);
        }
    },

    /**
     * 处理用户菜单点击
     */
    handleUserMenuClick(menuItem) {
        const isExpanded = menuItem.classList.contains('expanded');
        const submenu = document.getElementById('userSubmenu');

        if (isExpanded) {
            menuItem.classList.remove('expanded');
            submenu.classList.remove('show');
        } else {
            menuItem.classList.add('expanded');
            submenu.classList.add('show');
        }

        // 展开后自动选择第一个子菜单项（用户列表）
        const firstSubmenuItem = submenu.querySelector('.submenu-item');
        if (firstSubmenuItem) {
            this.switchView('userlist', firstSubmenuItem);
        }
    },

    /**
     * 处理AI功能菜单点击
     */
    handleAiMenuClick(menuItem) {
        const isExpanded = menuItem.classList.contains('expanded');
        const submenu = document.getElementById('aiSubmenu');

        if (isExpanded) {
            menuItem.classList.remove('expanded');
            submenu.classList.remove('show');
        } else {
            menuItem.classList.add('expanded');
            submenu.classList.add('show');
        }

        // 展开后自动选择第一个子菜单项（AI助手）
        const firstSubmenuItem = submenu.querySelector('.submenu-item');
        if (firstSubmenuItem) {
            this.switchView('ai_assistant', firstSubmenuItem);
        }
    },

    /**
     * 切换视图
     */
    async switchView(viewId, menuItem) {
        document.querySelectorAll('.menu-item').forEach(item => item.classList.remove('active'));
        document.querySelectorAll('.submenu-item').forEach(item => item.classList.remove('active'));

        if (menuItem) {
            menuItem.classList.add('active');
        }

        const mainContent = document.getElementById('mainContent');
        try {
            const cacheBuster = `?t=${Date.now()}`;
            const response = await fetch(`views/${viewId}.html${cacheBuster}`);
            if (!response.ok) throw new Error(`Failed to load view: ${viewId}`);
            const html = await response.text();
            mainContent.innerHTML = html;
            this.state.currentView = viewId;
            this.initView(viewId);
        } catch (error) {
            console.error('Error loading view:', error);
            mainContent.innerHTML = `<div class="view-container active"><div class="app"><div class="panel"><div class="panel-body" style="padding: 40px; text-align: center; color: var(--text-muted);"><h3>加载失败</h3><p>${error.message}</p></div></div></div></div>`;
        }
    },

    /**
     * 初始化特定视图
     */
    initView(viewId) {
        switch (viewId) {
            case 'dashboard':
                this.initDashboard();
                break;
            case 'control':
                this.initControl();
                break;
            case 'userlist':
                this.initUserList();
                break;
            case 'userdetail':
                this.initUserDetail();
                break;
            case 'settings':
                this.initSettings();
                break;
            case 'announcement':
                this.initAnnouncement();
                break;
            case 'advertisement':
                this.initAdvertisement();
                break;
            default:
                break;
        }
    },

    /**
     * 初始化仪表盘视图
     */
    initDashboard() {
        this.initCharts();
        this.setDefaultDates();
        this.fetchData();
    },

    /**
     * 初始化图表
     */
    initCharts() {
        const chartIds = ['growthChart', 'newVsDauChart', 'osChart', 'archChart', 'versionChart', 'localeChart'];
        chartIds.forEach(id => {
            const dom = document.getElementById(id);
            if (dom && typeof echarts !== 'undefined') {
                this.state.charts[id] = echarts.init(dom, null, { renderer: 'canvas' });
            }
        });
    },

    /**
     * 设置默认日期
     */
    setDefaultDates() {
        const today = new Date();
        const lastMonth = new Date(today.getFullYear(), today.getMonth() - 1, today.getDate());
        const lastPeriodStart = new Date(today.getFullYear(), today.getMonth() - 2, today.getDate());

        const elements = {
            endDate: document.getElementById('endDate'),
            startDate: document.getElementById('startDate'),
            compareEnd: document.getElementById('compareEnd'),
            compareStart: document.getElementById('compareStart')
        };

        if (elements.endDate) elements.endDate.value = this.formatDate(today);
        if (elements.startDate) elements.startDate.value = this.formatDate(lastMonth);
        if (elements.compareEnd) elements.compareEnd.value = this.formatDate(lastMonth);
        if (elements.compareStart) elements.compareStart.value = this.formatDate(lastPeriodStart);
    },

    /**
     * 格式化日期
     */
    formatDate(date) {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    },

    /**
     * 格式化数字
     */
    formatNumber(num) {
        if (num === undefined || num === null) return '-';
        return Number(num).toLocaleString('zh-CN');
    },

    /**
     * 获取数据
     */
    async fetchData() {

        const params = this.buildStatsParams();
        this.setRefreshing(true);
        try {
            const response = await fetch(`${this.config.apiBase}/admin/stats?${params}`);
            if (!response.ok) throw new Error('Failed to fetch');
            this.state.dashboardData = await response.json();
            this.updateDashboard(this.state.dashboardData);
        } catch (error) {
            console.warn('API fetch failed');
            this.loadEmptyState();
        } finally {
            this.setRefreshing(false);
            this.startUpdateTimer();
        }
    },

    /**
     * 构建统计参数
     */
    buildStatsParams() {
        const filters = {
            os: document.getElementById('filterOS')?.value,
            arch: document.getElementById('filterArch')?.value,
            version: document.getElementById('filterVersion')?.value,
            locale: document.getElementById('filterLocale')?.value,
            range: document.getElementById('trendRange')?.value
        };

        const compareStart = document.getElementById('compareStart')?.value;
        const compareEnd = document.getElementById('compareEnd')?.value;
        if (compareStart && compareEnd) {
            filters.compare_start_date = compareStart;
            filters.compare_end_date = compareEnd;
        }

        const params = new URLSearchParams();
        Object.entries(filters).forEach(([k, v]) => v && params.append(k, v));
        return params.toString();
    },

    /**
     * 更新仪表盘
     */
    updateDashboard(data) {
        this.updateStatCards(data);
        this.renderGrowthChart(data.growth_data || [], data.compare_growth_data || [], data.video_release_date || data.video_release_at);
        this.renderNewVsDauChart(data.growth_data || [], data.compare_growth_data || []);
        this.renderPieChart('osChart', data.os_stats || []);
        this.renderPieChart('archChart', data.arch_stats || []);
        this.renderPieChart('versionChart', data.version_stats || []);
        this.renderPieChart('localeChart', data.locale_stats || []);
        this.renderRecentUsers(data.recent_users || []);

        this.state.latestUsersData = data.recent_users || [];
        if (this.state.currentView === 'userlist') {
            this.renderUserList(this.state.latestUsersData);
        }

        this.updateFilters(data);
        this.checkAlerts(data);
        this.updateTimestamp();
    },

    /**
     * 更新统计卡片
     */
    updateStatCards(data) {
        this.setText('totalUsers', this.formatNumber(data.total_users));
        this.setText('onlineUsers', this.formatNumber(data.online_users));
        this.setText('todayNew', this.formatNumber(data.today_new));
        this.setText('dauUsers', this.formatNumber(data.dau || 0));

        this.updateTrend('totalUsersTrend', data.total_users_growth ?? 0);
        this.updateTrend('todayNewTrend', data.today_new_growth ?? 0);
        this.updateTrend('dauTrend', data.dau_growth ?? 0);

        if (data.total_users > 0) {
            const rate = ((data.online_users / data.total_users) * 100).toFixed(1);
            this.setText('onlineRate', `在线率 ${rate}%`);
        }
    },

    /**
     * 设置文本
     */
    setText(id, text) {
        const el = document.getElementById(id);
        if (el) el.textContent = text;
    },

    /**
     * 更新趋势
     */
    updateTrend(id, value) {
        const el = document.getElementById(id);
        if (!el) return;
        const isUp = value >= 0;
        el.className = `trend ${isUp ? 'up' : 'down'}`;
        el.textContent = `${isUp ? '↑' : '↓'} ${Math.abs(value).toFixed(1)}%`;
    },

    /**
     * 渲染增长图表
     */
    renderGrowthChart(growthData, compareData, releaseDate) {
        if (!growthData.length || !this.state.charts.growthChart) return;

        const peak = this.findPeak(growthData);
        const dates = growthData.map(d => d.date);

        const option = {
            grid: { left: 30, right: 20, top: 50, bottom: 30 },
            tooltip: { trigger: 'axis' },
            xAxis: {
                type: 'category',
                data: dates.map(d => d.slice(5)),
                axisLine: { lineStyle: { color: '#e2e8f0' } },
                axisLabel: { color: '#64748b', fontSize: 11 }
            },
            yAxis: {
                type: 'value',
                min: 1,
                minInterval: 1,
                axisLabel: { color: '#94a3b8', fontSize: 11 },
                splitLine: { lineStyle: { color: '#f1f5f9' } }
            },
            series: [
                {
                    name: '用户增长',
                    type: 'line',
                    data: growthData.map(d => d.count),
                    smooth: true,
                    symbol: 'circle',
                    symbolSize: 6,
                    lineStyle: { color: this.colors.primary, width: 3 },
                    itemStyle: { color: this.colors.primary },
                    areaStyle: {
                        color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                            { offset: 0, color: 'rgba(37, 99, 235, 0.3)' },
                            { offset: 1, color: 'rgba(37, 99, 235, 0)' }
                        ])
                    },
                    markPoint: {
                        symbol: 'pin',
                        symbolSize: 48,
                        itemStyle: { color: this.colors.warning },
                        label: {
                            color: '#fff',
                            fontSize: 11,
                            formatter: (params) => this.formatNumber(params.value)
                        },
                        data: [{
                            name: '峰值',
                            coord: [peak.index, peak.value],
                            value: peak.value
                        }]
                    },
                    sampling: 'lttb',
                    large: true,
                    progressive: 1000
                }
            ]
        };

        if (compareData && compareData.length) {
            option.series.push({
                name: '对比周期',
                type: 'line',
                data: compareData.map(d => d.count),
                smooth: true,
                symbol: 'none',
                lineStyle: { color: this.colors.muted, width: 2, type: 'dashed' }
            });
        }

        if (releaseDate) {
            const releaseIndex = dates.findIndex(d => d === releaseDate);
            if (releaseIndex >= 0) {
                option.series[0].markLine = {
                    symbol: ['none', 'none'],
                    label: { formatter: '视频发布', color: this.colors.warning },
                    lineStyle: { color: this.colors.warning, type: 'dashed' },
                    data: [{ xAxis: releaseIndex }]
                };
                this.setText('growthPeakInfo', `峰值 ${peak.date} · 视频发布 ${releaseDate}`);
            } else {
                this.setText('growthPeakInfo', `峰值 ${peak.date}`);
            }
        } else {
            this.setText('growthPeakInfo', `峰值 ${peak.date}`);
        }

        this.state.charts.growthChart.setOption(option);
    },

    /**
     * 查找峰值
     */
    findPeak(data) {
        let maxVal = 0, maxIdx = 0, maxDate = '';
        data.forEach((d, i) => {
            if (d.count > maxVal) {
                maxVal = d.count;
                maxIdx = i;
                maxDate = d.date;
            }
        });
        return { value: maxVal, index: maxIdx, date: maxDate };
    },

    /**
     * 渲染新增与 DAU 对比图
     */
    renderNewVsDauChart(growthData, compareData) {
        if (!growthData.length || !this.state.charts.newVsDauChart) return;

        const option = {
            grid: { left: 35, right: 20, top: 20, bottom: 30 },
            tooltip: { trigger: 'axis' },
            xAxis: {
                type: 'category',
                data: growthData.map(d => d.date.slice(5)),
                axisLabel: { color: '#64748b', fontSize: 11 }
            },
            yAxis: {
                type: 'value',
                min: 1,
                minInterval: 1,
                axisLabel: { color: '#94a3b8', fontSize: 11 },
                splitLine: { lineStyle: { color: '#f1f5f9' } }
            },
            series: [
                {
                    name: '新增用户',
                    type: 'line',
                    data: growthData.map(d => d.new_count ?? d.count),
                    smooth: true,
                    symbol: 'none',
                    lineStyle: { color: this.colors.secondary, width: 2 }
                },
                {
                    name: 'DAU',
                    type: 'line',
                    data: growthData.map(d => d.dau ?? 0),
                    smooth: true,
                    symbol: 'none',
                    lineStyle: { color: this.colors.primary, width: 2 }
                }
            ]
        };

        if (compareData && compareData.length) {
            option.series.push({
                name: '新增对比',
                type: 'line',
                data: compareData.map(d => d.new_count ?? d.count),
                smooth: true,
                symbol: 'none',
                lineStyle: { color: this.colors.muted, width: 1, type: 'dashed' }
            });
        }

        this.state.charts.newVsDauChart.setOption(option);
    },

    /**
     * 渲染饼图
     */
    renderPieChart(chartId, rawData) {
        const chart = this.state.charts[chartId];
        if (!chart || !rawData.length) return;

        const normalized = this.normalizePieData(rawData);
        const data = chartId === 'osChart'
            ? normalized.map(item => ({
                ...item,
                fullName: item.name,
                name: this.simplifyOSName(item.name)
            }))
            : normalized;

        const option = {
            tooltip: {
                trigger: 'item',
                formatter: (params) => {
                    const fullName = params.data && params.data.fullName ? params.data.fullName : params.name;
                    return `${fullName}: ${params.value} (${params.percent}%)`;
                }
            },
            legend: {
                bottom: 0,
                icon: 'rect',
                itemWidth: 10,
                itemHeight: 10,
                textStyle: { color: '#64748b', fontSize: 11 }
            },
            series: [{
                type: 'pie',
                radius: ['45%', '72%'],
                center: ['50%', '45%'],
                label: { color: '#64748b', fontSize: 10 },
                data: data.map((item, idx) => ({
                    name: item.name,
                    value: item.value,
                    itemStyle: {
                        color: [this.colors.primary, this.colors.secondary, this.colors.warning, this.colors.danger, '#7c3aed', '#0ea5e9'][idx % 6]
                    }
                }))
            }]
        };

        chart.setOption(option);
    },

    normalizePieData(list) {
        const sorted = [...list].sort((a, b) => b.value - a.value);
        if (sorted.length <= 6) return sorted;
        const top = sorted.slice(0, 5);
        const rest = sorted.slice(5).reduce((sum, item) => sum + item.value, 0);
        if (rest > 0) top.push({ name: '其他', value: rest });
        return top;
    },

    simplifyOSName(name) {
        if (!name) return '-';
        const lower = name.toLowerCase();
        if (lower.includes('windows')) {
            const match = lower.match(/windows\s*([0-9]+)/);
            if (match) return `Win${match[1]}`;
            if (lower.includes('xp')) return 'WinXP';
            if (lower.includes('vista')) return 'WinVista';
        }
        const winMatch = lower.match(/win\s*([0-9]+)/);
        if (winMatch) return `Win${winMatch[1]}`;
        return name.length > 6 ? name.slice(0, 6) : name;
    },

    normalizeUserName(value) {
        if (!value) return '';
        const trimmed = String(value).trim();
        return trimmed === '-' ? '' : trimmed;
    },

    getAutoUserName(item) {
        return item.nickname || item.user || `user${item.id || '?'}`;
    },

    getDisplayUserName(item) {
        const alias = this.normalizeUserName(item.alias);
        const nickname = this.normalizeUserName(item.nickname);
        const user = this.normalizeUserName(item.user);
        const autoName = this.getAutoUserName(item);

        if (alias) return alias;
        return nickname || user || autoName;
    },

    formatTimeAgo(minutes) {
        if (minutes === '-' || minutes === undefined || minutes === null) return '-';
        const m = parseInt(minutes, 10);
        if (isNaN(m)) return minutes;

        const days = Math.floor(m / 1440);
        const hours = Math.floor((m % 1440) / 60);
        const mins = m % 60;

        if (days > 0) {
            if (hours === 0 && mins === 0) return `${days} 天前`;
            if (hours === 0) return `${days} 天 ${mins} 分钟前`;
            if (mins === 0) return `${days} 天 ${hours} 小时前`;
            return `${days} 天 ${hours} 小时 ${mins} 分钟前`;
        }

        if (hours > 0) {
            if (mins === 0) return `${hours} 小时前`;
            return `${hours} 小时 ${mins} 分钟前`;
        }

        return `${mins} 分钟前`;
    },

    formatHwid(hwid) {
        if (!hwid || hwid === '-') return '-';
        const text = String(hwid);
        if (text.length <= 5) return text;
        return `${text.slice(0, 5)}`;
    },

    getUserRegisterTime(user) {
        return user.registered_at || user.created_at || user.first_seen || user.first_seen_at || user.time || user.updated_at || user.last_seen || user.last_seen_at || '-';
    },

    /**
     * 渲染最近用户
     */
    renderRecentUsers(list) {
        const container = document.getElementById('recentUsersList');
        if (!container) return;
        container.innerHTML = '';

        const fullList = list && list.length ? [...list] : [];

        fullList.sort((a, b) => {
            const t1 = new Date(a.updated_at).getTime();
            const t2 = new Date(b.updated_at).getTime();
            if (isNaN(t1)) return 1;
            if (isNaN(t2)) return -1;
            return t2 - t1;
        });

        const data = fullList.slice(0, 10);

        data.forEach((item, index) => {
            const div = document.createElement('div');
            const label = this.getDisplayUserName(item);
            const hwid = item.hwid || item.hwid_hash || '-';
            const displayHwid = this.formatHwid(hwid);
            const os = item.os || '-';
            const arch = item.arch || '-';
            const version = item.version || item.app_version || item.client_version || '-';
            const minutes = item.minutes_ago ?? item.minutes ?? item.last_seen_minutes ?? '-';

            const isOnline = typeof minutes === 'number' && minutes <= 5;
            const statusClass = isOnline ? 'online' : 'offline';

            div.className = 'recent-item';
            div.innerHTML = `
                <div class="recent-avatar" style="background: ${isOnline ? 'var(--secondary)' : 'var(--muted)'};">${this.getAutoUserName(item).replace('user', 'U')}</div>
                <div class="recent-main">
                    <div class="recent-name">
                        <span class="status-dot ${statusClass}"></span>
                        <span style="color: var(--text-muted); font-size: 0.85em; font-weight: normal; margin-right: 4px;">#${item.id || '-'}</span>
                        ${label}
                    </div>
                    <div class="recent-meta">${os} · ${arch} · ${version}</div>
                    <div class="recent-meta">HWID: ${displayHwid}</div>
                </div>
                <div class="recent-time">${this.formatTimeAgo(minutes)}</div>
            `;
            div.addEventListener('click', () => {
                this.selectRecentUser(item, index);
            });
            container.appendChild(div);
        });

        const defaultUser = this.state.selectedUser || data[0];
        if (defaultUser) {
            const defaultHwid = defaultUser.hwid || defaultUser.hwid_hash || '-';
            const idx = data.findIndex(u => (u.hwid || u.hwid_hash || '-') === defaultHwid);
            this.selectRecentUser(defaultUser, idx >= 0 ? idx : 0);
        }
    },

    /**
     * 渲染用户详情（主页右侧）
     */
    renderUserDetail(user) {
        const grid = document.getElementById('userDetailGrid');
        if (!grid || !user) return;

        const osName = user.os || '-';
        const osVersion = user.os_version || user.osVersion || '-';
        const osBuild = user.os_build || user.osBuild || '-';
        const arch = user.arch || '-';
        const version = user.version || user.app_version || user.client_version || '-';
        const hwid = user.hwid || user.hwid_hash || '-';
        const displayHwid = this.formatHwid(hwid);
        const pythonVersion = user.python_version || user.python || '-';
        const locale = user.locale || user.region || '-';
        const lastSeen = user.updated_at || user.last_seen || user.last_seen_at || '-';
        const registerTime = this.getUserRegisterTime(user);
        const minutes = user.minutes_ago ?? user.minutes ?? user.last_seen_minutes ?? '-';
        const resolution = user.resolution || user.screen_resolution || user.screenResolution || '-';

        this.setText('userDetailSub', `${this.getAutoUserName(user)} · ${this.formatTimeAgo(minutes)}`);

        const items = [
            { label: 'HWID', value: displayHwid },
            { label: '软件版本', value: version },
            { label: '系统', value: osName },
            { label: '系统版本', value: osVersion },
            { label: '系统构建', value: osBuild },
            { label: '架构', value: arch },
            { label: '屏幕分辨率', value: resolution },
            { label: 'Python版本', value: pythonVersion },
            { label: '区域', value: locale },
            { label: '注册时间', value: registerTime },
            { label: '最近更新', value: lastSeen }
        ];

        const content = items.map(item => `
            <div class="detail-card">
                <div class="detail-label">${item.label}</div>
                <div class="detail-value">${item.value}</div>
            </div>
        `).join('');

        grid.classList.add('switching');
        requestAnimationFrame(() => {
            setTimeout(() => {
                grid.innerHTML = content;
                grid.classList.remove('switching');
            }, 140);
        });
    },

    /**
     * 选择用户
     */
    selectUser(hwid) {
        const list = this.state.latestUsersData || this.state.dashboardData?.recent_users || [];
        const user = list.find(u => (u.hwid || u.hwid_hash || '-') === hwid);
        if (user) {
            const index = list.indexOf(user);
            this.selectRecentUser(user, index);
        }
    },

    selectRecentUser(user, index) {
        this.state.selectedUser = user;
        const items = document.querySelectorAll('#recentUsersList .recent-item');
        items.forEach((item, idx) => {
            item.classList.toggle('active', idx === index);
        });
        this.renderUserDetail(user);
    },

    /**
     * 更新筛选器
     */
    updateFilters(data) {
        this.updateSelect('filterOS', data.os_options || data.os_stats || []);
        this.updateSelect('filterArch', data.arch_options || data.arch_stats || []);
        this.updateSelect('filterVersion', data.version_options || data.version_stats || []);
        this.updateSelect('filterLocale', data.locale_options || data.locale_stats || []);
    },

    updateSelect(id, list) {
        const select = document.getElementById(id);
        if (!select) return;
        const current = select.value;
        while (select.options.length > 1) select.remove(1);
        list.forEach(item => {
            const opt = document.createElement('option');
            opt.value = item.name;
            opt.textContent = `${item.name} (${item.value})`;
            select.appendChild(opt);
        });
        select.value = current;
    },

    /**
     * 检查告警
     */
    checkAlerts(data) {
        const alerts = [];
        if ((data.today_new_growth ?? 0) < -20) {
            alerts.push({ type: 'warning', text: '今日新增环比下降超过20%' });
        }
        if (data.total_users > 0 && data.online_users / data.total_users < 0.05) {
            alerts.push({ type: 'danger', text: '在线率低于5%' });
        }
        if ((data.dau_growth ?? 0) < -15) {
            alerts.push({ type: 'warning', text: '日活环比波动明显' });
        }
        this.renderAlerts(alerts);
    },

    renderAlerts(list) {
        const container = document.getElementById('alertContainer');
        if (!container) return;

        container.querySelectorAll('.alert[data-source="system"]').forEach(node => node.remove());

        list.forEach(item => {
            const div = document.createElement('div');
            div.className = `alert ${item.type} show`;
            div.dataset.source = 'system';
            div.textContent = item.text;
            container.appendChild(div);
        });
    },

    /**
     * 更新时间戳
     */
    updateTimestamp() {
        const now = new Date();
        this.setText('lastUpdate', `最近更新 ${now.toLocaleTimeString('zh-CN', { hour12: false })}`);
    },

    /**
     * 设置刷新状态
     */
    setRefreshing(isRefreshing) {
        const app = document.querySelector('.view-container.active .app') || document.querySelector('.app');
        if (app) app.classList.toggle('refreshing', isRefreshing);
        const refreshBtn = document.getElementById('refreshBtn');
        if (refreshBtn) refreshBtn.classList.toggle('loading', isRefreshing);
    },

    /**
     * 加载空状态（无数据时显示）
     */
    loadEmptyState() {
        this.setText('totalUsers', '0');
        this.setText('onlineUsers', '0');
        this.setText('todayNew', '0');
        this.setText('dauUsers', '0');
        this.setText('onlineRate', '在线率 -');

        ['totalUsersTrend', 'todayNewTrend', 'dauTrend'].forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                el.className = 'trend';
                el.textContent = '-';
            }
        });

        Object.values(this.state.charts).forEach(chart => {
            if (chart) chart.clear();
        });

        const recentUsersList = document.getElementById('recentUsersList');
        if (recentUsersList) {
            recentUsersList.innerHTML = `
                <div class="recent-item" style="padding: 40px; text-align: center; color: var(--text-muted);">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="margin-bottom: 8px; opacity: 0.5;">
                        <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                        <line x1="3" y1="9" x2="21" y2="9"></line>
                        <line x1="9" y1="21" x2="9" y2="9"></line>
                    </svg>
                    <p>暂无用户数据</p>
                    <p style="font-size: 12px; margin-top: 8px;">启动后端服务后将自动获取真实数据</p>
                </div>
            `;
        }

        this.showAlert('后端服务未连接，显示空状态', 'warning');
    },

    /**
     * 启动更新计时器
     */
    startUpdateTimer() {
        this.state.updateElapsedSeconds = 0;
        this.updateTimerDisplay();

        if (this.state.updateTimerInterval) {
            clearInterval(this.state.updateTimerInterval);
        }

        this.state.updateTimerInterval = setInterval(() => {
            this.state.updateElapsedSeconds++;
            if (this.state.updateElapsedSeconds >= this.config.updateInterval) {
                this.state.updateElapsedSeconds = 0;
            }
            this.updateTimerDisplay();
        }, 1000);
    },

    /**
     * 更新计时器显示
     */
    updateTimerDisplay() {
        const remaining = this.config.updateInterval - this.state.updateElapsedSeconds;
        const minutes = Math.floor(remaining / 60);
        const seconds = remaining % 60;
        const timeStr = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;

        const countdownEl = document.getElementById('updateCountdown');
        const progressBarEl = document.getElementById('updateProgressBar');

        if (countdownEl) countdownEl.textContent = timeStr;
        if (progressBarEl) {
            const percentage = (this.state.updateElapsedSeconds / this.config.updateInterval) * 100;
            progressBarEl.style.width = `${percentage}%`;
        }
    },

    /**
     * 显示提示
     */
    showAlert(text, type) {
        const container = document.getElementById('alertContainer');
        if (!container) return;

        const div = document.createElement('div');
        div.className = `alert ${type}`;
        div.dataset.source = 'toast';
        div.textContent = text;
        container.prepend(div);
        requestAnimationFrame(() => div.classList.add('show'));
        setTimeout(() => {
            div.classList.remove('show');
            setTimeout(() => div.remove(), 280);
        }, 2200);
    },

    /**
     * 应用筛选条件
     */
    applyFilters() {
        this.fetchData();
    },

    /**
     * 刷新数据
     */
    async refreshData() {
        await this.fetchData();
        this.startUpdateTimer();
        this.showAlert('数据已刷新', 'success');
    },

    /**
     * 处理控制操作
     */
    handleControl(action) {
        let title = '';
        let content = '';
        let submitAction = 'app.submitControl()';
        let submitText = '确认';

        if (action === 'maintenance') {
            title = '维护模式';
            content = `
                <div class="form-group">
                    <label>维护状态</label>
                    <select class="select" style="width: 100%;" id="maintenanceStatus" onchange="app.syncMaintenanceReject()">
                        <option value="off">关闭维护模式 (正常运行)</option>
                        <option value="on">开启维护模式 (仅白名单可用)</option>
                    </select>
                </div>
                <div class="form-group">
                    <label>维护公告</label>
                    <input class="input" style="width: 100%;" id="maintenanceNotice" value="服务器维护中，预计恢复时间：12:00">
                </div>
                <div class="form-group">
                    <label>拒绝新数据</label>
                    <div style="display: flex; align-items: center; gap: 10px;">
                        <button class="btn" id="maintenanceRejectBtn" onclick="app.toggleMaintenanceReject()">已关闭</button>
                        <div class="muted" id="maintenanceRejectHint">维护开启时可拒绝新数据</div>
                    </div>
                    <input type="hidden" id="maintenanceReject" value="off">
                </div>
            `;
        } else if (action === 'alert') {
            title = '发布紧急通知 (弹窗)';
            content = `
                <div class="form-group">
                    <label>状态</label>
                    <select class="select" style="width: 100%;" id="alertStatus">
                        <option value="on">激活 (推送弹窗)</option>
                        <option value="off">禁用 (停止推送)</option>
                    </select>
                </div>
                <div class="form-group">
                    <label>通知标题</label>
                    <input class="input" style="width: 100%;" id="alertTitle" placeholder="例如: 停机维护通知">
                </div>
                <div class="form-group">
                    <label>详细内容</label>
                    <textarea class="input" style="width: 100%; height: 100px; font-family: inherit; padding: 10px;" id="alertContent" placeholder="此处内容将以模态框形式展现..."></textarea>
                </div>
                <div class="form-group">
                    <label>推送范围</label>
                    <input class="input" style="width: 100%;" id="alertScope" value="all" placeholder="例如: 2.0.1 或 all">
                </div>
            `;
        } else if (action === 'notice') {
            title = '覆盖公告栏文字';
            content = `
                <div class="form-group">
                    <label>状态</label>
                    <select class="select" style="width: 100%;" id="noticeStatus">
                        <option value="on">激活 (文字覆盖)</option>
                        <option value="off">禁用 (恢复默认)</option>
                    </select>
                </div>
                <div class="form-group">
                    <label>公告栏文字</label>
                    <textarea class="input" style="width: 100%; height: 100px; font-family: inherit; padding: 10px;" id="noticeContent" placeholder="在此输入公告内容（支持 HTML 标签，例如 <strong>加粗</strong>）..."></textarea>
                </div>
                <div class="form-group">
                    <label>覆盖范围</label>
                    <input class="input" style="width: 100%;" id="noticeScope" value="all" placeholder="例如: 2.0.1 或 all">
                </div>
            `;
        } else if (action === 'update') {
            title = '更新提示';
            content = `
                <div class="form-group">
                    <label>状态</label>
                    <select class="select" style="width: 100%;" id="updateStatus">
                        <option value="on">激活 (推送更新提示)</option>
                        <option value="off">禁用 (停止推送)</option>
                    </select>
                </div>
                <div class="form-group">
                    <label>推送范围 (输入版本号或 'all')</label>
                    <input class="input" style="width: 100%;" id="updateScope" value="all" placeholder="例如: 2.0.1 或 all">
                </div>
                <div class="form-group">
                    <label>推送内容</label>
                    <textarea class="input" style="width: 100%; height: 80px; font-family: inherit; padding: 10px;" id="updateContent" placeholder="请输入版本更新说明..."></textarea>
                </div>
                <div class="form-group">
                    <label>下载地址</label>
                    <input class="input" style="width: 100%;" id="updateUrl" placeholder="请输入下载短链或网盘链接">
                </div>
            `;
        } else if (action === 'test') {
            title = 'JSON 测试接口';
            submitText = '加载测试数据';
            submitAction = 'app.loadTestDataFromJson()';
            content = `
                <div class="form-group">
                    <label>接口标识</label>
                    <input class="input" style="width: 100%;" value="test.json" readonly>
                </div>
                <div class="form-group">
                    <label>用途说明</label>
                    <textarea class="input" style="width: 100%; height: 80px; font-family: inherit; padding: 10px;" readonly>仅用于前端联调与数据结构校验</textarea>
                </div>
            `;
        } else if (action === 'export') {
            title = '导出数据';
            submitText = '确认导出';
            submitAction = 'app.exportDataFromModal()';
            content = `
                <div class="form-group">
                    <label>日期范围</label>
                    <div style="display: flex; align-items: center; gap: 10px;">
                        <input class="input" type="date" id="exportStartDate">
                        <span class="muted">至</span>
                        <input class="input" type="date" id="exportEndDate">
                    </div>
                </div>
                <div class="form-group">
                    <label>文件格式</label>
                    <select class="select" style="width: 100%;" id="exportFormat">
                        <option value="csv">CSV</option>
                        <option value="excel">Excel</option>
                    </select>
                </div>
            `;
            // 设置默认日期
            setTimeout(() => {
                const end = new Date();
                const start = new Date();
                start.setDate(start.getDate() - 30);
                const startEl = document.getElementById('exportStartDate');
                const endEl = document.getElementById('exportEndDate');
                if (startEl) startEl.value = start.toISOString().split('T')[0];
                if (endEl) endEl.value = end.toISOString().split('T')[0];
            }, 50);
        }

        document.getElementById('controlModalTitle').textContent = title;
        document.getElementById('controlModalBody').innerHTML = content;
        document.getElementById('controlModal').dataset.action = action;

        const submitBtn = document.getElementById('controlModalSubmit');
        submitBtn.textContent = submitText;
        submitBtn.setAttribute('onclick', submitAction);

        document.getElementById('controlModalMask').classList.add('show');
        document.getElementById('controlModal').classList.add('show');

        if (action === 'maintenance') {
            this.syncMaintenanceReject();
        }
    },

    /**
     * 同步维护拒绝状态
     */
    syncMaintenanceReject() {
        const status = document.getElementById('maintenanceStatus')?.value;
        const btn = document.getElementById('maintenanceRejectBtn');
        const hint = document.getElementById('maintenanceRejectHint');
        const hidden = document.getElementById('maintenanceReject');
        if (!btn || !hidden) return;
        const enabled = status === 'on';
        btn.disabled = !enabled;
        if (!enabled) {
            hidden.value = 'off';
            btn.textContent = '已关闭';
            btn.classList.remove('primary');
        }
        if (hint) {
            hint.textContent = enabled ? '开启后服务器拒绝接收新数据' : '维护开启时可拒绝新数据';
        }
    },

    /**
     * 切换维护拒绝状态
     */
    toggleMaintenanceReject() {
        const btn = document.getElementById('maintenanceRejectBtn');
        const hidden = document.getElementById('maintenanceReject');
        if (!btn || !hidden || btn.disabled) return;
        const next = hidden.value === 'on' ? 'off' : 'on';
        hidden.value = next;
        btn.textContent = next === 'on' ? '已开启' : '已关闭';
        btn.classList.toggle('primary', next === 'on');
    },

    /**
     * 从弹窗导出数据
     */
    async exportDataFromModal() {
        const start = document.getElementById('exportStartDate')?.value;
        const end = document.getElementById('exportEndDate')?.value;
        const format = document.getElementById('exportFormat')?.value || 'csv';

        if (!start || !end) {
            this.showAlert('请选择导出日期范围', 'warning');
            return;
        }

        const params = new URLSearchParams({
            format,
            start_date: start,
            end_date: end
        });

        try {
            const res = await fetch(`${this.config.apiBase}/admin/export?${params}`);
            if (!res.ok) throw new Error('导出失败');
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `telemetry_${start}_${end}.${format}`;
            document.body.appendChild(a);
            a.click();
            URL.revokeObjectURL(url);
            document.body.removeChild(a);
            this.closeControlModal();
            this.showAlert('导出完成', 'success');
        } catch (error) {
            this.showAlert('导出失败: ' + error.message, 'danger');
        }
    },

    /**
     * 加载测试数据
     */
    loadTestDataFromJson() {
        this.closeControlModal();
        this.showAlert('测试数据已加载', 'success');
    },

    /**
     * 导出数据
     */
    async exportData() {
        const start = document.getElementById('compareStart')?.value;
        const end = document.getElementById('compareEnd')?.value;
        const format = 'csv';

        if (!start || !end) {
            this.showAlert('请选择导出日期范围', 'warning');
            return;
        }

        const params = new URLSearchParams({
            format,
            start_date: start,
            end_date: end
        });

        try {
            const res = await fetch(`${this.config.apiBase}/admin/export?${params}`);
            if (!res.ok) throw new Error('export failed');
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `telemetry_${start}_${end}.${format}`;
            document.body.appendChild(a);
            a.click();
            URL.revokeObjectURL(url);
            document.body.removeChild(a);
            this.showAlert('导出完成', 'success');
        } catch (error) {
            this.showAlert('导出失败: ' + error.message, 'danger');
        }
    },

    /**
     * 关闭控制模态框
     */
    closeControlModal() {
        document.getElementById('controlModalMask')?.classList.remove('show');
        document.getElementById('controlModal')?.classList.remove('show');
    },

    /**
     * 提交控制
     */
    async submitControl() {
        const action = document.getElementById('controlModal').dataset.action;

        // 本地功能直接处理
        if (action === 'test') {
            this.loadTestDataFromJson();
            return;
        }
        if (action === 'export') {
            this.exportDataFromModal();
            return;
        }

        // 构建请求载荷
        const payload = { action };
        if (action === 'maintenance') {
            payload.maintenance = document.getElementById('maintenanceStatus').value === 'on';
            payload.maintenance_msg = document.getElementById('maintenanceNotice').value;
            payload.stop_new_data = document.getElementById('maintenanceReject').value === 'on';
        } else if (action === 'alert') {
            payload.alert_active = document.getElementById('alertStatus').value === 'on';
            payload.title = document.getElementById('alertTitle').value;
            payload.content = document.getElementById('alertContent').value;
            payload.scope = document.getElementById('alertScope').value;
        } else if (action === 'notice') {
            payload.notice_active = document.getElementById('noticeStatus').value === 'on';
            payload.content = document.getElementById('noticeContent').value;
            payload.scope = document.getElementById('noticeScope').value;
        } else if (action === 'update') {
            payload.update_active = document.getElementById('updateStatus').value === 'on';
            payload.content = document.getElementById('updateContent').value;
            payload.url = document.getElementById('updateUrl').value;
            payload.scope = document.getElementById('updateScope').value;
        }

        const btn = document.getElementById('controlModalSubmit');
        const originalText = btn.textContent;
        btn.textContent = '提交中...';
        btn.disabled = true;

        try {
            const res = await fetch(`${this.config.apiBase}/admin/control`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (!res.ok) throw new Error('操作失败，服务器返回 ' + res.status);

            await res.json();
            this.closeControlModal();
            this.showAlert('指令已下发成功', 'success');
        } catch (error) {
            console.error(error);
            this.showAlert(error.message, 'danger');
        } finally {
            btn.textContent = originalText;
            btn.disabled = false;
        }
    },

    /**
     * 关闭抽屉
     */
    closeDrawer() {
        document.getElementById('drawerMask')?.classList.remove('show');
        document.getElementById('drilldownDrawer')?.classList.remove('show');
    },

    /**
     * 初始化控制视图
     */
    initControl() {
        // 控制视图特定初始化
    },

    /**
     * 初始化公告栏管理视图，加载各通道的激活状态
     */
    initAnnouncement() {
        this.loadAnnouncementStatus();
        this.loadNoticeList();
    },

    /**
     * 加载各推送通道当前状态并更新通道状态面板
     */
    async loadAnnouncementStatus() {
        const setChannel = (name, active) => {
            const dot = document.getElementById(`channelDot${name}`);
            const badge = document.getElementById(`channelBadge${name}`);
            if (dot) {
                dot.style.background = active ? 'var(--secondary)' : 'var(--muted)';
            }
            if (badge) {
                badge.textContent = active ? '已激活' : '未激活';
                badge.style.background = active
                    ? 'rgba(16, 185, 129, 0.12)'
                    : 'rgba(148, 163, 184, 0.15)';
                badge.style.color = active ? 'var(--secondary)' : 'var(--text-muted)';
            }
        };

        try {
            const res = await fetch(`${this.config.apiBase}/admin/control`);
            if (res.ok) {
                const data = await res.json();
                const cfg = data.config || {};
                setChannel('Notice', !!cfg.notice_active);
                setChannel('Alert', !!cfg.alert_active);
                setChannel('Update', !!cfg.update_active);
                this.setVal('announcementNoticeStatus', cfg.notice_active ? 'on' : 'off');
                this.setVal('announcementAlertStatus', cfg.alert_active ? 'on' : 'off');
                this.setVal('announcementUpdateStatus', cfg.update_active ? 'on' : 'off');
            } else {
                setChannel('Notice', false);
                setChannel('Alert', false);
                setChannel('Update', false);
            }
        } catch {
            setChannel('Notice', false);
            setChannel('Alert', false);
            setChannel('Update', false);
        }
    },

    /**
     * 从公告栏管理页面提交推送指令，复用 /admin/control API
     */
    async submitAnnouncement(type) {
        const payload = { action: type };

        if (type === 'notice') {
            payload.notice_active = document.getElementById('announcementNoticeStatus')?.value === 'on';
            payload.content = document.getElementById('announcementNoticeContent')?.value || '';
            payload.scope = document.getElementById('announcementNoticeScope')?.value || 'all';
        } else if (type === 'alert') {
            payload.alert_active = document.getElementById('announcementAlertStatus')?.value === 'on';
            payload.title = document.getElementById('announcementAlertTitle')?.value || '';
            payload.content = document.getElementById('announcementAlertContent')?.value || '';
            payload.scope = document.getElementById('announcementAlertScope')?.value || 'all';
        } else if (type === 'update') {
            payload.update_active = document.getElementById('announcementUpdateStatus')?.value === 'on';
            payload.content = document.getElementById('announcementUpdateContent')?.value || '';
            payload.url = document.getElementById('announcementUpdateUrl')?.value || '';
            payload.scope = document.getElementById('announcementUpdateScope')?.value || 'all';
        }

        try {
            const res = await fetch(`${this.config.apiBase}/admin/control`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            if (!res.ok) throw new Error('服务器返回 ' + res.status);
            await res.json();
            this.showAlert('指令已下发成功', 'success');
            this.loadAnnouncementStatus();
        } catch (error) {
            this.showAlert('推送失败: ' + error.message, 'danger');
        }
    },

    // ==================== 公告列表管理 ====================

    _noticeItems: [],
    _noticeEditingId: null,

    async loadNoticeList() {
        try {
            const res = await fetch(`${this.config.apiBase}/admin/notices`);
            if (!res.ok) throw new Error('load failed');
            const data = await res.json();
            this._noticeItems = data.items || [];
            this.renderNoticeList();
            this.cancelNoticeEdit();
        } catch {
            this._noticeItems = [];
            this.renderNoticeList();
        }
    },

    renderNoticeList() {
        const container = document.getElementById('noticeItemList');
        if (!container) return;
        if (!this._noticeItems.length) {
            container.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:40px;"><p>\u6682\u65e0\u516c\u544a\u6570\u636e</p><p style="font-size:12px;">\u70b9\u51fb\u201c\u65b0\u5efa\u516c\u544a\u201d\u5f00\u59cb\u6dfb\u52a0</p></div>';
            return;
        }
        const typeColors = { urgent: 'var(--danger)', update: 'var(--primary)', event: 'rgb(124,58,237)', normal: 'var(--text-muted)' };
        container.innerHTML = this._noticeItems.map(item => {
            const color = typeColors[item.type] || 'var(--text-muted)';
            const pinIcon = item.is_pinned ? '<span style="color:var(--warning);font-size:11px;margin-left:4px;" title="\u7f6e\u9876">\u2b50</span>' : '';
            return `<div style="border-bottom:1px solid var(--border);padding:12px 20px;display:flex;align-items:center;gap:12px;cursor:pointer;transition:background 0.15s;" onmouseover="this.style.background='rgba(0,0,0,0.02)'" onmouseout="this.style.background=''" onclick="app.editNoticeItem(${item.id})">
                <span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:${color};flex-shrink:0;"></span>
                <span style="font-size:11px;padding:1px 8px;border-radius:4px;background:rgba(0,0,0,0.04);color:${color};flex-shrink:0;">${this.escapeHtmlSafe(item.tag || item.type)}</span>
                <div style="flex:1;min-width:0;">
                    <div style="font-size:13px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${this.escapeHtmlSafe(item.title)}${pinIcon}</div>
                    <div style="font-size:11px;color:var(--text-muted);">${this.escapeHtmlSafe(item.date || '')}</div>
                </div>
                <button class="btn" style="padding:4px 8px;font-size:11px;color:var(--danger);flex-shrink:0;" onclick="event.stopPropagation();app.deleteNoticeItem(${item.id})">\u5220\u9664</button>
            </div>`;
        }).join('');
    },

    addNoticeItem() {
        this._noticeEditingId = null;
        const titleEl = document.getElementById('noticeEditTitle');
        if (titleEl) titleEl.textContent = '\u65b0\u5efa\u516c\u544a';
        const emptyEl = document.getElementById('noticeEditEmpty');
        const formEl = document.getElementById('noticeEditForm');
        if (emptyEl) emptyEl.style.display = 'none';
        if (formEl) formEl.style.display = '';
        this.setVal('noticeEditType', 'normal');
        this.setVal('noticeEditTag', '');
        this.setVal('noticeEditItemTitle', '');
        this.setVal('noticeEditDate', new Date().toLocaleDateString('zh-CN'));
        this.setVal('noticeEditSummary', '');
        this.setVal('noticeEditContent', '');
        const pinnedEl = document.getElementById('noticeEditPinned');
        if (pinnedEl) pinnedEl.checked = false;
    },

    editNoticeItem(id) {
        const item = this._noticeItems.find(x => x.id === id);
        if (!item) return;
        this._noticeEditingId = id;
        const titleEl = document.getElementById('noticeEditTitle');
        if (titleEl) titleEl.textContent = '\u7f16\u8f91: ' + (item.title || '');
        const emptyEl = document.getElementById('noticeEditEmpty');
        const formEl = document.getElementById('noticeEditForm');
        if (emptyEl) emptyEl.style.display = 'none';
        if (formEl) formEl.style.display = '';
        this.setVal('noticeEditType', item.type || 'normal');
        this.setVal('noticeEditTag', item.tag || '');
        this.setVal('noticeEditItemTitle', item.title || '');
        this.setVal('noticeEditDate', item.date || '');
        this.setVal('noticeEditSummary', item.summary || '');
        this.setVal('noticeEditContent', item.content || '');
        const pinnedEl = document.getElementById('noticeEditPinned');
        if (pinnedEl) pinnedEl.checked = !!item.is_pinned;
    },

    cancelNoticeEdit() {
        this._noticeEditingId = null;
        const titleEl = document.getElementById('noticeEditTitle');
        if (titleEl) titleEl.textContent = '\u9009\u62e9\u6216\u65b0\u5efa\u516c\u544a';
        const emptyEl = document.getElementById('noticeEditEmpty');
        const formEl = document.getElementById('noticeEditForm');
        if (emptyEl) emptyEl.style.display = '';
        if (formEl) formEl.style.display = 'none';
    },

    async saveNoticeItem() {
        const payload = {
            type: document.getElementById('noticeEditType')?.value || 'normal',
            tag: (document.getElementById('noticeEditTag')?.value || '').trim(),
            title: (document.getElementById('noticeEditItemTitle')?.value || '').trim(),
            date: (document.getElementById('noticeEditDate')?.value || '').trim(),
            summary: (document.getElementById('noticeEditSummary')?.value || '').trim(),
            content: (document.getElementById('noticeEditContent')?.value || '').trim(),
            is_pinned: !!document.getElementById('noticeEditPinned')?.checked
        };
        if (!payload.title) { this.showAlert('\u8bf7\u586b\u5199\u516c\u544a\u6807\u9898', 'warning'); return; }
        if (!payload.tag) {
            const tagMap = { update: '\u66f4\u65b0', urgent: '\u7d27\u6025', event: '\u6d3b\u52a8', normal: '\u65e5\u5e38' };
            payload.tag = tagMap[payload.type] || '\u65e5\u5e38';
        }
        try {
            const isEdit = this._noticeEditingId !== null;
            const url = isEdit
                ? `${this.config.apiBase}/admin/notices/${this._noticeEditingId}`
                : `${this.config.apiBase}/admin/notices`;
            const method = isEdit ? 'PUT' : 'POST';
            const res = await fetch(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            if (!res.ok) throw new Error('\u670d\u52a1\u5668\u8fd4\u56de ' + res.status);
            await res.json();
            this.showAlert(isEdit ? '\u516c\u544a\u5df2\u66f4\u65b0' : '\u516c\u544a\u5df2\u521b\u5efa', 'success');
            this.loadNoticeList();
        } catch (error) {
            this.showAlert('\u4fdd\u5b58\u5931\u8d25: ' + error.message, 'danger');
        }
    },

    async deleteNoticeItem(id) {
        try {
            const res = await fetch(`${this.config.apiBase}/admin/notices/${id}`, { method: 'DELETE' });
            if (!res.ok) throw new Error('\u670d\u52a1\u5668\u8fd4\u56de ' + res.status);
            this.showAlert('\u516c\u544a\u5df2\u5220\u9664', 'success');
            this.loadNoticeList();
        } catch (error) {
            this.showAlert('\u5220\u9664\u5931\u8d25: ' + error.message, 'danger');
        }
    },

    // ==================== 广告轮播管理 ====================

    _adItems: [],
    _adEditingIndex: -1,

    initAdvertisement() {
        this._adItems = [];
        this._adEditingIndex = -1;
        this.loadAdCarousel();
    },

    async loadAdCarousel() {
        try {
            const res = await fetch(`${this.config.apiBase}/admin/ad-carousel`);
            if (!res.ok) throw new Error('load failed');
            const data = await res.json();
            this._adItems = data.items || [];
            const intervalEl = document.getElementById('adIntervalMs');
            if (intervalEl && data.interval_ms) intervalEl.value = data.interval_ms;
            this.renderAdList();
            this.cancelAdEdit();
        } catch {
            this._adItems = [];
            this.renderAdList();
        }
    },

    renderAdList() {
        const container = document.getElementById('adCarouselList');
        if (!container) return;
        if (!this._adItems.length) {
            container.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:40px;"><p>\u6682\u65e0\u5e7f\u544a\u6570\u636e</p><p style="font-size:12px;">\u70b9\u51fb\u53f3\u4e0a\u89d2\u201c\u6dfb\u52a0\u5e7f\u544a\u201d\u5f00\u59cb\u914d\u7f6e</p></div>';
            return;
        }
        container.innerHTML = this._adItems.map((item, i) => {
            const isFirst = i === 0;
            const isLast = i === this._adItems.length - 1;
            return `<div style="border-bottom:1px solid var(--border);padding:14px 20px;display:flex;align-items:center;gap:14px;cursor:pointer;transition:background 0.15s;" onmouseover="this.style.background='rgba(0,0,0,0.02)'" onmouseout="this.style.background=''" onclick="app.editAdItem(${i})">
                <div style="width:64px;height:40px;border-radius:6px;overflow:hidden;flex-shrink:0;background:var(--border);display:flex;align-items:center;justify-content:center;">
                    <img src="" alt="" style="width:100%;height:100%;object-fit:cover;display:none;">
                    <span style="font-size:10px;color:var(--text-muted)">#${i + 1}</span>
                </div>
                <div style="flex:1;min-width:0;">
                    <div style="font-size:13px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${this.escapeHtmlSafe(item.id || '\u672a\u547d\u540d')}</div>
                    <div style="font-size:11px;color:var(--text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${this.escapeHtmlSafe(item.url || '-')}</div>
                </div>
                <div style="display:flex;gap:6px;flex-shrink:0;">
                    <button class="btn" style="padding:4px 8px;font-size:11px;" onclick="event.stopPropagation();app.moveAdItem(${i},-1)" ${isFirst ? 'disabled' : ''}>\u2191</button>
                    <button class="btn" style="padding:4px 8px;font-size:11px;" onclick="event.stopPropagation();app.moveAdItem(${i},1)" ${isLast ? 'disabled' : ''}>\u2193</button>
                    <button class="btn" style="padding:4px 8px;font-size:11px;color:var(--danger);" onclick="event.stopPropagation();app.deleteAdItem(${i})">\u5220\u9664</button>
                </div>
            </div>`;
        }).join('');
    },

    escapeHtmlSafe(str) {
        const div = document.createElement('div');
        div.textContent = str || '';
        return div.innerHTML;
    },

    addAdItem() {
        this._adEditingIndex = -1;
        const titleEl = document.getElementById('adEditTitle');
        if (titleEl) titleEl.textContent = '\u6dfb\u52a0\u5e7f\u544a';
        const emptyEl = document.getElementById('adEditEmpty');
        const formEl = document.getElementById('adEditForm');
        if (emptyEl) emptyEl.style.display = 'none';
        if (formEl) formEl.style.display = '';
        this.setVal('adEditId', 'ad_' + Date.now());
        this.setVal('adEditImage', '');
        this.setVal('adEditAlt', '');
        this.setVal('adEditUrl', '');
    },

    editAdItem(index) {
        const item = this._adItems[index];
        if (!item) return;
        this._adEditingIndex = index;
        const titleEl = document.getElementById('adEditTitle');
        if (titleEl) titleEl.textContent = '\u7f16\u8f91: ' + (item.id || '');
        const emptyEl = document.getElementById('adEditEmpty');
        const formEl = document.getElementById('adEditForm');
        if (emptyEl) emptyEl.style.display = 'none';
        if (formEl) formEl.style.display = '';
        this.setVal('adEditId', item.id || '');
        this.setVal('adEditImage', item.image || '');
        this.setVal('adEditAlt', item.alt || '');
        this.setVal('adEditUrl', item.url || '');
    },

    cancelAdEdit() {
        this._adEditingIndex = -1;
        const titleEl = document.getElementById('adEditTitle');
        if (titleEl) titleEl.textContent = '\u9009\u62e9\u6216\u6dfb\u52a0\u5e7f\u544a';
        const emptyEl = document.getElementById('adEditEmpty');
        const formEl = document.getElementById('adEditForm');
        if (emptyEl) emptyEl.style.display = '';
        if (formEl) formEl.style.display = 'none';
    },

    setVal(id, val) {
        const el = document.getElementById(id);
        if (el) el.value = val;
    },

    saveAdItem() {
        const item = {
            id: (document.getElementById('adEditId')?.value || '').trim(),
            image: (document.getElementById('adEditImage')?.value || '').trim(),
            alt: (document.getElementById('adEditAlt')?.value || '').trim(),
            url: (document.getElementById('adEditUrl')?.value || '').trim()
        };
        if (!item.id) { this.showAlert('\u8bf7\u586b\u5199\u5e7f\u544a ID', 'warning'); return; }
        if (this._adEditingIndex >= 0) {
            this._adItems[this._adEditingIndex] = item;
        } else {
            this._adItems.push(item);
        }
        this.renderAdList();
        this.cancelAdEdit();
        this.showAlert('\u5df2\u66f4\u65b0\u672c\u5730\u5217\u8868\uff0c\u70b9\u51fb\u201c\u4fdd\u5b58\u5168\u90e8\u914d\u7f6e\u201d\u63d0\u4ea4\u5230\u670d\u52a1\u5668', 'success');
    },

    deleteAdItem(index) {
        this._adItems.splice(index, 1);
        this.renderAdList();
        if (this._adEditingIndex === index) this.cancelAdEdit();
        this.showAlert('\u5df2\u5220\u9664\uff0c\u70b9\u51fb\u201c\u4fdd\u5b58\u5168\u90e8\u914d\u7f6e\u201d\u63d0\u4ea4\u5230\u670d\u52a1\u5668', 'success');
    },

    moveAdItem(index, direction) {
        const newIndex = index + direction;
        if (newIndex < 0 || newIndex >= this._adItems.length) return;
        const temp = this._adItems[index];
        this._adItems[index] = this._adItems[newIndex];
        this._adItems[newIndex] = temp;
        this.renderAdList();
    },

    async saveAdCarouselAll() {
        const intervalMs = parseInt(document.getElementById('adIntervalMs')?.value) || 4500;
        const payload = { items: this._adItems, interval_ms: intervalMs };
        try {
            const res = await fetch(`${this.config.apiBase}/admin/ad-carousel`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            if (!res.ok) throw new Error('\u670d\u52a1\u5668\u8fd4\u56de ' + res.status);
            await res.json();
            this.showAlert('\u5e7f\u544a\u914d\u7f6e\u5df2\u4fdd\u5b58\u5230\u670d\u52a1\u5668', 'success');
        } catch (error) {
            this.showAlert('\u4fdd\u5b58\u5931\u8d25: ' + error.message, 'danger');
        }
    },

    /**
     * 初始化设置视图
     */
    initSettings() {
        // 从 localStorage 加载设置
        const settings = this.loadSettings();

        // 应用设置到表单
        const themeEl = document.getElementById('settingTheme');
        const layoutEl = document.getElementById('settingLayout');
        const animationEl = document.getElementById('settingAnimation');
        const refreshEl = document.getElementById('settingRefreshInterval');
        const timeRangeEl = document.getElementById('settingTimeRange');
        const desktopNotifyEl = document.getElementById('settingDesktopNotify');
        const soundEl = document.getElementById('settingSound');
        const exportFormatEl = document.getElementById('settingExportFormat');
        const dataRetentionEl = document.getElementById('settingDataRetention');
        const debugModeEl = document.getElementById('settingDebugMode');

        if (themeEl) themeEl.value = settings.theme || 'light';
        if (layoutEl) layoutEl.value = settings.layout || 'comfortable';
        if (animationEl) animationEl.checked = settings.animation !== false;
        if (refreshEl) refreshEl.value = settings.refreshInterval || '60';
        if (timeRangeEl) timeRangeEl.value = settings.timeRange || '30';
        if (desktopNotifyEl) desktopNotifyEl.checked = settings.desktopNotify !== false;
        if (soundEl) soundEl.checked = settings.sound !== false;
        if (exportFormatEl) exportFormatEl.value = settings.exportFormat || 'csv';
        if (dataRetentionEl) dataRetentionEl.value = settings.dataRetention || '30';
        if (debugModeEl) debugModeEl.checked = settings.debugMode === true;
    },

    /**
     * 加载设置
     */
    loadSettings() {
        try {
            const saved = localStorage.getItem('dashboard_settings');
            return saved ? JSON.parse(saved) : {};
        } catch (e) {
            return {};
        }
    },

    /**
     * 保存设置
     */
    saveSettings() {
        const settings = {
            theme: document.getElementById('settingTheme')?.value || 'light',
            layout: document.getElementById('settingLayout')?.value || 'comfortable',
            animation: document.getElementById('settingAnimation')?.checked ?? true,
            refreshInterval: document.getElementById('settingRefreshInterval')?.value || '60',
            timeRange: document.getElementById('settingTimeRange')?.value || '30',
            desktopNotify: document.getElementById('settingDesktopNotify')?.checked ?? true,
            sound: document.getElementById('settingSound')?.checked ?? true,
            exportFormat: document.getElementById('settingExportFormat')?.value || 'csv',
            dataRetention: document.getElementById('settingDataRetention')?.value || '30',
            debugMode: document.getElementById('settingDebugMode')?.checked ?? false
        };

        try {
            localStorage.setItem('dashboard_settings', JSON.stringify(settings));
            this.showAlert('设置已保存', 'success');

            // 应用设置
            this.applySettings(settings);
        } catch (e) {
            this.showAlert('保存设置失败', 'danger');
        }
    },

    /**
     * 应用设置
     */
    applySettings(settings) {
        // 应用主题
        if (settings.theme === 'dark') {
            document.body.classList.add('dark-theme');
        } else if (settings.theme === 'light') {
            document.body.classList.remove('dark-theme');
        }

        // 应用刷新间隔
        if (this.updateTimer) {
            clearInterval(this.updateTimer);
        }
        const interval = parseInt(settings.refreshInterval) * 1000;
        if (interval > 0) {
            this.updateTimer = setInterval(() => this.fetchData(), interval);
        }
    },

    /**
     * 初始化用户列表视图
     */
    initUserList() {
        const users = this.state.dashboardData?.recent_users || this.state.latestUsersData;
        // 保存原始数据用于排序
        this.state.userListData = users && users.length > 0 ? [...users] : [];
        // 应用当前排序
        if (this.state.userListSort) {
            this.applyUserListSort();
        } else {
            this.renderUserList(this.state.userListData);
        }
    },

    /**
     * 用户列表排序
     */
    sortUserList(column) {
        const currentSort = this.state.userListSort;
        let newOrder = 'asc';

        // 如果点击同一列，切换排序方向
        if (currentSort && currentSort.column === column) {
            newOrder = currentSort.order === 'asc' ? 'desc' : 'asc';
        }

        this.state.userListSort = { column, order: newOrder };
        this.applyUserListSort();
        this.updateSortIcons(column, newOrder);
    },

    /**
     * 应用用户列表排序
     */
    applyUserListSort() {
        if (!this.state.userListData || !this.state.userListSort) return;

        const { column, order } = this.state.userListSort;
        const sorted = [...this.state.userListData];

        sorted.sort((a, b) => {
            let valA, valB;

            switch (column) {
                case 'id':
                    valA = a.id || 0;
                    valB = b.id || 0;
                    break;
                case 'version':
                    valA = a.version || a.app_version || a.client_version || '';
                    valB = b.version || b.app_version || b.client_version || '';
                    break;
                case 'os':
                    valA = a.os || '';
                    valB = b.os || '';
                    break;
                case 'locale':
                    valA = a.locale || '';
                    valB = b.locale || '';
                    break;
                case 'minutes':
                    valA = a.minutes_ago ?? a.minutes ?? a.last_seen_minutes ?? Infinity;
                    valB = b.minutes_ago ?? b.minutes ?? b.last_seen_minutes ?? Infinity;
                    break;
                case 'status':
                    const minA = a.minutes_ago ?? a.minutes ?? a.last_seen_minutes ?? Infinity;
                    const minB = b.minutes_ago ?? b.minutes ?? b.last_seen_minutes ?? Infinity;
                    valA = typeof minA === 'number' && minA <= 5 ? 1 : 0;
                    valB = typeof minB === 'number' && minB <= 5 ? 1 : 0;
                    break;
                default:
                    return 0;
            }

            // 字符串比较
            if (typeof valA === 'string' && typeof valB === 'string') {
                return order === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
            }

            // 数字比较
            if (order === 'asc') {
                return valA - valB;
            } else {
                return valB - valA;
            }
        });

        this.renderUserList(sorted);
    },

    /**
     * 更新排序图标
     */
    updateSortIcons(activeColumn, order) {
        document.querySelectorAll('#userListTable th.sortable').forEach(th => {
            th.removeAttribute('data-sort-order');
            if (th.dataset.sort === activeColumn) {
                th.setAttribute('data-sort-order', order);
            }
        });
    },

    /**
     * 渲染用户列表
     */
    renderUserList(users) {
        const tbody = document.getElementById('fullUserListBody');
        if (!tbody) return;

        const fullList = users && users.length ? [...users] : [];

        fullList.sort((a, b) => {
            const t1 = new Date(a.updated_at).getTime();
            const t2 = new Date(b.updated_at).getTime();
            if (isNaN(t1)) return 1;
            if (isNaN(t2)) return -1;
            return t2 - t1;
        });

        const localeMap = {
            'zh-CN': '中国',
            'zh-TW': '中国台湾',
            'zh-HK': '中国香港',
            'en-US': '美国',
            'en-GB': '英国',
            'ja-JP': '日本',
            'ko-KR': '韩国',
            'ru-RU': '俄罗斯',
            'de-DE': '德国',
            'fr-FR': '法国'
        };

        tbody.innerHTML = fullList.map(user => {
            const hwid = user.hwid || user.hwid_hash || '-';
            const displayHwid = this.formatHwid(hwid);
            const minutes = user.minutes_ago ?? user.minutes ?? user.last_seen_minutes ?? '-';
            const isOnline = typeof minutes === 'number' && minutes <= 5;
            const statusClass = isOnline ? 'online' : 'offline';
            const statusText = isOnline ? '在线' : '离线';
            const localeCode = user.locale || '-';
            const localeDisplay = localeMap[localeCode] || localeCode;
            const isMarked = this.state.markedUsers.has(hwid);
            const nameStyle = isMarked ? 'color: #f59e0b; font-weight: bold;' : '';

            const isAdmin = this.state.adminUsers.has(hwid);
            const avatarBgStyle = isAdmin
                ? 'background: linear-gradient(135deg, #60a5fa, #2563eb);'
                : 'background: linear-gradient(135deg, #4a4a4a, #1a1a1a);';

            const originalName = this.getAutoUserName(user);
            const alias = this.normalizeUserName(user.alias);
            let nameHtml = this.getDisplayUserName(user);
            if (alias && alias !== originalName) {
                nameHtml = `${alias} <span style="color: var(--text-muted); font-weight: normal; font-size: 0.9em;">(${originalName})</span>`;
            }

            const userData = encodeURIComponent(JSON.stringify(user));

            return `
            <tr style="cursor: pointer;" onclick="app.openUserDetailByData('${userData}')">
                <td>
                    <div style="display: flex; align-items: center; ${nameStyle}">
                        <div class="recent-avatar" style="width: 32px; height: 32px; font-size: 11px; margin-right: 8px; flex-shrink: 0; ${avatarBgStyle}">#${user.id || '-'}</div>
                        <span>${nameHtml}</span>
                    </div>
                </td>
                <td class="hwid-cell" style="font-family: monospace; font-size: 12px;" data-hwid="${hwid}">${displayHwid}</td>
                <td><span style="color: var(--secondary);">正常</span></td>
                <td>${user.version || user.app_version || user.client_version || '-'}</td>
                <td>${user.os || '-'}</td>
                <td>${localeDisplay}</td>
                <td>${this.formatTimeAgo(minutes)}</td>
                <td>
                    <div style="display: flex; align-items: center;">
                        <span class="status-dot ${statusClass}"></span>
                        <span>${statusText}</span>
                    </div>
                </td>
            </tr>
        `}).join('');
    },

    /**
     * 通过编码数据打开用户详情页面
     */
    openUserDetailByData(encodedUser) {
        try {
            const user = JSON.parse(decodeURIComponent(encodedUser));
            this.openUserDetail(user);
        } catch (e) {
            console.error('解析用户数据失败:', e);
            this.showAlert('打开用户详情失败', 'danger');
        }
    },

    /**
     * 打开用户详情页面
     */
    openUserDetail(user) {
        this.state.selectedUser = user;
        const menuItem = document.querySelector('[data-view="userdetail"]');
        this.switchView('userdetail', menuItem);
        setTimeout(() => {
            this.renderUserDetailView(user);
        }, 100);
    },

    /**
     * 渲染用户详情页面（完整版）
     */
    renderUserDetailView(user) {
        const container = document.getElementById('userDetailContent');
        if (!user || !container) return;

        const osName = user.os || '-';
        const osVersion = user.os_version || user.osVersion || '-';
        const osBuild = user.os_build || user.osBuild || '-';
        const arch = user.arch || '-';
        const version = user.version || user.app_version || user.client_version || '-';
        const hwid = user.hwid || user.hwid_hash || '-';
        const displayHwid = this.formatHwid(hwid);
        const pythonVersion = user.python_version || user.python || '-';
        const localeCode = user.locale || user.region || '-';
        const lastSeen = user.updated_at || user.last_seen || user.last_seen_at || '-';
        const registerTime = this.getUserRegisterTime(user);
        const minutes = user.minutes_ago ?? user.minutes ?? user.last_seen_minutes ?? '-';
        const resolution = user.resolution || user.screen_resolution || user.screenResolution || '-';

        const originalName = this.getAutoUserName(user);
        const alias = this.normalizeUserName(user.alias);
        let displayName = this.getDisplayUserName(user);
        if (alias && alias !== originalName) {
            displayName = `${alias} <span style="color: var(--text-muted); font-size: 0.8em; font-weight: normal;">(${originalName})</span>`;
        }

        const localeMap = {
            'zh-CN': '中国',
            'zh-TW': '中国台湾',
            'zh-HK': '中国香港',
            'en-US': '美国',
            'en-GB': '英国',
            'ja-JP': '日本',
            'ko-KR': '韩国',
            'ru-RU': '俄罗斯',
            'de-DE': '德国',
            'fr-FR': '法国'
        };
        const localeDisplay = localeMap[localeCode] || localeCode;

        const isOnline = typeof minutes === 'number' && minutes <= 5;
        const statusClass = isOnline ? 'online' : 'offline';
        const statusText = isOnline ? '在线' : '离线';
        const statusColor = isOnline ? 'var(--secondary)' : 'var(--danger)';

        const isMarked = this.state.markedUsers.has(hwid);
        const starIcon = isMarked
            ? `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>`
            : `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>`;
        const markText = isMarked ? '取消标记' : '标记用户';
        const markColor = isMarked ? '#f59e0b' : 'var(--text)';

        const isAdmin = this.state.adminUsers.has(hwid);
        const adminIcon = isAdmin
            ? `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path></svg>`
            : `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path></svg>`;
        const adminText = isAdmin ? '取消管理员' : '标记为管理员';
        const adminColor = isAdmin ? 'var(--primary)' : 'var(--text)';

        const avatarBg = isAdmin
            ? 'linear-gradient(135deg, #60a5fa, #2563eb)'
            : 'linear-gradient(135deg, #4a4a4a, #1a1a1a)';

        const sections = [
            {
                title: '基础信息',
                items: [
                    { label: '用户 ID (数字)', value: `<b style="color: var(--primary);"># ${user.id || '-'}</b>` },
                    { label: '用户昵称', value: displayName },
                    { label: '账户状态', value: `<span style="color: var(--secondary);">正常</span>` },
                    { label: '在线状态', value: `<span class="status-dot ${statusClass}"></span>${statusText}` },
                    { label: '最近活跃', value: this.formatTimeAgo(minutes) },
                    { label: '最后更新', value: lastSeen },
                    { label: '注册时间', value: registerTime },
                    { label: '区域', value: localeDisplay }
                ]
            },
            {
                title: '设备信息',
                items: [
                    { label: '操作系统', value: osName },
                    { label: '系统版本', value: osVersion },
                    { label: '构建版本', value: osBuild },
                    { label: '系统架构', value: arch },
                    { label: '屏幕分辨率', value: resolution },
                    { label: 'HWID', value: `<span style="font-family: monospace;">${displayHwid}</span>` }
                ]
            },
            {
                title: '应用环境',
                items: [
                    { label: '客户端版本', value: version },
                    { label: 'Python环境', value: pythonVersion }
                ]
            },
            {
                title: '服务器AI用量统计',
                items: [
                    { label: '使用Tokens', value: `<b style="color: var(--primary);">${(user.ai_tokens || 0).toLocaleString()}</b>` },
                    { label: '发送信息条数', value: `<b style="color: var(--secondary);">${(user.ai_messages || 0).toLocaleString()}</b>` },
                    { label: '违规次数', value: `<b style="color: var(--danger);">${(user.ai_violations || 0).toLocaleString()}</b>` }
                ]
            }
        ];

        let html = `
        <div style="display: flex; align-items: center; gap: 20px; margin-bottom: 30px; border-bottom: 1px solid var(--border); padding-bottom: 20px;">
            <div style="width: 64px; height: 64px; background: ${avatarBg}; border-radius: 16px; color: #fff; font-size: 24px; font-weight: bold; display: flex; align-items: center; justify-content: center;">
                ${(alias || originalName).substring(0, 1).toUpperCase()}
            </div>
            <div>
                <h2 style="margin-bottom: 4px; font-size: 24px;">${displayName}</h2>
                <div style="display: flex; align-items: center; gap: 12px; font-size: 14px; color: var(--text-muted);">
                    <div style="display: flex; align-items: center;">
                        <span class="status-dot ${statusClass}"></span>
                        <span style="color: ${statusColor}; font-weight: 500;">${statusText}</span>
                    </div>
                    <div>Numeric ID: #${user.id || '-'}</div>
                    <div>HWID: ${displayHwid}</div>
                </div>
            </div>
        </div>

        <div style="margin-bottom: 30px; background: #fff; border-radius: 12px; border: 1px solid var(--border); padding: 20px;">
            <h4 style="margin-bottom: 16px; font-size: 16px; font-weight: 600; color: var(--text); display: flex; align-items: center; gap: 8px;">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
                管理功能
            </h4>
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px;">
                <div style="display: flex; flex-direction: column; gap: 8px;">
                    <div style="font-size: 12px; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px;">基础操作</div>
                    <div style="display: flex; gap: 8px; flex-wrap: wrap;">
                        <button class="btn" onclick="app.updateUserAlias('${hwid}')" style="display: flex; align-items: center; gap: 6px; font-size: 13px;">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                            添加备注
                        </button>
                        <button class="btn" onclick="app.sendPopup('${hwid}')" style="display: flex; align-items: center; gap: 6px; font-size: 13px;">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
                            发送弹窗
                        </button>
                        <button class="btn" onclick="app.sendNotification('${hwid}')" style="display: flex; align-items: center; gap: 6px; font-size: 13px;">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path><path d="M13.73 21a2 2 0 0 1-3.46 0"></path></svg>
                            发送提示
                        </button>
                        <button class="btn" onclick="app.requestLog('${hwid}')" style="display: flex; align-items: center; gap: 6px; font-size: 13px;">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
                            请求日志
                        </button>
                    </div>
                </div>
                <div style="display: flex; flex-direction: column; gap: 8px;">
                    <div style="font-size: 12px; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px;">用户标记</div>
                    <div style="display: flex; gap: 8px; flex-wrap: wrap;">
                        <button class="btn" onclick="app.toggleMarkUser('${hwid}')" style="display: flex; align-items: center; gap: 6px; font-size: 13px; border-color: ${markColor}; color: ${markColor};">
                            ${starIcon}
                            ${markText}
                        </button>
                        <button class="btn" onclick="app.toggleAdminUser('${hwid}')" style="display: flex; align-items: center; gap: 6px; font-size: 13px; border-color: ${adminColor}; color: ${adminColor};">
                            ${adminIcon}
                            ${adminText}
                        </button>
                    </div>
                </div>
                <div style="display: flex; flex-direction: column; gap: 8px;">
                    <div style="font-size: 12px; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px;">权限管理</div>
                    <div style="display: flex; gap: 8px; flex-wrap: wrap;">
                        <button class="btn" onclick="app.banFeedback('${hwid}')" style="display: flex; align-items: center; gap: 6px; font-size: 13px; background: var(--warning); border-color: var(--warning); color: white;">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"></line></svg>
                            封禁反馈
                        </button>
                        <button class="btn" onclick="app.banAI('${hwid}')" style="display: flex; align-items: center; gap: 6px; font-size: 13px; background: #18181b; border-color: #18181b; color: white;">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="23"></line></svg>
                            封禁AI
                        </button>
                        <button class="btn" onclick="app.deleteUser('${hwid}')" style="display: flex; align-items: center; gap: 6px; font-size: 13px; background: var(--danger); border-color: var(--danger); color: white;">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                            删除用户
                        </button>
                    </div>
                </div>
            </div>
        </div>
        
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 24px;">
    `;

        sections.forEach(section => {
            html += `
            <div class="detail-section" style="background: #f8fafc; padding: 20px; border-radius: 12px; border: 1px solid var(--border);">
                <h4 style="margin-bottom: 16px; font-size: 16px; font-weight: 600; color: var(--text);">${section.title}</h4>
                <div style="display: grid; gap: 12px;">
        `;
            section.items.forEach(item => {
                html += `
                <div style="display: flex; justify-content: space-between; align-items: center; font-size: 14px;">
                    <span style="color: var(--text-muted);">${item.label}</span>
                    <span style="font-weight: 500; text-align: right;">${item.value}</span>
                </div>
            `;
            });
            html += `
                </div>
            </div>
        `;
        });

        html += `</div>`;
        container.innerHTML = html;
    },

    /**
     * 更新用户备注
     */
    updateUserAlias(hwid) {
        const user = (this.state.latestUsersData || []).find(u => u.hwid === hwid);
        const currentAlias = user ? (user.alias || '') : '';
        
        const title = '添加备注';
        const content = `
            <div class="form-group">
                <label>备注名称</label>
                <input type="text" class="input" style="width: 100%;" id="aliasInput" placeholder="请输入备注名称..." value="${currentAlias}">
            </div>
            <div style="font-size: 12px; color: var(--text-muted); margin-top: 8px;">为用户添加便于识别的备注名称</div>
        `;

        document.getElementById('controlModalTitle').textContent = title;
        document.getElementById('controlModalBody').innerHTML = content;
        document.getElementById('controlModal').dataset.hwid = hwid;

        const submitBtn = document.getElementById('controlModalSubmit');
        submitBtn.textContent = '保存备注';
        submitBtn.setAttribute('onclick', 'app.submitUpdateAlias()');

        document.getElementById('controlModalMask').classList.add('show');
        document.getElementById('controlModal').classList.add('show');
        
        setTimeout(() => document.getElementById('aliasInput')?.focus(), 100);
    },

    /**
     * 提交更新备注
     */
    async submitUpdateAlias() {
        const hwid = document.getElementById('controlModal').dataset.hwid;
        const newAlias = document.getElementById('aliasInput')?.value?.trim();
        
        this.closeControlModal();
        
        try {
            const res = await fetch(`${this.config.apiBase}/admin/update-alias`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    machine_id: hwid,
                    alias: newAlias
                })
            });
            if (res.ok) {
                this.showAlert('备注已更新', 'success');
                await this.fetchData();
                if (this.state.selectedUser && this.state.selectedUser.hwid === hwid) {
                    const updated = (this.state.latestUsersData || []).find(u => u.hwid === hwid);
                    if (updated) this.renderUserDetailView(updated);
                }
            } else throw new Error();
        } catch (e) {
            this.showAlert('更新失败', 'danger');
        }
    },

    /**
     * 发送弹窗
     */
    sendPopup(hwid) {
        const title = '发送弹窗消息';
        const content = `
            <div class="form-group">
                <label>弹窗内容</label>
                <textarea class="input" style="width: 100%; height: 120px; font-family: inherit; padding: 10px; resize: vertical;" id="popupMessage" placeholder="请输入要显示在弹窗中的内容..."></textarea>
            </div>
            <div style="font-size: 12px; color: var(--text-muted); margin-top: 8px;">消息将立即显示在用户客户端的弹窗中</div>
        `;

        document.getElementById('controlModalTitle').textContent = title;
        document.getElementById('controlModalBody').innerHTML = content;
        document.getElementById('controlModal').dataset.hwid = hwid;

        const submitBtn = document.getElementById('controlModalSubmit');
        submitBtn.textContent = '发送弹窗';
        submitBtn.setAttribute('onclick', 'app.submitSendPopup()');

        document.getElementById('controlModalMask').classList.add('show');
        document.getElementById('controlModal').classList.add('show');
        
        setTimeout(() => document.getElementById('popupMessage')?.focus(), 100);
    },

    /**
     * 提交发送弹窗
     */
    async submitSendPopup() {
        const hwid = document.getElementById('controlModal').dataset.hwid;
        const msg = document.getElementById('popupMessage')?.value?.trim();
        
        if (!msg) {
            this.showAlert('请输入弹窗内容', 'warning');
            return;
        }
        
        this.closeControlModal();
        
        try {
            const res = await fetch(`${this.config.apiBase}/admin/user-command`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    machine_id: hwid,
                    command: JSON.stringify({ type: 'popup', message: msg })
                })
            });
            if (res.ok) this.showAlert('弹窗指令已下发', 'success');
            else throw new Error();
        } catch (e) {
            this.showAlert('发送失败', 'danger');
        }
    },

    /**
     * 发送提示
     */
    sendNotification(hwid) {
        const title = '发送提示消息';
        const content = `
            <div class="form-group">
                <label>提示内容</label>
                <textarea class="input" style="width: 100%; height: 100px; font-family: inherit; padding: 10px; resize: vertical;" id="notificationMessage" placeholder="请输入要显示的提示内容..."></textarea>
            </div>
            <div style="font-size: 12px; color: var(--text-muted); margin-top: 8px;">消息将以 Toast 通知形式显示在用户客户端</div>
        `;

        document.getElementById('controlModalTitle').textContent = title;
        document.getElementById('controlModalBody').innerHTML = content;
        document.getElementById('controlModal').dataset.hwid = hwid;

        const submitBtn = document.getElementById('controlModalSubmit');
        submitBtn.textContent = '发送提示';
        submitBtn.setAttribute('onclick', 'app.submitSendNotification()');

        document.getElementById('controlModalMask').classList.add('show');
        document.getElementById('controlModal').classList.add('show');
        
        setTimeout(() => document.getElementById('notificationMessage')?.focus(), 100);
    },

    /**
     * 提交发送提示
     */
    async submitSendNotification() {
        const hwid = document.getElementById('controlModal').dataset.hwid;
        const msg = document.getElementById('notificationMessage')?.value?.trim();
        
        if (!msg) {
            this.showAlert('请输入提示内容', 'warning');
            return;
        }
        
        this.closeControlModal();
        
        try {
            const res = await fetch(`${this.config.apiBase}/admin/user-command`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    machine_id: hwid,
                    command: JSON.stringify({ type: 'toast', message: msg })
                })
            });
            if (res.ok) this.showAlert('提示指令已下发', 'success');
            else throw new Error();
        } catch (e) {
            this.showAlert('发送失败', 'danger');
        }
    },

    /**
     * 请求上传日志
     */
    requestLog(hwid) {
        const title = '请求上传日志';
        const content = `
            <div class="form-group">
                <label>日志类型</label>
                <select class="select" style="width: 100%;" id="logType">
                    <option value="all">全部日志</option>
                    <option value="error">错误日志</option>
                    <option value="debug">调试日志</option>
                    <option value="ai">AI对话日志</option>
                </select>
            </div>
            <div class="form-group">
                <label>附加说明（可选）</label>
                <textarea class="input" style="width: 100%; height: 80px; font-family: inherit; padding: 10px; resize: vertical;" id="logNote" placeholder="请输入附加说明..."></textarea>
            </div>
            <div style="font-size: 12px; color: var(--text-muted); margin-top: 8px;">请求将发送到用户客户端，日志将自动上传到服务器</div>
        `;

        document.getElementById('controlModalTitle').textContent = title;
        document.getElementById('controlModalBody').innerHTML = content;
        document.getElementById('controlModal').dataset.hwid = hwid;

        const submitBtn = document.getElementById('controlModalSubmit');
        submitBtn.textContent = '发送请求';
        submitBtn.setAttribute('onclick', 'app.submitRequestLog()');

        document.getElementById('controlModalMask').classList.add('show');
        document.getElementById('controlModal').classList.add('show');
    },

    /**
     * 提交请求日志
     */
    async submitRequestLog() {
        const hwid = document.getElementById('controlModal').dataset.hwid;
        const logType = document.getElementById('logType')?.value;
        const note = document.getElementById('logNote')?.value?.trim();
        
        this.closeControlModal();
        
        try {
            const res = await fetch(`${this.config.apiBase}/admin/user-command`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    machine_id: hwid,
                    command: JSON.stringify({ type: 'upload_log', logType: logType, note: note })
                })
            });
            if (res.ok) this.showAlert('日志上传请求已发送', 'success');
            else throw new Error();
        } catch (e) {
            this.showAlert('请求发送失败', 'danger');
        }
    },

    /**
     * 删除用户
     */
    async deleteUser(hwid) {
        if (confirm('确定要删除该用户吗？此操作不可恢复。')) {
            try {
                const res = await fetch(`${this.config.apiBase}/admin/delete-user`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ machine_id: hwid })
                });
                if (res.ok) {
                    this.showAlert('用户已删除', 'success');
                    this.fetchData();
                    this.switchView('userlist');
                } else throw new Error();
            } catch (e) {
                this.showAlert('删除失败', 'danger');
            }
        }
    },

    /**
     * 切换用户标记
     */
    toggleMarkUser(hwid) {
        if (this.state.markedUsers.has(hwid)) {
            this.state.markedUsers.delete(hwid);
            this.showAlert('已取消标记', 'success');
        } else {
            this.state.markedUsers.add(hwid);
            this.showAlert('已标记用户', 'warning');
        }

        if (this.state.selectedUser && this.state.selectedUser.hwid === hwid) {
            this.renderUserDetailView(this.state.selectedUser);
        }

        if (this.state.latestUsersData) {
            this.renderUserList(this.state.latestUsersData);
        }
    },

    /**
     * 切换管理员状态
     */
    toggleAdminUser(hwid) {
        if (this.state.adminUsers.has(hwid)) {
            this.state.adminUsers.delete(hwid);
            this.showAlert('已取消管理员', 'success');
        } else {
            this.state.adminUsers.add(hwid);
            this.showAlert('已标记为管理员', 'success');
        }

        if (this.state.selectedUser && this.state.selectedUser.hwid === hwid) {
            this.renderUserDetailView(this.state.selectedUser);
        }

        if (this.state.latestUsersData) {
            this.renderUserList(this.state.latestUsersData);
        }
    },

    /**
     * 封禁反馈功能
     */
    banFeedback(hwid) {
        const title = '封禁反馈功能';
        const content = `
            <div class="form-group">
                <label>封禁原因</label>
                <textarea class="input" style="width: 100%; height: 100px; font-family: inherit; padding: 10px;" id="banReason" placeholder="请输入封禁原因..."></textarea>
            </div>
            <div class="form-group">
                <label>封禁时长（天）</label>
                <div style="display: flex; align-items: center; gap: 12px;">
                    <input type="number" class="input" style="flex: 1;" id="banDays" placeholder="请输入天数" min="1" max="3650" value="7">
                    <label style="display: flex; align-items: center; gap: 6px; cursor: pointer; font-size: 14px; white-space: nowrap;">
                        <input type="checkbox" id="banPermanent" style="width: 16px; height: 16px;" onchange="app.toggleFeedbackPermanentBan()">
                        永久封禁
                    </label>
                </div>
                <div style="font-size: 12px; color: var(--text-muted); margin-top: 6px;">输入 1-3650 天，或勾选永久封禁</div>
            </div>
        `;

        document.getElementById('controlModalTitle').textContent = title;
        document.getElementById('controlModalBody').innerHTML = content;
        document.getElementById('controlModal').dataset.action = 'ban_feedback';
        document.getElementById('controlModal').dataset.hwid = hwid;

        const submitBtn = document.getElementById('controlModalSubmit');
        submitBtn.textContent = '确认封禁';
        submitBtn.setAttribute('onclick', 'app.submitBanFeedback()');

        document.getElementById('controlModalMask').classList.add('show');
        document.getElementById('controlModal').classList.add('show');
    },

    /**
     * 切换反馈永久封禁
     */
    toggleFeedbackPermanentBan() {
        const isPermanent = document.getElementById('banPermanent')?.checked;
        const daysInput = document.getElementById('banDays');
        if (daysInput) {
            daysInput.disabled = isPermanent;
            if (isPermanent) {
                daysInput.value = '';
                daysInput.placeholder = '永久';
            } else {
                daysInput.placeholder = '请输入天数';
                if (!daysInput.value) daysInput.value = '7';
            }
        }
    },

    /**
     * 提交封禁反馈
     */
    submitBanFeedback() {
        const hwid = document.getElementById('controlModal').dataset.hwid;
        const reason = document.getElementById('banReason')?.value?.trim();
        const isPermanent = document.getElementById('banPermanent')?.checked;
        const days = document.getElementById('banDays')?.value;

        if (!reason) {
            this.showAlert('请输入封禁原因', 'warning');
            return;
        }

        if (!isPermanent && (!days || days < 1)) {
            this.showAlert('请输入有效的封禁天数', 'warning');
            return;
        }

        const durationText = isPermanent ? '永久' : `${days}天`;
        this.closeControlModal();
        this.showAlert(`已封禁用户反馈功能，时长：${durationText}，原因：${reason}`, 'warning');
    },

    /**
     * 封禁AI功能
     */
    banAI(hwid) {
        const title = '封禁AI功能';
        const content = `
            <div class="form-group">
                <label>封禁原因</label>
                <textarea class="input" style="width: 100%; height: 100px; font-family: inherit; padding: 10px;" id="banAIReason" placeholder="请输入封禁原因..."></textarea>
            </div>
            <div class="form-group">
                <label>封禁时长（天）</label>
                <div style="display: flex; align-items: center; gap: 12px;">
                    <input type="number" class="input" style="flex: 1;" id="banAIDays" placeholder="请输入天数" min="1" max="3650" value="7">
                    <label style="display: flex; align-items: center; gap: 6px; cursor: pointer; font-size: 14px; white-space: nowrap;">
                        <input type="checkbox" id="banAIPermanent" style="width: 16px; height: 16px;" onchange="app.togglePermanentBan()">
                        永久封禁
                    </label>
                </div>
                <div style="font-size: 12px; color: var(--text-muted); margin-top: 6px;">输入 1-3650 天，或勾选永久封禁</div>
            </div>
        `;

        document.getElementById('controlModalTitle').textContent = title;
        document.getElementById('controlModalBody').innerHTML = content;
        document.getElementById('controlModal').dataset.hwid = hwid;

        const submitBtn = document.getElementById('controlModalSubmit');
        submitBtn.textContent = '确认封禁';
        submitBtn.setAttribute('onclick', 'app.submitBanAI()');

        document.getElementById('controlModalMask').classList.add('show');
        document.getElementById('controlModal').classList.add('show');
    },

    /**
     * 切换永久封禁
     */
    togglePermanentBan() {
        const isPermanent = document.getElementById('banAIPermanent')?.checked;
        const daysInput = document.getElementById('banAIDays');
        if (daysInput) {
            daysInput.disabled = isPermanent;
            if (isPermanent) {
                daysInput.value = '';
                daysInput.placeholder = '永久';
            } else {
                daysInput.placeholder = '请输入天数';
                if (!daysInput.value) daysInput.value = '7';
            }
        }
    },

    /**
     * 提交封禁AI
     */
    submitBanAI() {
        const hwid = document.getElementById('controlModal').dataset.hwid;
        const reason = document.getElementById('banAIReason')?.value?.trim();
        const isPermanent = document.getElementById('banAIPermanent')?.checked;
        const days = document.getElementById('banAIDays')?.value;

        if (!reason) {
            this.showAlert('请输入封禁原因', 'warning');
            return;
        }

        if (!isPermanent && (!days || days < 1)) {
            this.showAlert('请输入有效的封禁天数', 'warning');
            return;
        }

        const durationText = isPermanent ? '永久' : `${days}天`;
        this.closeControlModal();
        this.showAlert(`已封禁用户AI功能，时长：${durationText}，原因：${reason}`, 'warning');
    },

    /**
     * 添加说明
     */
    addNote() {
        const type = document.getElementById('noteType')?.value;
        const title = document.getElementById('noteTitle')?.value?.trim();
        const content = document.getElementById('noteContent')?.value?.trim();
        const priority = document.querySelector('input[name="notePriority"]:checked')?.value || 'low';

        if (!title || !content) {
            this.showAlert('请填写标题和内容', 'warning');
            return;
        }

        const note = {
            id: Date.now(),
            type,
            title,
            content,
            priority,
            time: new Date().toLocaleString('zh-CN')
        };

        if (!this.state.notes) this.state.notes = [];
        this.state.notes.unshift(note);
        this.renderNotesList();
        this.showAlert('说明已添加', 'success');

        document.getElementById('noteTitle').value = '';
        document.getElementById('noteContent').value = '';
    },

    /**
     * 渲染说明列表
     */
    renderNotesList(filter = 'all') {
        const container = document.getElementById('notesList');
        if (!container) return;

        let notes = this.state.notes || [];
        if (filter !== 'all') {
            notes = notes.filter(n => n.type === filter);
        }

        if (notes.length === 0) {
            container.innerHTML = `
                <div style="padding: 40px 20px; text-align: center; color: var(--text-muted);">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="margin-bottom: 12px; opacity: 0.5;">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                        <polyline points="14 2 14 8 20 8"></polyline>
                        <line x1="16" y1="13" x2="8" y2="13"></line>
                        <line x1="16" y1="17" x2="8" y2="17"></line>
                    </svg>
                    <div style="font-size: 14px;">暂无说明记录</div>
                    <div style="font-size: 12px; margin-top: 4px;">添加第一条说明吧</div>
                </div>
            `;
            return;
        }

        const typeMap = {
            notice: { label: '通知', color: 'var(--primary)', bg: 'rgba(37, 99, 235, 0.1)' },
            maintenance: { label: '维护', color: 'var(--warning)', bg: 'rgba(245, 158, 11, 0.1)' },
            update: { label: '更新', color: 'var(--secondary)', bg: 'rgba(16, 185, 129, 0.1)' },
            bug: { label: '问题', color: 'var(--danger)', bg: 'rgba(239, 68, 68, 0.1)' },
            other: { label: '其他', color: 'var(--muted)', bg: 'rgba(148, 163, 184, 0.15)' }
        };

        const priorityMap = {
            low: '',
            medium: '⭐',
            high: '⭐⭐'
        };

        container.innerHTML = notes.map(note => {
            const typeInfo = typeMap[note.type] || typeMap.other;
            return `
                <div style="border-bottom: 1px solid var(--border); padding: 16px 20px;">
                    <div style="display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 8px;">
                        <div style="display: flex; align-items: center; gap: 8px;">
                            <span style="background: ${typeInfo.bg}; color: ${typeInfo.color}; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 500;">${typeInfo.label}</span>
                            <span style="font-weight: 600; font-size: 14px;">${note.title}</span>
                            <span style="color: var(--warning); font-size: 12px;">${priorityMap[note.priority]}</span>
                        </div>
                        <button class="btn" style="padding: 4px 8px; font-size: 12px;" onclick="app.deleteNote(${note.id})">删除</button>
                    </div>
                    <div style="color: var(--text-muted); font-size: 13px; line-height: 1.5; margin-bottom: 8px;">${note.content}</div>
                    <div style="color: var(--muted); font-size: 11px;">${note.time}</div>
                </div>
            `;
        }).join('');
    },

    /**
     * 筛选说明
     */
    filterNotes() {
        const filter = document.getElementById('noteFilter')?.value || 'all';
        this.renderNotesList(filter);
    },

    /**
     * 删除说明
     */
    deleteNote(id) {
        if (!this.state.notes) return;
        this.state.notes = this.state.notes.filter(n => n.id !== id);
        this.renderNotesList(document.getElementById('noteFilter')?.value || 'all');
        this.showAlert('说明已删除', 'success');
    },

    /**
     * 使用说明模板
     */
    useNoteTemplate(type) {
        const templates = {
            maintenance: {
                type: 'maintenance',
                title: '例行维护通知',
                content: '计划于 YYYY-MM-DD HH:MM 进行例行维护，预计时长 X 小时，届时服务将暂停访问。'
            },
            emergency: {
                type: 'maintenance',
                title: '紧急维护通知',
                content: '因发现紧急问题，需要立即进行维护修复，预计时长 X 分钟，请各位知悉。'
            },
            update: {
                type: 'update',
                title: '版本更新说明',
                content: '本次更新内容：\n1. 新增功能：...\n2. 优化项：...\n3. 修复问题：...'
            },
            bug: {
                type: 'bug',
                title: '已知问题记录',
                content: '问题描述：...\n影响范围：...\n预计修复时间：...'
            },
            notice: {
                type: 'notice',
                title: '重要通知',
                content: '...'
            }
        };

        const template = templates[type];
        if (!template) return;

        document.getElementById('noteType').value = template.type;
        document.getElementById('noteTitle').value = template.title;
        document.getElementById('noteContent').value = template.content;
    },

    /**
     * API 提供商配置
     */
    providerConfigs: {
        openai: {
            url: 'https://api.openai.com/v1',
            models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo']
        },
        anthropic: {
            url: 'https://api.anthropic.com/v1',
            models: ['claude-3-5-sonnet', 'claude-3-opus', 'claude-3-sonnet', 'claude-3-haiku']
        },
        deepseek: {
            url: 'https://api.deepseek.com/v1',
            models: ['deepseek-chat', 'deepseek-coder']
        },
        moonshot: {
            url: 'https://api.moonshot.cn/v1',
            models: ['moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k']
        },
        zhipu: {
            url: 'https://open.bigmodel.cn/api/paas/v4',
            models: ['glm-4', 'glm-4-flash', 'glm-3-turbo']
        },
        qwen: {
            url: 'https://dashscope.aliyuncs.com/api/v1',
            models: ['qwen-turbo', 'qwen-plus', 'qwen-max', 'qwen-max-longcontext']
        },
        custom: {
            url: '',
            models: ['custom-model']
        }
    },

    /**
     * 切换 API 提供商
     */
    onProviderChange() {
        const provider = document.getElementById('aiProvider')?.value;
        const config = this.providerConfigs[provider];
        if (!config) return;

        document.getElementById('aiApiUrl').value = config.url;

        const modelSelect = document.getElementById('aiModel');
        if (modelSelect) {
            modelSelect.innerHTML = config.models.map(m => `<option value="${m}">${m}</option>`).join('');
        }
    },

    /**
     * 切换 API Key 可见性
     */
    toggleApiKeyVisibility() {
        const input = document.getElementById('aiApiKey');
        const btn = event.target;
        if (!input) return;

        if (input.type === 'password') {
            input.type = 'text';
            btn.textContent = '隐藏';
        } else {
            input.type = 'password';
            btn.textContent = '显示';
        }
    },

    /**
     * 更新最大 Tokens 显示
     */
    updateMaxTokensDisplay() {
        const slider = document.getElementById('maxTokensSlider');
        const input = document.getElementById('maxTokens');
        if (slider && input) {
            input.value = slider.value;
        }
    },

    /**
     * 更新温度显示
     */
    updateTemperatureDisplay() {
        const slider = document.getElementById('temperatureSlider');
        const input = document.getElementById('temperature');
        if (slider && input) {
            input.value = (slider.value / 100).toFixed(2);
        }
    },

    /**
     * 保存 AI 配置
     */
    saveAIConfig() {
        const config = {
            provider: document.getElementById('aiProvider')?.value,
            apiUrl: document.getElementById('aiApiUrl')?.value,
            apiKey: document.getElementById('aiApiKey')?.value,
            model: document.getElementById('aiModel')?.value,
            maxTokens: parseInt(document.getElementById('maxTokens')?.value) || 4096,
            temperature: parseFloat(document.getElementById('temperature')?.value) || 0.7,
            contextWindow: parseInt(document.getElementById('contextWindow')?.value) || 8192,
            requestTimeout: parseInt(document.getElementById('requestTimeout')?.value) || 30,
            enableAI: document.getElementById('enableAI')?.checked ?? true,
            streamOutput: document.getElementById('streamOutput')?.checked ?? true,
            systemPrompt: document.getElementById('systemPrompt')?.value || '',
            dailyLimit: parseInt(document.getElementById('dailyLimit')?.value) || 100,
            perRequestLimit: parseInt(document.getElementById('perRequestLimit')?.value) || 2048,
            cooldownTime: parseInt(document.getElementById('cooldownTime')?.value) || 3
        };

        this.state.aiConfig = config;
        this.showAlert('AI 配置已保存', 'success');
    },

    /**
     * 重置 AI 配置
     */
    resetAIConfig() {
        document.getElementById('aiProvider').value = 'openai';
        document.getElementById('aiApiUrl').value = 'https://api.openai.com/v1';
        document.getElementById('aiApiKey').value = '';
        document.getElementById('maxTokens').value = '4096';
        document.getElementById('maxTokensSlider').value = 4096;
        document.getElementById('temperature').value = '0.7';
        document.getElementById('temperatureSlider').value = 70;
        document.getElementById('contextWindow').value = '8192';
        document.getElementById('requestTimeout').value = '30';
        document.getElementById('enableAI').checked = true;
        document.getElementById('streamOutput').checked = true;
        document.getElementById('systemPrompt').value = '你是一个专业的游戏助手，帮助用户解答关于游戏的问题。请用简洁友好的方式回答用户的问题。';
        document.getElementById('dailyLimit').value = '100';
        document.getElementById('perRequestLimit').value = '2048';
        document.getElementById('cooldownTime').value = '3';

        this.onProviderChange();
        this.showAlert('已重置为默认配置', 'success');
    },

    /**
     * 刷新用量数据
     */
    refreshUsageData() {
        this.showAlert('数据已刷新', 'success');
    },

    /**
     * 筛选用量数据
     */
    filterUsageData() {
        const range = document.getElementById('usageTimeRange')?.value || '30';
        this.showAlert(`已切换到最近${range}天数据`, 'success');
    },

    /**
     * 导出用量数据
     */
    exportUsageData() {
        this.showAlert('数据导出功能开发中...', 'success');
    },

    /**
     * 切换用量图表
     */
    switchUsageChart(type) {
        this.showAlert(`已切换到 ${type === 'tokens' ? 'Tokens' : type === 'requests' ? '请求数' : '用户数'} 视图`, 'success');
    },

    /**
     * 搜索用户用量
     */
    searchUserUsage() {
        const keyword = document.getElementById('searchUserUsage')?.value?.toLowerCase() || '';
        this.state.usageCurrentPage = 1;
        this.renderUsageUserTable(keyword);
    },

    /**
     * 获取AI用量数据（API调用或模拟数据）
     */
    async fetchAIUsageData() {
        try {
            const res = await fetch(`${this.config.apiBase}/admin/ai-usage`);
            const data = await res.json();
            return data;
        } catch (err) {
            console.error('获取AI用量数据失败:', err);
            return null;
        }
    },

    /**
     * 计算AI用量统计数据
     */
    calculateAIUsageStats(data) {
        const stats = data.stats || {};
        return {
            totalTokens: stats.totalTokens || 0,
            totalMessages: stats.totalMessages || 0,
            activeUsers: stats.activeUsers || 0,
            violations: stats.violations || 0,
            tokensChange: parseFloat(stats.tokensChange) || 0,
            messagesChange: parseFloat(stats.messagesChange) || 0,
            usersChange: parseFloat(stats.usersChange) || 0,
            violationsChange: parseFloat(stats.violationsChange) || 0
        };
    },

    /**
     * 计算模型分布
     */
    calculateModelDistribution(data) {
        return data.modelDistribution || [];
    },

    /**
     * 渲染AI用量统计卡片
     */
    renderAIUsageStats() {
        const stats = this.state.aiUsageStats;
        if (!stats) return;

        const changeClass = (val) => val >= 0 ? '↑' : '↓';
        const changeColor = (val) => val >= 0 ? 'rgba(255,255,255,0.8)' : 'rgba(255,255,255,0.8)';

        const statsHtml = `
            <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-bottom: 24px;">
                <div style="background: linear-gradient(135deg, #60a5fa, #2563eb); border-radius: 12px; padding: 20px; color: white; position: relative; overflow: hidden;">
                    <div style="position: absolute; right: -10px; top: -10px; width: 80px; height: 80px; background: rgba(255,255,255,0.1); border-radius: 50%;"></div>
                    <div style="font-size: 13px; opacity: 0.9; margin-bottom: 8px; display: flex; align-items: center; gap: 6px;">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="7" width="20" height="14" rx="2" ry="2"></rect><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"></path></svg>
                        总Tokens消耗
                    </div>
                    <div style="font-size: 32px; font-weight: bold;">${stats.totalTokens.toLocaleString()}</div>
                    <div style="font-size: 12px; opacity: 0.8; margin-top: 8px;">${changeClass(stats.tokensChange)} ${Math.abs(stats.tokensChange)}% 较上周</div>
                </div>
                <div style="background: linear-gradient(135deg, #34d399, #10b981); border-radius: 12px; padding: 20px; color: white; position: relative; overflow: hidden;">
                    <div style="position: absolute; right: -10px; top: -10px; width: 80px; height: 80px; background: rgba(255,255,255,0.1); border-radius: 50%;"></div>
                    <div style="font-size: 13px; opacity: 0.9; margin-bottom: 8px; display: flex; align-items: center; gap: 6px;">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
                        总对话次数
                    </div>
                    <div style="font-size: 32px; font-weight: bold;">${stats.totalMessages.toLocaleString()}</div>
                    <div style="font-size: 12px; opacity: 0.8; margin-top: 8px;">${changeClass(stats.messagesChange)} ${Math.abs(stats.messagesChange)}% 较上周</div>
                </div>
                <div style="background: linear-gradient(135deg, #fbbf24, #f59e0b); border-radius: 12px; padding: 20px; color: white; position: relative; overflow: hidden;">
                    <div style="position: absolute; right: -10px; top: -10px; width: 80px; height: 80px; background: rgba(255,255,255,0.1); border-radius: 50%;"></div>
                    <div style="font-size: 13px; opacity: 0.9; margin-bottom: 8px; display: flex; align-items: center; gap: 6px;">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>
                        活跃用户数
                    </div>
                    <div style="font-size: 32px; font-weight: bold;">${stats.activeUsers.toLocaleString()}</div>
                    <div style="font-size: 12px; opacity: 0.8; margin-top: 8px;">${changeClass(stats.usersChange)} ${Math.abs(stats.usersChange)}% 较上周</div>
                </div>
                <div style="background: linear-gradient(135deg, #f87171, #ef4444); border-radius: 12px; padding: 20px; color: white; position: relative; overflow: hidden;">
                    <div style="position: absolute; right: -10px; top: -10px; width: 80px; height: 80px; background: rgba(255,255,255,0.1); border-radius: 50%;"></div>
                    <div style="font-size: 13px; opacity: 0.9; margin-bottom: 8px; display: flex; align-items: center; gap: 6px;">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>
                        违规拦截次数
                    </div>
                    <div style="font-size: 32px; font-weight: bold;">${stats.violations.toLocaleString()}</div>
                    <div style="font-size: 12px; opacity: 0.8; margin-top: 8px;">${changeClass(stats.violationsChange)} ${Math.abs(stats.violationsChange)}% 较上周</div>
                </div>
            </div>
        `;

        const container = document.getElementById('aiUsageStatsContainer');
        if (container) container.innerHTML = statsHtml;
    },

    /**
     * 渲染用量趋势图表
     */
    renderAIUsageChart(type = 'tokens') {
        const trendData = this.state.aiUsageData.trendData || [];
        if (!trendData.length) return;

        const maxVal = Math.max(...trendData.map(d => d[type]));
        
        let chartHtml = trendData.map(d => {
            const height = (d[type] / maxVal * 200).toFixed(0);
            return `<div style="flex: 1; display: flex; flex-direction: column; align-items: center; gap: 8px;">
                <div style="width: 100%; background: linear-gradient(to top, #60a5fa, #93c5fd); border-radius: 4px 4px 0 0; height: ${height}px;"></div>
                <span style="font-size: 11px; color: var(--text-muted);">${d.date}</span>
            </div>`;
        }).join('');

        const container = document.getElementById('usageChart');
        if (container) container.innerHTML = chartHtml;
    },

    /**
     * 渲染模型分布
     */
    renderModelDistribution() {
        const distribution = this.state.aiModelDistribution;
        if (!distribution || !distribution.length) return;

        const colors = ['#2563eb', '#10b981', '#f59e0b', '#8b5cf6', '#64748b'];
        
        let html = distribution.map((item, i) => `
            <div>
                <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
                    <span style="font-size: 13px; font-weight: 500;">${item.model}</span>
                    <span style="font-size: 13px; color: var(--text-muted);">${item.percentage}%</span>
                </div>
                <div style="height: 8px; background: #e2e8f0; border-radius: 4px; overflow: hidden;">
                    <div style="width: ${item.percentage}%; height: 100%; background: linear-gradient(90deg, ${colors[i % colors.length]}, ${colors[(i + 1) % colors.length]}); border-radius: 4px;"></div>
                </div>
            </div>
        `).join('');

        const avgResponseTime = (Math.random() * 2 + 0.5).toFixed(2);
        html += `<div style="margin-top: 24px; padding-top: 20px; border-top: 1px solid var(--border);">
            <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 8px;">平均响应时间</div>
            <div style="font-size: 24px; font-weight: bold; color: var(--text);">${avgResponseTime}s</div>
        </div>`;

        const container = document.getElementById('modelDistributionContainer');
        if (container) container.innerHTML = html;
    },

    /**
     * 渲染用户用量表格
     */
    renderUsageUserTable(keyword = '') {
        const table = document.getElementById('userUsageTable');
        const info = document.getElementById('usagePaginationInfo');
        const pagination = document.getElementById('usagePagination');
        if (!table) return;

        let data = this.state.aiUsageData.users || [];
        
        if (keyword) {
            data = data.filter(u => 
                u.name.toLowerCase().includes(keyword) || 
                u.hwid.toLowerCase().includes(keyword)
            );
        }

        const pageSize = this.state.usagePageSize;
        const currentPage = this.state.usageCurrentPage;
        const totalPages = Math.max(1, Math.ceil(data.length / pageSize));
        const start = (currentPage - 1) * pageSize;
        const end = Math.min(start + pageSize, data.length);
        const pageData = data.slice(start, end);

        if (pageData.length === 0) {
            table.innerHTML = '<tr><td colspan="7" style="text-align: center; padding: 40px; color: var(--text-muted);">暂无数据</td></tr>';
            if (info) info.textContent = `共 ${data.length} 条记录`;
            if (pagination) pagination.innerHTML = '';
            return;
        }

        let html = pageData.map(user => {
            const rankBadge = user.rank <= 3 
                ? `<span style="display: inline-block; width: 24px; height: 24px; background: ${user.rank === 1 ? 'linear-gradient(135deg, #fbbf24, #f59e0b)' : user.rank === 2 ? '#94a3b8' : '#f97316'}; color: white; border-radius: 6px; text-align: center; line-height: 24px; font-size: 12px; font-weight: 600;">${user.rank}</span>`
                : user.rank;
            const statusClass = user.status === '正常' ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)';
            const statusColor = user.status === '正常' ? 'var(--secondary)' : 'var(--danger)';

            return `<tr>
                <td>${rankBadge}</td>
                <td>
                    <div style="display: flex; align-items: center; gap: 10px;">
                        <div style="width: 32px; height: 32px; background: ${user.avatarColor}; border-radius: 8px; color: white; font-size: 14px; font-weight: 600; display: flex; align-items: center; justify-content: center;">${user.avatar}</div>
                        <div>
                            <div style="font-weight: 500;">${user.name}</div>
                            <div style="font-size: 12px; color: var(--text-muted);">${user.hwid.substring(0, 12)}...</div>
                        </div>
                    </div>
                </td>
                <td>${user.messages.toLocaleString()}</td>
                <td>${user.tokens.toLocaleString()}</td>
                <td>${user.avgTime}</td>
                <td>${user.lastTime}</td>
                <td><span style="display: inline-block; padding: 2px 8px; background: ${statusClass}; color: ${statusColor}; border-radius: 4px; font-size: 12px;">${user.status}</span></td>
            </tr>`;
        }).join('');

        table.innerHTML = html;
        
        if (info) info.textContent = `共 ${data.length} 条记录，第 ${currentPage}/${totalPages} 页`;
        
        if (pagination) {
            let pageHtml = '';
            const maxVisible = 5;
            let startPage = Math.max(1, currentPage - Math.floor(maxVisible / 2));
            let endPage = Math.min(totalPages, startPage + maxVisible - 1);
            if (endPage - startPage < maxVisible - 1) {
                startPage = Math.max(1, endPage - maxVisible + 1);
            }

            pageHtml += `<button class="btn" style="padding: 6px 10px; font-size: 12px;" onclick="app.goToUsagePage(${currentPage - 1})" ${currentPage === 1 ? 'disabled' : ''}>上一页</button>`;
            
            for (let i = startPage; i <= endPage; i++) {
                pageHtml += `<button class="btn ${i === currentPage ? 'primary' : ''}" style="padding: 6px 10px; font-size: 12px;" onclick="app.goToUsagePage(${i})">${i}</button>`;
            }
            
            pageHtml += `<button class="btn" style="padding: 6px 10px; font-size: 12px;" onclick="app.goToUsagePage(${currentPage + 1})" ${currentPage === totalPages ? 'disabled' : ''}>下一页</button>`;
            pagination.innerHTML = pageHtml;
        }
    },

    /**
     * 跳转到指定页
     */
    goToUsagePage(page) {
        let data = this.state.aiUsageData.users || [];
        const keyword = document.getElementById('searchUserUsage')?.value?.toLowerCase() || '';
        if (keyword) {
            data = data.filter(u => 
                u.name.toLowerCase().includes(keyword) || 
                u.hwid.toLowerCase().includes(keyword)
            );
        }
        
        const totalPages = Math.max(1, Math.ceil(data.length / this.state.usagePageSize));
        if (page < 1 || page > totalPages) return;
        this.state.usageCurrentPage = page;
        this.renderUsageUserTable(keyword);
    },

    /**
     * 切换用量图表类型
     */
    switchUsageChart(type) {
        this.renderAIUsageChart(type);
    },

    /**
     * 初始化AI用量页面
     */
    async initAIUsagePage() {
        const data = await this.fetchAIUsageData();
        this.state.aiUsageData = data;
        this.state.aiUsageStats = this.calculateAIUsageStats(data);
        this.state.aiModelDistribution = this.calculateModelDistribution(data);
        
        this.renderAIUsageStats();
        this.renderAIUsageChart('tokens');
        this.renderModelDistribution();
        this.renderUsageUserTable();
    },

    /**
     * 刷新用量数据
     */
    refreshUsageData() {
        this.initAIUsagePage().then(() => {
            this.showAlert('数据已刷新', 'success');
        });
    },

    /**
     * 筛选用量数据
     */
    filterUsageData() {
        const range = document.getElementById('usageTimeRange')?.value || '30';
        this.showAlert(`已切换到最近${range}天数据`, 'success');
    },

    /**
     * 初始化用户详情视图
     */
    initUserDetail() {
        if (this.state.selectedUser) {
            this.renderUserDetailView(this.state.selectedUser);
        }
    }
};

// 启动应用
document.addEventListener('DOMContentLoaded', () => {
    app.init();
});
