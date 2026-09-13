import { getAllSpecies, getAllCards, getCard, getSpecies, getAllSetsMeta } from "../data.js";
import { buildSnapshot, computeSpeciesStatus } from "../state.js";
import {
  getAllCategories,
  getAllOwnership,
  getAllManualFlags,
  bulkClearOwnership,
  restoreLastClear,
  getLastClearSnapshotInfo,
  exportAllData
} from "../db.js";
import { CARD_CATEGORY_DEFS, getCategoryDef } from "../cardCategories.js";
import { renderPokemonTile } from "../components/pokemonTile.js";
import { escapeHtml, padDex, debounce, showToast, imgFallbackAttr, PLACEHOLDER_IMAGE } from "../utils.js";
import {
  createSelection, renderSelectCheckbox, renderBulkBar, refreshBulkBar,
  bindBulkBar, bindCheckboxDelegation, syncSelectionToDom, setBulkProgress,
  runOnce
} from "../components/bulkSelect.js";
import { downloadBlob } from "../exporters.js";

const LANG_LABEL = { en: "英文版（美版）", ja: "日文版", "zh-Hant": "繁體中文版", "zh-Hans": "簡體中文版" };
const PAGE_SIZE = 60;

// 已收藏卡片清單的篩選狀態（跟「卡片分類」頁是各自獨立的）
const cardFilter = {
  keyword: "",
  categoryId: "all",
  language: "all",
  setKey: "all",
  limit: PAGE_SIZE
};

const selection = createSelection();
let bulkMode = false;
let lastFilteredCards = [];
let lastShownCards = [];

