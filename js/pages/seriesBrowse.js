// 「系列／卡包」瀏覽頁：大系列 → 卡包 → 卡片，並支援交叉篩選。
//
// 這一頁跟「卡片分類」頁是互補的：那邊依稀有度分類找卡，這邊依實體產品線找卡。
// 兩邊共用同一份收藏與分類資料，改哪一邊另一邊都會同步。
//
// 效能：系列與卡包的索引由 js/seriesCatalog.js 建一次（Map），這一頁只在
// 索引上查表，不會每次點選都掃全部 15,846 張卡。
import { getAllCards, getSpecies, getAllSetsMeta } from "../data.js";
import { isAppMode } from "../appMode.js";
import { label, markLabelForMode } from "../appLabels.js";
import {
  getSeriesList, getSetsOfSeries, getCardsOfSet, getSeriesDisplay,
  seriesOfCard, getRegulationMark, markLabel, getAllMarks, MARK_STATUS,
  SET_SORT, getSetSort, setSetSort, sortSets, formatReleaseDate, hasValidReleaseDate
} from "../seriesCatalog.js";
import { CARD_CATEGORY_DEFS, getCategoryDef } from "../cardCategories.js";
import { getAllOwnership, getSetting, setSetting } from "../db.js";
import { escapeHtml, padDex, debounce, imgFallbackAttr, PLACEHOLDER_IMAGE } from "../utils.js";

const LANG_LABEL = { en: "英文版（美版）", ja: "日文版", "zh-Hant": "繁體中文版", "zh-Hans": "簡體中文版" };
const PAGE_SIZE = 120;

// 這一頁的篩選狀態。切換大系列時，如果原本選的卡包不屬於新系列就會被清掉，
// 避免出現「朱＆紫 + 劍盾的卡包」這種不可能成立的組合。
const f = {
  seriesId: "all",
  setKey: "all",
  language: "all",
  mark: "all",
  categoryId: "all",
  owned: "all",
  keyword: "",
  limit: PAGE_SIZE
};

let lastFiltered = [];

// ------------------------------------------------------------- 系列清單頁

export async function renderSeriesBrowse() {
  const app = document.getElementById("app");
  const seriesList = getSeriesList();
  const ownership = await getAllOwnership();
  const ownedIds = new Set(ownership.filter((o) => o.count > 0).map((o) => o.cardId));

  const ownedBySeries = {};
  for (const card of getAllCards()) {
    if (!ownedIds.has(card.id)) continue;
    const sid = seriesOfCard(card);
    ownedBySeries[sid] = (ownedBySeries[sid] || 0) + 1;
  }

  app.innerHTML = `
    <header class="page-header">
      <h1>系列／卡包</h1>
      <p class="subtitle">依實際產品線瀏覽：大系列 → 卡包 → 卡片</p>
    </header>

    <section class="cat-browse-grid">
      ${seriesList.map((s) => `
        <a class="cat-browse-tile" href="#/sets/${encodeURIComponent(s.id)}" style="--badge-color:#4f8cff">
          <div class="cat-browse-head"><span class="cat-browse-label">${escapeHtml(label(s.zh) || s.zh)}</span></div>
          <div class="cat-browse-nums"><strong>${ownedBySeries[s.id] || 0}</strong>
            <span class="cat-browse-denom">/ ${s.cardCount}</span></div>
          <div class="cat-browse-sub">已收藏 / 收錄張數</div>
          <div class="cat-browse-desc">
            ${escapeHtml(s.en)}${s.ja ? `／${escapeHtml(s.ja)}` : ""}<br />
            ${s.setCount} 個卡包・${Array.from(s.languages).map((l) => escapeHtml(LANG_LABEL[l] || l)).join("、")}
          </div>
        </a>`).join("")}
    </section>

    <section class="cat-browse-note">
      <p class="hint-text">系列歸屬一律以<strong>卡包所屬的系列</strong>判定，不看卡片名稱 ——
        卡名含「メガ／Mega／M」不代表它屬於超級進化系列。</p>
      <p class="hint-text">同名但不同語言的卡包各自保留自己的卡包代碼與穩定 ID，不會被合併；
        進去之後可以再用語言篩選。</p>
      <div class="export-radio-row">
        <a class="primary-btn" href="#/sets/all" style="text-decoration:none">🔍 跨系列交叉篩選全部卡片</a>
      </div>
    </section>
  `;
}

// ------------------------------------------------------------- 系列內容頁

