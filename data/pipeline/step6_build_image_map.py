"""
Step 6：把 image_manifest.json 整理成 App 實際會讀取的 data/image_local_map.json，
並輸出「目前仍下載失敗」的清單（含卡片 id／物種編號、原始網址、失敗原因），
方便下次接續重試，也方便回報。

data/image_local_map.json 結構：
{ "species": { "25": "images/species/25.png", ... },
  "cards":   { "tcgdex:ja:SV2a-003": "images/cards/ja_SV2a-003.webp", ... } }

只收「status == success 且本機檔案實際存在」的項目，避免 map 裡出現死路徑。
"""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.dirname(HERE)
PROJECT_DIR = os.path.dirname(DATA_DIR)
MANIFEST_PATH = os.path.join(HERE, "logs", "image_manifest.json")
LOCAL_MAP_PATH = os.path.join(DATA_DIR, "image_local_map.json")
STILL_FAILING_PATH = os.path.join(HERE, "logs", "image_still_failing.json")


def main():
    with open(MANIFEST_PATH, "r", encoding="utf-8") as f:
        manifest = json.load(f)

    species_map = {}
    cards_map = {}
    still_failing = []

    for key, rec in manifest.items():
        kind, ident = key.split(":", 1)
        if rec.get("status") == "success" and rec.get("localPath"):
            abs_path = os.path.join(PROJECT_DIR, rec["localPath"])
            if os.path.exists(abs_path) and os.path.getsize(abs_path) >= 200:
                if kind == "species":
                    species_map[ident] = rec["localPath"].replace("\\", "/")
                elif kind == "cards":
                    cards_map[ident] = rec["localPath"].replace("\\", "/")
                continue
        # 沒成功或本機檔案不見了，都算「仍然失敗」
        still_failing.append({
            "key": key,
            "kind": kind,
            "id": ident,
            "url": rec.get("url"),
            "httpStatus": rec.get("httpStatus"),
            "error": rec.get("error"),
            "attempts": rec.get("attempts"),
            "lastAttempt": rec.get("lastAttempt"),
        })

    with open(LOCAL_MAP_PATH, "w", encoding="utf-8") as f:
        json.dump({"species": species_map, "cards": cards_map}, f, ensure_ascii=False, separators=(",", ":"))

    with open(STILL_FAILING_PATH, "w", encoding="utf-8") as f:
        json.dump(still_failing, f, ensure_ascii=False, indent=1)

    print(json.dumps({
        "speciesMapped": len(species_map),
        "cardsMapped": len(cards_map),
        "stillFailing": len(still_failing),
    }))


if __name__ == "__main__":
    main()
