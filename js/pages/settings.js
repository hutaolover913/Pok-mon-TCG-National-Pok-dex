import {
  getAllCategories,
  saveCategory,
  invalidateCategoryCache,
  exportAllData,
  importAllData,
  clearAllCollectionData,
  getSetting,
  setSetting,
  getStorageStatus,
  bulkSetCategoryOverride,
  bulkRestoreCategoryOverrides
} from "../db.js";
import { escapeHtml, showToast } from "../utils.js";
import { previewCategoryFixes, applyCategoryFixes } from "../categoryFixes.js";
import { previewRrRegroup, applyRrRegroup } from "../rrRegroup.js";
import { applyCategoryOverrides } from "../data.js";
import { downloadBlob } from "../exporters.js";
import { applyTheme } from "../theme.js";

export async function renderSettings() {
  const app = document.getElementById("app");
  const categories = await getAllCategories();
  const theme = await getSetting("theme", "system");

  app.innerHTML = `
    <header class="page-header">
      <h1>設定</h1>
    </header>

    <section class="settings-section">
      <h2>外觀</h2>
      <div class="theme-switch">
        ${["system", "light", "dark"]
          .map(
            (t) => `<button class="theme-btn ${theme === t ? "active" : ""}" data-theme="${t}">${
              { system: "跟隨系統", light: "淺色", dark: "深色" }[t]
            }</button>`
          )
          .join("")}
      </div>
    </section>

    <section class="settings-section">
      <h2>資料收錄範圍與來源說明</h2>
      <div class="info-box">
        <p><strong>全國圖鑑資料</strong>：來自 PokéAPI（pokeapi.co）公開資料，屬開放資料、免金鑰。內含全國圖鑑編號、繁體中文與英文名稱、世代、傳說／幻獸標記。目前收錄第 1–9 世代、共 1025 隻寶可夢（不含地區形態、超級進化等變體，這些會歸在對應本體寶可夢下管理，不會另計圖鑑編號）。</p>
        <p><strong>PTCG 卡片資料</strong>：來自 <a href="https://tcgdex.dev" target="_blank" rel="noopener">TCGdex</a>（tcgdex.dev，開放資料、免金鑰）。實際匯入範圍為日文版「剣と盾」「スカーレット&バイオレット」「ポケモンカードゲーム MEGA」系列，以及英文版「Sword &amp; Shield」「Scarlet &amp; Violet」「Mega Evolution」系列，共 <strong>15,846 張卡片</strong>（日文 7,397 張、英文 8,449 張），明確排除 Pokémon TCG Pocket。每張卡片保留來源的卡包、卡號、原始稀有度（TCGdex 資料庫用語，非卡面印刷文字）與圖鑑編號，AR／SAR 分類日文英文皆有收錄，CHR／CSR 目前僅見於日文版（VMAX クライマックス等）。這仍<strong>不是官方歷年全卡表</strong>：TCGdex 本身日文卡片文字資料完整度約 71%（詳見 tcgdex.dev/status），因此約 2,354 張日文卡片會顯示「稀有度資料尚未提供」。完整匯入報告見專案內 <code>data/pipeline/logs/</code>。</p>
        <p><strong>圖片</strong>：寶可夢立繪與卡圖已下載到本機（<code>images/</code> 資料夾），不再即時 hotlink 遠端網址。目前 <strong>15,662 / 15,846 張卡片（98.8%）與全部 1,025 張寶可夢立繪都有圖片</strong>。來源分別是：TCGdex 11,782 張、<a href="https://limitlesstcg.com" target="_blank" rel="noopener">LimitlessTCG</a> 補回 3,880 張（英文 474、日文 3,406）。所有從 LimitlessTCG 補的圖，都是先抓該卡的頁面、比對頁面上顯示的卡名與卡包／卡號一致才採用，不是用名稱亂猜；全部圖片也都經過解碼驗證。</p>
        <p>另外從 <code>exports/missing_images</code> 補圖包（來源 tcgcollector.com）再匯入 <strong>139 張</strong>：匯入前每張都重新獨立複驗過卡包代碼、印刷卡號、以及「用圖鑑編號反查英文名是否出現在來源標題」的跨語言比對，還會核對檔案 SHA-256，全部通過才採用。</p>
        <p>剩下的 <strong>36 張卡片</strong>（My First Battle 34 張、SVP Jumbo 1 張、MEP 1 張）在兩個資料庫之間編號規則不同，無法機械式確認是同一個版本。（原本是 44 張，其中 8 張 MC 基本能量後來在 LimitlessTCG 找到單字母編號的對應卡頁，已改由可驗證來源取得。）這批已依指示<strong>直接套用</strong>，卡包與卡名都核對過，但<strong>版本未經核對</strong>：其中 10 張在來源有一個以上的印刷版本（例如牌組限定的藍框版與一般版），系統取來源編號最小的那一版，其他版本預設是收合的，該卡的卡包資訊旁會有一顆小按鈕「換版本」，按下去才展開候選圖，看圖確認後按「改用這張」即可換掉（按卡片圖上的「×」可恢復成預設版本）。至此卡圖覆蓋率為 <strong>15,846／15,846（100%）</strong>。</p>
        <p>本站沒有取得 kajiku.tw 或 pokecardex.com 的公開 API，因此無法直接匯入兩者的卡表資料；App 內建的分類徽章（AR／SR／SAR／CSR／CHR／HR／UR／PR／PROMO）設計參考了這兩個網站常見的收藏分類方式，但實際卡片資料庫與稀有度對照規則都是獨立建立、逐一核對卡面印刷代碼得出的。</p>
        <p>若某隻寶可夢或某個分類目前沒有任何卡片資料，代表「尚未收錄」，<strong>不代表</strong>官方未發行過該分類的卡片。</p>
      </div>
    </section>

    <section class="settings-section">
      <h2>本機保存範圍</h2>
      <div class="info-box">
        <p id="storage-status">儲存狀態檢查中…</p>
        <p>目前版本的收藏紀錄（手動標記、實際收藏張數與備註、分類對應設定）皆保存在<strong>這台裝置瀏覽器的 IndexedDB</strong> 中，不會上傳到任何伺服器，也<strong>不會跨裝置同步</strong>。清除瀏覽器資料、換裝置或換瀏覽器都會遺失紀錄，請養成定期使用下方「匯出備份」的習慣。跨裝置同步／雲端備份規劃於未來版本提供。</p>
        <p><strong>手動上傳的圖片</strong>：在寶可夢詳細頁可以幫任何一隻寶可夢或任何一張卡片自行上傳替代圖片（例如想換成自己的實卡照片），圖片會存進同一個瀏覽器的 IndexedDB，優先權高於系統內建的圖片。<strong>「匯出 JSON 備份」現在會一併包含這些手動上傳的圖片</strong>（以 base64 存放，所以上傳過越多圖片，備份檔就越大），換瀏覽器、換電腦或清除瀏覽器資料時可以靠這份備份把圖片一起搬過去。</p>
        <p><strong>為什麼一定要固定用同一個網址</strong>：瀏覽器的 IndexedDB 是依「網址（含連接埠）」分開存放的，<code>localhost:8811</code> 與 <code>localhost:8812</code> 對瀏覽器來說是兩個不同的網站，資料不互通。如果啟動程式時舊的伺服器視窗還開著，舊版啟動器會自動換到下一個連接埠，收藏紀錄與自訂圖片看起來就會「全部不見」（其實還在舊網址底下）。啟動器已修正為：偵測到 8811 已經跑著同一個圖鑑時，直接沿用它，不再另開新的連接埠。</p>
      </div>
    </section>

    <section class="settings-section">
      <h2>分類與稀有度對應</h2>
      <p class="hint-text">「App 收藏分類」與卡片的「原始稀有度」是分開保存的。這裡設定的是「某個原始稀有度字串要自動歸到哪個分類」，調整後不會更動卡片本身保存的原始稀有度文字。</p><p class="hint-text">預設值來自 <code>js/cardCategories.js</code>，是實際打開本機卡圖、讀卡面右下角印刷代碼逐一核對出來的。其中最重要的一項更正：TCGdex 的 <code>Ultra Rare</code> <strong>不是</strong>日版 UR —— 日版 S10P #068 スピアーV 卡面印的是 <strong>SR</strong>；日版 UR 對應到的是 <code>Secret Rare</code> 與 <code>Mega Hyper Rare</code>。</p><p class="hint-text"><strong>這份對照表不分語言</strong>，而 <code>Holo Rare</code>／<code>Hyper rare</code>／<code>Secret Rare</code> 這三個字串在日文卡與英文卡代表不同等級（英文 Secret Rare 抽驗到的是彩虹卡，日文 Secret Rare 印的是 UR 金卡）。這裡一律採日版的意思，所以英文卡的徽章在這三個字串上會不夠精確。要看分語言的精確分類，請用<a href="#/types">「卡片分類」</a>頁。</p>
      <div id="category-editor"></div>
      <button id="add-category-btn" class="text-btn">＋ 新增自訂分類</button>
    </section>

    <section class="settings-section">
      <h2>套用已確認分類修正</h2>
      <p class="hint-text">
        依查核 Excel 的「錯分清單」中<strong>查核結果＝已確認錯分</strong>的卡片逐張修正分類。
        「疑似錯分」「建議細分」「來源疑點」等項目<strong>一律不動</strong>。
        修正是逐張卡片 ID 指定的，不會把某個稀有度整批換掉。
      </p>
      <div class="export-radio-row">
        <button class="primary-btn" id="fix-preview-btn">檢視修正預覽…</button>
      </div>
      <div id="fix-status" class="hint-text"></div>
    </section>

    <section class="settings-section">
      <h2>RR／RRR 歸位</h2>
      <p class="hint-text">
        RR 與 RRR 原本併在「普通卡」裡，現在各自獨立成分類，<strong>沒有手動指定過的卡片會自動歸位，不用按任何按鈕</strong>。
        這個按鈕只處理兩種自動規則刻意不會碰的卡：你先前<strong>手動</strong>指定成「普通卡」但其實是 RR／RRR 的卡，
        以及<strong>手動放在 RR、但其實是 RRR</strong> 的 VMAX／VSTAR。
      </p>
      <p class="hint-text">
        判定依據是日版卡面右下角實際印的代碼（S10P #001 スピアーV 印 RR、S10P #015 ヒードランVMAX 印 RRR，
        朱紫世代另核對 SV8a #003、S12a #012）。英文卡卡面不印這個代碼，依同一批次的機制對應：
        <code>Double Rare</code>＝ex、<code>Holo Rare V</code>＝V 歸 RR；<code>Holo Rare VMAX／VSTAR</code> 歸 RRR。
        手動放在其他分類（例如你自己判斷成 SR）的卡<strong>不在範圍內，一律保留原狀</strong>。
      </p>
      <div class="export-radio-row">
        <button class="primary-btn" id="rr-preview-btn">檢視歸位預覽…</button>
      </div>
      <div id="rr-status" class="hint-text"></div>
    </section>

    <section class="settings-section">
      <h2>匯出卡表（查看用）</h2>
      <p class="hint-text">依分類產生 Excel（.xlsx）或 Word（.docx）卡表，可選分類、收藏範圍，並沿用「卡片分類」頁的篩選條件。匯出用的是目前已儲存的最新分類，包含你手動指定過的。</p>
      <div class="export-radio-row">
        <a class="primary-btn" href="#/export" style="text-decoration:none">📤 前往匯出卡表</a>
      </div>
      <p class="hint-text"><strong>Excel／Word 只能用來看，不能還原資料。</strong>要備份請用下面的「匯出 JSON 備份」。</p>
    </section>

    <section class="settings-section">
      <h2>備份與還原（JSON）</h2>
      <div class="settings-actions">
        <button id="export-btn" class="primary-btn">匯出 JSON 備份</button>
        <label class="file-input-label">
          匯入 JSON 備份
          <input type="file" id="import-file" accept="application/json" hidden />
        </label>
      </div>
      <p class="hint-text">匯入前會先驗證檔案格式；你可以選擇「合併」（保留現有紀錄，張數取較大值、手動分類取較新的那一筆）或「覆蓋」（取代現有紀錄，覆蓋前會自動先幫你下載一份目前資料的備份）。</p><p class="hint-text">JSON 備份包含：手動點亮標記、實際收藏張數與備註、分類對照設定、<strong>手動指定的卡片分類</strong>（以穩定卡片 ID 保存）與手動上傳的圖片。這是唯一可以完整還原的格式。</p>
    </section>

    <section class="settings-section danger-zone">
      <h2>危險操作</h2>
      <button id="clear-btn" class="danger-btn">清除本機所有收藏紀錄</button>
      <p class="hint-text">會清空手動標記與實際收藏紀錄（不影響圖鑑與卡片資料本身）。此操作無法復原，建議先匯出備份。</p>
    </section>
  `;

  renderCategoryEditor(categories);
  bindThemeButtons();
  bindCategoryAdd();
  bindBackup();
  showStorageStatus();
  bindCategoryFixes();
  bindRrRegroup();
  bindDanger();
}

