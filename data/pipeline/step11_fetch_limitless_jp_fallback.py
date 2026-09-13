"""
Step 11：針對 TCGdex 資料庫本身完全沒有圖片網址的日文卡片，嘗試從
LimitlessTCG 的日文卡資料庫（limitlesstcg.com/cards/jp/...）補圖。

這是後來才發現的：LimitlessTCG 除了英文卡資料庫，還有一份完整的日文卡
資料庫，網址規則是 `/cards/jp/{setId}/{卡號}`，而且 setId 直接就是
TCGdex 用的同一套代碼（S8、SV2a、M2a…），不需要像英文卡那樣另外建一份
對照表。抽查 5 張（S8-1、SV2a-171、S8b-200、M2a-1，並回頭核對 TCGdex
原始資料confirm 名稱一致）全部正確對應，才開始動手。

驗證方式與節流策略跟 step9（英文版）完全一樣：
1. 組出候選頁面網址，不是猜圖片檔名。
2. 抓頁面下來，比對頁面標題的寶可夢名稱與資料庫記錄一致才繼續。
3. 名稱核對通過才抓頁面裡實際出現的卡圖網址下載，一樣要通過 Pillow 解碼
   驗證才存檔。
4. 逾時 15 秒、失敗重試 3 次、429 讀 Retry-After 等待。

跟英文版的差異：資料量大很多（3,515 張待處理 vs. 549 張），為了在合理時間
內跑完，這裡用 3 個並行 worker（各自維持每個請求間至少間隔 0.6 秒），
而不是英文版的單執行緒；仍然保守，且每個 worker 各自遇到 429 都會照樣
乖乖等待，不會忽略。
"""
import html as html_module
import io
import json
import os
import re
import time
import unicodedata
from concurrent.futures import ThreadPoolExecutor, as_completed

import requests
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.dirname(HERE)
PROJECT_DIR = os.path.dirname(DATA_DIR)

MANIFEST_PATH = os.path.join(HERE, "logs", "image_manifest.json")
JP_FALLBACK_LOG_PATH = os.path.join(HERE, "logs", "limitless_jp_fallback_log.json")

REQUEST_INTERVAL = 0.6
TIMEOUT = 15
MAX_RETRIES = 3
MAX_WORKERS = 3

# TCGdex 的日文卡包代碼大多跟 LimitlessTCG 一模一樣，直接沿用即可；
# 少數促銷卡包的寫法不同（TCGdex 用 `SV-P`／`M-P`，Limitless 用 `SVP`／`MP`），
# 這裡逐一實測核對過才列進來（例如 SVP/1=ピカチュウ、MP/1=チコリータ、
# SVP/100=基本草エネルギー、MP/50=ふうせん 都與資料庫記錄一致）。
JP_SET_OVERRIDES = {
    "SV-P": "SVP",
    "M-P": "MP",
    "S-P": "SP",
}

# 同一張卡、兩邊卡號寫法不同時的逐張對照（key 是 TCGdex 的 `setId-cardNumber`）。
#
# スタートデッキ100 バトルコレクション（MC）的 8 張基本能量：TCGdex 用三字母
# 屬性代碼（DAR／FIG…），LimitlessTCG 用單字母（D／F…）。對照表不是猜的，
# 是先抓 https://limitlesstcg.com/cards/jp/MC 把該卡包的實際編號列出來，
# 發現結尾正好是 G/R/W/L/P/F/D/M 八個字母碼，再逐一開頁面核對卡名：
#   MC/D = 基本悪エネルギー、MC/G = 基本草エネルギー、MC/R = 基本炎エネルギー…
# 下載時 process_card() 還是會再比對一次卡名，對不上就不會採用。
JP_NUMBER_OVERRIDES = {
    "MC-GRA": "G",  # 基本草エネルギー
    "MC-FIR": "R",  # 基本炎エネルギー
    "MC-WAT": "W",  # 基本水エネルギー
    "MC-LIG": "L",  # 基本雷エネルギー
    "MC-PSY": "P",  # 基本超エネルギー
    "MC-FIG": "F",  # 基本闘エネルギー
    "MC-DAR": "D",  # 基本悪エネルギー
    "MC-MET": "M",  # 基本鋼エネルギー
}

_thread_local_sessions = {}


def get_session():
    import threading
    tid = threading.get_ident()
    if tid not in _thread_local_sessions:
        s = requests.Session()
        s.headers.update({"User-Agent": "pokemon-ptcg-dex-personal-project/1.0 (verifying missing jp card images, low volume)"})
        _thread_local_sessions[tid] = s
    return _thread_local_sessions[tid]


def norm_number(card_number):
    m = re.match(r"^([A-Za-z]*)(\d+)$", card_number)
    if not m:
        return card_number
    prefix, digits = m.groups()
    return f"{prefix}{int(digits)}"


def norm_name_for_compare(name):
    name = unicodedata.normalize("NFKD", name)
    name = re.sub(r"[^a-zA-Z0-9぀-ヿ一-鿿]", "", name).lower()
    return name


def extract_card_name_and_image(html_text):
    m = re.search(r"<title>(.+) - ([^<]+?)\(([A-Za-z0-9.]+)\)\s*#([A-Za-z0-9]+)", html_text)
    title_name = html_module.unescape(m.group(1).strip()) if m else None
    img_matches = re.findall(r'https://limitlesstcg\.nyc3\.cdn\.digitaloceanspaces\.com/tpc/[^"\'\s]+?_LG\.(?:png|jpg|webp)', html_text)
    image_url = img_matches[0] if img_matches else None
    return title_name, image_url


