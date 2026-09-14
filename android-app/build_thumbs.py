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

輸出：
    android-app/thumbs/            縮圖
    android-app/app_image_map.json 卡片 ID -> 縮圖相對路徑
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
OUT_DIR = os.path.join(HERE, "thumbs")
OUT_MAP = os.path.join(HERE, "app_image_map.json")

WIDTH = 245
QUALITY = 72


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
        local_cards = json.load(f).get("cards", {})

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

    with open(OUT_MAP, "w", encoding="utf-8", newline="\n") as f:
        json.dump({"cards": mapping}, f, ensure_ascii=False)

    print()
    print("完成 %d 張，共 %.1f MB（平均 %.1f KB）"
          % (done, total_bytes / 1048576.0, total_bytes / done / 1024.0 if done else 0))
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
