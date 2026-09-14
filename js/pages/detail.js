import { getSpecies, getCardsForSpecies, getAllSpecies, getImageCandidates } from "../data.js";
import { buildSnapshot, computeSpeciesStatus } from "../state.js";
import {
  getAllCategories,
  setSpeciesManualFlag,
  setCategoryManualFlag,
  setOwnership,
  getOwnership,
  getAllCustomImageIds,
  speciesImageKey
} from "../db.js";
import { escapeHtml, padDex, imgFallbackAttr, showToast, formatDate, PLACEHOLDER_IMAGE } from "../utils.js";
import { renderCategoryPicker, bindCategoryPickers } from "../components/categoryPicker.js";
import { renderFieldInfo, bindFieldEditors } from "../components/fieldEditor.js";
import { renderCategoryBadge } from "../components/badges.js";
import { promptUploadImage, removeCustomImage, acceptCandidateImage } from "../imageUpload.js";
import { isAppMode } from "../appMode.js";
import { label } from "../appLabels.js";

let activeCategoryTab = "ALL";

export async function renderDetail({ id }) {
  const app = document.getElementById("app");
  const speciesId = Number(id);
  const species = getSpecies(speciesId);
  if (!species) {
    app.innerHTML = `<div class="empty-state">找不到圖鑑編號 #${escapeHtml(id)} 的寶可夢</div>`;
    return;
  }
  activeCategoryTab = "ALL";
  await draw(speciesId);
}

