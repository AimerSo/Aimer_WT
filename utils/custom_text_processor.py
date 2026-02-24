NO_PREFIX_GROUP = "no_prefix"


def extract_prefix_group(value: str, no_prefix_group: str = NO_PREFIX_GROUP) -> str:
    """
    不是这 menu.csv 里面有 4484 条文本啊
    为 lang/menu.csv 自动分组

    规则：
    - 有 / ：返回第一个 / 前的内容（前缀）
    - 无 / ：返回 no_prefix_group（默认 no_prefix）
    """
    v = value.strip().strip('"').strip()
    if "/" not in v:
        return no_prefix_group
    return v.split("/", 1)[0]
