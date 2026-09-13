// 「匯出卡表」頁：在網頁上直接產生 Excel／Word，不需要開終端機。
//
// 匯出用的一律是「目前已儲存的最新分類」——資料直接從記憶體中的卡表讀，
// 而那份卡表在每次手動分類存檔成功後就已經同步更新（見
// js/components/categoryPicker.js -> refreshCategoryOverrideForCard），
// 所以不會匯到舊資料。按下匯出時還會再從 IndexedDB 重新讀一次覆寫紀錄，
// 確保就算有剛剛才寫入、畫面還沒重畫的改動也會被帶進去。
import { getAllCards, getSpecies, applyCategoryOverrides } from "../data.js";
import { CARD_CATEGORY_DEFS, getCategoryDef, isPromoCard } from "../cardCategories.js";
import { seriesOfCard, getSeriesDisplay, getRegulationMark, markLabel, MARK_STATUS } from "../seriesCatalog.js";
import { getAllOwnership } from "../db.js";
import { escapeHtml, padDex, showToast } from "../utils.js";
import { exportXlsx, exportDocx, EXPORT_COLUMNS } from "../exporters.js";
import { getLastFilterContext } from "./cardTypes.js";
import { currentSeriesFilterResult, getSeriesFilterState } from "./seriesBrowse.js";

const LANG_LABEL = { en: "英文版（美版）", ja: "日文版", "zh-Hant": "繁體中文版", "zh-Hans": "簡體中文版" };

const state = {
  selected: new Set(CARD_CATEGORY_DEFS.map((d) => d.id)),
  scope: "all", // all | owned | missing
  useFilters: false,
  useSeriesFilters: false
};

export async function renderExportPage() {
  const app = document.getElementById("app");
  const ctx = getLastFilterContext();

  app.innerHTML = `
    <header class="page-header">
      <h1>匯出卡表</h1>
      <p class="subtitle">直接在網頁產生 Excel／Word，不需要開終端機</p>
    </header>

    <section class="settings-section export-section">
      <h2>1. 要匯出哪些分類</h2>
      <div class="export-radio-row">
        <button class="text-btn" id="exp-all">全選</button>
        <button class="text-btn" id="exp-none">全部取消</button>
      </div>
      <div class="export-cat-grid" id="exp-cats"></div>
    </section>

    <section class="settings-section export-section">
      <h2>2. 卡片範圍</h2>
      <div class="seg-group" id="exp-scope">
        <button class="seg-btn" data-v="all">全部已收錄</button>
        <button class="seg-btn" data-v="owned">只要已收藏</button>
        <button class="seg-btn" data-v="missing">只要未收藏</button>
      </div>
    </section>

    <section class="settings-section export-section">
      <h2>3. 是否沿用其他頁面的篩選條件</h2>
      <label class="export-cat-item" style="max-width:520px">
        <input type="checkbox" id="exp-useseries" />
        <span>沿用「系列／卡包」頁目前的條件：${escapeHtml(describeSeriesFilters())}</span>
      </label>
      ${
        ctx
          ? `<label class="export-cat-item" style="max-width:420px">
               <input type="checkbox" id="exp-usefilter" />
               <span>沿用：${escapeHtml(describeFilters(ctx))}</span>
             </label>`
          : `<p class="hint-text">目前沒有可沿用的條件。先到「卡片分類」頁設定搜尋／語言／卡包篩選，再回來這裡就能勾選沿用。</p>`
      }
    </section>

    <section class="settings-section export-section">
      <h2>4. 確認並匯出</h2>
      <p class="hint-text">Excel 會產生三種工作表：<strong>全部明細</strong>（本次範圍內每個卡片 ID 一列，分類欄列出它所屬的全部分類）、<strong>各分類明細</strong>（依所選分類各一張，內容同樣是逐卡完整資料）、<strong>統計總覽</strong>（輔助用，不取代明細）。</p>
      <div class="export-preview" id="exp-preview">計算中…</div>
      <div class="export-actions">
        <button class="primary-btn" id="exp-xlsx">匯出 Excel（.xlsx）</button>
        <button class="text-btn" id="exp-docx">匯出 Word（.docx）</button>
      </div>
      <p class="hint-text">
        Excel／Word 是給你看卡表用的，<strong>不能拿來還原資料</strong>。
        要備份收藏紀錄、手動分類與自訂圖片，請用「設定」頁的
        <a href="#/settings">匯出 JSON 備份</a>。
      </p>
    </section>
  `;

  renderCategoryChecklist();
  syncScopeButtons();
  bindEvents(ctx);
  await refreshPreview();
}

