"""
Step 13：把補圖包裡「候選版本需核對」的卡片，整理成 App 可以讀的候選清單。

這批（My First Battle、MC 基本能量、無編號 Jumbo…）在兩個資料庫之間的
編號規則不同，沒辦法用「卡包＋卡號」機械式確認是不是同一版本，所以**不自動
套用**——改成把候選圖片放進 images/candidates/，並輸出 data/image_candidates.json，
讓 App 在該卡片的詳細頁把候選圖秀出來，由使用者看圖決定要不要採用。
使用者按下「使用這張」後，會存成該卡的自訂圖片（跟手動上傳同一套機制）。

輸出格式：
{
  "tcgdex:ja:MC-DAR": {
     "note": "為什麼需要人工核對",
     "candidates": [
        {"path": "images/candidates/ja_MC-DAR__1.webp", "title": "...",
         "number": "No. 1006", "setName": "...", "sourceUrl": "..."}
     ]
  }
}
"""
import io
import json
import os
import shutil

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.dirname(HERE)
PROJECT_DIR = os.path.dirname(DATA_DIR)

PACKAGE_DIR = os.path.join(PROJECT_DIR, "exports", "missing_images")
REPORT_PATH = os.path.join(PACKAGE_DIR, "missing_images_report.json")
OUT_PATH = os.path.join(DATA_DIR, "image_candidates.json")
DEST_DIR_REL = "images/candidates"

VERIFIED_STATUS = "卡包／卡號已核對"


def main():
    with open(REPORT_PATH, "r", encoding="utf-8") as f:
        report = json.load(f)
    with open(os.path.join(DATA_DIR, "cards.json"), "r", encoding="utf-8") as f:
        cards = json.load(f)
    card_ids = {c["id"] for c in cards}

    out = {}
    copied = 0
    skipped_bad = []

    for entry in report:
        if entry.get("status") == VERIFIED_STATUS:
            continue
        if entry["cardId"] not in card_ids:
            skipped_bad.append({"cardId": entry["cardId"], "reason": "card_id_not_in_database"})
            continue

        cand_out = []
        for cand in entry.get("candidates") or []:
            src_abs = os.path.join(PACKAGE_DIR, cand.get("localPath", ""))
            if not os.path.exists(src_abs):
                skipped_bad.append({"cardId": entry["cardId"], "reason": "file_missing",
                                     "path": cand.get("localPath")})
                continue
            # 一樣要能解碼才放進來，不要讓 App 端拿到壞檔
            try:
                with open(src_abs, "rb") as f:
                    Image.open(io.BytesIO(f.read())).verify()
            except Exception as e:
                skipped_bad.append({"cardId": entry["cardId"], "reason": f"not_decodable:{e}",
                                     "path": cand.get("localPath")})
                continue

            basename = os.path.basename(cand["localPath"])
            dest_rel = f"{DEST_DIR_REL}/{basename}"
            dest_abs = os.path.join(PROJECT_DIR, dest_rel)
            os.makedirs(os.path.dirname(dest_abs), exist_ok=True)
            shutil.copy2(src_abs, dest_abs)
            copied += 1

            cand_out.append({
                "path": dest_rel,
                "title": cand.get("title"),
                "number": cand.get("number"),
                "setName": cand.get("setName"),
                "sourceUrl": cand.get("sourceUrl"),
            })

        if cand_out:
            out[entry["cardId"]] = {
                "note": entry.get("note") or entry.get("reason"),
                "candidates": cand_out,
            }

    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))

    print(json.dumps({
        "cardsWithCandidates": len(out),
        "candidateImagesCopied": copied,
        "skipped": len(skipped_bad),
        "skippedDetail": skipped_bad[:5],
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
