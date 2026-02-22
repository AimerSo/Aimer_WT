/**
 * 教程内容检测器
 * 
 * 功能定位:
 * - 检测当前页面显示的教程/帮助内容
 * - 为AI提供软件功能上下文
 * 
 * 业务关联:
 * - 上游: 软件各功能页面
 * - 下游: AI上下文管理器
 */

const TutorialDetector = {
    // 已知的功能页面和对应的教程内容
    _tutorials: {
        'page-home': {
            title: '主页',
            description: '显示软件概览、游戏路径设置和快捷操作。',
            features: [
                '设置或自动搜索战争雷霆游戏路径',
                '查看当前已安装的语音包',
                '快速访问常用功能'
            ],
            tips: [
                '首次使用请先设置游戏路径',
                '可以使用自动搜索功能快速定位游戏'
            ]
        },
        'page-lib': {
            title: '语音包库',
            description: '管理语音包资源，支持导入、安装和还原。',
            features: [
                '浏览已导入的语音包',
                '安装语音包到游戏',
                '从游戏还原语音包',
                '导入ZIP/RAR格式的语音包'
            ],
            tips: [
                '语音包需要先导入到库中才能安装',
                '安装前会自动备份当前语音包',
                '支持批量导入待解压区的压缩包'
            ]
        },
        'page-camo': {
            title: '副功能库',
            description: '管理涂装和自定义内容。',
            features: [
                '浏览UserSkins文件夹中的涂装',
                '导入新的涂装ZIP文件',
                '管理涂装封面图片',
                '重命名涂装文件夹'
            ],
            tips: [
                '涂装文件需要放在UserSkins文件夹中',
                '支持为涂装设置预览图片',
                '涂装需要在游戏内启用才能看到效果'
            ]
        },
        'page-sight': {
            title: '信息库',
            description: '软件信息中心，提供支持入口、社区链接和快速访问功能。',
            features: [
                '支持开发者（请喝蜜雪冰城）',
                '加入QQ群讨论和反馈BUG',
                '查看飞书云文档使用教程',
                '访问作者B站主页',
                '快速链接：战争雷霆官网、WT Live、GitHub等'
            ],
            tips: [
                '遇到问题可以先查看使用文档',
                '加入QQ群可以与其他用户交流',
                '快速链接可以直接跳转到常用网站'
            ]
        },
        'page-settings': {
            title: '设置',
            description: '配置软件各项参数。',
            features: [
                '设置游戏路径',
                '配置语音包库和待解压区路径',
                '设置炮镜路径',
                '切换主题',
                '管理AI助手设置'
            ],
            tips: [
                '路径设置支持手动选择和自动搜索',
                '可以自定义语音包库的存储位置',
                '主题切换会立即生效'
            ]
        }
    },
    
    // 获取当前活动页面的教程信息
    getCurrentPageTutorial() {
        const activePage = document.querySelector('.page.active');
        if (!activePage) return null;
        
        const pageId = activePage.id;
        return this._tutorials[pageId] || null;
    },
    
    // 获取当前页面的硬编码文字内容
    getCurrentPageContent() {
        const activePage = document.querySelector('.page.active');
        if (!activePage) return '';
        
        // 提取页面中的重要文字内容
        const content = {
            title: '',
            sections: [],
            buttons: [],
            labels: []
        };
        
        // 获取页面标题
        const titleEl = activePage.querySelector('h1, h2, .page-title');
        if (titleEl) {
            content.title = titleEl.textContent.trim();
        }
        
        // 获取区块标题
        const sectionTitles = activePage.querySelectorAll('h3, h4, .section-title, .card-title');
        sectionTitles.forEach(el => {
            content.sections.push(el.textContent.trim());
        });
        
        // 获取按钮文字
        const buttons = activePage.querySelectorAll('button, .btn');
        buttons.forEach(btn => {
            const text = btn.textContent.trim();
            if (text && text.length < 50) {
                content.buttons.push(text);
            }
        });
        
        // 获取标签文字
        const labels = activePage.querySelectorAll('label, .label, .desc');
        labels.forEach(label => {
            const text = label.textContent.trim();
            if (text && text.length < 100) {
                content.labels.push(text);
            }
        });
        
        return content;
    },
    
    // 获取当前页面上下文（用于AI）
    getContextForAI() {
        const tutorial = this.getCurrentPageTutorial();
        const content = this.getCurrentPageContent();
        
        if (!tutorial) {
            return '用户当前在未知页面。';
        }
        
        let context = `用户当前在"${tutorial.title}"页面。\n\n`;
        context += `页面功能：${tutorial.description}\n\n`;
        
        if (tutorial.features && tutorial.features.length > 0) {
            context += '主要功能：\n';
            tutorial.features.forEach(f => {
                context += `- ${f}\n`;
            });
            context += '\n';
        }
        
        if (tutorial.tips && tutorial.tips.length > 0) {
            context += '使用提示：\n';
            tutorial.tips.forEach(t => {
                context += `- ${t}\n`;
            });
            context += '\n';
        }
        
        // 添加当前页面检测到的内容
        if (content.title) {
            context += `当前页面标题：${content.title}\n`;
        }
        
        if (content.sections.length > 0) {
            context += `页面区块：${content.sections.join('、')}\n`;
        }
        
        return context;
    },
    
    // 检测特定功能是否可用
    isFeatureAvailable(featureName) {
        const activePage = document.querySelector('.page.active');
        if (!activePage) return false;
        
        const pageId = activePage.id;
        const tutorial = this._tutorials[pageId];
        
        if (!tutorial || !tutorial.features) return false;
        
        return tutorial.features.some(f => f.includes(featureName));
    },
    
    // 获取所有可用的功能列表
    getAllAvailableFeatures() {
        const activePage = document.querySelector('.page.active');
        if (!activePage) return [];
        
        const pageId = activePage.id;
        const tutorial = this._tutorials[pageId];
        
        return tutorial?.features || [];
    },
    
    // 注册自定义教程内容（用于动态页面）
    registerTutorial(pageId, tutorialData) {
        this._tutorials[pageId] = tutorialData;
    }
};

window.TutorialDetector = TutorialDetector;
