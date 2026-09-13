# -*- coding: utf-8 -*-
from enum import Enum
from hashlib import md5
import re
import time
import random
import ssl
import socket
import requests
from requests.adapters import HTTPAdapter
from urllib3.poolmanager import PoolManager
from urllib3.exceptions import InsecureRequestWarning

socket.setdefaulttimeout(30)
socket.socket(socket.AF_INET, socket.SOCK_STREAM).setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)

requests.packages.urllib3.disable_warnings(InsecureRequestWarning)

from api.answer import *
from api.cipher import AESCipher
from api.config import GlobalConst as gc
from api.cookies import save_cookies, use_cookies
from api.decode import (
    decode_course_list,
    decode_course_point,
    decode_course_card,
    decode_course_folder,
    decode_questions_info,
)
from api.process import show_progress
from api.exceptions import MaxRetryExceeded


class TLS12Adapter(HTTPAdapter):
    def init_poolmanager(self, connections, maxsize, block=False):
        context = ssl.create_default_context()
        context.check_hostname = False
        context.verify_mode = ssl.CERT_NONE
        context.options |= ssl.OP_NO_TLSv1_3
        context.options |= ssl.OP_NO_TLSv1_1
        context.options |= ssl.OP_NO_TLSv1
        context.set_ciphers('DEFAULT:@SECLEVEL=1')
        
        self.poolmanager = PoolManager(
            num_pools=connections,
            maxsize=maxsize,
            block=block,
            ssl_context=context
        )


def get_timestamp():
    return str(int(time.time() * 1000))


def get_random_seconds():
    """获取随机延迟秒数，范围增大以降低被检测概率"""
    return random.randint(60, 150)


def init_session(isVideo: bool = False, isAudio: bool = False, account_id: str = None):
    """
    初始化请求会话
    
    Args:
        isVideo: 是否为视频请求
        isAudio: 是否为音频请求
        account_id: 账号标识，用于cookies隔离
    """
    _session = requests.session()
    _session.mount("http://", HTTPAdapter(max_retries=5))
    _session.mount("https://", TLS12Adapter(max_retries=5))
    _session.timeout = 30
    _session.keep_alive = False

    base_headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 Edg/129.0.0.0",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8,en-GB;q=0.7,en-US;q=0.6",
        "Accept-Encoding": "gzip, deflate, br",
        "Cache-Control": "max-age=0",
        "Upgrade-Insecure-Requests": "1",
        "Sec-Fetch-Site": "same-origin",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-User": "?1",
        "Sec-Fetch-Dest": "document",
        "DNT": "1",
        "Sec-GPC": "1",
        "Connection": "close",
    }

    if isVideo:
        _session.headers = {**base_headers, **gc.VIDEO_HEADERS}
    elif isAudio:
        _session.headers = {**base_headers, **gc.AUDIO_HEADERS}
    else:
        _session.headers = {**base_headers, **gc.HEADERS}

    # 使用账号ID加载对应的cookies
    login_cookies = use_cookies(account_id)
    if login_cookies:
        _session.cookies.update(login_cookies)
    _session.cookies.set("route", "c1a27d7d75a944a0b85779cb50588996d", domain=".chaoxing.com")
    _session.cookies.set("platform", "pc", domain=".chaoxing.com")

    return _session


class Account:
    username = None
    password = None
    account_id = None  # 账号标识，用于cookies隔离
    last_login = None
    isSuccess = None

    def __init__(self, _username, _password, _account_id=None):
        self.username = _username
        self.password = _password
        # 如果没有指定account_id，使用手机号作为标识
        self.account_id = _account_id if _account_id else _username