function renderCategoryEditor(categories) {
  const el = document.getElementById("category-editor");
  el.innerHTML = categories
    .sort((a, b) => a.order - b.order)
    .map(
      (c) => `
    <div class="category-edit-card" data-cat-id="${c.id}" style="--badge-color:${c.color}">
      <div class="category-edit-head">
        <span class="cat-badge badge-owned" style="--badge-color:${c.color}">${escapeHtml(c.label)}</span>
        ${c.builtin ? "" : '<button class="text-btn danger-text" data-action="delete-cat">刪除</button>'}
      </div>
      <p class="cat-desc">${escapeHtml(c.description || "")}</p>
      <div class="rarity-chips">
        ${(c.rarities || [])
          .map((r) => `<span class="rarity-chip">${escapeHtml(r)}<button class="chip-remove" data-rarity="${escapeHtml(r)}">×</button></span>`)
          .join("")}
      </div>
      <div class="rarity-add-row">
        <input type="text" class="rarity-add-input" placeholder="新增原始稀有度字串，例如 AR、SAR、Illustration Rare" />
        <button class="text-btn rarity-add-btn">加入</button>
      </div>
    </div>`
    )
    .join("");

  el.querySelectorAll(".category-edit-card").forEach((card) => {
    const catId = card.getAttribute("data-cat-id");
    card.querySelectorAll(".chip-remove").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const cat = categories.find((c) => c.id === catId);
        cat.rarities = cat.rarities.filter((r) => r !== btn.getAttribute("data-rarity"));
        await saveCategory(cat);
        invalidateCategoryCache();
        await reloadAfterCategoryChange(`已從「${cat.label}」移除稀有度「${btn.getAttribute("data-rarity")}」，正在套用到卡片列表…`);
      });
    });
    card.querySelector(".rarity-add-btn").addEventListener("click", async () => {
      const input = card.querySelector(".rarity-add-input");
      const val = input.value.trim();
      if (!val) return;
      const cat = categories.find((c) => c.id === catId);
      if (!cat.rarities.includes(val)) cat.rarities.push(val);
      await saveCategory(cat);
      invalidateCategoryCache();
      await reloadAfterCategoryChange(`已將「${val}」加入「${cat.label}」，正在套用到卡片列表…`);
    });
    const deleteBtn = card.querySelector('[data-action="delete-cat"]');
    if (deleteBtn) {
      deleteBtn.addEventListener("click", async () => {
        if (!confirm(`確定要刪除自訂分類「${catId}」嗎？此分類下已對應的卡片會自動改標為「其他」。`)) return;
        const { deleteCategory } = await import("../db.js");
        await deleteCategory(catId);
        invalidateCategoryCache();
        await reloadAfterCategoryChange("已刪除分類，正在套用到卡片列表…");
      });
    }
  });
}

