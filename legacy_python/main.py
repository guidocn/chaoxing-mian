# -*- coding: utf-8 -*-
import argparse
import configparser
import random
import time
import sys
import os
import traceback
from urllib3 import disable_warnings, exceptions
# ====================== 【多线程导入】 ======================
from concurrent.futures import ThreadPoolExecutor, as_completed
import threading
# ===========================================================

from api.logger import logger
from api.base import Chaoxing, Account
from api.exceptions import LoginError, InputFormatError, MaxRollBackExceeded
from api.answer import Tiku
from api.notification import Notification

# 关闭警告
disable_warnings(exceptions.InsecureRequestWarning)

# ====================== 【多线程核心配置】 ======================
MAX_WORKERS = 5  # 同一章节同时刷的视频数（调整为5个，测试安全）
MAX_ACCOUNT_WORKERS = 2  # 同时刷课的账号数（推荐 1-3）

# ====================== 【统计信息】 ======================
STATS_LOCK = threading.Lock()
STATS = {
    "courses": 0,
    "completed_points": 0,
    "total_points": 0,
    "start_time": None
}
# ===============================================================

# 线程本地存储，用于多账号日志区分
thread_local = threading.local()


# ====================== 【统计函数】 ======================
def update_stats(key, value, increment=False):
    """更新统计信息（线程安全）"""
    global STATS
    with STATS_LOCK:
        if increment:
            STATS[key] = STATS.get(key, 0) + value
        else:
            STATS[key] = value
        # 输出统计日志，便于前端解析
        logger.info(f"[STATS] {key}={STATS[key]}")


def log_stats():
    """输出当前统计信息"""
    global STATS
    with STATS_LOCK:
        logger.info(f"[STATS] courses={STATS['courses']}|completed={STATS['completed_points']}|total={STATS['total_points']}")


def init_stats():
    """初始化统计"""
    global STATS
    STATS = {
        "courses": 0,
        "completed_points": 0,
        "total_points": 0,
        "start_time": time.time()
    }
    logger.info("[STATS] initialized")
# ============================================================


def parse_args():
    """解析命令行参数"""
    parser = argparse.ArgumentParser(
        description="Samueli924/chaoxing - 多账号并行刷课",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )

    parser.add_argument(
        "-c", "--config", type=str, default=None, help="使用配置文件运行程序"
    )
    parser.add_argument("-u", "--username", type=str, default=None, help="手机号账号")
    parser.add_argument("-p", "--password", type=str, default=None, help="登录密码")
    parser.add_argument(
        "-l", "--list", type=str, default=None, help="要学习的课程ID列表, 以 , 分隔"
    )
    parser.add_argument(
        "-s", "--speed", type=float, default=1.0, help="视频播放倍速 (默认1, 最大2)"
    )
    parser.add_argument(
        "-v",
        "--verbose",
        action="store_true",
        help="开启详细日志输出"
    )
    parser.add_argument(
        "-a", "--notopen-action", type=str, default="retry",
        choices=["retry", "ask", "continue"],
        help="遇到关闭任务点时的行为: retry-重试, ask-询问, continue-继续"
    )

    if len(sys.argv) == 2 and sys.argv[1] in {"-h", "--help"}:
        parser.print_help()
        sys.exit(0)

    return parser.parse_args()


def load_config_from_file(config_path):
    """从配置文件加载设置 - 支持多账号"""
    config = configparser.ConfigParser()
    config.read(config_path, encoding="utf8")

    common_config = {}
    tiku_config = {}
    notification_config = {}
    accounts = []  # 多账号列表

    # 解析多账号配置 [account_1], [account_2], ...
    for section in config.sections():
        if section.startswith("account_") or section == "account":
            account_config = dict(config.items(section))
            if account_config.get("username") and account_config.get("password"):
                account = {
                    "username": account_config.get("username", ""),
                    "password": account_config.get("password", ""),
                    "courses": account_config.get("courses", "").split(",") if account_config.get("courses") else None
                }
                accounts.append(account)

    # 解析全局配置
    if config.has_section("common"):
        common_config = dict(config.items("common"))
        # 兼容旧格式：如果 common 中有 username/password，作为第一个账号
        if common_config.get("username") and common_config.get("password"):
            if not any(a["username"] == common_config["username"] for a in accounts):
                accounts.insert(0, {
                    "username": common_config["username"],
                    "password": common_config["password"],
                    "courses": common_config.get("course_list", "").split(",") if common_config.get("course_list") else None
                })
        if "course_list" in common_config and common_config["course_list"]:
            common_config["course_list"] = common_config["course_list"].split(",")
        if "speed" in common_config:
            common_config["speed"] = float(common_config["speed"])
        if "notopen_action" not in common_config:
            common_config["notopen_action"] = "retry"
        if "max_account_workers" in common_config:
            global MAX_ACCOUNT_WORKERS
            MAX_ACCOUNT_WORKERS = int(common_config["max_account_workers"])

    if config.has_section("tiku"):
        tiku_config = dict(config.items("tiku"))
        for key in ["delay", "cover_rate"]:
            if key in tiku_config:
                tiku_config[key] = float(tiku_config[key])
        tiku_config.setdefault("true_list", "")
        tiku_config.setdefault("false_list", "")

    if config.has_section("notification"):
        notification_config = dict(config.items("notification"))

    return common_config, tiku_config, notification_config, accounts


