import configparser
import json
import random
import re
import time
from pathlib import Path
from re import sub

import httpx
import requests
from openai import OpenAI
from urllib3 import disable_warnings, exceptions

from api.answer_check import *
from api.logger import logger

# 关闭警告
disable_warnings(exceptions.InsecureRequestWarning)

class CacheDAO:
    """
    @Author: SocialSisterYi
    @Reference: https://github.com/SocialSisterYi/xuexiaoyi-to-xuexitong-tampermonkey-proxy
    """
    DEFAULT_CACHE_FILE = "cache.json"

    def __init__(self, file: str = DEFAULT_CACHE_FILE):
        self.cache_file = Path(file)
        if not self.cache_file.is_file():
            self._write_cache({})

    def _read_cache(self):
        """读取缓存文件"""
        try:
            with self.cache_file.open("r", encoding="utf8") as fp:
                return json.load(fp)
        except (IOError, json.JSONDecodeError):
            logger.error(f"读取缓存文件失败，初始化空缓存")
            return {}

    def _write_cache(self, data: dict):
        """写入缓存文件"""
        try:
            with self.cache_file.open("w", encoding="utf8") as fp:
                json.dump(data, fp, ensure_ascii=False, indent=4)
        except IOError as e:
            logger.error(f"写入缓存失败: {e}")

    def get_cache(self, question: str):
        """获取指定问题的缓存答案"""
        data = self._read_cache()
        return data.get(question)

    def add_cache(self, question: str, answer: str) -> None:
        """添加问题-答案到缓存"""
        data = self._read_cache()
        data[question] = answer
        self._write_cache(data)


class Tiku:
    """题库基类，负责题库初始化、配置加载等核心逻辑"""
    CONFIG_PATH = "config.ini"  # 默认配置文件路径
    DISABLE = False     # 停用标志
    SUBMIT = False      # 提交标志
    COVER_RATE = 0.8    # 覆盖率

    def __init__(self) -> None:
        self._name = None
        self._api = None
        self._conf = None
        self._token = None  # 初始化token属性，避免未定义报错
        self.true_list = []  # 正确答案列表
        self.false_list = []  # 错误答案列表
        self.query_delay = 0  # 查询延迟

    @property
    def name(self):
        return self._name
    
    @name.setter
    def name(self, value):
        self._name = value

    @property
    def api(self):
        return self._api
    
    @api.setter
    def api(self, value):
        self._api = value

    @property
    def token(self):
        return self._token

    @token.setter
    def token(self, value):
        self._token = value

    def config_set(self, config: dict):
        """设置题库配置"""
        if not isinstance(config, dict):
            raise TypeError("配置必须是字典类型")
        self._conf = config

    def get_tiku_from_config(self):
        """从配置文件加载题库"""
        if not self._conf:
            # 尝试从默认配置文件加载
            self.config_set(self._get_conf())
        if self.DISABLE:
            return self
        try:
            cls_name = self._conf.get('provider', '')
            if not cls_name:
                raise KeyError("provider配置缺失")
        except KeyError as e:
            logger.error(f"未找到题库配置({e}), 已忽略题库功能")
            self.DISABLE = True
            return self
        try:
            new_cls = globals()[cls_name]()
            new_cls.config_set(self._conf)
            return new_cls
        except KeyError:
            logger.error(f"指定的题库类 {cls_name} 不存在，已忽略题库功能")
            self.DISABLE = True
            return self

    def _get_conf(self):
        """从默认配置文件读取配置"""
        try:
            config = configparser.ConfigParser()
            config.read(self.CONFIG_PATH, encoding="utf8")
            return dict(config['tiku']) if config.has_section('tiku') else {}
        except FileNotFoundError:
            logger.info("未找到配置文件config.ini, 已忽略题库功能")
            self.DISABLE = True
            return {}

    def init_tiku(self):
        """初始化题库 - 核心修复：解决KeyError并兼容原有逻辑"""
        if self.DISABLE:
            return
        try:
            # 1. 加载基础配置
            self.SUBMIT = True if self._conf.get('submit', 'false') == 'true' else False
            self.COVER_RATE = float(self._conf.get('cover_rate', 0.9))
            
            # 2. 安全加载true_list/false_list，彻底解决KeyError
            true_list_str = self._conf.get('true_list', '').strip()
            self.true_list = [item.strip() for item in true_list_str.split(',') if item.strip()]
            
            false_list_str = self._conf.get('false_list', '').strip()
            self.false_list = [item.strip() for item in false_list_str.split(',') if item.strip()]
            
            # 3. 加载查询延迟
            self.query_delay = float(self._conf.get('delay', 0))

            # 调试信息（可选）
            logger.info(f"题库初始化完成：")
            logger.info(f"  - 正确列表(true_list): {self.true_list}")
            logger.info(f"  - 错误列表(false_list): {self.false_list}")
            logger.info(f"  - 提交模式: {self.SUBMIT} | 覆盖率: {self.COVER_RATE}")

            # 4. 调用子类自定义初始化（捕获子类异常）
            try:
                self._init_tiku()
            except Exception as e:
                logger.error(f"{self.name} 初始化失败: {e}，自动禁用该题库")
                self.DISABLE = True
                return
        
        except Exception as e:
            logger.error(f"题库全局初始化失败: {str(e)}，自动禁用所有题库")
            self.DISABLE = True

    def _init_tiku(self):
        """子类自定义初始化方法（占位）"""
        pass

    def query(self, q_info: dict):
        """查询题目答案（主入口）"""
        if self.DISABLE:
            return None

        # 预处理题目标题，去除无关字段
        logger.debug(f"原始标题：{q_info['title']}")
        q_info['title'] = sub(r'^\d+', '', q_info['title'])
        q_info['title'] = sub(r'（\d+\.\d+分）$', '', q_info['title'])
        logger.debug(f"处理后标题：{q_info['title']}")

        # 先查缓存
        cache_dao = CacheDAO()
        answer = cache_dao.get_cache(q_info['title'])
        if answer:
            logger.info(f"从缓存中获取答案：{q_info['title']} -> {answer}")
            return answer.strip()
        
        # 缓存未命中，调用子类查询
        answer = self._query(q_info)
        if answer:
            answer = answer.strip()
            cache_dao.add_cache(q_info['title'], answer)
            logger.info(f"从{self.name}获取答案：{q_info['title']} -> {answer}")
            if check_answer(answer, q_info['type'], self):
                return answer
            else:
                logger.info(f"答案类型与题目类型不符，已舍弃")
                return None
                
        logger.error(f"从{self.name}获取答案失败：{q_info['title']}")
        return None

    def _query(self, q_info: dict):
        """子类实现具体查询逻辑（占位）"""
        pass

    def judgement_select(self, answer: str) -> bool:
        """判断题答案转换（匹配true_list/false_list）"""
        if self.DISABLE:
            return False
        answer = answer.strip()
        if answer in self.true_list:
            return True
        elif answer in self.false_list:
            return False
        else:
            logger.error(f'无法判断答案 -> {answer}，本次随机选择')
            return random.choice([True, False])
    
    def get_submit_params(self):
        """获取答题提交参数（pyFlag）"""
        return "" if self.SUBMIT else "1"