// 分類對應表會在載入卡片資料時一次算好每張卡的 categoryId（效能考量，
// 見 js/data.js），所以調整對應表後需要重新整理頁面，卡片列表才會用新
// 對照表重新分類；收藏紀錄本身不受影響。
async function reloadAfterCategoryChange(message) {
  showToast(message, { duration: 1200 });
  setTimeout(() => location.reload(), 500);
}

function bindCategoryAdd() {
  document.getElementById("add-category-btn").addEventListener("click", async () => {
    const label = prompt("新分類名稱（例如：GR、金卡）？");
    if (!label) return;
    const id = "CUSTOM_" + label.toUpperCase().replace(/[^A-Z0-9]/g, "") + "_" + Date.now().toString(36).slice(-4);
    const categories = await getAllCategories();
    const cat = {
      id,
      label,
      order: categories.length,
      color: "#5b8def",
      builtin: false,
      description: "自訂分類",
      rarities: []
    };
    await saveCategory(cat);
    invalidateCategoryCache();
    await reloadAfterCategoryChange(`已新增分類「${label}」，正在套用到卡片列表…`);
  });
}

function bindThemeButtons() {
  document.querySelectorAll(".theme-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const theme = btn.getAttribute("data-theme");
      await setSetting("theme", theme);
      applyTheme(theme);
      document.querySelectorAll(".theme-btn").forEach((b) => b.classList.toggle("active", b === btn));
    });
  });
}