export async function renderCollection() {
  const app = document.getElementById("app");
  const species = getAllSpecies();
  const categories = await getAllCategories();
  const snapshot = await buildSnapshot();
  const ownership = await getAllOwnership();

  const statuses = species.map((s) => computeSpeciesStatus(s.id, snapshot));
  const litCount = statuses.filter((s) => s.speciesLit).length;
  const distinctVariants = ownership.filter((o) => o.count > 0).length;
  const totalPhysical = ownership.reduce((sum, o) => sum + o.count, 0);

  const perCategoryLit = {};
  for (const cat of categories) {
    perCategoryLit[cat.id] = statuses.filter((s) => s.categories[cat.id] && s.categories[cat.id].status === "owned").length;
  }

  const undoInfo = await getLastClearSnapshotInfo();

  app.innerHTML = `
    <header class="page-header">
      <h1>我的收藏</h1>
      <p class="subtitle">目前收錄範圍內的收藏統計（非官方全卡表完成率）</p>
    </header>

    <section class="stat-cards">
      <div class="stat-card big">
        <div class="stat-card-value">${litCount} <span class="stat-card-denom">/ ${species.length}</span></div>
        <div class="stat-card-label">已點亮寶可夢數（依目前圖鑑收錄）</div>
      </div>
      <div class="stat-card">
        <div class="stat-card-value">${distinctVariants}</div>
        <div class="stat-card-label">已收藏的不同卡片版本數</div>
      </div>
      <div class="stat-card">
        <div class="stat-card-value">${totalPhysical}</div>
        <div class="stat-card-label">實體卡片總張數</div>
      </div>
    </section>

    <section class="clear-entry">
      <button class="danger-btn" id="clear-collection-btn">🧹 清除收藏…</button>
      ${
        undoInfo
          ? `<button class="text-btn" id="undo-clear-btn">復原上一次清除（${undoInfo.cards} 張卡／${undoInfo.copies} 張）</button>`
          : ""
      }
      <p class="hint-text">清除的只有「收藏狀態與持有張數」。卡片、圖片、<strong>手動整理好的分類</strong>、原始稀有度與備註都會保留。</p>
    </section>

    <section class="cat-stat-section">
      <h2>各分類已點亮寶可夢數</h2>
      <div class="cat-stat-grid">
        ${categories
          .map(
            (c) => `
          <a class="cat-stat-tile" href="#/types/${encodeURIComponent(c.id)}" data-cat="${c.id}" style="--badge-color:${c.color}">
            <div class="cat-stat-label">${escapeHtml(c.label)}</div>
            <div class="cat-stat-value">${perCategoryLit[c.id] || 0}</div>
          </a>`
          )
          .join("")}
      </div>
      <p class="hint-text">「已點亮」代表擁有至少一張該分類卡片，或手動標記，不代表已收齊該分類所有版本。</p>
    </section>

    <section class="collection-list-section">
      <div class="detail-cards-headrow">
        <h2>已收藏的卡片（${distinctVariants}）</h2>
      </div>
      <div class="cat-filter-bar">
        <input id="col-search" class="cat-search" type="search"
               placeholder="搜尋寶可夢名稱、卡片名稱或卡號" value="${escapeHtml(cardFilter.keyword)}" />
        <div class="cat-filter-row">
          <select id="col-cat" class="cat-select"><option value="all">全部分類</option></select>
          <select id="col-lang" class="cat-select"><option value="all">全部語言</option></select>
          <select id="col-set" class="cat-select"><option value="all">全部卡包</option></select>
        </div>
        <div class="cat-result-line" id="col-result"></div>
        <div id="col-bulk"></div>
      </div>
      <div id="col-cards" class="owned-card-list"></div>
      <div class="cat-more-wrap"><button id="col-more" class="text-btn hidden">載入更多</button></div>
    </section>

    <section class="collection-list-section">
      <div class="detail-cards-headrow">
        <h2>已點亮的寶可夢（${litCount}）</h2>
      </div>
      <div id="owned-grid" class="poke-grid"></div>
      ${litCount === 0 ? `<div class="empty-state">還沒有收藏紀錄。到圖鑑首頁點進任一隻寶可夢，試試「快速點亮」或勾選實際卡片吧！</div>` : ""}
    </section>
  `;

  const grid = document.getElementById("owned-grid");
  const pairs = species.map((s, i) => [s, statuses[i]]).filter(([, st]) => st.speciesLit);
  grid.innerHTML = pairs.map(([s, st]) => renderPokemonTile(s, st, categories)).join("");

  buildFilterOptions(ownership);
  bindCollectionFilters();
  bindClearEntry();
  drawOwnedCards();
}

// ------------------------------------------------------------ 已收藏卡片清單

function ownedCardList(ownership) {
  const ownMap = new Map(ownership.map((o) => [o.cardId, o]));
  return getAllCards()
    .filter((c) => (ownMap.get(c.id) || {}).count > 0)
    .map((c) => ({ card: c, own: ownMap.get(c.id) }));
}

function buildFilterOptions(ownership) {
  const owned = ownedCardList(ownership);
  const setsMeta = getAllSetsMeta();

  const catSel = document.getElementById("col-cat");
  for (const def of CARD_CATEGORY_DEFS) {
    const n = owned.filter(({ card }) => (card.categoryIds || []).includes(def.id)).length;
    if (n === 0) continue;
    catSel.insertAdjacentHTML("beforeend", `<option value="${def.id}">${escapeHtml(def.label)}（${n}）</option>`);
  }
  const langSel = document.getElementById("col-lang");
  for (const l of Array.from(new Set(owned.map(({ card }) => card.language))).sort()) {
    langSel.insertAdjacentHTML("beforeend", `<option value="${l}">${escapeHtml(LANG_LABEL[l] || l)}</option>`);
  }
  const setSel = document.getElementById("col-set");
  const keys = Array.from(new Set(owned.map(({ card }) => `${card.language}:${card.setId}`)))
    .map((k) => ({ key: k, name: (setsMeta[k] || {}).setName || k.split(":")[1] }))
    .sort((a, b) => a.name.localeCompare(b.name, "ja"));
  for (const s of keys) {
    setSel.insertAdjacentHTML("beforeend", `<option value="${escapeHtml(s.key)}">${escapeHtml(s.name)}</option>`);
  }

  catSel.value = cardFilter.categoryId;
  langSel.value = cardFilter.language;
  setSel.value = cardFilter.setKey;
}

