// 「卡片分類」頁：依 AR／SR／SAR／CSR／CHR／HR／UR／PR／普通卡／其他／待確認
// 跨寶可夢、跨卡包瀏覽卡片。
//
// 分類規則本身不寫在這裡，一律取自 js/cardCategories.js（集中管理），
// 這一頁只負責呈現與互動。
//
// 收藏資料與圖鑑頁、我的收藏頁共用同一份 IndexedDB（cardOwnership），
// 在這裡加減張數等同在詳細頁加減，兩邊即時同步。
import { getAllCards, getCard, getSpecies, getAllSetsMeta } from "../data.js";
import {
  CARD_CATEGORY_DEFS,
  getCategoryDef,
  rarityRuleInfo,
  CONFIDENCE_LABEL
} from "../cardCategories.js";
import { getAllOwnership, getOwnership, setOwnership } from "../db.js";
import { escapeHtml, imgFallbackAttr, debounce, padDex, showToast, PLACEHOLDER_IMAGE } from "../utils.js";
import { renderCategoryPicker, bindCategoryPickers } from "../components/categoryPicker.js";
import {
  createSelection, renderSelectCheckbox, renderBulkBar,
  bindBulkBar, bindCheckboxes, runOnce
} from "../components/bulkSelect.js";
import { bulkSetCategoryOverride, bulkRestoreCategoryOverrides } from "../db.js";
import { applyCategoryOverrides } from "../data.js";

const PAGE_SIZE = 120;

// 這一頁的篩選狀態保留在記憶體裡，從分類清單進出時不會被重設。
const filterState = {
  categoryId: null,
  keyword: "",
  owned: "all", // all | owned | missing
  language: "all",
  setKey: "all",
  sort: "dex", // dex | number
  limit: PAGE_SIZE
};

// 批量編輯狀態。選取的卡片 id 放在 selection，切分類／改篩選時會被清掉。
const selection = createSelection();
let bulkMode = false;
// 目前這次 draw() 算出來的結果，批量按鈕要用（例如「選取全部篩選結果」）
let lastFiltered = [];
let lastShown = [];

function cardsInCategory(categoryId) {
  return getAllCards().filter((c) => (c.categoryIds || []).includes(categoryId));
}

// ---------------------------------------------------------------- 分類清單頁

export async function renderCardTypes() {
  const app = document.getElementById("app");
  const ownership = await getAllOwnership();
  const ownedIds = new Set(ownership.filter((o) => o.count > 0).map((o) => o.cardId));

  const cards = getAllCards();
  // 一張卡可能同時屬於多個分類（例如帶稀有度的宣傳卡），統計時各分類各自計數，
  // 但底下的「總計」一律用不重複的卡片 id，避免重複加總。
  const stats = {};
  for (const def of CARD_CATEGORY_DEFS) stats[def.id] = { total: 0, owned: 0 };
  const countedCards = new Set();
  const countedOwned = new Set();
  for (const card of cards) {
    for (const cid of card.categoryIds || []) {
      if (!stats[cid]) continue;
      stats[cid].total += 1;
      if (ownedIds.has(card.id)) stats[cid].owned += 1;
    }
    countedCards.add(card.id);
    if (ownedIds.has(card.id)) countedOwned.add(card.id);
  }

  const sumOfCategories = Object.values(stats).reduce((a, b) => a + b.total, 0);
  const overlap = sumOfCategories - countedCards.size;

  app.innerHTML = `
    <header class="page-header">
      <h1>卡片分類</h1>
      <p class="subtitle">依卡片稀有度分類瀏覽，跨寶可夢與卡包</p>
      <div class="export-radio-row">
        <a class="primary-btn" href="#/export" style="text-decoration:none">📤 匯出卡表（Excel／Word）</a>
      </div>
    </header>

    <section class="cat-browse-grid">
      ${CARD_CATEGORY_DEFS.map((def) => {
        const st = stats[def.id];
        const empty = st.total === 0;
        return `
        <a class="cat-browse-tile${empty ? " empty" : ""}"
           href="#/types/${encodeURIComponent(def.id)}"
           style="--badge-color:${def.color}">
          <div class="cat-browse-head">
            <span class="cat-browse-label">${escapeHtml(def.label)}</span>
          </div>
          ${
            empty
              ? `<div class="cat-browse-empty">${def.manualOnly ? "0 張／尚未加入卡片" : "目前尚未收錄"}</div>`
              : `<div class="cat-browse-nums">
                   <strong>${st.owned}</strong>
                   <span class="cat-browse-denom">/ ${st.total}</span>
                 </div>
                 <div class="cat-browse-sub">已收藏 / 收錄張數</div>`
          }
          <div class="cat-browse-desc">${escapeHtml(def.description)}</div>
        </a>`;
      }).join("")}
    </section>

    <section class="cat-browse-note">
      <p class="hint-text">
        「收錄張數」是目前 App 資料庫內該分類的卡片數，不是官方全卡表的總數。
        「已收藏」計算的是持有張數大於 0 的<strong>不同卡片</strong>數，同一張卡收了幾張都只算一個。
      </p>
      <p class="hint-text">
        宣傳卡身分與稀有度並存，所以有 ${overlap} 張卡同時出現在「PR／PROMO」與它的稀有度分類裡。
        各分類數字相加是 ${sumOfCategories}，實際不重複卡片數是 ${countedCards.size} 張
        （已收藏不重複 ${countedOwned.size} 張），統計不會重複計算。
      </p>
      <p class="hint-text">
        ex／V／VMAX／VSTAR 是卡片機制標籤，不是稀有度，所以不會出現在這裡，
        而是顯示在每張卡的標籤列。分類規則集中在 <code>js/cardCategories.js</code>。
      </p>
    </section>
  `;
}

