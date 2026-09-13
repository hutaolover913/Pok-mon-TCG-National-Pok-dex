"""
Step 9：針對 TCGdex 資料庫本身完全沒有圖片網址的英文卡片，嘗試從
LimitlessTCG（limitlesstcg.com）補圖。

為什麼選 LimitlessTCG、為什麼不用其他三個使用者提供的來源，見
data/pipeline/README.md「圖片備援來源評估」一節，簡述：
- Pokéllector 的 Terms of Use 明文禁止自動化存取（含圖片），不使用。
- pokemon-card.com 是官方任天堂/寶可夢公司網站，官方素材另有版權考量，
  這裡只當作人工核對連結，不自動下載。
- Scrydex 是付費 API（最低 $29/月，無免費額度），沒有取得使用者付費授權
  前不會訂閱使用。
- LimitlessTCG 的 robots.txt 完全開放（Disallow: 空白），沒有找到禁止
  自動化存取的聲明，卡圖走公開、免驗證的 CDN。仍然只處理「這批已知缺圖
  的卡片」，不是對整站做大規模爬蟲。

**不是用猜的**：每張卡片是先組出候選的 LimitlessTCG 卡片頁面網址（卡包代碼
是實測核對過的固定對照表，卡號只是去掉補零，不是憑空編出圖片檔名），
真的抓那個頁面下來，比對頁面上顯示的寶可夢名稱是否跟我們資料庫記錄的名稱
一致，一致才會抓頁面裡實際出現的圖片網址來下載；頁面 404、或名稱對不起來，
一律放棄、記錄原因，不會硬套一張圖。

節流：單執行緒、每個請求間至少間隔 0.6 秒，逾時 15 秒、失敗重試 3 次。
"""
import html as html_module
import io
import json
import os
import re
import time
import unicodedata
import requests
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.dirname(HERE)
PROJECT_DIR = os.path.dirname(DATA_DIR)

MANIFEST_PATH = os.path.join(HERE, "logs", "image_manifest.json")
FALLBACK_LOG_PATH = os.path.join(HERE, "logs", "limitless_fallback_log.json")

# TCGdex setId -> 已實測核對過的 LimitlessTCG 卡包代碼。
# 只列有把握的；沒有把握（例如猜不到編號規則、或該產品 Limitless 沒收錄）
# 的一律不放進來，寧可跳過不猜。
SET_MAP = {
    "swsh4.5sv": "SHF",   # Shining Fates Shiny Vault -> 併入 Shining Fates 主集
    "mep": "MEP",          # Mega Evolution Promos
    "swsh12.5gg": "CRZ",   # Crown Zenith Galarian Gallery -> 併入 Crown Zenith 主集
    "svp": "SVP",           # Scarlet & Violet Promos
    "swsh9tg": "BRS",        # Brilliant Stars Trainer Gallery -> 併入主集
    "swsh10tg": "ASR",        # Astral Radiance Trainer Gallery
    "swsh11tg": "LOR",         # Lost Origin Trainer Gallery
    "swsh12tg": "SIT",          # Silver Tempest Trainer Gallery
    "cel25cc": "CEL",             # Celebrations Classic Collection -> 併入 Celebrations 主集
    "sve": "SVE",                  # Scarlet & Violet Energy
    "mee": "MEE",                   # Mega Evolution Energy
    "cel25": "CEL",                  # Celebrations 主集
}
# 已實測確認「Limitless 沒有這個產品／猜不到編號規則，不處理」：
KNOWN_UNAVAILABLE_SETS = {"mfb": "My First Battle 這個產品 Limitless 沒有收錄",
                           "swshp": "SWSH 一般促銷卡的編號規則無法從公開頁面確認，不猜"}

session = requests.Session()
session.headers.update({"User-Agent": "pokemon-ptcg-dex-personal-project/1.0 (verifying missing card images, low volume)"})

REQUEST_INTERVAL = 0.6
TIMEOUT = 15
MAX_RETRIES = 3