def build_config_from_args(args):
    """从命令行参数构建配置"""
    common_config = {
        "username": args.username,
        "password": args.password,
        "course_list": args.list.split(",") if args.list else None,
        "speed": args.speed if args.speed else 1.0,
        "notopen_action": args.notopen_action if args.notopen_action else "retry"
    }
    tiku_config = {"true_list": "", "false_list": "", "delay": 0.0}
    
    # 单账号模式
    accounts = [{
        "username": args.username,
        "password": args.password,
        "courses": args.list.split(",") if args.list else None
    }] if args.username and args.password else []
    
    return common_config, tiku_config, {}, accounts


def init_config():
    """初始化配置"""
    args = parse_args()

    if args.config:
        return load_config_from_file(args.config)
    else:
        return build_config_from_args(args)


class RollBackManager:
    """课程回滚管理器，避免无限回滚"""
    def __init__(self):
        self.rollback_times = 0
        self.rollback_id = ""

    def add_times(self, id: str):
        if id == self.rollback_id and self.rollback_times == 3:
            raise MaxRollBackExceeded("回滚次数已达3次, 请手动检查学习通任务点完成情况")
        else:
            self.rollback_times += 1

    def new_job(self, id: str):
        if id != self.rollback_id:
            self.rollback_id = id
            self.rollback_times = 0


def init_chaoxing(account_info, tiku_config):
    """初始化超星实例 - 支持多账号"""
    username = account_info.get("username", "")
    password = account_info.get("password", "")
    courses = account_info.get("courses")

    if not username or not password:
        return None

    account = Account(username, password)
    tiku = Tiku()
    final_tiku_config = {
        "true_list": "",
        "false_list": "",
        "delay": 0.0,
        **tiku_config
    }
    tiku.config_set(final_tiku_config)
    tiku = tiku.get_tiku_from_config()
    tiku.init_tiku()
    query_delay = final_tiku_config.get("delay", 0)
    chaoxing = Chaoxing(account=account, tiku=tiku, query_delay=query_delay)
    return chaoxing


def handle_not_open_chapter(notopen_action, point, tiku, RB, auto_skip_notopen=False):
    """处理未开放章节"""
    if notopen_action == "retry":
        if not tiku or tiku.DISABLE or not tiku.SUBMIT:
            logger.error(
                "章节未开启, 可能由于上一章节的章节检测未完成, 也可能由于该章节因为时效已关闭，"
                "请手动检查完成并提交再重试。或者在配置中配置(自动跳过关闭章节/开启题库并启用提交)"
            )
            return -1
        RB.add_times(point["id"])
        return 0

    elif notopen_action == "ask":
        if not auto_skip_notopen:
            logger.info(f"章节 {point['title']} 未开放，自动跳过")
            return 1, True
        else:
            logger.info(f"章节 {point['title']} 未开放，自动跳过")
            return 1, auto_skip_notopen

    else:
        logger.info(f"章节 {point['title']} 未开放，根据配置跳过此章节")
        return 1


# ====================== 【线程任务函数】 ======================
def thread_process_job(chaoxing, course, job, job_info, speed, account_id):
    """线程执行：单个任务刷课（线程安全）"""
    try:
        sleep_duration = random.uniform(0.5, 2)
        time.sleep(sleep_duration)

        if job["type"] == "video":
            logger.trace(f"[{account_id}] 视频任务: {job['jobid']}")
            res = chaoxing.study_video(course, job, job_info, _speed=speed, _type="Video")
            if chaoxing.StudyResult.is_failure(res):
                chaoxing.study_video(course, job, job_info, _speed=speed, _type="Audio")
            update_stats("completed_points", 1, increment=True)

        elif job["type"] == "document":
            logger.trace(f"[{account_id}] 文档任务: {job['jobid']}")
            chaoxing.study_document(course, job)
            update_stats("completed_points", 1, increment=True)

        elif job["type"] == "workid":
            logger.trace(f"[{account_id}] 章节检测: {job['jobid']}")
            chaoxing.study_work(course, job, job_info)
            update_stats("completed_points", 1, increment=True)

        elif job["type"] == "read":
            logger.trace(f"[{account_id}] 阅读任务: {job['jobid']}")
            chaoxing.study_read(course, job, job_info)
            update_stats("completed_points", 1, increment=True)

    except Exception as e:
        logger.warning(f"[{account_id}] 任务失败: {str(e)}")