# ========== 以下为各题库子类实现 ==========
class TikuYanxi(Tiku):
    """言溪题库实现"""
    def __init__(self) -> None:
        super().__init__()
        self.name = '言溪题库'
        self.api = 'https://tk.enncy.cn/query'
        self._token_index = 0   # token队列计数器
        self._times = 100       # 剩余查询次数

    def _query(self, q_info: dict):
        # 检查token是否有效
        if not self._token:
            logger.error(f"{self.name} Token未配置，跳过查询")
            return None

        res = requests.get(
            self.api,
            params={
                'question': q_info['title'],
                'token': self._token,
            },
            verify=False
        )
        if res.status_code == 200:
            res_json = res.json()
            if not res_json['code']:
                # TOKEN次数不足，更换token重试
                if self._times == 0 or '次数不足' in res_json['data'].get('answer', ''):
                    logger.info(f'TOKEN查询次数不足, 更换token重新查询')
                    self._token_index += 1
                    self.load_token()
                    return self._query(q_info)
                logger.error(f'{self.name}查询失败: 剩余次数{res_json["data"].get("times", self._times)} | 消息:{res_json["message"]}')
                return None
            self._times = res_json["data"].get("times", self._times)
            return res_json['data']['answer'].strip()
        else:
            logger.error(f'{self.name}查询失败: {res.text}')
        return None
    
    def load_token(self): 
        """加载token（支持多token轮询 + 配置兜底）"""
        token_str = self._conf.get('tokens', '')
        if not token_str:
            logger.error(f"{self.name} 未配置tokens字段，自动禁用该题库")
            self.DISABLE = True
            return
        
        token_list = token_str.split(',')
        if self._token_index >= len(token_list):
            logger.error(f"{self.name} TOKEN已用完, 自动禁用该题库")
            self.DISABLE = True
            return
        self._token = token_list[self._token_index]

    def _init_tiku(self):
        """自定义初始化：加载token"""
        self.load_token()


