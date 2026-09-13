// 收藏狀態計算邏輯。集中在這裡，確保「圖鑑首頁」「寶可夢詳細頁」
// 「我的收藏」「缺卡清單」看到的點亮規則完全一致。
import {
  getAllManualFlags,
  getAllOwnership,
  getAllCategories
} from "./db.js";
import { getCardsForSpecies } from "./data.js";

export async function buildSnapshot() {
  const [manualFlags, ownership, categories] = await Promise.all([
    getAllManualFlags(),
    getAllOwnership(),
    getAllCategories()
  ]);
  const manualMap = new Map(manualFlags.filter((f) => f.active).map((f) => [f.id, f]));
  const ownMap = new Map(ownership.map((o) => [o.cardId, o]));
  return { manualMap, ownMap, categories };
}

/**
 * 計算單一寶可夢在目前 snapshot 下的收藏狀態。
 * 分類狀態（status）有四種：
 *   owned              已收藏（手動標記或至少一張實際卡片）
 *   confirmed_not_owned  資料庫已確認有此分類卡片，但尚未收藏
 *   confirmed_absent    在目前收錄範圍內已確認沒有此分類卡片（目前資料尚未提供，保留機制）
 *   unknown             資料尚未收錄 / 尚未確認
 */
export function computeSpeciesStatus(speciesId, snapshot) {
  const { manualMap, ownMap, categories } = snapshot;
  const cards = getCardsForSpecies(speciesId);
  const speciesManualActive = manualMap.has(`species:${speciesId}`);

  let anyCategoryLit = false;
  let anyCategoryManualActive = false;
  let ownedCardVariants = 0;
  let ownedPhysicalCount = 0;
  const categoryStates = {};

  for (const cat of categories) {
    const catCards = cards.filter((c) => c.categoryId === cat.id);
    let catOwnedCount = 0;
    let catOwnedVariants = 0;
    for (const c of catCards) {
      const own = ownMap.get(c.id);
      if (own && own.count > 0) {
        catOwnedCount += own.count;
        catOwnedVariants++;
      }
    }
    const catManualActive = manualMap.has(`cat:${speciesId}:${cat.id}`);
    const lit = catManualActive || catOwnedCount > 0;

    let status;
    if (lit) status = "owned";
    else if ((cat.confirmedAbsentSpecies || []).includes(speciesId)) status = "confirmed_absent";
    else if (catCards.length > 0) status = "confirmed_not_owned";
    else status = "unknown";

    let reasonNote = null;
    if (lit && catManualActive && catOwnedCount > 0) {
      reasonNote = "手動標記，且已有實際收藏卡片";
    } else if (lit && !catManualActive && catOwnedCount > 0) {
      reasonNote = "手動標記已取消，但因仍擁有實際卡片而維持點亮";
    } else if (lit && catManualActive && catOwnedCount === 0) {
      reasonNote = "手動標記，尚未指定實際卡片";
    }

    categoryStates[cat.id] = {
      status,
      lit,
      manualActive: catManualActive,
      ownedCount: catOwnedCount,
      ownedVariants: catOwnedVariants,
      knownVariants: catCards.length,
      reasonNote
    };
    if (lit) anyCategoryLit = true;
    if (catManualActive) anyCategoryManualActive = true;
    ownedCardVariants += catOwnedVariants;
    ownedPhysicalCount += catOwnedCount;
  }

  const speciesLit = speciesManualActive || anyCategoryLit;
  let speciesReasonNote = null;
  if (speciesLit) {
    const reasons = [];
    if (speciesManualActive) reasons.push("整隻寶可夢手動標記");
    if (anyCategoryManualActive) reasons.push("分類手動標記");
    if (ownedCardVariants > 0) reasons.push("擁有實際收藏卡片");
    speciesReasonNote = reasons.join("＋");
  }

  return {
    speciesId,
    speciesLit,
    speciesManualActive,
    speciesReasonNote,
    ownedCardVariants,
    ownedPhysicalCount,
    totalKnownVariants: cards.length,
    categories: categoryStates
  };
}

export function computeAllStatuses(speciesIds, snapshot) {
  const map = new Map();
  for (const id of speciesIds) map.set(id, computeSpeciesStatus(id, snapshot));
  return map;
}