// ---------------------------------------------------------- RR／RRR 歸位

function bindRrRegroup() {
  const btn = document.getElementById("rr-preview-btn");
  if (!btn) return;
  btn.addEventListener("click", openRrDialog);
  showRrStatus();
}

function showRrStatus() {
  const el = document.getElementById("rr-status");
  if (!el) return;
  try {
    const p = previewRrRegroup();
    const parts = p.groups.filter((g) => g.cards.length).map((g) => `${escapeHtml(g.label)} ${g.cards.length} 張`);
    el.innerHTML = parts.length
      ? `需要歸位：${parts.join("、")}（共 <strong>${p.total}</strong> 張）。`
        + `另有 RR ${p.autoHandled.RR} 張、RRR ${p.autoHandled.RRR} 張已由自動規則歸位，不需處理。`
      : `沒有需要手動歸位的卡片。目前 RR ${p.autoHandled.RR} 張、RRR ${p.autoHandled.RRR} 張都已由自動規則歸位。`;
  } catch (err) {
    el.textContent = `計算歸位清單失敗：${err.message}`;
  }
}

function rrGroupTable(g) {
  if (g.cards.length === 0) {
    return `<p class="hint-text">${escapeHtml(g.label)}：沒有需要搬移的卡片</p>`;
  }
  return `<details open>
    <summary>${escapeHtml(g.label)}（${g.cards.length}）</summary>
    <div class="fix-table-wrap"><table class="fix-table">
      <thead><tr><th>卡片 ID</th><th>卡名</th><th>版本</th><th>來源稀有度</th><th>移動</th></tr></thead>
      <tbody>${g.cards.map((c) => `<tr>
        <td><code>${escapeHtml(c.cardId)}</code></td>
        <td>${escapeHtml(c.name || "")}</td>
        <td>${escapeHtml(c.language === "ja" ? "日文版" : c.language === "en" ? "英文版" : c.language)} ·
            ${escapeHtml(c.setId || "")} · ${escapeHtml(String(c.cardNumber || ""))}</td>
        <td>${escapeHtml(c.originalRarity || "—")}</td>
        <td>${escapeHtml(c.fromLabel)} → <strong>${escapeHtml(c.toLabel)}</strong></td>
      </tr>`).join("")}</tbody>
    </table></div>
  </details>`;
}