def norm_number(card_number):
    """'SV001' -> 'SV1'，'CC002' -> 'CC2'，'085' -> '85'。保留字母前綴，數字去掉前導 0。"""
    m = re.match(r"^([A-Za-z]*)(\d+)$", card_number)
    if not m:
        return card_number
    prefix, digits = m.groups()
    return f"{prefix}{int(digits)}"


def norm_name_for_compare(name):
    name = unicodedata.normalize("NFKD", name)
    name = re.sub(r"[^a-zA-Z0-9]", "", name).lower()
    return name


# 手動核對過的例外：卡片名稱含「☆」符號時，TCGdex 保留原始符號，但 LimitlessTCG
# 頁面標題把它拼成英文單字「Star」，自動比對抓不到，逐一人工核對後在這裡列出
# （見對話紀錄核對過程：https://limitlesstcg.com/cards/CEL/CC15 頁面內容
# 確認是同一張 Umbreon ☆ / Gold Star Umbreon 的 Celebrations 復刻版）。
MANUAL_NAME_OVERRIDES = {
    "tcgdex:en:cel25cc-CC015": "Umbreon Star",
}


def polite_get(url):
    last_err = None
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            time.sleep(REQUEST_INTERVAL)
            resp = session.get(url, timeout=TIMEOUT)
        except requests.RequestException as e:
            last_err = f"request_exception:{e}"
            time.sleep(1.5 * attempt)
            continue
        if resp.status_code == 404:
            return None, 404, "http_404"
        if resp.status_code == 429:
            retry_after = resp.headers.get("Retry-After")
            wait = float(retry_after) if retry_after and retry_after.isdigit() else 5 * attempt
            time.sleep(min(wait, 30))
            continue
        if resp.status_code != 200:
            last_err = f"http_{resp.status_code}"
            time.sleep(1.5 * attempt)
            continue
        return resp.text, 200, None
    return None, None, last_err or "unknown"


def extract_card_name_and_image(html):
    # <title>Name - Set (CODE) #Num – Limitless</title>
    # 標題裡的撇號／& 等符號會被 HTML 編碼成 &#039; / &amp;，比對名稱前要先解碼，
    # 不然「Boss's Orders」對 escaped 過的「Boss&#039;s Orders」永遠對不起來。
    # 卡名本身也可能含連字號但兩側沒有空格（例如「Mewtwo-EX」），分隔符一定是
    # 「空格 - 空格」；用 greedy 的 (.+) 才會自然跳過名稱內部沒有空格包住的連字號，
    # 停在最後一個真正的「 - 」分隔符上，不會把 Mewtwo-EX 誤切成 Mewtwo。
    m = re.search(r"<title>(.+) - ([^<]+?)\(([A-Za-z0-9.]+)\)\s*#([A-Za-z0-9]+)", html)
    title_name = html_module.unescape(m.group(1).strip()) if m else None
    # 抓大圖網址（_LG.png），不是抓卡包 logo（_MD.png 那個是卡包標誌，不是卡圖）
    img_matches = re.findall(r'https://limitlesstcg\.nyc3\.cdn\.digitaloceanspaces\.com/tpci/[^"\'\s]+?_LG\.(?:png|jpg|webp)', html)
    image_url = img_matches[0] if img_matches else None
    return title_name, image_url


def is_valid_image(raw_bytes):
    if not raw_bytes or len(raw_bytes) < 200:
        return False
    try:
        Image.open(io.BytesIO(raw_bytes)).verify()
        return True
    except Exception:
        return False