# ============================================================


def process_chapter(chaoxing, course, point, RB, notopen_action, speed, auto_skip_notopen=False):
    account_id = chaoxing.account_id
    logger.info(f'[{account_id}] 当前章节: {point["title"]}')

    if point["has_finished"]:
        logger.info(f'[{account_id}] 章节：{point["title"]} 已完成所有任务点')
        return 1, auto_skip_notopen

    time.sleep(random.uniform(1, 3))
    jobs, job_info = chaoxing.get_job_list(course["clazzId"], course["courseId"], course["cpi"], point["id"])

    try:
        if job_info.get("notOpen", False):
            result = handle_not_open_chapter(notopen_action, point, chaoxing.tiku, RB, auto_skip_notopen)
            if isinstance(result, tuple):
                return result
            else:
                return result, auto_skip_notopen
        auto_skip_notopen = False
        RB.new_job(point["id"])
    except MaxRollBackExceeded:
        logger.error(f"[{account_id}] 回滚次数已达3次")
        return -1, auto_skip_notopen

    if not jobs:
        if RB.rollback_times > 0:
            chaoxing.study_emptypage(course, point)
        return 1, auto_skip_notopen

    # ====================== 【多线程执行所有任务】 ======================
    logger.info(f"[{account_id}] 章节任务数：{len(jobs)}，启动 {MAX_WORKERS} 线程并行刷课")
    update_stats("total_points", len(jobs), increment=True)
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        for job in jobs:
            executor.submit(thread_process_job, chaoxing, course, job, job_info, speed, account_id)
    # ==================================================================

    return 1, auto_skip_notopen


def process_course(chaoxing, course, notopen_action, speed):
    account_id = chaoxing.account_id
    logger.info(f"[{account_id}] 开始学习课程: {course['title']}")
    point_list = chaoxing.get_course_point(course["courseId"], course["clazzId"], course["cpi"])
    __point_index = 0
    auto_skip_notopen = False
    RB = RollBackManager()

    while __point_index < len(point_list["points"]):
        point = point_list["points"][__point_index]
        result, auto_skip_notopen = process_chapter(
            chaoxing, course, point, RB, notopen_action, speed, auto_skip_notopen
        )
        if result == -1:
            break
        elif result == 0:
            __point_index -= 1
        else:
            __point_index += 1


def filter_courses(all_course, course_list, account_id):
    """筛选课程，如果未指定课程ID则等待用户输入"""
    # 显示所有课程列表
    logger.info(f"[{account_id}] " + "*" * 10 + "课程列表" + "*" * 10)
    for i, course in enumerate(all_course, 1):
        logger.info(f"[{account_id}] {i}. ID: {course['courseId']} 课程名: {course['title']}")
    logger.info(f"[{account_id}] " + "*" * 28)
    
    # 如果未指定课程ID列表
    if not course_list or (len(course_list) == 1 and course_list[0] == ''):
        logger.warning(f"[{account_id}] ⚠️ 未指定课程ID！")
        logger.info(f"[{account_id}] 请在控制台输入要学习的课程ID，多个用逗号分隔（输入 'all' 学习所有课程）:")
        
        # 等待用户输入（通过标准输入）
        try:
            user_input = input(f"[{account_id}] 课程ID: ").strip()
            if user_input.lower() == 'all' or user_input == '':
                logger.info(f"[{account_id}] 将学习所有课程")
                return all_course
            course_list = [x.strip() for x in user_input.split(',') if x.strip()]
        except EOFError:
            # 非交互模式下，提示配置错误
            logger.error(f"[{account_id}] ❌ 未配置课程ID，请先在配置文件中设置 courses 字段")
            logger.error(f"[{account_id}] 示例: courses = 123456,789012")
            return []
    
    # 根据课程ID筛选
    course_task = []
    for course in all_course:
        if course["courseId"] in course_list:
            course_task.append(course)
    
    if not course_task:
        logger.warning(f"[{account_id}] 未找到指定课程，将学习所有课程")
        return all_course
    
    logger.info(f"[{account_id}] 已选择 {len(course_task)} 门课程")
    return course_task


