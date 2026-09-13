"""
共用工具：TCGdex API 存取（重試、快取、節流）。
所有從 TCGdex 抓下來的原始 JSON 都會寫進 cache/ 目錄，之後重跑腳本
只會抓「還沒抓過」或「明確要求刷新」的資料，不會整庫重抓。
"""
import json
import os
import time
import requests

API_BASE = "https://api.tcgdex.net/v2"
HEADERS = {"User-Agent": "pokemon-ptcg-dex-import/1.0 (+local personal project)"}

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE_DIR = os.path.join(HERE, "cache")
INDEX_DIR = os.path.join(HERE, "index")
LOG_DIR = os.path.join(HERE, "logs")

_session = requests.Session()
_session.headers.update(HEADERS)


def cache_path(lang, key):
    safe_key = key.replace("/", "__")
    return os.path.join(CACHE_DIR, lang, f"{safe_key}.json")


def load_cache(lang, key):
    p = cache_path(lang, key)
    if os.path.exists(p):
        with open(p, "r", encoding="utf-8") as f:
            return json.load(f)
    return None


def save_cache(lang, key, data):
    p = cache_path(lang, key)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)


def fetch_json(url, retries=4, backoff=0.6, timeout=20):
    last_err = None
    for attempt in range(retries):
        try:
            r = _session.get(url, timeout=timeout)
            if r.status_code == 200:
                return r.json(), None
            if r.status_code == 404:
                return None, "404"
            if r.status_code == 429:
                time.sleep(backoff * (attempt + 2))
                continue
            last_err = f"HTTP{r.status_code}"
        except requests.RequestException as e:
            last_err = f"EXC:{e}"
        time.sleep(backoff * (attempt + 1))
    return None, last_err or "unknown_error"


def get_card_cached(lang, card_id, refresh=False):
    """card_id is e.g. 'SV2a-003' (already the full TCGdex id)."""
    if not refresh:
        cached = load_cache(lang, card_id)
        if cached is not None:
            return cached, None
    url = f"{API_BASE}/{lang}/cards/{card_id}"
    data, err = fetch_json(url)
    if data is not None:
        save_cache(lang, card_id, data)
    return data, err


def log_line(name, text):
    os.makedirs(LOG_DIR, exist_ok=True)
    with open(os.path.join(LOG_DIR, name), "a", encoding="utf-8") as f:
        f.write(text + "\n")
