import { getAllSpecies, getCardsForSpecies } from "../data.js";
import { saveView, readView, clearView } from "../viewState.js";
import { requestScrollRestore } from "../router.js";
import { buildSnapshot, computeSpeciesStatus } from "../state.js";
import { getAllCategories } from "../db.js";
import { renderPokemonTile } from "../components/pokemonTile.js";
import { escapeHtml, debounce, padDex } from "../utils.js";

const PAGE_SIZE = 60;

let state = {
  query: "",
  generation: "",
  ownedFilter: "all", // all | owned | not_owned
  categoryFilter: "", // categoryId or ""
  categoryOwnedFilter: "any", // any | owned | not_owned_known  (只在 categoryFilter 有值時生效)
  page: 1
};

let io = null;

export async function renderHome() {
  const app = document.getElementById("app");
  const categories = await getAllCategories();
  const species = getAllSpecies();
  const snapshot = await buildSnapshot();

  app.innerHTML = `
    <header class="page-header home-header">
      <div class="brand">
        <span class="brand-mark">📖</span>
        <div>
          <h1>全國圖鑑收藏</h1>
          <p class="subtitle">依全國圖鑑編號整理你的 PTCG 收藏</p>
        </div>
      </div>
      <div id="home-stats" class="home-stats"></div>
    </header>

    <div class="search-bar">
      <input id="search-input" type="search" placeholder="搜尋寶可夢名稱或圖鑑編號…" value="${escapeHtml(state.query)}" />
      <button id="filter-toggle" class="icon-btn" aria-label="篩選">⚙︎ 篩選</button>
    </div>

    <div id="filter-panel" class="filter-panel hidden"></div>

    <div id="poke-grid" class="poke-grid"></div>
    <div id="load-sentinel" class="load-sentinel"></div>
    <div id="grid-empty" class="empty-state hidden">沒有符合條件的寶可夢</div>
  `;

  renderFilterPanel(categories);
  renderStats(species, categories, snapshot);
  // 從寶可夢詳情返回時，把載到第幾頁與捲動位置一起還原。
  // 第一次進來 saved 是 null，走的就是原本的 resetAndRenderGrid，行為不變。
  const saved = readView("/");
  if (saved && saved.pages > 1) {
    restoreGrid(species, categories, snapshot, saved.pages);
  } else {
    // 注意 resetAndRenderGrid() 會呼叫 clearView("/")，所以 saved 必須先讀起來，
    // 而且捲動位置要在這之後才還原 —— 只載了一頁也一樣要回到原本的位置。
    resetAndRenderGrid(species, categories, snapshot);
  }
  if (saved && saved.scrollY) requestScrollRestore(saved.scrollY);

  document.getElementById("search-input").addEventListener(
    "input",
    debounce((e) => {
      state.query = e.target.value.trim();
      resetAndRenderGrid(species, categories, snapshot);
    }, 200)
  );

  document.getElementById("filter-toggle").addEventListener("click", () => {
    document.getElementById("filter-panel").classList.toggle("hidden");
  });
}

function renderStats(species, categories, snapshot) {
  const total = species.length;
  let lit = 0;
  for (const s of species) {
    if (computeSpeciesStatus(s.id, snapshot).speciesLit) lit++;
  }
  const el = document.getElementById("home-stats");
  el.innerHTML = `<span class="stat-pill">已點亮 <strong>${lit}</strong> / ${total}</span>`;
}

function renderFilterPanel(categories) {
  const panel = document.getElementById("filter-panel");
  const genOptions = [1, 2, 3, 4, 5, 6, 7, 8, 9]
    .map((g) => `<option value="${g}" ${state.generation == g ? "selected" : ""}>第 ${g} 世代</option>`)
    .join("");
  const catOptions = categories
    .map((c) => `<option value="${c.id}" ${state.categoryFilter === c.id ? "selected" : ""}>${escapeHtml(c.label)}</option>`)
    .join("");

  panel.innerHTML = `
    <div class="filter-row">
      <label>世代
        <select id="f-generation">
          <option value="">全部</option>
          ${genOptions}
        </select>
      </label>
      <label>收藏狀態
        <select id="f-owned">
          <option value="all" ${state.ownedFilter === "all" ? "selected" : ""}>全部</option>
          <option value="owned" ${state.ownedFilter === "owned" ? "selected" : ""}>已收藏</option>
          <option value="not_owned" ${state.ownedFilter === "not_owned" ? "selected" : ""}>未收藏</option>
        </select>
      </label>
    </div>
    <div class="filter-row">
      <label>分類
        <select id="f-category">
          <option value="">不限分類</option>
          ${catOptions}
        </select>
      </label>
      <label>分類收藏狀態
        <select id="f-category-owned" ${state.categoryFilter ? "" : "disabled"}>
          <option value="any" ${state.categoryOwnedFilter === "any" ? "selected" : ""}>不限</option>
          <option value="owned" ${state.categoryOwnedFilter === "owned" ? "selected" : ""}>已收藏此分類</option>
          <option value="not_owned_known" ${state.categoryOwnedFilter === "not_owned_known" ? "selected" : ""}>已確認有但未收藏</option>
        </select>
      </label>
    </div>
    <div class="filter-row">
      <button id="f-reset" class="text-btn">清除篩選</button>
    </div>
  `;

  panel.querySelector("#f-generation").addEventListener("change", (e) => {
    state.generation = e.target.value;
    refreshFromFilters();
  });
  panel.querySelector("#f-owned").addEventListener("change", (e) => {
    state.ownedFilter = e.target.value;
    refreshFromFilters();
  });
  panel.querySelector("#f-category").addEventListener("change", (e) => {
    state.categoryFilter = e.target.value;
    panel.querySelector("#f-category-owned").disabled = !state.categoryFilter;
    refreshFromFilters();
  });
  panel.querySelector("#f-category-owned").addEventListener("change", (e) => {
    state.categoryOwnedFilter = e.target.value;
    refreshFromFilters();
  });
  panel.querySelector("#f-reset").addEventListener("click", () => {
    state = { ...state, generation: "", ownedFilter: "all", categoryFilter: "", categoryOwnedFilter: "any", page: 1 };
    renderFilterPanel(window.__categories);
    refreshFromFilters();
  });

  window.__categories = categories;
}

