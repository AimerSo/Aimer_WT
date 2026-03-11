import sys
import threading
from pathlib import Path

SOURCE_DIR = Path(__file__).resolve().parent
CURRENT_DIR = Path(sys.executable).resolve().parent if getattr(sys, "frozen", False) else SOURCE_DIR
if str(SOURCE_DIR) not in sys.path:
    sys.path.insert(0, str(SOURCE_DIR))
PROJECT_ROOT = SOURCE_DIR.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from backend_pages import AuthorVoicepackService, ToolboxService, build_app_info

try:
    import webview
except Exception as _e:
    webview = None
    _WEBVIEW_IMPORT_ERROR = _e

APP_NAME = "AimerWT Author MVP"
APP_VERSION = "0.1.0"

if getattr(sys, "frozen", False):
    BASE_DIR = Path(sys._MEIPASS)
else:
    BASE_DIR = SOURCE_DIR

WEB_DIR = BASE_DIR / "web"


class AppApi:
    def __init__(self):
        self._window = None
        self._topmost_lock = threading.Lock()
        self._voicepack = AuthorVoicepackService(app_base_dir=CURRENT_DIR, web_dir=WEB_DIR)
        self._toolbox = ToolboxService(app_base_dir=CURRENT_DIR)

    def set_window(self, window):
        self._window = window
        try:
            self._voicepack.set_window(window)
        except Exception:
            pass

    def get_app_info(self):
        return build_app_info(
            app_name=APP_NAME,
            app_version=APP_VERSION,
            python_version=sys.version.split(" ")[0],
            platform_name=sys.platform,
        )

    def minimize_window(self):
        if self._window:
            self._window.minimize()

    def close_window(self):
        if self._window:
            self._window.destroy()

    def toggle_topmost(self, is_top):
        if not self._window:
            return False

        target = bool(is_top)

        def _apply():
            with self._topmost_lock:
                try:
                    self._window.on_top = target
                except Exception:
                    pass

        threading.Thread(target=_apply, daemon=True).start()
        return True

    def get_voicepack_workspace(self):
        return self._voicepack.get_workspace_info()

    def get_voicepack_list(self, query=""):
        return self._voicepack.list_voicepacks(query=query)

    def create_voicepack_folder(self, folder_name):
        try:
            return self._voicepack.create_voicepack_folder(folder_name)
        except Exception as e:
            return {"success": False, "msg": str(e)}

    def rename_voicepack_folder(self, old_name, new_name):
        try:
            return self._voicepack.rename_voicepack_folder(old_name, new_name)
        except Exception as e:
            return {"success": False, "msg": str(e)}

    def rename_voicepack_title(self, folder_name, new_title):
        try:
            return self._voicepack.rename_voicepack_title(folder_name, new_title)
        except Exception as e:
            return {"success": False, "msg": str(e)}

    def delete_voicepack_folder(self, folder_name):
        try:
            return self._voicepack.delete_voicepack_folder(folder_name)
        except Exception as e:
            return {"success": False, "msg": str(e)}

    def load_voicepack_for_edit(self, folder_name):
        try:
            return self._voicepack.load_voicepack_for_edit(folder_name)
        except Exception as e:
            return {"success": False, "msg": str(e)}

    def save_voicepack_info(self, folder_name, payload):
        try:
            return self._voicepack.save_voicepack_info(folder_name, payload or {})
        except Exception as e:
            return {"success": False, "msg": str(e)}

    def open_voicepack_library(self):
        return self._voicepack.open_voicepack_library()

    def open_voicepack_item(self, folder_name):
        try:
            return self._voicepack.open_voicepack_item(folder_name)
        except Exception as e:
            return {"success": False, "msg": str(e)}

    def export_voicepack_bank(self, folder_name, package_name="", export_mode="full"):
        try:
            return self._voicepack.export_voicepack_bank(folder_name, package_name or "", export_mode or "full")
        except Exception as e:
            return {"success": False, "msg": str(e)}

    def import_voicepack_bank(self, file_name, data_url):
        try:
            return self._voicepack.import_voicepack_bank(file_name, data_url)
        except Exception as e:
            return {"success": False, "msg": str(e)}

    def start_mod_audition_scan(self, mod_name):
        try:
            return self._voicepack.start_mod_audition_scan(mod_name)
        except Exception as e:
            return {"success": False, "msg": str(e)}

    def set_mod_audition_scan_paused(self, mod_name, paused):
        try:
            return self._voicepack.set_mod_audition_scan_paused(mod_name, paused)
        except Exception as e:
            return {"success": False, "msg": str(e)}

    def stop_mod_audition_scan(self, mod_name):
        try:
            return self._voicepack.stop_mod_audition_scan(mod_name)
        except Exception as e:
            return {"success": False, "msg": str(e)}

    def get_mod_audition_categories_snapshot(self, mod_name):
        try:
            return self._voicepack.get_mod_audition_categories_snapshot(mod_name)
        except Exception as e:
            return {"success": False, "msg": str(e)}

    def list_mod_audition_items_by_type(self, mod_name, voice_type_code):
        try:
            return self._voicepack.list_mod_audition_items_by_type(mod_name, voice_type_code)
        except Exception as e:
            return {"success": False, "msg": str(e)}

    def audition_mod_random_by_type(self, mod_name, voice_type_code, max_seconds=12):
        try:
            return self._voicepack.audition_mod_random_by_type(mod_name, voice_type_code, max_seconds)
        except Exception as e:
            return {"success": False, "msg": str(e)}

    def audition_mod_stream(self, mod_name, bank_rel, chunk_index, stream_index, max_seconds=12):
        try:
            return self._voicepack.audition_mod_stream(mod_name, bank_rel, chunk_index, stream_index, max_seconds)
        except Exception as e:
            return {"success": False, "msg": str(e)}

    def audition_mod_preview_audio(self, mod_name, preview_index):
        try:
            return self._voicepack.audition_mod_preview_audio(mod_name, preview_index)
        except Exception as e:
            return {"success": False, "msg": str(e)}

    def clear_audition_cache(self, mod_name=None):
        try:
            return self._voicepack.clear_audition_cache(mod_name)
        except Exception as e:
            return {"success": False, "msg": str(e)}

    # ===== 工具箱 API =====

    def toolbox_convert_webp(self, payload):
        """批量将图片转换为 WebP 格式"""
        try:
            return self._toolbox.convert_images_to_webp(payload or {})
        except Exception as e:
            return {"success": False, "msg": str(e), "results": []}

    def toolbox_open_folder(self, folder_path):
        """在资源管理器中打开指定目录"""
        try:
            return self._toolbox.open_output_folder(str(folder_path or ""))
        except Exception as e:
            return {"success": False, "msg": str(e)}

    def toolbox_get_preview(self, file_path):
        """获取图片小尺寸预览 data URL（用于前端缩略图）"""
        try:
            return self._toolbox.get_image_preview(str(file_path or ""))
        except Exception as e:
            return {"success": False, "data_url": "", "error": str(e)}

    def toolbox_select_folder(self):
        """弹出系统文件夹选择对话框，返回所选路径"""
        if not self._window:
            return {"success": False, "path": ""}
        try:
            result = self._window.create_file_dialog(
                dialog_type=20,  # FOLDER_DIALOG
                allow_multiple=False,
            )
            if result and len(result) > 0:
                return {"success": True, "path": str(result[0])}
            return {"success": False, "path": ""}
        except Exception as e:
            return {"success": False, "path": "", "error": str(e)}

    def toolbox_select_files(self):
        """弹出多选图片文件对话框，返回所选路径列表"""
        if not self._window:
            return {"success": False, "files": []}
        try:
            file_types = ("Image Files (*.png;*.jpg;*.jpeg;*.bmp;*.gif;*.tiff;*.tif;*.webp)",)
            result = self._window.create_file_dialog(
                dialog_type=10,  # OPEN_DIALOG
                allow_multiple=True,
                file_types=file_types,
            )
            if result:
                return {"success": True, "files": list(result)}
            return {"success": False, "files": []}
        except Exception as e:
            return {"success": False, "files": [], "error": str(e)}


def main() -> int:
    if webview is None:
        err = globals().get("_WEBVIEW_IMPORT_ERROR")
        print(f"pywebview 载入失败: {err}")
        return 2

    index_html = WEB_DIR / "index.html"
    if not index_html.exists():
        print(f"找不到前端入口文件: {index_html}")
        return 3

    api = AppApi()

    window = webview.create_window(
        title=APP_NAME,
        url=str(index_html),
        js_api=api,
        width=1200,
        height=800,
        min_size=(1060, 740),
        background_color="#F5F7FA",
        resizable=True,
        text_select=False,
        frameless=True,
        easy_drag=False,
    )

    api.set_window(window)

    webview.start(debug=False, http_server=False, gui="edgechromium")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