def is_valid_image(raw_bytes):
    if not raw_bytes or len(raw_bytes) < 200:
        return False
    try:
        Image.open(io.BytesIO(raw_bytes)).verify()
        return True
    except Exception:
        return False


def polite_get(url):
    session = get_session()
    last_err = None
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            time.sleep(REQUEST_INTERVAL)
            resp = session.get(url, timeout=TIMEOUT)
        except requests.RequestException as e:
            last_err = f"request_exception:{e}"
            time.sleep(1.5 * attempt)
            continue
        if resp.status_code == 404:
            return None, 404, "http_404"
        if resp.status_code == 429:
            retry_after = resp.headers.get("Retry-After")
            wait = float(retry_after) if retry_after and retry_after.isdigit() else 5 * attempt
            time.sleep(min(wait, 30))
            continue
        if resp.status_code != 200:
            last_err = f"http_{resp.status_code}"
            time.sleep(1.5 * attempt)
            continue
        return resp.text, 200, None
    return None, None, last_err or "unknown"


def process_card(c):
    set_id = JP_SET_OVERRIDES.get(c["setId"], c["setId"])
    override_key = f"{c['setId']}-{c['cardNumber']}"
    num = JP_NUMBER_OVERRIDES.get(override_key) or norm_number(c["cardNumber"])
    page_url = f"https://limitlesstcg.com/cards/jp/{set_id}/{num}"

    html_text, status, err = polite_get(page_url)
    if html_text is None:
        return {"cardId": c["id"], "name": c["name"], "setId": c["setId"], "cardNumber": c["cardNumber"],
                "status": "not_found", "pageUrl": page_url, "httpStatus": status, "error": err}

    title_name, image_url = extract_card_name_and_image(html_text)
    if not title_name or norm_name_for_compare(title_name) != norm_name_for_compare(c["name"]):
        return {"cardId": c["id"], "name": c["name"], "setId": c["setId"], "cardNumber": c["cardNumber"],
                "status": "name_mismatch", "pageUrl": page_url, "pageTitleName": title_name}

    if not image_url:
        return {"cardId": c["id"], "name": c["name"], "setId": c["setId"], "cardNumber": c["cardNumber"],
                "status": "no_image_on_page", "pageUrl": page_url}

    session = get_session()
    try:
        time.sleep(REQUEST_INTERVAL)
        img_resp = session.get(image_url, timeout=TIMEOUT)
        raw = img_resp.content if img_resp.status_code == 200 else None
    except requests.RequestException:
        raw = None

    if not raw or not is_valid_image(raw):
        return {"cardId": c["id"], "name": c["name"], "setId": c["setId"], "cardNumber": c["cardNumber"],
                "status": "image_download_failed", "pageUrl": page_url, "imageUrl": image_url}

    safe_name = c["id"].replace("tcgdex:", "").replace(":", "_").replace("/", "_")
    ext = image_url.rsplit(".", 1)[-1]
    local_rel = f"images/cards/{safe_name}.{ext}"
    local_abs = os.path.join(PROJECT_DIR, local_rel)
    os.makedirs(os.path.dirname(local_abs), exist_ok=True)
    with open(local_abs, "wb") as f:
        f.write(raw)

    return {"cardId": c["id"], "name": c["name"], "setId": c["setId"], "cardNumber": c["cardNumber"],
            "status": "success", "pageUrl": page_url, "imageUrl": image_url, "localPath": local_rel,
            "byteSize": len(raw)}


def load_json(path, default):
    if os.path.exists(path):
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    return default


def save_json_atomic(path, data):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)
    os.replace(tmp, path)


def main():
    with open(os.path.join(DATA_DIR, "cards.json"), "r", encoding="utf-8") as f:
        cards = json.load(f)
    manifest = load_json(MANIFEST_PATH, {})

    all_targets = [c for c in cards if c["language"] == "ja" and not c.get("image")]

    def already_done(c):
        rec = manifest.get(f"cards:{c['id']}")
        if not rec or rec.get("status") != "success" or not rec.get("source", "").startswith("limitlesstcg"):
            return False
        return os.path.exists(os.path.join(PROJECT_DIR, rec.get("localPath", "")))

    targets = [c for c in all_targets if not already_done(c)]
    print(f"total JA no-source cards: {len(all_targets)}  already_done(skip): {len(all_targets) - len(targets)}  to_process: {len(targets)}", flush=True)

    results = []
    done = 0
    success = 0
    not_found = 0
    other_fail = 0

    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as ex:
        futures = {ex.submit(process_card, c): c for c in targets}
        for fut in as_completed(futures):
            r = fut.result()
            results.append(r)
            done += 1
            if r["status"] == "success":
                success += 1
                manifest[f"cards:{r['cardId']}"] = {
                    "url": r["imageUrl"], "localPath": r["localPath"], "status": "success",
                    "httpStatus": 200, "byteSize": r["byteSize"], "error": None,
                    "source": "limitlesstcg_jp", "sourcePage": r["pageUrl"],
                    "lastAttempt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
                }
            elif r["status"] == "not_found":
                not_found += 1
            else:
                other_fail += 1

            if done % 100 == 0:
                save_json_atomic(MANIFEST_PATH, manifest)
                save_json_atomic(JP_FALLBACK_LOG_PATH, results)
                print(f"progress {done}/{len(targets)} success={success} not_found={not_found} other_fail={other_fail}", flush=True)

    save_json_atomic(MANIFEST_PATH, manifest)
    save_json_atomic(JP_FALLBACK_LOG_PATH, results)
    print(json.dumps({"totalTargets": len(targets), "success": success, "notFound": not_found, "otherFail": other_fail}))


if __name__ == "__main__":
    main()
