/* 个人信息卡片渲染与交互逻辑 */
(function () {
    'use strict';

    // 等级颜色类映射
    var LEVEL_CLASSES = ['up-lv0', 'up-lv1', 'up-lv2', 'up-lv3', 'up-lv4',
        'up-lv5', 'up-lv6', 'up-lv7', 'up-lv8', 'up-lv9'];

    // 等级所需经验阀值（与后端 LevelExpThresholds 对应）
    var EXP_THRESHOLDS = [0, 0, 200, 800, 2400, 4800, 9600, 19200, 38400, 76800];

    var _machineID = '';
    var _serviceBaseURL = '';
    var _profile = null;
    var _loadInFlight = false;
    var _loadRetryTimer = 0;
    var _loadFailureCount = 0;
    var _featureConfig = {
        badge_system_enabled: true,
        nickname_change_enabled: true,
        avatar_upload_enabled: true
    };
    var VERIFY_GROUP_URL = 'https://qun.qq.com/universal-share/share?ac=1&authKey=%2FDJOR1E72xAQKvLD%2BNQmaZmD7py%2F5PUY7xHORJX4kmmKdabaRF4%2BwIJkp6s8I10U&busi_data=eyJncm91cENvZGUiOiIxMDc4MzQzNjI5IiwidG9rZW4iOiJmSUNpVXErcnNMMVhlemRNR25EbVF5TWJrbmc5bm02UmRIS0c0WHFxemdWQkRzUlVmSkVZQW11NXFkRXZkMXBDIiwidWluIjoiMTA3OTY0OTM2OSJ9&data=4qfEzEByH95wqWw0I5ButymAfP5Aj5bjksqrXyh3uAoIWg5ChDGQ3w6cocqmRaRaGbDRpFunhEYQYBHwC46GHg&svctype=4&tempid=h5_group_info';

    function normalizeFeatureConfig(raw) {
        return {
            badge_system_enabled: !(raw && raw.badge_system_enabled === false),
            nickname_change_enabled: !(raw && raw.nickname_change_enabled === false),
            avatar_upload_enabled: !(raw && raw.avatar_upload_enabled === false)
        };
    }

    function getMachineID() {
        if (_machineID) return _machineID;
        // 从全局 app 对象或 telemetry manager 获取 machine_id
        if (window._telemetryHWID) { _machineID = window._telemetryHWID; return _machineID; }
        if (window.app && window.app.machineID) { _machineID = window.app.machineID; return _machineID; }
        return '';
    }

    function normalizeServiceBaseURL(rawURL) {
        var url = String(rawURL || '').trim().replace(/\/+$/, '');
        if (!url) return '';
        if (url.slice(-10) === '/telemetry') {
            return url.slice(0, -10);
        }
        return url;
    }

    function getServiceBaseURL() {
        if (_serviceBaseURL) return _serviceBaseURL;
        if (window._telemetryBaseUrl) {
            _serviceBaseURL = normalizeServiceBaseURL(window._telemetryBaseUrl);
            return _serviceBaseURL;
        }
        if (window._reportURL) {
            _serviceBaseURL = normalizeServiceBaseURL(window._reportURL);
            return _serviceBaseURL;
        }
        if (window.app && window.app.reportURL) {
            _serviceBaseURL = normalizeServiceBaseURL(window.app.reportURL);
            return _serviceBaseURL;
        }
        return '';
    }

    function buildProfileEndpoint() {
        var baseURL = getServiceBaseURL();
        if (!baseURL) return '';
        return baseURL + '/user-profile';
    }

    async function buildTelemetryHeaders(path, method, machineID, includeJsonContentType) {
        var headers = {
            'X-AimerWT-Client': '1'
        };
        if (includeJsonContentType) {
            headers['Content-Type'] = 'application/json';
        }
        if (window.pywebview && window.pywebview.api && window.pywebview.api.get_telemetry_auth_headers) {
            try {
                var authHeaders = await window.pywebview.api.get_telemetry_auth_headers(path, method, machineID || '');
                if (authHeaders && typeof authHeaders === 'object') {
                    Object.assign(headers, authHeaders);
                }
            } catch (e) {
                // 签名头获取失败时保持静默，交给请求自然失败
            }
        }
        return headers;
    }

    function getNicknameLength(nickname) {
        return Array.from(String(nickname || '')).length;
    }

    function isValidNicknameInput(nickname) {
        var normalized = String(nickname || '').trim();
        if (!normalized) return false;
        if (getNicknameLength(normalized) > 18) return false;

        try {
            return /^[\p{Script=Han}a-zA-Z0-9_-]+$/u.test(normalized);
        } catch (e) {
            return /^[\u3400-\u9fffa-zA-Z0-9_-]+$/.test(normalized);
        }
    }

    function renderBadge(level) {
        var badge = document.getElementById('up-level-badge');
        var num = document.getElementById('up-level-num');
        var heroBar = document.getElementById('up-hero-bar');
        if (!badge || !num) return;
        LEVEL_CLASSES.forEach(function (cls) { badge.classList.remove(cls); });
        badge.classList.add(LEVEL_CLASSES[Math.max(0, Math.min(9, level))]);
        num.textContent = level;
        // 同步顶部装饰条颜色（lv2+ 才加颜色类）
        if (heroBar) {
            heroBar.className = 'up-hero-bar';
            if (level >= 2) heroBar.classList.add('lv' + level);
        }
    }

    function renderExpBar(level, exp) {
        var label = document.getElementById('up-exp-label');
        var fill = document.getElementById('up-exp-fill');
        if (!label || !fill) return;

        if (level >= 9) {
            label.textContent = 'MAX 等级';
            fill.style.width = '100%';
            return;
        }
        var next = EXP_THRESHOLDS[level + 1] || 0;
        var cur = EXP_THRESHOLDS[level] || 0;
        var pct = next > cur ? Math.min(100, Math.round((exp - cur) / (next - cur) * 100)) : 100;
        label.textContent = 'EXP ' + exp + ' / ' + next;
        fill.style.width = pct + '%';
    }

    function renderAvatar(avatarData) {
        var el = document.getElementById('up-avatar');
        if (!el) return;
        if (avatarData && avatarData.length > 10) {
            el.innerHTML = '<img src="' + avatarData + '" alt="avatar">';
        } else {
            el.innerHTML = '<i class="ri-user-line"></i>';
        }
    }

    function renderBadges(badges) {
        var el = document.getElementById('up-badges');
        if (!el) return;
        if (!_featureConfig.badge_system_enabled) {
            el.innerHTML = '';
            return;
        }
        if (!badges || !badges.length) {
            el.innerHTML = '<span class="up-badge-placeholder"><i class="ri-medal-2-line"></i> 暂无勋章</span>';
            return;
        }
        el.innerHTML = badges.map(function (b) {
            var color = b.color || '#6366f1';
            return '<span class="up-badge-item" style="background:' + color + ';" title="' + (b.name || '') + '">' +
                (b.icon || '🏅') + ' ' + (b.name || '') + '</span>';
        }).join('');
    }

    function syncProfileInteractionState(profile) {
        if (!profile) return;

        var canSetProfile = !!profile.can_set_profile;
        var canSetNickname = canSetProfile && profile.can_set_nickname !== false && _featureConfig.nickname_change_enabled;
        var canSetAvatar = canSetProfile && profile.can_set_avatar !== false && _featureConfig.avatar_upload_enabled;
        var pendingNickname = String(profile.pending_nickname || '').trim();

        var input = document.getElementById('up-nickname-input');
        var saveBtn = document.getElementById('up-save-btn');
        var avatarWrap = document.getElementById('up-avatar-wrap');
        var lockedTip = document.getElementById('up-locked-tip');
        var requestHint = document.getElementById('up-request-hint');

        if (input) {
            input.value = pendingNickname || profile.nickname || '';
            input.disabled = !canSetNickname;
            input.placeholder = _featureConfig.nickname_change_enabled ? '设置昵称（需达到1级）' : '昵称修改已关闭';
        }
        if (saveBtn) {
            saveBtn.disabled = !canSetNickname;
            saveBtn.title = canSetNickname
                ? (pendingNickname ? '再次保存会覆盖之前的待审批昵称' : '保存昵称')
                : (_featureConfig.nickname_change_enabled ? '达到1级后可修改昵称' : '昵称修改已关闭');
        }
        if (avatarWrap) {
            avatarWrap.style.cursor = canSetAvatar ? 'pointer' : 'not-allowed';
            avatarWrap.title = canSetAvatar ? '点击更换头像（需达到1级）' : (_featureConfig.avatar_upload_enabled ? '达到1级后可上传头像' : '头像上传已关闭');
            avatarWrap.classList.toggle('up-avatar-disabled', !canSetAvatar);
        }
        if (requestHint) {
            requestHint.style.display = pendingNickname ? 'block' : 'none';
            requestHint.textContent = pendingNickname ? ('待审批昵称：' + pendingNickname + '，再次保存会覆盖旧申请') : '';
        }
        if (lockedTip) {
            var showLockedTip = !canSetNickname && !canSetAvatar;
            lockedTip.style.display = showLockedTip ? 'flex' : 'none';
            if (showLockedTip) {
                var tipText = canSetProfile ? '管理员暂时关闭了资料编辑功能' : '身份验证后解锁编辑权限';
                var spanEl = lockedTip.querySelector('span');
                if (spanEl) spanEl.textContent = tipText;
                var verifyBtn = lockedTip.querySelector('.up-verify-btn');
                if (verifyBtn) verifyBtn.style.display = canSetProfile ? 'none' : '';
            }
        }
    }

    function renderProfile(profile) {
        _profile = profile;
        _featureConfig = normalizeFeatureConfig({
            badge_system_enabled: profile.badges_enabled,
            nickname_change_enabled: profile.nickname_change_enabled,
            avatar_upload_enabled: profile.avatar_upload_enabled
        });
        var level = profile.level || 0;
        var exp = profile.exp || 0;

        // UID 显示
        var uidEl = document.getElementById('up-uid-display');
        var seqId = profile.seq_id || window._userSeqId || '';
        if (uidEl && seqId) {
            uidEl.textContent = 'UID：' + seqId;
        }

        renderBadge(level);
        renderExpBar(level, exp);
        renderAvatar(profile.avatar_data);
        renderBadges(Array.isArray(profile.badges) ? profile.badges : []);
        setOfflineTipVisible(false);
        syncProfileInteractionState(profile);
        applyFeatureSettings(_featureConfig);
    }

    function applyFeatureSettings(rawConfig) {
        _featureConfig = normalizeFeatureConfig(rawConfig || _featureConfig);

        var card = document.getElementById('user-profile-card');
        if (card) {
            card.classList.toggle('up-badges-hidden', !_featureConfig.badge_system_enabled);
        }

        var avatarWrap = document.getElementById('up-avatar-wrap');
        if (avatarWrap) {
            avatarWrap.classList.toggle('up-avatar-disabled', !_featureConfig.avatar_upload_enabled);
        }

        if (_profile) {
            renderBadges(Array.isArray(_profile.badges) ? _profile.badges : []);
            syncProfileInteractionState(_profile);
        }
    }

    function setOfflineTipVisible(visible) {
        var card = document.getElementById('user-profile-card');
        if (!card) return;

        var existing = card.querySelector('.up-offline-tip');
        if (!visible) {
            if (existing) {
                existing.classList.add('up-offline-tip-hide');
                setTimeout(function () { if (existing.parentNode) existing.remove(); }, 250);
            }
            return;
        }

        if (!existing) {
            existing = document.createElement('div');
            existing.className = 'up-offline-tip';
            existing.innerHTML =
                '<div class="up-offline-icon"><i class="ri-cloud-off-line"></i></div>' +
                '<div class="up-offline-text">' +
                '<span class="up-offline-title">未连接到服务器</span>' +
                '<span class="up-offline-desc">等待遥测服务连接…</span>' +
                '</div>';
            card.prepend(existing);
        }
    }

    function clearLoadRetry() {
        if (_loadRetryTimer) {
            window.clearTimeout(_loadRetryTimer);
            _loadRetryTimer = 0;
        }
    }

    function scheduleLoadRetry(delayMs) {
        clearLoadRetry();
        _loadRetryTimer = window.setTimeout(function () {
            _loadRetryTimer = 0;
            loadProfile();
        }, Math.max(1500, parseInt(delayMs, 10) || 3000));
    }

    async function loadProfile() {
        if (_loadInFlight) return;
        var mid = getMachineID();
        var endpoint = buildProfileEndpoint();
        if (!mid || !endpoint) {
            setOfflineTipVisible(true);
            scheduleLoadRetry(3000);
            return;
        }

        _loadInFlight = true;
        clearLoadRetry();
        try {
            var headers = await buildTelemetryHeaders('/user-profile', 'GET', mid, false);
            var response = await fetch(endpoint + '?machine_id=' + encodeURIComponent(mid), {
                method: 'GET',
                headers: headers
            });
            if (!response.ok) {
                setOfflineTipVisible(true);
                _loadFailureCount += 1;
                scheduleLoadRetry(_loadFailureCount >= 3 ? 6000 : 2500);
                return;
            }
            var data = await response.json();
            if (data && data.profile) {
                _loadFailureCount = 0;
                setOfflineTipVisible(false);
                renderProfile(data.profile);
                return;
            }
            setOfflineTipVisible(true);
            _loadFailureCount += 1;
            scheduleLoadRetry(_loadFailureCount >= 3 ? 6000 : 2500);
        } catch (e) {
            setOfflineTipVisible(true);
            _loadFailureCount += 1;
            scheduleLoadRetry(_loadFailureCount >= 3 ? 6000 : 2500);
        } finally {
            _loadInFlight = false;
        }
    }

    async function saveNickname() {
        var mid = getMachineID();
        var input = document.getElementById('up-nickname-input');
        var endpoint = buildProfileEndpoint();
        if (!mid || !endpoint || !input || !_featureConfig.nickname_change_enabled || (_profile && !_profile.can_set_nickname)) return;

        var nickname = input.value.trim();
        if (!nickname) {
            if (window.showToast) window.showToast('昵称不能为空', 'warning');
            return;
        }
        // 前端校验：中英文/数字/横杠/下划线，最多18字符（与后端保持一致）
        if (!isValidNicknameInput(nickname)) {
            if (window.showToast) window.showToast('昵称仅支持中英文、数字、横杠和下划线', 'warning');
            return;
        }
        try {
            var headers = await buildTelemetryHeaders('/user-profile', 'POST', mid, true);
            var response = await fetch(endpoint, {
                method: 'POST',
                headers: headers,
                body: JSON.stringify({ machine_id: mid, nickname: nickname })
            });
            var data = await response.json();
            if (!response.ok) {
                if (data && data.error && window.showToast) window.showToast(data.error, 'warning');
                return;
            }
            if (data && data.status === 'pending') {
                if (window.showToast) window.showToast(data.message || '昵称修改请求已提交，等待审批', 'info');
            }
            if (data && data.profile) renderProfile(data.profile);
        } catch (e) {
            if (window.showToast) window.showToast('服务器连接失败', 'warning');
        }
    }

    function initAvatarUpload() {
        var wrap = document.getElementById('up-avatar-wrap');
        var fileInput = document.getElementById('up-avatar-input');
        if (!wrap || !fileInput) return;

        wrap.addEventListener('click', function () {
            if (_profile && _profile.can_set_avatar && _featureConfig.avatar_upload_enabled) fileInput.click();
        });

        fileInput.addEventListener('change', function () {
            var file = fileInput.files && fileInput.files[0];
            if (!file) return;

            var reader = new FileReader();
            reader.onload = function (e) {
                var dataURL = e.target.result;
                // 压缩到 128×128
                var img = new Image();
                img.onload = function () {
                    var canvas = document.createElement('canvas');
                    canvas.width = 128;
                    canvas.height = 128;
                    var ctx = canvas.getContext('2d');
                    var size = Math.min(img.width, img.height);
                    var sx = (img.width - size) / 2;
                    var sy = (img.height - size) / 2;
                    ctx.drawImage(img, sx, sy, size, size, 0, 0, 128, 128);
                    var compressed = canvas.toDataURL('image/jpeg', 0.8);
                    uploadAvatar(compressed);
                };
                img.src = dataURL;
            };
            reader.readAsDataURL(file);
            fileInput.value = '';
        });
    }

    async function uploadAvatar(dataURL) {
        var mid = getMachineID();
        var endpoint = buildProfileEndpoint();
        if (!mid || !endpoint || !_featureConfig.avatar_upload_enabled || (_profile && !_profile.can_set_avatar)) return;

        try {
            var headers = await buildTelemetryHeaders('/user-profile', 'POST', mid, true);
            var response = await fetch(endpoint, {
                method: 'POST',
                headers: headers,
                body: JSON.stringify({ machine_id: mid, avatar_data: dataURL })
            });
            if (!response.ok) return;
            var data = await response.json();
            if (data && data.profile) renderProfile(data.profile);
        } catch (e) {
        }
    }

    // 供外部调用（例如 telemetry 上报完成后，已知 machine_id 和 report_url 时初始化）
    function init(machineID, reportURL) {
        if (machineID) _machineID = machineID;
        if (reportURL) {
            window._reportURL = reportURL;
            _serviceBaseURL = normalizeServiceBaseURL(reportURL);
        }
        initAvatarUpload();
        loadProfile();
    }

    function showVerifyDialog() {
        if (window.app && typeof window.app.showAlert === 'function') {
            window.app.showAlert(
                '请求身份认证',
                '<div style="text-align:left; line-height:1.8; font-size:14px;">' +
                '<p style="text-align:center; margin:0;">本功能目前仍在测试中，并不稳定。如需进行身份认证，可加群：</p>' +
                '<p style="text-align:center; margin: 12px 0;"><a href="#" onclick="app.openExternal(\'' + VERIFY_GROUP_URL + '\'); return false;" style="font-size:20px; font-weight:700; color:#f97316; text-decoration:none; user-select:all; letter-spacing:1px;">1078343629</a></p>' +
                '<p style="text-align:center; margin:0;">群号可跳转链接，完成认证后，您将可以<span style="color:#111827; font-weight:800;">设置昵称</span>和<span style="color:#111827; font-weight:800;">发送评论</span>。</p>' +
                '<p style="margin-top:12px; padding:10px 12px; background:rgba(249,115,22,0.06); border-radius:8px; border-left:3px solid #f97316; font-size:13px; color:var(--text-sec);">' +
                '<i class="ri-information-line" style="color:#f97316; margin-right:4px;"></i>受服务器资源限制，上传头像功能当前暂时仅对作者、UP主及赞助者开放上传权限。</p>' +
                '</div>',
                'info',
                null,
                { allowHtml: true }
            );
        }
    }

    window.userProfile = {
        init: init,
        loadProfile: loadProfile,
        saveNickname: saveNickname,
        renderProfile: renderProfile,
        applyFeatureSettings: applyFeatureSettings,
        showVerifyDialog: showVerifyDialog
    };

    // 如果已有全局 machine_id，延迟初始化
    document.addEventListener('DOMContentLoaded', function () {
        if (window._telemetryHWID) {
            _serviceBaseURL = normalizeServiceBaseURL(window._telemetryBaseUrl || window._reportURL || '');
            setTimeout(loadProfile, 500);
        }
    });
})();