async function openRrDialog() {
  const old = document.getElementById("rr-dialog");
  if (old) old.remove();

  let p;
  try {
    p = previewRrRegroup();
  } catch (err) {
    alert("計算歸位清單失敗：" + err.message);
    return;
  }

  const dlg = document.createElement("div");
  dlg.id = "rr-dialog";
  dlg.className = "modal-backdrop";
  dlg.innerHTML = `
    <div class="modal wide" role="dialog" aria-modal="true">
      <h3>RR／RRR 歸位</h3>
      <div class="modal-summary">
        <div>將搬移：<strong>${p.total}</strong> 張（都是你先前手動指定過、自動規則不會碰的卡）</div>
        <div>已由自動規則歸位、不需處理：RR <strong>${p.autoHandled.RR}</strong> 張、RRR <strong>${p.autoHandled.RRR}</strong> 張</div>
        <div>手動放在其他分類、不在這次範圍：<strong>${p.skipped.length}</strong> 張 —— <strong>保留原狀不動</strong></div>
        <div class="hint-text">只更動分類。收藏狀態、持有張數、備註、自訂圖片與其他手動分類都不受影響。</div>
      </div>
      ${p.groups.map(rrGroupTable).join("")}
      ${p.skipped.length ? `<details><summary>手動放在其他分類、保留不動（${p.skipped.length}）</summary>
        <ul class="hint-text">${p.skipped.map((c) => `<li><code>${escapeHtml(c.cardId)}</code> ${escapeHtml(c.name || "")}：`
          + `目前在「${escapeHtml(c.currentLabel)}」，自動規則會判成「${escapeHtml(c.wouldBe)}」 —— 尊重你的指定，不動</li>`).join("")}</ul></details>` : ""}
      <div class="modal-actions">
        <button class="text-btn" data-action="backup">先下載 JSON 備份</button>
        <button class="text-btn" data-action="cancel">取消</button>
        <button class="primary-btn" data-action="confirm" ${p.total === 0 ? "disabled" : ""}>搬移 ${p.total} 張</button>
      </div>
    </div>`;
  document.body.appendChild(dlg);

  dlg.querySelector('[data-action="cancel"]').addEventListener("click", () => dlg.remove());
  dlg.addEventListener("click", (e) => {
    if (e.target === dlg) dlg.remove();
  });
  dlg.querySelector('[data-action="backup"]').addEventListener("click", async () => {
    const data = await exportAllData();
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    downloadBlob(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
      `RR歸位前備份_寶可夢PTCG收藏備份_${ts}.json`);
    showToast("已下載備份檔，裡面包含收藏紀錄與全部手動分類");
  });

  const confirmBtn = dlg.querySelector('[data-action="confirm"]');
  confirmBtn.addEventListener("click", async () => {
    confirmBtn.disabled = true;
    confirmBtn.textContent = "搬移中…";
    try {
      const res = await applyRrRegroup(p, { bulkSetCategoryOverride, applyCategoryOverrides });
      dlg.remove();
      showToast(`已把 ${res.applied} 張卡片歸位到 RR／RRR`, {
        actionLabel: "復原這次搬移",
        duration: 20000,
        onAction: async () => {
          try {
            await bulkRestoreCategoryOverrides(res.before);
            await applyCategoryOverrides();
            showToast(`已復原 ${res.before.length} 張卡片的分類`);
            renderSettings();
          } catch (err) {
            showToast(`復原失敗：${err.message}`, { duration: 12000 });
          }
        }
      });
      renderSettings();
    } catch (err) {
      confirmBtn.disabled = false;
      confirmBtn.textContent = `搬移 ${p.total} 張`;
      showToast(`搬移失敗，資料未變更：${err.message}`, { duration: 15000 });
    }
  });
}

