# -*- coding: utf-8 -*-
"""
日志管理模块：为应用提供文件日志与控制台日志输出。

功能定位:
- 创建并配置统一的 logging.Logger，包括文件轮转写入与控制台输出，供后端各模块复用。

输入输出:
- 输入: logger 名称（用于 logging.getLogger(name)）。
- 输出: 返回配置完成的 logging.Logger；并在运行过程中对日志文件写入与控制台输出。
- 外部资源/依赖:
  - 目录: <base_dir>/logs（默认日志目录，若不可用则使用系统临时目录）
  - 文件: app.log（轮转文件日志）
  - 运行环境: frozen（PyInstaller）与非 frozen 两种 base_dir 选择方式

实现逻辑:
- 1) 获取同名 logger，若已存在 handlers 则复用并直接返回。
- 2) 设置 logger 级别为 DEBUG，确保文件日志可记录完整信息。
- 3) 构造日志目录与格式化器。
- 4) 添加 RotatingFileHandler（DEBUG 级别）与 StreamHandler（INFO 级别）。

业务关联:
- 上游: main.py 初始化桥接层时调用，用于将后端日志持久化。
- 下游: AppApi.log_from_backend 会将业务日志写入该 logger 并同步推送给前端。
"""

import logging
from logging.handlers import RotatingFileHandler
from pathlib import Path
import sys
import os

def setup_logger(name="WT_Voice_Manager"):
    """
    功能定位:
    - 初始化并返回应用日志记录器，提供文件轮转写入与控制台输出。

    输入输出:
    - 参数:
      - name: str，日志记录器名称（同名 logger 全局复用）。
    - 返回:
      - logging.Logger，配置完成的 logger 实例。
    - 外部资源/依赖:
      - 目录: <base_dir>/logs 或系统临时目录
      - 文件: app.log（轮转）

    实现逻辑:
    - 1) 通过 logging.getLogger(name) 获取实例；若已配置 handlers 则直接返回，避免重复添加。
    - 2) 计算 base_dir（frozen: sys.executable 同级；非 frozen: 源码目录）。
    - 3) 创建日志目录，失败则降级到系统临时目录。
    - 4) 添加文件处理器 RotatingFileHandler 与控制台处理器 StreamHandler。

    业务关联:
    - 上游: 应用启动阶段创建桥接层对象时调用。
    - 下游: 供后端模块写日志，并被 main.py 转发到前端日志面板。
    """
    logger = logging.getLogger(name)
    
    # 防止重复添加 handler
    if logger.handlers:
        return logger
        
    logger.setLevel(logging.DEBUG)
    
    # 确定日志目录
    if getattr(sys, 'frozen', False):
        # 打包环境
        base_dir = Path(sys.executable).parent
    else:
        # 开发环境
        base_dir = Path(__file__).parent
        
    log_dir = base_dir / "logs"
    
    try:
        log_dir.mkdir(parents=True, exist_ok=True)
    except Exception:
        # 如果无法创建日志目录，使用临时目录
        import tempfile
        log_dir = Path(tempfile.gettempdir()) / "WT_Voice_Manager_Logs"
        log_dir.mkdir(parents=True, exist_ok=True)
    
    # 日志格式
    formatter = logging.Formatter(
        '%(asctime)s - %(name)s - %(levelname)s - %(message)s',
        datefmt='%Y-%m-%d %H:%M:%S'
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
        file_handler.setFormatter(formatter)
        logger.addHandler(file_handler)
    except Exception as e:
        print(f"无法初始化文件日志: {e}")
    
    # 2. 控制台处理器 (StreamHandler)
    console_handler = logging.StreamHandler()
    console_handler.setLevel(logging.INFO)
    console_handler.setFormatter(formatter)
    logger.addHandler(console_handler)
    
    logger.info(f"日志系统初始化完成，日志路径: {log_dir}")
    
    return logger