function matchesKeyword(card, kw) {
  if (!kw) return true;
  const lower = kw.toLowerCase();
  if ((card.name || "").toLowerCase().includes(lower)) return true;
  if ((card.cardNumber || "").toLowerCase().includes(lower)) return true;
  if ((card.setName || "").toLowerCase().includes(lower)) return true;
  for (const dex of card.dexNumbers || []) {
    const sp = getSpecies(dex);
    if (!sp) continue;
    if ((sp.nameZh || "").includes(kw)) return true;
    if ((sp.nameEn || "").toLowerCase().includes(lower)) return true;
  }
  return false;
}

/** 目前篩選條件命中的已收藏卡片（不受分頁限制）。清除範圍「目前篩選結果」用這個。 */
export async function currentFilteredOwned() {
  const ownership = await getAllOwnership();
  return ownedCardList(ownership).filter(({ card }) => {
    if (cardFilter.categoryId !== "all" && !(card.categoryIds || []).includes(cardFilter.categoryId)) return false;
    if (cardFilter.language !== "all" && card.language !== cardFilter.language) return false;
    if (cardFilter.setKey !== "all" && `${card.language}:${card.setId}` !== cardFilter.setKey) return false;
    return matchesKeyword(card, cardFilter.keyword);
  });
}

async function drawOwnedCards() {
  const filtered = await currentFilteredOwned();
  filtered.sort((a, b) => {
    const da = (a.card.dexNumbers || [])[0] || 9999;
    const db_ = (b.card.dexNumbers || [])[0] || 9999;
    if (da !== db_) return da - db_;
    return String(a.card.setId).localeCompare(String(b.card.setId));
  });

  lastFilteredCards = filtered;
  const shown = filtered.slice(0, cardFilter.limit);
  lastShownCards = shown;

  const copies = filtered.reduce((s, x) => s + x.own.count, 0);
  document.getElementById("col-result").innerHTML =
    `符合條件 <strong>${filtered.length}</strong> 張不同卡片，共 <strong>${copies}</strong> 張實體卡`
    + (filtered.length > cardFilter.limit ? `（目前顯示前 ${cardFilter.limit} 張）` : "");

  const host = document.getElementById("col-cards");
  host.innerHTML = shown.length
    ? shown.map(({ card, own }) => renderOwnedCardRow(card, own)).join("")
    : `<div class="empty-state">沒有符合條件的已收藏卡片</div>`;

  const more = document.getElementById("col-more");
  more.classList.toggle("hidden", filtered.length <= cardFilter.limit);

  renderCollectionBulk();
}

function renderOwnedCardRow(card, own) {
  const dex = (card.dexNumbers || [])[0];
  const sp = dex ? getSpecies(dex) : null;
  const cats = (card.categoryIds || [])
    .map((id) => getCategoryDef(id))
    .filter(Boolean);
  const numberLine = card.printedTotal ? `${card.cardNumber}/${card.printedTotal}` : card.cardNumber;
  return `
  <div class="owned-card-row${bulkMode && selection.has(card.id) ? " selected" : ""}" data-card-id="${escapeHtml(card.id)}">
    ${bulkMode ? renderSelectCheckbox(card.id, selection.has(card.id)) : ""}
    <img class="owned-card-img" src="${escapeHtml(card.imageSmall || PLACEHOLDER_IMAGE)}"
         alt="${escapeHtml(card.name)}" loading="lazy" ${imgFallbackAttr(card.remoteImageSmall)} />
    <div class="owned-card-body">
      <div class="owned-card-name">${escapeHtml(card.name)}</div>
      ${sp ? `<div class="ct-cell-species">${escapeHtml(sp.nameZh || sp.nameEn)}・No.${padDex(dex)}</div>` : ""}
      <div class="ct-cell-set">${escapeHtml(card.setName)} · ${escapeHtml(String(numberLine))}</div>
      <div class="ct-cell-tags">
        <span class="lang-tag">${escapeHtml(LANG_LABEL[card.language] || card.language)}</span>
        ${cats.map((c) => `<span class="mech-tag" style="border-color:${c.color};color:${c.color}">${escapeHtml(c.label)}</span>`).join("")}
      </div>
      ${own.note ? `<div class="owned-card-note">備註：${escapeHtml(own.note)}</div>` : ""}
    </div>
    <div class="owned-card-count"><strong>${own.count}</strong><span>張</span></div>
  </div>`;
}

