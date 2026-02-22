/**
 * AppDropdownMenu - 自定义下拉菜单组件
 * 用于替换原生 <select> 元素，提供统一的样式和交互
 */

class AppDropdownMenu {
    /**
     * @param {Object} config - 配置对象
     * @param {string} config.id - 下拉菜单唯一标识
     * @param {string} config.containerId - 容器元素ID（用于渲染）
     * @param {Array} config.options - 选项数组 [{value, label, icon?}]
     * @param {string} config.placeholder - 占位符文本
     * @param {Function} config.onChange - 选项改变时的回调函数
     * @param {boolean} config.dynamic - 是否支持动态更新选项
     * @param {string} config.width - 宽度（默认 100%）
     * @param {string} config.size - 尺寸（sm, md, lg）
     */
    constructor(config) {
        this.id = config.id;
        this.containerId = config.containerId || `${config.id}-wrapper`;
        this.options = config.options || [];
        this.placeholder = config.placeholder || '请选择';
        this.onChange = config.onChange || (() => {});
        this.dynamic = config.dynamic !== false;
        this.width = config.width || '100%';
        this.size = config.size || 'md';

        this.currentValue = null;
        this.isOpen = false;
        this.container = null;
        this.triggerEl = null;
        this.dropdownEl = null;
        this.textEl = null;

        // 绑定方法到实例
        this.toggle = this.toggle.bind(this);
        this.close = this.close.bind(this);
        this.handleClickOutside = this.handleClickOutside.bind(this);

        // 初始化
        this.init();
    }

    /**
     * 初始化组件
     */
    init() {
        this.render();
        this.attachEvents();
    }

    /**
     * 渲染组件HTML
     */
    render() {
        const container = document.getElementById(this.containerId);
        if (!container) {
            console.error(`AppDropdownMenu: Container #${this.containerId} not found`);
            return;
        }

        this.container = container;
        container.className = 'app-dropdown-wrapper';
        container.style.width = this.width;

        const heightClass = this.getHeightClass();
        const selectedLabel = this.getSelectedLabel();

        container.innerHTML = `
            <div class="app-dropdown-trigger ${heightClass}" data-dropdown-id="${this.id}">
                <span class="app-dropdown-text">${selectedLabel}</span>
                <i class="ri-arrow-down-s-line app-dropdown-arrow"></i>
            </div>
            <div class="app-dropdown-menu" id="${this.id}-menu">
                ${this.renderOptions()}
            </div>
        `;

        this.triggerEl = container.querySelector('.app-dropdown-trigger');
        this.dropdownEl = container.querySelector('.app-dropdown-menu');
        this.textEl = container.querySelector('.app-dropdown-text');
    }

    /**
     * 获取高度样式类
     */
    getHeightClass() {
        const heightMap = {
            sm: 'height-32',
            md: 'height-42',
            lg: 'height-48'
        };
        return heightMap[this.size] || heightMap.md;
    }

    /**
     * 渲染选项列表
     */
    renderOptions() {
        if (this.options.length === 0) {
            return '<div class="app-dropdown-empty">暂无选项</div>';
        }

        return this.options.map(opt => `
            <div class="app-dropdown-option ${opt.value === this.currentValue ? 'selected' : ''}"
                 data-value="${opt.value}"
                 data-dropdown-id="${this.id}">
                ${opt.icon ? `<i class="${opt.icon}"></i>` : ''}
                <span>${opt.label}</span>
            </div>
        `).join('');
    }

    /**
     * 获取当前选中项的显示文本
     */
    getSelectedLabel() {
        const selected = this.options.find(opt => opt.value === this.currentValue);
        return selected ? selected.label : this.placeholder;
    }

    /**
     * 绑定事件
     */
    attachEvents() {
        if (!this.triggerEl) return;

        // 触发按钮点击
        this.triggerEl.addEventListener('click', this.toggle);

        // 选项点击
        this.dropdownEl.addEventListener('click', (e) => {
            const option = e.target.closest('.app-dropdown-option');
            if (option) {
                const value = option.dataset.value;
                this.select(value);
            }
        });

        // 点击外部关闭
        document.addEventListener('click', this.handleClickOutside);
    }

