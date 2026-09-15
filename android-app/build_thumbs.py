"""產生 App 內建的卡圖縮圖。

    python android-app/build_thumbs.py

-- 為什麼需要這個 ------------------------------------------------------------
cards.json 有 15,846 張卡，但只有 11,782 張（74.4%）在 image 欄位有
assets.tcgdex.net 的網址。其餘 4,064 張的 image 是 null —— 它們是後來從
LimitlessTCG 補圖回來的，只存在本機 images/ 資料夾，官方 CDN 查不到。

所以 App 不能單純「全部走遠端」：那樣有四分之一的卡會永遠顯示佔位圖。
這個腳本把那 4,064 張縮成 245px 的 webp 內建進 App，其餘走遠端加快取。

245px 是刻意挑的 —— 跟 TCGdex 的 low.webp 同一個解析度，所以內建的圖跟
遠端的圖放在一起不會有一張特別糊或特別利。

實測 40 張抽樣：平均 16.4 KB，4,064 張約 65 MB。

-- 寶可夢立繪也要內建 --------------------------------------------------------
圖鑑首頁的立繪原本走 raw.githubusercontent.com，平均 126 KB／張（官方高解析
原圖，完全沒壓縮），首頁一次顯示 60 隻就要抓 7.4 MB，在行動網路上很慢。

縮成 245px webp 之後平均 9.6 KB，1,025 張總共約 9.6 MB，內建進去之後首頁
完全不用連網。立繪在格狀清單裡實際顯示約 140px 寬，245px 綽綽有餘。

輸出：
    android-app/thumbs/cards/      卡圖縮圖
    android-app/thumbs/species/    立繪縮圖
    android-app/app_image_map.json 卡片 ID／圖鑑編號 -> 縮圖相對路徑
"""

import json
import os
import sys

try:
    from PIL import Image
except ImportError:
    raise SystemExit("需要 Pillow：pip install Pillow")

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT_DIR = os.path.join(HERE, "thumbs", "cards")
OUT_SPECIES = os.path.join(HERE, "thumbs", "species")
OUT_MAP = os.path.join(HERE, "app_image_map.json")

WIDTH = 245
QUALITY = 72


def make_thumb(src_path, dst_path, width=WIDTH, quality=QUALITY):
    """縮圖成 webp。透明底的 PNG 先合成白底，避免 WEBP 轉檔時出現黑邊。"""
    im = Image.open(src_path)
    if im.mode in ("RGBA", "LA", "P"):
        im = im.convert("RGBA")
        bg = Image.new("RGBA", im.size, (0, 0, 0, 0))
        bg.alpha_composite(im)
        im = bg
    else:
        im = im.convert("RGB")
    h = max(1, int(im.height * width / im.width))
    im.resize((width, h), Image.LANCZOS).save(dst_path, "WEBP", quality=quality, method=6)


def build_species(local_species):
    """寶可夢立繪縮圖。原圖是 PokeAPI 的官方美術圖，平均 126 KB。"""
    os.makedirs(OUT_SPECIES, exist_ok=True)
    mapping = {}
    total = 0
    missing = []
    for dex, rel in sorted(local_species.items(), key=lambda kv: int(kv[0])):
        src = os.path.join(ROOT, rel)
        if not os.path.exists(src):
            missing.append(dex)
            continue
        name = "%s.webp" % dex
        dst = os.path.join(OUT_SPECIES, name)
        if not os.path.exists(dst):
            try:
                make_thumb(src, dst)
            except Exception as exc:
                missing.append("%s (%s)" % (dex, str(exc)[:40]))
                continue
        mapping[dex] = "images/species/" + name
        total += os.path.getsize(dst)
    return mapping, total, missing


def main():
    with open(os.path.join(ROOT, "data", "cards.json"), encoding="utf-8") as f:
        cards = json.load(f)

    local_map_path = os.path.join(ROOT, "data", "image_local_map.json")
    if not os.path.exists(local_map_path):
        raise SystemExit(
            "找不到 data/image_local_map.json。\n"
            "這個檔案記錄本機 images/ 裡有哪些圖，是這一步的來源。\n"
            "先跑 python data/pipeline/step6_build_image_map.py 重建。"
        )
    with open(local_map_path, encoding="utf-8") as f:
        local_map = json.load(f)
    local_cards = local_map.get("cards", {})
    local_species = local_map.get("species", {})

    # 只處理「官方 CDN 沒有」的那些卡。有遠端網址的一律走遠端，不佔 App 體積。
    targets = [c for c in cards if not c.get("image")]
    print("卡表 %d 張，其中 %d 張沒有官方 CDN 網址，需要內建" % (len(cards), len(targets)))

    os.makedirs(OUT_DIR, exist_ok=True)
    mapping = {}
    done = 0
    missing = []
    failed = []
    total_bytes = 0

    for card in targets:
        src = local_cards.get(card["id"])
        if not src:
            missing.append(card["id"])
            continue
        src_path = os.path.join(ROOT, src)
        if not os.path.exists(src_path):
            missing.append(card["id"])
            continue

        # 檔名用卡片 ID，冒號換成底線（Windows 檔名不能有冒號）
        name = card["id"].replace(":", "_") + ".webp"
        dst = os.path.join(OUT_DIR, name)

        if not os.path.exists(dst):
            try:
                im = Image.open(src_path)
                if im.mode not in ("RGB", "RGBA"):
                    im = im.convert("RGBA" if "transparency" in im.info else "RGB")
                if im.mode == "RGBA":
                    im = im.convert("RGB")
                h = max(1, int(im.height * WIDTH / im.width))
                im.resize((WIDTH, h), Image.LANCZOS).save(dst, "WEBP", quality=QUALITY, method=6)
            except Exception as exc:
                failed.append((card["id"], str(exc)[:80]))
                continue

        mapping[card["id"]] = "images/cards/" + name
        total_bytes += os.path.getsize(dst)
        done += 1
        if done % 500 == 0:
            print("  %d/%d  %.1f MB" % (done, len(targets), total_bytes / 1048576.0))

    print()
    print("寶可夢立繪：%d 隻" % len(local_species))
    species_map, species_bytes, species_missing = build_species(local_species)

    with open(OUT_MAP, "w", encoding="utf-8", newline="\n") as f:
        json.dump({"cards": mapping, "species": species_map}, f, ensure_ascii=False)

    print()
    print("卡圖   %5d 張，共 %6.1f MB（平均 %.1f KB）"
          % (done, total_bytes / 1048576.0, total_bytes / done / 1024.0 if done else 0))
    print("立繪   %5d 隻，共 %6.1f MB（平均 %.1f KB）"
          % (len(species_map), species_bytes / 1048576.0,
             species_bytes / len(species_map) / 1024.0 if species_map else 0))
    print("合計                %6.1f MB" % ((total_bytes + species_bytes) / 1048576.0))
    if species_missing:
        print("立繪缺少 %d 隻：%s" % (len(species_missing), species_missing[:5]))
    if missing:
        print("本機找不到原圖：%d 張 —— 這些卡在 App 裡會顯示佔位圖" % len(missing))
        for cid in missing[:10]:
            print("    %s" % cid)
        if len(missing) > 10:
            print("    …另外 %d 張" % (len(missing) - 10))
    if failed:
        print("轉檔失敗：%d 張" % len(failed))
        for cid, why in failed[:10]:
            print("    %s：%s" % (cid, why))

    print()
    print("接著跑：python android-app/build_www.py")

    # 有缺就用非零碼結束，讓問題不會被忽略
    if missing or failed:
        sys.exit(2)


if __name__ == "__main__":
    main()