class TikuLike(Tiku):
    """Like知识库实现"""
    def __init__(self) -> None:
        super().__init__()
        self.name = 'Like知识库'
        self.ver = '1.0.8'
        self.query_api = 'https://api.datam.site/search'
        self.balance_api = 'https://api.datam.site/balance'
        self.homepage = 'https://www.datam.site'
        self._model = None
        self._token = None
        self._times = -1
        self._search = False
        self._count = 0

    def _query(self, q_info: dict):
        # 检查token是否有效
        if not self._token:
            logger.error(f"{self.name} Token未配置，跳过查询")
            return None

        # 题目类型映射
        q_info_map = {"single":"【单选题】","multiple":"【多选题】","completion":"【填空题】","judgement":"【判断题】"}
        api_params_map = {0:"others",1:"choose",2:"fills",3:"judge"}
        option_map = {"A":0,"B":1,"C":2,"D":3,"E":4,"F":5,"G":6,"H":7,
                      "a":0,"b":1,"c":2,"d":3,"e":4,"f":5,"g":6,"h":7}

        # 构造查询内容
        q_info_prefix = q_info_map.get(q_info['type'],"【其他类型题目】")
        options = ', '.join(q_info['options']) if isinstance(q_info['options'], list) else q_info['options']
        question = f"{q_info_prefix}{q_info['title']}\n{options}"

        # 发送查询请求
        res = requests.post(
            self.query_api,
            json={
                'query': question,
                'token': self._token,
                'model': self._model if self._model else '',
                'search': self._search
            },
            verify=False
        )

        if res.status_code == 200:
            res_json = res.json()
            q_type = res_json['data'].get('type', 0)
            params = api_params_map.get(q_type, "")
            tans = res_json['data'].get(params, "")
            ans = ""
            
            # 解析不同类型答案
            match q_type:
                case 1:  # 选择题
                    for i in tans:
                        ans += q_info['options'][option_map[i]] + '\n'
                case 2:  # 填空题
                    for i in tans:
                        ans += i + '\n'
                case 3:  # 判断题
                    ans = "正确" if tans == 1 else "错误"
                case 0:  # 其他
                    ans = tans
            ret = ans.strip()
            
            # 更新剩余次数
            self._times -= 1
            self._count = (self._count + 1) % 10
            if self._count == 0:
                self.update_times()
            
            return ret
        else:
            logger.error(f'{self.name}查询失败: {res.text}')
            return None
    
    def update_times(self):
        """更新剩余查询次数"""
        if not self._token:
            return
        res = requests.post(
            self.balance_api,
            json={'token': self._token},
            verify=False
        )
        if res.status_code == 200:
            self._times = res.json()["data"].get("balance", self._times)
            logger.info(f"LIKE知识库剩余查询次数: {self._times}")
        else:
            logger.error('TOKEN错误，请检查配置')

    def load_token(self): 
        """加载token（取最后一个 + 配置兜底）"""
        token_str = self._conf.get('tokens', '')
        if not token_str:
            logger.error(f"{self.name} 未配置tokens字段，自动禁用该题库")
            self.DISABLE = True
            return
        self._token = token_str.split(',')[-1] if ',' in token_str else token_str

    def load_config(self):
        """加载Like知识库配置 + 兜底"""
        self._search = self._conf.get('likeapi_search', False)
        self._model = self._conf.get('likeapi_model', None)

    def _init_tiku(self):
        """自定义初始化"""
        self.load_token()
        self.load_config()
        self.update_times()


class TikuAdapter(Tiku):
    """TikuAdapter题库实现"""
    def __init__(self) -> None:
        super().__init__()
        self.name = 'TikuAdapter题库'
        self.api = ''

    def _query(self, q_info: dict):
        # 检查API地址是否有效
        if not self.api:
            logger.error(f"{self.name} API地址未配置，跳过查询")
            return None

        # 题目类型映射
        type_map = {"single":0, "multiple":1, "completion":2, "judgement":3}
        q_type = type_map.get(q_info['type'], 4)

        # 清理选项（去除字母前缀）
        options = q_info['options'].split('\n') if q_info.get('options') else []
        cleaned_options = [sub(r'^[A-Za-z]\.?、?\s?', '', opt) for opt in options]

        # 发送查询请求
        res = requests.post(
            self.api,
            json={
                'question': q_info['title'],
                'options': cleaned_options,
                'type': q_type
            },
            verify=False
        )
        
        if res.status_code == 200:
            res_json = res.json()
            if not len(res_json['answer'].get('bestAnswer', [])):
                logger.error("查询失败: " + res.text)
                return None
            return "\n".join(res_json['answer']['bestAnswer']).strip()
        return None

    def _init_tiku(self):
        """自定义初始化：加载API地址（修复KeyError + 配置校验）"""
        self.api = self._conf.get('url', '')
        if not self.api:
            logger.error(f"{self.name} 未配置url字段，自动禁用该题库")
            self.DISABLE = True
            return


