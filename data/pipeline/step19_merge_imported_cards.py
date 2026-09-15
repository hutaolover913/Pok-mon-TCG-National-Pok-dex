"""把 step18 抓到的卡片合併進 cards.json 與 sets.json。

    python data/pipeline/step19_merge_imported_cards.py --dry-run   # 先看會發生什麼
    python data/pipeline/step19_merge_imported_cards.py             # 真的寫入

-- 背景 ----------------------------------------------------------------------
step18 依 PTCG_缺少卡片清單.xlsx 成功抓到 27,798 張卡（日月 7,056、XY 4,733、
BW 2,770，其餘為 ex／DP／PL／base 等更早期與現有系列的缺卡），結果存在
data/pipeline/logs/import_missing_cards.json，但一直沒有合併進 cards.json。
這支腳本做那一步。

-- 合併規則 ------------------------------------------------------------------
  只取 status == "ok" 的紀錄。needs_review 與 failed 一律不進卡表。
  卡片 ID 沿用 step18 記下的 sourceId（格式 tcgdex:lang:xxx / limitless:lang:xxx），
  那是來源提供的穩定 ID，不自己重新拼。
  已存在於 cards.json 的卡（比對語言＋卡包＋去零卡號）一律跳過，不覆蓋 ——
  現有那 15,846 張是先前逐一核對過的，不讓這次匯入蓋掉。

-- 刻意不做的事 --------------------------------------------------------------
  不動現有卡片的任何欄位。
  不碰 IndexedDB（收藏、手動分類都在瀏覽器裡，這支腳本碰不到也不該碰）。
  不猜稀有度。來源沒給就是沒給，原樣寫進 originalRarity，
  由 js/cardCategories.js 決定它落到哪一類。
"""

import json
import os
import re
import sys
from collections import Counter, OrderedDict

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
DATA = os.path.join(ROOT, "data")
IMPORT_LOG = os.path.join(DATA, "pipeline", "logs", "import_missing_cards.json")
CARDS = os.path.join(DATA, "cards.json")
SETS = os.path.join(DATA, "sets.json")


def norm_num(value):
    """053/096 -> ('', 53)；TG09/30 -> ('TG', 9)。用來判斷是不是同一張卡。"""
    s = str(value or "").strip().split("/")[0]
    m = re.match(r"^([A-Za-z\-]*)0*(\d+)$", s)
    if m:
        return (m.group(1).upper(), int(m.group(2)))
    return (s.upper(), None)


def dedup_key(lang, set_id, number):
    return (lang, str(set_id or "").strip().upper(), norm_num(number))


def mechanic_tags(name, card_type):
    """從卡名判斷機制標籤。

    這些是**機制**不是稀有度，所以放 tags；跟現有卡片的 ex／V／VMAX 一致。
    判斷依據只有卡名結尾，不做模糊比對 —— 寧可少標，不要標錯。
    """
    n = str(name or "").strip()
    tags = []
    # 不能用 \bGX$ —— \b 在日文名稱上失效（マーシャドー&カイリキーGX 抓不到），
    # 實測會少算 145 張。TAG TEAM 的判斷依據是「卡名含 & 且以 GX 結尾」。
    if re.search(r"&.*GX$", n) or "TAG TEAM" in n.upper():
        tags.append("TAG TEAM")
        tags.append("GX")
    elif n.endswith("GX"):
        tags.append("GX")
    elif n.endswith("LV.X"):
        tags.append("LV.X")
    elif n.endswith("LEGEND") or "LEGEND" in n.upper().split():
        tags.append("LEGEND")
    elif re.search(r"\bPrime$", n):
        tags.append("Prime")
    elif n.endswith("EX"):
        tags.append("EX")
    elif n.endswith("ex"):
        tags.append("ex")
    elif n.endswith("V"):
        tags.append("V")
    elif n.endswith("VMAX"):
        tags.append("VMAX")
    elif n.endswith("VSTAR"):
        tags.append("VSTAR")
    return tags


def build_card(rec):
    """把一筆匯入紀錄轉成 cards.json 的格式。"""
    source_id = rec.get("sourceId") or ""
    # sourceId 形如 tcgdex:en:sm12-1 或 limitless:ja:S7R-36
    parts = source_id.split(":", 2)
    if len(parts) == 3:
        card_id = "tcgdex:%s:%s" % (parts[1], parts[2]) if parts[0] == "tcgdex" \
            else "%s:%s:%s" % (parts[0], parts[1], parts[2])
        raw_source = parts[2]
    else:
        # 沒有可用的穩定 ID 就用語言＋卡包＋卡號組一個，並標記出來
        raw_source = "%s-%s" % (rec.get("setId"), rec.get("localNumber"))
        card_id = "import:%s:%s" % (rec.get("language"), raw_source)

    dex = rec.get("dexNumber")
    dex_numbers = []
    if dex not in (None, ""):
        try:
            dex_numbers = [int(dex)]
        except (TypeError, ValueError):
            dex_numbers = []

    # 圖片有兩種來源，格式不同，必須分開存：
    #
    #   imageBase  TCGdex 的**基底**網址（不含副檔名），11,608 張。
    #              data.js 會自己接 /low.webp 與 /high.webp。
    #   imageUrl   LimitlessTCG 的**完整**圖檔網址，9,796 張。
    #              直接塞進 image 欄位會被接成 xxx.png/low.webp 這種壞網址，
    #              所以另外放 imageDirect，由 data.js 原樣使用。
    #
    # 兩者都沒有的 6,394 張才是真的沒有遠端來源。
    image = rec.get("imageBase") or None
    image_direct = None
    if not image:
        url = rec.get("imageUrl") or ""
        if url.startswith("http"):
            image_direct = url

    return {
        "id": card_id,
        "sourceId": raw_source,
        "language": rec.get("language"),
        "name": rec.get("name"),
        "cardType": rec.get("cardType") or "Pokemon",
        "setId": rec.get("setId"),
        "cardNumber": str(rec.get("cardNumber") or rec.get("localNumber") or ""),
        "originalRarity": rec.get("originalRarity"),
        "tags": mechanic_tags(rec.get("name"), rec.get("cardType")),
        "image": image,
        "imageDirect": image_direct,
        "dexNumbers": dex_numbers,
        "illustrator": rec.get("illustrator"),
        "isSample": False,
        # 這一批是後來補進來的，標記出來方便日後追查與回溯
        "importedFrom": "step18",
    }


