"""
Step 10：彙整「目前收錄範圍內，圖片仍然抓不到」的最終清單，分原因分類，
並附上可以人工核對的卡片查詢連結（不是保證那個連結上一定找得到圖，只是
方便使用者自己去核對／找圖）。
"""
import json
import os
import urllib.parse

HERE = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.dirname(HERE)


def pokellector_search_url(name):
    return f"https://www.pokellector.com/search?search={urllib.parse.quote(name)}"


def official_jp_search_url(name):
    return f"https://www.pokemon-card.com/card-search/index.php?keyword={urllib.parse.quote(name)}"


def main():
    with open(os.path.join(DATA_DIR, "cards.json"), "r", encoding="utf-8") as f:
        cards = json.load(f)
    with open(os.path.join(DATA_DIR, "image_local_map.json"), "r", encoding="utf-8") as f:
        local_map = json.load(f)
    mapped_card_ids = set(local_map.get("cards", {}).keys())

    with open(os.path.join(DATA_DIR, "sets.json"), "r", encoding="utf-8") as f:
        sets_meta = json.load(f)

    # limitless_fallback_log.json 每次重跑 step9 只會覆蓋「這次實際處理過」的項目，
    # 第一輪已經成功、第二輪被跳過（already_done）的項目不會出現在最新這份 log 裡，
    # 但那些卡已經有本機圖片了，本來就不該出現在「仍然缺圖」清單中，用
    # mapped_card_ids 直接判斷最終是否成功即可，不依賴 log 的涵蓋範圍。
    with open(os.path.join(HERE, "logs", "limitless_fallback_log.json"), "r", encoding="utf-8") as f:
        limitless_log = json.load(f)
    limitless_by_id = {r["cardId"]: r for r in limitless_log}

    jp_log_path = os.path.join(HERE, "logs", "limitless_jp_fallback_log.json")
    jp_by_id = {}
    if os.path.exists(jp_log_path):
        with open(jp_log_path, "r", encoding="utf-8") as f:
            for r in json.load(f):
                jp_by_id[r["cardId"]] = r

    # 「仍然缺圖」＝ TCGdex 原始沒有網址，且最終也沒有進到本機圖片對照表
    # （不論是 TCGdex 格式回退或 LimitlessTCG 備援救回的，都算已解決，不算缺圖）。
    no_source = [c for c in cards if not c.get("image") and c["id"] not in mapped_card_ids]

    rows = []
    for c in no_source:
        entry = {
            "cardId": c["id"],
            "name": c["name"],
            "setId": c["setId"],
            "cardNumber": c["cardNumber"],
            "language": c["language"],
        }
        if c["language"] == "ja":
            jp = jp_by_id.get(c["id"])
            if not jp:
                entry["reason"] = "TCGdex 無圖；尚未對此卡嘗試 LimitlessTCG 日文資料庫"
            elif jp["status"] == "not_found":
                # 超出卡包官方張數的密卡（secret rare），TCGdex 與 LimitlessTCG 的
                # 編號方式不一致（例如 S8：TCGdex 收 129 張、Limitless 只有 115 張，
                # 且 Limitless #115 對應的是 TCGdex #124）。同一個卡包內同名卡可能有
                # 多張不同異圖，只靠名稱搜尋無法確定版本，硬對會張冠李戴，所以不自動補。
                set_info = sets_meta.get(f"{c['language']}:{c['setId']}", {})
                printed_total = set_info.get("printedTotal") or 0
                num_part = "".join(ch for ch in c["cardNumber"] if ch.isdigit())
                is_secret = printed_total and num_part and int(num_part) > printed_total
                if is_secret:
                    entry["reason"] = (f"TCGdex 無圖；此卡為超出卡包官方張數的密卡（{c['cardNumber']}/{printed_total}），"
                                        f"TCGdex 與 LimitlessTCG 的密卡編號方式不同，無法確定對應版本，未自動採用")
                else:
                    entry["reason"] = f"TCGdex 無圖；LimitlessTCG 日文資料庫該頁面不存在（{jp.get('pageUrl')}）"
            elif jp["status"] == "name_mismatch":
                entry["reason"] = (f"TCGdex 無圖；LimitlessTCG 該頁面卡名為「{jp.get('pageTitleName')}」，"
                                    f"與資料庫記錄不符，為避免張冠李戴未採用（{jp.get('pageUrl')}）")
            else:
                entry["reason"] = f"TCGdex 無圖；LimitlessTCG 日文資料庫查詢結果：{jp['status']}"
            entry["manualCheckUrl"] = official_jp_search_url(c["name"])
        else:
            lim = limitless_by_id.get(c["id"])
            if not lim:
                entry["reason"] = "TCGdex 無圖，且所屬卡包無法確認 LimitlessTCG 對應編號規則，未嘗試（避免用猜的）"
            elif lim["status"] == "not_found":
                entry["reason"] = f"TCGdex 無圖；LimitlessTCG 該頁面不存在（{lim.get('pageUrl')}）"
            elif lim["status"] == "skipped":
                entry["reason"] = f"TCGdex 無圖；{lim.get('reason')}"
            else:
                entry["reason"] = f"TCGdex 無圖；LimitlessTCG 查詢結果：{lim['status']}"
            entry["manualCheckUrl"] = pokellector_search_url(c["name"])
        rows.append(entry)

    by_reason_bucket = {}
    for r in rows:
        if r["language"] == "ja":
            if "密卡編號方式不同" in r["reason"]:
                bucket = "ja_secret_rare_numbering"
            elif "該頁面不存在" in r["reason"]:
                bucket = "ja_limitless_404"
            elif "與資料庫記錄不符" in r["reason"]:
                bucket = "ja_name_mismatch"
            else:
                bucket = "ja_other"
        elif "無法確認 LimitlessTCG 對應編號規則" in r["reason"]:
            bucket = "en_no_set_mapping"
        elif "該頁面不存在" in r["reason"]:
            bucket = "en_limitless_404"
        else:
            bucket = "en_other"
        by_reason_bucket.setdefault(bucket, []).append(r)

    with open(os.path.join(HERE, "logs", "final_still_missing.json"), "w", encoding="utf-8") as f:
        json.dump(rows, f, ensure_ascii=False, indent=1)

    summary = {bucket: len(items) for bucket, items in by_reason_bucket.items()}
    summary["total"] = len(rows)
    print(json.dumps(summary, indent=1))


if __name__ == "__main__":
    main()
