"""
Step 5：下載寶可夢圖鑑圖片與卡片圖片到本機，取代直接 hotlink 遠端網址。

- 已存在且驗證通過的圖片不會重下（用 manifest 紀錄狀態，重跑此腳本可續傳）。
- 每個下載：逾時 20 秒、失敗重試最多 4 次、每次重試間隔遞增（0.5s -> 1s -> 2s -> 4s，
  加隨機抖動避免同時重試），遇到 429 時讀取 Retry-After 標頭乖乖等待。
- 卡片圖片實測發現 TCGdex 常見「low.webp 回 404，但 low.png／high.webp／
  high.png 其實有圖」的情況（同一個來源、只是特定畫質＋格式組合沒產生），
  所以每張卡片會依序嘗試 low.webp -> low.png -> high.webp -> high.png，
  只要其中一種成功驗證就採用，存檔副檔名會對應到實際拿到的格式。
  這仍然是「重新嘗試原始來源」，不是換成別的資料庫。
- 下載完一定用 Pillow 真的把檔案打開＋verify()，確認是「可解碼的圖片」，不是把
  404 錯誤頁或空內容存成圖檔；HTTP 200 不代表成功，只是進入驗證的前提。
- 完成後把「本機路徑」寫進 data/image_local_map.json（不動 species.json /
  cards.json 本身），data.js 載入時會優先用本機路徑，本機沒有才退回原始遠端網址
  （原始網址本身失效的話，前端原本就有載入失敗的替代畫面機制）。
- 檔名用穩定 id 組出來（物種用全國圖鑑編號、卡片用完整 card id 含語言），
  不同語言／版本的卡片不會互相覆蓋。

manifest 結構（data/pipeline/logs/image_manifest.json）：
{
  "species:25": {"url": "...", "localPath": "images/species/25.png",
                  "status": "success"|"failed", "httpStatus": 200,
                  "byteSize": 12345, "error": null, "attempts": 1,
                  "lastAttempt": "2026-09-12T...", "variantUsed": null},
  "cards:tcgdex:ja:SV2a-003": {..., "variantUsed": "low.png", "urlTried": [...]}
}
"""
import io
import json
import os
import random
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

import requests
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.dirname(HERE)
PROJECT_DIR = os.path.dirname(DATA_DIR)
MANIFEST_PATH = os.path.join(HERE, "logs", "image_manifest.json")

MAX_WORKERS = 8
MAX_RETRIES = 4
BASE_BACKOFF = 0.5
TIMEOUT = 20

EXT_BY_VARIANT = {
    "low.webp": "webp", "low.png": "png", "low.jpg": "jpg",
    "high.webp": "webp", "high.png": "png", "high.jpg": "jpg",
}

session = requests.Session()
session.headers.update({"User-Agent": "pokemon-ptcg-dex-image-fetch/1.0 (+local personal project)"})


def load_json(path, default):
    if os.path.exists(path):
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    return default


def save_json(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)
    os.replace(tmp, path)


def is_valid_image(raw_bytes, expect_min_bytes=200):
    if not raw_bytes or len(raw_bytes) < expect_min_bytes:
        return False, "too_small_or_empty"
    try:
        img = Image.open(io.BytesIO(raw_bytes))
        img.verify()
        return True, None
    except Exception as e:
        return False, f"not_decodable:{e}"


def fetch_with_retry(url):
    """對單一網址做逾時＋重試＋429 等待。回傳 (content_bytes_or_None, status, error)。
    404 視為「這個網址確定沒有」，不重試，直接回傳讓呼叫端換下一個候選網址。"""
    last_error = None
    last_status = None
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            resp = session.get(url, timeout=TIMEOUT)
        except requests.RequestException as e:
            last_error = f"request_exception:{e}"
            time.sleep(BASE_BACKOFF * (2 ** (attempt - 1)) + random.uniform(0, 0.3))
            continue

        last_status = resp.status_code

        if resp.status_code == 429:
            retry_after = resp.headers.get("Retry-After")
            wait = float(retry_after) if retry_after and retry_after.isdigit() else BASE_BACKOFF * (2 ** attempt)
            time.sleep(min(wait, 30))
            continue

        if resp.status_code == 404:
            return None, 404, "http_404"

        if resp.status_code != 200:
            last_error = f"http_{resp.status_code}"
            time.sleep(BASE_BACKOFF * (2 ** (attempt - 1)) + random.uniform(0, 0.3))
            continue

        ok, verr = is_valid_image(resp.content)
        if not ok:
            last_error = verr
            time.sleep(BASE_BACKOFF * (2 ** (attempt - 1)) + random.uniform(0, 0.3))
            continue

        return resp.content, 200, None

    return None, last_status, last_error or "unknown"