class AI(Tiku):
    """AI大模型答题实现"""
    def __init__(self) -> None:
        super().__init__()
        self.name = 'AI大模型答题'
        self.last_request_time = None

    def _query(self, q_info: dict):
        # 检查核心配置是否有效
        if not self.endpoint or not self.key or not self.model:
            logger.error(f"{self.name} 核心配置缺失（endpoint/key/model），跳过查询")
            return None

        def remove_md_json_wrapper(md_str):
            """移除Markdown JSON包装"""
            pattern = r'^\s*```(?:json)?\s*(.*?)\s*```\s*$'
            match = re.search(pattern, md_str, re.DOTALL)
            return match.group(1).strip() if match else md_str.strip()
        
        # 配置代理
        client_kwargs = {
            "base_url": self.endpoint,
            "api_key": self.key
        }
        if self.http_proxy:
            client_kwargs["http_client"] = httpx.Client(proxy=self.http_proxy)
        client = OpenAI(**client_kwargs)

        # 清理选项（去除字母前缀）
        options_list = q_info['options'].split('\n') if q_info.get('options') else []
        cleaned_options = [re.sub(r"^[A-Z]\s*", "", opt) for opt in options_list]
        options = "\n".join(cleaned_options)

        # 构造系统提示词
        system_prompts = {
            "single": "本题为单选题，仅选一个选项，JSON输出选项内容：{\"Answer\": [\"答案\"]}",
            "multiple": "本题为多选题，选多个选项，JSON输出选项内容：{\"Answer\": [\"答案1\",\"答案2\"]}",
            "completion": "本题为填空题，JSON输出答案：{\"Answer\": [\"答案\"]}",
            "judgement": "本题为判断题，仅答正确/错误，JSON输出：{\"Answer\": [\"正确\"]}",
            "default": "本题为简答题，JSON输出答案：{\"Answer\": [\"答案\"]}"
        }
        system_prompt = system_prompts.get(q_info['type'], system_prompts['default'])

        # 发送请求
        completion = client.chat.completions.create(
            model=self.model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": f"题目：{q_info['title']}\n选项：{options}"}
            ]
        )

        # 处理请求间隔
        if self.last_request_time:
            interval = time.time() - self.last_request_time
            if interval < self.min_interval_seconds:
                time.sleep(self.min_interval_seconds - interval)
        self.last_request_time = time.time()

        # 解析答案
        try:
            content = remove_md_json_wrapper(completion.choices[0].message.content)
            response = json.loads(content)
            return "\n".join(response['Answer']).strip()
        except Exception:
            logger.error("无法解析大模型输出内容")
            return None

    def _init_tiku(self):
        """自定义初始化：加载AI配置 + 配置兜底"""
        # 所有配置用get兜底，缺失时禁用
        self.endpoint = self._conf.get('endpoint', '')
        self.key = self._conf.get('key', '')
        self.model = self._conf.get('model', '')
        self.http_proxy = self._conf.get('http_proxy', '')
        self.min_interval_seconds = int(self._conf.get('min_interval_seconds', 3))

        # 核心配置缺失则禁用
        if not self.endpoint or not self.key or not self.model:
            logger.error(f"{self.name} 缺失核心配置（endpoint/key/model），自动禁用")
            self.DISABLE = True


