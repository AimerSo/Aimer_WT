/**
 * AI功能免责声明模块
 *
 * 功能定位:
 * - 管理AI功能首次使用的免责声明弹窗
 * - 5秒倒计时后才能同意
 * - 拒绝则关闭AI聊天界面
 * - 每次打开AI都弹窗直到用户同意
 *
 * 业务关联:
 * - 上游: AIChat.open() 调用检查
 * - 下游: 控制AI聊天框的显示/隐藏
 */

const AIDisclaimer = {
    // 状态
    state: {
        hasAgreed: false,
        isShowing: false,
        countdown: 5,
        timer: null
    },

    // 初始化
    init() {
        this._createDOM();
        this._bindEvents();
        console.log('[AI] 免责声明模块已初始化');
    },

    // 创建DOM结构
    _createDOM() {
        // 检查是否已存在
        if (document.getElementById('modal-ai-disclaimer')) return;

        const modal = document.createElement('div');
        modal.id = 'modal-ai-disclaimer';
        modal.className = 'ai-disclaimer-modal';
        modal.innerHTML = `
            <div class="ai-disclaimer-overlay">
                <div class="ai-disclaimer-content">
                    <div class="ai-disclaimer-header">
                        <h2 class="ai-disclaimer-title">使用须知</h2>
                    </div>
                    
                    <div class="ai-disclaimer-body">
                        <div class="ai-disclaimer-section">
                            <p>关于AI功能：目前软件下载量近万，在开心的同时，压力也很大，基本每天都要熬夜修几个小时的BUG，做维护，但总有小伙伴源源不断的提出新问题，或者是已经被解答过的问题，所以为了能高效一点解决问题，我选择了花费几十个小时搓出来这个AI功能，无论好用与否，真心希望能够帮助到各位小伙伴。</p>
                            
                            <p>我不会对AI功能收费，服务器和API全都是我自掏腰包供大家使用，所以希望各位闲的无聊的时候也不要刷消息，尽量把额度留给有需要的人！</p>
                            
                            <p>而AI数据库内的问题和答案会不断增加（应该吧），不仅仅只是软件相关的问题，在我的设想中，游戏中的问题和一些BUG，通知，也是它能解答的，如果我的精力顾得过来，我会尽力把它打造成一个针对WT的好帮手。</p>
                            
                            <p>但也要多说一句，AI 不是人类，它有时候会一本正经胡说八道，也有它的局限性。希望大家在使用时能多一份理性，少一份盲从。</p>
                            
                            <p>如果在使用过程中有什么建议，或者发现了什么奇怪的Bug，欢迎随时反馈给我，感谢大家的理解与支持！</p>
                        </div>
                        
                        <div class="ai-disclaimer-divider"></div>
                        
                        <div class="ai-disclaimer-section">
                            <h3>AI 功能服务条款与免责声明</h3>
                            <p class="ai-disclaimer-date">发布日期：2026年2月18日</p>
                            
                            <p>感谢您使用本工具集成的生成式人工智能（以下简称"本AI功能"）。为了保障您的合法权益，明确软件作者（以下简称"作者"）与用户之间的权利义务关系，请在开启本功能前仔细阅读以下条款。一旦您开始输入指令或使用本功能，即视为您已完全理解并同意本声明的所有内容。</p>
                            
                            <h4>第一条：服务性质与内容生成免责</h4>
                            <p><strong>生成机制说明：</strong>本工具所呈现的所有文本、建议及解答均由生成式人工智能模型基于概率算法输出。其过程不涉及作者的人为干预，相关内容不代表作者的政治立场、价值判断或法律意见。</p>
                            
                            <p><strong>信息准确性风险：</strong>受限于模型的技术局限性，AI 生成的内容可能包含错误、不完整信息或"幻觉"（即虚构事实）。作者不对生成内容的准确性、时效性、完整性或实用性作任何形式的保证。</p>
                            
                            <p><strong>风险自担原则：</strong>用户应基于常识与专业知识对 AI 的输出结果进行审慎甄别。对于用户因信赖或使用本 AI 功能所产出的内容而导致的任何直接或间接损失（包括但不限于设备损坏、数据丢失、误导性决策及财产损失），作者不承担任何赔偿责任。</p>
                            
                            <h4>第二条：用户行为准则与禁止事项</h4>
                            <p>用户在使用本平台进行交互时，必须严格遵守所在地及服务器所在地法律法规。严禁诱导 AI 产生、上传或传播包含以下内容的指令或信息：</p>
                            <ul>
                                <li><strong>政治敏感信息：</strong>违反国家法律法规、危害国家安全、泄露国家秘密、颠覆国家政权、破坏国家统一的内容；</li>
                                <li><strong>非法内容：</strong>色情淫秽、虚假博彩、宣扬毒品及暴力恐怖主义等违法犯罪信息；</li>
                                <li><strong>仇恨与歧视：</strong>针对民族、种族、宗教、性别、残疾等群体的侮辱、歧视或煽动仇恨的内容；</li>
                                <li><strong>侵害他人权利：</strong>侵害他人名誉权、隐私权、著作权及商业秘密的行为；</li>
                                <li><strong>恶意攻击：</strong>通过自动化脚本、注入攻击等手段试图绕过合规性拦截，或对 AI 接口进行高频请求、逆向工程的行为。</li>
                            </ul>
                            
                            <h4>第三条：合规性监测与处罚机制</h4>
                            <p><strong>隐私说明：</strong>作者承诺不会主动存储、倒卖或公开披露用户的聊天记录。</p>
                            
                            <p><strong>监测机制：</strong>为维护公共秩序及履行合规义务，系统部署了实时关键词检测及多维度内容审计功能。用户的输入行为将被系统进行特征提取，用于违规判别。</p>
                            
                            <p><strong>违规处罚：</strong></p>
                            <ul>
                                <li><strong>预警与标记：</strong>若系统检测到轻微或疑似违规诱导，将向用户发出警告，并对该账户进行风险标记。</li>
                                <li><strong>永久封禁：</strong>若用户多次触发违规红线，或存在严重恶意攻击行为，系统将自动触发永久封禁机制，彻底终止该用户的所有 AI 访问权限。</li>
                                <li><strong>法律溯源：</strong>对于情节严重的违规行为，作者保留保存相关日志轨迹并依法移交给公安机关或相关司法行政部门处理的权利。</li>
                            </ul>
                            
                            <h4>第四条：服务稳定性与费用说明</h4>
                            <p><strong>服务局限性：</strong>由于本 AI 功能目前由作者个人自掏腰包维持服务器及 API 调用开销，属于非盈利性质的免费服务。作者不保证服务的 24 小时连续性与稳定性。</p>
                            
                            <p><strong>变更与终止：</strong>作者有权根据资金状况、监管要求或个人精力，在不预先通知的情况下调整 API 额度、限制访问频率、修改功能模块或彻底终止本 AI 服务的提供。</p>
                            
                            <h4>第五条：知识产权声明</h4>
                            <p>本 AI 功能产出的内容，其版权归属及使用风险由用户自行处理。若用户将生成内容用于商业用途，需自行确保不侵犯第三方权利。</p>
                            
                            <p>对于 AI 数据库中涉及的特定游戏（如 War Thunder 等）及软件的专有名称、商标及知识产权，均归属于其原始权利人。</p>
                            
                            <p>若您对上述声明有任何疑问，请通过官方反馈渠道联系作者。感谢您的理解与配合，让我们共同维护一个健康、理性的技术交流环境。</p>
                            
                            <p class="ai-disclaimer-author">作者：Aimer</p>
                        </div>
                    </div>
                    
                    <div class="ai-disclaimer-footer">
                        <span class="ai-disclaimer-timer" id="ai-disclaimer-timer">请阅读协议 (5s)</span>
                        <div class="ai-disclaimer-buttons">
                            <button class="ai-disclaimer-btn reject" id="ai-disclaimer-reject">拒绝</button>
                            <button class="ai-disclaimer-btn agree" id="ai-disclaimer-agree" disabled>同意</button>
                        </div>
                    </div>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
    },

    // 绑定事件
    _bindEvents() {
        const modal = document.getElementById('modal-ai-disclaimer');
        if (!modal) return;

        const agreeBtn = document.getElementById('ai-disclaimer-agree');
        const rejectBtn = document.getElementById('ai-disclaimer-reject');

        agreeBtn?.addEventListener('click', () => this._onAgree());
        rejectBtn?.addEventListener('click', () => this._onReject());
    },

    // 显示免责声明
    show() {
        if (this.state.hasAgreed) return true;
        
        const modal = document.getElementById('modal-ai-disclaimer');
        if (!modal) {
            this._createDOM();
            this._bindEvents();
        }

        this.state.isShowing = true;
        document.getElementById('modal-ai-disclaimer')?.classList.add('show');
        
        // 开始倒计时
        this._startCountdown();
        
        return false;
    },

    // 开始倒计时
    _startCountdown() {
        this.state.countdown = 5;
        const timerEl = document.getElementById('ai-disclaimer-timer');
        const agreeBtn = document.getElementById('ai-disclaimer-agree');
        
        if (timerEl) timerEl.textContent = `请阅读协议 (${this.state.countdown}s)`;
        if (agreeBtn) agreeBtn.disabled = true;
        
        // 清除之前的定时器
        if (this.state.timer) clearInterval(this.state.timer);
        
        this.state.timer = setInterval(() => {
            this.state.countdown--;
            
            if (timerEl) {
                timerEl.textContent = this.state.countdown > 0 
                    ? `请阅读协议 (${this.state.countdown}s)` 
                    : '请阅读协议';
            }
            
            if (this.state.countdown <= 0) {
                clearInterval(this.state.timer);
                if (agreeBtn) agreeBtn.disabled = false;
                if (timerEl) timerEl.textContent = '';
            }
        }, 1000);
    },

    // 隐藏弹窗
    hide() {
        this.state.isShowing = false;
        document.getElementById('modal-ai-disclaimer')?.classList.remove('show');
        
        if (this.state.timer) {
            clearInterval(this.state.timer);
            this.state.timer = null;
        }
    },

    // 同意
    _onAgree() {
        this.state.hasAgreed = true;
        this.hide();
        
        // 触发同意回调
        if (this.onAgreeCallback) {
            this.onAgreeCallback();
        }
    },

    // 拒绝
    _onReject() {
        this.hide();
        
        // 触发拒绝回调
        if (this.onRejectCallback) {
            this.onRejectCallback();
        }
    },

    // 设置同意回调
    onAgree(callback) {
        this.onAgreeCallback = callback;
    },

    // 设置拒绝回调
    onReject(callback) {
        this.onRejectCallback = callback;
    },

    // 重置同意状态（用于下次打开还弹窗）
    reset() {
        this.state.hasAgreed = false;
    }
};

// 导出
if (typeof module !== 'undefined' && module.exports) {
    module.exports = AIDisclaimer;
}
