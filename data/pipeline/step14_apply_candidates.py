"""
Step 14：把 step13 整理出來的「待人工核對候選卡圖」直接套用成正式卡圖。

背景：這 44 張卡在 TCGdex 與來源網站之間編號規則不同（或同一張卡在同一個
產品裡有多種印刷版本），沒辦法用機械規則百分之百確認是哪一個版本，所以
step13 原本只把它們列成候選、交給使用者在 App 裡自己挑。使用者明確指示
「都直接確定貼上」，所以這一步依下列規則自動選一張、直接寫進本機圖片
對照表，讓它變成一般卡圖（不經過瀏覽器 IndexedDB，換連接埠或換瀏覽器
都不會消失）。

挑選規則（只在同一張卡有多個候選時才需要）：
  1. 取來源編號最小的那張。實測 My First Battle 四副牌的成對候選，
     編號小的是該牌組限定的藍框（含精靈球標記）版本，編號大的是一般版。
  2. 編號相同時（Potion / Switch 四副牌各一張，只差右下角牌組符號），
     取候選清單第一張（妙蛙種子牌組）。

誠實標註：manifest 會把這些記成 source=tcgcollector_package_candidate，
verifiedBy 明講「卡包與卡名已核對、版本未能核對」，不會混充成已完全驗證的資料。
被放棄的其他候選圖不刪除，仍留在 images/candidates/，隨時可以換。
"""
import hashlib
import json
import os
import re
import shutil
from datetime import datetime, timezone

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.dirname(HERE)
PROJECT_DIR = os.path.dirname(DATA_DIR)
CANDIDATES_PATH = os.path.join(DATA_DIR, "image_candidates.json")
MANIFEST_PATH = os.path.join(HERE, "logs", "image_manifest.json")
CARDS_DIR = os.path.join(PROJECT_DIR, "images", "cards")
DECISIONS_PATH = os.path.join(HERE, "logs", "candidate_decisions.json")


def number_sort_key(cand):
    """來源編號裡的數字，用來挑「編號最小」的那張；抓不到數字就排最後。"""
    m = re.search(r"(\d+)", cand.get("number") or "")
    return int(m.group(1)) if m else 10**9


def pick(cands):
    if len(cands) == 1:
        return cands[0], "唯一候選"
    ordered = sorted(enumerate(cands), key=lambda p: (number_sort_key(p[1]), p[0]))
    best_idx, best = ordered[0]
    others = [c for i, c in enumerate(cands) if i != best_idx]
    if number_sort_key(best) == number_sort_key(others[0]):
        reason = "多副牌同編號（只差牌組符號），取清單第一張"
    else:
        reason = "取來源編號最小者（牌組限定版）"
    return best, reason


def local_name(card_id, src_path):
    """tcgdex:en:mfb-1 + .jpg -> en_mfb-1.jpg，與 step5 既有命名規則一致。"""
    _, lang, rest = card_id.split(":", 2)
    ext = os.path.splitext(src_path)[1].lower() or ".jpg"
    safe = re.sub(r"[^A-Za-z0-9._-]", "_", rest)
    return f"{lang}_{safe}{ext}"


def main():
    with open(CANDIDATES_PATH, "r", encoding="utf-8") as f:
        candidates = json.load(f)
    with open(MANIFEST_PATH, "r", encoding="utf-8") as f:
        manifest = json.load(f)

    os.makedirs(CARDS_DIR, exist_ok=True)
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    decisions = []
    applied = 0
    failed = []

    for card_id, info in candidates.items():
        cands = info.get("candidates") or []
        if not cands:
            failed.append({"cardId": card_id, "reason": "沒有候選圖"})
            continue
        chosen, why = pick(cands)
        src_abs = os.path.join(PROJECT_DIR, chosen["path"].replace("/", os.sep))

        if not os.path.exists(src_abs):
            failed.append({"cardId": card_id, "reason": f"候選檔案不存在：{chosen['path']}"})
            continue
        # 真的能解碼才算數，不能只看副檔名或檔案大小
        try:
            with Image.open(src_abs) as im:
                im.verify()
            with Image.open(src_abs) as im:
                width, height = im.size
        except Exception as exc:
            failed.append({"cardId": card_id, "reason": f"圖片無法解碼：{exc}"})
            continue

        raw = open(src_abs, "rb").read()
        dest_name = local_name(card_id, chosen["path"])
        dest_abs = os.path.join(CARDS_DIR, dest_name)
        rel_path = f"images/cards/{dest_name}"
        shutil.copyfile(src_abs, dest_abs)

        manifest[f"cards:{card_id}"] = {
            "url": chosen.get("sourceUrl"),
            "localPath": rel_path,
            "status": "success",
            "httpStatus": None,
            "byteSize": len(raw),
            "error": None,
            "attempts": 1,
            "lastAttempt": now,
            "source": "tcgcollector_package_candidate",
            "verifiedBy": "setName+cardName（版本未能核對；依使用者指示直接套用）",
            "sha256": hashlib.sha256(raw).hexdigest(),
            "pickReason": why,
        }
        applied += 1
        decisions.append({
            "cardId": card_id,
            "chosen": {
                "path": chosen["path"],
                "number": chosen.get("number"),
                "setName": chosen.get("setName"),
                "title": chosen.get("title"),
                "sourceUrl": chosen.get("sourceUrl"),
                "pixels": f"{width}x{height}",
            },
            "pickReason": why,
            "alternatesNotUsed": [
                {"path": c["path"], "number": c.get("number"), "setName": c.get("setName")}
                for c in cands if c["path"] != chosen["path"]
            ],
            "versionVerified": False,
            "note": info.get("note"),
        })

    # 把「這張卡最後採用了哪個候選」寫回候選清單，App 才能在詳細頁標出目前
    # 用的是哪一版，並且讓有多個版本的卡片可以一鍵換成另一版。
    for d in decisions:
        entry = candidates.get(d["cardId"])
        if entry is None:
            continue
        entry["appliedPath"] = d["chosen"]["path"]
        entry["pickReason"] = d["pickReason"]
        entry["versionVerified"] = False
        # step13 當初的說明是「列出全部候選、不擅自指定版本」，現在已經直接
        # 套用了，說明文字要跟著改，不然 App 上會顯示與實際行為相反的敘述。
        entry.setdefault("sourceNote", entry.get("note", ""))
        if d["alternatesNotUsed"]:
            entry["note"] = (
                f"TCGdex 只有一筆資料，但來源在同一個產品裡有多個印刷版本。"
                f"已先套用其中一版（{d['pickReason']}）；卡包與卡名核對過，"
                f"版本未核對。看圖確認後可以按「改用這張」換成其他版本。"
            )
        else:
            entry["note"] = (
                "TCGdex 與來源網站編號規則不同，無法機械式確認版本。"
                "已直接套用來源唯一的那張；卡包與卡名核對過，版本未核對。"
            )
    with open(CANDIDATES_PATH, "w", encoding="utf-8") as f:
        json.dump(candidates, f, ensure_ascii=False, indent=1)

    with open(MANIFEST_PATH, "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=1)
    with open(DECISIONS_PATH, "w", encoding="utf-8") as f:
        json.dump(decisions, f, ensure_ascii=False, indent=1)

    print(json.dumps({
        "candidateCards": len(candidates),
        "applied": applied,
        "failed": len(failed),
        "failures": failed,
        "withAlternates": sum(1 for d in decisions if d["alternatesNotUsed"]),
    }, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