// ---------------------------------------------------------- 已確認分類修正

function bindCategoryFixes() {
  const btn = document.getElementById("fix-preview-btn");
  if (!btn) return;
  btn.addEventListener("click", openFixDialog);
  showFixStatus();
}

async function showFixStatus() {
  const el = document.getElementById("fix-status");
  if (!el) return;
  try {
    const p = await previewCategoryFixes();
    el.innerHTML =
      `修正批次 <code>${escapeHtml(p.version)}</code>（來源：${escapeHtml(p.source)}）共 ${p.total} 張。`
      + `目前狀態：待套用 <strong>${p.toApply.length}</strong>、已正確 ${p.already.length}、`
      + `衝突 ${p.conflicts.length}、對不上 ${p.notFound.length}。`
      + (p.alreadyAppliedBefore ? "（這個批次先前已執行過）" : "");
  } catch (err) {
    el.textContent = `讀取修正清單失敗：${err.message}`;
  }
}

function rowHtml(f, showCurrent) {
  return `<tr>
    <td><code>${escapeHtml(f.cardId)}</code></td>
    <td>${escapeHtml(f.name || "")}</td>
    <td>${escapeHtml(f.language === "ja" ? "日文版" : f.language === "en" ? "英文版" : f.language)} ·
        ${escapeHtml(f.setId)} · ${escapeHtml(f.cardNumber || "")}</td>
    <td>${showCurrent ? escapeHtml(f.currentLabel || "") : escapeHtml(f.fromLabel || "")}</td>
    <td>→ ${escapeHtml(f.toLabel || "")}</td>
  </tr>`;
}

