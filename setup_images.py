"""
卡圖自動補齊：偵測本機缺哪些圖片，需要時自動重新下載。

為什麼需要這支程式：`images/` 資料夾約 957 MB、16,900 個檔案，沒有放進
git（見 .gitignore 的說明），所以從 GitHub clone 下來之後本機是沒有圖片的。
這支程式會比對 data/image_local_map.json 與實際磁碟上的檔案，把缺的補回來。

用法：
  * 什麼都不用做 —— 執行 start_app.py（或雙擊「啟動圖鑑.bat」）時會自動檢查，
    缺圖就在背景邊下載邊用，App 本身不會被擋住。
  * 也可以自己單獨跑：python setup_images.py
  * 不想自動下載：在 data/ 底下建立一個空檔案 .no_auto_download

所有下載步驟都是「可續傳」的：中途關掉視窗不會壞掉，下次接著跑就好。
"""
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(HERE, "data")
PIPELINE_DIR = os.path.join(DATA_DIR, "pipeline")
LOCAL_MAP_PATH = os.path.join(DATA_DIR, "image_local_map.json")
CANDIDATES_PATH = os.path.join(DATA_DIR, "image_candidates.json")
CARDS_PATH = os.path.join(DATA_DIR, "cards.json")
SPECIES_PATH = os.path.join(DATA_DIR, "species.json")
IMAGES_DIR = os.path.join(HERE, "images")
OPT_OUT_PATH = os.path.join(DATA_DIR, ".no_auto_download")

# 下載流程。fast=True 的會先跑，因為它們速度快（多執行緒、沒有來源端的
# 禮貌性間隔），跑完 App 就有九成的圖可以看了；剩下的慢速補圖再繼續。
PIPELINE = [
    ("step5_download_images.py", "從 TCGdex／PokéAPI 下載原始圖片", True),
    ("step6_build_image_map.py", "重建本機圖片對照表", True),
    ("step9_fetch_limitless_fallback.py", "英文卡補圖（LimitlessTCG，有禮貌性間隔，較慢）", False),
    ("step11_fetch_limitless_jp_fallback.py", "日文卡補圖（LimitlessTCG，有禮貌性間隔，較慢）", False),
    ("step6_build_image_map.py", "重建本機圖片對照表", False),
]


def opted_out():
    return os.path.exists(OPT_OUT_PATH)


def missing_dependencies():
    """缺套件的話先講清楚，不要讓使用者看到一堆 traceback。"""
    missing = []
    for mod, pip_name in (("requests", "requests"), ("PIL", "Pillow")):
        try:
            __import__(mod)
        except ImportError:
            missing.append(pip_name)
    return missing


def survey():
    """比對「應該有幾張圖」與「磁碟上實際有幾張」。

    刻意**不**拿 data/image_local_map.json 當基準：那個檔案是
    step6 依照目前下載成果重建出來的，下載到一半時它也只會列出已經下載好的
    那些，拿它當分母會得到「0 缺 0」的假象，背景補圖就再也不會繼續。
    真正的分母是 cards.json + species.json，那是隨 App 附帶、不會變動的卡表。

    只檢查檔案存不存在，不重新解碼每一張（那是
    data/pipeline/step8_audit_local_images.py 的工作，會慢很多）。
    """
    def count_json(path):
        if not os.path.exists(path):
            return 0
        with open(path, "r", encoding="utf-8") as f:
            return len(json.load(f))

    expected = count_json(SPECIES_PATH) + count_json(CARDS_PATH)

    present = 0
    for sub in ("species", "cards"):
        d = os.path.join(IMAGES_DIR, sub)
        if os.path.isdir(d):
            present += sum(1 for e in os.scandir(d) if e.is_file())

    # 那 44 張的圖來自使用者自備的補圖包（exports/missing_images），
    # 網路上沒有可自動重抓的途徑。缺了就是缺了，要誠實算成「無法自動補」，
    # 否則每次啟動都會為了這 44 張重跑一次全部下載流程。
    unavailable = 0
    if os.path.exists(CANDIDATES_PATH):
        with open(CANDIDATES_PATH, "r", encoding="utf-8") as f:
            candidates = json.load(f)
        for info in candidates.values():
            applied = info.get("appliedPath")
            if applied and not os.path.exists(os.path.join(HERE, applied.replace("/", os.sep))):
                unavailable += 1

    missing = max(0, expected - present)
    return {
        "expected": expected,
        "present": present,
        "missing": missing,
        "unavailable": unavailable,
        "downloadable": max(0, missing - unavailable),
        "hasData": expected > 0,
    }


def ensure_dirs():
    for d in (os.path.join(HERE, "images", "species"),
              os.path.join(HERE, "images", "cards"),
              os.path.join(PIPELINE_DIR, "logs")):
        os.makedirs(d, exist_ok=True)


def run_step(script, label, echo=print):
    path = os.path.join(PIPELINE_DIR, script)
    if not os.path.exists(path):
        echo(f"  ！找不到 {script}，跳過")
        return False
    echo(f"  ▶ {label}")
    env = dict(os.environ, PYTHONIOENCODING="utf-8", PYTHONUNBUFFERED="1")
    proc = subprocess.Popen(
        [sys.executable, path],
        cwd=PIPELINE_DIR,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
        env=env,
    )
    for line in proc.stdout:
        line = line.rstrip()
        if line:
            echo(f"    {line}")
    proc.wait()
    if proc.returncode != 0:
        echo(f"  ！{script} 結束碼 {proc.returncode}（可以重跑，流程是可續傳的）")
        return False
    return True


def download_missing(echo=print, fast_only=False):
    ensure_dirs()
    steps = [s for s in PIPELINE if s[2]] if fast_only else PIPELINE
    ok = True
    for script, label, _fast in steps:
        if not run_step(script, label, echo):
            ok = False
    after = survey()
    echo(f"  完成：本機圖片 {after['present']}／{after['expected']}"
         f"（仍缺 {after['missing']} 張）")
    if after["unavailable"]:
        echo(f"  註：其中 {after['unavailable']} 張的圖來自自備的補圖包"
             f"（exports/missing_images），無法自動下載，只能手動補或用 App 內的上傳功能。")
    return ok


def describe(state):
    """給啟動器用的一行摘要；沒有可下載的缺圖時回傳 None。"""
    if not state["hasData"]:
        return "找不到 data/cards.json 或 species.json，無法判斷缺哪些圖片。"
    if state["downloadable"] == 0:
        return None
    pct = 100 * state["present"] / state["expected"] if state["expected"] else 0
    line = (f"本機圖片 {state['present']}／{state['expected']}（{pct:.1f}%），"
            f"可自動補下載 {state['downloadable']} 張。")
    if state["unavailable"]:
        line += f"（另有 {state['unavailable']} 張需要自備補圖包，無法自動取得）"
    return line


def main():
    state = survey()
    print("=" * 52)
    print("  卡圖自動補齊")
    print("=" * 52)
    summary = describe(state)
    if summary is None:
        print(f"  本機圖片已齊全（{state['present']}／{state['expected']}），不需要下載。")
        if state["unavailable"]:
            print(f"  （另有 {state['unavailable']} 張需要自備補圖包，無法自動取得）")
        return
    print(f"  {summary}")

    deps = missing_dependencies()
    if deps:
        print(f"  缺少必要套件：{', '.join(deps)}")
        print(f"  請先執行：pip install {' '.join(deps)}")
        return

    print("  開始下載（可續傳，中途關掉不會壞掉）…")
    download_missing()


if __name__ == "__main__":
    main()
