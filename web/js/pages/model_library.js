/**
 * 模型库模块
 * 功能定位: 管理模型库的可视化卡片展示、编辑（重命名 / 封面）
 *
 * 输入输出:
 *   - 输入: 用户操作、后端 pywebview.api 数据
 *   - 输出: 渲染模型卡片列表、编辑弹窗交互
 *
 * 实现逻辑:
 *   - 通过 pywebview.api.get_models_list 拉取列表
 *   - 卡片悬浮时显示编辑按钮，复用裁切器修改封面
 *   - 编辑弹窗通过 JS 动态创建，不污染 index.html
 *
 * 业务关联:
 *   - 上游: resource_nav 导航切换（app.switchResourceView）
 *   - 下游: pywebview.api (get_models_list / rename_model / update_model_cover_data)
 */

const ModelLibrary = {
    name: '模型库',
    icon: 'ri-box-3-line',
    view_id: 'view-models',
    _loaded: false,
    _current_edit_name: null,

    init() {
        console.log('[ModelLibrary] 初始化');
        this._ensure_edit_modal();
        this._bind_card_events();
    },

    show() {
        const view = document.getElementById(this.view_id);
        if (view) view.classList.add('active');
        this.refresh_list();
    },

    hide() {
        const view = document.getElementById(this.view_id);
        if (view) view.classList.remove('active');
    },

    // ==================== 列表刷新 ====================

    async refresh_list(options = {}) {
        const list_el = document.getElementById('models-list');
        const count_el = document.getElementById('models-count');
        if (!list_el || !count_el) return;

        const refresh_btn = document.getElementById('btn-refresh-models');
        if (refresh_btn) {
            refresh_btn.disabled = true;
            refresh_btn.classList.add('is-loading');
        }
        count_el.textContent = '刷新中...';

        try {
            if (!window.pywebview?.api?.get_models_list) {
                this._render_empty_state(list_el, count_el);
                return;
            }

            const res = await pywebview.api.get_models_list();
            if (!res || !res.valid) {
                this._render_empty_state(list_el, count_el);
                return;
            }

            const items = res.items || [];
            count_el.textContent = `本地: ${items.length}`;

            if (items.length === 0) {
                this._render_empty_state(list_el, count_el);
                return;
            }

            this._render_card_list(list_el, items);
            this._loaded = true;
        } catch (error) {
            console.error('[ModelLibrary] 刷新列表失败:', error);
            this._render_empty_state(list_el, count_el);
        } finally {
            if (refresh_btn) {
                refresh_btn.disabled = false;
                refresh_btn.classList.remove('is-loading');
            }
        }
    },

    // ==================== 卡片渲染 ====================

    _render_card_list(container, items) {
        const placeholder = 'assets/card_image_small.png';
        const CHUNK_SIZE = 24;
        let current_index = 0;
        container.innerHTML = '';

        const render_chunk = () => {
            const chunk = items.slice(current_index, current_index + CHUNK_SIZE);
            const html = chunk.map(it => {
                const cover = it.cover_url || placeholder;
                const is_default = !!it.cover_is_default;
                const size_text = this._format_bytes(it.size_bytes || 0);
                const safe_name = this._escape_html(it.name);

                return `
                    <div class="small-card animate-in" title="${this._escape_html(it.path || '')}" data-item-name="${safe_name}">
                        <div class="small-card-img-wrapper" style="position:relative;">
                             <img class="small-card-img${is_default ? ' is-default-cover' : ''} item-img-node"
                                  src="${cover}" loading="lazy" alt="">
                             <div class="skin-edit-overlay">
                                 <button class="btn-v2 icon-only small secondary skin-edit-btn" type="button">
                                     <i class="ri-edit-line"></i>
                                 </button>
                             </div>
                        </div>
                        <div class="small-card-body">
                            <div class="skin-card-footer">
                                <div class="skin-card-name" title="${safe_name}">${safe_name}</div>
                                <div class="skin-card-size">${size_text}</div>
                            </div>
                        </div>
                    </div>
                `;
            }).join('');

            container.insertAdjacentHTML('beforeend', html);
            current_index += CHUNK_SIZE;

            if (current_index < items.length) {
                requestAnimationFrame(render_chunk);
            }
        };

        render_chunk();
    },

    _bind_card_events() {
        const container = document.getElementById('models-list');
        if (!container || container.dataset.editBound === '1') return;
        container.dataset.editBound = '1';
        container.addEventListener('click', (event) => {
            const button = event.target.closest('.skin-edit-btn');
            if (!button || !container.contains(button)) return;
            const card = button.closest('.small-card');
            const cover = card?.querySelector('.item-img-node')?.src || '';
            const item_name = card?.dataset.itemName || '';
            if (!item_name) return;
            this.open_edit_modal(item_name, cover);
        });
    },

    _render_empty_state(container, count_el) {
        if (container) {
            container.innerHTML = `
                <div class="empty-state" style="grid-column: 1 / -1;">
                    <i class="ri-box-3-line"></i>
                    <h3>还没有模型</h3>
                    <p>点击左侧"打开模型库"按钮，将模型文件夹放入后刷新</p>
                </div>
            `;
        }
        if (count_el) count_el.textContent = '本地: 0';
    },

    // ==================== 编辑弹窗 ====================

    _ensure_edit_modal() {
        if (document.getElementById('modal-edit-model')) return;
        const modal_html = `
            <div class="modal-overlay" id="modal-edit-model">
                <div class="modal-content" style="max-width: 420px;">
                    <h2>编辑模型</h2>
                    <p class="subtitle">修改显示名称与封面</p>
                    <div class="edit-skin-form">
                        <div class="skin-cover-edit" onclick="ModelLibrary.request_update_cover()">
                            <img id="edit-model-cover" src="" alt="封面预览">
                            <div class="cover-overlay">
                                <i class="ri-camera-line"></i>
                                <span>更换封面</span>
                            </div>
                        </div>
                        <div class="form-group" style="margin-top: 15px;">
                            <label>文件夹名称 (即显示名称)</label>
                            <input type="text" id="edit-model-name" placeholder="请输入新的名称">
                            <p class="input-hint">
                                <i class="ri-information-line"></i> 请勿包含特殊字符 \\ / : * ? " &lt; &gt; | <br>
                                修改名称会同步修改本地文件夹名。
                            </p>
                        </div>
                    </div>
                    <div class="modal-actions">
                        <button class="btn secondary" onclick="app.closeModal('modal-edit-model')">取消</button>
                        <button class="btn primary" onclick="ModelLibrary.save_edit()">
                            <i class="ri-save-line"></i> 保存修改
                        </button>
                    </div>
                </div>
            </div>
        `;
        document.body.insertAdjacentHTML('beforeend', modal_html);
    },

    open_edit_modal(item_name, cover_url) {
        this._ensure_edit_modal();
        this._current_edit_name = item_name;
        app._cropCoverTarget = 'model';
        const modal = document.getElementById('modal-edit-model');
        const name_input = document.getElementById('edit-model-name');
        const cover_img = document.getElementById('edit-model-cover');
        if (!modal || !name_input || !cover_img) return;

        name_input.value = item_name;
        cover_img.src = cover_url || 'assets/coming_soon_img.png';
        modal.classList.remove('hiding');
        modal.classList.add('show');
    },

    async save_edit() {
        if (!this._current_edit_name) return;
        const new_name = document.getElementById('edit-model-name').value.trim();
        if (!new_name) {
            app.showAlert('错误', '名称不能为空！', 'error');
            return;
        }

        if (new_name !== this._current_edit_name) {
            try {
                const res = await pywebview.api.rename_model(this._current_edit_name, new_name);
                if (res.success) {
                    app.showAlert('成功', '重命名成功！', 'success');
                    this._current_edit_name = new_name;
                } else {
                    app.showAlert('失败', '重命名失败: ' + res.msg, 'error');
                    return;
                }
            } catch (e) {
                app.showAlert('错误', '调用失败: ' + e, 'error');
                return;
            }
        }

        app.closeModal('modal-edit-model');
        this.refresh_list();
    },

    request_update_cover() {
        if (!this._current_edit_name) return;
        app._cropCoverTarget = 'model';
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.onchange = async () => {
            const file = input.files && input.files[0];
            if (!file) return;
            try {
                const data_url = await new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onerror = () => reject(new Error('读取图片失败'));
                    reader.onload = () => resolve(String(reader.result || ''));
                    reader.readAsDataURL(file);
                });
                app.openCropCoverModal(data_url);
            } catch (e) {
                console.error(e);
                app.showAlert('错误', '读取图片失败', 'error');
            }
        };
        input.click();
    },

    // ==================== 工具方法 ====================

    _escape_html(str) {
        if (app && typeof app._escapeHtml === 'function') return app._escapeHtml(str);
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    },

    _format_bytes(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    },

    destroy() { }
};

// 绑定到全局 app 的刷新按钮入口
if (typeof app !== 'undefined') {
    app.refreshModels = function (opts) { ModelLibrary.refresh_list(opts); };
}

(function registerWhenReady() {
    if (typeof window !== 'undefined' && window.app && typeof window.app.registerResourcePage === 'function') {
        window.app.registerResourcePage('models', ModelLibrary);
        return;
    }
    setTimeout(registerWhenReady, 60);
})();
