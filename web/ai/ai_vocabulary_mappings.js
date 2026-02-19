/**
 * AI 词汇映射词典
 *
 * 功能定位:
 * - 将AI输出的特殊标签转换为可视化元素（颜表情、样式等）
 * - 统一管理AI与前端交互的标记语言
 * - 支持扩展更多标签类型
 *
 * 业务关联:
 * - 上游: AI助手输出的带标签文本
 * - 下游: ai_chat.js 渲染层，将标签转换为UI元素
 *
 * 使用方式:
 *     import { convertEmotionTags, extractEmotions } from './ai_vocabulary_mappings.js';
 *     const text = "今天天气真好§1";
 *     const converted = convertEmotionTags(text);
 *     // 结果: "今天天气真好(≧▽≦)"
 */

// 情绪标签映射表
// AI输出格式: §数字
// 前端显示: 对应的颜表情（随机选择）
const EMOTION_MAPPINGS = {
    "§1": {
        name: "开心",
        description: "积极、愉快、高兴的情绪",
        styleClass: "emotion-happy",
        faces: [
            "(๑•̀ㅂ•́)و✧",
            "(≧▽≦)",
            "(๑˃̵ᴗ˂̵)و",
            "(づ￣ ³￣)づ",
            "(๑>◡<๑)",
            "(✧ω✧)",
            "(˶ᐢωᐢ˶)",
            "٩(ˊᗜˋ*)و",
            "(✿◕‿◕✿)",
            "( ˶'ᵕ'˶)੭"
        ]
    },
    "§2": {
        name: "难过",
        description: "失落、伤心、沮丧的情绪",
        styleClass: "emotion-sad",
        faces: [
            "(╥﹏╥)",
            "(｡•́︿•̀｡)",
            "(っ˘̩╭╮˘̩)っ",
            "(；へ：)",
            "(ಥ﹏ಥ)",
            "( ˃̣̣̥᷄ ‸ ˃̣̣̥᷅ )",
            "( ´•̥̥̥ ‸ •̥̥̥` )"
        ]
    },
    "§3": {
        name: "生气",
        description: "不满、烦躁的情绪（可爱版，不凶狠）",
        styleClass: "emotion-angry",
        faces: [
            "٩(๑`^´๑)۶",
            "(๑•ૅㅂ•́)ง",
            "(｡•ˇ‸ˇ•｡)",
            "(๑`^´๑)",
            "(╬ Ò﹏Ó)",
            "(๑•̀ ₃ •́๑)"
        ]
    },
    "§4": {
        name: "害怕",
        description: "紧张、担忧的情绪（可爱弱化版）",
        styleClass: "emotion-afraid",
        faces: [
            "〣( ºΔº )〣",
            "(⁄ ⁄•⁄ω⁄•⁄ ⁄)",
            "(｡>﹏<｡)",
            "(๑•﹏•)",
            "(｡•́﹏•̀｡)",
            "(°△°|||)",
            "(๑º△º๑)",
            "(>_<。)",
            "(๑•̆﹏•̆๑)"
        ]
    },
    "§5": {
        name: "惊讶",
        description: "意外、震惊的情绪（可爱风）",
        styleClass: "emotion-surprised",
        faces: [
            "Σ(๑ °꒳° ๑)",
            "(ﾟдﾟ)",
            "(๑ʘㅁʘ๑)",
            "(⊙_⊙)",
            "(๑°ㅁ°๑)‼",
            "(°ロ°) !",
            "(๑°⌓°๑)",
            "(✪ω✪)",
            "(๑°ㅂ°๑)"
        ]
    },
    "§6": {
        name: "疲惫",
        description: "无奈、疲倦的情绪（软萌风）",
        styleClass: "emotion-tired",
        faces: [
            "( ¯꒳¯ )ᐝ",
            "(ノ_<。)",
            "(๑•́ ₃ •̀๑)",
            "(｡•́︿•̀｡)ぅ",
            "(￣ω￣;)",
            "(๑˘︶˘๑)"
        ]
    },
    "§7": {
        name: "平静",
        description: "安心、平和的情绪（温柔可爱）",
        styleClass: "emotion-calm",
        faces: [
            "(￣︶￣)",
            "(๑˘︶˘๑)",
            "(｡◕‿◕｡)",
            "( ◡‿◡ *)",
            "( ◌•ω•◌)"
        ]
    }
};

