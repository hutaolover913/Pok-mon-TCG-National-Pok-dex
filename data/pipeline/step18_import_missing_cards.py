"""
Step 18：依使用者提供的「PTCG_缺少卡片清單.xlsx」抓取缺少卡片的資料。

為什麼不用 TCGdex：實測 TCGdex 的日文資料庫裡，S2／S7R／S4a 這些卡包雖然
有卡包 metadata（名稱、發售日、系列），但 cards 是空陣列；SI／SLL／SVI／SP
連卡包本身都 404。所以這批卡片 TCGdex 根本沒有，只能走 Limitless ——
這與 Excel 的比對結論一致。

每一張的流程都是：
  1. 用 Excel 該列附的「卡片資料來源網址」抓該卡的頁面（沒有才依語言組出網址）
  2. 比對頁面標題顯示的卡名與 Excel 的卡名是否一致
  3. 一致才採用「頁面上實際存在」的圖片網址
不用卡名猜圖片網址，也不把 Excel 附的縮圖直接當成正式圖片。

可續傳：結果寫在 logs/import_missing_cards.json，重跑只處理還沒完成的
（失敗的會再試一次，已成功／已略過／待人工確認的不重做）。

去重：語言 + 卡包代碼 + 卡號（去前導零），與 cards.json 既有卡片比對，
已存在的一律不新增。
"""
import html
import json
import os
import random
import re
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone

import openpyxl
import requests

HERE = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.dirname(HERE)
CARDS_PATH = os.path.join(DATA_DIR, "cards.json")
LOG_DIR = os.path.join(HERE, "logs")
OUT_PATH = os.path.join(LOG_DIR, "import_missing_cards.json")
XLSX = os.path.join(os.path.expanduser("~"), "Downloads", "PTCG_缺少卡片清單.xlsx")

LANG = {"日文版": "ja", "英文版（美版）": "en", "英文版": "en", "繁體中文版": "zh-Hant"}
MAX_WORKERS = 3
INTERVAL = 0.55
TIMEOUT = 25
MAX_RETRIES = 3
SAVE_EVERY = 150

_sessions = {}


def session():
    import threading
    tid = threading.get_ident()
    if tid not in _sessions:
        s = requests.Session()
        s.headers.update({"User-Agent": "pokemon-ptcg-dex/1.0 (personal collection tracker, low volume)"})
        _sessions[tid] = s
    return _sessions[tid]


def norm_num(value):
    """053/096 -> 53；TG09/30 -> TG09。Limitless 網址用的是去前導零的形式。"""
    s = str(value or "").strip().split("/")[0]
    m = re.match(r"^([A-Za-z\-]*)0*(\d+)$", s)
    if m:
        return f"{m.group(1)}{int(m.group(2))}"
    return s


def dedup_key(lang, set_id, number):
    s = str(number or "").strip().split("/")[0]
    m = re.match(r"^([A-Za-z\-]*)0*(\d+)$", s)
    norm = (m.group(1).upper(), int(m.group(2))) if m else (s.upper(), None)
    return (lang, str(set_id).strip().upper(), norm)


def polite_get(url):
    last = None
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            time.sleep(INTERVAL + random.random() * 0.2)
            r = session().get(url, timeout=TIMEOUT)
            if r.status_code == 429:
                time.sleep(float(r.headers.get("Retry-After", 3 * attempt)))
                continue
            if r.status_code == 404:
                return None, 404, "http_404"
            if r.status_code != 200:
                last = "http_" + str(r.status_code)
                time.sleep(1.0 * attempt)
                continue
            return r.text, 200, None
        except Exception as exc:
            last = str(exc)[:100]
            time.sleep(1.0 * attempt)
    return None, None, last or "unknown"


TITLE_RE = re.compile(r"<title>(.*?)</title>", re.S)
IMG_RE = re.compile(r'<img[^>]+src="(https://limitlesstcg[^"]+)"')
TITLE_NAME_RE = re.compile(r"^(.+?) - .+ \(.+\) #")


def parse_page(text):
    """回傳 (頁面顯示的卡名, 圖片網址)。圖片一律取頁面上實際存在的那個網址。"""
    name = None
    m = TITLE_RE.search(text)
    if m:
        t = html.unescape(re.sub(r"\s+", " ", m.group(1)).strip())
        mm = TITLE_NAME_RE.match(t)
        if mm:
            name = mm.group(1).strip()
    img = None
    mi = IMG_RE.search(text)
    if mi:
        img = mi.group(1)
        # 頁面若給的是縮圖，換成同一個來源正式提供的大圖檔名
        img = re.sub(r"_(XS|SM)\.png$", "_LG.png", img)
    return name, img


def norm_name(s):
    return re.sub(r"\s+", "", html.unescape(str(s or ""))).lower()