function bindCollectionFilters() {
  const search = document.getElementById("col-search");
  search.addEventListener("input", debounce(() => {
    cardFilter.keyword = search.value.trim();
    cardFilter.limit = PAGE_SIZE;
    selection.clearOnFilterChange("搜尋條件已變更");
    drawOwnedCards();
  }, 200));

  for (const [id, key] of [["col-cat", "categoryId"], ["col-lang", "language"], ["col-set", "setKey"]]) {
    document.getElementById(id).addEventListener("change", (e) => {
      cardFilter[key] = e.target.value;
      cardFilter.limit = PAGE_SIZE;
      selection.clearOnFilterChange("篩選條件已變更");
      drawOwnedCards();
    });
  }

  document.getElementById("col-more").addEventListener("click", () => {
    cardFilter.limit += PAGE_SIZE;
    drawOwnedCards();
  });
}

// 工具列骨架：只有列表重畫或進出批量模式才呼叫。選取數量變動走 refreshCounts()。
function renderCollectionBulk() {
  const host = document.getElementById("col-bulk");
  if (!host) return;
  host.innerHTML = renderBulkBar({
    active: bulkMode,
    selected: selection.size,
    pageCount: lastShownCards.length,
    totalCount: lastFilteredCards.length,
    actionLabel: `清除已勾選的收藏（${selection.size}）`,
    actionId: "col-bulk-clear"
  });

  bindBulkBar(host, {
    onToggleMode: (on) => {
      bulkMode = on;
      if (!on) selection.clear();
      drawOwnedCards();
    },
    onSelectPage: () => {
      lastShownCards.forEach(({ card }) => selection.add(card.id));
      syncSelectionToDom(document.getElementById("col-cards"), selection);
      refreshCounts();
    },
    onSelectAll: () => {
      lastFilteredCards.forEach(({ card }) => selection.add(card.id));
      syncSelectionToDom(document.getElementById("col-cards"), selection);
      refreshCounts();
      showToast(`已選取全部篩選結果共 ${lastFilteredCards.length} 張（不只目前顯示的 ${lastShownCards.length} 張）`);
    },
    onClearSelection: () => {
      selection.clear();
      syncSelectionToDom(document.getElementById("col-cards"), selection);
      refreshCounts();
    }
  });

  const btn = document.getElementById("col-bulk-clear");
  if (btn) btn.addEventListener("click", () => openClearDialog("selected"));

  bindCheckboxDelegation(document.getElementById("col-cards"), selection, refreshCounts);
}

function refreshCounts() {
  refreshBulkBar(document.getElementById("col-bulk"), {
    selected: selection.size,
    actionLabel: `清除已勾選的收藏（${selection.size}）`,
    actionId: "col-bulk-clear"
  });
}

// ------------------------------------------------------------ 清除收藏

function bindClearEntry() {
  document.getElementById("clear-collection-btn").addEventListener("click", () => openClearDialog("all"));
  const undoBtn = document.getElementById("undo-clear-btn");
  if (undoBtn) undoBtn.addEventListener("click", doUndoClear);
}