function describeFilters(ctx) {
  const parts = [];
  if (ctx.categoryLabel) parts.push(`分類頁：${ctx.categoryLabel}`);
  if (ctx.keyword) parts.push(`關鍵字「${ctx.keyword}」`);
  if (ctx.language && ctx.language !== "all") parts.push(LANG_LABEL[ctx.language] || ctx.language);
  if (ctx.setName) parts.push(`卡包：${ctx.setName}`);
  if (ctx.owned && ctx.owned !== "all") parts.push(ctx.owned === "owned" ? "已收藏" : "未收藏");
  return parts.length ? parts.join("、") : "（目前沒有設定任何篩選）";
}

function describeSeriesFilters() {
  const st = getSeriesFilterState();
  const parts = [];
  if (st.seriesId && st.seriesId !== "all") parts.push(`系列 ${getSeriesDisplay(st.seriesId).zh}`);
  if (st.setKey && st.setKey !== "all") parts.push(`卡包 ${st.setKey}`);
  if (st.language && st.language !== "all") parts.push(LANG_LABEL[st.language] || st.language);
  if (st.mark && st.mark !== "all") {
    parts.push(st.mark === "__none" ? "無標記" : st.mark === "__unknown" ? "標記待確認" : `${st.mark} 標記`);
  }
  if (st.categoryId && st.categoryId !== "all") parts.push((getCategoryDef(st.categoryId) || {}).label);
  if (st.owned && st.owned !== "all") parts.push(st.owned === "owned" ? "已收藏" : "未收藏");
  if (st.keyword) parts.push(`關鍵字「${st.keyword}」`);
  return parts.length ? parts.join("、") : "（沒有設定條件，等同全部）";
}

function renderCategoryChecklist() {
  const cards = getAllCards();
  const counts = {};
  for (const d of CARD_CATEGORY_DEFS) counts[d.id] = 0;
  for (const c of cards) for (const id of c.categoryIds || []) if (counts[id] !== undefined) counts[id]++;

  document.getElementById("exp-cats").innerHTML = CARD_CATEGORY_DEFS.map(
    (d) => `
    <label class="export-cat-item">
      <input type="checkbox" data-cat="${d.id}" ${state.selected.has(d.id) ? "checked" : ""} />
      <span>${escapeHtml(d.label)}</span>
      <span class="export-cat-count">${counts[d.id]}</span>
    </label>`
  ).join("");

  document.querySelectorAll("#exp-cats input").forEach((cb) => {
    cb.addEventListener("change", () => {
      const id = cb.getAttribute("data-cat");
      if (cb.checked) state.selected.add(id);
      else state.selected.delete(id);
      refreshPreview();
    });
  });
}

function syncScopeButtons() {
  document.querySelectorAll("#exp-scope .seg-btn").forEach((b) => {
    b.classList.toggle("active", b.getAttribute("data-v") === state.scope);
  });
}

function bindEvents(ctx) {
  document.getElementById("exp-all").addEventListener("click", () => {
    state.selected = new Set(CARD_CATEGORY_DEFS.map((d) => d.id));
    renderCategoryChecklist();
    refreshPreview();
  });
  document.getElementById("exp-none").addEventListener("click", () => {
    state.selected = new Set();
    renderCategoryChecklist();
    refreshPreview();
  });
  document.getElementById("exp-scope").addEventListener("click", (e) => {
    const btn = e.target.closest(".seg-btn");
    if (!btn) return;
    state.scope = btn.getAttribute("data-v");
    syncScopeButtons();
    refreshPreview();
  });
  const useFilter = document.getElementById("exp-usefilter");
  if (useFilter) {
    useFilter.checked = state.useFilters;
    useFilter.addEventListener("change", () => {
      state.useFilters = useFilter.checked;
      refreshPreview();
    });
  }
  const useSeries = document.getElementById("exp-useseries");
  if (useSeries) {
    useSeries.checked = state.useSeriesFilters;
    useSeries.addEventListener("change", () => {
      state.useSeriesFilters = useSeries.checked;
      refreshPreview();
    });
  }
  document.getElementById("exp-xlsx").addEventListener("click", () => runExport("xlsx", ctx));
  document.getElementById("exp-docx").addEventListener("click", () => runExport("docx", ctx));
}

/**
 * 依目前條件組出要匯出的資料。
 *
 * rows 一律是「逐張卡片的完整明細」：一個穩定卡片 ID 一列，同版本收了幾張
 * 用「持有張數」表示。分類欄位用的是目前已儲存的最終分類（手動優先）。
 */
