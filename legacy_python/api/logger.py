import sys
from loguru import logger
from datetime import datetime, timezone, timedelta

# 设置中国时区 (UTC+8)
CHINA_TZ = timezone(timedelta(hours=8))

def get_china_time():
    """获取当前中国时间"""
    return datetime.now(CHINA_TZ)

# 自定义格式化函数
def format_with_china_time(record):
    """使用中国时区格式化时间"""
    utc_time = datetime.fromtimestamp(record["time"].timestamp(), tz=timezone.utc)
    china_time = utc_time.astimezone(CHINA_TZ)
    time_str = china_time.strftime("%Y-%m-%d %H:%M:%S.%f")[:-3]
    
    # 构建日志格式
    level = record["level"].name
    level_padded = f"{level:<8}"
    
    # 根据日志级别添加颜色
    level_colors = {
        "TRACE": "\x1b[35m",  # 紫色
        "DEBUG": "\x1b[34m",  # 蓝色
        "INFO": "\x1b[32m",   # 绿色
        "SUCCESS": "\x1b[32m",  # 绿色
        "WARNING": "\x1b[33m",  # 黄色
        "ERROR": "\x1b[31m",    # 红色
        "CRITICAL": "\x1b[31;1m"  # 红色加粗
    }
    
    color = level_colors.get(level, "\x1b[0m")
    reset = "\x1b[0m"
    
    # 控制台格式（带颜色）
    console_format = (
        f"\x1b[32m{time_str}\x1b[0m | "
        f"{color}{level_padded}\x1b[0m | "
        f"\x1b[36m{record['name']}\x1b[0m:\x1b[36m{record['function']}\x1b[0m:\x1b[36m{record['line']}\x1b[0m - "
        f"{color}{record['message']}\x1b[0m\n"
    )
    
    # 文件格式（不带颜色）
    file_format = (
        f"{time_str} | {level_padded} | "
        f"{record['name']}:{record['function']}:{record['line']} - "
        f"{record['message']}\n"
    )
    
    record["extra"]["console_format"] = console_format
    record["extra"]["file_format"] = file_format
    return True

# 移除默认的handler
logger.remove()

# 添加控制台输出
logger.add(
    sys.stderr,
    format="{extra[console_format]}",
    filter=format_with_china_time,
    level="TRACE"
)

# 添加文件输出
logger.add(
    "chaoxing.log",
    format="{extra[file_format]}",
    filter=format_with_china_time,
    rotation="10 MB",
    level="TRACE"
)
