"""
Step 8：不相信 manifest 說的話，重新實際檢查每個「成功」項目的本機檔案是否
真的存在、大小正常、且能被 Pillow 解碼。順便交叉核對 image_local_map.json
的 key 是否跟 cards.json 目前的卡片 id 對得起來（避免資料改版後 key 對不上、
前端拿著舊 key 查表查不到）。
"""
import io
import json
import os
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.dirname(HERE)
PROJECT_DIR = os.path.dirname(DATA_DIR)


def main():
    with open(os.path.join(HERE, "logs", "image_manifest.json"), "r", encoding="utf-8") as f:
        manifest = json.load(f)
    with open(os.path.join(DATA_DIR, "image_local_map.json"), "r", encoding="utf-8") as f:
        local_map = json.load(f)
    with open(os.path.join(DATA_DIR, "cards.json"), "r", encoding="utf-8") as f:
        cards = json.load(f)
    with open(os.path.join(DATA_DIR, "species.json"), "r", encoding="utf-8") as f:
        species = json.load(f)

    card_ids = {c["id"] for c in cards}
    species_ids = {str(s["id"]) for s in species}

    corrupt = []
    missing_file = []
    for key, rec in manifest.items():
        if rec["status"] != "success":
            continue
        local_path = rec.get("localPath")
        abs_path = os.path.join(PROJECT_DIR, local_path) if local_path else None
        if not abs_path or not os.path.exists(abs_path):
            missing_file.append({"key": key, "localPath": local_path})
            continue
        try:
            with open(abs_path, "rb") as f:
                data = f.read()
            img = Image.open(io.BytesIO(data))
            img.verify()
            if len(data) < 200:
                corrupt.append({"key": key, "localPath": local_path, "reason": "too_small"})
        except Exception as e:
            corrupt.append({"key": key, "localPath": local_path, "reason": str(e)})

    # local_map key 是否對得上目前的 cards.json / species.json id
    orphan_card_keys = [k for k in local_map.get("cards", {}) if k not in card_ids]
    orphan_species_keys = [k for k in local_map.get("species", {}) if k not in species_ids]

    # 反過來：目前有圖的卡片／物種，local_map 裡有沒有漏掉（key 沒對上）
    mapped_card_ids = set(local_map.get("cards", {}).keys())
    mapped_species_ids = set(local_map.get("species", {}).keys())
    cards_with_source_not_mapped = [
        c["id"] for c in cards if c.get("image") and c["id"] not in mapped_card_ids
    ]
    species_not_mapped = [str(s["id"]) for s in species if str(s["id"]) not in mapped_species_ids]

    report = {
        "manifestSuccessTotal": sum(1 for v in manifest.values() if v["status"] == "success"),
        "corruptOnDisk": corrupt,
        "missingFileOnDisk": missing_file,
        "orphanCardKeysInMap": orphan_card_keys[:20],
        "orphanCardKeysInMapCount": len(orphan_card_keys),
        "orphanSpeciesKeysInMap": orphan_species_keys[:20],
        "orphanSpeciesKeysInMapCount": len(orphan_species_keys),
        "cardsWithSourceButNotInMap": cards_with_source_not_mapped[:20],
        "cardsWithSourceButNotInMapCount": len(cards_with_source_not_mapped),
        "speciesNotInMap": species_not_mapped,
    }
    with open(os.path.join(HERE, "logs", "image_audit_report.json"), "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=1)

    print(json.dumps({k: (v if not isinstance(v, list) else len(v)) for k, v in report.items()}, indent=1))


if __name__ == "__main__":
    main()
