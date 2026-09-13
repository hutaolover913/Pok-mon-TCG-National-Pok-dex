import { escapeHtml, padDex, imgFallbackAttr } from "../utils.js";
import { renderBadgeRow } from "./badges.js";

export function renderPokemonTile(species, status, categories) {
  const litClass = status.speciesLit ? "lit" : "dim";
  return `
  <a class="poke-tile ${litClass}" href="#/pokemon/${species.id}" data-species-id="${species.id}">
    <div class="poke-tile-img-wrap">
      <img class="poke-tile-img" src="${species.imageUrl}" alt="${escapeHtml(species.nameZh || species.nameEn)}" loading="lazy" ${imgFallbackAttr(species.remoteImageUrl)} />
      ${status.speciesLit ? '<span class="check-mark" aria-hidden="true">✓</span>' : ""}
    </div>
    <div class="poke-tile-num">#${padDex(species.id)}</div>
    <div class="poke-tile-name">${escapeHtml(species.nameZh || species.nameEn)}</div>
    <div class="poke-tile-badges">${renderBadgeRow(categories, status, { compact: true })}</div>
    <div class="poke-tile-count">${renderCountLabel(status)}</div>
  </a>`;
}

function renderCountLabel(status) {
  if (status.ownedCardVariants > 0) return `已收藏 ${status.ownedCardVariants} 種卡片`;
  if (status.speciesLit) return "已標記，尚未指定卡片";
  return "尚未收藏";
}