def download_one(key, urls, local_rel_no_ext):
    """依序嘗試 urls 清單裡的每個候選網址，第一個成功驗證的就採用。"""
    tried = []
    last_status = None
    last_error = None
    for url in urls:
        content, status, err = fetch_with_retry(url)
        tried.append({"url": url, "status": status, "error": err})
        if content is not None:
            variant = None
            for suffix, _ in EXT_BY_VARIANT.items():
                if url.endswith(suffix):
                    variant = suffix
                    break
            ext = EXT_BY_VARIANT.get(variant, "img")
            local_rel = f"{local_rel_no_ext}.{ext}"
            local_abs = os.path.join(PROJECT_DIR, local_rel)
            os.makedirs(os.path.dirname(local_abs), exist_ok=True)
            with open(local_abs, "wb") as f:
                f.write(content)
            return key, {
                "url": url, "localPath": local_rel, "status": "success",
                "httpStatus": 200, "byteSize": len(content), "error": None,
                "variantUsed": variant, "urlsTried": tried,
                "lastAttempt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
            }
        last_status, last_error = status, err

    return key, {
        "url": urls[0] if urls else None, "localPath": None, "status": "failed",
        "httpStatus": last_status, "byteSize": 0, "error": last_error or "unknown",
        "variantUsed": None, "urlsTried": tried,
        "lastAttempt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    }


def already_succeeded(key, manifest):
    rec = manifest.get(key)
    if not rec or rec.get("status") != "success":
        return False
    local_path = rec.get("localPath")
    if not local_path:
        return False
    abs_path = os.path.join(PROJECT_DIR, local_path)
    if not os.path.exists(abs_path) or os.path.getsize(abs_path) < 200:
        return False
    return True


def build_jobs():
    with open(os.path.join(DATA_DIR, "species.json"), "r", encoding="utf-8") as f:
        species = json.load(f)
    with open(os.path.join(DATA_DIR, "cards.json"), "r", encoding="utf-8") as f:
        cards = json.load(f)

    jobs = []
    for s in species:
        key = f"species:{s['id']}"
        local_rel_no_ext = f"images/species/{s['id']}"
        jobs.append((key, [s["imageUrl"]], local_rel_no_ext))

    for c in cards:
        if not c.get("image"):
            continue
        key = f"cards:{c['id']}"
        safe_name = c["id"].replace("tcgdex:", "").replace(":", "_").replace("/", "_")
        local_rel_no_ext = f"images/cards/{safe_name}"
        base = c["image"]
        urls = [f"{base}/low.webp", f"{base}/low.png", f"{base}/high.webp", f"{base}/high.png"]
        jobs.append((key, urls, local_rel_no_ext))

    return jobs


def main():
    only_failed = "--retry-failed-only" in sys.argv
    limit = None
    for arg in sys.argv:
        if arg.startswith("--limit="):
            limit = int(arg.split("=")[1])

    manifest = load_json(MANIFEST_PATH, {})
    jobs = build_jobs()
    if limit:
        jobs = jobs[:limit]

    todo = []
    skipped = 0
    for key, urls, local_rel in jobs:
        if already_succeeded(key, manifest):
            skipped += 1
            continue
        if only_failed and manifest.get(key, {}).get("status") == "success":
            continue
        todo.append((key, urls, local_rel))

    print(f"total jobs: {len(jobs)}  already_ok(skip): {skipped}  to_download: {len(todo)}", flush=True)

    done = 0
    success = 0
    failed = 0
    save_every = 100

    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as ex:
        futures = {ex.submit(download_one, k, u, p): k for k, u, p in todo}
        for fut in as_completed(futures):
            key, record = fut.result()
            manifest[key] = record
            done += 1
            if record["status"] == "success":
                success += 1
            else:
                failed += 1
            if done % save_every == 0:
                save_json(MANIFEST_PATH, manifest)
                print(f"progress {done}/{len(todo)} success={success} failed={failed}", flush=True)

    save_json(MANIFEST_PATH, manifest)
    print(f"DONE total_done={done} success={success} failed={failed} skipped_already_ok={skipped}", flush=True)


if __name__ == "__main__":
    main()