class SiliconFlow(Tiku):
    """硅基流动大模型答题实现"""
    def __init__(self):
        super().__init__()
        self.name = '硅基流动大模型'
        self.last_request_time = None

    def _query(self, q_info: dict):
        # 检查核心配置是否有效
        if not self.api_key or not self.api_endpoint:
            logger.error(f"{self.name} 核心配置缺失（api_key/endpoint），跳过查询")
            return None

        def remove_md_json_wrapper(md_str):
            """移除Markdown JSON包装"""
            pattern = r'^\s*```(?:json)?\s*(.*?)\s*```\s*$'
            match = re.search(pattern, md_str, re.DOTALL)
            return match.group(1).strip() if match else md_str.strip()

        # 构造系统提示词
        system_prompts = {
            "single": "本题为单选题，输出选项具体内容（非ABCD），JSON格式：{\"Answer\": [\"正确选项\"]}",
            "multiple": "本题为多选题，输出所有正确选项内容，JSON格式：{\"Answer\": [\"选项1\",\"选项2\"]}",
            "completion": "本题为填空题，输出答案内容，JSON格式：{\"Answer\": [\"答案\"]}",
            "judgement": "本题为判断题，仅答正确/错误，JSON格式：{\"Answer\": [\"正确\"]}"
        }
        system_prompt = system_prompts.get(q_info['type'], system_prompts['single'])

        # 构造请求
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json"
        }
        payload = {
            "model": self.model_name,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": f"题目：{q_info['title']}\n选项：{q_info['options']}"}
            ],
            "stream": False,
            "max_tokens": 4096,
            "temperature": 0.7,
            "top_p": 0.7,
            "response_format": {"type": "text"}
        }

        # 处理请求间隔
        if self.last_request_time:
            interval = time.time() - self.last_request_time
            if interval < self.min_interval:
                time.sleep(self.min_interval - interval)

        # 发送请求并解析
        try:
            response = requests.post(
                self.api_endpoint,
                headers=headers,
                json=payload,
                timeout=30,
                verify=False
            )
            self.last_request_time = time.time()
            
            if response.status_code == 200:
                result = response.json()
                content = result['choices'][0]['message']['content']
                parsed = json.loads(remove_md_json_wrapper(content))
                return "\n".join(parsed['Answer']).strip()
            else:
                logger.error(f"API请求失败：{response.status_code} {response.text}")
                return None
        except Exception as e:
            logger.error(f"硅基流动API异常：{e}")
            return None

    def _init_tiku(self):
        """自定义初始化：加载硅基流动配置 + 配置兜底"""
        self.api_endpoint = self._conf.get('siliconflow_endpoint', 'https://api.siliconflow.cn/v1/chat/completions')
        self.api_key = self._conf.get('siliconflow_key', '')
        self.model_name = self._conf.get('siliconflow_model', 'deepseek-ai/DeepSeek-V3')
        self.min_interval = int(self._conf.get('min_interval_seconds', 3))

        # 核心配置缺失则禁用
        if not self.api_key:
            logger.error(f"{self.name} 未配置siliconflow_key，自动禁用该题库")
            self.DISABLE = True


class TikuLocal(Tiku):
    """本地题库实现 - 支持自建题库API"""
    def __init__(self) -> None:
        super().__init__()
        self.name = '本地题库'
        self.api = ''

    def _query(self, q_info: dict):
        """查询本地题库API"""
        if not self.api:
            logger.error(f"{self.name} API地址未配置，跳过查询")
            return None

        # 题目类型映射
        type_map = {"single": 0, "multiple": 1, "completion": 2, "judgement": 3}
        q_type = type_map.get(q_info['type'], 4)

        # 清理选项（去除字母前缀）
        options = q_info['options'].split('\n') if q_info.get('options') else []
        cleaned_options = [sub(r'^[A-Za-z]\.?、?\s?', '', opt) for opt in options]

        try:
            # 发送查询请求
            logger.debug(f"{self.name} 请求API: {self.api}")
            logger.debug(f"{self.name} 查询题目: {q_info['title'][:50]}...")
            
            res = requests.post(
                self.api,
                json={
                    'question': q_info['title'],
                    'options': cleaned_options,
                    'type': q_type
                },
                verify=False,
                timeout=15
            )
            
            logger.debug(f"{self.name} 响应状态码: {res.status_code}")
            
            if res.status_code == 200:
                # 检查响应内容是否为空
                response_text = res.text.strip()
                if not response_text:
                    logger.error(f"{self.name} 响应内容为空，请检查API服务是否正常运行")
                    return None
                
                # 尝试解析JSON
                try:
                    res_json = res.json()
                    logger.debug(f"{self.name} 响应JSON: {str(res_json)[:200]}")
                except ValueError as json_err:
                    logger.error(f"{self.name} JSON解析失败")
                    logger.error(f"{self.name} 响应内容前200字符: {response_text[:200]}")
                    return None
                
                # 兼容多种返回格式
                # 格式1: {"answer": {"bestAnswer": ["答案"]}}
                if 'answer' in res_json:
                    answer_data = res_json['answer']
                    if isinstance(answer_data, dict) and 'bestAnswer' in answer_data:
                        best_answer = answer_data['bestAnswer']
                        if best_answer:
                            return "\n".join(best_answer).strip()
                        else:
                            logger.warning(f"{self.name} bestAnswer为空")
                            return None
                    elif isinstance(answer_data, list):
                        if answer_data:
                            return "\n".join(str(a) for a in answer_data).strip()
                        else:
                            logger.warning(f"{self.name} answer列表为空")
                            return None
                    elif isinstance(answer_data, str):
                        if answer_data.strip():
                            return answer_data.strip()
                        else:
                            logger.warning(f"{self.name} answer字符串为空")
                            return None
                
                # 格式2: {"data": {"answer": "答案"}} 或 {"data": "答案"}
                elif 'data' in res_json:
                    answer_data = res_json['data']
                    if isinstance(answer_data, dict) and 'answer' in answer_data:
                        return answer_data['answer'].strip()
                    elif isinstance(answer_data, str):
                        return answer_data.strip()
                    elif isinstance(answer_data, list):
                        return "\n".join(str(a) for a in answer_data).strip()
                
                # 格式3: 直接返回答案
                elif 'result' in res_json:
                    return str(res_json['result']).strip()
                
                # 格式4: 返回答案字段
                elif 'answers' in res_json:
                    answers = res_json['answers']
                    if isinstance(answers, list):
                        return "\n".join(str(a) for a in answers).strip()
                    return str(answers).strip()
                
                # 无法识别的格式
                logger.error(f"{self.name} 返回数据格式不支持: {str(res_json)[:200]}")
                return None
            else:
                logger.error(f'{self.name} HTTP错误: {res.status_code}')
                logger.error(f'{self.name} 响应内容: {res.text[:200]}')
                return None
                
        except requests.exceptions.Timeout:
            logger.error(f"{self.name} 请求超时，请检查API服务是否响应")
            logger.error(f"{self.name} API地址: {self.api}")
            return None
        except requests.exceptions.ConnectionError as e:
            logger.error(f"{self.name} 连接失败，无法访问API服务")
            logger.error(f"{self.name} 请检查: 1.API服务是否启动 2.网络是否可达 3.地址是否正确")
            logger.error(f"{self.name} API地址: {self.api}")
            return None
        except Exception as e:
            logger.error(f'{self.name} 查询异常: {str(e)}')
            return None

    def _init_tiku(self):
        """自定义初始化：加载API地址"""
        self.api = self._conf.get('local_api', '')
        if not self.api:
            # 兼容旧的url字段
            self.api = self._conf.get('url', '')
        if not self.api:
            logger.error(f"{self.name} 未配置local_api字段，自动禁用该题库")
            logger.info(f"{self.name} 请在配置文件中设置: local_api = http://your-api-server/search")
            self.DISABLE = True
            return
        logger.info(f"{self.name} 已加载API地址: {self.api}")


