"""把共用原始碼組裝成 Android App 用的 www/。

用 Python 而不是 Node 寫，是因為日常改完網頁想更新 App 內容時，
只要有 Python 就能跑；Node 只有在真的要建 APK 時才需要。

    python android-app/build_www.py

-- 這個腳本只做三件事 --------------------------------------------------------
  複製  ：把 App 需要的檔案照原樣搬過去
  省略  ：管理功能的檔案根本不複製（三層鎖定的第一層）
  換樁  ：少數被到處 import 的模組換成空實作，讓 import 解析得到

它**不改寫任何 JS 邏輯**。App 與網頁的差異全部寫在共用原始碼裡，
由 js/appMode.js 的旗標控制，所以兩邊不可能跡飛。

-- 它同時是驗收工具 ----------------------------------------------------------
最後的 verify() 會檢查「管理檔案確實沒進去」「本機圖片對照表確實沒進去」
「meta tag 確實有注入」「沒有人靜態 import 被省略的模組」。
任何一項不過就印出原因並以非零碼結束。
"""

import json
import os
import re
import shutil
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
WWW = os.path.join(HERE, "www")

# --------------------------------------------------------------- 省略清單
#
# 這些是管理／資料整理用的，一般使用者不該有，也不必進 APK。
# 它們只會被 js/routes.js 的 WEB_ROUTES 動態 import，App 版註冊的是
# APP_ROUTES，所以檔案不存在也不會有人發現。
OMIT_JS = {
    "pages/settings.js",     # 管理主控台：新增刪除分類、套用分類修正、RR 歸位、完整匯入
    "pages/exportPage.js",   # 匯出 Excel／Word
    "exporters.js",          # 上面那頁用的產檔邏輯
    "categoryFixes.js",      # 一次性的已確認錯分修正
    "rrRegroup.js",          # RR／RRR 歸位
}

# 這兩個被 detail.js / cardTypes.js 到處 import，不能直接不複製，
# 換成保留 export 名稱的空實作。
STUBS = {
    "components/categoryPicker.js": '''// App 版的樁：分類編輯功能不提供。
//
// 真正的實作在電腦版的 js/components/categoryPicker.js。這裡保留一樣的
// export 名稱，讓 detail.js 與 cardTypes.js 的 import 解析得到。
//
// 就算有人把這個樁換回真的實作，js/db.js 的 tx() 守衛還是會擋下寫入 ——
// 這就是分三層的用意。
export const AUTO_VALUE = "__AUTO__";
export function renderCategoryPicker() { return ""; }
export function bindCategoryPickers() {}
export function hasUndoableAction() { return false; }
export async function undoLastAction() {
  throw new Error("App 版不提供分類編輯功能，請在電腦版圖鑑操作。");
}
''',
    "imageUpload.js": '''// App 版的樁：自訂圖片上傳功能不提供。
//
// 真正的實作在電腦版的 js/imageUpload.js。自訂圖片會寫入 customImages，
// 那是策展資料，App 版不允許修改。
export async function promptUploadImage() {
  throw new Error("App 版不提供自訂圖片功能，請在電腦版圖鑑操作。");
}
export async function removeCustomImage() {
  throw new Error("App 版不提供自訂圖片功能，請在電腦版圖鑑操作。");
}
export async function acceptCandidateImage() {
  throw new Error("App 版不提供自訂圖片功能，請在電腦版圖鑑操作。");
}
''',
}

# --------------------------------------------------------------- 資料白名單
#
# 用白名單而不是萬用字元，是為了讓「哪些資料進 App」這件事明確寫出來。
# data/ 底下還有一堆管線產物與舊版檔案，用 glob 很容易不小心帶進去。
DATA_FILES = [
    "species.json",           # 250 KB  全國圖鑑 1,025 隻
    "cards.json",             # 4.57 MB 卡表 15,846 張
    "sets.json",              # 20 KB   卡包資料
    "regulation_marks.json",  # 401 KB  規則標記
    "migration_map.json",     # 3 KB    卡片 ID 改版對照
]

# 刻意不複製的資料檔，附上理由 —— 這些是最容易手滑帶進去的
DATA_EXCLUDED = {
    "image_local_map.json": "指向本機 images/ 的對照表。App 沒有那個資料夾，"
                            "帶進去會讓每張卡都指到不存在的路徑，全部變佔位圖。"
                            "沒有這個檔案時，程式會自動改用遠端網址加內建縮圖。",
    "image_candidates.json": "候選卡圖是人工核對流程用的，App 版不提供換版本功能。",
    "category_fixes.json": "一次性的分類修正清單，只有電腦版的管理頁會用。",
    "app_id.txt": "啟動器寫的本機識別檔，含這台機器的絕對路徑。",
}