async function buildPayload(ctx) {
  const ownership = await getAllOwnership();
  const ownMap = new Map(ownership.map((o) => [o.cardId, o]));
  const cards = getAllCards();
  const filters = state.useFilters && ctx ? ctx : null;

  const matchesFilters = (card) => {
    if (!filters) return true;
    if (filters.language && filters.language !== "all" && card.language !== filters.language) return false;
    if (filters.setKey && filters.setKey !== "all" && `${card.language}:${card.setId}` !== filters.setKey) return false;
    if (filters.keyword && !filters.matcher(card, filters.keyword)) return false;
    if (filters.owned && filters.owned !== "all") {
      const isOwned = (ownMap.get(card.id) || {}).count > 0;
      if (filters.owned === "owned" && !isOwned) return false;
      if (filters.owned === "missing" && isOwned) return false;
    }
    return true;
  };

  const matchesScope = (card) => {
    const isOwned = (ownMap.get(card.id) || {}).count > 0;
    if (state.scope === "owned") return isOwned;
    if (state.scope === "missing") return !isOwned;
    return true;
  };

  /** 把一張卡轉成明細列。只填資料裡確實有的東西，沒有的留空。 */
  const toRow = (card) => {
    const own = ownMap.get(card.id);
    const count = own ? own.count : 0;
    const dex = (card.dexNumbers || [])[0];
    const sp = dex ? getSpecies(dex) : null;

    // 版本／特殊標記：只列出資料已確認的。異圖、閃卡、反閃、蓋章版等來源
    // 資料庫沒有提供，所以不寫 —— 寧可留空，也不編造。
    const marks = [];
    if (isPromoCard(card)) marks.push("宣傳卡");
    if (card.isSample) marks.push("樣本資料");

    return {
      cardId: card.id,
      dex: dex ? padDex(dex) : "",
      dexSort: dex || 99999,
      speciesName: sp ? sp.nameZh || sp.nameEn : "",
      cardName: card.name || "",
      // 目前所在分類：一張卡屬於多個分類時全部列出，不另外建列
      categories: (card.categoryIds || [])
        .map((id) => (getCategoryDef(id) || {}).label || id)
        .join("、"),
      originalRarity: card.originalRarity || "（來源未提供）",
      source: card.categoryOverrideId ? "手動指定" : "系統判定",
      language: LANG_LABEL[card.language] || card.language,
      seriesZh: getSeriesDisplay(seriesOfCard(card)).zh,
      seriesName: card.seriesName || "",
      seriesId: card.seriesId || "",
      setName: card.setName || card.setId || "",
      setKey: `${card.language}:${card.setId}`,
      setId: card.setId || "",
      regulationMark: markLabel(getRegulationMark(card)),
      // 這三個欄位的判定依據，跟稀有度分類的「分類依據」分開記
      fieldSource: (() => {
        const parts = [];
        if (card.seriesOverrideId) parts.push("系列手動");
        if (card.setKeyOverride) parts.push("卡包手動");
        if (card.regulationMarkOverride) parts.push("標記手動");
        if (getRegulationMark(card).status === MARK_STATUS.UNKNOWN) parts.push("標記待確認");
        return parts.length ? parts.join("、") : "來源資料";
      })(),
      // 前導零與斜線都要原樣保留，所以這一欄在 Excel 裡強制存成文字
      cardNumber: card.printedTotal ? `${card.cardNumber}/${card.printedTotal}` : String(card.cardNumber || ""),
      variantMarks: marks.join("、"),
      tags: (card.tags || []).join("、"),
      illustrator: card.illustrator || "",
      releaseDate: card.releaseDate || "",
      ownedLabel: count > 0 ? "已收藏" : "未收藏",
      count,
      note: own ? own.note || "" : "",
      // TCGdex 的卡片 API 端點，就是本專案抓資料時實際用的那個網址格式
      sourceUrl: card.sourceId ? `https://api.tcgdex.net/v2/${card.language}/cards/${card.sourceId}` : "",
      // 只放真的可以點的公開網址；本機快取路徑在 Excel 裡點不開，留空
      imageUrl: /^https?:\/\//.test(card.remoteImageSmall || "") ? card.remoteImageSmall : ""
    };
  };

  const sortRows = (rows) =>
    rows.sort(
      (a, b) =>
        a.dexSort - b.dexSort
        || a.setName.localeCompare(b.setName, "ja")
        || String(a.cardNumber).localeCompare(String(b.cardNumber), "en", { numeric: true })
    );

  // --- 全部明細：先把範圍內的卡片各做一列，之後分類工作表重用同一批列物件 ---
  // 沿用系列／卡包頁的條件時，先取那一頁「全部符合條件的卡片」（不是只有
  // 畫面上已載入的那一頁），再跟這裡的分類與範圍條件取交集。
  const seriesAllowed = state.useSeriesFilters ? new Set(currentSeriesFilterResult().map((c) => c.id)) : null;
  const inScope = cards.filter((c) => {
    if (seriesAllowed && !seriesAllowed.has(c.id)) return false;
    if (!matchesScope(c) || !matchesFilters(c)) return false;
    // 只要它至少落在一個被勾選的分類裡，就屬於這次匯出範圍
    return (c.categoryIds || []).some((id) => state.selected.has(id));
  });
  const rowByCardId = new Map();
  for (const card of inScope) rowByCardId.set(card.id, toRow(card));
  const allRows = sortRows(Array.from(rowByCardId.values()));

  // --- 各分類明細 ---
  const groups = [];
  let sumOfGroups = 0;
  for (const def of CARD_CATEGORY_DEFS) {
    if (!state.selected.has(def.id)) continue;
    const rows = sortRows(
      inScope.filter((c) => (c.categoryIds || []).includes(def.id)).map((c) => rowByCardId.get(c.id))
    );
    const ownedCount = rows.filter((r) => r.count > 0).length;
    const totalCopies = rows.reduce((sum, r) => sum + r.count, 0);
    sumOfGroups += rows.length;
    groups.push({ categoryId: def.id, rows, ownedCount, totalCopies });
  }

  const scopeText = { all: "全部已收錄卡片", owned: "只要已收藏", missing: "只要未收藏" }[state.scope];
  const conditionText =
    `分類：${[...state.selected].map((id) => (getCategoryDef(id) || {}).label).join("、") || "（未選）"}`
    + `｜範圍：${scopeText}`
    + `｜篩選：${filters ? describeFilters(filters) : "未沿用分類頁篩選"}`
    + (state.useSeriesFilters ? `｜系列頁條件：${describeSeriesFilters()}` : "");

  return {
    exportedAt: new Date().toLocaleString("zh-TW", { hour12: false }),
    conditionText,
    allRows,
    groups,
    distinctCount: allRows.length,
    ownedDistinct: allRows.filter((r) => r.count > 0).length,
    totalCopiesAll: allRows.reduce((s, r) => s + r.count, 0),
    sumOfGroups
  };
}

