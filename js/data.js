// 靜態圖鑑／卡片資料載入。species.json / cards.json / sets.json 是隨 App 附帶的
// 資料檔，可日後直接更新這些檔案來新增寶可夢或卡片，不會影響 IndexedDB 內的收藏紀錄。
//
// cards.json 為了縮小體積，卡包／系列名稱等「同一卡包共用」的欄位獨立放在
// sets.json（用 `${language}:${setId}` 查表），圖片也只存一份基底網址，
// 這裡載入時統一展開成 imageSmall / imageLarge / setName / seriesName /
// printedTotal / releaseDate，其餘畫面程式碼可以直接當作卡片本身的欄位使用。
import { getAllCategories, getAllCustomImageIds, getCustomImage, getAllCategoryOverrides } from "./db.js";
import { classifyCard, rarityCategoryId, resolveCategoryIds, resolveRarityCategoryId } from "./cardCategories.js";

let speciesList = null;
let speciesById = null;
let cardsList = null;
let cardsById = null;
let cardsBySpecies = null; // speciesId -> [card,...]
let setsMeta = null;
let imageCandidates = {}; // cardId -> {note, candidates:[{path,title,number,setName,sourceUrl}]}
const customImageObjectUrls = new Map(); // id -> objectURL，避免重複建立/外洩

function buildCategoryResolver(categories) {
  const map = new Map();
  for (const c of categories) {
    for (const r of c.rarities || []) {
      map.set(r.toLowerCase(), c.id);
    }
  }
  return (rarity) => map.get((rarity || "").toLowerCase()) || "OTHER";
}

export async function loadStaticData() {
  if (speciesList && cardsList) return;
  const [speciesRes, cardsRes, setsRes, localMapRes, candidatesRes, categories] = await Promise.all([
    fetch("data/species.json"),
    fetch("data/cards.json"),
    fetch("data/sets.json"),
    fetch("data/image_local_map.json").catch(() => null),
    fetch("data/image_candidates.json").catch(() => null),
    getAllCategories()
  ]);
  speciesList = await speciesRes.json();
  cardsList = await cardsRes.json();
  setsMeta = await setsRes.json();

  // 待人工核對的候選卡圖（data/pipeline/step13_build_candidate_list.py 產生）。
  // 這些卡片在兩個資料庫之間編號規則不同，無法機械式確認是不是同一版本，
  // 所以不自動套用，只在詳細頁顯示給使用者自己看圖決定。
  if (candidatesRes && candidatesRes.ok) {
    try {
      imageCandidates = await candidatesRes.json();
    } catch {
      imageCandidates = {};
    }
  }
  // 圖片本機快取對照表（data/pipeline/step5_download_images.py 產生）。
  // 抓不到這個檔案（例如還沒跑過下載腳本）就當作空表，全部退回遠端網址，
  // 不影響 App 正常運作。
  let localImageMap = { species: {}, cards: {} };
  if (localMapRes && localMapRes.ok) {
    try {
      localImageMap = await localMapRes.json();
    } catch {
      // 檔案格式異常時忽略，退回遠端網址
    }
  }

  speciesById = new Map(speciesList.map((s) => [s.id, s]));
  for (const s of speciesList) {
    // 先留一份原始遠端網址：本機檔案不在時（例如剛 clone 還沒補圖），
    // 前端的 onerror 會退回這個網址，而不是直接顯示佔位圖。
    s.remoteImageUrl = s.imageUrl;
    const local = localImageMap.species && localImageMap.species[String(s.id)];
    if (local) s.imageUrl = local;
  }

  const resolveCategory = buildCategoryResolver(categories);

  cardsBySpecies = new Map();
  cardsById = new Map();
  for (const card of cardsList) {
    const setInfo = setsMeta[`${card.language}:${card.setId}`] || {};
    card.setName = setInfo.setName || card.setId;
    card.seriesId = setInfo.seriesId;
    card.seriesName = setInfo.seriesName;
    card.printedTotal = setInfo.printedTotal;
    card.releaseDate = setInfo.releaseDate;
    const localCardImage = localImageMap.cards && localImageMap.cards[card.id];
    card.remoteImageSmall = card.image ? `${card.image}/low.webp` : null;
    card.imageSmall = localCardImage || card.remoteImageSmall;
    card.imageLarge = card.image ? `${card.image}/high.webp` : null;
    // categoryId：沿用使用者可在「設定」調整的對照表，圖鑑徽章用這個。
    // categoryIds：js/cardCategories.js 那份分語言、可複數的規則，卡片分類頁用。
    // 兩者的預設值同源（categories.js 由 cardCategories.js 推導），所以不會互相矛盾；
    // 差別只在使用者有沒有自己改過設定頁的對照表。
    card.categoryId = resolveCategory(card.originalRarity);
    // autoCategoryIds／autoRarityCategoryId 永遠是「系統自動判定」的結果，
    // 不會被使用者的手動指定蓋掉；手動指定另外存在 IndexedDB，
    // 由 applyCategoryOverrides() 疊上去算出 categoryIds。
    card.autoRarityCategoryId = rarityCategoryId(card);
    card.autoCategoryIds = classifyCard(card);
    card.categoryOverrideId = null;
    card.rarityCategoryId = card.autoRarityCategoryId;
    card.categoryIds = card.autoCategoryIds;

    cardsById.set(card.id, card);
    for (const dexId of card.dexNumbers || []) {
      if (!cardsBySpecies.has(dexId)) cardsBySpecies.set(dexId, []);
      cardsBySpecies.get(dexId).push(card);
    }
  }

  await applyCategoryOverrides();
  await applyCustomImageOverrides();
}