APP_NAV = """
    <a href="#/" data-path="/">
      <span class="nav-icon">\U0001F4D6</span><span>圖鑑</span>
    </a>
    <a href="#/types" data-path="/types" data-also="/sets">
      <span class="nav-icon">\U0001F3F7️</span><span>卡片</span>
    </a>
    <a href="#/collection" data-path="/collection">
      <span class="nav-icon">\U0001F5C2️</span><span>我的收藏</span>
    </a>
    <a href="#/missing" data-path="/missing">
      <span class="nav-icon">\U0001F4CB</span><span>缺卡清單</span>
    </a>
    <a href="#/progress" data-path="/progress">
      <span class="nav-icon">\U0001F4CA</span><span>收藏進度</span>
    </a>
    <a href="#/settings" data-path="/settings">
      <span class="nav-icon">⚙️</span><span>設定</span>
    </a>
"""


def rm_tree(path):
    if os.path.isdir(path):
        shutil.rmtree(path)


def copy_file(rel_src, rel_dst=None):
    src = os.path.join(ROOT, rel_src)
    dst = os.path.join(WWW, rel_dst or rel_src)
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    shutil.copy2(src, dst)
    return os.path.getsize(dst)


def build_js():
    """複製 js/，扣掉省略清單，再把樁寫上去。"""
    total = 0
    copied = 0
    src_root = os.path.join(ROOT, "js")
    for dirpath, _dirnames, filenames in os.walk(src_root):
        for fn in filenames:
            if not fn.endswith(".js"):
                continue
            full = os.path.join(dirpath, fn)
            rel = os.path.relpath(full, src_root).replace("\\", "/")
            if rel in OMIT_JS:
                continue
            total += copy_file("js/" + rel)
            copied += 1

    for rel, body in STUBS.items():
        dst = os.path.join(WWW, "js", rel)
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        with open(dst, "w", encoding="utf-8", newline="\n") as f:
            f.write(body)
        total += os.path.getsize(dst)
    return copied, total


def build_index():
    """注入 meta tag、換掉導覽列、拿掉 manifest link。"""
    with open(os.path.join(ROOT, "index.html"), encoding="utf-8") as f:
        html = f.read()

    # 1. App 模式的標記。根目錄的 index.html 永遠不會有這一行。
    marker = '<meta name="ptcg-app-mode" content="native" />'
    anchor = '<meta name="theme-color"'
    if anchor not in html:
        raise SystemExit("index.html 找不到 theme-color meta，無法注入 app-mode 標記")
    html = html.replace(anchor, marker + "\n  " + anchor, 1)

    # 2. 導覽列。標記註解在瀏覽器是惰性的，所以網頁版渲染結果不受影響。
    pattern = re.compile(r"<!--NAV:WEB-->.*?<!--/NAV:WEB-->", re.S)
    if not pattern.search(html):
        raise SystemExit("index.html 找不到 <!--NAV:WEB--> 標記，請確認沒有被改掉")
    html = pattern.sub(APP_NAV, html)

    # 3. PWA manifest 在原生殼裡沒有作用
    html = re.sub(r'\s*<link rel="manifest"[^>]*>', "", html)

    dst = os.path.join(WWW, "index.html")
    with open(dst, "w", encoding="utf-8", newline="\n") as f:
        f.write(html)
    return os.path.getsize(dst)


def build_data():
    total = 0
    for name in DATA_FILES:
        src = os.path.join(ROOT, "data", name)
        if not os.path.exists(src):
            raise SystemExit("缺少必要的資料檔：data/%s" % name)
        total += copy_file("data/" + name)
    return total


def build_images():
    """複製 build_thumbs.py 產生的內建縮圖。"""
    src = os.path.join(HERE, "thumbs")
    if not os.path.isdir(src):
        print("  ! 找不到 android-app/thumbs/，先跑 python android-app/build_thumbs.py")
        print("    （沒有內建縮圖的話，那 4,064 張沒有遠端來源的卡會顯示佔位圖）")
        return 0, 0

    dst = os.path.join(WWW, "images", "cards")
    shutil.copytree(src, dst, dirs_exist_ok=True)
    total = 0
    count = 0
    for dirpath, _d, files in os.walk(dst):
        for fn in files:
            total += os.path.getsize(os.path.join(dirpath, fn))
            count += 1

    map_src = os.path.join(HERE, "app_image_map.json")
    if os.path.exists(map_src):
        os.makedirs(os.path.join(WWW, "data"), exist_ok=True)
        shutil.copy2(map_src, os.path.join(WWW, "data", "app_image_map.json"))
        total += os.path.getsize(map_src)
    return count, total


