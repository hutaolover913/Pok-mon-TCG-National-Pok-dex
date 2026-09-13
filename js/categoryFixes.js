// 一次性的「已確認錯分」修正。
//
// 資料來源是 data/category_fixes.json（由 data/pipeline/step17_build_category_fixes.py
// 從使用者提供的查核 Excel 產生），裡面只有「已確認錯分」的逐張卡片指定，
// 疑似錯分、建議細分、來源疑點等一律不含在內。
//
// 套用規則（每一張分別判斷，不整批硬套）：
//   目前分類 == expectedFrom  -> 套用修正
//   目前分類 == to            -> 已經正確，跳過
//   兩者都不是                -> 可能是使用者後來自己調過，列入衝突清單並保留原狀
//   找不到卡片 ID／辨識欄位對不上 -> 跳過並說明原因
//
// 這是「按下按鈕才執行」的動作，不會在開機時自動跑，也不會在重新整理時
// 把使用者後來的手動調整改回來。套用過的版本會記在 meta，重複執行不會重複搬移。
import { getCard } from "./data.js";
import { getSetting, setSetting } from "./db.js";
import { getCategoryDef } from "./cardCategories.js";

const FIXES_URL = "data/category_fixes.json";
const APPLIED_KEY = "appliedCategoryFixVersions";

let cached = null;

export async function loadCategoryFixes() {
  if (cached) return cached;
  const res = await fetch(FIXES_URL);
  if (!res.ok) throw new Error(`讀取 ${FIXES_URL} 失敗（HTTP ${res.status}）`);
  cached = await res.json();
  return cached;
}

export async function getAppliedVersions() {
  return (await getSetting(APPLIED_KEY, [])) || [];
}

function labelOf(id) {
  const d = getCategoryDef(id);
  return d ? d.label : id;
}

/**
 * 算出這批修正在「目前這台瀏覽器的資料」上會怎麼套用，但不寫入任何東西。
 * 介面拿這個結果顯示預覽。
 */
export async function previewCategoryFixes() {
  const doc = await loadCategoryFixes();
  const toApply = [];
  const already = [];
  const conflicts = [];
  const notFound = [];

  for (const fix of doc.fixes) {
    const card = getCard(fix.cardId);
    if (!card) {
      notFound.push({ ...fix, reason: "目前卡表裡找不到這個卡片 ID" });
      continue;
    }
    // 再核對一次語言／卡包／卡號，確認是同一張同一版本
    const expectedNumber = card.printedTotal ? `${card.cardNumber}/${card.printedTotal}` : String(card.cardNumber);
    const idMismatch = [];
    if (fix.language && fix.language !== card.language) idMismatch.push("語言不符");
    if (fix.setId && fix.setId !== card.setId) idMismatch.push("卡包代碼不符");
    if (fix.cardNumber && fix.cardNumber !== expectedNumber) idMismatch.push("卡號不符");
    if (idMismatch.length) {
      notFound.push({ ...fix, reason: idMismatch.join("、") });
      continue;
    }

    const current = card.rarityCategoryId;
    const entry = {
      ...fix,
      currentCategoryId: current,
      currentLabel: labelOf(current),
      fromLabel: labelOf(fix.expectedFrom),
      toLabel: labelOf(fix.to),
      wasManual: !!card.categoryOverrideId
    };
    if (current === fix.to) already.push(entry);
    else if (current === fix.expectedFrom) toApply.push(entry);
    else conflicts.push(entry);
  }

  const appliedVersions = await getAppliedVersions();
  return {
    version: doc.version,
    builtAt: doc.builtAt,
    source: doc.source,
    note: doc.note,
    notAppliedCounts: doc.notAppliedCounts || {},
    total: doc.fixes.length,
    toApply,
    already,
    conflicts,
    notFound,
    alreadyAppliedBefore: appliedVersions.includes(doc.version)
  };
}

/**
 * 實際套用。只寫入 preview 判定為 toApply 的那些卡片。
 * 整批寫在同一個交易裡，全成功或全不生效。
 */
export async function applyCategoryFixes(preview, { bulkSetCategoryOverride, applyCategoryOverrides }) {
  const ids = preview.toApply.map((f) => f.cardId);
  if (ids.length === 0) {
    await rememberVersion(preview.version);
    return { applied: 0, before: [] };
  }

  // 這批修正的目標分類不一定相同（CHR／MA／SSR／MUR），所以依目標分組寫入
  const byTarget = new Map();
  for (const f of preview.toApply) {
    if (!byTarget.has(f.to)) byTarget.set(f.to, []);
    byTarget.get(f.to).push(f.cardId);
  }

  const allBefore = [];
  for (const [target, cardIds] of byTarget) {
    const { before } = await bulkSetCategoryOverride(cardIds, target);
    allBefore.push(...before);
  }
  await applyCategoryOverrides();
  await rememberVersion(preview.version);
  return { applied: ids.length, before: allBefore };
}

async function rememberVersion(version) {
  const list = await getAppliedVersions();
  if (!list.includes(version)) {
    await setSetting(APPLIED_KEY, [...list, version]);
  }
}