    /**
     * 处理点击外部
     */
    handleClickOutside(e) {
        if (this.container && !this.container.contains(e.target)) {
            this.close();
        }
    }

    /**
     * 切换下拉菜单显示/隐藏
     */
    toggle() {
        if (this.isOpen) {
            this.close();
        } else {
            this.open();
        }
    }

    /**
     * 打开下拉菜单
     */
    open() {
        // 先关闭其他下拉菜单
        document.querySelectorAll('.app-dropdown-wrapper.active').forEach(el => {
            if (el !== this.container) {
                el.classList.remove('active');
            }
        });

        this.container.classList.add('active');
        this.isOpen = true;
    }

    /**
     * 关闭下拉菜单
     */
    close() {
        if (this.container) {
            this.container.classList.remove('active');
        }
        this.isOpen = false;
    }

    /**
     * 选择选项
     * @param {string} value - 选项值
     * @param {boolean} triggerCallback - 是否触发回调
     */
    select(value, triggerCallback = true) {
        const oldValue = this.currentValue;
        this.currentValue = value;

        // 更新显示文本
        if (this.textEl) {
            this.textEl.textContent = this.getSelectedLabel();
        }

        // 更新选中状态样式
        this.dropdownEl.querySelectorAll('.app-dropdown-option').forEach(opt => {
            opt.classList.toggle('selected', opt.dataset.value === value);
        });

        // 关闭下拉菜单
        this.close();

        // 触发回调
        if (triggerCallback && value !== oldValue) {
            this.onChange(value, this.getSelectedOption());
        }
    }

    /**
     * 获取当前选中的选项对象
     */
    getSelectedOption() {
        return this.options.find(opt => opt.value === this.currentValue);
    }

    /**
     * 获取当前值
     */
    getValue() {
        return this.currentValue;
    }

    /**
     * 设置当前值
     */
    setValue(value, triggerCallback = false) {
        this.select(value, triggerCallback);
    }

    /**
     * 动态更新选项
     * @param {Array} options - 新选项数组
     * @param {boolean} keepSelection - 是否保留当前选择
     */
    setOptions(options, keepSelection = true) {
        this.options = options;

        if (this.dropdownEl) {
            this.dropdownEl.innerHTML = this.renderOptions();
        }

        // 如果当前值不在新选项中，重置选择
        if (!keepSelection || !options.find(opt => opt.value === this.currentValue)) {
            this.currentValue = options.length > 0 ? options[0].value : null;
        }

        // 更新显示
        if (this.textEl) {
            this.textEl.textContent = this.getSelectedLabel();
        }
    }

    /**
     * 添加选项
     */
    addOption(option) {
        this.options.push(option);
        if (this.dropdownEl) {
            this.dropdownEl.innerHTML = this.renderOptions();
        }
    }

    /**
     * 移除选项
     */
    removeOption(value) {
        this.options = this.options.filter(opt => opt.value !== value);
        if (this.dropdownEl) {
            this.dropdownEl.innerHTML = this.renderOptions();
        }
        if (this.currentValue === value) {
            this.currentValue = this.options.length > 0 ? this.options[0].value : null;
            if (this.textEl) {
                this.textEl.textContent = this.getSelectedLabel();
            }
        }
    }

    /**
     * 清空选项
     */
    clear() {
        this.options = [];
        this.currentValue = null;
        if (this.dropdownEl) {
            this.dropdownEl.innerHTML = this.renderOptions();
        }
        if (this.textEl) {
            this.textEl.textContent = this.placeholder;
        }
    }

    /**
     * 销毁组件
     */
    destroy() {
        document.removeEventListener('click', this.handleClickOutside);
        if (this.triggerEl) {
            this.triggerEl.removeEventListener('click', this.toggle);
        }
        if (this.container) {
            this.container.innerHTML = '';
        }
    }
}

// 全局注册
window.AppDropdownMenu = AppDropdownMenu;