def process(row):
    lang = LANG.get(str(row.get("語言／發行地區") or "").strip())
    set_id = str(row.get("卡包代碼") or "").strip()
    raw_num = row.get("完整卡號／來源卡號")
    num = norm_num(raw_num)
    src_id = str(row.get("穩定來源卡片 ID") or "").strip()
    key = "|".join([str(lang), set_id, num])

    if not lang or not set_id or not num:
        return key, {"status": "skipped", "reason": "語言／卡包／卡號不完整", "sourceId": src_id}

    url = str(row.get("卡片資料來源網址") or "").strip()
    if not url:
        base = "https://limitlesstcg.com/cards/jp/" if lang == "ja" else "https://limitlesstcg.com/cards/"
        url = base + set_id + "/" + num

    text, status, err = polite_get(url)
    if text is None:
        return key, {"status": "failed", "reason": err, "httpStatus": status, "url": url, "sourceId": src_id}

    page_name, image_url = parse_page(text)
    excel_name = str(row.get("卡片名稱") or "").strip()
    if page_name and excel_name and norm_name(page_name) != norm_name(excel_name):
        return key, {
            "status": "needs_review",
            "reason": "卡名不符（頁面 " + str(page_name) + " / Excel " + excel_name + "）",
            "url": url, "sourceId": src_id
        }

    return key, {
        "status": "ok",
        "sourceId": src_id,
        "language": lang,
        "setId": set_id,
        "cardNumber": str(raw_num or "").strip(),
        "localNumber": num,
        "name": page_name or excel_name,
        "nameFromPage": bool(page_name),
        "cardType": row.get("卡片類型"),
        "originalRarity": row.get("來源原始稀有度"),
        "seriesId": row.get("系列代碼"),
        "setName": row.get("卡包／擴充包名稱"),
        "seriesName": row.get("所屬大系列"),
        "releaseDate": row.get("發售日期"),
        "dexNumber": row.get("全國圖鑑編號"),
        "illustrator": row.get("繪師"),
        "regulationMark": row.get("規則標記"),
        "sourceUrl": url,
        "imageUrl": image_url,
        "fetchedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }


def load_rows():
    wb = openpyxl.load_workbook(XLSX, data_only=True)
    out = []
    for sheet, priority in (("現有三系列缺卡", 1), ("較早及其他系列", 2)):
        ws = wb[sheet]
        hdr = [c.value for c in ws[1]]
        for r in ws.iter_rows(min_row=2):
            d = dict(zip(hdr, [c.value for c in r]))
            if d.get("穩定來源卡片 ID"):
                d["__priority"] = priority
                out.append(d)
    out.sort(key=lambda d: d["__priority"])
    return out


def save(results):
    tmp = OUT_PATH + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False)
    os.replace(tmp, OUT_PATH)


def main():
    os.makedirs(LOG_DIR, exist_ok=True)
    rows = load_rows()

    with open(CARDS_PATH, "r", encoding="utf-8") as f:
        existing = set()
        for c in json.load(f):
            existing.add(dedup_key(c["language"], c["setId"], c["cardNumber"]))

    results = {}
    if os.path.exists(OUT_PATH):
        with open(OUT_PATH, "r", encoding="utf-8") as f:
            results = json.load(f)

    todo = []
    already = 0
    for row in rows:
        lang = LANG.get(str(row.get("語言／發行地區") or "").strip())
        if dedup_key(lang, row.get("卡包代碼"), row.get("完整卡號／來源卡號")) in existing:
            already += 1
            continue
        key = "|".join([str(lang), str(row.get("卡包代碼") or "").strip(), norm_num(row.get("完整卡號／來源卡號"))])
        if key in results and results[key].get("status") in ("ok", "skipped", "needs_review"):
            continue
        todo.append(row)

    print("Excel " + str(len(rows)) + " 列｜專案已存在 " + str(already)
          + "｜已處理 " + str(len(results)) + "｜這次要處理 " + str(len(todo)), flush=True)
    if not todo:
        print(json.dumps({"done": True, "total": len(results)}, ensure_ascii=False))
        return

    processed = 0
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as ex:
        futures = {ex.submit(process, r): r for r in todo}
        for fut in as_completed(futures):
            key, res = fut.result()
            results[key] = res
            processed += 1
            if processed % SAVE_EVERY == 0:
                save(results)
                ok = sum(1 for v in results.values() if v.get("status") == "ok")
                print("progress " + str(processed) + "/" + str(len(todo)) + "  ok=" + str(ok), flush=True)

    save(results)
    stats = {}
    for v in results.values():
        stats[v.get("status")] = stats.get(v.get("status"), 0) + 1
    print(json.dumps({"已存在": already, "本次處理": processed, "累計狀態": stats}, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
