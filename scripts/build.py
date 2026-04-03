# -*- coding: utf-8 -*-
import os
import shutil
import hashlib
import subprocess
import sys
from pathlib import Path
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from utils.logger import get_logger

log = get_logger(__name__)


REQUIRED_BUILD_ENV_VARS = (
    "REPORT_URL",
    "TELEMETRY_CLIENT_SECRET",
    "TELEMETRY_SALT",
    "TELEMETRY_ADMIN_USER",
    "TELEMETRY_ADMIN_PASS",
)


def calculate_checksum(file_path, algorithm='sha256'):
    """计算文件的校验和"""
    hash_func = getattr(hashlib, algorithm)()
    with open(file_path, 'rb') as f:
        for chunk in iter(lambda: f.read(4096), b""):
            hash_func.update(chunk)
    return hash_func.hexdigest()


def clean_build_artifacts():
    """清理构建临时文件"""
    log.info("🧹 正在清理临时文件...")

    # 删除 build 文件夹
    if os.path.exists('build'):
        try:
            shutil.rmtree('build')
            log.info("   - 已删除 build 文件夹")
        except Exception as e:
            log.warning(f"   ! 删除 build 文件夹失败: {e}")

    # 删除 spec 文件
    for spec_name in ('WT_Aimer_Voice.spec', 'AimerWT内测版本.spec'):
        if os.path.exists(spec_name):
            try:
                os.remove(spec_name)
                log.info(f'   - 已删除 spec 文件: {spec_name}')
            except Exception as e:
                log.warning(f'   ! 删除 spec 文件失败: {e}')


