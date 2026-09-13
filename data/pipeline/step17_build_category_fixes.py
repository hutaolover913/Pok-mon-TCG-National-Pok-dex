"""
Step 17：把使用者提供的「PTCG_分類查核.xlsx / 錯分清單」轉成 App 可以套用的
一次性修正檔 data/category_fixes.json。

只取「查核結果 = 已確認錯分」的列。疑似錯分、建議細分、來源疑點、證據不足、
跨語言待核一律不碰。

每一筆都會帶上辨識欄位（語言、卡包代碼、完整卡號、卡名），App 端套用前會
再比對一次，確認是同一張、同一版本才改；對不上就跳過並列入報告，不猜。

刻意不做的事：不依稀有度字串批次轉換（例如把所有 Ultra Rare 改成 UR、或把
Mega Hyper Rare 都改成 MUR）。這份修正是逐張卡片 ID 指定的，不會波及其他版本。
"""
import json
import os
import sys
from datetime import datetime, timezone

import openpyxl

HERE = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.dirname(HERE)
CARDS_PATH = os.path.join(DATA_DIR, "cards.json")
SETS_PATH = os.path.join(DATA_DIR, "sets.json")
OUT_PATH = os.path.join(DATA_DIR, "category_fixes.json")

TARGET_RESULT = "已確認錯分"
# 修正批次版本。App 用它記錄「這一批套用過了」，之後不會重複套用，
# 也不會在每次重新整理時把使用者後來的手動調整改回來。
FIX_VERSION = "2026-09-13-xlsx-confirmed-31"

# Excel 的分類顯示名稱 -> App 內部的分類 id
LABEL_TO_ID = {
    "AR": "AR", "SR": "SR", "SAR": "SAR", "CSR": "CSR", "CHR": "CHR",
    "HR": "HR", "UR": "UR", "PR／PROMO": "PROMO", "PR/PROMO": "PROMO",
    "普通卡": "NORMAL", "其他": "OTHER", "待確認": "UNVERIFIED",
    "RR": "RR", "RRR": "RRR", "光輝": "RADIANT_ZH", "ACE": "ACE",
    "SSR": "SSR", "BWR": "BWR", "MUR": "MUR", "MA": "MA", "閃光": "SHINY_ZH",
}


def to_id(label):
    if label is None:
        return None
    return LABEL_TO_ID.get(str(label).strip())


def main(xlsx_path):
    wb = openpyxl.load_workbook(xlsx_path, data_only=True)
    if "錯分清單" not in wb.sheetnames:
        print("找不到「錯分清單」工作表", file=sys.stderr)
        sys.exit(1)
    ws = wb["錯分清單"]
    hdr = [c.value for c in ws[1]]
    rows = [dict(zip(hdr, [c.value for c in r])) for r in ws.iter_rows(min_row=2)]
    rows = [r for r in rows if r.get("穩定卡片 ID")]

    confirmed = [r for r in rows if str(r.get("查核結果", "")).strip() == TARGET_RESULT]
    others = {}
    for r in rows:
        k = str(r.get("查核結果", "")).strip()
        if k != TARGET_RESULT:
            others[k] = others.get(k, 0) + 1

    with open(CARDS_PATH, "r", encoding="utf-8") as f:
        cards = {c["id"]: c for c in json.load(f)}
    with open(SETS_PATH, "r", encoding="utf-8") as f:
        sets_meta = json.load(f)

    fixes = []
    problems = []
    for r in confirmed:
        cid = str(r["穩定卡片 ID"]).strip()
        from_id = to_id(r.get("目前所在分類"))
        to_cat = to_id(r.get("建議分類"))
        if to_cat is None:
            problems.append({"cardId": cid, "reason": f"建議分類「{r.get('建議分類')}」不是已知分類"})
            continue
        card = cards.get(cid)
        if card is None:
            problems.append({"cardId": cid, "reason": "專案卡表裡找不到這個卡片 ID"})
            continue

        # 用語言、卡包代碼、卡號再核對一次，確認是同一張同一版本
        set_info = sets_meta.get(f"{card['language']}:{card['setId']}", {})
        printed_total = set_info.get("printedTotal")
        expected_number = f"{card['cardNumber']}/{printed_total}" if printed_total else str(card["cardNumber"])
        xlsx_number = str(r.get("完整卡號") or "").strip()
        mismatch = []
        if xlsx_number and xlsx_number != expected_number:
            mismatch.append(f"卡號不符（Excel {xlsx_number} / 專案 {expected_number}）")
        xlsx_set = str(r.get("卡包代碼") or "").strip()
        if xlsx_set and xlsx_set != card["setId"]:
            mismatch.append(f"卡包代碼不符（Excel {xlsx_set} / 專案 {card['setId']}）")
        xlsx_name = str(r.get("卡片名稱") or "").strip()
        if xlsx_name and xlsx_name != (card.get("name") or "").strip():
            mismatch.append(f"卡名不符（Excel {xlsx_name} / 專案 {card.get('name')}）")
        if mismatch:
            problems.append({"cardId": cid, "reason": "；".join(mismatch)})
            continue

        fixes.append({
            "cardId": cid,
            "expectedFrom": from_id,      # App 端會比對目前分類是否等於這個
            "to": to_cat,
            # 辨識欄位：App 套用前再核對一次
            "language": card["language"],
            "setId": card["setId"],
            "cardNumber": expected_number,
            "name": card.get("name"),
            "reason": str(r.get("判定說明") or "").strip(),
            "checkedBy": str(r.get("核對方式") or "").strip(),
            "sourceUrl": str(r.get("查核來源網址") or "").strip(),
        })

    out = {
        "version": FIX_VERSION,
        "builtAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": os.path.basename(xlsx_path),
        "note": "只包含「已確認錯分」的逐張修正；疑似錯分等其他查核結果一律不處理。",
        "notAppliedCounts": others,
        "fixes": fixes,
    }
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)

    by_to = {}
    for x in fixes:
        by_to[x["to"]] = by_to.get(x["to"], 0) + 1
    print(json.dumps({
        "錯分清單總列數": len(rows),
        "已確認錯分": len(confirmed),
        "寫入修正": len(fixes),
        "核對失敗": problems,
        "其他查核結果（不處理）": others,
        "建議分類分布": by_to,
        "輸出": os.path.relpath(OUT_PATH, os.path.dirname(DATA_DIR)),
    }, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    path = sys.argv[1] if len(sys.argv) > 1 else r"C:\Users\shinf\Downloads\PTCG_分類查核.xlsx"
    main(path)
