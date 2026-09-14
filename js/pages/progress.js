// 收藏進度（App 版專用分頁）。
//
// 這一頁刻意**不自己算任何數字**，全部呼叫 collection.js 匯出的渲染函式。
// 「我的收藏」與「收藏進度」用的是同一份計算，不會出現兩頁對不起來的情況。
//
// 與「我的收藏」的分工：
//   我的收藏 —— 已收藏卡片的清單，可以搜尋、篩選、清除
//   收藏進度 —— 只看數字：整體完成度、各分類點亮數、各世代進度
import { getAllSpecies } from "../data.js";
import { buildSnapshot, computeSpeciesStatus } from "../state.js";
import { getAllCategories, getAllOwnership } from "../db.js";
import { renderCollectionStats, renderCategoryProgress } from "./collection.js";
import { escapeHtml } from "../utils.js";

export async function renderProgress() {
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
    perCategoryLit[cat.id] = statuses.filter(
      (s) => s.categories[cat.id] && s.categories[cat.id].status === "owned"
    ).length;
  }

  // 各世代進度
  const byGen = new Map();
  species.forEach((s, i) => {
    const g = s.generation;
    if (!byGen.has(g)) byGen.set(g, { total: 0, lit: 0 });
    const row = byGen.get(g);
    row.total += 1;
    if (statuses[i].speciesLit) row.lit += 1;
  });
  const gens = Array.from(byGen.entries()).sort((a, b) => a[0] - b[0]);

  const pct = species.length ? Math.round((litCount / species.length) * 1000) / 10 : 0;

  app.innerHTML = `
    <header class="page-header">
      <h1>收藏進度</h1>
      <p class="subtitle">目前圖鑑收錄範圍內的完成度</p>
    </header>

    <section class="progress-overall">
      <div class="progress-pct">${pct}%</div>
      <div class="progress-bar"><div class="progress-bar-fill" style="width:${pct}%"></div></div>
      <p class="hint-text">已點亮 ${litCount} / ${species.length} 隻。這是目前 App 收錄範圍的比例，不是官方全卡表完成率。</p>
    </section>

    ${renderCollectionStats({ litCount, speciesTotal: species.length, distinctVariants, totalPhysical })}

    <section class="cat-stat-section">
      <h2>各世代進度</h2>
      <div class="cat-stat-grid">
        ${gens
          .map(([g, row]) => {
            const p = row.total ? Math.round((row.lit / row.total) * 100) : 0;
            return `<div class="cat-stat-tile">
              <div class="cat-stat-label">第 ${escapeHtml(String(g))} 世代</div>
              <div class="cat-stat-value">${row.lit}<span class="stat-card-denom"> / ${row.total}</span></div>
              <div class="progress-bar mini"><div class="progress-bar-fill" style="width:${p}%"></div></div>
            </div>`;
          })
          .join("")}
      </div>
    </section>

    ${renderCategoryProgress(categories, perCategoryLit)}`;
}
