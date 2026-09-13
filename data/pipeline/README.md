# 卡片資料匯入流程（TCGdex）

這個目錄是「App 用卡片資料庫」的產生流程，來源是 [TCGdex](https://tcgdex.dev)
（`api.tcgdex.net`，開放資料、免金鑰）。設計成可重複執行、有本機快取、
失敗會重試，不會每次都整庫重抓。

## 執行方式

需要 Python 3 與 `requests`（`pip install requests`）。依序執行：

```bash
cd data/pipeline
python step0_fetch_ja_species_names.py   # 補日文寶可夢名稱，給 dexId 缺漏時比對用
python step1_build_index.py               # 列出目標系列底下所有「真的有資料」的卡包與卡片 id
python step2_fetch_details.py             # 抓每張卡片的完整資料（含快取、重試）
python step3_aggregate.py                 # 整理成 ../cards.json + ../sets.json，並輸出報告
python step4_migrate_old_ids.py           # 產生「舊卡片 id -> 新卡片 id」遷移對照表
python step5_download_images.py           # 把寶可夢圖片／卡片圖片下載到本機 ../../images/
python step6_build_image_map.py           # 把下載結果整理成 ../image_local_map.json
```

- `step1`／`step2` 重跑時，`cache/{ja,en}/*.json` 已經抓過的卡片不會重抓，只會
  補抓新增的卡包或之前失敗的卡片。要強制整批重抓，刪除 `cache/` 目錄即可。
- `cache/` 目錄本身沒有放進最終交付的專案包（單純是原始 API 回應的本機備份，
  約 70MB、15846 個檔案），重跑 `step1`+`step2` 幾分鐘內就能重建。
- 每一步的輸出（索引、失敗清單、彙整報告）都在 `index/` 和 `logs/`，可以直接
  打開來核對數字，不需要重新執行整套流程。

## 目前的匯入範圍（TARGET_SCOPE，見 step1_build_index.py）

- 日文：`S`（剣と盾／Sword & Shield 世代）、`SV`（スカーレット&バイオレット）、
  `M`（ポケモンカードゲーム MEGA）
- 英文：`swsh`（Sword & Shield）、`sv`（Scarlet & Violet）、`me`（Mega Evolution）
- 明確排除：`tcgp`（Pokémon TCG Pocket，不是實體卡）

要擴大範圍（例如加入日文 `XY`／`SM` 世代，或英文 `xy`／`sm`），修改
`step1_build_index.py` 的 `TARGET_SCOPE` 字典，重跑 step1～step4 即可；
已經抓過的卡片快取仍然有效，只會多抓新加入系列的部分。

## 資料如何對到寶可夢圖鑑編號

優先使用 TCGdex 卡片本身的 `dexId` 欄位。缺漏時，用卡片名稱（去除 ex／V／VMAX
等字尾後）比對 `species.json` 的中日文名稱做 fallback；比對不到的卡片列在
`logs/unresolved_pokemon_cards.json`，不會憑空指定編號。

`step3_aggregate.py` 裡的 `NAME_ALIAS_OVERRIDES` 是針對「地區形態／超級進化／
訓練家聯名卡（OO的△△ex）」這類自動比對規則抓不到的案例，逐一人工核對圖鑑編號
後寫入的別名表（核對方式：用 PokéAPI 的日文名稱資料反查，見對話紀錄），不是
規則猜測。若之後匯入範圍擴大又出現新的漏網案例，一樣會先進 unresolved 清單，
需要人工核對後才加進這個表。

## 稀有度 -> App 分類 對照表

`step3_aggregate.py` 的 `RARITY_TO_CATEGORY` 只根據「這次實測 TCGdex 資料庫
真的出現過的稀有度字串」建立（見 `logs/rarity_to_category_mapping.json`），
沒有出現過的字串不會被塞進對照表用猜的。這份表最終會同步進
`js/categories.js` 的 `DEFAULT_CATEGORIES`，供 App 執行期即時分類使用
（`step3` 產生的 `cards.json` 本身不含分類欄位，分類是 App 用這份對照表即時
算出來的，方便使用者之後自行調整不用重新匯入）。

## 卡片 ID 規則與遷移

卡片 id 格式為 `tcgdex:{language}:{TCGdex 原始 id}`，例如
`tcgdex:ja:SV2a-003`、`tcgdex:en:sv08-247`。`sourceId` 欄位保留 TCGdex 原始
id，方便回頭核對來源。

第一版 App 曾經用 pokemontcg.io 的示範資料（`../cards.legacy-v1.json`，
70 張英文卡），這次換成 TCGdex 後 id 規則不同。`step4_migrate_old_ids.py`
比對「卡包代碼＋卡號」建立 `../migration_map.json`，App 開機時
（`js/main.js` 的 `runCardIdMigration`）會自動把使用者裝置上舊 id 的收藏
紀錄搬到新 id，搬移前會先在 IndexedDB 存一份快照（`db.js` 的
`migrateCardIds`），不會憑空遺失資料。這次 70 張舊卡有 67 張成功對應，
3 張（1999 年 Wizards Promo 一張、Celebrations Classic Collection 兩張因
編號規則不同）目前找不到對應，紀錄仍會保留在資料庫裡，只是不會再顯示於
卡片瀏覽介面。

## 圖片本機快取（step5 / step6）

App 原本直接 hotlink 遠端圖片（寶可夢立繪來自 PokéAPI 的 GitHub sprites，
卡圖來自 TCGdex 的 `assets.tcgdex.net`）。`step5_download_images.py` 把這些
圖片實際下載到專案的 `images/species/` 與 `images/cards/` 資料夾：

- **可續傳**：下載狀態記在 `logs/image_manifest.json`，重跑腳本只會處理
  「還沒成功、或本機檔案不見了」的項目，已經下載好且驗證通過的不會重抓。
  只想重試之前失敗的項目可以加 `--retry-failed-only`。
- **重試策略**：逾時 20 秒、最多重試 4 次、間隔遞增（0.5s/1s/2s/4s + 隨機
  抖動），遇到 HTTP 429 會讀 `Retry-After` 標頭乖乖等待，不會硬打。
- **驗證下載內容**：不是 HTTP 200 就算成功——下載完會用 Pillow 真的把檔案
  打開並呼叫 `verify()`，確認是可解碼的圖片，才會存檔；驗證失敗（例如來源
  回傳的其實是一頁 HTML 錯誤頁）會算失敗、進入重試。
- **檔名穩定且不會碰撞**：物種用全國圖鑑編號（`images/species/25.png`）；
  卡片用完整卡片 id 轉檔名（`images/cards/ja_SV2a-003.webp`），日文版和
  英文版的同名卡片不會互相覆蓋。
- `step6_build_image_map.py` 把 manifest 整理成 `../image_local_map.json`
  （`js/data.js` 載入時會拿這份表覆蓋 `species.imageUrl` / `card.imageSmall`），
  以及 `logs/image_still_failing.json`（目前還是抓不到的項目，含卡片 id／
  物種編號、原始網址、失敗原因，下次重跑 step5 會優先處理這些）。
- 只下載卡片的縮圖（`low.webp`，App 目前唯一會顯示的尺寸），沒有下載
  `high.webp`——`imageLarge` 欄位目前整個 App 都沒有用到，先不佔空間下載。
- `images/` 目錄本身沒有放進最終交付的專案壓縮包（體積較大），要重建的話
  跑 step5 + step6 即可；`image_local_map.json` 有納入交付包，即使沒有
  `images/` 資料夾，App 也會自動退回遠端網址正常運作。
- 實測發現 TCGdex 常有「`low.webp` 回 404，但 `low.png`／`high.webp`／
  `high.png` 其實有圖」的情況（同一來源、只是特定畫質格式沒產生），
  `step5` 會依序嘗試這四種組合，第一個成功驗證的就採用。

## 圖片備援來源評估（step8 / step9）

TCGdex 資料庫本身有 4,064 張卡片完全沒有提供圖片網址（不是下載失敗，是
來源真的沒有這筆資料，見 `logs/no_source_image_cards.json`）。針對其中
**549 張英文卡**，評估了使用者指定的四個備援來源，結果：

| 來源 | 結論 | 原因 |
|---|---|---|
| [LimitlessTCG](https://limitlesstcg.com/cards) | **採用** | `robots.txt` 完全開放（`Disallow:` 空白），找不到禁止自動化存取的聲明；卡圖走公開、免驗證的 CDN。只處理這批已知缺圖的卡片，不是對全站爬蟲。 |
| [Pokéllector](https://www.pokellector.com/) | **不採用（自動化）** | Terms of Use 明文寫「You agree not to use automated means to interact with the data we store... This includes... images」，直接禁止自動化抓取圖片。仍可作為人工核對連結。 |
| [pokemon-card.com](https://www.pokemon-card.com/card-search/) | **不採用（自動化）** | 任天堂／寶可夢公司官方網站，官方素材版權疑慮較高，只作為人工核對連結（原本使用者的建議用途）。 |
| [Scrydex](https://scrydex.com/) | **不採用** | 純付費 API，最低方案 $29/月、無免費額度，未取得使用者付費授權前不會訂閱。 |

`step9_fetch_limitless_fallback.py` 的作法（**不是猜網址**）：
1. 先用實測核對過的卡包代碼對照表（`SET_MAP`，只列有把握的，猜不到編號
   規則的整個系列直接跳過，例如 `mfb`／`swshp`）組出候選的 LimitlessTCG
   卡片「頁面」網址。
2. 真的抓那個頁面下來，比對頁面標題顯示的寶可夢名稱是否跟資料庫記錄的
   名稱一致——名稱對不起來或頁面 404，一律放棄、記錄原因，不會硬套一張圖。
3. 名稱核對通過才抓頁面裡實際出現的卡圖網址下載，一樣要通過 Pillow
   解碼驗證才存檔。
4. 節流：單執行緒、每個請求間隔至少 0.6 秒、逾時 15 秒、失敗重試 3 次，
   遇到 429 讀 `Retry-After` 等待。

成功抓到的圖片會標記 `"source": "limitlesstcg"` 寫進
`logs/image_manifest.json`（跟 TCGdex 來源的紀錄放在同一份 manifest，
用 `source` 欄位區分），並同步進 `image_local_map.json`；完整結果（含
每一筆的頁面網址、核對結果、成功或失敗原因）在
`logs/limitless_fallback_log.json`。

`step8_audit_local_images.py` 是獨立的完整性稽核工具：不相信 manifest
說的話，重新實際打開每個「成功」項目的本機檔案驗證能不能解碼，也交叉
核對 `image_local_map.json` 的 key 跟目前 `cards.json`／`species.json`
的 id 對不對得起來（避免資料改版後路徑對照表跟實際卡片 id 兜不起來）。

## 日文卡片備援（step11）

一開始評估備援來源時，只看了 LimitlessTCG 的英文卡資料庫（`/cards/{code}/...`），
誤以為它不收錄日文卡。後來發現 LimitlessTCG 其實還有一份完整的**日文卡資料庫**
（`limitlesstcg.com/cards/jp/...`），而且 setId 直接沿用跟 TCGdex 一樣的代碼
（`S8`、`SV2a`、`M2a`…），不需要另外建對照表。抽查 5 張（`S8-1`／`SV2a-171`／
`S8b-200`／`M2a-1`，並回頭核對 TCGdex 原始資料確認名稱一致）全部正確對應後，
才用 `step11_fetch_limitless_jp_fallback.py` 對 3,515 張日文缺圖卡片跑同一套
「抓頁面 → 核對名稱 → 抓圖驗證」流程（節流：3 個並行 worker、每個 worker
請求間隔 0.6 秒、逾時 15 秒、失敗重試 3 次，429 一樣讀 `Retry-After` 等待）。
成功的項目標記 `"source": "limitlesstcg_jp"`，結果在
`logs/limitless_jp_fallback_log.json`。

## step14 / step15：候選圖片直接套用與人工覆核清單

`step13_build_candidate_list.py` 原本把 44 張「版本無法核對」的卡片留成候選、
交給使用者在 App 內自己挑。使用者指示「都直接確定貼上」後，新增了兩步：

- **`step14_apply_candidates.py`** — 依規則挑一張直接寫進 `images/cards/` 與
  manifest。挑選規則：(1) 取來源編號最小者；(2) 編號相同時取候選清單第一張。
  每張都會先用 Pillow 實際解碼驗證才複製，並在 manifest 記下
  `source: tcgcollector_package_candidate`、
  `verifiedBy: setName+cardName（版本未能核對；依使用者指示直接套用）`、
  `sha256` 與 `pickReason`，**不會標成完全驗證過的資料**。
  同時把 `appliedPath` / `versionVerified: false` 寫回
  `data/image_candidates.json`，讓 App 能標出「使用中」並提供切換。
  決策紀錄輸出到 `logs/candidate_decisions.json`（含未採用的其他版本）。
  跑完要再跑一次 `step6_build_image_map.py` 重建對照表。

- **`step15_build_word_report.py`** — 輸出
  `PTCG圖鑑_待人工覆核卡片清單.docx`：44 張全部列出，每張附 320px 縮圖、
  卡包、卡號、語言、卡片 ID 與來源連結；有多個版本的 10 張會把所有版本並列
  並標出目前使用中的那一張。縮圖用 JPEG（PNG 會讓檔案從 1.9MB 變成 13.7MB）。

跑完之後卡圖覆蓋率為 **15,846 / 15,846（100%）**，
`step8_audit_local_images.py` 覆核 16,871 筆全部可解碼、無孤兒鍵。