async function draw(speciesId) {
  const app = document.getElementById("app");
  const species = getSpecies(speciesId);
  const categories = await getAllCategories();
  const snapshot = await buildSnapshot();
  const status = computeSpeciesStatus(speciesId, snapshot);
  const cards = getCardsForSpecies(speciesId);
  const allSpecies = getAllSpecies();
  const prev = allSpecies.find((s) => s.id === speciesId - 1);
  const next = allSpecies.find((s) => s.id === speciesId + 1);
  const customImageIds = new Set(await getAllCustomImageIds());
  const speciesImgKey = speciesImageKey(speciesId);
  const speciesHasCustomImage = customImageIds.has(speciesImgKey);

  app.innerHTML = `
    <header class="page-header detail-header">
      <a href="#/" class="back-link">← 返回圖鑑</a>
      <div class="detail-nav">
        ${prev ? `<a href="#/pokemon/${prev.id}" class="nav-arrow">‹ #${padDex(prev.id)}</a>` : "<span></span>"}
        ${next ? `<a href="#/pokemon/${next.id}" class="nav-arrow">#${padDex(next.id)} ›</a>` : "<span></span>"}
      </div>
    </header>

    <section class="detail-hero">
      <div class="detail-hero-img-wrap">
        <img class="detail-hero-img ${status.speciesLit ? "" : "dim"}" src="${species.imageUrl}" alt="${escapeHtml(species.nameZh || species.nameEn)}" ${imgFallbackAttr(species.remoteImageUrl)} />
        ${isAppMode() ? "" : `<div class="hero-img-actions">
          <button class="text-btn" data-action="upload-species-image">${speciesHasCustomImage ? "更換圖片" : "上傳圖片"}</button>
          ${speciesHasCustomImage ? `<button class="text-btn danger-text" data-action="remove-species-image">移除自訂圖片</button>` : ""}
        </div>`}
      </div>
      <div class="detail-hero-info">
        <div class="detail-dexnum">#${padDex(species.id)} · 第 ${species.generation} 世代${species.isLegendary ? " · 傳說" : ""}${species.isMythical ? " · 幻獸" : ""}</div>
        <h1>${escapeHtml(species.nameZh || species.nameEn)}</h1>
        <div class="detail-enname">${escapeHtml(species.nameEn)}</div>
        <div class="detail-overall ${status.speciesLit ? "lit" : ""}">
          ${status.speciesLit ? "✓ 已收藏" : "尚未收藏"}
          ${status.speciesReasonNote ? `<span class="reason-note">（${escapeHtml(status.speciesReasonNote)}）</span>` : ""}
        </div>
        <div class="detail-summary">已收藏 ${status.ownedCardVariants} 種卡片版本 · 共 ${status.ownedPhysicalCount} 張 · 目前收錄 ${status.totalKnownVariants} 種版本</div>
        <label class="quick-toggle">
          <input type="checkbox" id="species-manual-toggle" ${status.speciesManualActive ? "checked" : ""} />
          快速點亮：我擁有這隻寶可夢的卡片（手動標記，尚未指定卡片）
        </label>
      </div>
    </section>

    <section class="detail-categories">
      <h2>分類收藏狀態</h2>
      <div class="cat-status-grid">
        ${categories.map((c) => renderCategoryStatusCard(c, status.categories[c.id])).join("")}
      </div>
    </section>

    <section class="detail-cards">
      <div class="detail-cards-headrow">
        <h2>實際卡片（${cards.length} 種）</h2>
      </div>
      <div class="cat-tabs">
        <button class="cat-tab ${activeCategoryTab === "ALL" ? "active" : ""}" data-tab="ALL">全部</button>
        ${categories
          .filter((c) => cards.some((card) => card.categoryId === c.id))
          .map((c) => `<button class="cat-tab ${activeCategoryTab === c.id ? "active" : ""}" data-tab="${c.id}">${escapeHtml(c.label)}</button>`)
          .join("")}
      </div>
      <div id="card-list" class="card-list"></div>
      ${cards.length === 0 ? `<div class="empty-state">目前收錄範圍內尚無這隻寶可夢的卡片資料。你可以先使用上方的快速點亮，或到設定頁匯入你自己的卡片資料。</div>` : ""}
    </section>
  `;

  renderCardList(speciesId, cards, categories, customImageIds);
  bindEvents(speciesId, categories, speciesImgKey);
}

function renderCategoryStatusCard(cat, catState) {
  const statusLabel = {
    owned: "已收藏",
    confirmed_not_owned: "已確認有，未收藏",
    confirmed_absent: "已確認沒有",
    unknown: "尚未收錄／未確認"
  }[catState.status];
  return `
    <div class="cat-status-card status-${catState.status}">
      <div class="cat-status-top">
        ${renderCategoryBadge(cat, catState)}
        <span class="cat-status-label">${statusLabel}</span>
      </div>
      <div class="cat-status-detail">${catState.ownedVariants} / ${catState.knownVariants} 種版本已收藏，共 ${catState.ownedCount} 張</div>
      ${catState.reasonNote ? `<div class="reason-note">${escapeHtml(catState.reasonNote)}</div>` : ""}
      <label class="quick-toggle small">
        <input type="checkbox" class="cat-manual-toggle" data-cat="${cat.id}" ${catState.manualActive ? "checked" : ""} />
        快速點亮此分類
      </label>
    </div>`;
}

function renderCardList(speciesId, allCards, categories, customImageIds) {
  const list = document.getElementById("card-list");
  if (!list) return;
  const cards = activeCategoryTab === "ALL" ? allCards : allCards.filter((c) => c.categoryId === activeCategoryTab);
  if (cards.length === 0) {
    list.innerHTML = `<div class="empty-state">此分類目前沒有卡片</div>`;
    return;
  }
  Promise.all(cards.map((c) => getOwnership(c.id))).then((ownerships) => {
    list.innerHTML = cards
      .map((card, i) => renderCardRow(card, categories.find((c) => c.id === card.categoryId), ownerships[i], customImageIds.has(card.id)))
      .join("");
    bindCardRowEvents(speciesId, cards);
    // 分類改動會影響上方的分類徽章與卡片列表分組，所以整頁重畫
    bindCategoryPickers(list, () => draw(speciesId));
    bindFieldEditors(list, () => draw(speciesId));
  });
}

function renderCardRow(card, category, ownership, hasCustomImage) {
  const count = ownership ? ownership.count : 0;
  const note = ownership ? ownership.note : "";
  const owned = count > 0;
  const numberLine = card.printedTotal
    ? `${escapeHtml(card.cardNumber)}/${card.printedTotal}`
    : escapeHtml(card.cardNumber);
  const imgSrc = card.imageSmall || PLACEHOLDER_IMAGE;
  return `
  <div class="card-row ${owned ? "owned" : ""}" data-card-id="${card.id}">
    <div class="card-row-img-wrap">
      <img class="card-row-img" src="${imgSrc}" alt="${escapeHtml(card.name)}" loading="lazy" ${imgFallbackAttr(card.remoteImageSmall)} />
      ${isAppMode() ? "" : `<button class="img-upload-btn" data-action="upload-card-image" title="${hasCustomImage ? "更換自訂圖片" : "上傳圖片"}">${hasCustomImage ? "✎" : "＋圖"}</button>`}
      ${!isAppMode() && hasCustomImage ? `<button class="img-remove-btn" data-action="remove-card-image" title="移除自訂圖片">×</button>` : ""}
    </div>
    <div class="card-row-body">
      <div class="card-row-title">${escapeHtml(card.name)}</div>
      <div class="card-row-set">${escapeHtml(card.setName)}（${escapeHtml(card.setId)}） · ${numberLine}${renderVersionToggle(card, hasCustomImage)}</div>
      <div class="card-row-tags">
        ${category ? renderCategoryBadge(category, { status: "owned" }) : ""}
        <span class="rarity-tag" title="原始稀有度（來自 TCGdex 資料庫）">${card.originalRarity ? escapeHtml(card.originalRarity) : "稀有度資料尚未提供"}</span>
        ${(card.tags || []).map((t) => `<span class="mech-tag">${escapeHtml(t)}</span>`).join("")}
        <span class="lang-tag">${escapeHtml(languageLabel(card.language))}</span>
        ${card.isSample && label("樣本資料") ? `<span class="sample-tag" title="示範用樣本資料">${label("樣本資料")}</span>` : ""}
      </div>
      <div class="card-row-release">
        ${card.releaseDate ? `發售日：${escapeHtml(formatDate(card.releaseDate))}` : ""}
        ${card.illustrator ? `　繪師：${escapeHtml(card.illustrator)}` : ""}
      </div>
      ${renderFieldInfo(card)}
      ${renderCategoryPicker(card, { compact: true })}
      ${renderCandidateBlock(card, hasCustomImage)}
    </div>
    <div class="card-row-owner">
      <div class="count-stepper">
        <button class="count-btn" data-action="dec">－</button>
        <span class="count-value">${count}</span>
        <button class="count-btn" data-action="inc">＋</button>
      </div>
      <button class="note-toggle-btn" data-action="note">${note ? "備註✎" : "加備註"}</button>
    </div>
    <div class="card-note-panel hidden">
      <textarea class="card-note-input" placeholder="例如：品相、購入日期、卡套版本…">${escapeHtml(note)}</textarea>
      <button class="text-btn note-save-btn" data-action="save-note">儲存備註</button>
    </div>
  </div>`;
}

// 少數卡片在來源網站有一個以上的印刷版本（例如 My First Battle 四副牌裡，
// 同一隻寶可夢同時有牌組限定的藍框版與一般版），而 TCGdex 只有一筆資料，
// 無法機械式判斷該對應哪一版。這些卡已經先套用了其中一版，平常不需要一直
// 把候選圖攤在畫面上佔位置，所以預設收合，只留一顆小按鈕；要換版本時才展開。

// 這張卡有沒有「其他可選版本」（已經自己上傳圖片的就不算，那時使用者已經
// 自己決定要用哪張圖了）。
function versionAlternatives(card, hasCustomImage) {
  if (hasCustomImage) return null;
  const info = getImageCandidates(card.id);
  if (!info || !info.candidates || info.candidates.length < 2) return null;
  const others = info.candidates
    .map((cd, i) => ({ cd, i }))
    .filter(({ cd }) => cd.path !== info.appliedPath);
  if (others.length === 0) return null;
  const applied = info.candidates.find((cd) => cd.path === info.appliedPath) || null;
  return { info, others, applied };
}

function renderVersionToggle(card, hasCustomImage) {
  if (isAppMode()) return "";
  const alt = versionAlternatives(card, hasCustomImage);
  if (!alt) return "";
  return ` <button class="version-toggle-btn" data-action="toggle-versions" aria-expanded="false" title="這張卡在來源有其他印刷版本，可以換">換版本 ${alt.others.length}</button>`;
}

function renderCandidateBlock(card, hasCustomImage) {
  if (isAppMode()) return "";
  const alt = versionAlternatives(card, hasCustomImage);
  if (!alt) return "";
  const { info, others, applied } = alt;

  return `
    <div class="candidate-block hidden">
      <div class="candidate-head">目前使用：${escapeHtml(applied ? applied.title || applied.number || "" : "")}</div>
      ${info.note ? `<div class="candidate-note">${escapeHtml(info.note)}</div>` : ""}
      <div class="candidate-list">
        ${others
          .map(
            ({ cd, i }) => `
          <div class="candidate-item">
            <img src="${escapeHtml(cd.path)}" alt="${escapeHtml(cd.title || "")}" loading="lazy" ${imgFallbackAttr()} />
            <div class="candidate-meta">
              <div>${escapeHtml(cd.title || "")}</div>
              ${cd.number ? `<div>來源編號：${escapeHtml(cd.number)}</div>` : ""}
              ${cd.setName ? `<div>${escapeHtml(cd.setName)}</div>` : ""}
              ${cd.sourceUrl ? `<a href="${escapeHtml(cd.sourceUrl)}" target="_blank" rel="noopener">看來源頁</a>` : ""}
            </div>
            <button class="text-btn" data-action="accept-candidate" data-candidate-index="${i}">改用這張</button>
          </div>`
          )
          .join("")}
      </div>
    </div>`;
}

function languageLabel(lang) {
  const map = { en: "英文版（美版）", ja: "日文版", "zh-Hant": "繁體中文版", "zh-Hans": "簡體中文版" };
  return map[lang] || lang;
}

function bindEvents(speciesId, categories, speciesImgKey) {
  const uploadSpeciesBtn = document.querySelector('[data-action="upload-species-image"]');
  if (uploadSpeciesBtn) {
    uploadSpeciesBtn.addEventListener("click", () => {
      promptUploadImage(speciesImgKey, () => draw(speciesId));
    });
  }
  const removeSpeciesBtn = document.querySelector('[data-action="remove-species-image"]');
  if (removeSpeciesBtn) {
    removeSpeciesBtn.addEventListener("click", () => {
      removeCustomImage(speciesImgKey, () => draw(speciesId));
    });
  }

  const speciesToggle = document.getElementById("species-manual-toggle");
  speciesToggle.addEventListener("change", async (e) => {
    const active = e.target.checked;
    await setSpeciesManualFlag(speciesId, active);
    if (!active) {
      showToast("已取消手動標記", {
        actionLabel: "復原",
        onAction: async () => {
          await setSpeciesManualFlag(speciesId, true);
          draw(speciesId);
        }
      });
    }
    draw(speciesId);
  });

  document.querySelectorAll(".cat-manual-toggle").forEach((cb) => {
    cb.addEventListener("change", async (e) => {
      const catId = e.target.getAttribute("data-cat");
      const active = e.target.checked;
      await setCategoryManualFlag(speciesId, catId, active);
      if (!active) {
        showToast("已取消此分類的手動標記", {
          actionLabel: "復原",
          onAction: async () => {
            await setCategoryManualFlag(speciesId, catId, true);
            draw(speciesId);
          }
        });
      }
      draw(speciesId);
    });
  });

  document.querySelectorAll(".cat-tab").forEach((btn) => {
    btn.addEventListener("click", async () => {
      activeCategoryTab = btn.getAttribute("data-tab");
      document.querySelectorAll(".cat-tab").forEach((b) => b.classList.toggle("active", b === btn));
      const cards = getCardsForSpecies(speciesId);
      const customImageIds = new Set(await getAllCustomImageIds());
      renderCardList(speciesId, cards, categories, customImageIds);
    });
  });
}

function bindCardRowEvents(speciesId, cards) {
  const list = document.getElementById("card-list");
  list.querySelectorAll(".card-row").forEach((row) => {
    const cardId = row.getAttribute("data-card-id");
    const card = cards.find((c) => c.id === cardId);
    const countValueEl = row.querySelector(".count-value");
    const noteToggle = row.querySelector('[data-action="note"]');
    const notePanel = row.querySelector(".card-note-panel");
    const noteInput = row.querySelector(".card-note-input");

    // App 模式沒有這顆按鈕，這裡必須 null-safe，不然每一列都會丟例外
    const uploadImgBtn = row.querySelector('[data-action="upload-card-image"]');
    if (uploadImgBtn) {
      uploadImgBtn.addEventListener("click", () => {
        promptUploadImage(card.id, () => draw(speciesId));
      });
    }
    const versionToggle = row.querySelector('[data-action="toggle-versions"]');
    if (versionToggle) {
      versionToggle.addEventListener("click", () => {
        const block = row.querySelector(".candidate-block");
        if (!block) return;
        const nowHidden = block.classList.toggle("hidden");
        versionToggle.setAttribute("aria-expanded", String(!nowHidden));
        versionToggle.classList.toggle("active", !nowHidden);
        if (!nowHidden) block.scrollIntoView({ block: "nearest", behavior: "smooth" });
      });
    }
    row.querySelectorAll('[data-action="accept-candidate"]').forEach((btn) => {
      btn.addEventListener("click", () => {
        const info = getImageCandidates(card.id);
        const idx = Number(btn.getAttribute("data-candidate-index"));
        const cd = info && info.candidates && info.candidates[idx];
        if (!cd) return;
        acceptCandidateImage(card.id, cd.path, () => draw(speciesId));
      });
    });
    const removeImgBtn = row.querySelector('[data-action="remove-card-image"]');
    if (removeImgBtn) {
      removeImgBtn.addEventListener("click", () => {
        removeCustomImage(card.id, () => draw(speciesId));
      });
    }

    row.querySelector('[data-action="dec"]').addEventListener("click", async () => {
      const current = parseInt(countValueEl.textContent, 10);
      const next = Math.max(0, current - 1);
      await persistCount(speciesId, card, next, noteInput.value);
      countValueEl.textContent = next;
      row.classList.toggle("owned", next > 0);
      refreshHeaderOnly(speciesId);
      if (current > 0 && next === 0) {
        showToast("已將這張卡片的收藏張數歸零", {
          actionLabel: "復原",
          onAction: async () => {
            await persistCount(speciesId, card, current, noteInput.value);
            draw(speciesId);
          }
        });
      }
    });
    row.querySelector('[data-action="inc"]').addEventListener("click", async () => {
      const current = parseInt(countValueEl.textContent, 10);
      const next = current + 1;
      await persistCount(speciesId, card, next, noteInput.value);
      countValueEl.textContent = next;
      row.classList.add("owned");
      refreshHeaderOnly(speciesId);
    });
    noteToggle.addEventListener("click", () => {
      notePanel.classList.toggle("hidden");
    });
    row.querySelector('[data-action="save-note"]').addEventListener("click", async () => {
      const current = parseInt(countValueEl.textContent, 10);
      await persistCount(speciesId, card, current, noteInput.value);
      noteToggle.textContent = noteInput.value ? "備註✎" : "加備註";
      showToast("備註已儲存");
    });
  });
}

async function persistCount(speciesId, card, count, note) {
  await setOwnership({
    cardId: card.id,
    speciesIds: card.dexNumbers,
    categoryId: card.categoryId,
    count,
    note
  });
}

async function refreshHeaderOnly(speciesId) {
  // 為了保持互動流暢，數量增減只局部更新，但仍需要重新整理上方摘要與分類徽章。
  const categories = await getAllCategories();
  const snapshot = await buildSnapshot();
  const status = computeSpeciesStatus(speciesId, snapshot);
  const overallEl = document.querySelector(".detail-overall");
  if (overallEl) {
    overallEl.classList.toggle("lit", status.speciesLit);
    overallEl.innerHTML = `${status.speciesLit ? "✓ 已收藏" : "尚未收藏"}${status.speciesReasonNote ? `<span class="reason-note">（${escapeHtml(status.speciesReasonNote)}）</span>` : ""}`;
  }
  const summaryEl = document.querySelector(".detail-summary");
  if (summaryEl) {
    summaryEl.textContent = `已收藏 ${status.ownedCardVariants} 種卡片版本 · 共 ${status.ownedPhysicalCount} 張 · 目前收錄 ${status.totalKnownVariants} 種版本`;
  }
  const catGrid = document.querySelector(".cat-status-grid");
  if (catGrid) {
    catGrid.innerHTML = categories.map((c) => renderCategoryStatusCard(c, status.categories[c.id])).join("");
    document.querySelectorAll(".cat-manual-toggle").forEach((cb) => {
      cb.addEventListener("change", async (e) => {
        const catId = e.target.getAttribute("data-cat");
        await setCategoryManualFlag(speciesId, catId, e.target.checked);
        draw(speciesId);
      });
    });
  }
}