def verify():
    """建置完自己檢查一遍。這同時是「管理功能沒進 APK」這一層的迴歸測試。"""
    problems = []

    for rel in OMIT_JS:
        if os.path.exists(os.path.join(WWW, "js", rel)):
            problems.append("管理用檔案被複製進去了：js/%s" % rel)

    for name, why in DATA_EXCLUDED.items():
        if os.path.exists(os.path.join(WWW, "data", name)):
            problems.append("不該出現的資料檔：data/%s —— %s" % (name, why))

    if os.path.isdir(os.path.join(WWW, "vendor")):
        problems.append("vendor/ 被複製進去了（980 KB，只有匯出 Excel／Word 會用到）")

    if os.path.exists(os.path.join(WWW, "sw.js")):
        problems.append("sw.js 被複製進去了（App 版不註冊 Service Worker）")

    index = os.path.join(WWW, "index.html")
    if not os.path.exists(index):
        problems.append("沒有產生 index.html")
    else:
        with open(index, encoding="utf-8") as f:
            html = f.read()
        if 'name="ptcg-app-mode"' not in html:
            problems.append("index.html 缺少 app-mode 標記，App 會以為自己是網頁版")
        if "批量編輯" in html or "新增自訂分類" in html:
            problems.append("index.html 裡出現管理用字串")

    # 樁必須真的是樁
    stub = os.path.join(WWW, "js", "components", "categoryPicker.js")
    if os.path.exists(stub):
        with open(stub, encoding="utf-8") as f:
            body = f.read()
        if "setCategoryOverride" in body:
            problems.append("categoryPicker.js 不是樁，裡面還有真的寫入邏輯")

    # 沒有人可以靜態 import 被省略的模組，否則 App 一開就掛
    omitted_names = {os.path.basename(r) for r in OMIT_JS}
    for dirpath, _d, files in os.walk(os.path.join(WWW, "js")):
        for fn in files:
            if not fn.endswith(".js"):
                continue
            full = os.path.join(dirpath, fn)
            with open(full, encoding="utf-8") as f:
                src = f.read()
            for m in re.finditer(r'^\s*import\s[^;]*?from\s+["\']([^"\']+)["\']', src, re.M):
                target = os.path.basename(m.group(1))
                if target in omitted_names:
                    rel = os.path.relpath(full, WWW).replace("\\", "/")
                    problems.append("%s 靜態 import 了被省略的 %s（App 會開不起來）" % (rel, target))

    # 網頁版必須完全沒被動到
    with open(os.path.join(ROOT, "index.html"), encoding="utf-8") as f:
        if "ptcg-app-mode" in f.read():
            problems.append("根目錄的 index.html 被注入了 app-mode 標記 —— 網頁版會誤判成 App 版")

    return problems


def human(n):
    return "%.2f MB" % (n / 1048576.0) if n >= 1048576 else "%.1f KB" % (n / 1024.0)


def main():
    print("組裝 Android App 的 www/ …")
    print("  來源：%s" % ROOT)
    print("  輸出：%s" % WWW)
    rm_tree(WWW)
    os.makedirs(WWW, exist_ok=True)

    sizes = {}
    js_count, sizes["js"] = build_js()
    sizes["index.html"] = build_index()
    sizes["css"] = copy_file("css/style.css")
    icons = 0
    for fn in os.listdir(os.path.join(ROOT, "icons")):
        if fn.endswith(".png"):
            icons += copy_file("icons/" + fn)
    sizes["icons"] = icons
    sizes["data"] = build_data()
    thumb_count, sizes["images"] = build_images()

    print()
    print("  js/            %5d 個檔案   %s" % (js_count + len(STUBS), human(sizes["js"])))
    print("  css/               1 個檔案   %s" % human(sizes["css"]))
    print("  icons/                        %s" % human(sizes["icons"]))
    print("  data/          %5d 個檔案   %s" % (len(DATA_FILES), human(sizes["data"])))
    print("  images/cards/  %5d 個檔案   %s  （官方 CDN 沒有的內建卡圖）"
          % (thumb_count, human(sizes["images"])))
    print("  index.html                    %s" % human(sizes["index.html"]))
    print("  " + "-" * 46)
    print("  合計                          %s" % human(sum(sizes.values())))
    print()
    print("  省略的管理用檔案：%s" % "、".join(sorted(OMIT_JS)))
    print("  換成空實作的樁：  %s" % "、".join(sorted(STUBS)))
    print()

    problems = verify()
    if problems:
        print("建置檢查沒過：")
        for p in problems:
            print("  X %s" % p)
        sys.exit(1)

    print("建置檢查全部通過。")
    print()
    print("要在桌機先看看 App 版長什麼樣（不需要 Android 工具）：")
    print("    python -m http.server 8899 -d \"%s\"" % WWW)
    print("    然後開 http://localhost:8899")
    print("  用 8899 而不是 8811 是刻意的 —— 不同的埠有各自的 IndexedDB，")
    print("  測試時碰不到你平常在用的收藏資料。")


if __name__ == "__main__":
    main()