// ---------------------------------------------------------------- 分類內容頁

export async function renderCardTypeDetail(params) {
  const categoryId = params.id;
  const def = getCategoryDef(categoryId);
  const app = document.getElementById("app");

  if (!def) {
    app.innerHTML = `<div class="empty-state">找不到這個分類</div>`;
    return;
  }

  if (filterState.categoryId !== categoryId) {
    // 換到另一個分類時才重設條件，回到同一個分類會保留剛才的篩選
    selection.clearOnFilterChange("已切換分類");
    filterState.categoryId = categoryId;
    filterState.keyword = "";
    filterState.owned = "all";
    filterState.language = "all";
    filterState.setKey = "all";
    filterState.sort = "dex";
  }
  filterState.limit = PAGE_SIZE;

  const all = cardsInCategory(categoryId);
  const setsMeta = getAllSetsMeta();

  if (all.length === 0) {
    app.innerHTML = `
      <header class="page-header">
        <a class="back-link" href="#/types">← 卡片分類</a>
        <h1>${escapeHtml(def.label)}</h1>
      </header>
      <div class="empty-state">
        ${def.manualOnly ? "0 張／尚未加入卡片" : "目前尚未收錄"}<br />
        <span class="hint-text">${
          def.manualOnly
            ? "這是只能手動加入的分類，系統不會自動把卡片放進來。要加卡片：到別的分類頁開啟「批量編輯」，勾選卡片後按「移動到分類…」選這一類；或在單張卡片下方的分類選單直接指定。"
            : "這不代表這個分類不存在，只是目前資料庫還沒有收到這一類的卡片。"
        }</span>
      </div>`;
    return;
  }

  const languages = Array.from(new Set(all.map((c) => c.language))).sort();
  const setKeys = Array.from(new Set(all.map((c) => `${c.language}:${c.setId}`)))
    .map((k) => ({ key: k, name: (setsMeta[k] || {}).setName || k.split(":")[1] }))
    .sort((a, b) => a.name.localeCompare(b.name, "ja"));

  app.innerHTML = `
    <header class="page-header">
      <a class="back-link" href="#/types">← 卡片分類</a>
      <h1><span class="cat-title-dot" style="background:${def.color}"></span>${escapeHtml(def.label)}</h1>
      <p class="subtitle">${escapeHtml(def.description)}</p>
    </header>

    <section class="cat-filter-bar">
      <input id="ct-search" class="cat-search" type="search"
             placeholder="搜尋寶可夢名稱、卡片名稱或卡號"
             value="${escapeHtml(filterState.keyword)}" />
      <div class="cat-filter-row">
        <div class="seg-group" id="ct-owned">
          <button data-v="all" class="seg-btn">全部</button>
          <button data-v="owned" class="seg-btn">已收藏</button>
          <button data-v="missing" class="seg-btn">未收藏</button>
        </div>
        <select id="ct-lang" class="cat-select">
          <option value="all">全部語言</option>
          ${languages.map((l) => `<option value="${l}">${escapeHtml(languageLabel(l))}</option>`).join("")}
        </select>
        <select id="ct-set" class="cat-select">
          <option value="all">全部卡包</option>
          ${setKeys.map((s) => `<option value="${escapeHtml(s.key)}">${escapeHtml(s.name)}</option>`).join("")}
        </select>
        <select id="ct-sort" class="cat-select">
          <option value="dex">依圖鑑編號</option>
          <option value="number">依卡包／卡號</option>
        </select>
      </div>
      <div class="cat-result-line" id="ct-result"></div>
      <div id="ct-bulk"></div>
    </section>

    <section class="cat-card-grid" id="ct-grid"></section>
    <div class="cat-more-wrap"><button id="ct-more" class="text-btn hidden">載入更多</button></div>
  `;

  // 還原目前的篩選狀態到控制項上
  document.getElementById("ct-lang").value = filterState.language;
  document.getElementById("ct-set").value = filterState.setKey;
  document.getElementById("ct-sort").value = filterState.sort;
  syncSegButtons();

  bindFilters();
  await draw();
}