class TikuZError(Tiku):
    """ZError题库实现 - 支持OCS网课助手的AI题库管理软件"""
    def __init__(self) -> None:
        super().__init__()
        self.name = 'ZError题库'
        self.api = ''

    def _query(self, q_info: dict):
        """查询ZError题库API"""
        if not self.api:
            logger.error(f"{self.name} API地址未配置，跳过查询")
            return None

        try:
            logger.debug(f"{self.name} 请求API: {self.api}")
            logger.debug(f"{self.name} 查询题目: {q_info['title'][:50]}...")
            
            # ZError API格式：POST /query
            # 请求参数: title, options, type
            res = requests.post(
                self.api,
                json={
                    'title': q_info['title'],
                    'options': q_info.get('options', ''),
                    'type': q_info.get('type', '')
                },
                verify=False,
                timeout=15
            )
            
            logger.debug(f"{self.name} 响应状态码: {res.status_code}")
            
            if res.status_code == 200:
                response_text = res.text.strip()
                if not response_text:
                    logger.error(f"{self.name} 响应内容为空")
                    return None
                
                try:
                    res_json = res.json()
                    logger.debug(f"{self.name} 响应JSON: {str(res_json)[:200]}")
                except ValueError:
                    logger.error(f"{self.name} JSON解析失败，响应内容: {response_text[:200]}")
                    return None
                
                # ZError返回格式: {"code": 1, "data": {"question": "...", "answer": "..."}, "message": "..."}
                # code=1表示成功，code=0表示未找到
                if res_json.get('code') == 1 and res_json.get('data'):
                    data = res_json['data']
                    if isinstance(data, dict) and 'answer' in data:
                        answer = data['answer']
                        if answer:
                            logger.info(f"{self.name} 查询成功")
                            return answer.strip()
                    logger.warning(f"{self.name} 答案为空")
                    return None
                elif res_json.get('code') == 0:
                    logger.debug(f"{self.name} 未找到答案: {res_json.get('message', '')}")
                    return None
                else:
                    logger.error(f"{self.name} 返回格式不支持: {str(res_json)[:200]}")
                    return None
            else:
                logger.error(f'{self.name} HTTP错误: {res.status_code}')
                logger.error(f'{self.name} 响应内容: {res.text[:200]}')
                return None
                
        except requests.exceptions.Timeout:
            logger.error(f"{self.name} 请求超时，请检查API服务是否响应")
            logger.error(f"{self.name} API地址: {self.api}")
            return None
        except requests.exceptions.ConnectionError as e:
            logger.error(f"{self.name} 连接失败，无法访问API服务")
            logger.error(f"{self.name} 请检查: 1.API服务是否启动 2.网络是否可达 3.地址是否正确")
            logger.error(f"{self.name} API地址: {self.api}")
            return None
        except Exception as e:
            logger.error(f'{self.name} 查询异常: {str(e)}')
            return None

    def _init_tiku(self):
        """自定义初始化：加载API地址"""
        self.api = self._conf.get('local_api', '')
        if not self.api:
            self.api = self._conf.get('url', '')
        if not self.api:
            logger.error(f"{self.name} 未配置local_api字段，自动禁用该题库")
            logger.info(f"{self.name} 请在配置文件中设置: local_api = http://your-api-server:5555/query")
            self.DISABLE = True
            return
        # 确保API地址以/query结尾
        if not self.api.endswith('/query'):
            self.api = self.api.rstrip('/') + '/query'
        logger.info(f"{self.name} 已加载API地址: {self.api}")