def load_dotenv(path=".env"):
    if os.path.exists(path):
        try:
            with open(path, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line or line.startswith("#") or "=" not in line:
                        continue
                    k, v = line.split("=", 1)
                    os.environ.setdefault(k.strip(), v.strip())
        except Exception as e:
            print(f"   ! 加载 .env 失败: {e}")


def require_build_env() -> dict[str, str]:
    """校验生产打包所需的关键环境变量。"""
    missing = []
    values: dict[str, str] = {}
    for key in REQUIRED_BUILD_ENV_VARS:
        value = os.environ.get(key, "").strip()
        if not value:
            missing.append(key)
            continue
        values[key] = value

    if missing:
        raise RuntimeError(
            "缺少必填环境变量: " + ", ".join(missing)
        )
    return values


def build_exe():
    """执行打包任务"""
    log.info("🚀 开始打包程序...")

    # 确保 dist 目录存在 (PyInstaller 会自动创建，但为了保险)
    dist_dir = Path("../dist")

    load_dotenv()

    try:
        build_env = require_build_env()
    except RuntimeError as exc:
        log.error(f"[X] 打包终止: {exc}")
        sys.exit(1)

    # 在打包前，从打包环境的环境变量中读取遥测配置。
    salt = build_env["TELEMETRY_SALT"]
    url = build_env["REPORT_URL"]
    client_secret = build_env["TELEMETRY_CLIENT_SECRET"]

    # 生成临时的 app_secrets.py 供编译使用
    # 注意：该文件已被加入 .gitignore，不会被上传到 GitHub
    secrets_file = Path("../app_secrets.py")
    with open(secrets_file, "w", encoding="utf-8") as f:
        f.write("# 由 build.py 自动生成 - 不要把它提交到github\n")
        f.write(f"TELEMETRY_SALT = {repr(salt)}\n")
        f.write(f"REPORT_URL = {repr(url)}\n")
        f.write(f"TELEMETRY_CLIENT_SECRET = {repr(client_secret)}\n")

    # Os specific separator
    sep = ';' if os.name == 'nt' else ':'

    EXE_DISPLAY_NAME = "AimerWT内测版本"

    # 版本资源文件路径（相对于 scripts/ 目录）
    version_file = Path("scripts/version_info.txt")

    cmd = [
        sys.executable, "-m", "PyInstaller",
        "--noconsole",
        "--onefile",
        "--add-data", f"web{sep}web",
        "--name", EXE_DISPLAY_NAME,
        "--clean",
        # hidden imports：确保 pywebview 各后端、pystray、pythonnet 均被打包
        "--hidden-import", "webview.platforms.winforms",
        "--hidden-import", "webview.platforms.cef",
        "--hidden-import", "webview.platforms.gtk",
        "--hidden-import", "clr",
        "--hidden-import", "clr_loader",
        "--hidden-import", "pystray._win32",
        "--hidden-import", "PIL._imaging",
        "--hidden-import", "PIL.Image",
        "--hidden-import", "PIL.IcoImagePlugin",
        "--hidden-import", "requests",
        "--hidden-import", "certifi",
        "--hidden-import", "charset_normalizer",
        "--hidden-import", "bottle",
        "--collect-all", "webview",
        "--collect-all", "pystray",
        "main.py"
    ]

    # 可选打包 tools 目录（例如 vgmstream-cli 及其依赖）
    if os.path.isdir("tools"):
        cmd.extend(["--add-data", f"tools{sep}tools"])
    else:
        log.warning("未发现 tools 目录，跳过工具文件打包")

    if os.name == 'nt':
        cmd.extend(["--icon", "web/assets/logo.ico"])
        if version_file.exists():
            cmd.extend(["--version-file", str(version_file)])
            log.info(f"已加载版本资源文件: {version_file}")
        else:
            log.warning(f"未找到版本资源文件，跳过: {version_file}")
    else:
        cmd.append("--strip")

    log.info(f"执行命令: {' '.join(cmd)}")

    try:
        # shell=False ensures arguments are passed correctly on Linux without manual escaping
        result = subprocess.run(cmd, check=True, capture_output=True, text=True)
        if result.stdout:
            log.debug(result.stdout)
        if result.stderr:
            log.debug(result.stderr)
    except subprocess.CalledProcessError as e:
        log.error(f"[X] 打包失败！错误: {e}", exc_info=True)
        log.error("--- PyInstaller stdout ---")
        if e.stdout:
            log.error(e.stdout)
        log.error("--- PyInstaller stderr ---")
        if e.stderr:
            log.error(e.stderr)
        sys.exit(1)
    except Exception as e:
        log.exception(f"[X] 打包失败！错误: {e}")
        sys.exit(1)
    else:
        exe_name = f"{EXE_DISPLAY_NAME}.exe" if os.name == 'nt' else EXE_DISPLAY_NAME
        exe_path = Path("../dist") / exe_name
        log.info("[OK] 打包成功！")
        log.info(f"输出文件: {exe_path}")
        return True


def main():
    # 1. 执行打包
    if not build_exe():
        return

    # 2. 生成校验文件
    exe_display_name = "AimerWT内测版本"
    exe_name = f"{exe_display_name}.exe" if os.name == 'nt' else exe_display_name
    dist_dir = Path(__file__).parent.parent / "dist"
    exe_path = dist_dir / exe_name

    if not exe_path.exists():
        log.error(f"❌ 未找到生成的 exe 文件！: {exe_path}")
        return

    log.info("🔐 正在生成校验文件...")
    checksum = calculate_checksum(exe_path, 'sha256')
    checksum_file = dist_dir / Path("checksum.txt")

    with open(checksum_file, 'w', encoding='utf-8') as f:
        f.write(f"File: {exe_path.name}\n")
        f.write(f"SHA256: {checksum}\n")
        f.write(f"Date: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")

    log.info(f"✅ 校验文件已生成: {checksum_file}")
    log.info(f"   SHA256: {checksum}")

    # 3. 清理临时文件
    clean_build_artifacts()

    log.info("\n🎉 所有任务完成！可执行文件位于 dist 目录。")


if __name__ == "__main__":
    main()