async function doUndoClear() {
  await runOnce("undo-clear", async () => {
    try {
      let res = await restoreLastClear();
      if (res.missing) {
        showToast("沒有可以復原的清除紀錄");
        return;
      }
      if (res.conflicts.length > 0) {
        const ok = confirm(
          `有 ${res.conflicts.length} 張卡片在清除之後又被重新收藏過。\n\n` +
          `選擇「確定」＝用清除前的張數覆蓋這些卡片；\n` +
          `選擇「取消」＝保留你後來的收藏，只復原沒有衝突的 ${res.restored} 張。`
        );
        if (ok) {
          res = await restoreLastClear({ overwriteConflicts: true });
        }
      }
      showToast(`已復原 ${res.restored} 張卡片的收藏`
        + (res.restoredFlags ? `，以及 ${res.restoredFlags} 筆手動點亮紀錄` : ""));
      renderCollection();
    } catch (err) {
      showToast(`復原失敗：${err && err.message ? err.message : err}`, { duration: 12000 });
    }
  });
}

/**
 * 清除範圍對話框。
 * @param {"all"|"selected"} initialScope
 */
async function openClearDialog(initialScope) {
  const existing = document.getElementById("clear-dialog");
  if (existing) existing.remove();

  const ownership = await getAllOwnership();
  const manualFlags = (await getAllManualFlags()).filter((f) => f.active);
  const setsMeta = getAllSetsMeta();
  const owned = ownedCardList(ownership);

  const dlg = document.createElement("div");
  dlg.id = "clear-dialog";
  dlg.className = "modal-backdrop";
  dlg.innerHTML = `
    <div class="modal wide" role="dialog" aria-modal="true" aria-labelledby="clear-title">
      <h3 id="clear-title">清除收藏</h3>
      <p class="hint-text">
        清除的只有<strong>收藏狀態與持有張數</strong>。卡片資料、圖片、
        <strong>手動整理的分類</strong>、來源原始稀有度、備註與卡片 ID 全部保留。
      </p>

      <div class="clear-scope-list">
        <label class="clear-scope"><input type="radio" name="clear-scope" value="all" ${initialScope === "all" ? "checked" : ""} />
          <span><strong>全部收藏</strong><br /><small>不受目前搜尋或篩選限制，連同所有手動點亮紀錄一起歸零</small></span></label>
        <label class="clear-scope"><input type="radio" name="clear-scope" value="filtered" />
          <span><strong>目前篩選結果</strong><br /><small>只清除符合上方搜尋／分類／語言／卡包條件的收藏，包含未顯示的部分</small></span></label>
        <label class="clear-scope"><input type="radio" name="clear-scope" value="selected"
            ${selection.size === 0 ? "disabled" : ""} ${initialScope === "selected" ? "checked" : ""} />
          <span><strong>已勾選卡片</strong>${selection.size === 0 ? "（尚未勾選任何卡片）" : `（${selection.size} 張）`}<br />
          <small>只清除你在上面勾選的卡片</small></span></label>
        <label class="clear-scope"><input type="radio" name="clear-scope" value="custom" />
          <span><strong>指定條件</strong><br /><small>複選分類，並可加選語言與卡包；不同條件取交集，同條件內複選取聯集</small></span></label>
      </div>

      <div id="clear-custom" class="clear-custom hidden">
        <div class="clear-custom-label">分類（可複選，不選＝不限）</div>
        <div class="export-cat-grid">
          ${CARD_CATEGORY_DEFS.map((d) => {
            const n = owned.filter(({ card }) => (card.categoryIds || []).includes(d.id)).length;
            return `<label class="export-cat-item"><input type="checkbox" data-ccat="${d.id}" />
              <span>${escapeHtml(d.label)}</span><span class="export-cat-count">${n}</span></label>`;
          }).join("")}
        </div>
        <div class="cat-filter-row">
          <select id="clear-lang" class="cat-select"><option value="all">全部語言</option>
            ${Array.from(new Set(owned.map(({ card }) => card.language))).sort()
              .map((l) => `<option value="${l}">${escapeHtml(LANG_LABEL[l] || l)}</option>`).join("")}
          </select>
          <select id="clear-set" class="cat-select"><option value="all">全部卡包</option>
            ${Array.from(new Set(owned.map(({ card }) => `${card.language}:${card.setId}`)))
              .map((k) => `<option value="${escapeHtml(k)}">${escapeHtml((setsMeta[k] || {}).setName || k)}</option>`).join("")}
          </select>
        </div>
      </div>

      <label class="clear-flag-opt hidden" id="clear-flag-wrap">
        <input type="checkbox" id="clear-flags" />
        <span>同時清除「能明確對應到這個範圍」的手動點亮紀錄</span>
      </label>

      <div id="clear-summary" class="modal-summary">計算中…</div>

      <div class="clear-confirm hidden" id="clear-confirm-wrap">
        <label class="modal-label">這會清掉全部收藏，請輸入「<strong>清除全部</strong>」以確認
          <input type="text" id="clear-confirm-text" class="cat-search" autocomplete="off" />
        </label>
      </div>

      <div class="modal-actions">
        <button class="text-btn" data-action="backup">先下載 JSON 備份</button>
        <button class="text-btn" data-action="cancel">取消</button>
        <button class="danger-btn" data-action="confirm" disabled>執行清除</button>
      </div>
    </div>`;
  document.body.appendChild(dlg);

  const $ = (sel) => dlg.querySelector(sel);
  const scopeInputs = dlg.querySelectorAll('input[name="clear-scope"]');
  const confirmBtn = $('[data-action="confirm"]');
  let plan = null;

  async function recompute() {
    const scope = dlg.querySelector('input[name="clear-scope"]:checked')?.value || "all";
    $("#clear-custom").classList.toggle("hidden", scope !== "custom");
    $("#clear-confirm-wrap").classList.toggle("hidden", scope !== "all");
    $("#clear-flag-wrap").classList.toggle("hidden", scope === "all");
    plan = await buildClearPlan(scope, dlg, ownership, manualFlags);
    $("#clear-summary").innerHTML = renderPlanSummary(plan, scope);
    updateConfirmState();
  }

  function updateConfirmState() {
    const scope = dlg.querySelector('input[name="clear-scope"]:checked')?.value;
    const typed = $("#clear-confirm-text") ? $("#clear-confirm-text").value.trim() : "";
    const needsTyped = scope === "all";
    confirmBtn.disabled = !plan || plan.cardIds.length + plan.flagIds.length === 0
      || (needsTyped && typed !== "清除全部");
  }

  scopeInputs.forEach((i) => i.addEventListener("change", recompute));
  dlg.querySelectorAll("[data-ccat]").forEach((cb) => cb.addEventListener("change", recompute));
  $("#clear-lang").addEventListener("change", recompute);
  $("#clear-set").addEventListener("change", recompute);
  $("#clear-flags").addEventListener("change", recompute);
  $("#clear-confirm-text").addEventListener("input", updateConfirmState);

  $('[data-action="cancel"]').addEventListener("click", () => dlg.remove());
  dlg.addEventListener("click", (e) => {
    if (e.target === dlg) dlg.remove();
  });

  $('[data-action="backup"]').addEventListener("click", async () => {
    const data = await exportAllData();
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    downloadBlob(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
      `清除前備份_寶可夢PTCG收藏備份_${ts}.json`);
    showToast("已下載備份檔，裡面包含收藏紀錄與手動分類");
  });

  confirmBtn.addEventListener("click", async () => {
    if (!plan) return;
    // 這次要處理的目標在按下按鈕的當下就固定住，之後列表變動也不影響
    const targetCardIds = plan.cardIds.slice();
    const targetFlagIds = plan.flagIds.slice();
    confirmBtn.disabled = true;
    confirmBtn.textContent = "清除中…";
    const progress = $("#clear-summary");
    const res = await runOnce("clear-collection", async () => {
      try {
        const r = await bulkClearOwnership(targetCardIds, targetFlagIds, (done, total) => {
          if (progress) progress.innerHTML = `<div>清除中 ${done}/${total}…</div>`;
          confirmBtn.textContent = `清除中… ${Math.round((done / total) * 100)}%`;
        });
        dlg.remove();
        selection.clear();
        showToast(
          `已清除 ${r.clearedCards} 張卡片的收藏（共 ${r.clearedCopies} 張實體卡）`
            + (r.clearedFlags ? `，以及 ${r.clearedFlags} 筆手動點亮紀錄` : "")
            + "。卡片、圖片、分類與備註都保留。",
          { actionLabel: "復原這次清除", duration: 20000, onAction: doUndoClear }
        );
        renderCollection();
        return { ok: true };
      } catch (err) {
        confirmBtn.disabled = false;
        confirmBtn.textContent = "執行清除";
        showToast(`清除失敗，資料未變更：${err && err.message ? err.message : err}`, { duration: 15000 });
        return { ok: false };
      }
    });
    if (res && res.skipped) {
      confirmBtn.disabled = false;
      confirmBtn.textContent = "執行清除";
    }
  });

  await recompute();
}

