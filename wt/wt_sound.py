from enum import Enum


class Country(Enum):
    # AI翻译，不知道准不准
    EN_AU = ("en_au", "澳大利亚")
    EN_US = ("en_us", "美国")
    EN_ZA = ("en_za", "南非")
    ZHHX = ("zhhx", "")  # 语音包里找到的，不知道是哪个国家
    LT = ("lt", "立陶宛")
    CZ = ("cz", "捷克")
    DE = ("de", "德国")
    EN = ("en", "英国")
    FR = ("fr", "法国")
    HU = ("hu", "匈牙利")
    IT = ("it", "意大利")
    JP = ("jp", "日本")
    KO = ("ko", "韩国")
    PL = ("pl", "波兰")
    PT = ("pt", "葡萄牙")
    RU = ("ru", "俄罗斯")
    SP = ("sp", "西班牙")
    SR = ("sr", "塞尔维亚")
    TH = ("th", "泰国")
    TR = ("tr", "土耳其")
    VI = ("vi", "越南")
    ZH = ("zh", "中国")
    AR = ("ar", "阿拉伯")
    FI = ("fi", "芬兰")
    GL = ("gl", "加利西亚")
    HE = ("he", "希伯来")
    HI = ("hi", "印地")
    NL = ("nl", "荷兰")
    NW = ("nw", "尼泊尔")
    SV = ("sv", "瑞典")

    def __init__(self, code, chinese_name):
        self.code = code
        self.chinese_name = chinese_name


class VoiceType(Enum):
    # (code, chinese_name, tag)
    # tag: 前端显示的简化标签
    MASTERBANK = ("masterbank", "主音库", "降噪包")
    DIALOGS_CHAT = ("dialogs_chat", "无线电对话", "无线电对话")
    EVENT = ("event", "事件", None)

    CREW_DIALOGS_COMMON = ("crew_dialogs_common", "乘员通用语音", "无线电")
    CREW_DIALOGS_GROUND = ("crew_dialogs_ground", "地面单位语音", "陆战语音")
    CREW_DIALOGS_NAVAL = ("crew_dialogs_naval", "水面单位语音", "海战语音")

    TANK_AMBIENT = ("tank_ambient", "坦克环境音", "陆战环境音")
    TANK_EFFECTS = ("tank_effects", "坦克效果音", "陆战效果音")
    TANK_EFFECTS_RADIO = ("tank_effects_radio", "坦克无线电音效", "陆战无线电音效")
    TANK_ENGINES = ("tank_engines", "坦克引擎音效", "陆战引擎音效")
    TANK_EXPLOSIONS = ("tank_explosions", "坦克摧毁音效", "陆战摧毁音效")
    TANK_OBJECT_CRASH = ("tank_object_crash", "坦克撞击音效", "陆战撞击音效")
    TANK_WEAPONS = ("tank_weapons", "坦克武器音效", "陆战武器音效")

    AIRCRAFT_AMBIENT = ("aircraft_ambient", "空中单位环境音", "空战环境音")
    AIRCRAFT_COMMON = ("aircraft_common", "空中单位通用音效", "空战通用音")
    AIRCRAFT_EFFECT = ("aircraft_effect", "空中单位效果音", "空战效果音")
    AIRCRAFT_ENGINE = ("aircraft_engine", "空中单位引擎音效", "空战引擎音效")
    AIRCRAFT_GUI = ("aircraft_gui", "空中单位GUI音效", "座舱音效")
    AIRCRAFT_GUNS = ("aircraft_guns", "空中单位武器音效", "空战武器音效")
    AIRCRAFT_MUSIC = ("aircraft_music", "空中单位音乐", "空战音乐")

    SHIPS_AMBIENT = ("ships_ambient", "海战环境音", "海战环境音")
    SHIPS_EFFECTS = ("ships_effects", "海战效果音", "海战效果音")
    SHIPS_ENGINES = ("ships_engines", "海战引擎音效", "海战引擎音效")
    SHIPS_EXPLOSIONS = ("ships_explosions", "海战摧毁音效", "海战摧毁音效")
    SHIPS_WEAPONS = ("ships_weapons", "海战武器音效", "海战武器音效")

    INFANTRY = ("infantry_voices", "步兵", "步兵")
    INFANTRY_AMBIENT = ("infantry_ambient", "步兵环境音", "步兵环境音")
    INFANTRY_EFFECT = ("infantry_effect", "步兵效果音", "步兵效果音")

    def __init__(self, code, chinese_name, tag):
        self.code = code
        self.chinese_name = chinese_name
        self.tag = tag