class Chaoxing:
    class StudyResult(Enum):
        SUCCESS = 0
        FORBIDDEN = 1
        ERROR = 2
        TIMEOUT = 3

        @staticmethod
        def is_success(result):
            return result == Chaoxing.StudyResult.SUCCESS

        @staticmethod
        def is_failure(result):
            return result != Chaoxing.StudyResult.SUCCESS

    def __init__(self, account: Account = None, tiku: Tiku = None, **kwargs):
        self.account = account
        self.account_id = account.account_id if account else None  # 账号标识
        self.cipher = AESCipher()
        self.tiku = tiku
        self.kwargs = kwargs
        self.rollback_times = 0
        # 重新登录相关配置 - 无限重试模式
        self._login_retry_count = 0
        self._relogin_cooldown = 30  # 重新登录冷却时间（秒）
        self._403_total_count = 0  # 累计403错误次数
        self._last_403_time = 0  # 上次403时间

    def login(self):
        _session = requests.session()
        _session.mount("https://", TLS12Adapter(max_retries=3))
        _session.timeout = 20
        _url = "https://passport2.chaoxing.com/fanyalogin"
        _data = {
            "fid": "-1",
            "uname": self.cipher.encrypt(self.account.username),
            "password": self.cipher.encrypt(self.account.password),
            "refer": "https%3A%2F%2Fi.chaoxing.com",
            "t": True,
            "forbidotherlogin": 0,
            "validate": "",
            "doubleFactorLogin": 0,
            "independentId": 0,
        }
        logger.trace(f"[账号 {self.account_id}] 正在尝试登录...")
        try:
            resp = _session.post(_url, headers=gc.HEADERS, data=_data)
            if resp and resp.json()["status"] == True:
                # 使用账号ID保存cookies，实现多账号隔离
                save_cookies(_session, self.account_id)
                if not use_cookies(self.account_id):
                    logger.warning("Cookie保存失败，尝试重新保存")
                    save_cookies(_session, self.account_id)
                logger.info(f"[账号 {self.account_id}] 登录成功...")
                return {"status": True, "msg": "登录成功"}
            else:
                err_msg = resp.json().get("msg2", "未知错误") if resp else "请求无响应"
                logger.error(f"[账号 {self.account_id}] 登录失败: {err_msg}")
                return {"status": False, "msg": err_msg}
        except Exception as e:
            logger.error(f"登录过程异常: {str(e)}")
            return {"status": False, "msg": f"登录异常: {str(e)}"}

    def _relogin(self):
        """
        重新登录刷新凭证 - 无限重试直到成功
        Returns:
            bool: 重新登录是否成功
        """
        self._login_retry_count += 1
        logger.warning(f"检测到 403 错误，尝试重新登录刷新凭证 (累计第 {self._login_retry_count} 次)")
        
        # 递增冷却等待时间
        base_cooldown = self._relogin_cooldown
        extra_cooldown = min(self._login_retry_count * 10, 120)  # 最大额外等待120秒
        cooldown = base_cooldown + extra_cooldown + random.uniform(5, 15)
        logger.info(f"[账号 {self.account_id}] 等待 {cooldown:.1f} 秒后重新登录...")
        time.sleep(cooldown)
        
        # 清除旧 cookies
        try:
            clear_cookies(self.account_id)
            logger.info(f"[账号 {self.account_id}] 已清除旧的登录凭证")
        except Exception as e:
            logger.warning(f"清除 cookies 文件失败: {str(e)}")
        
        # 重新登录
        login_result = self.login()
        if login_result["status"]:
            logger.info(f"[账号 {self.account_id}] 重新登录成功，凭证已刷新")
            return True
        else:
            logger.error(f"[账号 {self.account_id}] 重新登录失败: {login_result['msg']}，将继续重试...")
            return False

    def get_fid(self):
        _session = init_session(account_id=self.account_id)
        return _session.cookies.get("fid")

    def get_uid(self):
        _session = init_session(account_id=self.account_id)
        return _session.cookies.get("_uid")

    def get_course_list(self):
        try:
            time.sleep(random.uniform(3, 5))
            
            _session = init_session(account_id=self.account_id)
            _url = "https://mooc2-ans.chaoxing.com/mooc2-ans/visit/courselistdata"
            _data = {"courseType": 1, "courseFolderId": 0, "query": "", "superstarClass": 0}
            logger.trace("正在读取所有的课程列表...")
            
            _headers = {
                "Host": "mooc2-ans.chaoxing.com",
                "sec-ch-ua": '"Microsoft Edge";v="129", "Not=A?Brand";v="8", "Chromium";v="129"',
                "sec-ch-ua-mobile": "?0",
                "sec-ch-ua-platform": '"Windows"',
                "X-Requested-With": "XMLHttpRequest",
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 Edg/129.0.0.0",
                "Accept": "application/json, text/javascript, */*; q=0.01",
                "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
                "Origin": "https://mooc2-ans.chaoxing.com",
                "Sec-Fetch-Site": "same-origin",
                "Sec-Fetch-Mode": "cors",
                "Sec-Fetch-Dest": "empty",
                "Referer": "https://mooc2-ans.chaoxing.com/mooc2-ans/visit/interaction?moocDomain=https://mooc1-1.chaoxing.com/mooc-ans",
                "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8,en-GB;q=0.7,en-US;q=0.6,ja;q=0.5",
                "Connection": "close",
            }

            max_retries = 20
            retry_count = 0
            resp = None
            while retry_count < max_retries:
                try:
                    resp = _session.post(
                        _url, 
                        headers=_headers, 
                        data=_data,
                        timeout=30,
                        allow_redirects=True
                    )
                    if resp.status_code == 200:
                        break
                    else:
                        logger.warning(f"课程列表请求失败（状态码：{resp.status_code}），重试中...({retry_count+1}/{max_retries})")
                except Exception as e:
                    retry_count += 1
                    wait = random.uniform(5, 10)
                    logger.warning(f"课程列表连接失败，{wait:.1f}秒后重试 ({retry_count}/{max_retries})")
                    time.sleep(wait)

            logger.info("课程列表读取完毕...")
            course_list = decode_course_list(resp.text)

            time.sleep(random.uniform(1, 2))
            _interaction_url = "https://mooc2-ans.chaoxing.com/mooc2-ans/visit/interaction"
            
            for retry in range(5):
                try:
                    _interaction_resp = _session.get(_interaction_url, timeout=30)
                    course_folder = decode_course_folder(_interaction_resp.text)
                    break
                except:
                    time.sleep(random.uniform(2,4))
                    course_folder = []
            
            for folder in course_folder:
                time.sleep(random.uniform(1, 2))
                _data = {
                    "courseType": 1,
                    "courseFolderId": folder["id"],
                    "query": "",
                    "superstarClass": 0,
                }
                for retry in range(5):
                    try:
                        resp = _session.post(_url, data=_data, headers=_headers, timeout=30)
                        course_list += decode_course_list(resp.text)
                        break
                    except:
                        time.sleep(random.uniform(2,4))
            
            return course_list
        except:
            logger.warning("课程列表获取失败，使用兼容模式继续运行")
            return []

    def get_course_point(self, _courseid, _clazzid, _cpi):
        for retry in range(10):
            try:
                _session = init_session(account_id=self.account_id)
                _url = f"https://mooc2-ans.chaoxing.com/mooc2-ans/mycourse/studentcourse?courseid={_courseid}&clazzid={_clazzid}&cpi={_cpi}&ut=s"
                logger.trace("开始读取课程所有章节...")
                resp = _session.get(_url, timeout=30)
                logger.info("课程章节读取成功...")
                return decode_course_point(resp.text)
            except Exception as e:
                if retry >=9:
                    logger.error("章节读取失败，已达最大次数")
                    return []
                wait = random.uniform(2,4)
                logger.warning(f"章节读取断开，{wait:.1f}秒后重试")
                time.sleep(wait)

    def get_job_list(self, _clazzid, _courseid, _cpi, _knowledgeid):
        _session = init_session(account_id=self.account_id)
        job_list = []
        job_info = {}
        for _possible_num in ["0","1","2","3","4","5","6"]:
            for retry in range(5):
                try:
                    _url = f"https://mooc1.chaoxing.com/mooc-ans/knowledge/cards?clazzid={_clazzid}&courseid={_courseid}&knowledgeid={_knowledgeid}&num={_possible_num}&ut=s&cpi={_cpi}&v=20160407-3&mooc2=1"
                    logger.trace("开始读取章节所有任务点...")
                    resp = _session.get(_url, timeout=30)
                    _job_list, _job_info = decode_course_card(resp.text)
                    if _job_info.get("notOpen", False):
                        logger.info("该章节未开放")
                        return [], _job_info
                    job_list += _job_list
                    job_info.update(_job_info)
                    break
                except:
                    time.sleep(random.uniform(2,4))
        logger.info("章节任务点读取成功...")
        return job_list, job_info

    def get_enc(self, clazzId, jobid, objectId, playingTime, duration, userid):
        return md5(
            f"[{clazzId}][{userid}][{jobid}][{objectId}][{playingTime * 1000}][d_yHJ!$pdA~5][{duration * 1000}][0_{duration}]".encode()
        ).hexdigest()

    def video_progress_log(
        self,
        _session,
        _course,
        _job,
        _job_info,
        _dtoken,
        _duration,
        _playingTime,
        _type: str = "Video",
        _enable_relogin: bool = True,
    ):
        """
        视频进度上报 - 无限重试直到成功
        遇到403错误不会跳过，会一直重试直到请求成功
        """
        if "courseId" in _job["otherinfo"]:
            _mid_text = f"otherInfo={_job['otherinfo']}&"
        else:
            _mid_text = f"otherInfo={_job['otherinfo']}&courseId={_course['courseId']}&"
        
        _403_count = 0  # 本次调用连续403计数
        _max_403_before_relogin = 3  # 连续多少次403后触发重新登录
        _retry_count = 0  # 总重试次数
        
        while True:  # 无限循环直到成功
            _retry_count += 1
            _success = False
            resp = None
            
            try:
                # 递增延迟：随着重试次数增加，延迟时间也增加
                base_delay = min(2 + _retry_count * 0.5, 30)  # 基础延迟，最大30秒
                pre_delay = random.uniform(base_delay, base_delay + 3)
                time.sleep(pre_delay)
                
                for _possible_rt in ["0.9", "1"]:
                    _url = (
                        f"https://mooc1.chaoxing.com/mooc-ans/multimedia/log/a/"
                        f"{_course['cpi']}/"
                        f"{_dtoken}?"
                        f"clazzId={_course['clazzId']}&"
                        f"playingTime={_playingTime}&"
                        f"duration={_duration}&"
                        f"clipTime=0_{_duration}&"
                        f"objectId={_job['objectid']}&"
                        f"{_mid_text}"
                        f"jobid={_job['jobid']}&"
                        f"userid={self.get_uid()}&"
                        f"isdrag=3&"
                        f"view=pc&"
                        f"enc={self.get_enc(_course['clazzId'], _job['jobid'], _job['objectid'], _playingTime, _duration, self.get_uid())}&"
                        f"rt={_possible_rt}&"
                        f"dtype={_type}&"
                        f"_t={get_timestamp()}"
                    )
                    resp = _session.get(_url, timeout=20)
                    
                    if resp.status_code == 200:
                        _success = True
                        _403_count = 0
                        self._403_total_count = 0  # 重置全局403计数
                        break
                    elif resp.status_code == 403:
                        _403_count += 1
                        self._403_total_count += 1
                        logger.warning(f"⚠️ 收到 403 响应 (本次连续第 {_403_count} 次, 累计第 {self._403_total_count} 次)")
                        logger.info(f"📍 当前任务: {_job['name']}, 播放进度: {_playingTime}/{_duration}秒")
                        
                        # 连续多次403后尝试重新登录
                        if _403_count >= _max_403_before_relogin and _enable_relogin:
                            logger.info("🔄 触发重新登录机制...")
                            if self._relogin():
                                # 重新登录成功，重新初始化session
                                if _type == "Video":
                                    _session = init_session(isVideo=True, account_id=self.account_id)
                                else:
                                    _session = init_session(isAudio=True, account_id=self.account_id)
                                _403_count = 0
                                logger.info("✅ 重新登录成功，继续重试...")
                            else:
                                logger.warning("⏳ 重新登录失败，等待后继续重试...")
                                # 登录失败也要继续，因为可能是临时网络问题
                                time.sleep(random.uniform(10, 20))
                        continue
                
                if _success:
                    logger.info(f"✅ 进度上报成功 (重试{_retry_count}次后成功)")
                    return resp.json(), 200
                    
            except Exception as e:
                logger.warning(f"❌ 请求异常: {str(e)[:50]}")
                wait_sec = random.uniform(5, 10)
                logger.info(f"⏳ {wait_sec:.1f}秒后重试 (第 {_retry_count} 次重试)")
                time.sleep(wait_sec)
                
            # 如果失败，继续循环
            logger.info(f"🔁 继续重试视频进度上报... (当前进度: {_playingTime}秒)")

    def study_video(
        self, _course, _job, _job_info, _speed: float = 1.0, _type: str = "Video"
    ) -> StudyResult:
        """
        学习视频任务 - 无限重试直到成功
        遇到403不会跳过，会一直重试直到视频学习完成
        """
        video_retry_count = 0
        
        while True:  # 无限循环直到成功
            video_retry_count += 1
            
            try:
                if _type == "Video":
                    _session = init_session(isVideo=True, account_id=self.account_id)
                else:
                    _session = init_session(isAudio=True, account_id=self.account_id)
                _session.headers.update()
                _info_url = f"https://mooc1.chaoxing.com/ananas/status/{_job['objectid']}?k={self.get_fid()}&flag=normal"
                _video_info = _session.get(_info_url, timeout=30).json()
                
                if _video_info["status"] == "success":
                    _dtoken = _video_info["dtoken"]
                    _duration = _video_info["duration"]
                    _isPassed = False
                    _isFinished = False
                    _playingTime = 0
                    
                    if video_retry_count == 1:
                        logger.info(f"🎬 开始任务: {_job['name']}, 总时长: {_duration}秒")
                    else:
                        logger.info(f"🔄 重试任务: {_job['name']} (第{video_retry_count}次尝试)")
                    
                    while not _isFinished:
                        _isPassed, state = self.video_progress_log(
                            _session,
                            _course,
                            _job,
                            _job_info,
                            _dtoken,
                            _duration,
                            _playingTime,
                            _type,
                        )
                        
                        # video_progress_log 现在会无限重试直到成功，所以这里一定能收到成功的响应
                        if not _isPassed or (_isPassed and _isPassed.get("isPassed")):
                            _isFinished = True
                            break
                        
                        _wait_time = get_random_seconds()
                        if _playingTime + _wait_time >= int(_duration):
                            _wait_time = int(_duration) - _playingTime
                            _isPassed, state = self.video_progress_log(
                                _session, _course, _job, _job_info, _dtoken, 
                                _duration, _duration, _type
                            )
                            if _isPassed.get('isPassed'):
                                _isFinished = True
                        
                        show_progress(_job["name"], _playingTime, _wait_time, _duration, _speed)
                        _playingTime += _wait_time
                    
                    print("\r", end="", flush=True)
                    logger.info(f"✅ 任务完成: {_job['name']}")
                    return self.StudyResult.SUCCESS
                else:
                    logger.warning(f"⚠️ 视频信息获取失败，等待后重试...")
                    time.sleep(random.uniform(10, 20))
                    continue
                    
            except Exception as e:
                logger.warning(f"❌ 视频任务异常: {str(e)[:50]}")
                wait = random.uniform(10, 20)
                logger.info(f"⏳ {wait:.1f}秒后重试整个视频任务...")
                time.sleep(wait)
                continue

    def study_document(self, _course, _job) -> StudyResult:
        for retry in range(10):
            try:
                _session = init_session(account_id=self.account_id)
                _url = f"https://mooc1.chaoxing.com/ananas/job/document?jobid={_job['jobid']}&knowledgeid={re.findall(r'nodeId_(.*?)-', _job['otherinfo'])[0]}&courseid={_course['courseId']}&clazzid={_course['clazzId']}&jtoken={_job['jtoken']}&_dc={get_timestamp()}"
                _resp = _session.get(_url, timeout=30)
                if _resp.status_code == 200:
                    return self.StudyResult.SUCCESS
            except Exception as e:
                wait = random.uniform(2,4)
                logger.warning(f"文档任务断开，{wait:.1f}秒后重试 ({retry+1}/10)")
                time.sleep(wait)
        return self.StudyResult.SUCCESS

    def study_work(self, _course, _job, _job_info) -> StudyResult:
        try:
            if self.tiku.DISABLE or not self.tiku:
                return self.StudyResult.SUCCESS
            _ORIGIN_HTML_CONTENT = ""

            def random_answer(options: str) -> str:
                answer = ""
                if not options:
                    return answer

                if q["type"] == "multiple":
                    logger.debug(f"当前选项列表[cut前] -> {options}")
                    _op_list = multi_cut(options)
                    logger.debug(f"当前选项列表[cut后] -> {_op_list}")

                    if not _op_list:
                        logger.error(
                            "选项为空, 未能正确提取题目选项信息! 请反馈并提供以上信息"
                        )
                        return answer

                    available_options = len(_op_list)
                    select_count = 0
            
                    if available_options <= 1:
                        select_count = available_options
                    else:
                        max_possible = min(4, available_options)
                        min_possible = min(2, available_options)
                
                        weights_map = {
                            2: [1.0],
                            3: [0.3, 0.7],
                            4: [0.1, 0.5, 0.4],
                            5: [0.1, 0.4, 0.3, 0.2],
                        }
                
                        weights = weights_map.get(max_possible, [0.3, 0.4, 0.3])
                        possible_counts = list(range(min_possible, max_possible + 1))
                
                        weights = weights[:len(possible_counts)]
                
                        weights_sum = sum(weights)
                        if weights_sum > 0:
                            weights = [w/weights_sum for w in weights]
                    
                        select_count = random.choices(possible_counts, weights=weights, k=1)[0]

                    selected_options = random.sample(_op_list, select_count) if select_count > 0 else []

                    for option in selected_options:
                        answer += option[:1]

                    answer = "".join(sorted(answer))
                elif q["type"] == "single":
                    answer = random.choice(options.split("\n"))[:1]
                elif q["type"] == "judgement":
                    answer = "true" if random.choice([True, False]) else "false"
                logger.info(f"随机选择 -> {answer}")
                return answer

            def multi_cut(answer: str):
                cut_char = [
                    "\n",
                    ",",
                    "，",
                    "|",
                    "\r",
                    "\t",
                    "#",
                    "*",
                    "-",
                    "_",
                    "+",
                    "@",
                    "~",
                    "/",
                    "\\",
                    ".",
                    "&",
                    " ",
                    "、",
                ]
                res = cut(answer)
                if res is None:
                    logger.warning(
                        f"未能从网页中提取题目信息, 以下为相关信息：\n\t{answer}\n\n{_ORIGIN_HTML_CONTENT}\n"
                    )
                    logger.warning("未能正确提取题目选项信息! 请反馈并提供以上信息")
                    return None
                else:
                    return res

            def clean_res(res):
                cleaned_res = []
                if isinstance(res, str):
                    res = [res]
                for c in res:
                    cleaned_res.append(re.sub(r'^[A-Za-z]|[.,!?;:，。！？；：]', '', c))
                return cleaned_res

            def is_subsequence(a, o):
                iter_o = iter(o)
                return all(c in iter_o for c in a)

            def with_retry(max_retries=3, delay=1):
                def decorator(func):
                    def wrapper(*args, **kwargs):
                        retries = 0
                        while retries < max_retries:
                            try:
                                _resp = func(*args, **kwargs)
                                
                                if '教师未创建完成该测验' in _resp.text:
                                    raise PermissionError("教师未创建完成该测验")

                                questions = decode_questions_info(_resp.text)
                        
                                if _resp.status_code == 200 and questions.get("questions"):
                                    return (_resp, questions)
                        
                                logger.warning(f"无效响应 (Code: {getattr(_resp, 'status_code', 'Unknown')}), 重试中... ({retries+1}/{max_retries})")
                    
                            except requests.exceptions.RequestException as e:
                                logger.warning(f"请求失败: {str(e)[:50]}, 重试中... ({retries+1}/{max_retries})")
                            retries += 1
                            time.sleep(delay * (2 ** retries))
                        raise MaxRetryExceeded(f"超过最大重试次数 ({max_retries})")
                    return wrapper
                return decorator

            _session = init_session(account_id=self.account_id)
            headers = {
                "Host": "mooc1.chaoxing.com",
                "sec-ch-ua": '"Microsoft Edge";v="129", "Not=A?Brand";v="8", "Chromium";v="129"',
                "sec-ch-ua-mobile": "?0",
                "sec-ch-ua-platform": '"Windows"',
                "Upgrade-Insecure-Requests": "1",
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 Edg/129.0.0.0",
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
                "Sec-Fetch-Site": "same-origin",
                "Sec-Fetch-Mode": "navigate",
                "Sec-Fetch-Dest": "iframe",
                "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8,en-GB;q=0.7,en-US;q=0.6,ja;q=0.5",
            }
            cookies = _session.cookies.get_dict()

            _url = "https://mooc1.chaoxing.com/mooc-ans/api/work"

            @with_retry(max_retries=3, delay=1)
            def fetch_response():
                return requests.get(
                        _url,
                        headers=headers,
                        cookies=cookies,
                        params={
                            "api": "1",
                            "workId": _job["jobid"].replace("work-", ""),
                            "jobid": _job["jobid"],
                            "originJobId": _job["jobid"],
                            "needRedirect": "true",
                            "skipHeader": "true",
                            "knowledgeid": str(_job_info["knowledgeid"]),
                            "ktoken": _job_info["ktoken"],
                            "cpi": _job_info["cpi"],
                            "ut": "s",
                            "clazzId": _course["clazzId"],
                            "type": "",
                            "enc": _job["enc"],
                            "mooc2": "1",
                            "courseid": _course["courseId"],
                        }
                )

            final_resp = {}
            questions = {}

            try:
                final_resp, questions = fetch_response()
            except Exception as e:
                logger.error(f"请求失败: {e}")
                return self.StudyResult.SUCCESS
            
            _ORIGIN_HTML_CONTENT = final_resp.text

            total_questions = len(questions["questions"])
            found_answers = 0
            for q in questions["questions"]:
                logger.debug(f"当前题目信息 -> {q}")
                query_delay = self.kwargs.get("query_delay",0)
                time.sleep(query_delay)
                res = self.tiku.query(q)
                answer = ""
                answer_source_key = f"answerSource{q['id']}"
                q[answer_source_key] = "random"
                
                if res:
                    if q["type"] == "multiple":
                        options_list = multi_cut(q["options"])
                        res_list = multi_cut(res)
                        if res_list is not None and options_list is not None:
                            for _a in clean_res(res_list):
                                for o in options_list:
                                    if is_subsequence(_a, o):
                                        answer += o[:1]
                            answer = "".join(sorted(answer))
                    elif q["type"] == "single":
                        options_list = multi_cut(q["options"])
                        if options_list is not None:
                            t_res = clean_res(res)
                            for o in options_list:
                                if is_subsequence(t_res[0], o):
                                    answer = o[:1]
                                    break
                    elif q["type"] == "judgement":
                        answer = "true" if self.tiku.judgement_select(res) else "false"
                    elif q["type"] == "completion":
                        if isinstance(res,list):
                            answer = "".join(res)
                        elif isinstance(res,str):
                            answer = res
                    else:
                        answer = res

                    if answer:
                        logger.info(f"成功获取到答案：{answer}")
                        q[answer_source_key] = "cover"
                        found_answers += 1
                    else:
                        logger.warning(f"找到答案但答案未能匹配 -> {res}\t随机选择答案")
                        answer = random_answer(q["options"])
                else:
                    answer = random_answer(q["options"])
            
                q["answerField"][f'answer{q["id"]}'] = answer
                logger.info(f'{q["title"]} 填写答案为 {answer}')
                
            cover_rate = (found_answers / total_questions) * 100 if total_questions > 0 else 0
            logger.info(f"章节检测题库覆盖率： {cover_rate:.0f}%")

            # 自动提交逻辑修复：
            # 1. 如果SUBMIT=True（开启自动提交），只要找到答案就提交
            # 2. 如果SUBMIT=False（关闭自动提交），检查覆盖率是否达标
            if self.tiku.SUBMIT:
                # 开启自动提交，只要找到答案就提交
                if found_answers > 0:
                    questions["pyFlag"] = ""  # 提交
                    logger.info(f"自动提交已开启，找到{found_answers}个答案，执行提交")
                else:
                    questions["pyFlag"] = "1"  # 未找到答案，仅保存
                    logger.info(f"未找到任何答案，仅保存不提交")
            elif self.tiku.get_submit_params() == "1":
                # SUBMIT=False，不提交
                questions["pyFlag"] = "1"
                logger.info(f"自动提交已关闭，仅保存不提交")
            elif cover_rate >= self.tiku.COVER_RATE*100 or self.rollback_times >= 1:
                # 覆盖率达标或回滚过，提交
                questions["pyFlag"] = ""
                logger.info(f"覆盖率{cover_rate:.0f}%达标，执行提交")
            else:
                questions["pyFlag"] = "1"
                logger.info(f"章节检测题库覆盖率低于{self.tiku.COVER_RATE*100:.0f}%，不予提交")

            for q in questions["questions"]:
                answer_source_key = f"answerSource{q['id']}"
                ans_val = q["answerField"][f'answer{q["id"]}'] if q.get(answer_source_key) == "cover" else ''
                questions[f'answer{q["id"]}'] = ans_val
                questions[f'answertype{q["id"]}'] = q["answerField"][f'answertype{q["id"]}']

            del questions["questions"]

            res = _session.post(
                "https://mooc1.chaoxing.com/mooc-ans/work/addStudentWorkNew",
                data=questions,
                headers={
                    "Host": "mooc1.chaoxing.com",
                    "sec-ch-ua-platform": '"Windows"',
                    "X-Requested-With": "XMLHttpRequest",
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 Edg/129.0.0.0",
                    "Accept": "application/json, text/javascript, */*; q=0.01",
                    "sec-ch-ua": '"Microsoft Edge";v="129", "Not=A?Brand";v="8", "Chromium";v="129"',
                    "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
                    "sec-ch-ua-mobile": "?0",
                    "Origin": "https://mooc1.chaoxing.com",
                    "Sec-Fetch-Site": "same-origin",
                    "Sec-Fetch-Mode": "cors",
                    "Sec-Fetch-Dest": "empty",
                    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8,en-GB;q=0.7,en-US;q=0.6,ja;q=0.5",
                },
            )
            if res.status_code == 200:
                res_json = res.json()
                if res_json["status"]:
                    logger.info(f'{"提交" if questions["pyFlag"] == "" else "保存"}答题成功 -> {res_json["msg"]}')
                else:
                    logger.error(f'{"提交" if questions["pyFlag"] == "" else "保存"}答题失败 -> {res_json["msg"]}')
            else:
                logger.error(f'{"提交" if questions["pyFlag"] == "" else "保存"}答题失败 -> {res.text}')
        except Exception as e:
            logger.warning(f"作业任务异常：{str(e)}，自动跳过")
        return self.StudyResult.SUCCESS

    def strdy_read(self, _course, _job, _job_info) -> StudyResult:
        for retry in range(10):
            try:
                _session = init_session(account_id=self.account_id)
                _resp = _session.get(
                    url="https://mooc1.chaoxing.com/ananas/job/readv2",
                    params={
                        "jobid": _job["jobid"],
                        "knowledgeid": _job_info["knowledgeid"],
                        "jtoken": _job["jtoken"],
                        "courseid": _course["courseId"],
                        "clazzid": _course["clazzId"],
                    },
                    timeout=30
                )
                if _resp.status_code == 200:
                    _resp_json = _resp.json()
                    logger.info(f"阅读任务学习 -> {_resp_json['msg']}")
                    return self.StudyResult.SUCCESS
            except Exception as e:
                wait = random.uniform(2,4)
                logger.warning(f"阅读任务断开，{wait:.1f}秒后重试")
                time.sleep(wait)
        return self.StudyResult.SUCCESS

    def study_emptypage(self, _course, _chapterId):
        for retry in range(10):
            try:
                _session = init_session(account_id=self.account_id)
                _resp = _session.get(
                    url="https://mooc1.chaoxing.com/mooc-ans/mycourse/studentstudyAjax",
                    params={
                        "courseId": _course["courseId"],
                        "clazzid": _course["clazzId"],
                        "chapterId": _chapterId['id'],
                        "cpi": 0,
                        "verificationcode": "",
                        "mooc2": 1,
                        "microTopicId": 0,
                        "editorPreview": 0,
                    },
                    timeout=30
                )
                if _resp.status_code == 200:
                    logger.info(f"空页面任务完成 -> {_chapterId['title']}")
                    return self.StudyResult.SUCCESS
            except:
                time.sleep(random.uniform(2,4))
        return self.StudyResult.SUCCESS