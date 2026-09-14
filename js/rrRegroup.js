// 把手動放錯位置的 RR／RRR 歸位。
//
// -- 為什麼需要這個動作 ------------------------------------------------------
// RR 與 RRR 原本是「只能手動加入」的分類，Double rare／Triple rare 都被算在
// 普通卡裡。這次更新把它們拆出來、給了自動對照規則，所以**沒有手動指定過的
// 卡片會自動歸位**，不需要按任何按鈕。
//
// 但有兩種卡片自動規則刻意不會碰：
//   1. 你曾經手動把它指定成「普通卡」的卡 —— 手動指定優先於自動判定，
//      這是刻意的，否則每次更新對照表都會把你的整理結果洗掉。
//   2. 你曾經手動放進「RR」、但其實是 RRR 的卡（VMAX／VSTAR）。
//
// 這兩種都只能由你按下按鈕才處理，而且會先給你看清單。
//
// -- 判定依據 ----------------------------------------------------------------
// 目標分類一律取自 js/cardCategories.js 的分語言規則（也就是這張卡沒有手動
// 指定時本來會落到哪一類），不另外發明規則，也不看卡名或卡包猜。
// 規則本身的證據：日版卡面右下角實際印 RR／RRR（S10P #001、S10P #015、
// SV8a #003、S12a #012 逐張核對）。
//
// 只搬「目前分類 -> 目標分類」確實落在下面三種組合的卡，其餘一律不動。
import { getAllCards } from "./data.js";
import { rarityCategoryId, getCategoryDef } from "./cardCategories.js";

/** 這次會處理的三種搬移；其他組合一律不碰。 */
const MOVES = [
  { from: "NORMAL", to: "RR", label: "普通卡 → RR" },
  { from: "NORMAL", to: "RRR", label: "普通卡 → RRR" },
  { from: "RR", to: "RRR", label: "RR → RRR" }
];

function labelOf(id) {
  const d = getCategoryDef(id);
  return d ? d.label : id;
}

/**
 * 算出這次會搬哪些卡，但不寫入任何東西。
 *
 * @returns {{groups: Array, total: number, autoHandled: object, skipped: Array}}
 */
export function previewRrRegroup() {
  const groups = MOVES.map((m) => ({ ...m, cards: [] }));
  const skipped = [];
  // 沒有手動指定、靠自動規則就會歸位的卡，只做統計讓你知道不用管它們
  const autoHandled = { RR: 0, RRR: 0 };

  for (const card of getAllCards()) {
    const target = rarityCategoryId(card);
    if (target !== "RR" && target !== "RRR") continue;

    const override = card.categoryOverrideId;
    if (!override) {
      autoHandled[target] += 1;
      continue;
    }
    if (override === target) continue; // 手動指定的位置本來就對

    const group = groups.find((g) => g.from === override && g.to === target);
    if (group) {
      group.cards.push({
        cardId: card.id,
        name: card.name,
        language: card.language,
        setId: card.setId,
        setName: card.setName,
        cardNumber: card.cardNumber,
        originalRarity: card.originalRarity,
        fromLabel: labelOf(override),
        toLabel: labelOf(target)
      });
    } else {
      // 手動放在其他分類（例如你自己判斷成 SR）的卡不在這次範圍內，保留原狀
      skipped.push({
        cardId: card.id,
        name: card.name,
        currentLabel: labelOf(override),
        wouldBe: labelOf(target)
      });
    }
  }

  return {
    groups,
    total: groups.reduce((n, g) => n + g.cards.length, 0),
    autoHandled,
    skipped
  };
}

/**
 * 實際搬移。依目標分類分組寫入，每組一個交易。
 * 只動 preview 列出來的卡片的「分類」，收藏張數、備註、圖片都不碰。
 */
export async function applyRrRegroup(preview, { bulkSetCategoryOverride, applyCategoryOverrides }) {
  const byTarget = new Map();
  for (const g of preview.groups) {
    if (g.cards.length === 0) continue;
    if (!byTarget.has(g.to)) byTarget.set(g.to, []);
    byTarget.get(g.to).push(...g.cards.map((c) => c.cardId));
  }

  const before = [];
  for (const [target, ids] of byTarget) {
    const res = await bulkSetCategoryOverride(ids, target);
    before.push(...res.before);
  }
  await applyCategoryOverrides();
  return { applied: before.length, before };
}
