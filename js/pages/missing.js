import { getAllSpecies, getCardsForSpecies } from "../data.js";
import { getAllCategories, getAllOwnership } from "../db.js";
import { renderCategoryBadge } from "../components/badges.js";
import { escapeHtml, padDex, imgFallbackAttr, PLACEHOLDER_IMAGE } from "../utils.js";

const GROUP_PAGE_SIZE = 30;

let filterCategory = "";
let filterLanguage = "";
let rowsCache = null;
let page = 1;
let io = null;

export async function renderMissing() {
  const app = document.getElementById("app");
  const categories = await getAllCategories();

  app.innerHTML = `
    <header class="page-header">
      <h1>缺卡清單</h1>
      <p class="subtitle">目前收錄範圍內，已確認存在但你尚未收藏的卡片（資料量較大，採分批載入）</p>
    </header>
    <div class="filter-row">
      <label>分類
        <select id="missing-cat-filter">
          <option value="">全部分類</option>
          ${categories.map((c) => `<option value="${c.id}" ${filterCategory === c.id ? "selected" : ""}>${escapeHtml(c.label)}</option>`).join("")}
        </select>
      </label>
      <label>語言
        <select id="missing-lang-filter">
          <option value="">全部語言</option>
          <option value="ja" ${filterLanguage === "ja" ? "selected" : ""}>日文版</option>
          <option value="en" ${filterLanguage === "en" ? "selected" : ""}>英文版（美版）</option>
        </select>
      </label>
    </div>
    <div id="missing-summary" class="missing-summary"></div>
    <div id="missing-list"></div>
    <div id="missing-sentinel" class="load-sentinel"></div>
  `;

  rowsCache = null;
  page = 1;
  renderNextPage();

  document.getElementById("missing-cat-filter").addEventListener("change", (e) => {
    filterCategory = e.target.value;
    rowsCache = null;
    page = 1;
    document.getElementById("missing-list").innerHTML = "";
    renderNextPage();
  });
  document.getElementById("missing-lang-filter").addEventListener("change", (e) => {
    filterLanguage = e.target.value;
    rowsCache = null;
    page = 1;
    document.getElementById("missing-list").innerHTML = "";
    renderNextPage();
  });
}

async function computeRows() {
  const species = getAllSpecies();
  const ownership = await getAllOwnership();
  const ownMap = new Map(ownership.map((o) => [o.cardId, o]));

  const rows = [];
  for (const s of species) {
    const cards = getCardsForSpecies(s.id);
    const missingCards = cards.filter((c) => {
      if (filterCategory && c.categoryId !== filterCategory) return false;
      if (filterLanguage && c.language !== filterLanguage) return false;
      const own = ownMap.get(c.id);
      return !own || own.count === 0;
    });
    if (missingCards.length > 0) {
      rows.push({ species: s, cards: missingCards });
    }
  }
  return rows;
}

async function renderNextPage() {
  const categories = await getAllCategories();
  const catById = new Map(categories.map((c) => [c.id, c]));

  if (!rowsCache) {
    rowsCache = await computeRows();
    const summaryEl = document.getElementById("missing-summary");
    if (rowsCache.length === 0) {
      summaryEl.textContent = "";
      document.getElementById("missing-list").innerHTML =
        `<div class="empty-state">目前收錄範圍內沒有缺卡（或你尚未瀏覽過任何寶可夢的卡片資料）。</div>`;
      return;
    }
    summaryEl.textContent = `共 ${rowsCache.reduce((sum, r) => sum + r.cards.length, 0)} 張缺卡，涉及 ${rowsCache.length} 隻寶可夢`;
  }

  const start = (page - 1) * GROUP_PAGE_SIZE;
  const pageRows = rowsCache.slice(start, start + GROUP_PAGE_SIZE);
  const container = document.getElementById("missing-list");
  container.insertAdjacentHTML("beforeend", pageRows.map((r) => renderGroup(r, catById)).join(""));
  page++;

  const sentinel = document.getElementById("missing-sentinel");
  if (sentinel) {
    sentinel.style.display = start + GROUP_PAGE_SIZE >= rowsCache.length ? "none" : "block";
    if (io) io.disconnect();
    io = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) renderNextPage();
    });
    io.observe(sentinel);
  }
}

function renderGroup(r, catById) {
  return `
    <div class="missing-group">
      <a class="missing-group-head" href="#/pokemon/${r.species.id}">
        <img src="${r.species.imageUrl}" alt="" loading="lazy" ${imgFallbackAttr(r.species.remoteImageUrl)} />
        <span>#${padDex(r.species.id)} ${escapeHtml(r.species.nameZh || r.species.nameEn)}</span>
        <span class="missing-group-count">${r.cards.length} 張</span>
      </a>
      <div class="missing-cards-row">
        ${r.cards
          .slice(0, 24)
          .map((c) => renderCardChip(c, catById))
          .join("")}
        ${r.cards.length > 24 ? `<a class="missing-more-chip" href="#/pokemon/${r.species.id}">還有 ${r.cards.length - 24} 張…</a>` : ""}
      </div>
    </div>`;
}

function renderCardChip(c, catById) {
  const numberLine = c.printedTotal ? `${escapeHtml(c.cardNumber)}/${c.printedTotal}` : escapeHtml(c.cardNumber);
  const img = c.imageSmall || PLACEHOLDER_IMAGE;
  return `
    <a class="missing-card-chip" href="#/pokemon/${c.dexNumbers[0]}" title="${escapeHtml(c.name)}">
      <img src="${img}" alt="" loading="lazy" ${imgFallbackAttr(c.remoteImageSmall)} />
      <div class="missing-card-chip-info">
        <div>${escapeHtml(c.setName)} ${numberLine}</div>
        ${catById.get(c.categoryId) ? renderCategoryBadge(catById.get(c.categoryId), { status: "owned" }) : ""}
      </div>
    </a>`;
}
