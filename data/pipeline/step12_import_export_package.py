"""
Step 12：把 exports/missing_images 補圖包中「卡包／卡號已核對」的圖片匯入 App。

這個補圖包不是這條 pipeline 產生的（來源為 tcgcollector.com），所以**不直接相信
報告裡寫的 status**，匯入前一律重新獨立複驗每一張：

1. 來源卡包代碼 == 我們資料庫的 setId
2. 來源印刷卡號（例如 "116/100"）的分子 == 我們的 cardNumber，
   分母 == 我們 sets.json 記錄的 printedTotal
3. 跨語言交叉比對：用我們自己的 dexNumbers 反查 species.json 的英文名，
   確認來源英文標題含有該英文名（例如我們的「シャンデラVMAX」dex=609，
   species 609 英文名 Chandelure，來源標題 "Chandelure VMAX (...)" ✓）。
   訓練家卡／能量卡沒有 dexNumbers，這一項自動跳過，僅靠 1+2。
4. 檔案真的存在、Pillow 能解碼、且 SHA-256 與報告記錄一致（確認檔案沒被動過）

任何一項不過就不匯入，列進 logs/package_import_rejected.json 供人工檢視。

「候選版本需核對」那批（mfb／MC 基本能量／無編號 Jumbo）一律不自動匯入，
改由 step13 產生 App 內的候選圖片清單，讓使用者在卡片詳細頁自己看圖決定。
"""
import hashlib
import io
import json
import os
import re
import shutil

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.dirname(HERE)
PROJECT_DIR = os.path.dirname(DATA_DIR)

PACKAGE_DIR = os.path.join(PROJECT_DIR, "exports", "missing_images")
REPORT_PATH = os.path.join(PACKAGE_DIR, "missing_images_report.json")
MANIFEST_PATH = os.path.join(HERE, "logs", "image_manifest.json")
REJECTED_PATH = os.path.join(HERE, "logs", "package_import_rejected.json")

VERIFIED_STATUS = "卡包／卡號已核對"

# 兩邊對同一個卡包用了不同縮寫時的別名。只列實際核對過的組合：
# swshp（我們，來自 TCGdex）＝ SSP（tcgcollector）＝「Sword & Shield Promos」。
# 走別名的卡片，卡號必須含字母前綴完全一致（SWSH074 這種本身就是全球唯一編號）
# 且卡名完全一致，才會被接受。
SET_CODE_ALIASES = {
    "swshp": "SSP",
}


def sha256_of(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def load_json(path, default=None):
    if not os.path.exists(path):
        return default
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def save_json_atomic(path, data):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)
    os.replace(tmp, path)


def norm(s):
    return re.sub(r"[^a-z0-9]", "", (s or "").lower())


def verify_entry(entry, cand, cards_by_id, sets_meta, species_by_id):
    """回傳 (ok: bool, reason: str)"""
    card = cards_by_id.get(entry["cardId"])
    if not card:
        return False, "card_id_not_in_database"

    # 1. 卡包代碼。少數促銷卡包兩邊的縮寫不同，只允許明確覆核過的別名，
    #    且走別名時下面的卡號比對必須「含字母前綴完全一致」＋卡名一致才算數。
    src_code = norm(cand.get("setCode"))
    our_code = norm(card["setId"])
    used_alias = False
    if src_code != our_code:
        if SET_CODE_ALIASES.get(card["setId"]) == cand.get("setCode"):
            used_alias = True
        else:
            return False, f"set_code_mismatch: source={cand.get('setCode')} ours={card['setId']}"

    # 2. 印刷卡號。來源有三種合法寫法：
    #    "116/100"（卡號/卡包總數）、"003/SV-P"（卡號/卡包代碼）、"085"（促銷卡只印卡號）
    raw_number = str(cand.get("number", "")).strip()
    set_info = sets_meta.get(f"{card['language']}:{card['setId']}", {})
    our_total = set_info.get("printedTotal")
    our_num_digits = "".join(ch for ch in card["cardNumber"] if ch.isdigit())

    m_full = re.match(r"^(\d+)\s*/\s*(\d+)$", raw_number)
    m_setcode = re.match(r"^(\d+)\s*/\s*([A-Za-z0-9\-]+)$", raw_number)
    m_plain = re.match(r"^([A-Za-z]*)(\d+)$", raw_number)

    if m_full:
        src_num, src_total = int(m_full.group(1)), int(m_full.group(2))
        if not our_num_digits or int(our_num_digits) != src_num:
            return False, f"card_number_mismatch: source={src_num} ours={card['cardNumber']}"
        if our_total and src_total != our_total:
            return False, f"printed_total_mismatch: source={src_total} ours={our_total}"
    elif m_setcode:
        src_num, src_set = int(m_setcode.group(1)), m_setcode.group(2)
        if not our_num_digits or int(our_num_digits) != src_num:
            return False, f"card_number_mismatch: source={src_num} ours={card['cardNumber']}"
        if norm(src_set) != our_code and SET_CODE_ALIASES.get(card["setId"]) != src_set:
            return False, f"number_setcode_mismatch: source={src_set} ours={card['setId']}"
    elif m_plain:
        src_prefix, src_digits = m_plain.group(1), int(m_plain.group(2))
        if not our_num_digits or int(our_num_digits) != src_digits:
            return False, f"card_number_mismatch: source={raw_number} ours={card['cardNumber']}"
        our_prefix = "".join(ch for ch in card["cardNumber"] if ch.isalpha())
        if norm(src_prefix) != norm(our_prefix):
            return False, f"card_number_prefix_mismatch: source={raw_number} ours={card['cardNumber']}"
    else:
        return False, f"source_number_not_parseable: {raw_number}"

    # 走別名的卡包，卡號必須含字母前綴完全一致（例如 SWSH074），且卡名一致
    if used_alias:
        if norm(raw_number) != norm(card["cardNumber"]):
            return False, f"alias_requires_exact_number: source={raw_number} ours={card['cardNumber']}"
        if norm(cand.get("title", "")).find(norm(card["name"])) < 0:
            return False, f"alias_requires_exact_name: source={cand.get('title')} ours={card['name']}"

    # 3. 跨語言交叉比對（只在有 dexNumbers 時）
    dex = card.get("dexNumbers") or []
    if dex:
        title = norm(cand.get("title"))
        expected_names = []
        for d in dex:
            sp = species_by_id.get(d)
            if sp and sp.get("nameEn"):
                expected_names.append(norm(sp["nameEn"]))
        if expected_names and not any(en in title for en in expected_names):
            return False, (f"species_name_not_in_source_title: title={cand.get('title')} "
                            f"expected_one_of={[species_by_id[d]['nameEn'] for d in dex if d in species_by_id]}")

    # 4. 檔案完整性
    local_abs = os.path.join(PACKAGE_DIR, cand.get("localPath", ""))
    if not os.path.exists(local_abs):
        return False, f"file_missing: {cand.get('localPath')}"
    try:
        with open(local_abs, "rb") as f:
            raw = f.read()
        Image.open(io.BytesIO(raw)).verify()
    except Exception as e:
        return False, f"not_decodable: {e}"
    if cand.get("sha256") and sha256_of(local_abs) != cand["sha256"]:
        return False, "sha256_mismatch"

    return True, "ok"