function syncSegButtons() {
  document.querySelectorAll("#ct-owned .seg-btn").forEach((b) => {
    b.classList.toggle("active", b.getAttribute("data-v") === filterState.owned);
  });
}

function bindFilters() {
  const search = document.getElementById("ct-search");
  search.addEventListener(
    "input",
    debounce(() => {
      filterState.keyword = search.value.trim();
      filterState.limit = PAGE_SIZE;
      selection.clearOnFilterChange("搜尋條件已變更");
      draw();
    }, 200)
  );

  document.getElementById("ct-owned").addEventListener("click", (e) => {
    const btn = e.target.closest(".seg-btn");
    if (!btn) return;
    filterState.owned = btn.getAttribute("data-v");
    filterState.limit = PAGE_SIZE;
    selection.clearOnFilterChange("篩選條件已變更");
    syncSegButtons();
    draw();
  });

  for (const [id, key] of [["ct-lang", "language"], ["ct-set", "setKey"], ["ct-sort", "sort"]]) {
    document.getElementById(id).addEventListener("change", (e) => {
      filterState[key] = e.target.value;
      filterState.limit = PAGE_SIZE;
      // 排序改變不影響選取內容，只有真的改變「有哪些卡」的條件才清空
      if (key !== "sort") selection.clearOnFilterChange("篩選條件已變更");
      draw();
    });
  }

  document.getElementById("ct-more").addEventListener("click", () => {
    filterState.limit += PAGE_SIZE;
    draw();
  });
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
    if (String(dex) === kw || padDex(dex) === kw) return true;
  }
  return false;
}

function numericPart(value) {
  const m = String(value || "").match(/(\d+)/);
  return m ? parseInt(m[1], 10) : Number.MAX_SAFE_INTEGER;
}

async function draw() {
  const ownership = await getAllOwnership();
  const ownMap = new Map(ownership.map((o) => [o.cardId, o]));

  const all = cardsInCategory(filterState.categoryId);
  const filtered = all.filter((card) => {
    if (filterState.language !== "all" && card.language !== filterState.language) return false;
    if (filterState.setKey !== "all" && `${card.language}:${card.setId}` !== filterState.setKey) return false;
    const own = ownMap.get(card.id);
    const isOwned = !!own && own.count > 0;
    if (filterState.owned === "owned" && !isOwned) return false;
    if (filterState.owned === "missing" && isOwned) return false;
    return matchesKeyword(card, filterState.keyword);
  });

  filtered.sort((a, b) => {
    if (filterState.sort === "dex") {
      const da = (a.dexNumbers || [])[0] || 9999;
      const db_ = (b.dexNumbers || [])[0] || 9999;
      if (da !== db_) return da - db_;
    }
    if (a.setId !== b.setId) return String(a.setId).localeCompare(String(b.setId));
    return numericPart(a.cardNumber) - numericPart(b.cardNumber);
  });

  const ownedCount = filtered.filter((c) => (ownMap.get(c.id) || {}).count > 0).length;
  document.getElementById("ct-result").innerHTML =
    `符合條件 <strong>${filtered.length}</strong> 張，其中已收藏 <strong>${ownedCount}</strong> 張`
    + (filtered.length > filterState.limit ? `（目前顯示前 ${filterState.limit} 張）` : "");

  const shown = filtered.slice(0, filterState.limit);
  lastFiltered = filtered;
  lastShown = shown;

  const grid = document.getElementById("ct-grid");
  grid.innerHTML = shown.length
    ? shown.map((card) => renderCardCell(card, ownMap.get(card.id))).join("")
    : `<div class="empty-state">沒有符合條件的卡片</div>`;

  renderBulkControls();

  const more = document.getElementById("ct-more");
  more.classList.toggle("hidden", filtered.length <= filterState.limit);

  bindCellEvents();
  // 改完分類後整頁重畫：這張卡可能已經不屬於目前這個分類了，要從清單移除，
  // 上方的「符合條件 N 張」也要跟著更新。
  bindCategoryPickers(grid, () => draw());
}

