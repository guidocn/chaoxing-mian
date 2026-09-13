# -*- coding: utf-8 -*-
import os
import pickle
from api.config import GlobalConst as gc


def get_cookies_path(account_id: str = None) -> str:
    """
    获取cookies文件路径，支持多账号隔离
    
    Args:
        account_id: 账号标识（手机号或账号ID），为None时使用默认路径
        
    Returns:
        cookies文件路径
    """
    if account_id is None:
        return gc.COOKIES_PATH
    
    # 使用账号ID作为文件名后缀，确保文件名安全
    safe_id = "".join(c if c.isalnum() else "_" for c in str(account_id))
    cookies_dir = os.path.dirname(gc.COOKIES_PATH)
    cookies_file = os.path.join(cookies_dir, f"cookies_{safe_id}.txt")
    return cookies_file


def save_cookies(_session, account_id: str = None):
    """
    保存cookies到文件
    
    Args:
        _session: requests session对象
        account_id: 账号标识（可选）
    """
    cookies_path = get_cookies_path(account_id)
    try:
        with open(cookies_path, "wb") as f:
            pickle.dump(_session.cookies, f)
    except Exception as e:
        # 如果保存失败，尝试使用默认路径
        if account_id is not None:
            save_cookies(_session, None)
        else:
            raise e


def use_cookies(account_id: str = None):
    """
    从文件加载cookies
    
    Args:
        account_id: 账号标识（可选）
        
    Returns:
        cookies对象，如果文件不存在返回None
    """
    cookies_path = get_cookies_path(account_id)
    
    if os.path.exists(cookies_path):
        try:
            with open(cookies_path, "rb") as f:
                _cookies = pickle.load(f)
            return _cookies
        except Exception as e:
            # 如果加载失败，尝试删除损坏的文件
            try:
                os.remove(cookies_path)
            except:
                pass
            return None
    return None


def clear_cookies(account_id: str = None):
    """
    清除cookies文件
    
    Args:
        account_id: 账号标识（可选），为None时清除所有cookies
    """
    if account_id is None:
        # 清除所有cookies文件
        cookies_dir = os.path.dirname(gc.COOKIES_PATH)
        for file in os.listdir(cookies_dir):
            if file.startswith("cookies") and file.endswith(".txt"):
                try:
                    os.remove(os.path.join(cookies_dir, file))
                except:
                    pass
    else:
        cookies_path = get_cookies_path(account_id)
        if os.path.exists(cookies_path):
            os.remove(cookies_path)


def list_cookies():
    """
    列出所有保存的cookies账号
    
    Returns:
        账号ID列表
    """
    cookies_dir = os.path.dirname(gc.COOKIES_PATH)
    accounts = []
    
    if os.path.exists(cookies_dir):
        for file in os.listdir(cookies_dir):
            if file.startswith("cookies_") and file.endswith(".txt"):
                # 提取账号ID
                account_id = file[8:-4]  # 去掉 "cookies_" 前缀和 ".txt" 后缀
                accounts.append(account_id)
    
    return accounts