// 使用者手動指定的卡片分類。開機時套一次，之後每次改動用
// refreshCategoryOverrideForCard() 局部更新，不需要重新載入整份卡表。
export async function applyCategoryOverrides() {
  const overrides = await getAllCategoryOverrides();
  const overrideMap = new Map(overrides.map((o) => [o.cardId, o.categoryId]));

  // 一定要先把「目前帶著手動分類、但資料庫裡已經沒有那筆紀錄」的卡片還原成
  // 自動分類，否則批量復原（把覆寫刪掉）之後，記憶體裡的卡片會繼續停在舊分類，
  // 畫面上看起來像復原失敗。
  for (const card of cardsList) {
    if (card.categoryOverrideId && !overrideMap.has(card.id)) {
      card.categoryOverrideId = null;
      card.rarityCategoryId = card.autoRarityCategoryId;
      card.categoryIds = card.autoCategoryIds;
    }
  }

  for (const [cardId, categoryId] of overrideMap) {
    const card = cardsById.get(cardId);
    if (!card) continue; // 卡表換版後可能有對不到的紀錄，保留在 DB 不動它
    card.categoryOverrideId = categoryId;
    card.rarityCategoryId = resolveRarityCategoryId(card, categoryId);
    card.categoryIds = resolveCategoryIds(card, categoryId);
  }
}

/**
 * 單張卡的分類改動後呼叫，讓記憶體中的卡表立刻反映新狀態。
 * @param {string} cardId
 * @param {string|null} overrideCategoryId null＝恢復自動分類
 */
export function refreshCategoryOverrideForCard(cardId, overrideCategoryId) {
  const card = cardsById.get(cardId);
  if (!card) return null;
  card.categoryOverrideId = overrideCategoryId || null;
  card.rarityCategoryId = resolveRarityCategoryId(card, overrideCategoryId);
  card.categoryIds = resolveCategoryIds(card, overrideCategoryId);
  return card;
}

// 使用者在「設定」或詳細頁自行上傳的替代圖片，優先權高於本機快取與遠端網址。
// 只針對「真的有上傳過」的少數 id 建立 object URL，不會為全部卡片預先建立。
const originalImageValues = new Map(); // id -> 套用自訂圖片前的原始值（本機快取或遠端網址）

async function applyCustomImageOverrides() {
  const ids = await getAllCustomImageIds();
  for (const id of ids) {
    await refreshCustomImageForId(id);
  }
}

function resolveImageTarget(id) {
  return id.startsWith("species:") ? speciesById.get(Number(id.slice(8))) : cardsById.get(id);
}

function imageFieldName(id) {
  return id.startsWith("species:") ? "imageUrl" : "imageSmall";
}

// 上傳／刪除自訂圖片後呼叫，讓該張圖片立即反映新狀態，不需要整頁重新整理。
export async function refreshCustomImageForId(id) {
  const existingUrl = customImageObjectUrls.get(id);
  if (existingUrl) {
    URL.revokeObjectURL(existingUrl);
    customImageObjectUrls.delete(id);
  }

  const target = resolveImageTarget(id);
  if (!target) return;
  const field = imageFieldName(id);

  if (!originalImageValues.has(id)) {
    originalImageValues.set(id, target[field]);
  }

  const record = await getCustomImage(id);
  if (!record) {
    // 使用者移除了自訂圖片：恢復成本機快取／遠端網址原本的值。
    target[field] = originalImageValues.get(id);
    return;
  }
  const url = URL.createObjectURL(record.blob);
  customImageObjectUrls.set(id, url);
  target[field] = url;
}

export function getAllSpecies() {
  return speciesList;
}

export function getSpecies(id) {
  return speciesById.get(Number(id));
}

export function getAllCards() {
  return cardsList;
}

export function getCardsForSpecies(speciesId) {
  return cardsBySpecies.get(Number(speciesId)) || [];
}

export function getCard(cardId) {
  return cardsById.get(cardId);
}

export function getMaxDexNumber() {
  return speciesList.reduce((max, s) => Math.max(max, s.id), 0);
}

export function getGenerations() {
  const gens = new Set(speciesList.map((s) => s.generation));
  return Array.from(gens).sort((a, b) => a - b);
}

export function getAllSetsMeta() {
  return setsMeta;
}

// 某張卡有沒有「待人工核對」的候選圖片（沒有就回 null）
export function getImageCandidates(cardId) {
  return imageCandidates[cardId] || null;
}
