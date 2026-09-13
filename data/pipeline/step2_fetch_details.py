"""
Step 2：依 Step 1 的索引，抓每張卡片的完整資料（稀有度、圖鑑編號、圖片…）。

- 有本機快取的卡片一律跳過，不重新下載（cache/{lang}/{cardId}.json）。
- 失敗的卡片會記錄在 logs/fetch_failures.json，最後統一重試一輪。
- 使用多執行緒＋節流，避免對 API 造成過大負擔。
"""
import json
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from common import get_card_cached, load_cache, INDEX_DIR, LOG_DIR

MAX_WORKERS = 10


def load_refs():
    refs = []
    for lang in ("ja", "en"):
        p = os.path.join(INDEX_DIR, f"{lang}_card_refs.json")
        with open(p, "r", encoding="utf-8") as f:
            refs.extend(json.load(f))
    return refs


def fetch_one(ref):
    lang = ref["lang"]
    card_id = ref["cardId"]
    cached = load_cache(lang, card_id)
    if cached is not None:
        return ("cached", lang, card_id, None)
    data, err = get_card_cached(lang, card_id)
    if data is None:
        return ("failed", lang, card_id, err)
    return ("fetched", lang, card_id, None)


def run_pass(refs, label):
    results = {"cached": 0, "fetched": 0, "failed": 0}
    failures = []
    total = len(refs)
    done = 0
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as ex:
        futures = {ex.submit(fetch_one, ref): ref for ref in refs}
        for fut in as_completed(futures):
            status, lang, card_id, err = fut.result()
            results[status] += 1
            if status == "failed":
                failures.append({"lang": lang, "cardId": card_id, "error": err})
            done += 1
            if done % 500 == 0 or done == total:
                print(f"[{label}] {done}/{total} cached={results['cached']} fetched={results['fetched']} failed={results['failed']}", flush=True)
    return results, failures


def main():
    refs = load_refs()
    print(f"total refs to ensure cached: {len(refs)}")

    results, failures = run_pass(refs, "pass1")

    if failures:
        print(f"pass1 failures: {len(failures)}; retrying once...")
        retry_refs = [r for r in refs if any(f["cardId"] == r["cardId"] and f["lang"] == r["lang"] for f in failures)]
        time.sleep(2)
        results2, failures2 = run_pass(retry_refs, "retry")
        # merge counts: results2 fetched count moves failed->fetched
        results["failed"] = len(failures2)
        results["fetched"] += results2["fetched"]
        failures = failures2

    os.makedirs(LOG_DIR, exist_ok=True)
    with open(os.path.join(LOG_DIR, "fetch_failures.json"), "w", encoding="utf-8") as f:
        json.dump(failures, f, ensure_ascii=False, indent=1)

    print(json.dumps({"summary": results, "remaining_failures": len(failures)}))


if __name__ == "__main__":
    main()
