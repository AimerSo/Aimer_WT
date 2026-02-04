# -*- coding: utf-8 -*-
"""
统一日誌系统模组：创建并配置 logging.Logger，包括文件轮转写入、控制台输出及 UI 回调，供后端各模组複用。

功能特性:
- 支援多层级日誌 (DEBUG/INFO/WARNING/ERROR/CRITICAL)
- 自动文件轮转 (每个文件最大 10MB，保留 5 个备份)
- 支援 UI 回调以将日誌同步到前端
- 提供上下文记录器 (ContextLogger) 用于追踪操作流程
- 异常日誌自动包含堆栈追踪
"""

from __future__ import annotations

import logging
import sys
import threading
import traceback
from collections.abc import Callable
from contextlib import contextmanager
from functools import wraps
from logging.handlers import RotatingFileHandler
from pathlib import Path
from typing import Any, TypeVar, ParamSpec

APP_LOGGER_NAME = "WT_Voice_Manager"

_ui_callback: Callable[[str, logging.LogRecord], None] | None = None
_ui_emit_guard = threading.local()

# 类型变数用于装饰器
P = ParamSpec('P')
T = TypeVar('T')


def set_ui_callback(callback: Callable[[str, logging.LogRecord], None] | None) -> None:
    """
    设置前端 UI 日誌回调。

    Args:
        callback: 接收 (formatted_message: str, record: logging.LogRecord) 的回调函数。
    """
    global _ui_callback
    _ui_callback = callback


class UiCallbackHandler(logging.Handler):
    """将日誌讯息转发到 UI 回调的处理器。"""
    
    def emit(self, record: logging.LogRecord) -> None:
        callback = _ui_callback
        if not callback:
            return

        # 防止递归调用
        if getattr(_ui_emit_guard, "active", False):
            return

        try:
            _ui_emit_guard.active = True
            callback(self.format(record), record)
        except Exception:
            # 日誌链路不应影响业务逻辑
            pass
        finally:
            _ui_emit_guard.active = False


class ContextLogger:
    """
    带上下文的日誌记录器，用于追踪操作流程。
    
    使用示例:
        with ContextLogger(log, "安装语音包", mod_name=mod_name) as ctx:
            ctx.info("开始安装...")
            # 操作代码
            ctx.info("安装完成")
    """
    
    def __init__(self, logger: logging.Logger, operation: str, **context: Any):
        self._logger = logger
        self._operation = operation
        self._context = context
        self._context_str = ", ".join(f"{k}={v}" for k, v in context.items()) if context else ""
    
    def _format_msg(self, msg: str) -> str:
        prefix = f"[{self._operation}]"
        if self._context_str:
            prefix += f" ({self._context_str})"
        return f"{prefix} {msg}"
    
    def debug(self, msg: str, *args: Any, **kwargs: Any) -> None:
        self._logger.debug(self._format_msg(msg), *args, **kwargs)
    
    def info(self, msg: str, *args: Any, **kwargs: Any) -> None:
        self._logger.info(self._format_msg(msg), *args, **kwargs)
    
    def warning(self, msg: str, *args: Any, **kwargs: Any) -> None:
        self._logger.warning(self._format_msg(msg), *args, **kwargs)
    
    def error(self, msg: str, *args: Any, **kwargs: Any) -> None:
        self._logger.error(self._format_msg(msg), *args, **kwargs)
    
    def exception(self, msg: str, *args: Any, **kwargs: Any) -> None:
        """记录错误并自动包含异常堆栈。"""
        self._logger.exception(self._format_msg(msg), *args, **kwargs)
    
    def __enter__(self) -> "ContextLogger":
        self.debug("操作开始")
        return self
    
    def __exit__(self, exc_type: Any, exc_val: Any, exc_tb: Any) -> bool:
        if exc_type is not None:
            self.error(f"操作失败: {exc_type.__name__}: {exc_val}")
        else:
            self.debug("操作完成")
        return False  # 不抑制异常


def log_exceptions(logger: logging.Logger | None = None, reraise: bool = True, default: Any = None):
    """
    装饰器：自动记录函数执行过程中的异常。
    
    Args:
        logger: 使用的日誌记录器，None 则使用模组级记录器
        reraise: 是否重新抛出异常
        default: 异常时返回的默认值（仅当 reraise=False 时有效）
    
    使用示例:
        @log_exceptions(log, reraise=False, default=[])
        def get_items():
            ...
    """
    def decorator(func: Callable[P, T]) -> Callable[P, T]:
        @wraps(func)
        def wrapper(*args: P.args, **kwargs: P.kwargs) -> T:
            nonlocal logger
            if logger is None:
                logger = get_logger(func.__module__)
            try:
                return func(*args, **kwargs)
            except Exception as e:
                logger.error(
                    f"函数 {func.__name__} 执行失败: {type(e).__name__}: {e}",
                    exc_info=True
                )
                if reraise:
                    raise
                return default
        return wrapper
    return decorator


