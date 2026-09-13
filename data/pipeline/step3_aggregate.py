"""
Step 3：把快取下來的原始 TCGdex 卡片資料，整理成 App 使用的 cards.json，
並產生匯入報告（語言／卡包/卡片數、AR/CHR/CSR/SAR 數量、缺圖數、
無法對應寶可夢數量等），供人工核對。

保留原則：
- originalRarity 直接使用 TCGdex 回傳的 rarity 字串（來源本身已是英文正規化用語，
  例如 "Special illustration rare"、"Character Rare"），不做任何猜測式改寫；
  缺值一律記為 null，不臆測。
- dexNumbers 優先採用 TCGdex 的 dexId；缺漏時嘗試用日文／英文寶可夢名稱比對
  species 資料庫做 fallback，比對不到的列入 unresolved_pokemon_cards 清單。
- 每張卡片的 id 採 `tcgdex:{lang}:{sourceId}`，來源 setId/localId/rarity 等原始值
  全部保留在卡片物件中，不會被分類對照覆蓋。
"""
import json
import os
import re
from collections import Counter, defaultdict
from common import INDEX_DIR, CACHE_DIR, LOG_DIR

HERE = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.dirname(HERE)  # pokedex-app/data

SPECIES_JSON = os.path.join(DATA_DIR, "species.json")
JA_NAMES_JSON = os.path.join(DATA_DIR, "ja_species_names.json")

VMAX_LIKE_STAGES = {"VMAX", "VSTAR", "MEGA"}

# 已知的稀有度字串 -> App 收藏分類。只根據「這次實測看到的 TCGdex rarity 字串」建立，
# 不臆測未出現過的值；未列在這裡的字串一律先落到 OTHER，並在報告中列出待覆核清單。
RARITY_TO_CATEGORY = {
    # 一般卡
    "Common": "NORMAL",
    "Uncommon": "NORMAL",
    "Rare": "NORMAL",
    "Rare Holo": "NORMAL",
    "Double rare": "NORMAL",
    "Double Rare": "NORMAL",
    "ACE SPEC Rare": "NORMAL",
    "Promo": "PROMO",
    # AR
    "Illustration rare": "AR",
    "Illustration Rare": "AR",
    # SAR
    "Special illustration rare": "SAR",
    "Special Illustration Rare": "SAR",
    # CHR / CSR
    "Character Rare": "CHR",
    "Character rare": "CHR",
    "Character Super Rare": "CSR",
    "Character super rare": "CSR",
    # SR（V/VMAX/VSTAR 全圖等級，非 Special Illustration）
    "Rare Holo V": "SR",
    "Rare Holo VMAX": "SR",
    "Rare Holo VSTAR": "SR",
    "Rare Holo GX": "SR",
    "Rare Holo EX": "SR",
    "Rare BREAK": "SR",
    "Rare Prime": "SR",
    "Rare ACE": "SR",
    "Radiant Rare": "SR",
    "Amazing Rare": "SR",
    "Shiny rare": "SR",
    "Shiny Rare": "SR",
    "Shiny holo rare": "SR",
    # UR
    "Ultra Rare": "UR",
    "Rare Ultra": "UR",
    "Hyper rare": "UR",
    "Hyper Rare": "UR",
    "Mega Hyper Rare": "UR",
    "Secret Rare": "UR",
    "Rare Secret": "UR",
    "Rare Rainbow": "UR",
    "Rare Shining": "UR",
    "Gold Secret Rare": "UR",
    "Shiny Ultra Rare": "UR",
    "Holo Rare": "NORMAL",
    "Holo Rare V": "SR",
    "Holo Rare VMAX": "SR",
    "Holo Rare VSTAR": "SR",
    "Triple Rare": "SR",
    "Classic Collection": "OTHER",
    "Shiny rare V": "SR",
    "Shiny rare VMAX": "SR",
    "Black White Rare": "UR",
    "Full Art Trainer": "UR",
}

# 少數卡片沒有 dexId、且名稱含地區形態／超級進化／「OO的△△」訓練家聯名字首等前綴，
# 一般字尾去除規則比對不到。這裡是實測後針對「這批資料實際出現的名稱」逐一人工核對
# 對應的圖鑑編號（見 pipeline/logs/unresolved_pokemon_cards.json 的驗證紀錄），
# 而不是用規則去猜。之後若有新的漏網案例，會被列進 unresolved 清單，不會被硬猜。
NAME_ALIAS_OVERRIDES = {
    "ヒスイ ウインディV": 59,
    "ヒスイ ウインディVSTAR": 59,
    "ヒスイ バクフーンV": 157,
    "ヒスイ バクフーンVSTAR": 157,
    "ヒスイ ジュナイパーV": 724,
    "ヒスイ ジュナイパーVSTAR": 724,
    "ヒスイ ダイケンキV": 503,
    "ヒスイ ダイケンキVSTAR": 503,
    "ブラックキュレムex": 646,
    "アローラ ナッシーex": 103,
    "かがやくリザードン": 6,
    "かがやくゲッコウガ": 658,
    "かがやくフーディン": 65,
    "パルデア ドオーex": 980,
    "オーガポン みどりのめんex": 1017,
    "オーガポン かまどのめんex": 1017,
    "オーガポン いどのめんex": 1017,
    "オーガポン いしずえのめんex": 1017,
    "ガチグマ アカツキex": 901,
    "ヒビキのホウオウex": 250,
    "シロナのガブリアスex": 445,
    "ペパーのマフィティフex": 943,
    "ナンジャモのハラバリーex": 939,
    "リーリエのピッピex": 35,
    "Nのゾロアークex": 571,
    "ホップのザシアンex": 888,
    "メガユキノオーex": 460,
}


