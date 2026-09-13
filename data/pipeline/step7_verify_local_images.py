"""
Step 7：驗證本機圖片快取的最終結果，產生「重新下載後」的統計報告，
給人看的摘要格式（不是給程式吃的 manifest 原始格式）。
"""
import json
import os
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.dirname(HERE)
PROJECT_DIR = os.path.dirname(DATA_DIR)
MANIFEST_PATH = os.path.join(HERE, "logs", "image_manifest.json")


def main():
    with open(MANIFEST_PATH, "r", encoding="utf-8") as f:
        manifest = json.load(f)

    species_entries = {k: v for k, v in manifest.items() if k.startswith("species:")}
    card_entries = {k: v for k, v in manifest.items() if k.startswith("cards:")}

    def summarize(entries):
        statuses = Counter(v["status"] for v in entries.values())
        variant_counts = Counter(v.get("variantUsed") for v in entries.values() if v["status"] == "success")
        total_bytes = sum(v.get("byteSize", 0) for v in entries.values() if v["status"] == "success")
        return {
            "total": len(entries),
            "success": statuses.get("success", 0),
            "failed": statuses.get("failed", 0),
            "byVariant": dict(variant_counts),
            "totalBytesDownloaded": total_bytes,
            "totalMB": round(total_bytes / 1024 / 1024, 1),
        }

    # 驗證本機檔案真的存在（manifest 可能有過時紀錄，例如檔案事後被手動刪除）
    def recheck_files(entries):
        missing_on_disk = []
        for k, v in entries.items():
            if v["status"] == "success" and v.get("localPath"):
                abs_path = os.path.join(PROJECT_DIR, v["localPath"])
                if not os.path.exists(abs_path):
                    missing_on_disk.append(k)
        return missing_on_disk

    report = {
        "species": summarize(species_entries),
        "cards": summarize(card_entries),
        "speciesMissingOnDisk": recheck_files(species_entries),
        "cardsMissingOnDisk": recheck_files(card_entries),
    }

    failed_cards_by_error = Counter()
    for v in card_entries.values():
        if v["status"] == "failed":
            failed_cards_by_error[v.get("error")] += 1
    report["cardFailureReasons"] = dict(failed_cards_by_error)

    with open(os.path.join(HERE, "logs", "image_final_report.json"), "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=1)

    print(json.dumps(report, indent=1))


if __name__ == "__main__":
    main()
