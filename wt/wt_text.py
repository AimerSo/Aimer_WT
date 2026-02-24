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


def sanitize_csv_file_name(value: str) -> str:
    name = str(value or "").strip()
    if not name:
        return ""
    if "/" in name or "\\" in name or ".." in name:
        return ""
    if not name.lower().endswith(".csv"):
        return ""
    return name