def norm_name_for_match(name: str) -> str:
    """把卡片名稱清成可以跟圖鑑名稱比對的形式（去掉 ex/V/VMAX 等字尾與符號）。"""
    if not name:
        return ""
    n = name
    # 常見字尾（不分大小寫），由長到短移除
    suffixes = [
        "VMAX", "VSTAR", "ex", "EX", "GX", "V-UNION", "V", "BREAK",
        "LEGEND", "Prime", "LV.X", "Star", "δ", "☆",
    ]
    for suf in sorted(suffixes, key=len, reverse=True):
        if n.endswith(suf):
            n = n[: -len(suf)]
    n = re.sub(r"[\s　]+", "", n)
    n = n.strip("・-")
    return n


def build_name_lookup():
    with open(JA_NAMES_JSON, "r", encoding="utf-8") as f:
        ja_names = json.load(f)  # {"1": "フシギダネ", ...}
    with open(SPECIES_JSON, "r", encoding="utf-8") as f:
        species = json.load(f)

    ja_lookup = {}
    en_lookup = {}
    for sp in species:
        sid = sp["id"]
        ja = ja_names.get(str(sid))
        if ja:
            ja_lookup[norm_name_for_match(ja)] = sid
        en = sp.get("nameEn")
        if en:
            en_lookup[norm_name_for_match(en)] = sid
    return ja_lookup, en_lookup


def load_set_official_counts():
    with open(os.path.join(INDEX_DIR, "sets_summary.json"), "r", encoding="utf-8") as f:
        summary = json.load(f)
    out = {}
    for s in summary:
        out[(s["lang"], s["setId"])] = s
    return out


def load_all_card_refs():
    refs = []
    for lang in ("ja", "en"):
        p = os.path.join(INDEX_DIR, f"{lang}_card_refs.json")
        with open(p, "r", encoding="utf-8") as f:
            refs.extend(json.load(f))
    return refs


def image_urls(raw_image):
    if not raw_image:
        return None, None
    return f"{raw_image}/low.webp", f"{raw_image}/high.webp"


def build_tags(card_raw):
    tags = []
    stage = card_raw.get("stage")
    if stage in VMAX_LIKE_STAGES:
        tags.append(stage)
    suffix = card_raw.get("suffix")
    if suffix and suffix not in tags:
        tags.append(suffix)
    return tags