/**
 * 依選定範圍算出「要清哪些卡、哪些手動點亮紀錄」。
 *
 * 手動點亮紀錄分兩種：
 *   species:<id>      整隻寶可夢的點亮，沒有語言／卡包／分類資訊
 *   cat:<id>:<catId>  某隻寶可夢的某個分類點亮，有分類但沒有語言／卡包
 * 所以只有在範圍能明確對應時才納入；對應不出來的一律保留並在摘要說明。
 */
async function buildClearPlan(scope, dlg, ownership, manualFlags) {
  const ownMap = new Map(ownership.map((o) => [o.cardId, o]));
  const ownedIds = ownership.filter((o) => o.count > 0).map((o) => o.cardId);
  let cardIds = [];
  let description = "";
  let flagIds = [];
  let unresolvedFlags = 0;

  if (scope === "all") {
    cardIds = ownedIds;
    flagIds = manualFlags.map((f) => f.id);
    description = "全部收藏（不受搜尋或篩選限制）";
  } else if (scope === "filtered") {
    const filtered = await currentFilteredOwned();
    cardIds = filtered.map(({ card }) => card.id);
    description = describeCollectionFilters();
  } else if (scope === "selected") {
    cardIds = selection.ids().filter((id) => (ownMap.get(id) || {}).count > 0);
    description = `已勾選的 ${selection.ids().length} 張卡片`;
  } else {
    const cats = Array.from(dlg.querySelectorAll("[data-ccat]:checked")).map((cb) => cb.getAttribute("data-ccat"));
    const lang = dlg.querySelector("#clear-lang").value;
    const setKey = dlg.querySelector("#clear-set").value;
    cardIds = ownedIds.filter((id) => {
      const card = getCard(id);
      if (!card) return false;
      if (cats.length > 0 && !cats.some((c) => (card.categoryIds || []).includes(c))) return false;
      if (lang !== "all" && card.language !== lang) return false;
      if (setKey !== "all" && `${card.language}:${card.setId}` !== setKey) return false;
      return true;
    });
    const parts = [];
    parts.push(cats.length ? `分類：${cats.map((c) => (getCategoryDef(c) || {}).label || c).join(" 或 ")}` : "分類：不限");
    parts.push(lang === "all" ? "語言：不限" : `語言：${LANG_LABEL[lang] || lang}`);
    parts.push(setKey === "all" ? "卡包：不限" : `卡包：${(getAllSetsMeta()[setKey] || {}).setName || setKey}`);
    description = parts.join("；");
  }

  // 局部範圍時，只有勾了選項才動手動點亮，而且只動「能明確對應」的那些
  if (scope !== "all") {
    const wantFlags = dlg.querySelector("#clear-flags")?.checked;
    if (wantFlags) {
      const affectedSpecies = new Set();
      for (const id of cardIds) {
        const card = getCard(id);
        for (const d of (card && card.dexNumbers) || []) affectedSpecies.add(d);
      }
      for (const f of manualFlags) {
        if (f.categoryId && affectedSpecies.has(f.speciesId)) {
          // cat: 類型且該寶可夢在範圍內 -> 能對應
          flagIds.push(f.id);
        } else if (!f.categoryId && affectedSpecies.has(f.speciesId)) {
          // species: 類型：沒有語言／卡包資訊，只有在「不限語言與卡包」時才算明確
          const lang = dlg.querySelector("#clear-lang")?.value || "all";
          const setKey = dlg.querySelector("#clear-set")?.value || "all";
          const narrowed = scope === "custom" ? (lang !== "all" || setKey !== "all") : scope !== "filtered";
          if (!narrowed) flagIds.push(f.id);
          else unresolvedFlags++;
        }
      }
    } else {
      unresolvedFlags = manualFlags.length;
    }
  }

  const copies = cardIds.reduce((sum, id) => sum + ((ownMap.get(id) || {}).count || 0), 0);
  return { cardIds, flagIds, copies, description, unresolvedFlags, totalFlags: manualFlags.length };
}