function tableHtml(title, rows, showCurrent, emptyText) {
  if (rows.length === 0) return `<p class="hint-text">${escapeHtml(title)}：${escapeHtml(emptyText)}</p>`;
  return `<details${rows.length && showCurrent === "open" ? " open" : ""}>
    <summary>${escapeHtml(title)}（${rows.length}）</summary>
    <div class="fix-table-wrap"><table class="fix-table">
      <thead><tr><th>卡片 ID</th><th>卡名</th><th>版本</th><th>目前</th><th>修正為</th></tr></thead>
      <tbody>${rows.map((r) => rowHtml(r, true)).join("")}</tbody>
    </table></div>
  </details>`;
}

async function openFixDialog() {
  const old = document.getElementById("fix-dialog");
  if (old) old.remove();

  let p;
  try {
    p = await previewCategoryFixes();
  } catch (err) {
    alert("讀取修正清單失敗：" + err.message);
    return;
  }

  const dlg = document.createElement("div");
  dlg.id = "fix-dialog";
  dlg.className = "modal-backdrop";
  dlg.innerHTML = `
    <div class="modal wide" role="dialog" aria-modal="true">
      <h3>套用已確認分類修正</h3>
      <p class="hint-text">
        批次 <code>${escapeHtml(p.version)}</code>｜來源：${escapeHtml(p.source)}｜
        共 ${p.total} 張已確認錯分。
        ${Object.entries(p.notAppliedCounts).map(([k, v]) => `${escapeHtml(k)} ${v} 筆不處理`).join("、")}。
      </p>
      <div class="modal-summary">
        <div>將套用：<strong>${p.toApply.length}</strong> 張</div>
        <div>已經正確、不需修改：<strong>${p.already.length}</strong> 張</div>
        <div>目前分類與清單不符（可能是你後來自己調過）：<strong>${p.conflicts.length}</strong> 張 —— <strong>保留原狀不動</strong></div>
        <div>找不到或版本對不上：<strong>${p.notFound.length}</strong> 張</div>
        <div class="hint-text">只會更動這些卡片的分類。收藏狀態、持有張數、備註、圖片與其他手動分類都不受影響。</div>
      </div>
      ${tableHtml("將套用的修正", p.toApply, "open", "無")}
      ${tableHtml("已經正確", p.already, false, "無")}
      ${tableHtml("衝突（保留不動）", p.conflicts, false, "無")}
      ${p.notFound.length ? `<details><summary>找不到／版本對不上（${p.notFound.length}）</summary>
        <ul class="hint-text">${p.notFound.map((f) => `<li><code>${escapeHtml(f.cardId)}</code>：${escapeHtml(f.reason || "")}</li>`).join("")}</ul></details>` : ""}
      <div class="modal-actions">
        <button class="text-btn" data-action="backup">先下載 JSON 備份</button>
        <button class="text-btn" data-action="cancel">取消</button>
        <button class="primary-btn" data-action="confirm" ${p.toApply.length === 0 ? "disabled" : ""}>
          套用 ${p.toApply.length} 張修正</button>
      </div>
    </div>`;
  document.body.appendChild(dlg);

  dlg.querySelector('[data-action="cancel"]').addEventListener("click", () => dlg.remove());
  dlg.addEventListener("click", (e) => {
    if (e.target === dlg) dlg.remove();
  });
  dlg.querySelector('[data-action="backup"]').addEventListener("click", async () => {
    const data = await exportAllData();
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    downloadBlob(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
      `套用修正前備份_寶可夢PTCG收藏備份_${ts}.json`);
    showToast("已下載備份檔，裡面包含收藏紀錄與全部手動分類");
  });

  const confirmBtn = dlg.querySelector('[data-action="confirm"]');
  confirmBtn.addEventListener("click", async () => {
    confirmBtn.disabled = true;
    confirmBtn.textContent = "套用中…";
    try {
      const res = await applyCategoryFixes(p, { bulkSetCategoryOverride, applyCategoryOverrides });
      dlg.remove();
      showToast(`已修正 ${res.applied} 張卡片的分類（略過已正確 ${p.already.length} 張、衝突 ${p.conflicts.length} 張）`, {
        actionLabel: "復原這次修正",
        duration: 20000,
        onAction: async () => {
          try {
            await bulkRestoreCategoryOverrides(res.before);
            await applyCategoryOverrides();
            showToast(`已復原 ${res.before.length} 張卡片的分類`);
            renderSettings();
          } catch (err) {
            showToast(`復原失敗：${err.message}`, { duration: 12000 });
          }
        }
      });
      renderSettings();
    } catch (err) {
      confirmBtn.disabled = false;
      confirmBtn.textContent = `套用 ${p.toApply.length} 張修正`;
      showToast(`套用失敗，資料未變更：${err.message}`, { duration: 15000 });
    }
  });
}

