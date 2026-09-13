import { getAllSpecies } from "../data.js";
import { buildSnapshot, computeSpeciesStatus } from "../state.js";
import { getAllCategories, getAllOwnership } from "../db.js";
import { renderPokemonTile } from "../components/pokemonTile.js";
import { escapeHtml } from "../utils.js";

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
    perCategoryLit[cat.id] = statuses.filter((s) => s.categories[cat.id].status === "owned").length;
  }

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

    <section class="cat-stat-section">
      <h2>各分類已點亮寶可夢數</h2>
      <div class="cat-stat-grid">
        ${categories
          .map(
            (c) => `
          <a class="cat-stat-tile" href="#/?" data-cat="${c.id}" style="--badge-color:${c.color}">
            <div class="cat-stat-label">${escapeHtml(c.label)}</div>
            <div class="cat-stat-value">${perCategoryLit[c.id]}</div>
          </a>`
          )
          .join("")}
      </div>
      <p class="hint-text">「已點亮」代表擁有至少一張該分類卡片，或手動標記，不代表已收齊該分類所有版本。</p>
    </section>

    <section class="collection-list-section">
      <div class="detail-cards-headrow">
        <h2>已收藏的寶可夢（${litCount}）</h2>
      </div>
      <div id="owned-grid" class="poke-grid"></div>
      ${litCount === 0 ? `<div class="empty-state">還沒有收藏紀錄。到圖鑑首頁點進任一隻寶可夢，試試「快速點亮」或勾選實際卡片吧！</div>` : ""}
    </section>
  `;

  const grid = document.getElementById("owned-grid");
  const pairs = species.map((s, i) => [s, statuses[i]]).filter(([, st]) => st.speciesLit);
  grid.innerHTML = pairs.map(([s, st]) => renderPokemonTile(s, st, categories)).join("");
}