export async function renderSeriesDetail(params) {
  const app = document.getElementById("app");
  const seriesId = params.id;

  if (f.seriesId !== seriesId) {
    f.seriesId = seriesId;
    // 換系列時，原本選的卡包若不屬於新系列就清掉
    const valid = seriesId === "all"
      ? true
      : getSetsOfSeries(seriesId).some((s) => s.setKey === f.setKey);
    if (!valid) f.setKey = "all";
    f.limit = PAGE_SIZE;
  }

  const disp = seriesId === "all"
    ? { zh: "全部系列", en: "All series", ja: "" }
    : getSeriesDisplay(seriesId);
  // 先把「全部符合條件的卡包」排好，再做選單與列表，不是只排目前顯示那一批
  const setsOfSeries = sortSets(
    seriesId === "all"
      ? getSeriesList().flatMap((s) => getSetsOfSeries(s.id))
      : getSetsOfSeries(seriesId).slice(),
    getSetSort()
  );
  const undatedCount = setsOfSeries.filter((s) => !hasValidReleaseDate(s)).length;

  const marks = getAllMarks();

  app.innerHTML = `
    <header class="page-header">
      <a class="back-link" href="#/sets">← 系列／卡包</a>
      <h1>${escapeHtml(disp.zh)}</h1>
      <p class="subtitle">${escapeHtml(disp.en || "")}${disp.ja ? `／${escapeHtml(disp.ja)}` : ""}</p>
    </header>

    <section class="cat-filter-bar">
      <input id="sb-search" class="cat-search" type="search"
             placeholder="搜尋寶可夢名稱、卡片名稱或卡號" value="${escapeHtml(f.keyword)}" />
      <div class="cat-filter-row">
        <select id="sb-series" class="cat-select">
          <option value="all">全部系列</option>
          ${getSeriesList().map((s) => `<option value="${s.id}">${escapeHtml(s.zh)}</option>`).join("")}
        </select>
        <select id="sb-set" class="cat-select">
          <option value="all">全部卡包（${setsOfSeries.length}）</option>
          ${setsOfSeries.map((s) => `
            <option value="${escapeHtml(s.setKey)}">${escapeHtml(formatReleaseDate(s))}｜${escapeHtml(s.setName)}（${escapeHtml(s.setId)}・${escapeHtml(LANG_LABEL[s.language] || s.language)}）</option>
          `).join("")}
        </select>
        <select id="sb-lang" class="cat-select">
          <option value="all">全部語言</option>
          ${Array.from(new Set(setsOfSeries.map((s) => s.language))).map((l) =>
            `<option value="${l}">${escapeHtml(LANG_LABEL[l] || l)}</option>`).join("")}
        </select>
        <select id="sb-setsort" class="cat-select">
          <option value="${SET_SORT.NEWEST}">卡包：由新到舊</option>
          <option value="${SET_SORT.OLDEST}">卡包：由舊到新</option>
        </select>
      </div>

      <details class="set-list-block"${f.setKey !== "all" ? "" : ""}>
        <summary>這個範圍內的卡包（${setsOfSeries.length}）${
          undatedCount ? `・其中 ${undatedCount} 個發售日期待確認，固定排最後` : ""}</summary>
        <div class="set-list">
          ${setsOfSeries.map((s) => `
            <button class="set-list-item${f.setKey === s.setKey ? " active" : ""}" data-setkey="${escapeHtml(s.setKey)}">
              <span class="set-list-date${hasValidReleaseDate(s) ? "" : " undated"}">${escapeHtml(formatReleaseDate(s))}</span>
              <span class="set-list-name">${escapeHtml(s.setName)}</span>
              <span class="set-list-meta">${escapeHtml(s.setId)}・${escapeHtml(LANG_LABEL[s.language] || s.language)}・${s.cardCount} 張</span>
            </button>`).join("")}
        </div>
      </details>
      <div class="cat-filter-row">
        <select id="sb-mark" class="cat-select">
          <option value="all">全部規則標記</option>
          ${marks.map((m) => `<option value="${escapeHtml(m)}">${escapeHtml(m)} 標記</option>`).join("")}
          <option value="__none">無標記</option>
          <option value="__unknown">${escapeHtml(markLabelForMode("待確認"))}</option>
        </select>
        <select id="sb-cat" class="cat-select">
          <option value="all">全部稀有度分類</option>
          ${CARD_CATEGORY_DEFS.map((d) => `<option value="${d.id}">${escapeHtml(label(d.label) || d.label)}</option>`).join("")}
        </select>
        <div class="seg-group" id="sb-owned">
          <button class="seg-btn" data-v="all">全部</button>
          <button class="seg-btn" data-v="owned">已收藏</button>
          <button class="seg-btn" data-v="missing">未收藏</button>
        </div>
      </div>
      <div class="cat-result-line" id="sb-result"></div>
      <div class="export-radio-row">
        ${isAppMode() ? "" : `<a class="text-btn" id="sb-export" href="#/export">📤 依目前條件匯出 Excel</a>`}
      </div>
    </section>

    <section class="cat-card-grid" id="sb-grid"></section>
    <div class="cat-more-wrap"><button id="sb-more" class="text-btn hidden">載入更多</button></div>
  `;

  document.getElementById("sb-setsort").value = getSetSort();
  document.getElementById("sb-series").value = f.seriesId;
  document.getElementById("sb-set").value = f.setKey;
  document.getElementById("sb-lang").value = f.language;
  document.getElementById("sb-mark").value = f.mark;
  document.getElementById("sb-cat").value = f.categoryId;
  syncOwnedButtons();
  bindFilters();
  await draw();
}