def main():
    report = load_json(REPORT_PATH)
    if report is None:
        print("找不到補圖包報告，先確認 exports/missing_images/missing_images_report.json 存在。")
        return

    cards = load_json(os.path.join(DATA_DIR, "cards.json"), [])
    species = load_json(os.path.join(DATA_DIR, "species.json"), [])
    sets_meta = load_json(os.path.join(DATA_DIR, "sets.json"), {})
    manifest = load_json(MANIFEST_PATH, {})

    cards_by_id = {c["id"]: c for c in cards}
    species_by_id = {s["id"]: s for s in species}

    imported = 0
    rejected = []
    skipped_already = 0

    for entry in report:
        if entry.get("status") != VERIFIED_STATUS:
            continue
        cands = entry.get("candidates") or []
        if not cands:
            rejected.append({**{k: entry[k] for k in ("cardId", "name", "setId", "cardNumber")},
                              "reason": "no_candidate_in_package"})
            continue

        cand = cands[0]
        key = f"cards:{entry['cardId']}"
        existing = manifest.get(key)
        if existing and existing.get("status") == "success" and \
                os.path.exists(os.path.join(PROJECT_DIR, existing.get("localPath", ""))):
            skipped_already += 1
            continue

        ok, reason = verify_entry(entry, cand, cards_by_id, sets_meta, species_by_id)
        if not ok:
            rejected.append({**{k: entry[k] for k in ("cardId", "name", "setId", "cardNumber")},
                              "reason": reason,
                              "sourceTitle": cand.get("title"),
                              "sourceUrl": cand.get("sourceUrl")})
            continue

        safe_name = entry["cardId"].replace("tcgdex:", "").replace(":", "_").replace("/", "_")
        ext = os.path.splitext(cand["localPath"])[1].lstrip(".") or "jpg"
        dest_rel = f"images/cards/{safe_name}.{ext}"
        dest_abs = os.path.join(PROJECT_DIR, dest_rel)
        os.makedirs(os.path.dirname(dest_abs), exist_ok=True)
        shutil.copy2(os.path.join(PACKAGE_DIR, cand["localPath"]), dest_abs)

        manifest[key] = {
            "url": cand.get("imageUrl"),
            "localPath": dest_rel,
            "status": "success",
            "httpStatus": 200,
            "byteSize": os.path.getsize(dest_abs),
            "error": None,
            "source": "tcgcollector_package",
            "sourcePage": cand.get("sourceUrl"),
            "verifiedBy": "setCode+printedNumber+speciesNameCrossCheck+sha256",
            "lastAttempt": entry.get("status"),
        }
        imported += 1

    save_json_atomic(MANIFEST_PATH, manifest)
    save_json_atomic(REJECTED_PATH, rejected)

    print(json.dumps({
        "verifiedStatusEntries": sum(1 for e in report if e.get("status") == VERIFIED_STATUS),
        "imported": imported,
        "skippedAlreadyHadImage": skipped_already,
        "rejected": len(rejected),
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