function describeCollectionFilters() {
  const parts = [];
  if (cardFilter.keyword) parts.push(`關鍵字「${cardFilter.keyword}」`);
  if (cardFilter.categoryId !== "all") parts.push(`分類：${(getCategoryDef(cardFilter.categoryId) || {}).label}`);
  if (cardFilter.language !== "all") parts.push(`語言：${LANG_LABEL[cardFilter.language] || cardFilter.language}`);
  if (cardFilter.setKey !== "all") parts.push(`卡包：${(getAllSetsMeta()[cardFilter.setKey] || {}).setName || cardFilter.setKey}`);
  return parts.length ? parts.join("；") : "目前沒有設定任何篩選（等同全部已收藏卡片）";
}

function renderPlanSummary(plan, scope) {
  const lines = [];
  lines.push(`<div><strong>清除範圍</strong>：${escapeHtml(plan.description)}</div>`);
  lines.push(`<div>受影響的<strong>不同卡片</strong>：<strong>${plan.cardIds.length}</strong> 張</div>`);
  lines.push(`<div>即將清除的<strong>持有總張數</strong>：<strong>${plan.copies}</strong> 張</div>`);
  lines.push(`<div>受影響的<strong>手動點亮紀錄</strong>：<strong>${plan.flagIds.length}</strong> 筆`
    + (scope === "all" ? "（全部）" : "") + "</div>");
  if (scope !== "all" && plan.unresolvedFlags > 0) {
    lines.push(`<div class="warn-line">有 ${plan.unresolvedFlags} 筆手動點亮紀錄無法明確對應到這個範圍`
      + `（整隻寶可夢的點亮沒有語言／卡包資訊），<strong>會保留不動</strong>，不會用猜的刪掉。</div>`);
  }
  if (scope !== "all") {
    lines.push(`<div class="hint-text">局部清除後，如果該寶可夢還有其他已收藏卡片或手動點亮紀錄，圖鑑上仍然會維持點亮。</div>`);
  }
  lines.push(`<div class="hint-text">卡片、圖片、手動分類、原始稀有度與備註都會保留。</div>`);
  if (plan.cardIds.length + plan.flagIds.length === 0) {
    lines.push(`<div class="warn-line">這個範圍目前沒有任何可清除的收藏。</div>`);
  }
  return lines.join("");
}
