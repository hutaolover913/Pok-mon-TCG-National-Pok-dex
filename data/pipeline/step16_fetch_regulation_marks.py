"""
Step 16：從 TCGdex 抓每張卡的「規則標記」(regulationMark)。

為什麼要另外抓：cards.json 當初沒有保留這個欄位，而 step2 的原始 JSON 快取
（data/pipeline/cache/）在專案搬家時已經不在了，所以只能重新向來源要一次。
這一步只抓卡片的 metadata，不會重新下載任何卡圖。

刻意區分三種狀態，不混為一談：
  "G" 之類的字母 -> 來源明確給了標記
  null           -> 來源有這張卡的資料，而且明確沒有 regulationMark 欄位（無標記）
  沒有出現在檔案裡 -> 這張卡沒抓成功，狀態不明（前端顯示「待確認」）

規則標記不是用發售年份、卡包名稱、稀有度或卡名推算出來的，一律以來源欄位為準。

輸出：data/regulation_marks.json
  { "version": 1, "fetchedAt": "...", "marks": { "<cardId>": "G" | null } }

可續傳：已經在輸出檔裡、且不是失敗狀態的卡片會直接跳過，重跑不會重抓。
"""
import json
import os
import sys
import time
import random
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone

import requests

HERE = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.dirname(HERE)
CARDS_PATH = os.path.join(DATA_DIR, "cards.json")
OUT_PATH = os.path.join(DATA_DIR, "regulation_marks.json")
LOG_DIR = os.path.join(HERE, "logs")
FAIL_PATH = os.path.join(LOG_DIR, "regulation_marks_failures.json")

API_BASE = "https://api.tcgdex.net/v2"
MAX_WORKERS = 8
TIMEOUT = 20
MAX_RETRIES = 3
SAVE_EVERY = 400

session_pool = {}


def get_session():
    import threading
    tid = threading.get_ident()
    if tid not in session_pool:
        s = requests.Session()
        s.headers.update({"User-Agent": "pokemon-ptcg-dex/1.0 (regulation mark metadata, low volume)"})
        session_pool[tid] = s
    return session_pool[tid]


def fetch_mark(card):
    """回傳 (cardId, status, mark)。status: ok | missing | failed"""
    lang = card["language"]
    source_id = card.get("sourceId")
    if not source_id:
        return (card["id"], "failed", None, "沒有 sourceId")
    url = f"{API_BASE}/{lang}/cards/{source_id}"
    last_err = None
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            resp = get_session().get(url, timeout=TIMEOUT)
            if resp.status_code == 429:
                wait = float(resp.headers.get("Retry-After", 2 * attempt))
                time.sleep(min(wait, 30))
                continue
            if resp.status_code == 404:
                # 來源沒有這張卡，狀態不明，不能當成「無標記」
                return (card["id"], "failed", None, "http_404")
            if resp.status_code != 200:
                last_err = f"http_{resp.status_code}"
                time.sleep(0.5 * attempt + random.random() * 0.3)
                continue
            data = resp.json()
            # 欄位不存在或為空 -> 來源明確沒有標記
            mark = data.get("regulationMark")
            return (card["id"], "ok", mark if mark else None, None)
        except Exception as exc:
            last_err = str(exc)[:120]
            time.sleep(0.5 * attempt + random.random() * 0.3)
    return (card["id"], "failed", None, last_err or "unknown")


def load_out():
    if os.path.exists(OUT_PATH):
        with open(OUT_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    return {"version": 1, "fetchedAt": None, "marks": {}}


def save_out(out):
    out["fetchedAt"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    tmp = OUT_PATH + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    os.replace(tmp, OUT_PATH)


def main():
    os.makedirs(LOG_DIR, exist_ok=True)
    with open(CARDS_PATH, "r", encoding="utf-8") as f:
        cards = json.load(f)
    out = load_out()
    done = set(out["marks"].keys())
    todo = [c for c in cards if c["id"] not in done]

    print(f"total {len(cards)}  already {len(done)}  to_fetch {len(todo)}", flush=True)
    if not todo:
        print(json.dumps({"fetched": 0, "total": len(cards), "withMark": sum(1 for v in out['marks'].values() if v)}, ensure_ascii=False))
        return

    failures = []
    processed = 0
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as ex:
        futures = {ex.submit(fetch_mark, c): c for c in todo}
        for fut in as_completed(futures):
            card_id, status, mark, err = fut.result()
            if status == "ok":
                out["marks"][card_id] = mark
            else:
                failures.append({"cardId": card_id, "error": err})
            processed += 1
            if processed % SAVE_EVERY == 0:
                save_out(out)
                print(f"progress {processed}/{len(todo)}  ok={len(out['marks'])}  failed={len(failures)}", flush=True)

    save_out(out)
    with open(FAIL_PATH, "w", encoding="utf-8") as f:
        json.dump(failures, f, ensure_ascii=False, indent=1)

    marks = out["marks"]
    by_mark = {}
    for v in marks.values():
        k = v if v else "（無標記）"
        by_mark[k] = by_mark.get(k, 0) + 1
    print(json.dumps({
        "totalCards": len(cards),
        "resolved": len(marks),
        "failed": len(failures),
        "byMark": dict(sorted(by_mark.items())),
    }, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