def test_tiku_connection(provider: str, config: dict) -> dict:
    """
    测试题库连接
    :param provider: 题库类型 (TikuLocal, TikuAdapter, TikuYanxi, TikuLike, AI, SiliconFlow)
    :param config: 题库配置字典
    :return: 测试结果字典 {success: bool, message: str, latency: float}
    """
    import time
    
    result = {
        'success': False,
        'message': '',
        'latency': 0
    }
    
    try:
        # 获取题库实例
        tiku_classes = {
            'TikuLocal': TikuLocal,
            'TikuAdapter': TikuAdapter,
            'TikuYanxi': TikuYanxi,
            'TikuLike': TikuLike,
            'AI': AI,
            'SiliconFlow': SiliconFlow,
            'TikuZError': TikuZError
        }
        
        if provider not in tiku_classes:
            result['message'] = f'不支持的题库类型: {provider}'
            return result
        
        tiku = tiku_classes[provider]()
        tiku.config_set(config)
        tiku.init_tiku()
        
        if tiku.DISABLE:
            result['message'] = '题库初始化失败，请检查配置'
            return result
        
        # 根据不同题库类型进行连接测试
        start_time = time.time()
        
        if provider == 'TikuLocal' or provider == 'TikuAdapter':
            # 测试本地题库/TikuAdapter连接
            api_url = config.get('local_api', '') or config.get('url', '')
            if not api_url:
                result['message'] = 'API地址未配置'
                return result
            
            try:
                # 发送测试请求
                test_res = requests.post(
                    api_url,
                    json={
                        'question': '测试题目',
                        'options': ['选项A', '选项B'],
                        'type': 0
                    },
                    verify=False,
                    timeout=10
                )
                result['latency'] = round((time.time() - start_time) * 1000, 2)  # 毫秒
                
                if test_res.status_code == 200:
                    result['success'] = True
                    result['message'] = f'连接成功，响应时间: {result["latency"]}ms'
                else:
                    result['message'] = f'连接失败，HTTP状态码: {test_res.status_code}'
            except requests.exceptions.Timeout:
                result['message'] = '连接超时，请检查API地址是否正确'
            except requests.exceptions.ConnectionError as e:
                result['message'] = f'连接失败: {str(e)[:100]}'
            except Exception as e:
                result['message'] = f'测试异常: {str(e)[:100]}'
                
        elif provider == 'TikuYanxi':
            # 测试言溪题库连接
            token = config.get('tokens', '')
            if not token:
                result['message'] = 'Token未配置'
                return result
            
            try:
                test_res = requests.get(
                    'https://tk.enncy.cn/query',
                    params={
                        'question': '测试',
                        'token': token.split(',')[0]
                    },
                    verify=False,
                    timeout=10
                )
                result['latency'] = round((time.time() - start_time) * 1000, 2)
                
                if test_res.status_code == 200:
                    res_json = test_res.json()
                    if res_json.get('code') or '次数不足' in res_json.get('data', {}).get('answer', ''):
                        result['success'] = True
                        times = res_json.get('data', {}).get('times', '未知')
                        result['message'] = f'连接成功，剩余次数: {times}，响应时间: {result["latency"]}ms'
                    else:
                        result['message'] = f'Token无效或已过期: {res_json.get("message", "未知错误")}'
                else:
                    result['message'] = f'连接失败，HTTP状态码: {test_res.status_code}'
            except Exception as e:
                result['message'] = f'测试异常: {str(e)[:100]}'
                
        elif provider == 'TikuLike':
            # 测试Like知识库连接
            token = config.get('tokens', '')
            if not token:
                result['message'] = 'Token未配置'
                return result
            
            try:
                # 先测试余额接口
                test_res = requests.post(
                    'https://api.datam.site/balance',
                    json={'token': token.split(',')[-1] if ',' in token else token},
                    verify=False,
                    timeout=10
                )
                result['latency'] = round((time.time() - start_time) * 1000, 2)
                
                if test_res.status_code == 200:
                    res_json = test_res.json()
                    balance = res_json.get('data', {}).get('balance', 0)
                    result['success'] = True
                    result['message'] = f'连接成功，剩余次数: {balance}，响应时间: {result["latency"]}ms'
                else:
                    result['message'] = f'Token验证失败，请检查配置'
            except Exception as e:
                result['message'] = f'测试异常: {str(e)[:100]}'
                
        elif provider == 'AI':
            # 测试AI大模型连接
            endpoint = config.get('endpoint', '')
            key = config.get('key', '')
            model = config.get('model', '')
            
            if not endpoint or not key or not model:
                result['message'] = 'AI配置不完整'
                return result
            
            try:
                client_kwargs = {
                    "base_url": endpoint,
                    "api_key": key
                }
                http_proxy = config.get('http_proxy', '')
                if http_proxy:
                    client_kwargs["http_client"] = httpx.Client(proxy=http_proxy)
                
                client = OpenAI(**client_kwargs)
                
                # 发送测试请求
                completion = client.chat.completions.create(
                    model=model,
                    messages=[
                        {"role": "user", "content": "测试"}
                    ],
                    max_tokens=10
                )
                result['latency'] = round((time.time() - start_time) * 1000, 2)
                result['success'] = True
                result['message'] = f'连接成功，模型: {model}，响应时间: {result["latency"]}ms'
            except Exception as e:
                result['message'] = f'AI连接失败: {str(e)[:100]}'
                
        elif provider == 'SiliconFlow':
            # 测试硅基流动连接
            api_key = config.get('siliconflow_key', '')
            api_endpoint = config.get('siliconflow_endpoint', 'https://api.siliconflow.cn/v1/chat/completions')
            model = config.get('siliconflow_model', 'deepseek-ai/DeepSeek-V3')
            
            if not api_key:
                result['message'] = 'API Key未配置'
                return result
            
            try:
                headers = {
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json"
                }
                payload = {
                    "model": model,
                    "messages": [{"role": "user", "content": "测试"}],
                    "max_tokens": 10
                }
                
                test_res = requests.post(
                    api_endpoint,
                    headers=headers,
                    json=payload,
                    timeout=30,
                    verify=False
                )
                result['latency'] = round((time.time() - start_time) * 1000, 2)
                
                if test_res.status_code == 200:
                    result['success'] = True
                    result['message'] = f'连接成功，模型: {model}，响应时间: {result["latency"]}ms'
                else:
                    result['message'] = f'API Key无效或已过期'
            except Exception as e:
                result['message'] = f'测试异常: {str(e)[:100]}'
        
        elif provider == 'TikuZError':
            # 测试ZError题库连接
            api_url = config.get('local_api', '') or config.get('url', '')
            if not api_url:
                result['message'] = 'API地址未配置'
                return result
            
            # 确保URL以/query结尾
            if not api_url.endswith('/query'):
                api_url = api_url.rstrip('/') + '/query'
            
            try:
                test_res = requests.post(
                    api_url,
                    json={
                        'title': '测试题目',
                        'options': '选项A,选项B',
                        'type': 'single'
                    },
                    verify=False,
                    timeout=10
                )
                result['latency'] = round((time.time() - start_time) * 1000, 2)
                
                if test_res.status_code == 200:
                    res_json = test_res.json()
                    if res_json.get('code') == 1:
                        result['success'] = True
                        result['message'] = f'连接成功，题库可用，响应时间: {result["latency"]}ms'
                    elif res_json.get('code') == 0:
                        result['success'] = True  # 连接成功，只是没找到答案
                        result['message'] = f'连接成功，题库可用（测试题目未找到答案），响应时间: {result["latency"]}ms'
                    else:
                        result['message'] = f'题库响应异常: {str(res_json)[:100]}'
                else:
                    result['message'] = f'连接失败，HTTP状态码: {test_res.status_code}'
            except requests.exceptions.Timeout:
                result['message'] = '连接超时，请检查API服务是否正常运行'
            except requests.exceptions.ConnectionError as e:
                result['message'] = f'连接失败: {str(e)[:100]}'
            except Exception as e:
                result['message'] = f'测试异常: {str(e)[:100]}'
        
    except Exception as e:
        result['message'] = f'测试过程异常: {str(e)[:100]}'
    
    return result