function renderCardCell(card, own) {
  const count = own ? own.count : 0;
  const owned = count > 0;
  const dex = (card.dexNumbers || [])[0];
  const sp = dex ? getSpecies(dex) : null;
  const rule = rarityRuleInfo(card);
  const numberLine = card.printedTotal
    ? `${escapeHtml(card.cardNumber)}/${card.printedTotal}`
    : escapeHtml(card.cardNumber);

  return `
  <div class="ct-cell${owned ? " owned" : ""}${bulkMode && selection.has(card.id) ? " selected" : ""}" data-card-id="${escapeHtml(card.id)}">
    ${bulkMode ? renderSelectCheckbox(card.id, selection.has(card.id)) : ""}
    <a class="ct-cell-img-link" href="${dex ? `#/pokemon/${dex}` : "#/types"}"
       title="${dex ? "開啟詳細頁" : "這張卡沒有對應的寶可夢圖鑑編號"}">
      <img class="ct-cell-img" src="${escapeHtml(card.imageSmall || PLACEHOLDER_IMAGE)}"
           alt="${escapeHtml(card.name)}" loading="lazy" ${imgFallbackAttr(card.remoteImageSmall)} />
      ${owned ? `<span class="ct-owned-flag">已收藏</span>` : ""}
    </a>
    <div class="ct-cell-body">
      <div class="ct-cell-name">${escapeHtml(card.name)}</div>
      ${sp ? `<div class="ct-cell-species">${escapeHtml(sp.nameZh || sp.nameEn)}・No.${padDex(dex)}</div>` : ""}
      <div class="ct-cell-set">${escapeHtml(card.setName)} · ${numberLine}</div>
      <div class="ct-cell-tags">
        <span class="lang-tag">${escapeHtml(languageLabel(card.language))}</span>
        <span class="rarity-tag" title="原始稀有度（來源資料庫用語）">${
          card.originalRarity ? escapeHtml(card.originalRarity) : "稀有度資料尚未提供"
        }</span>
        ${(card.tags || []).map((t) => `<span class="mech-tag">${escapeHtml(t)}</span>`).join("")}
      </div>
      ${
        card.categoryOverrideId
          ? `<div class="ct-cell-manual">手動指定</div>`
          : rule.confidence !== "printed"
          ? `<div class="ct-cell-confidence" title="${escapeHtml(rule.note)}">${escapeHtml(
              CONFIDENCE_LABEL[rule.confidence] || rule.confidence
            )}</div>`
          : ""
      }
      ${renderCategoryPicker(card, { compact: true })}
    </div>
    <div class="ct-cell-owner">
      <button class="count-btn" data-action="dec" aria-label="減少一張">－</button>
      <span class="count-value">${count}</span>
      <button class="count-btn" data-action="inc" aria-label="增加一張">＋</button>
    </div>
  </div>`;
}

function bindCellEvents() {
  document.querySelectorAll(".ct-cell").forEach((cell) => {
    const cardId = cell.getAttribute("data-card-id");
    const valueEl = cell.querySelector(".count-value");

    const apply = async (next, { toastOnZero = false } = {}) => {
      const card = getCard(cardId);
      if (!card) return;
      const existing = await getOwnership(cardId);
      const before = existing ? existing.count : 0;
      await setOwnership({
        cardId,
        speciesIds: card.dexNumbers,
        categoryId: card.categoryId,
        count: next,
        // 一定要把原本的備註帶回去，不然在這一頁加減張數會把詳細頁寫的備註清掉
        note: existing ? existing.note : ""
      });
      valueEl.textContent = next;
      cell.classList.toggle("owned", next > 0);
      const flag = cell.querySelector(".ct-owned-flag");
      if (next > 0 && !flag) {
        cell.querySelector(".ct-cell-img-link").insertAdjacentHTML(
          "beforeend", `<span class="ct-owned-flag">已收藏</span>`
        );
      } else if (next === 0 && flag) {
        flag.remove();
      }
      await refreshResultLine();
      if (toastOnZero && before > 0 && next === 0) {
        showToast("已將這張卡片的收藏張數歸零", {
          actionLabel: "復原",
          onAction: () => apply(before)
        });
      }
    };

    cell.querySelector('[data-action="inc"]').addEventListener("click", () => {
      apply(parseInt(valueEl.textContent, 10) + 1);
    });
    cell.querySelector('[data-action="dec"]').addEventListener("click", () => {
      const cur = parseInt(valueEl.textContent, 10);
      apply(Math.max(0, cur - 1), { toastOnZero: true });
    });
  });
}

// 只更新統計那一行，不重畫整個網格（重畫會讓使用者捲動位置跑掉）
async function refreshResultLine() {
  const ownership = await getAllOwnership();
  const ownMap = new Map(ownership.map((o) => [o.cardId, o]));
  const all = cardsInCategory(filterState.categoryId);
  const filtered = all.filter((card) => {
    if (filterState.language !== "all" && card.language !== filterState.language) return false;
    if (filterState.setKey !== "all" && `${card.language}:${card.setId}` !== filterState.setKey) return false;
    const own = ownMap.get(card.id);
    const isOwned = !!own && own.count > 0;
    if (filterState.owned === "owned" && !isOwned) return false;
    if (filterState.owned === "missing" && isOwned) return false;
    return matchesKeyword(card, filterState.keyword);
  });
  const ownedCount = filtered.filter((c) => (ownMap.get(c.id) || {}).count > 0).length;
  const el = document.getElementById("ct-result");
  if (el) {
    el.innerHTML =
      `符合條件 <strong>${filtered.length}</strong> 張，其中已收藏 <strong>${ownedCount}</strong> 張`
      + (filtered.length > filterState.limit ? `（目前顯示前 ${filterState.limit} 張）` : "");
  }
}

// ------------------------------------------------------------- 批量編輯

function renderBulkControls() {
  const host = document.getElementById("ct-bulk");
  if (!host) return;
  host.innerHTML = renderBulkBar({
    active: bulkMode,
    selected: selection.size,
    pageCount: lastShown.length,
    totalCount: lastFiltered.length,
    actionLabel: `移動到分類…（${selection.size}）`,
    actionId: "ct-bulk-move"
  });

  bindBulkBar(host, {
    onToggleMode: (on) => {
      bulkMode = on;
      if (!on) selection.clear();
      draw();
    },
    onSelectPage: () => {
      lastShown.forEach((c) => selection.add(c.id));
      draw();
    },
    onSelectAll: () => {
      lastFiltered.forEach((c) => selection.add(c.id));
      showToast(`已選取全部篩選結果共 ${lastFiltered.length} 張（不只目前顯示的 ${lastShown.length} 張）`);
      draw();
    },
    onClearSelection: () => {
      selection.clear();
      draw();
    }
  });

  const moveBtn = document.getElementById("ct-bulk-move");
  if (moveBtn) moveBtn.addEventListener("click", openMoveDialog);

  const grid = document.getElementById("ct-grid");
  if (grid) bindCheckboxes(grid, selection, () => renderBulkControls());
  // 只重畫工具列上的數字時，卡片格的樣式也要跟著更新
  if (grid) {
    grid.querySelectorAll(".ct-cell").forEach((cell) => {
      cell.classList.toggle("selected", selection.has(cell.getAttribute("data-card-id")));
    });
  }
}

function openMoveDialog() {
  if (selection.size === 0) return;
  const ids = selection.ids();
  const existing = document.getElementById("bulk-move-dialog");
  if (existing) existing.remove();

  const dlg = document.createElement("div");
  dlg.id = "bulk-move-dialog";
  dlg.className = "modal-backdrop";
  dlg.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="bulk-move-title">
      <h3 id="bulk-move-title">移動 ${ids.length} 張卡片到分類</h3>
      <p class="hint-text">只會變更這 ${ids.length} 張卡片的<strong>手動分類</strong>。
        收藏狀態、持有張數、備註、卡片 ID、原始稀有度與圖片都不會被動到。</p>
      <label class="modal-label">目標分類
        <select id="bulk-move-target" class="cat-select">
          ${CARD_CATEGORY_DEFS.map((d) => `<option value="${d.id}">${escapeHtml(d.label)}</option>`).join("")}
        </select>
      </label>
      <div id="bulk-move-summary" class="modal-summary"></div>
      <div class="modal-actions">
        <button class="text-btn" data-action="cancel">取消</button>
        <button class="primary-btn" data-action="confirm">確認移動</button>
      </div>
    </div>`;
  document.body.appendChild(dlg);

  const select = dlg.querySelector("#bulk-move-target");
  const summary = dlg.querySelector("#bulk-move-summary");
  const updateSummary = () => {
    const def = getCategoryDef(select.value);
    summary.innerHTML = `即將把 <strong>${ids.length}</strong> 張卡片移動到
      <strong>${escapeHtml(def ? def.label : select.value)}</strong>。`;
  };
  updateSummary();
  select.addEventListener("change", updateSummary);

  dlg.querySelector('[data-action="cancel"]').addEventListener("click", () => dlg.remove());
  dlg.addEventListener("click", (e) => {
    if (e.target === dlg) dlg.remove();
  });

  const confirmBtn = dlg.querySelector('[data-action="confirm"]');
  confirmBtn.addEventListener("click", async () => {
    const target = select.value;
    confirmBtn.disabled = true;
    confirmBtn.textContent = "移動中…";
    const res = await runOnce("bulk-move", async () => {
      try {
        // 整批寫在同一個 IndexedDB 交易裡：全成功或全不生效
        const { moved, before } = await bulkSetCategoryOverride(ids, target);
        await applyCategoryOverrides();
        dlg.remove();
        selection.clear();
        await draw();
        const def = getCategoryDef(target);
        showToast(`已將 ${moved} 張卡片移動到「${def ? def.label : target}」`, {
          actionLabel: "復原這次移動",
          duration: 15000,
          onAction: async () => {
            await runOnce("bulk-move-undo", async () => {
              try {
                const n = await bulkRestoreCategoryOverrides(before);
                await applyCategoryOverrides();
                await draw();
                showToast(`已復原 ${n} 張卡片的分類`);
              } catch (err) {
                showToast(`復原失敗：${err && err.message ? err.message : err}`, { duration: 12000 });
              }
            });
          }
        });
        return { ok: true };
      } catch (err) {
        confirmBtn.disabled = false;
        confirmBtn.textContent = "確認移動";
        showToast(`移動失敗，資料未變更：${err && err.message ? err.message : err}`, {
          actionLabel: "重試",
          duration: 15000,
          onAction: () => confirmBtn.click()
        });
        return { ok: false };
      }
    });
    if (res && res.skipped) {
      confirmBtn.disabled = false;
      confirmBtn.textContent = "確認移動";
    }
  });
}

function languageLabel(lang) {
  const map = { en: "英文版（美版）", ja: "日文版", "zh-Hant": "繁體中文版", "zh-Hans": "簡體中文版" };
  return map[lang] || lang;
}

/**
 * 把目前這一頁的篩選條件交給「匯出卡表」頁沿用。
 * 連 matcher 一起傳出去，關鍵字比對規則才不會兩邊各寫一份而慢慢走樣。
 */
export function getLastFilterContext() {
  if (!filterState.categoryId) return null;
  const def = getCategoryDef(filterState.categoryId);
  const setsMeta = getAllSetsMeta();
  return {
    categoryId: filterState.categoryId,
    categoryLabel: def ? def.label : filterState.categoryId,
    keyword: filterState.keyword,
    owned: filterState.owned,
    language: filterState.language,
    setKey: filterState.setKey,
    setName:
      filterState.setKey !== "all"
        ? (setsMeta[filterState.setKey] || {}).setName || filterState.setKey
        : "",
    matcher: matchesKeyword
  };
}