function refreshFromFilters() {
  const species = getAllSpecies();
  const categories = window.__categories;
  buildSnapshot().then((snapshot) => resetAndRenderGrid(species, categories, snapshot));
}

function matchesFilters(s, status) {
  if (state.query) {
    const q = state.query.toLowerCase();
    const matchNum = String(s.id).includes(q) || padDex(s.id).includes(q);
    const matchName = (s.nameZh || "").includes(state.query) || (s.nameEn || "").toLowerCase().includes(q);
    if (!matchNum && !matchName) return false;
  }
  if (state.generation && s.generation != state.generation) return false;
  if (state.ownedFilter === "owned" && !status.speciesLit) return false;
  if (state.ownedFilter === "not_owned" && status.speciesLit) return false;
  if (state.categoryFilter) {
    const cs = status.categories[state.categoryFilter];
    if (!cs) return false;
    if (state.categoryOwnedFilter === "owned" && cs.status !== "owned") return false;
    if (state.categoryOwnedFilter === "not_owned_known" && cs.status !== "confirmed_not_owned") return false;
  }
  return true;
}

function resetAndRenderGrid(species, categories, snapshot) {
  // 篩選條件變了，記下來的捲動位置與頁數就對不上了，直接丟掉
  clearView("/");
  state.page = 1;
  const grid = document.getElementById("poke-grid");
  grid.innerHTML = "";
  renderStats(species, categories, snapshot);
  renderNextPage(species, categories, snapshot);
  setupInfiniteScroll(species, categories, snapshot);
}

/** 一口氣補回先前已經載入的頁數，避免使用者返回後要重新往下滑。 */
function restoreGrid(species, categories, snapshot, pages) {
  state.page = 1;
  const grid = document.getElementById("poke-grid");
  grid.innerHTML = "";
  renderStats(species, categories, snapshot);
  const filtered = getFilteredList(species, snapshot);
  const take = Math.min(pages * PAGE_SIZE, filtered.length);
  // 一次插入，不要跑 pages 次 insertAdjacentHTML
  grid.insertAdjacentHTML("beforeend",
    filtered.slice(0, take).map(({ s, status }) => renderPokemonTile(s, status, categories)).join(""));
  state.page = Math.ceil(take / PAGE_SIZE) + 1;
  document.getElementById("grid-empty").classList.toggle("hidden", filtered.length > 0);
  const sentinel = document.getElementById("load-sentinel");
  sentinel.style.display = take >= filtered.length ? "none" : "block";
  setupInfiniteScroll(species, categories, snapshot);
}

function getFilteredList(species, snapshot) {
  return species
    .map((s) => ({ s, status: computeSpeciesStatus(s.id, snapshot) }))
    .filter(({ s, status }) => matchesFilters(s, status));
}

function renderNextPage(species, categories, snapshot) {
  const filtered = getFilteredList(species, snapshot);
  const empty = document.getElementById("grid-empty");
  empty.classList.toggle("hidden", filtered.length > 0);

  const start = (state.page - 1) * PAGE_SIZE;
  const pageItems = filtered.slice(start, start + PAGE_SIZE);
  const grid = document.getElementById("poke-grid");
  grid.insertAdjacentHTML("beforeend", pageItems.map(({ s, status }) => renderPokemonTile(s, status, categories)).join(""));
  state.page++;
  saveView("/", { pages: state.page - 1 });

  const sentinel = document.getElementById("load-sentinel");
  sentinel.style.display = start + PAGE_SIZE >= filtered.length ? "none" : "block";
}

function setupInfiniteScroll(species, categories, snapshot) {
  if (io) io.disconnect();
  const sentinel = document.getElementById("load-sentinel");
  io = new IntersectionObserver((entries) => {
    if (entries[0].isIntersecting) {
      renderNextPage(species, categories, snapshot);
    }
  });
  io.observe(sentinel);
}
