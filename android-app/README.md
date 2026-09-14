# Android App 版

寶可夢 PTCG 全圖鑑收藏的 Android 版本。**收藏專用** —— 可以瀏覽、搜尋、篩選、
記錄收藏，但不能修改卡片資料或分類。卡片分類、匯入匯出、資料整理一律留在電腦版。

---

## 現在可以做什麼（不需要安裝任何東西）

```bash
python android-app/build_thumbs.py   # 只需跑一次，產生內建卡圖（約 10 分鐘）
python android-app/build_www.py      # 組裝 www/（約 30 秒）
python android-app/preview.py        # 在瀏覽器預覽，開 http://localhost:8899
```

預覽出來的介面與鎖定行為，和裝進手機之後完全一樣。

**為什麼是 8899 而不是 8811**：瀏覽器的 IndexedDB 依網址（含連接埠）分開存放。
用不同的埠預覽，怎麼點收藏、怎麼測清除，都碰不到你平常在 8811 用的真實收藏。

---

## 要真的做出 APK，你需要先安裝

| 安裝項目 | 大小 | 建議位置 |
|---|---|---|
| Node.js 20 LTS | 約 100 MB | 預設 |
| Android Studio | 約 4 GB | C: |
| Android SDK（Platform 35 + Build-Tools + Platform-Tools） | 約 8 GB | **`D:\Android\Sdk`** |

⚠️ **不要沿用 `C:\Program Files (x86)\Android\android-sdk`。** 它缺 platform-tools
與 build-tools，而且位在 Program Files 底下，sdkmanager 與 Gradle 需要提權才能
寫入，會用很難懂的方式失敗。在 Android Studio 裡指定一個全新的 `D:\Android\Sdk`。

建議也設 `GRADLE_USER_HOME=D:\gradle`，把 Gradle 的快取放到 D:（會長到 3–5 GB）。

Android Studio 自帶 JDK，所以不需要另外處理 PyCharm 附的那兩個。

裝完之後：

```bash
cd android-app
npm install
python build_www.py
npx cap add android
npx cap sync
npx cap run android          # 接上手機或開模擬器
```

之後日常只要 `python build_www.py && npx cap sync`，改網頁程式碼不必碰 npm。

### 建置產出

| 檔案 | 路徑 |
|---|---|
| 測試用 APK | `android/app/build/outputs/apk/debug/app-debug.apk` |
| 上架用 AAB | `android/app/build/outputs/bundle/release/app-release.aab` |
| 側載用 APK | `android/app/build/outputs/apk/release/app-release.apk` |

簽章金鑰請產在這個 repo **外面**（例如 `D:\keys\`），並另外備份。
金鑰弄丟就再也無法更新同一個 App。`keystore.properties` 已在 `.gitignore` 裡。

---

## 架構：一份原始碼，兩種模式

App 版**不是**網頁版的複本。兩邊共用 `js/` 底下同一份程式碼，差異全部由
`js/appMode.js` 的旗標控制，所以不會出現「改了網頁版忘了改 App 版」。

`build_www.py` 只做三件事：**複製、省略、換樁**。它不改寫任何 JS 邏輯。

App 模式的判定有兩個獨立訊號，任一成立即可：

1. `Capacitor.isNativePlatform()` —— 只有原生殼層會有
2. `<meta name="ptcg-app-mode" content="native">` —— 由 `build_www.py` 注入 `www/index.html`

根目錄的 `index.html` **永遠不會有那個 meta tag**，所以網頁版一定是 `false`，
所有 App 專用的分支對它都是 no-op。可以這樣驗證：

```bash
grep -c 'ptcg-app-mode' index.html      # 必須是 0
```

---

## 三層鎖定

一般使用者不能改分類或卡片主資料。這不是把按鈕藏起來，是三層各自獨立的阻擋：

### 第一層：檔案不進 APK

`build_www.py` 不複製 `pages/settings.js`、`pages/exportPage.js`、`exporters.js`、
`categoryFixes.js`、`rrRegroup.js`、`vendor/`、`sw.js`，也不複製
`data/image_local_map.json`、`image_candidates.json`、`category_fixes.json`。

`components/categoryPicker.js` 與 `imageUpload.js` 被換成保留 export 名稱的空實作。

### 第二層：路由不註冊

`js/routes.js` 的 `APP_ROUTES` 沒有 `/export`，`/settings` 指向一般設定而非管理
主控台。手動在網址列輸入 `#/export` 會得到「這個畫面在 App 版沒有提供」。