async function refreshPreview() {
  const el = document.getElementById("exp-preview");
  if (!el) return;
  if (state.selected.size === 0) {
    el.innerHTML = `<strong>尚未選擇任何分類</strong>，請至少勾選一個分類。`;
    return;
  }
  const ctx = getLastFilterContext();
  const payload = await buildPayload(ctx);
  el.innerHTML = `
    <div>匯出條件：${escapeHtml(payload.conditionText)}</div>
    <div>工作表：<strong>全部明細</strong> + ${payload.groups.length} 個分類明細 + 統計總覽</div>
    <div>全部明細：<strong>${payload.distinctCount}</strong> 張不同卡片（每個卡片 ID 一列，不重複）；
         其中已收藏 <strong>${payload.ownedDistinct}</strong> 張、持有共 <strong>${payload.totalCopiesAll}</strong> 張</div>
    <div>各分類明細相加 <strong>${payload.sumOfGroups}</strong> 列
         ${payload.sumOfGroups !== payload.distinctCount
           ? `（比不重複卡片多 ${payload.sumOfGroups - payload.distinctCount} 列，是同時屬於多個分類的卡片）` : ""}</div>
    <div class="hint-text">每一列都是逐張卡片的完整明細（${EXPORT_COLUMNS.length} 欄），不是只有數量統計。</div>`;
}

async function runExport(kind, ctx) {
  if (state.selected.size === 0) {
    showToast("請至少選擇一個分類再匯出");
    return;
  }
  const btn = document.getElementById(kind === "xlsx" ? "exp-xlsx" : "exp-docx");
  const original = btn.textContent;
  btn.disabled = true;
  btn.textContent = "產生中…";
  try {
    // 匯出前再從 IndexedDB 同步一次手動分類，確保用的是最新已儲存的結果
    await applyCategoryOverrides();
    const payload = await buildPayload(ctx || getLastFilterContext());
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    if (kind === "xlsx") {
      await exportXlsx(payload, `寶可夢PTCG卡表_${stamp}.xlsx`);
    } else {
      await exportDocx(payload, `寶可夢PTCG卡表_${stamp}.docx`);
    }
    showToast(`已匯出 ${payload.distinctCount} 張不重複卡片（${payload.groups.length} 個分類工作表）`);
  } catch (err) {
    showToast(`匯出失敗：${err && err.message ? err.message : err}`, { duration: 12000 });
  } finally {
    btn.disabled = false;
    btn.textContent = original;
  }
}