async function showStorageStatus() {
  const el = document.getElementById("storage-status");
  if (!el) return;
  const st = await getStorageStatus();
  if (!st.supported) {
    el.innerHTML = "<strong>儲存狀態</strong>：這個瀏覽器不支援查詢儲存配額，資料仍然存在 IndexedDB。";
    return;
  }
  const usedMB = (st.usageBytes / 1048576).toFixed(2);
  const quotaMB = Math.round(st.quotaBytes / 1048576);
  el.innerHTML = st.persisted
    ? `<strong>儲存狀態：已受保護</strong>（persistent）。關機、重開機、關瀏覽器都不會影響，`
      + `瀏覽器也不會為了釋放空間自動清掉這些資料。目前已使用 ${usedMB} MB／可用上限約 ${quotaMB} MB。`
      + `只有你自己「清除瀏覽器網站資料」才會刪除。`
    : `<strong>儲存狀態：一般（best-effort）</strong>。資料一樣會存到硬碟、關機不會消失，`
      + `但磁碟空間嚴重不足時瀏覽器有權自動清除。目前已使用 ${usedMB} MB／可用上限約 ${quotaMB} MB。`
      + `建議定期用下方的「匯出 JSON 備份」留一份。`;
}

function bindBackup() {
  document.getElementById("export-btn").addEventListener("click", async () => {
    await downloadExport();
    showToast("已匯出備份檔案");
  });

  document.getElementById("import-file").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const payload = JSON.parse(text);
      const mode = confirm(
        "選擇「確定」＝合併（保留現有紀錄，卡片張數取較大值）\n選擇「取消」＝覆蓋（取代現有全部紀錄，會先自動幫你下載目前資料備份）"
      )
        ? "merge"
        : "overwrite";
      if (mode === "overwrite") {
        await downloadExport("覆蓋前備份_");
      }
      await importAllData(payload, mode);
      showToast(mode === "merge" ? "已合併匯入" : "已覆蓋匯入");
      setTimeout(() => location.reload(), 800);
    } catch (err) {
      alert("匯入失敗：" + err.message);
    } finally {
      e.target.value = "";
    }
  });
}

async function downloadExport(prefix = "") {
  const data = await exportAllData();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  a.href = url;
  a.download = `${prefix}寶可夢PTCG收藏備份_${ts}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function bindDanger() {
  document.getElementById("clear-btn").addEventListener("click", async () => {
    if (!confirm("確定要清除所有收藏紀錄嗎？建議先匯出備份。")) return;
    if (!confirm("再次確認：這個操作無法復原，真的要繼續嗎？")) return;
    await downloadExport("清除前備份_");
    await clearAllCollectionData();
    showToast("已清除收藏紀錄");
    setTimeout(() => location.reload(), 800);
  });
}