// 情绪标签正则表达式
const EMOTION_PATTERN = /§[1-7]/g;

/**
 * 获取随机整数
 * @param {number} max - 最大值（不包含）
 * @returns {number} - 0 到 max-1 的随机整数
 */
function getRandomInt(max) {
    return Math.floor(Math.random() * max);
}

/**
 * 将文本中的情绪标签转换为指定格式
 *
 * @param {string} text - 包含情绪标签的原始文本
 * @param {string} outputFormat - 输出格式 ("face" | "name" | "html" | "all_faces")
 *     - face: 随机选择一个颜表情 (默认)
 *     - name: 转换为情绪名称
 *     - html: 转换为带样式的HTML标签（随机颜表情）
 *     - all_faces: 显示该情绪的所有颜表情选项
 * @returns {string} - 转换后的文本
 *
 * @example
 * convertEmotionTags("你好呀§1");
 * // 返回: "你好呀(≧▽≦)" 或 "你好呀(๑>◡<๑)" 等随机一个
 *
 * @example
 * convertEmotionTags("失败了§2", "name");
 * // 返回: "失败了[难过]"
 */
function convertEmotionTags(text, outputFormat = "face") {
    if (!text || typeof text !== "string") {
        return text;
    }

    return text.replace(EMOTION_PATTERN, (tag) => {
        const mapping = EMOTION_MAPPINGS[tag];

        if (!mapping) {
            return tag;
        }

        switch (outputFormat) {
            case "face":
                const faces = mapping.faces;
                return faces[getRandomInt(faces.length)];
            case "name":
                return `[${mapping.name}]`;
            case "html":
                const randomFace = mapping.faces[getRandomInt(mapping.faces.length)];
                return `<span class="${mapping.styleClass}">${randomFace}</span>`;
            case "all_faces":
                return `[${mapping.faces.join(", ")}]`;
            default:
                return tag;
        }
    });
}

/**
 * 从文本中提取所有情绪标签信息
 *
 * @param {string} text - 包含情绪标签的文本
 * @param {string} selectFace - 选择哪个颜表情 ("first" | "random" | "all")
 * @returns {Array} - 情绪信息列表，每项包含标签、颜表情、名称、所有可选颜表情
 *
 * @example
 * extractEmotions("今天§1但是§2");
 * // 返回: [{tag: "§1", face: "(๑•̀ㅂ•́)و✧", name: "开心", allFaces: [...]}, ...]
 */
function extractEmotions(text, selectFace = "first") {
    if (!text || typeof text !== "string") {
        return [];
    }

    const emotions = [];
    let match;

    // 重置正则表达式
    EMOTION_PATTERN.lastIndex = 0;

    while ((match = EMOTION_PATTERN.exec(text)) !== null) {
        const tag = match[0];
        const mapping = EMOTION_MAPPINGS[tag];

        if (mapping) {
            const faces = mapping.faces;
            let selected;

            if (selectFace === "first") {
                selected = faces[0];
            } else if (selectFace === "random") {
                selected = faces[getRandomInt(faces.length)];
            } else {
                selected = faces;
            }

            emotions.push({
                tag: tag,
                face: selected,
                name: mapping.name,
                allFaces: faces
            });
        }
    }

    return emotions;
}

/**
 * 移除文本中的所有情绪标签
 *
 * @param {string} text - 包含情绪标签的文本
 * @returns {string} - 移除标签后的纯文本
 */
function removeEmotionTags(text) {
    if (!text || typeof text !== "string") {
        return text;
    }

    return text.replace(EMOTION_PATTERN, "").trim();
}

/**
 * 处理AI回复消息，转换其中的情绪标签
 * 这是供 ai_chat.js 调用的主要接口
 *
 * @param {string} message - AI原始回复消息
 * @returns {string} - 处理后的消息（颜表情已替换）
 */
function processAIResponse(message) {
    return convertEmotionTags(message, "face");
}

// 预留扩展区域：其他类型的标签映射
// 可按需添加：动作标签、强调标签、角色状态标签等

// 示例扩展结构：
// const ACTION_MAPPINGS = {
//     "@wave": "👋",
//     "@think": "🤔",
// };

// 导出到全局对象（浏览器环境）
window.AIVocabularyMappings = {
    EMOTION_MAPPINGS,
    convertEmotionTags,
    extractEmotions,
    removeEmotionTags,
    processAIResponse
};
