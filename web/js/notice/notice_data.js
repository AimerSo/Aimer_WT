/* 公告数据与类型元信息模块 */
(function () {
    const DEFAULT_NOTICE_DATA = [
        {
            id: 1,
            type: 'update',
            tag: '更新',
            title: 'Aimer WT V3 重大更新',
            date: '今天',
            summary: 'V3 版本重点完成了交互与稳定性优化，补齐了多平台支持和多项核心功能，整体体验更完整、启动更可靠、扩展能力更强。',
            content: `# Aimer WT V3 重大更新

---

## 优化

* 优化交互操作（@Aimer，@Findoutsider）
* 标准化日志输出（@kyokusakin #12）
* 优化压缩包处理，可以处理带密码的压缩包（@Aimer，@Findoutsider #8）
* 将原本整个可拖动的界面改为仅标题栏可拖动（@Findoutsider #6）
* 支持linux下自动寻找游戏路径（@TNT569 #1）
* 优化炮镜库，可以自己选择UID添加炮镜（@kyokusaki #12）
* 优化语音包安装状态读取逻辑（@Findoutsider #5）
* 语音包现在可以选择模块进行安装，如：只安装陆战语音（@Findoutsider #16）
* 优化涂装库读取逻辑，避免了因为涂装过多导致的界面卡顿（@Findoutsider #16）

## 新增
* 增加对linux和macOS的支持（@kyokusaki #12， @TNT569 #1）
* 增加遥测功能，以便开发者了解用户使用情况和优化程序（@Findoutsider #16，@Aimer）
* 增加软件内启动游戏功能，支持直接调用官方客户端或Steam启动游戏（@Aimer）
* 增加语音包卡片详细信息界面（@Aimer）
* 增加教程引导，展示如何使用程序（@Aimer）
* 增加测试版AI功能，可以通过AI助手获取帮助，测试版随时可能下线（@Aimer）
* 增加用户反馈功能，可以在程序中直接反馈问题和建议（@Aimer）
* 增加开机启动功能（@Aimer）
* 增加任务库、模型库、机库内容管理框架（@Aimer）
* 增加自定义文本功能（@Findoutsider）
* 增加语音包试听功能（@Findoutsider,@Aimer）
* 增加更新公告功能（@Aimer）

## 修复
* 支持cp950编码（@Aimer）
* 彻底解决部分场景下的启动白屏问题，提升运行可靠性（@Aimer）
* 修复了一些其他问题（@Aimer，@Findoutsider）`,
            isPinned: true
        },
        {
            id: 2,
            type: 'update',
            tag: '更新',
            title: '测试标题',
            date: '20206年2月28日',
            content: '测试内容',
            isPinned: false
        },
        {
            id: 3,
            type: 'event',
            tag: '活动',
            title: '测试标题',
            date: '20206年2月28日',
            content: '测试内容',
            isPinned: false
        },
        {
            id: 4,
            type: 'normal',
            tag: '日常',
            title: '测试标题',
            date: '20206年2月28日',
            content: '测试内容',
            isPinned: false
        }
    ];

    function getNoticeTypeMeta(type) {
        switch (type) {
            case 'urgent':
                return { tagClass: 'notice-tag-urgent', iconClass: 'ri-tools-line' };
            case 'update':
                return { tagClass: 'notice-tag-update', iconClass: 'ri-flashlight-line' };
            case 'event':
                return { tagClass: 'notice-tag-event', iconClass: 'ri-sparkling-2-line' };
            default:
                return { tagClass: 'notice-tag-normal', iconClass: 'ri-notification-3-line' };
        }
    }

    function cloneDefaultNoticeData() {
        return JSON.parse(JSON.stringify(DEFAULT_NOTICE_DATA));
    }

    function normalizeNoticeItem(item, index) {
        const safe = item || {};
        return {
            id: safe.id != null ? safe.id : index + 1,
            type: safe.type || 'normal',
            tag: safe.tag || '日常',
            title: safe.title || '未命名公告',
            date: safe.date || '',
            summary: safe.summary || '',
            content: safe.content || '',
            isPinned: !!safe.isPinned
        };
    }

    function normalizeNoticeData(data) {
        const src = Array.isArray(data) ? data : [];
        if (!src.length) return [];
        return src.map((item, index) => normalizeNoticeItem(item, index));
    }

    window.NoticeDataModule = {
        getNoticeTypeMeta: getNoticeTypeMeta,
        getDefaultNoticeData: cloneDefaultNoticeData,
        normalizeNoticeData: normalizeNoticeData
    };
})();
