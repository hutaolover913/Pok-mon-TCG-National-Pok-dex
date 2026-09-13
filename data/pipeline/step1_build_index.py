"""
Step 1：建立卡片索引（不含完整卡片內容）。

針對指定的語言／系列（見 TARGET_SCOPE），逐一呼叫
  GET /v2/{lang}/series/{seriesId}
  GET /v2/{lang}/sets/{setId}
取得每個系列底下「實際有卡片資料」的卡包，並列出每張卡片的 id。
明確排除 Pokémon TCG Pocket（tcgp 系列）。
也會記下「metaOfficial 卡數」與「實際回傳的卡片數」不一致的卡包，
方便之後核對是否有資料缺漏（例如 S 系列裡一批 realCardEntries=0 的幽靈卡包）。
"""
import json
import os
from common import fetch_json, API_BASE, INDEX_DIR, log_line

# 掃描範圍：日文（主）S / SV / M 系列（AR/CHR/CSR/SAR/SR/UR 等現代稀有度制度適用的年代）
# 英文（補充）swsh / sv 系列，涵蓋同世代的英文版卡片。
# 明確不含 tcgp（Pokémon TCG Pocket，非實體卡）。
TARGET_SCOPE = {
    "ja": ["S", "SV", "M"],
    "en": ["swsh", "sv", "me"],
}


def build_index_for_lang(lang, series_ids):
    all_sets_summary = []
    card_refs = []  # list of dicts: {lang, seriesId, setId, setName, localId, cardId, briefName, briefImage}
    ghost_sets = []

    for series_id in series_ids:
        series_data, err = fetch_json(f"{API_BASE}/{lang}/series/{series_id}")
        if series_data is None:
            log_line("index_errors.log", f"[{lang}] series {series_id} FAILED: {err}")
            continue

        for s in series_data["sets"]:
            set_id = s["id"]
            set_data, set_err = fetch_json(f"{API_BASE}/{lang}/sets/{set_id}")
            if set_data is None:
                log_line("index_errors.log", f"[{lang}] set {set_id} FAILED: {set_err}")
                continue

            real_cards = set_data.get("cards", [])
            meta_official = s["cardCount"]["official"]

            all_sets_summary.append({
                "lang": lang,
                "seriesId": series_id,
                "seriesName": series_data["name"],
                "setId": set_id,
                "setName": set_data["name"],
                "releaseDate": set_data.get("releaseDate"),
                "metaOfficialCount": meta_official,
                "realCardCount": len(real_cards),
            })

            if len(real_cards) == 0:
                ghost_sets.append({"lang": lang, "setId": set_id, "setName": set_data["name"], "metaOfficialCount": meta_official})
                continue

            for c in real_cards:
                card_refs.append({
                    "lang": lang,
                    "seriesId": series_id,
                    "seriesName": series_data["name"],
                    "setId": set_id,
                    "setName": set_data["name"],
                    "setReleaseDate": set_data.get("releaseDate"),
                    "localId": c["localId"],
                    "cardId": c["id"],
                    "briefName": c.get("name"),
                })

    return all_sets_summary, card_refs, ghost_sets


def main():
    os.makedirs(INDEX_DIR, exist_ok=True)
    full_summary = []
    full_refs = []
    full_ghosts = []

    for lang, series_ids in TARGET_SCOPE.items():
        summary, refs, ghosts = build_index_for_lang(lang, series_ids)
        full_summary.extend(summary)
        full_refs.extend(refs)
        full_ghosts.extend(ghosts)

        with open(os.path.join(INDEX_DIR, f"{lang}_card_refs.json"), "w", encoding="utf-8") as f:
            json.dump(refs, f, ensure_ascii=False)

    with open(os.path.join(INDEX_DIR, "sets_summary.json"), "w", encoding="utf-8") as f:
        json.dump(full_summary, f, ensure_ascii=False, indent=1)
    with open(os.path.join(INDEX_DIR, "ghost_sets.json"), "w", encoding="utf-8") as f:
        json.dump(full_ghosts, f, ensure_ascii=False, indent=1)

    print(f"sets={len(full_summary)} ghost_sets={len(full_ghosts)} total_card_refs={len(full_refs)}")


if __name__ == "__main__":
    main()