def run_account(account_info, common_config, tiku_config, notification_config):
    """
    执行单个账号的刷课任务 - 用于多账号并行
    
    Args:
        account_info: 账号信息字典
        common_config: 全局配置
        tiku_config: 题库配置
        notification_config: 通知配置
        
    Returns:
        执行结果字典
    """
    account_id = account_info.get("username", "unknown")
    result = {
        "account": account_id,
        "success": False,
        "message": ""
    }
    
    try:
        logger.info(f"{'='*20} [账号 {account_id}] 开始执行 {'='*20}")
        
        # 初始化
        speed = min(2.0, max(1.0, common_config.get("speed", 1.0)))
        notopen_action = common_config.get("notopen_action", "retry")
        
        chaoxing = init_chaoxing(account_info, tiku_config)
        if not chaoxing:
            result["message"] = "账号信息不完整"
            return result
        
        notification = Notification()
        notification.config_set(notification_config)
        notification = notification.get_notification_from_config()
        notification.init_notification()

        # 登录
        _login_state = chaoxing.login()
        if not _login_state["status"]:
            result["message"] = f"登录失败: {_login_state['msg']}"
            logger.error(f"[{account_id}] {result['message']}")
            return result

        # 获取课程
        all_course = chaoxing.get_course_list()
        course_task = filter_courses(all_course, account_info.get("courses"), account_id)
        logger.info(f"[{account_id}] 课程任务数量: {len(course_task)}")
        update_stats("courses", len(course_task))

        # 刷课
        for course in course_task:
            process_course(chaoxing, course, notopen_action, speed)

        logger.info(f"{'='*20} [账号 {account_id}] 完成 {'='*20}")
        result["success"] = True
        result["message"] = "所有课程学习任务已完成"
        
        if notification:
            notification.send(f"[{account_id}] 所有课程学习任务已完成")

    except Exception as e:
        result["message"] = f"错误: {type(e).__name__}: {e}"
        logger.error(f"[{account_id}] {result['message']}")
        logger.error(traceback.format_exc())
        
    return result


def main():
    """主函数 - 支持多账号并行"""
    try:
        # 初始化统计
        init_stats()
        
        common_config, tiku_config, notification_config, accounts = init_config()
        
        if not accounts:
            logger.error("未配置任何账号，请检查配置文件")
            logger.info("配置格式示例：")
            logger.info("""
[account_1]
username = 手机号1
password = 密码1
courses = 

[account_2]
username = 手机号2
password = 密码2
courses = 

[common]
speed = 2.0
notopen_action = continue
max_account_workers = 2
""")
            return

        logger.info(f"📚 共加载 {len(accounts)} 个账号")
        
        # 单账号模式
        if len(accounts) == 1:
            logger.info("📌 单账号模式运行")
            result = run_account(accounts[0], common_config, tiku_config, notification_config)
            if result["success"]:
                logger.info("✅ " + result["message"])
            else:
                logger.error("❌ " + result["message"])
        
        # 多账号并行模式
        else:
            logger.info(f"🚀 多账号并行模式运行，同时执行 {MAX_ACCOUNT_WORKERS} 个账号")
            
            results = []
            with ThreadPoolExecutor(max_workers=MAX_ACCOUNT_WORKERS) as executor:
                # 提交所有账号任务
                future_to_account = {
                    executor.submit(run_account, account, common_config, tiku_config, notification_config): account
                    for account in accounts
                }
                
                # 收集结果
                for future in as_completed(future_to_account):
                    account = future_to_account[future]
                    try:
                        result = future.result()
                        results.append(result)
                    except Exception as e:
                        results.append({
                            "account": account.get("username", "unknown"),
                            "success": False,
                            "message": str(e)
                        })
            
            # 输出汇总
            logger.info("\n" + "=" * 50)
            logger.info("📊 执行结果汇总:")
            success_count = 0
            for r in results:
                status = "✅ 成功" if r["success"] else "❌ 失败"
                logger.info(f"  [{r['account']}] {status} - {r['message']}")
                if r["success"]:
                    success_count += 1
            logger.info(f"\n总计: {success_count}/{len(accounts)} 个账号成功完成")
            logger.info("=" * 50)

    except SystemExit as e:
        sys.exit(e.code)
    except KeyboardInterrupt:
        logger.error("程序被用户手动中断")
    except BaseException as e:
        logger.error(f"错误: {type(e).__name__}: {e}")
        logger.error(traceback.format_exc())
        raise e


if __name__ == "__main__":
    main()