def build_set(rec):
    printed = None
    num = str(rec.get("cardNumber") or "")
    if "/" in num:
        tail = num.split("/")[-1].strip()
        if tail.isdigit():
            printed = int(tail)
    return {
        "setId": rec.get("setId"),
        "setName": rec.get("setName") or rec.get("setId"),
        "seriesId": rec.get("seriesId"),
        "seriesName": rec.get("seriesName") or rec.get("seriesId"),
        "releaseDate": rec.get("releaseDate") or "",
        "printedTotal": printed,
        "language": rec.get("language"),
    }


def main():
    dry = "--dry-run" in sys.argv

    with open(CARDS, encoding="utf-8") as f:
        cards = json.load(f)
    with open(SETS, encoding="utf-8") as f:
        sets = json.load(f)
    with open(IMPORT_LOG, encoding="utf-8") as f:
        log = json.load(f)

    existing_keys = set()
    existing_ids = set()
    for c in cards:
        existing_keys.add(dedup_key(c["language"], c["setId"], c["cardNumber"]))
        existing_ids.add(c["id"])

    ok = [v for v in log.values() if v.get("status") == "ok"]
    print("匯入紀錄 %d 筆，其中 status=ok 的有 %d 筆" % (len(log), len(ok)))
    print("cards.json 目前 %d 張，sets.json %d 個卡包" % (len(cards), len(sets)))
    print()

    new_cards = []
    skipped_existing = 0
    skipped_dupe_id = 0
    skipped_bad = 0
    new_sets = {}
    seen_ids = set()

    for rec in ok:
        lang = rec.get("language")
        set_id = rec.get("setId")
        if not lang or not set_id:
            skipped_bad += 1
            continue
        if dedup_key(lang, set_id, rec.get("cardNumber")) in existing_keys:
            skipped_existing += 1
            continue

        card = build_card(rec)
        if card["id"] in existing_ids or card["id"] in seen_ids:
            skipped_dupe_id += 1
            continue
        seen_ids.add(card["id"])
        new_cards.append(card)

        key = "%s:%s" % (lang, set_id)
        if key not in sets and key not in new_sets:
            new_sets[key] = build_set(rec)

    print("  新增卡片          %6d 張" % len(new_cards))
    print("  已存在而跳過      %6d 張" % skipped_existing)
    print("  ID 重複而跳過     %6d 張" % skipped_dupe_id)
    print("  資料不全而跳過    %6d 張" % skipped_bad)
    print("  新增卡包          %6d 個" % len(new_sets))
    print()

    langs = Counter(c["language"] for c in new_cards)
    print("  依語言：%s" % dict(langs))
    series = Counter((c["language"], new_sets.get("%s:%s" % (c["language"], c["setId"]), {}).get("seriesId")
                      or sets.get("%s:%s" % (c["language"], c["setId"]), {}).get("seriesId"))
                     for c in new_cards)
    print("  依系列前 10：")
    for (lang, sid), n in series.most_common(10):
        print("    %-3s %-10s %6d" % (lang, sid, n))
    print()

    with_base = sum(1 for c in new_cards if c["image"])
    with_direct = sum(1 for c in new_cards if not c["image"] and c.get("imageDirect"))
    no_image = sum(1 for c in new_cards if not c["image"] and not c.get("imageDirect"))
    print("  圖片來源：TCGdex 基底 %d 張、Limitless 直連 %d 張、完全沒有 %d 張"
          % (with_base, with_direct, no_image))
    tags = Counter(t for c in new_cards for t in c["tags"])
    print("  機制標籤：%s" % dict(tags.most_common()))
    print()

    if dry:
        print("--dry-run：沒有寫入任何檔案。")
        print("確認以上數字沒問題後，把 --dry-run 拿掉再跑一次。")
        return

    merged_cards = cards + new_cards
    merged_sets = OrderedDict(sets)
    merged_sets.update(new_sets)

    # 先寫暫存再置換，避免中途失敗留下半套檔案
    for path, payload in ((CARDS, merged_cards), (SETS, merged_sets)):
        tmp = path + ".tmp"
        with open(tmp, "w", encoding="utf-8", newline="\n") as f:
            json.dump(payload, f, ensure_ascii=False)
        os.replace(tmp, path)

    print("已寫入：")
    print("  cards.json  %d -> %d 張" % (len(cards), len(merged_cards)))
    print("  sets.json   %d -> %d 個卡包" % (len(sets), len(merged_sets)))
    print()
    print("接著要做：檢查 js/cardCategories.js 的稀有度對照有沒有涵蓋新世代的字串。")


if __name__ == "__main__":
    main()