function syncOwnedButtons() {
  document.querySelectorAll("#sb-owned .seg-btn").forEach((b) =>
    b.classList.toggle("active", b.getAttribute("data-v") === f.owned));
}

function bindFilters() {
  const search = document.getElementById("sb-search");
  search.addEventListener("input", debounce(() => {
    f.keyword = search.value.trim();
    f.limit = PAGE_SIZE;
    draw();
  }, 200));

  document.getElementById("sb-series").addEventListener("change", (e) => {
    // 切換大系列 -> 直接換頁，卡包選單會重建成該系列的
    location.hash = `#/sets/${encodeURIComponent(e.target.value)}`;
  });

  for (const [id, key] of [["sb-set", "setKey"], ["sb-lang", "language"], ["sb-mark", "mark"], ["sb-cat", "categoryId"]]) {
    document.getElementById(id).addEventListener("change", (e) => {
      f[key] = e.target.value;
      f.limit = PAGE_SIZE;
      draw();
    });
  }

  document.getElementById("sb-owned").addEventListener("click", (e) => {
    const btn = e.target.closest(".seg-btn");
    if (!btn) return;
    f.owned = btn.getAttribute("data-v");
    f.limit = PAGE_SIZE;
    syncOwnedButtons();
    draw();
  });

  document.getElementById("sb-more").addEventListener("click", () => {
    f.limit += PAGE_SIZE;
    draw();
  });

  // 排序方向：記住選擇，重新整理與換頁後都沿用
  document.getElementById("sb-setsort").addEventListener("change", async (e) => {
    setSetSort(e.target.value);
    await setSetting(SORT_SETTING_KEY, getSetSort());
    // 重畫整頁，讓卡包選單與卡包清單一起套用新排序
    renderSeriesDetail({ id: f.seriesId });
  });

  document.querySelectorAll(".set-list-item").forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = btn.getAttribute("data-setkey");
      f.setKey = f.setKey === key ? "all" : key;   // 再點一次取消
      f.limit = PAGE_SIZE;
      document.getElementById("sb-set").value = f.setKey;
      document.querySelectorAll(".set-list-item").forEach((b) =>
        b.classList.toggle("active", b.getAttribute("data-setkey") === f.setKey));
      draw();
    });
  });
}

export const SORT_SETTING_KEY = "setSortDirection";

/** 開機時把使用者上次選的排序方向讀回來。 */
export async function restoreSetSort() {
  const saved = await getSetting(SORT_SETTING_KEY, SET_SORT.NEWEST);
  setSetSort(saved);
}

function matchesKeyword(card, kw) {
  if (!kw) return true;
  const lower = kw.toLowerCase();
  if ((card.name || "").toLowerCase().includes(lower)) return true;
  if ((card.cardNumber || "").toLowerCase().includes(lower)) return true;
  for (const dex of card.dexNumbers || []) {
    const sp = getSpecies(dex);
    if (!sp) continue;
    if ((sp.nameZh || "").includes(kw)) return true;
    if ((sp.nameEn || "").toLowerCase().includes(lower)) return true;
  }
  return false;
}

