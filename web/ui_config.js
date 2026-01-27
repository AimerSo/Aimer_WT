/**
 * UI Configuration & Constants
 * 集中管理界面映射规则，避免逻辑分散
 */
const UI_CONFIG = {
    // 语言标识映射 (Short Code -> CSS Class)
    langMap: {
        "中": "lang-cn",
        "美": "lang-us",
        "俄": "lang-ru",
        "德": "lang-de",
        "日": "lang-jp",
        "法": "lang-fr"
    },

    // 能力标签映射 (Capability Key -> { CSS Class, Display Text })
    // 对应 card.capabilities 中的 key
    tagMap: {
        tank: { cls: "tank", text: "陆战" },
        air: { cls: "air", text: "空战" },
        naval: { cls: "naval", text: "海战" },
        radio: { cls: "radio", text: "无线电/局势" },
        missile: { cls: "missile", text: "导弹音效" },
        music: { cls: "music", text: "音乐包" },
        noise: { cls: "noise", text: "降噪包" },
        pilot: { cls: "pilot", text: "飞行员语音" }
    }
};
