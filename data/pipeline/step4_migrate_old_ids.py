"""
Step 4：建立「舊卡片 ID -> 新卡片 ID」遷移對照表。

第一版 App 曾經內建 70 張示範卡（sourceDb=pokemontcg.io，id 例如 "sv8-247"）。
這次改用 TCGdex 作為正式資料來源後，卡片 ID 規則改變（例如變成
"tcgdex:en:sv08-247"）。為了不讓已經用舊版 App 收藏過這些卡的使用者遺失紀錄，
這裡用「卡包代碼＋卡號」核對出同一張真實卡片對應的新 ID，
輸出 migration_map.json 給前端在使用者裝置上做一次性遷移。

對應不到的舊卡（例如舊版唯一一張 1999 年 Wizards Promo，這次匯入範圍沒有涵蓋
到那麼早期的系列）會列在 unmapped_old_cards，遷移時原樣保留、不會被刪除，
只是不會再出現在目前的卡片瀏覽介面裡。
"""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.dirname(HERE)

# 舊版 pokemontcg.io 卡包代碼 -> 新版 TCGdex（英文）卡包代碼
OLD_TO_NEW_SET_ID = {
    "basep": None,  # 1999 Wizards Promo，這次匯入範圍未涵蓋，無對應
    "me2pt5": "me02.5",
    "me2": "me02",
    "sv4pt5": "sv04.5",
    "sv3pt5": "sv03.5",
    "sv3": "sv03",
    "sv8pt5": "sv08.5",
    "sv8": "sv08",
    "cel25c": "cel25cc",
    "swsh9tg": "swsh9tg",
    "swsh7": "swsh7",
    "swsh12pt5": "swsh12.5",
    "swsh12pt5gg": "swsh12.5gg",
    "swsh11tg": "swsh11tg",
    "swsh8": "swsh8",
    "sv6": "sv06",
    "sv6pt5": "sv06.5",
    "sv7": "sv07",
    "svp": "svp",
    "swsh12tg": "swsh12tg",
}


def norm_num(n):
    """卡號比對用：去掉前導 0（TCGdex 用 "006"，舊資料用 "6"），字母卡號原樣比對。"""
    return n.lstrip("0") or "0"


def main():
    with open(os.path.join(DATA_DIR, "cards.json"), "r", encoding="utf-8") as f:
        old_cards = json.load(f)
    with open(os.path.join(DATA_DIR, "cards_v2.json"), "r", encoding="utf-8") as f:
        new_cards = json.load(f)

    new_index = {}
    for c in new_cards:
        if c["language"] != "en":
            continue
        new_index[(c["setId"], norm_num(c["cardNumber"]))] = c["id"]

    migration_map = {}
    unmapped = []

    for old in old_cards:
        new_set_id = OLD_TO_NEW_SET_ID.get(old["setCode"])
        if new_set_id is None:
            unmapped.append({"oldId": old["id"], "reason": "set_not_in_new_scope", "setCode": old["setCode"]})
            continue
        old_num = old["cardNumber"].split("_")[0]  # 舊 id 裡 "17_A" 這種變體後綴只在 id，cardNumber 本身通常已是 "17"
        key = (new_set_id, norm_num(old_num))
        new_id = new_index.get(key)
        if new_id:
            migration_map[old["id"]] = new_id
        else:
            unmapped.append({"oldId": old["id"], "reason": "card_number_not_found", "triedSetId": new_set_id, "cardNumber": old["cardNumber"]})

    with open(os.path.join(DATA_DIR, "migration_map.json"), "w", encoding="utf-8") as f:
        json.dump({
            "fromVersion": "sample-pokemontcg.io-v1",
            "toVersion": "tcgdex-v2",
            "map": migration_map,
            "unmapped": unmapped,
        }, f, ensure_ascii=False, indent=1)

    print(json.dumps({"totalOld": len(old_cards), "mapped": len(migration_map), "unmapped": len(unmapped)}))


if __name__ == "__main__":
    main()