/** 目前條件命中的全部卡片（不受分頁限制）。匯出「目前篩選結果」也用這個。 */
export function currentSeriesFilterResult() {
  // 先用索引縮小範圍，再逐項比對，避免每次都掃全部卡片
  let base;
  if (f.setKey !== "all") base = getCardsOfSet(f.setKey);
  else if (f.seriesId !== "all") base = getSetsOfSeries(f.seriesId).flatMap((s) => getCardsOfSet(s.setKey));
  else base = getAllCards();

  return base.filter((card) => {
    if (f.language !== "all" && card.language !== f.language) return false;
    if (f.categoryId !== "all" && !(card.categoryIds || []).includes(f.categoryId)) return false;
    if (f.mark !== "all") {
      const info = getRegulationMark(card);
      if (f.mark === "__none" && info.status !== MARK_STATUS.NONE) return false;
      if (f.mark === "__unknown" && info.status !== MARK_STATUS.UNKNOWN) return false;
      if (f.mark !== "__none" && f.mark !== "__unknown"
        && !(info.status === MARK_STATUS.MARKED && info.mark === f.mark)) return false;
    }
    return matchesKeyword(card, f.keyword);
  });
}

export function getSeriesFilterState() {
  return { ...f };
}

async function draw() {
  const ownership = await getAllOwnership();
  const ownMap = new Map(ownership.map((o) => [o.cardId, o]));

  let filtered = currentSeriesFilterResult();
  if (f.owned !== "all") {
    filtered = filtered.filter((c) => {
      const isOwned = (ownMap.get(c.id) || {}).count > 0;
      return f.owned === "owned" ? isOwned : !isOwned;
    });
  }
  filtered.sort((a, b) =>
    String(a.setId).localeCompare(String(b.setId))
    || String(a.cardNumber).localeCompare(String(b.cardNumber), "en", { numeric: true }));

  lastFiltered = filtered;
  const ownedCount = filtered.filter((c) => (ownMap.get(c.id) || {}).count > 0).length;
  document.getElementById("sb-result").innerHTML =
    `符合條件 <strong>${filtered.length}</strong> 張，其中已收藏 <strong>${ownedCount}</strong> 張`
    + (filtered.length > f.limit ? `（目前顯示前 ${f.limit} 張）` : "");

  const shown = filtered.slice(0, f.limit);
  document.getElementById("sb-grid").innerHTML = shown.length
    ? shown.map((c) => renderCell(c, ownMap.get(c.id))).join("")
    : `<div class="empty-state">沒有符合條件的卡片</div>`;
  document.getElementById("sb-more").classList.toggle("hidden", filtered.length <= f.limit);
}

function renderCell(card, own) {
  const count = own ? own.count : 0;
  const owned = count > 0;
  const dex = (card.dexNumbers || [])[0];
  const sp = dex ? getSpecies(dex) : null;
  const mk = getRegulationMark(card);
  const cats = (card.categoryIds || []).map((id) => getCategoryDef(id)).filter(Boolean);
  const numberLine = card.printedTotal ? `${card.cardNumber}/${card.printedTotal}` : card.cardNumber;

  return `
  <div class="ct-cell${owned ? " owned" : ""}" data-card-id="${escapeHtml(card.id)}">
    <a class="ct-cell-img-link" href="${dex ? `#/pokemon/${dex}` : "#/sets"}">
      <img class="ct-cell-img" src="${escapeHtml(card.imageSmall || PLACEHOLDER_IMAGE)}"
           alt="${escapeHtml(card.name)}" loading="lazy" ${imgFallbackAttr(card.remoteImageSmall)} />
      ${owned ? `<span class="ct-owned-flag">已收藏 ${count}</span>` : ""}
    </a>
    <div class="ct-cell-body">
      <div class="ct-cell-name">${escapeHtml(card.name)}</div>
      ${sp ? `<div class="ct-cell-species">${escapeHtml(sp.nameZh || sp.nameEn)}・No.${padDex(dex)}</div>` : ""}
      <div class="ct-cell-set">${escapeHtml(card.setName)}（${escapeHtml(card.setId)}） · ${escapeHtml(String(numberLine))}</div>
      <div class="ct-cell-tags">
        <span class="lang-tag">${escapeHtml(LANG_LABEL[card.language] || card.language)}</span>
        <span class="mark-tag mark-${mk.status}">${escapeHtml(markLabel(mk))}</span>
        ${cats.map((c) => `<span class="mech-tag" style="border-color:${c.color};color:${c.color}">${escapeHtml(c.label)}</span>`).join("")}
      </div>
    </div>
  </div>`;
}