def main():
    with open(os.path.join(DATA_DIR, "cards.json"), "r", encoding="utf-8") as f:
        cards = json.load(f)
    with open(MANIFEST_PATH, "r", encoding="utf-8") as f:
        manifest = json.load(f)

    all_targets = [c for c in cards if c["language"] == "en" and not c.get("image")]

    def already_done(c):
        rec = manifest.get(f"cards:{c['id']}")
        if not rec or rec.get("status") != "success" or rec.get("source") != "limitlesstcg":
            return False
        abs_path = os.path.join(PROJECT_DIR, rec.get("localPath", ""))
        return os.path.exists(abs_path)

    targets = [c for c in all_targets if not already_done(c)]
    print(f"total EN no-source cards: {len(all_targets)}  already_done(skip): {len(all_targets) - len(targets)}  to_process: {len(targets)}")

    results = []
    fetched = 0
    matched_fail = 0
    not_found = 0
    skipped_no_mapping = 0

    for c in targets:
        set_id = c["setId"]
        limitless_code = SET_MAP.get(set_id)
        if not limitless_code:
            reason = KNOWN_UNAVAILABLE_SETS.get(set_id, "set_not_mapped")
            results.append({"cardId": c["id"], "name": c["name"], "setId": set_id, "cardNumber": c["cardNumber"],
                             "status": "skipped", "reason": reason})
            skipped_no_mapping += 1
            continue

        num = norm_number(c["cardNumber"])
        page_url = f"https://limitlesstcg.com/cards/{limitless_code}/{num}"
        html, status, err = polite_get(page_url)

        if html is None:
            results.append({"cardId": c["id"], "name": c["name"], "setId": set_id, "cardNumber": c["cardNumber"],
                             "status": "not_found", "pageUrl": page_url, "httpStatus": status, "error": err})
            not_found += 1
            continue

        title_name, image_url = extract_card_name_and_image(html)
        expected_name = MANUAL_NAME_OVERRIDES.get(c["id"], c["name"])
        if not title_name or norm_name_for_compare(title_name) != norm_name_for_compare(expected_name):
            results.append({"cardId": c["id"], "name": c["name"], "setId": set_id, "cardNumber": c["cardNumber"],
                             "status": "name_mismatch", "pageUrl": page_url,
                             "pageTitleName": title_name})
            matched_fail += 1
            continue

        if not image_url:
            results.append({"cardId": c["id"], "name": c["name"], "setId": set_id, "cardNumber": c["cardNumber"],
                             "status": "no_image_on_page", "pageUrl": page_url})
            matched_fail += 1
            continue

        try:
            time.sleep(REQUEST_INTERVAL)
            img_resp = session.get(image_url, timeout=TIMEOUT)
            raw = img_resp.content if img_resp.status_code == 200 else None
        except requests.RequestException:
            raw = None

        if not raw or not is_valid_image(raw):
            results.append({"cardId": c["id"], "name": c["name"], "setId": set_id, "cardNumber": c["cardNumber"],
                             "status": "image_download_failed", "pageUrl": page_url, "imageUrl": image_url})
            matched_fail += 1
            continue

        safe_name = c["id"].replace("tcgdex:", "").replace(":", "_").replace("/", "_")
        ext = image_url.rsplit(".", 1)[-1]
        local_rel = f"images/cards/{safe_name}.{ext}"
        local_abs = os.path.join(PROJECT_DIR, local_rel)
        os.makedirs(os.path.dirname(local_abs), exist_ok=True)
        with open(local_abs, "wb") as f:
            f.write(raw)

        manifest[f"cards:{c['id']}"] = {
            "url": image_url, "localPath": local_rel, "status": "success",
            "httpStatus": 200, "byteSize": len(raw), "error": None,
            "source": "limitlesstcg", "sourcePage": page_url,
            "lastAttempt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        }
        results.append({"cardId": c["id"], "name": c["name"], "setId": set_id, "cardNumber": c["cardNumber"],
                         "status": "success", "pageUrl": page_url, "imageUrl": image_url, "localPath": local_rel})
        fetched += 1

        if fetched % 25 == 0:
            with open(MANIFEST_PATH, "w", encoding="utf-8") as f:
                json.dump(manifest, f, ensure_ascii=False)
            print(f"progress: fetched={fetched} not_found={not_found} mismatch/fail={matched_fail} skipped={skipped_no_mapping}", flush=True)

    with open(MANIFEST_PATH, "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False)
    with open(FALLBACK_LOG_PATH, "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, indent=1)

    print(json.dumps({
        "totalTargets": len(targets),
        "fetched": fetched,
        "notFound": not_found,
        "mismatchOrFail": matched_fail,
        "skippedNoMapping": skipped_no_mapping,
    }))


if __name__ == "__main__":
    main()
