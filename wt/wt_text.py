import csv
from pathlib import Path


def load_csv_rows_with_fallback(csv_path: Path):
    encodings = ["utf-8-sig", "utf-8", "cp1252", "latin-1", "gbk"]
    last_error = None
    for enc in encodings:
        try:
            with open(csv_path, "r", encoding=enc, newline="") as f:
                rows = list(csv.reader(f, delimiter=';', quotechar='"'))
            return rows, enc
        except Exception as e:
            last_error = e
            continue
    raise RuntimeError(f"读取 CSV 失败: {last_error}")


def list_lang_csv_files(lang_dir: Path) -> list[str]:
    names = []
    try:
        for p in lang_dir.glob("*.csv"):
            if p.is_file():
                names.append(p.name)
    except Exception:
        return []
    return sorted(set(names), key=lambda x: x.lower())


def list_lang_csv_files_with_status(lang_dir: Path) -> list[dict]:
    """
    列出所有CSV文件，并标记是否已修改（在AimerWT目录下有副本）
    返回格式: [{"name": "menu.csv", "modified": True}, ...]
    已修改的文件排在前面
    """
    files_info = []
    aimer_dir = lang_dir / "AimerWT"

    try:
        for p in lang_dir.glob("*.csv"):
            if p.is_file():
                modified = (aimer_dir / p.name).exists()
                files_info.append({
                    "name": p.name,
                    "modified": modified
                })
    except Exception:
        return []

    # 去重
    seen = set()
    unique_files = []
    for f in files_info:
        if f["name"] not in seen:
            seen.add(f["name"])
            unique_files.append(f)

    # 排序：已修改的在前，然后按名称排序
    unique_files.sort(key=lambda x: (not x["modified"], x["name"].lower()))

    return unique_files


def sanitize_csv_file_name(value: str) -> str:
    name = str(value or "").strip()
    if not name:
        return ""
    if "/" in name or "\\" in name or ".." in name:
        return ""
    if not name.lower().endswith(".csv"):
        return ""
    return name
