import re
import zipfile
import shutil
import csv
from pathlib import Path
from typing import Optional


def extract_csv_references_from_blk(blk_content: str) -> list[str]:
    """
    从 blk 文件内容中提取 CSV 文件引用
    例如：%lang/custom_menu.csv -> custom_menu.csv
    """
    pattern = r'%lang/([^"\s]+\.csv)'
    matches = re.findall(pattern, blk_content, re.IGNORECASE)
    return list(set(matches))


def detect_import_mode(import_path: Path) -> tuple[str, dict]:
    """
    检测导入模式
    返回: (mode, info)
    mode: "standard" | "custom_blk" | "unknown"
    info: 包含检测到的文件信息
    """
    csv_files = []
    blk_files = []

    for file in import_path.iterdir():
        if file.is_file():
            if file.suffix.lower() == '.csv':
                csv_files.append(file.name)
            elif file.suffix.lower() == '.blk':
                blk_files.append(file.name)

    info = {
        "csv_files": csv_files,
        "blk_files": blk_files,
        "csv_references": []
    }

    # 如果有 blk 文件，解析它
    if blk_files:
        for blk_file in blk_files:
            try:
                with open(import_path / blk_file, 'r', encoding='utf-8', errors='ignore') as f:
                    content = f.read()
                    refs = extract_csv_references_from_blk(content)
                    info["csv_references"].extend(refs)
            except Exception:
                pass

        info["csv_references"] = list(set(info["csv_references"]))

        if info["csv_references"]:
            return "custom_blk", info

    # 检查是否是标准命名
    if csv_files:
        return "standard", info

    return "unknown", info


def match_csv_to_standard(csv_name: str, standard_names: list[str]) -> Optional[str]:
    """
    尝试将自定义 CSV 名称映射到标准名称
    """
    csv_lower = csv_name.lower()

    # 直接匹配
    if csv_name in standard_names:
        return csv_name

    # 模糊匹配
    for std_name in standard_names:
        std_lower = std_name.lower()
        # 如果自定义名称包含标准名称（去掉.csv）
        if std_lower.replace('.csv', '') in csv_lower:
            return std_name

    # 特殊规则：menu 相关的都映射到 menu.csv
    if 'menu' in csv_lower:
        if 'menu.csv' in standard_names:
            return 'menu.csv'

    return None


def merge_csv_files(original_csv_path: Path, mod_csv_path: Path, output_csv_path: Path, encoding: str = 'utf-8-sig') -> tuple[bool, str, dict]:
    """
    合并模组CSV和原始CSV

    策略：
    - 保留原始CSV的所有行
    - 如果模组CSV中的ID在原始CSV中存在，更新该行
    - 如果模组CSV中的ID在原始CSV中不存在，添加新行

    返回: (success, message, stats)
    stats: {"added": int, "modified": int, "total": int}
    """
    try:
        # 读取原始CSV
        original_rows = []
        original_encoding = encoding
        encodings = ["utf-8-sig", "utf-8", "cp1252", "latin-1", "gbk"]

        for enc in encodings:
            try:
                with open(original_csv_path, "r", encoding=enc, newline="") as f:
                    original_rows = list(csv.reader(f, delimiter=';', quotechar='"'))
                    original_encoding = enc
                break
            except Exception:
                continue

        if not original_rows:
            return False, "无法读取原始CSV文件", {}

        # 读取模组CSV
        mod_rows = []
        for enc in encodings:
            try:
                with open(mod_csv_path, "r", encoding=enc, newline="") as f:
                    mod_rows = list(csv.reader(f, delimiter=';', quotechar='"'))
                break
            except Exception:
                continue

        if not mod_rows:
            return False, "无法读取模组CSV文件", {}

        # 获取表头
        if len(original_rows) < 1 or len(mod_rows) < 1:
            return False, "CSV文件格式错误", {}

        original_header = original_rows[0]
        mod_header = mod_rows[0]

        # 找到ID列索引
        id_idx = 0
        for i, col in enumerate(original_header):
            col_lower = str(col).lower()
            if 'id' in col_lower or 'readonly' in col_lower:
                id_idx = i
                break

        # 构建原始数据的ID映射
        original_data = {}
        for i, row in enumerate(original_rows[1:], start=1):
            if row and id_idx < len(row):
                text_id = str(row[id_idx]).strip()
                if text_id:
                    original_data[text_id] = i

        # 统计信息
        stats = {"added": 0, "modified": 0, "total": 0}

        # 处理模组数据
        for mod_row in mod_rows[1:]:
            if not mod_row or id_idx >= len(mod_row):
                continue

            text_id = str(mod_row[id_idx]).strip()
            if not text_id:
                continue

            if text_id in original_data:
                # 更新现有行
                row_idx = original_data[text_id]
                # 确保行长度一致
                while len(mod_row) < len(original_header):
                    mod_row.append("")
                original_rows[row_idx] = mod_row[:len(original_header)]
                stats["modified"] += 1
            else:
                # 添加新行
                while len(mod_row) < len(original_header):
                    mod_row.append("")
                original_rows.append(mod_row[:len(original_header)])
                stats["added"] += 1

        stats["total"] = len(original_rows) - 1

        # 写入合并后的文件
        output_csv_path.parent.mkdir(parents=True, exist_ok=True)
        with open(output_csv_path, "w", encoding=original_encoding, newline="") as f:
            writer = csv.writer(f, delimiter=';', quotechar='"', quoting=csv.QUOTE_ALL, lineterminator="\n")
            writer.writerows(original_rows)

        return True, "合并成功", stats

    except Exception as e:
        return False, f"合并失败: {e}", {}


def extract_archive(archive_path: Path, extract_to: Path) -> tuple[bool, str]:
    """
    解压压缩包
    支持 zip, rar (需要 rarfile 库)
    """
    try:
        extract_to.mkdir(parents=True, exist_ok=True)

        if archive_path.suffix.lower() == '.zip':
            with zipfile.ZipFile(archive_path, 'r') as zip_ref:
                zip_ref.extractall(extract_to)
            return True, "解压成功"
        else:
            return False, f"不支持的压缩格式: {archive_path.suffix}"

    except Exception as e:
        return False, f"解压失败: {e}"


def find_csv_files_recursive(directory: Path) -> list[Path]:
    """
    递归查找目录中的所有 CSV 文件
    """
    csv_files = []
    for item in directory.rglob("*.csv"):
        if item.is_file():
            csv_files.append(item)
    return csv_files


def find_blk_files_recursive(directory: Path) -> list[Path]:
    """
    递归查找目录中的所有 BLK 文件
    """
    blk_files = []
    for item in directory.rglob("*.blk"):
        if item.is_file():
            blk_files.append(item)
    return blk_files