def main():
    ja_lookup, en_lookup = build_name_lookup()
    set_meta = load_set_official_counts()
    refs = load_all_card_refs()

    cards_out = []
    sets_out = {}
    rarity_counter = Counter()
    unmapped_rarity_counter = Counter()
    missing_rarity_count = 0
    missing_image_count = 0
    per_lang_set_cards = Counter()
    trainer_energy_count = 0
    dex_direct = 0
    dex_fallback = 0
    dex_unresolved = []
    load_errors = []

    for ref in refs:
        lang = ref["lang"]
        card_id = ref["cardId"]
        cache_file = os.path.join(CACHE_DIR, lang, f"{card_id}.json")
        if not os.path.exists(cache_file):
            load_errors.append({"lang": lang, "cardId": card_id, "reason": "no_cache_file"})
            continue
        with open(cache_file, "r", encoding="utf-8") as f:
            raw = json.load(f)

        category = raw.get("category") or "Unknown"
        rarity = raw.get("rarity")
        rarity_unknown = False
        if not rarity or rarity == "None":
            rarity = None
            rarity_unknown = True
            missing_rarity_count += 1

        app_category = None
        if rarity:
            app_category = RARITY_TO_CATEGORY.get(rarity)
            if app_category is None:
                unmapped_rarity_counter[rarity] += 1
            rarity_counter[rarity] += 1

        dex_numbers = []
        dex_resolution = "not_applicable"
        if category == "Pokemon":
            raw_dex = raw.get("dexId") or []
            if raw_dex:
                dex_numbers = raw_dex
                dex_resolution = "direct"
                dex_direct += 1
            else:
                trainer_energy_count += 0
                raw_name = raw.get("name", "")
                name_key = norm_name_for_match(raw_name)
                lookup = ja_lookup if lang == "ja" else en_lookup
                sid = lookup.get(name_key) or NAME_ALIAS_OVERRIDES.get(raw_name)
                if sid:
                    dex_numbers = [sid]
                    dex_resolution = "name_fallback"
                    dex_fallback += 1
                else:
                    dex_resolution = "unresolved"
                    dex_unresolved.append({
                        "lang": lang, "cardId": card_id, "name": raw.get("name"),
                        "setId": ref["setId"], "setName": ref["setName"],
                    })
        else:
            trainer_energy_count += 1

        raw_image = raw.get("image")
        if not raw_image:
            missing_image_count += 1

        # 精簡卡片本身欄位：卡包／系列名稱、發售日、印刷總張數這些「同一卡包共用」
        # 的資訊改放進 sets.json 用 `${language}:${setId}` 查表，避免每張卡都重複
        # 存一份系列/卡包全名字串，大幅縮小 cards.json 體積。
        # 注意：這裡刻意不寫入 categoryId。App 在載入時會用「稀有度 -> 收藏分類」
        # 對照表（存在 IndexedDB、預設值見 js/categories.js）即時算出分類，
        # 使用者在設定頁調整對照表就能立刻反映，不需要重新匯入整個卡片資料庫。
        card_out = {
            "id": f"tcgdex:{lang}:{card_id}",
            "sourceId": card_id,
            "language": lang,
            "name": raw.get("name"),
            "cardType": category,
            "setId": ref["setId"],
            "cardNumber": raw.get("localId", ref["localId"]),
            "originalRarity": rarity,
            "tags": build_tags(raw),
            "image": raw_image,
            "dexNumbers": dex_numbers,
            "illustrator": raw.get("illustrator"),
            "isSample": False,
        }
        cards_out.append(card_out)
        per_lang_set_cards[lang] += 1

        set_key = f"{lang}:{ref['setId']}"
        if set_key not in sets_out:
            set_info = set_meta.get((lang, ref["setId"]), {})
            sets_out[set_key] = {
                "setId": ref["setId"],
                "setName": ref["setName"],
                "seriesId": ref["seriesId"],
                "seriesName": ref["seriesName"],
                "releaseDate": ref.get("setReleaseDate"),
                "printedTotal": set_info.get("metaOfficialCount"),
                "language": lang,
            }

    with open(os.path.join(DATA_DIR, "cards_v2.json"), "w", encoding="utf-8") as f:
        json.dump(cards_out, f, ensure_ascii=False, separators=(",", ":"))
    with open(os.path.join(DATA_DIR, "sets_v2.json"), "w", encoding="utf-8") as f:
        json.dump(sets_out, f, ensure_ascii=False, separators=(",", ":"))

    report = {
        "totalCards": len(cards_out),
        "perLanguage": dict(per_lang_set_cards),
        "trainerEnergyOtherCount": trainer_energy_count,
        "pokemonDexDirect": dex_direct,
        "pokemonDexNameFallback": dex_fallback,
        "pokemonDexUnresolvedCount": len(dex_unresolved),
        "missingRarityCount": missing_rarity_count,
        "missingImageCount": missing_image_count,
        "rarityCounts": dict(rarity_counter.most_common()),
        "unmappedRarityCounts": dict(unmapped_rarity_counter.most_common()),
        "loadErrors": load_errors,
    }
    with open(os.path.join(LOG_DIR, "aggregate_report.json"), "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=1)
    with open(os.path.join(LOG_DIR, "unresolved_pokemon_cards.json"), "w", encoding="utf-8") as f:
        json.dump(dex_unresolved, f, ensure_ascii=False, indent=1)

    # 給 js/categories.js 用的「稀有度 -> 分類」對照表原始資料（含各稀有度張數，方便人工覆核)
    app_category_report = defaultdict(lambda: defaultdict(int))
    for rarity_str, cnt in rarity_counter.items():
        cat = RARITY_TO_CATEGORY.get(rarity_str, "OTHER")
        app_category_report[cat][rarity_str] = cnt
    with open(os.path.join(LOG_DIR, "rarity_to_category_mapping.json"), "w", encoding="utf-8") as f:
        json.dump({k: dict(v) for k, v in app_category_report.items()}, f, ensure_ascii=False, indent=1)

    print(json.dumps({
        "totalCards": report["totalCards"],
        "missingRarityCount": report["missingRarityCount"],
        "missingImageCount": report["missingImageCount"],
        "dexUnresolved": report["pokemonDexUnresolvedCount"],
        "unmappedRarityKinds": len(report["unmappedRarityCounts"]),
        "loadErrors": len(load_errors),
    }))


if __name__ == "__main__":
    main()