@contextmanager
def log_operation(logger: logging.Logger, operation: str, **context: Any):
    """
    上下文管理器：记录操作的开始、结束或失败。
    
    Args:
        logger: 日誌记录器
        operation: 操作名称
        **context: 额外上下文信息
    
    使用示例:
        with log_operation(log, "导入语音包", filename=zip_name):
            # 操作代码
    """
    ctx = ContextLogger(logger, operation, **context)
    try:
        ctx.info("开始执行")
        yield ctx
        ctx.info("执行成功")
    except Exception as e:
        ctx.error(f"执行失败: {type(e).__name__}: {e}")
        raise


def format_exception(e: Exception, include_traceback: bool = False) -> str:
    """
    格式化异常为可读字串。
    
    Args:
        e: 异常对象
        include_traceback: 是否包含完整堆栈追踪
    
    Returns:
        格式化后的错误讯息
    """
    msg = f"{type(e).__name__}: {e}"
    if include_traceback:
        tb = traceback.format_exc()
        msg += f"\n{tb}"
    return msg


def _get_log_dir() -> Path:
    """获取日誌存储目录，确保目录存在。"""
    from utils import get_docs_data_dir
    base_dir = get_docs_data_dir()
    log_dir = base_dir / "logs"
    try:
        log_dir.mkdir(parents=True, exist_ok=True)
    except Exception as e:
        # 回退到临时目录
        import tempfile
        log_dir = Path(tempfile.gettempdir()) / "WT_Voice_Manager_logs"
        try:
            log_dir.mkdir(parents=True, exist_ok=True)
        except Exception:
            pass
        sys.stderr.write(f"无法创建日誌目录，使用临时目录: {log_dir} (原因: {e})\n")
    return log_dir


def setup_logger(name: str = APP_LOGGER_NAME) -> logging.Logger:
    """
    初始化并返回应用日誌记录器，提供文件轮转写入与控制台输出。
    
    Args:
        name: 日誌记录器名称
    
    Returns:
        配置好的 Logger 实例
    """
    logger = logging.getLogger(name)
    
    # 防止重複添加 handler
    if logger.handlers:
        return logger
        
    logger.setLevel(logging.DEBUG)
    logger.propagate = False
    
    # 使用统一的日誌目录逻辑
    log_dir = _get_log_dir()
    
    # 日誌格式 - 文件使用详细格式
    file_formatter = logging.Formatter(
        '%(asctime)s - %(name)s - %(levelname)s - [%(filename)s:%(lineno)d] - %(message)s',
        datefmt='%Y-%m-%d %H:%M:%S'
    )
    
    # 控制台使用简洁格式
    console_formatter = logging.Formatter(
        '%(asctime)s - %(name)s - %(levelname)s - %(message)s',
        datefmt='%Y-%m-%d %H:%M:%S'
    )

    # UI 使用更简洁的格式
    ui_formatter = logging.Formatter(
        '[%(asctime)s] [%(levelname)s] %(message)s',
        datefmt='%H:%M:%S'
    )
    
    # 1. 文件处理器 (RotatingFileHandler)
    # 每个文件最大 10MB，最多保留 5 个备份
    try:
        file_handler = RotatingFileHandler(
            log_dir / "app.log",
            maxBytes=10*1024*1024,  # 10MB
            backupCount=5,
            encoding='utf-8'
        )
        file_handler.setLevel(logging.DEBUG)
        file_handler.setFormatter(file_formatter)
        logger.addHandler(file_handler)
    except Exception as e:
        sys.stderr.write(f"无法初始化文件日誌: {e}\n")
    
    # 2. 控制台处理器 (StreamHandler)
    console_handler = logging.StreamHandler()
    console_handler.setLevel(logging.INFO)
    console_handler.setFormatter(console_formatter)
    logger.addHandler(console_handler)

    # 3. UI 处理器（回调为空时不输出）
    ui_handler = UiCallbackHandler()
    ui_handler.setLevel(logging.INFO)
    ui_handler.setFormatter(ui_formatter)
    logger.addHandler(ui_handler)
    
    logger.info(f"日誌系统初始化完成，日誌路径: {log_dir}")
    
    return logger


def get_logger(module_name: str | None = None) -> logging.Logger:
    """
    获取模组 logger：`WT_Voice_Manager.<module_name>`
    
    Args:
        module_name: 模组名称，None 则返回根记录器
    
    Returns:
        Logger 实例
    """
    base = setup_logger(APP_LOGGER_NAME)
    if not module_name or module_name == APP_LOGGER_NAME:
        return base
    return base.getChild(str(module_name))