這一層需要動態 `import()` 才成立 —— 原本 `main.js` 是靜態 import 全部頁面模組，
少一個檔案整個 App 就開不起來。

### 第三層：資料層守衛

`js/db.js` 的 `tx()` 是全專案唯一開啟 IndexedDB 交易的地方，19 個寫入點都走它。
守在那裡等於一次擋掉全部 11 個策展寫入函式，連以後新增的也自動涵蓋。

被擋的 store：`categories`、`cardCategoryOverrides`、`cardFieldOverrides`、
`customImages`。
照常可寫：`cardOwnership`、`manualFlags`、`meta`。

自己驗證（App 的 DevTools console）：

```js
const db = await import('/js/db.js');
await db.setCategoryOverride('tcgdex:ja:S12a-205','SAR');
//  CurationPermissionError  code: E_CURATION_READONLY
await db.setOwnership({cardId:'tcgdex:ja:S12a-205',speciesIds:[15],categoryId:'SAR',count:1,note:''});
//  成功
```

**誠實說明它擋不住什麼**：這不是沙箱。任何人在自己的裝置上用 DevTools 直接
`indexedDB.open("pokecard-dex")` 仍然可以繞過去 —— 所有用 web 技術做的 App
都有這個限制。由於資料是裝置本機、單一使用者、沒有後端，這個程度是相稱的。
它要擋的是 App 自身的所有程式路徑、被換掉的樁、以及從 console 呼叫模組 API。

---

## 卡圖策略

15,846 張卡裡，只有 **11,782 張（74.4%）** 在 `cards.json` 有官方 CDN 網址；
其餘 **4,064 張的 `image` 是 `null`**，它們是後來從 LimitlessTCG 補回來的，
只存在本機。

所以不能單純「全部走遠端」—— 那樣會有四分之一的卡永遠顯示佔位圖。採混合：

| 來源 | 張數 | 做法 |
|---|---|---|
| 官方 CDN | 11,782 | 遠端載入，`js/imageCache.js` 以 LRU 快取到手機 |
| 只有本機 | 4,064 | `build_thumbs.py` 縮成 245px webp 內建（64.4 MB） |

245px 是刻意挑的 —— 與 TCGdex 的 `low.webp` 同解析度，兩種來源的圖放在一起
不會有一張特別糊。

App 總大小約 **70 MB**。

---

## 管理用詞

`js/appLabels.js` 只換**顯示出來的文字**，分類 id、卡片歸屬、資料庫內容一律不動。
覆寫套在來源（`getCategoryDef`、`getAllCategories`、`getSeriesDisplay`、`markLabel`），
不是逐個渲染點去改。

| 網頁版 | App 版 |
|---|---|
| 待確認 | 其他／未分類 |
| 系列待確認 | 其他系列 |
| 發售日期待確認 | 發售日期未提供 |
| 待確認（規則標記） | 未標示 |
| 手動指定、樣本資料、各種信心標籤 | 不顯示 |

「待確認」底下的 2,640 張卡在 App 裡照樣看得到、篩得到，只是名字不一樣。

---

## 收藏資料

**存在手機本機，不會自動同步。** 這個專案沒有後端，也沒有帳號。

⚠️ **電腦版的收藏不會自動出現在 App 裡。** Capacitor 用 `https://localhost`，
電腦版是 `http://localhost:8811`，對瀏覽器來說是兩個不同的網站，IndexedDB 不互通。
這無法規避。要搬資料只能：電腦版「匯出 JSON 備份」→ 傳到手機 →
App 的「一般設定 > 匯入收藏備份」。

App 的備份**只含收藏**（`manualFlags` + `cardOwnership`），不含分類定義與逐張
分類覆寫。匯入電腦版的完整備份時，那些欄位會被忽略。

---

## 檔案

| 檔案 | 用途 |
|---|---|
| `build_thumbs.py` | 產生 4,064 張內建卡圖（跑一次） |
| `build_www.py` | 組裝 `www/`，並自我檢查鎖定有沒有生效 |
| `preview.py` | 桌機預覽（8899 埠，程式碼不快取） |
| `capacitor.config.json` | appId `tw.shinfu.ptcgdex`、名稱「PTCG圖鑑」 |
| `www/`、`thumbs/`、`android/` | 產生物，不進 git |

`build_www.py` 最後會自己檢查：管理檔案有沒有混進去、`image_local_map.json`
有沒有混進去、meta tag 有沒有注入、有沒有人靜態 import 被省略的模組。
任何一項不過就以非零碼結束 —— 它同時是第一層鎖定的迴歸測試。
