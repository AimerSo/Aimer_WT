/* ============================================================
 * ImageCropper — 可复用的图片裁剪/定位组件
 *
 * 功能：在固定比例的裁剪框内拖拽移动和缩放图片，
 *       通过 Canvas 导出裁剪结果为 Blob。
 *
 * 用法:
 *   const cropper = new ImageCropper(containerEl, {
 *     aspectRatio: 640 / 380,  // 裁剪框宽高比
 *     outputWidth: 640,        // 导出宽度
 *     outputHeight: 380        // 导出高度
 *   });
 *   cropper.loadImage(file_or_url);
 *   const blob = await cropper.crop();
 * ============================================================ */
(function () {
    'use strict';

    const ZOOM_MIN = 1;
    const ZOOM_MAX = 5;
    const ZOOM_STEP = 0.002;

    class ImageCropper {
        /**
         * @param {HTMLElement} container  挂载容器
         * @param {Object}     opts       配置项
         * @param {number}     opts.aspectRatio   裁剪框宽高比（默认 640/380）
         * @param {number}     opts.outputWidth   导出宽度（默认 640）
         * @param {number}     opts.outputHeight  导出高度（默认 380）
         * @param {Function}   opts.onChange       裁剪参数变化回调
         */
        constructor(container, opts = {}) {
            this.container = container;
            this.aspectRatio = opts.aspectRatio || (640 / 380);
            this.outputWidth = opts.outputWidth || 640;
            this.outputHeight = opts.outputHeight || 380;
            this.onChange = opts.onChange || null;

            this._img = null;         // HTMLImageElement
            this._naturalW = 0;
            this._naturalH = 0;
            this._zoom = 1;           // 当前缩放
            this._panX = 0;           // 图片偏移 px (相对于容器)
            this._panY = 0;
            this._dragging = false;
            this._dragStartX = 0;
            this._dragStartY = 0;
            this._panStartX = 0;
            this._panStartY = 0;

            this._build();
            this._bindEvents();
        }

        /* ---- 构建 DOM ---- */
        _build() {
            this.container.innerHTML = '';
            this.container.classList.add('img-cropper');

            // 裁剪视口
            this._viewport = document.createElement('div');
            this._viewport.className = 'img-cropper-viewport';
            this._viewport.style.paddingBottom = (1 / this.aspectRatio * 100) + '%';

            this._inner = document.createElement('div');
            this._inner.className = 'img-cropper-inner';
            this._viewport.appendChild(this._inner);

            // 占位提示
            this._placeholder = document.createElement('div');
            this._placeholder.className = 'img-cropper-placeholder';
            this._placeholder.innerHTML = `
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                     stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="opacity:0.4;margin-bottom:6px;">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                    <polyline points="17 8 12 3 7 8"></polyline>
                    <line x1="12" y1="3" x2="12" y2="15"></line>
                </svg>
                <div style="font-size:12px;">点击上传或拖拽图片</div>
                <div style="font-size:10px;margin-top:3px;opacity:0.6;">JPG / PNG / WebP，推荐 640×380</div>`;
            this._inner.appendChild(this._placeholder);

            // 图片层
            this._imgEl = document.createElement('img');
            this._imgEl.className = 'img-cropper-image';
            this._imgEl.draggable = false;
            this._imgEl.style.display = 'none';
            this._inner.appendChild(this._imgEl);

            this.container.appendChild(this._viewport);

            // 控制栏
            this._controls = document.createElement('div');
            this._controls.className = 'img-cropper-controls';
            this._controls.style.display = 'none';
            this._controls.innerHTML = `
                <div class="img-cropper-zoom-row">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                         stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <circle cx="11" cy="11" r="8"></circle>
                        <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                        <line x1="8" y1="11" x2="14" y2="11"></line>
                    </svg>
                    <input type="range" class="img-cropper-slider" min="100" max="500" value="100">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                         stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <circle cx="11" cy="11" r="8"></circle>
                        <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                        <line x1="11" y1="8" x2="11" y2="14"></line>
                        <line x1="8" y1="11" x2="14" y2="11"></line>
                    </svg>
                    <span class="img-cropper-zoom-label">100%</span>
                    <button type="button" class="img-cropper-reset-btn" title="重置">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                             stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <polyline points="23 4 23 10 17 10"></polyline>
                            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
                        </svg>
                    </button>
                </div>
                <div class="img-cropper-hint">拖拽图片调整位置，滚轮或滑块缩放</div>`;
            this.container.appendChild(this._controls);

            // 隐藏的文件 input
            this._fileInput = document.createElement('input');
            this._fileInput.type = 'file';
            this._fileInput.accept = 'image/jpeg,image/png,image/webp,image/gif';
            this._fileInput.style.display = 'none';
            this.container.appendChild(this._fileInput);

            // 缓存控件引用
            this._slider = this._controls.querySelector('.img-cropper-slider');
            this._zoomLabel = this._controls.querySelector('.img-cropper-zoom-label');
            this._resetBtn = this._controls.querySelector('.img-cropper-reset-btn');
        }

        /* ---- 事件绑定 ---- */
        _bindEvents() {
            // 点击占位区打开文件选择
            this._placeholder.addEventListener('click', (e) => {
                e.stopPropagation();
                this._fileInput.click();
            });

            // 文件选择
            this._fileInput.addEventListener('change', (e) => {
                if (e.target.files?.[0]) this.loadImageFile(e.target.files[0]);
                e.target.value = '';
            });

            // 拖拽文件到视口
            this._viewport.addEventListener('dragover', (e) => {
                e.preventDefault();
                this._viewport.classList.add('img-cropper-dragover');
            });
            this._viewport.addEventListener('dragleave', () => {
                this._viewport.classList.remove('img-cropper-dragover');
            });
            this._viewport.addEventListener('drop', (e) => {
                e.preventDefault();
                this._viewport.classList.remove('img-cropper-dragover');
                if (e.dataTransfer.files?.[0]) this.loadImageFile(e.dataTransfer.files[0]);
            });

            // 图片拖拽
            this._inner.addEventListener('mousedown', (e) => this._onDragStart(e));
            document.addEventListener('mousemove', (e) => this._onDragMove(e));
            document.addEventListener('mouseup', () => this._onDragEnd());

            // 触屏支持
            this._inner.addEventListener('touchstart', (e) => this._onTouchStart(e), { passive: false });
            this._inner.addEventListener('touchmove', (e) => this._onTouchMove(e), { passive: false });
            this._inner.addEventListener('touchend', () => this._onDragEnd());

            // 滚轮缩放
            this._inner.addEventListener('wheel', (e) => {
                e.preventDefault();
                if (!this._img) return;
                const delta = -e.deltaY * ZOOM_STEP;
                this._setZoom(this._zoom + delta);
            }, { passive: false });

            // 滑块缩放
            this._slider.addEventListener('input', () => {
                this._setZoom(parseInt(this._slider.value) / 100);
            });

            // 重置按钮
            this._resetBtn.addEventListener('click', () => this._fitImage());
        }

        /* ---- 加载图片 ---- */
        loadImageFile(file) {
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = (e) => {
                    this._loadSrc(e.target.result).then(resolve).catch(reject);
                };
                reader.onerror = reject;
                reader.readAsDataURL(file);
            });
        }

        loadImageUrl(url) {
            return this._loadSrc(url);
        }

        _loadSrc(src) {
            return new Promise((resolve, reject) => {
                const img = new Image();
                img.crossOrigin = 'anonymous';
                img.onload = () => {
                    this._img = img;
                    this._naturalW = img.naturalWidth;
                    this._naturalH = img.naturalHeight;
                    this._imgEl.src = src;
                    this._imgEl.style.display = 'block';
                    this._placeholder.style.display = 'none';
                    this._controls.style.display = '';
                    this._inner.style.cursor = 'grab';
                    this._fitImage();
                    resolve();
                };
                img.onerror = () => reject(new Error('图片加载失败'));
                img.src = src;
            });
        }

        /* 使图片适配裁剪框（cover 模式：短边贴合） */
        _fitImage() {
            if (!this._img) return;
            const rect = this._inner.getBoundingClientRect();
            const cw = rect.width, ch = rect.height;
            if (!cw || !ch) return;

            const scaleW = cw / this._naturalW;
            const scaleH = ch / this._naturalH;
            this._zoom = Math.max(scaleW, scaleH);

            const imgW = this._naturalW * this._zoom;
            const imgH = this._naturalH * this._zoom;
            this._panX = (cw - imgW) / 2;
            this._panY = (ch - imgH) / 2;

            this._applyTransform();
            this._slider.value = Math.round(this._zoom * 100);
            this._zoomLabel.textContent = Math.round(this._zoom * 100) + '%';
            this._slider.min = Math.round(this._zoom * 100);
        }

        /* ---- 缩放 ---- */
        _setZoom(newZoom) {
            const rect = this._inner.getBoundingClientRect();
            const cw = rect.width, ch = rect.height;
            const minZoom = Math.max(cw / this._naturalW, ch / this._naturalH);
            newZoom = Math.max(minZoom, Math.min(ZOOM_MAX, newZoom));

            // 以容器中心为锚点缩放
            const cx = cw / 2, cy = ch / 2;
            const ratio = newZoom / this._zoom;
            this._panX = cx - (cx - this._panX) * ratio;
            this._panY = cy - (cy - this._panY) * ratio;
            this._zoom = newZoom;

            this._clampPan();
            this._applyTransform();
            this._slider.value = Math.round(newZoom * 100);
            this._slider.min = Math.round(minZoom * 100);
            this._zoomLabel.textContent = Math.round(newZoom * 100) + '%';
        }

        /* ---- 拖拽 ---- */
        _onDragStart(e) {
            if (!this._img) return;
            e.preventDefault();
            this._dragging = true;
            this._dragStartX = e.clientX;
            this._dragStartY = e.clientY;
            this._panStartX = this._panX;
            this._panStartY = this._panY;
            this._inner.style.cursor = 'grabbing';
        }

        _onDragMove(e) {
            if (!this._dragging) return;
            this._panX = this._panStartX + (e.clientX - this._dragStartX);
            this._panY = this._panStartY + (e.clientY - this._dragStartY);
            this._clampPan();
            this._applyTransform();
        }

        _onDragEnd() {
            if (!this._dragging) return;
            this._dragging = false;
            this._inner.style.cursor = this._img ? 'grab' : 'default';
            if (this.onChange) this.onChange();
        }

        /* 触屏事件 */
        _onTouchStart(e) {
            if (!this._img || e.touches.length !== 1) return;
            e.preventDefault();
            const t = e.touches[0];
            this._dragging = true;
            this._dragStartX = t.clientX;
            this._dragStartY = t.clientY;
            this._panStartX = this._panX;
            this._panStartY = this._panY;
        }

        _onTouchMove(e) {
            if (!this._dragging || e.touches.length !== 1) return;
            e.preventDefault();
            const t = e.touches[0];
            this._panX = this._panStartX + (t.clientX - this._dragStartX);
            this._panY = this._panStartY + (t.clientY - this._dragStartY);
            this._clampPan();
            this._applyTransform();
        }

        /* 限制平移不超出裁剪框 */
        _clampPan() {
            const rect = this._inner.getBoundingClientRect();
            const cw = rect.width, ch = rect.height;
            const imgW = this._naturalW * this._zoom;
            const imgH = this._naturalH * this._zoom;
            this._panX = Math.min(0, Math.max(cw - imgW, this._panX));
            this._panY = Math.min(0, Math.max(ch - imgH, this._panY));
        }

        _applyTransform() {
            const imgW = this._naturalW * this._zoom;
            const imgH = this._naturalH * this._zoom;
            this._imgEl.style.width = imgW + 'px';
            this._imgEl.style.height = imgH + 'px';
            this._imgEl.style.transform = `translate(${this._panX}px, ${this._panY}px)`;
        }

        /* ---- 导出裁剪结果 ---- */
        crop(type = 'image/webp', quality = 0.85) {
            return new Promise((resolve) => {
                if (!this._img) { resolve(null); return; }
                const rect = this._inner.getBoundingClientRect();
                const cw = rect.width, ch = rect.height;
                if (!cw || !ch) { resolve(null); return; }

                // 计算裁剪框对应的原图区域
                const sx = -this._panX / this._zoom;
                const sy = -this._panY / this._zoom;
                const sw = cw / this._zoom;
                const sh = ch / this._zoom;

                const canvas = document.createElement('canvas');
                canvas.width = this.outputWidth;
                canvas.height = this.outputHeight;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(this._img, sx, sy, sw, sh, 0, 0, this.outputWidth, this.outputHeight);
                canvas.toBlob((blob) => resolve(blob), type, quality);
            });
        }

        /* ---- 重置到空状态 ---- */
        clear() {
            this._img = null;
            this._imgEl.src = '';
            this._imgEl.style.display = 'none';
            this._placeholder.style.display = '';
            this._controls.style.display = 'none';
            this._inner.style.cursor = 'default';
        }

        /* 检查是否已加载图片 */
        hasImage() {
            return !!this._img;
        }

        /* 手动触发文件选择 */
        openFilePicker() {
            this._fileInput.click();
        }

        /* 销毁实例 */
        destroy() {
            this.container.innerHTML = '';
        }
    }

    window.ImageCropper = ImageCropper;
})();
