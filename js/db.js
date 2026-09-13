// IndexedDB 儲存層。所有收藏資料（手動標記、實際卡片收藏、分類對應表、
// 使用者設定）都保存在這裡，卡圖鑑資料（species.json / cards.json）則是
// 隨 App 附帶的靜態資料，不寫回資料庫，因此「更新卡表」不會動到收藏紀錄。
import { DEFAULT_CATEGORIES, BUILTIN_RARITY_MAPPING_VERSION } from "./categories.js";

const DB_NAME = "pokecard-dex";
const DB_VERSION = 3;

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (ev) => {
      const db = req.result;
      if (!db.objectStoreNames.contains("manualFlags")) {
        db.createObjectStore("manualFlags", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("cardOwnership")) {
        const store = db.createObjectStore("cardOwnership", { keyPath: "cardId" });
        store.createIndex("bySpecies", "speciesIds", { multiEntry: true });
      }
      if (!db.objectStoreNames.contains("categories")) {
        db.createObjectStore("categories", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("meta")) {
        db.createObjectStore("meta", { keyPath: "key" });
      }
      // v2：使用者手動上傳的替代圖片（找不到來源圖片時自行補圖用）。
      // id 是 `species:<圖鑑編號>` 或卡片本身的 id，值存實際檔案 Blob。
      if (!db.objectStoreNames.contains("customImages")) {
        db.createObjectStore("customImages", { keyPath: "id" });
      }
      // v3：使用者手動指定的卡片分類（覆寫系統自動判定的結果）。
      // 用穩定的卡片 id 當 key（含語言與卡號，例如 tcgdex:ja:S12a-205），
      // 不用卡名，避免不同語言／卡號的同名卡互相影響。
      // 這裡只存「使用者自己選的分類」，不動卡片的原始稀有度，也不動收藏紀錄。
      if (!db.objectStoreNames.contains("cardCategoryOverrides")) {
        db.createObjectStore("cardCategoryOverrides", { keyPath: "cardId" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(db, storeNames, mode = "readonly") {
  return db.transaction(storeNames, mode);
}

function reqToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function getAll(storeName) {
  const db = await openDB();
  const t = tx(db, [storeName]);
  return reqToPromise(t.objectStore(storeName).getAll());
}

async function put(storeName, value) {
  const db = await openDB();
  const t = tx(db, [storeName], "readwrite");
  t.objectStore(storeName).put(value);
  return new Promise((resolve, reject) => {
    t.oncomplete = () => resolve(value);
    t.onerror = () => reject(t.error);
  });
}

async function get(storeName, key) {
  const db = await openDB();
  const t = tx(db, [storeName]);
  return reqToPromise(t.objectStore(storeName).get(key));
}

async function del(storeName, key) {
  const db = await openDB();
  const t = tx(db, [storeName], "readwrite");
  t.objectStore(storeName).delete(key);
  return new Promise((resolve, reject) => {
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

// 內建分類的「稀有度 -> 分類」對照表若之後隨 App 更新新增了值（例如新匯入的
// 卡片資料庫用到新的稀有度字串），既有使用者裝置上 IndexedDB 存的是舊清單，
// 不會自動變新。這裡在每次開機時，把 js/categories.js 目前的預設值「聯集」
// 進裝置上已存在的內建分類，只增加缺少的稀有度字串，不會動到使用者自己
// 新增的自訂分類，也不會清掉使用者手動從內建分類移除過的字串以外的資料。
export async function ensureSeeded() {
  const existing = await getAll("categories");
  const existingById = new Map(existing.map((c) => [c.id, c]));
  const storedVersion = await getSetting("builtinRarityMappingVersion", 0);
  // 對照表本身改版（不是只多了幾個稀有度字串，而是原本的對應是錯的）時，
  // 內建分類的 rarities 要整份換成新的預設值，不能只做聯集 —— 聯集會把
  // 舊的錯誤對應留著。使用者自己新增的自訂分類 (builtin !== true) 不受影響。
  const needsRemap = storedVersion !== BUILTIN_RARITY_MAPPING_VERSION;

  const db = await openDB();
  const t = tx(db, ["categories"], "readwrite");
  const store = t.objectStore("categories");

  for (const def of DEFAULT_CATEGORIES) {
    const current = existingById.get(def.id);
    if (!current) {
      store.put(def);
      continue;
    }
    if (needsRemap) {
      // 內建分類的稀有度對照、說明與排序都換成新版（這些是 App 定義的，不是
      // 使用者資料）；使用者可能改過的顯示名稱與顏色保留。
      store.put({
        ...current,
        label: def.label,
        color: def.color,
        rarities: def.rarities,
        description: def.description,
        order: def.order
      });
      continue;
    }
    const mergedRarities = Array.from(new Set([...(current.rarities || []), ...def.rarities]));
    if (mergedRarities.length !== (current.rarities || []).length) {
      store.put({ ...current, rarities: mergedRarities });
    }
  }

  // 清掉「曾經是內建分類、但新版已經移除」的殘留項目。判斷依據是 builtin === true，
  // 所以使用者自己新增的自訂分類不會被動到。
  const defaultIds = new Set(DEFAULT_CATEGORIES.map((d) => d.id));
  for (const cat of existing) {
    if (cat.builtin === true && !defaultIds.has(cat.id)) {
      store.delete(cat.id);
    }
  }

  await new Promise((resolve, reject) => {
    t.oncomplete = resolve;
    t.onerror = () => reject(t.error);
  });

  if (needsRemap) {
    await setSetting("builtinRarityMappingVersion", BUILTIN_RARITY_MAPPING_VERSION);
  }
  invalidateCategoryCache();
  return { remapped: needsRemap && existing.length > 0 };
}

// ---------- Categories ----------
export async function getAllCategories() {
  const list = await getAll("categories");
  return list.sort((a, b) => a.order - b.order);
}

export async function saveCategory(cat) {
  return put("categories", cat);
}

export async function deleteCategory(id) {
  return del("categories", id);
}

let categoryCacheByRarity = null;
export function invalidateCategoryCache() {
  categoryCacheByRarity = null;
}

export async function resolveCategoryForRarity(rarity) {
  if (!categoryCacheByRarity) {
    const cats = await getAllCategories();
    categoryCacheByRarity = new Map();
    for (const c of cats) {
      for (const r of c.rarities || []) {
        categoryCacheByRarity.set(r.toLowerCase(), c.id);
      }
    }
  }
  return categoryCacheByRarity.get((rarity || "").toLowerCase()) || "OTHER";
}

// ---------- Manual flags ----------
// id 格式："species:<id>" 代表整隻寶可夢手動標記；
// "cat:<speciesId>:<categoryId>" 代表某分類手動標記。
function speciesFlagId(speciesId) {
  return `species:${speciesId}`;
}
function categoryFlagId(speciesId, categoryId) {
  return `cat:${speciesId}:${categoryId}`;
}

export async function getAllManualFlags() {
  return getAll("manualFlags");
}

export async function getManualFlagsForSpecies(speciesId) {
  const all = await getAllManualFlags();
  const prefix1 = speciesFlagId(speciesId);
  const prefix2 = `cat:${speciesId}:`;
  return all.filter((f) => f.id === prefix1 || f.id.startsWith(prefix2));
}

export async function setSpeciesManualFlag(speciesId, active) {
  const id = speciesFlagId(speciesId);
  const now = Date.now();
  const existing = await get("manualFlags", id);
  const record = {
    id,
    speciesId,
    categoryId: null,
    active,
    createdAt: existing ? existing.createdAt : now,
    updatedAt: now
  };
  await put("manualFlags", record);
  return record;
}

export async function setCategoryManualFlag(speciesId, categoryId, active) {
  const id = categoryFlagId(speciesId, categoryId);
  const now = Date.now();
  const existing = await get("manualFlags", id);
  const record = {
    id,
    speciesId,
    categoryId,
    active,
    createdAt: existing ? existing.createdAt : now,
    updatedAt: now
  };
  await put("manualFlags", record);
  return record;
}

export async function getSpeciesManualFlag(speciesId) {
  return get("manualFlags", speciesFlagId(speciesId));
}

export async function getCategoryManualFlag(speciesId, categoryId) {
  return get("manualFlags", categoryFlagId(speciesId, categoryId));
}

// ---------- Card ownership ----------
export async function getAllOwnership() {
  return getAll("cardOwnership");
}

export async function getOwnership(cardId) {
  return get("cardOwnership", cardId);
}

export async function getOwnershipForSpecies(speciesId) {
  const db = await openDB();
  const t = tx(db, ["cardOwnership"]);
  const idx = t.objectStore("cardOwnership").index("bySpecies");
  return reqToPromise(idx.getAll(speciesId));
}

export async function setOwnership({ cardId, speciesIds, categoryId, count, note }) {
  const now = Date.now();
  const existing = await get("cardOwnership", cardId);
  const record = {
    cardId,
    speciesIds,
    categoryId,
    count: Math.max(0, count | 0),
    note: note || "",
    createdAt: existing ? existing.createdAt : now,
    updatedAt: now
  };
  await put("cardOwnership", record);
  return record;
}

// ---------- 使用者手動上傳的替代圖片 ----------
// key 統一用「species:<圖鑑編號>」代表寶可夢立繪，或卡片本身的 id 代表卡圖。
// 存的是實際檔案 Blob，不會受清除瀏覽器快取影響（跟收藏資料一樣存在
// IndexedDB），匯出/清除收藏資料的流程目前不含這裡的圖片，避免備份檔案
// 過大；圖片本身另外用「匯出圖片」／逐張刪除管理。
export function speciesImageKey(speciesId) {
  return `species:${speciesId}`;
}

export async function setCustomImage(id, blob, fileName) {
  const record = {
    id,
    blob,
    mimeType: blob.type || "application/octet-stream",
    fileName: fileName || "",
    byteSize: blob.size,
    uploadedAt: Date.now()
  };
  await put("customImages", record);
  return record;
}

export async function getCustomImage(id) {
  return get("customImages", id);
}

export async function deleteCustomImage(id) {
  return del("customImages", id);
}

export async function getAllCustomImageIds() {
  const all = await getAll("customImages");
  return all.map((r) => r.id);
}

// ---------- 使用者手動指定的卡片分類 ----------
// 三層資料刻意分開保存，彼此不覆蓋：
//   1. 來源原始稀有度 -> cards.json 的 originalRarity（唯讀，永遠不動）
//   2. 系統自動判定   -> js/cardCategories.js 依規則即時算出來的，不存 DB
//   3. 使用者手動指定 -> 就是這個 store
// 顯示與匯出時優先用 (3)，沒有才用 (2)。
//
// 「手動選擇待確認」與「恢復自動分類」是兩件不同的事：
//   前者會寫入一筆 categoryId === "UNVERIFIED" 的覆寫紀錄（代表「我看過了，
//   確實無法判斷」）；後者是把整筆覆寫紀錄刪掉，回到系統自動判定。

export async function getAllCategoryOverrides() {
  return getAll("cardCategoryOverrides");
}

export async function getCategoryOverride(cardId) {
  return get("cardCategoryOverrides", cardId);
}

export async function setCategoryOverride(cardId, categoryId) {
  const now = Date.now();
  const existing = await get("cardCategoryOverrides", cardId);
  const record = {
    cardId,
    categoryId,
    createdAt: existing ? existing.createdAt : now,
    updatedAt: now
  };
  await put("cardCategoryOverrides", record);
  return record;
}

/** 恢復自動分類：刪掉覆寫紀錄。回傳被刪掉的那筆，方便「復原」用。 */
export async function clearCategoryOverride(cardId) {
  const existing = await get("cardCategoryOverrides", cardId);
  await del("cardCategoryOverrides", cardId);
  return existing || null;
}

// ---------- 批量操作（整批成功或整批失敗） ----------

/**
 * 在「同一個交易」裡分批送出寫入請求。
 *
 * 為什麼需要這個：把 9,108 筆 put 寫在一個 for 迴圈裡，主執行緒會被
 * 結構化複製與索引維護卡住約 1.5～2 秒（實測），期間畫面完全不回應。
 * 但為了整批成功或整批回復，又不能拆成多個交易。
 *
 * 解法：一次只送一批（預設 300 筆），然後等這一批最後一個請求的 onsuccess
 * 再送下一批。IndexedDB 的交易只要「還有未完成的請求」就會保持開啟，所以
 * 原子性不變；而每批之間的回呼是新的一個 task，主執行緒因此有空檔去處理
 * 捲動、重繪與進度更新。
 *
 * @param {IDBObjectStore} store
 * @param {Array<{type:"put"|"delete", value?:any, key?:any}>} ops
 * @param {(done:number,total:number)=>void} [onProgress]
 */
function runOpsChunked(store, ops, onProgress, chunkSize = 300) {
  return new Promise((resolve, reject) => {
    let i = 0;
    const step = () => {
      if (i >= ops.length) {
        resolve();
        return;
      }
      const end = Math.min(i + chunkSize, ops.length);
      let lastReq = null;
      for (; i < end; i++) {
        const op = ops[i];
        lastReq = op.type === "delete" ? store.delete(op.key) : store.put(op.value);
      }
      if (onProgress) onProgress(i, ops.length);
      lastReq.onsuccess = step;
      lastReq.onerror = () => reject(lastReq.error);
    };
    step();
  });
}

// 全部走同一個 IndexedDB 交易：只要中途任何一筆失敗，整個交易會 abort，
// 資料庫回到操作前的狀態，不會留下「改了一半」的結果。

/**
 * 批量指定手動分類。
 * @param {string[]} cardIds
 * @param {string} categoryId
 * @returns {Promise<{moved:number, before:Array}>} before 是每張卡原本的手動分類
 *          （null 代表原本是自動分類），給「復原這次移動」逐張還原用。
 */
export async function bulkSetCategoryOverride(cardIds, categoryId, onProgress) {
  const db = await openDB();
  const ids = Array.from(new Set(cardIds));
  const existing = await getAllCategoryOverrides();
  const prevMap = new Map(existing.map((o) => [o.cardId, o.categoryId]));
  const before = ids.map((id) => ({ cardId: id, categoryId: prevMap.get(id) ?? null }));

  // 用 Map 查原本的 createdAt，不要在迴圈裡 existing.find()：
  // 那是 O(n²)，一次移動 9,108 張就是 8,300 萬次比對，實測會讓主執行緒
  // 卡住約 0.5 秒。
  const createdAtMap = new Map(existing.map((o) => [o.cardId, o.createdAt]));
  const now = Date.now();
  const t = tx(db, ["cardCategoryOverrides"], "readwrite");
  const store = t.objectStore("cardCategoryOverrides");
  const ops = ids.map((id) => ({
    type: "put",
    value: { cardId: id, categoryId, createdAt: createdAtMap.get(id) ?? now, updatedAt: now }
  }));
  await runOpsChunked(store, ops, onProgress);
  await new Promise((resolve, reject) => {
    t.oncomplete = resolve;
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error("批量分類交易被中止"));
  });
  return { moved: ids.length, before };
}

/**
 * 還原一次批量移動：把每張卡的手動分類放回操作前的值。
 * categoryId === null 代表原本就沒有手動分類，要刪掉覆寫紀錄（回到自動分類）。
 */
export async function bulkRestoreCategoryOverrides(before, onProgress) {
  const db = await openDB();
  const now = Date.now();
  const t = tx(db, ["cardCategoryOverrides"], "readwrite");
  const store = t.objectStore("cardCategoryOverrides");
  const ops = before.map((rec) =>
    rec.categoryId === null || rec.categoryId === undefined
      ? { type: "delete", key: rec.cardId }
      : { type: "put", value: { cardId: rec.cardId, categoryId: rec.categoryId, createdAt: now, updatedAt: now } }
  );
  await runOpsChunked(store, ops, onProgress);
  await new Promise((resolve, reject) => {
    t.oncomplete = resolve;
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error("還原分類交易被中止"));
  });
  return before.length;
}

/**
 * 批量清除收藏：把持有張數設為 0。
 *
 * 刻意**不刪除** cardOwnership 那一筆紀錄，只把 count 歸零，因為備註
 * （note）也存在同一筆裡，刪掉會把備註一起弄丟。卡片資料、圖片、手動分類
 * 完全不在這個交易的範圍內，碰都不會碰到。
 *
 * @param {string[]} cardIds 要清除的卡片
 * @param {string[]} manualFlagIds 要一併清除的手動點亮紀錄 id（可為空陣列）
 * @returns {Promise<{clearedCards:number, clearedCopies:number, clearedFlags:number, snapshot:object}>}
 *          snapshot 給「復原上一次清除」用
 */
export async function bulkClearOwnership(cardIds, manualFlagIds = [], onProgress) {
  const db = await openDB();
  const ids = Array.from(new Set(cardIds));
  const flagIds = Array.from(new Set(manualFlagIds));

  const allOwn = await getAllOwnership();
  const ownMap = new Map(allOwn.map((o) => [o.cardId, o]));
  const allFlags = await getAllManualFlags();
  const flagMap = new Map(allFlags.map((f) => [f.id, f]));

  // 只處理真的有東西可清的，數字才不會灌水
  const affected = ids.filter((id) => (ownMap.get(id) || {}).count > 0);
  const affectedFlags = flagIds.filter((id) => (flagMap.get(id) || {}).active);

  const snapshot = {
    takenAt: Date.now(),
    ownership: affected.map((id) => {
      const o = ownMap.get(id);
      return { cardId: o.cardId, speciesIds: o.speciesIds, categoryId: o.categoryId, count: o.count, note: o.note };
    }),
    manualFlags: affectedFlags.map((id) => ({ ...flagMap.get(id) }))
  };
  const clearedCopies = snapshot.ownership.reduce((sum, o) => sum + o.count, 0);

  const now = Date.now();
  const t = tx(db, ["cardOwnership", "manualFlags"], "readwrite");
  const ownStore = t.objectStore("cardOwnership");
  const flagStore = t.objectStore("manualFlags");
  const ownOps = snapshot.ownership.map((rec) => ({
    type: "put",
    value: { ...ownMap.get(rec.cardId), count: 0, updatedAt: now } // note 原樣保留
  }));
  await runOpsChunked(ownStore, ownOps, onProgress);
  const flagOps = snapshot.manualFlags.map((f) => ({
    type: "put",
    value: { ...flagMap.get(f.id), active: false, updatedAt: now }
  }));
  await runOpsChunked(flagStore, flagOps);
  await new Promise((resolve, reject) => {
    t.oncomplete = resolve;
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error("清除收藏交易被中止"));
  });

  await setSetting("lastClearSnapshot", snapshot);
  return {
    clearedCards: snapshot.ownership.length,
    clearedCopies,
    clearedFlags: snapshot.manualFlags.length,
    snapshot
  };
}

/**
 * 復原上一次清除。
 *
 * 會先檢查衝突：如果某張卡在清除之後又被重新收藏過（count 已經不是 0），
 * 就不覆蓋它，改列進 conflicts 回報，由介面告訴使用者。
 */
export async function restoreLastClear({ overwriteConflicts = false, onProgress } = {}) {
  const snapshot = await getSetting("lastClearSnapshot", null);
  if (!snapshot || !Array.isArray(snapshot.ownership)) {
    return { restored: 0, conflicts: [], missing: true };
  }
  const db = await openDB();
  const allOwn = await getAllOwnership();
  const ownMap = new Map(allOwn.map((o) => [o.cardId, o]));

  const conflicts = [];
  const toRestore = [];
  for (const rec of snapshot.ownership) {
    const current = ownMap.get(rec.cardId);
    if (current && current.count > 0 && !overwriteConflicts) {
      conflicts.push({ cardId: rec.cardId, currentCount: current.count, snapshotCount: rec.count });
      continue;
    }
    toRestore.push(rec);
  }

  const now = Date.now();
  const t = tx(db, ["cardOwnership", "manualFlags"], "readwrite");
  const ownStore = t.objectStore("cardOwnership");
  const flagStore = t.objectStore("manualFlags");
  const ownOps = toRestore.map((rec) => {
    const current = ownMap.get(rec.cardId);
    return {
      type: "put",
      value: {
        ...(current || {}),
        cardId: rec.cardId,
        speciesIds: rec.speciesIds,
        categoryId: rec.categoryId,
        count: rec.count,
        // 備註沿用資料庫現有的（清除時本來就沒動它），快照只是保底
        note: current ? current.note : rec.note,
        updatedAt: now
      }
    };
  });
  await runOpsChunked(ownStore, ownOps, onProgress);
  const flagOps = (snapshot.manualFlags || []).map((f) => ({
    type: "put", value: { ...f, active: true, updatedAt: now }
  }));
  await runOpsChunked(flagStore, flagOps);
  await new Promise((resolve, reject) => {
    t.oncomplete = resolve;
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error("復原清除交易被中止"));
  });

  if (conflicts.length === 0) await setSetting("lastClearSnapshot", null);
  return { restored: toRestore.length, restoredFlags: (snapshot.manualFlags || []).length, conflicts, missing: false };
}

export async function getLastClearSnapshotInfo() {
  const snapshot = await getSetting("lastClearSnapshot", null);
  if (!snapshot) return null;
  return {
    takenAt: snapshot.takenAt,
    cards: (snapshot.ownership || []).length,
    copies: (snapshot.ownership || []).reduce((s, o) => s + o.count, 0),
    flags: (snapshot.manualFlags || []).length
  };
}

// ---------- 卡片 ID 遷移 ----------
// 卡片資料庫改版（例如換了資料來源、卡片 ID 規則不同）時，用這個機制把使用者
// 既有的實際收藏紀錄從舊 ID 搬到新 ID，而不是讓收藏紀錄憑空消失。
// 遷移前一定會先把 manualFlags／cardOwnership 存一份快照到 meta，再動手改，
// 就算遷移對照表有誤，也能從快照救回原始資料。
export async function migrateCardIds(migrationMap, migrationVersion) {
  const flagKey = `cardIdMigration:${migrationVersion}`;
  const already = await getSetting(flagKey, false);
  if (already) return { applied: false, migrated: 0, orphaned: 0 };

  const allOwnership = await getAllOwnership();
  const relevant = allOwnership.filter((o) => o.cardId in migrationMap);
  // 手動指定的分類也是綁在卡片 id 上的，卡表換 id 時一定要一起搬，
  // 不然使用者辛苦標好的分類會在更新卡表後憑空消失。
  const allOverrides = await getAllCategoryOverrides();
  const relevantOverrides = allOverrides.filter((o) => o.cardId in migrationMap);

  if (relevant.length === 0 && relevantOverrides.length === 0) {
    await setSetting(flagKey, true);
    return { applied: true, migrated: 0, migratedOverrides: 0, orphaned: 0 };
  }

  const backup = await exportAllData();
  await setSetting(`backupBeforeMigration:${migrationVersion}`, backup);

  const db = await openDB();
  const t = tx(db, ["cardOwnership"], "readwrite");
  const store = t.objectStore("cardOwnership");

  for (const oldRecord of relevant) {
    const newCardId = migrationMap[oldRecord.cardId];
    const existingNewReq = store.get(newCardId);
    await new Promise((resolve, reject) => {
      existingNewReq.onsuccess = () => {
        const existingNew = existingNewReq.result;
        const merged = existingNew
          ? {
              ...existingNew,
              count: Math.max(existingNew.count, oldRecord.count),
              note: [existingNew.note, oldRecord.note].filter(Boolean).join(" / "),
              updatedAt: Date.now()
            }
          : { ...oldRecord, cardId: newCardId, updatedAt: Date.now() };
        store.put(merged);
        store.delete(oldRecord.cardId);
        resolve();
      };
      existingNewReq.onerror = () => reject(existingNewReq.error);
    });
  }

  await new Promise((resolve, reject) => {
    t.oncomplete = resolve;
    t.onerror = () => reject(t.error);
  });

  if (relevantOverrides.length > 0) {
    const t2 = tx(db, ["cardCategoryOverrides"], "readwrite");
    const store2 = t2.objectStore("cardCategoryOverrides");
    for (const rec of relevantOverrides) {
      const newCardId = migrationMap[rec.cardId];
      store2.put({ ...rec, cardId: newCardId, updatedAt: Date.now() });
      store2.delete(rec.cardId);
    }
    await new Promise((resolve, reject) => {
      t2.oncomplete = resolve;
      t2.onerror = () => reject(t2.error);
    });
  }

  await setSetting(flagKey, true);
  return {
    applied: true,
    migrated: relevant.length,
    migratedOverrides: relevantOverrides.length,
    orphaned: 0
  };
}

// ---------- 儲存空間持久化 ----------
// 預設情況下瀏覽器把 IndexedDB 當成「盡力而為」(best-effort) 的資料：磁碟空間
// 吃緊時，瀏覽器**有權自行清掉**它來釋放空間。收藏紀錄與手動分類都在裡面，
// 被清掉就沒了，所以開機時主動申請 persistent 儲存把它升級成「不可自動清除」。
//
// localhost 與已加入主畫面的 PWA 通常會直接獲准，不會跳任何視窗。
// 就算被拒絕也不影響功能，只是少了這層保護，所以失敗只記錄不擋流程。
export async function requestPersistentStorage() {
  if (!navigator.storage || !navigator.storage.persist) {
    return { supported: false, persisted: false };
  }
  try {
    const already = await navigator.storage.persisted();
    if (already) return { supported: true, persisted: true, alreadyGranted: true };
    const granted = await navigator.storage.persist();
    return { supported: true, persisted: granted };
  } catch {
    return { supported: true, persisted: false };
  }
}

/** 目前用了多少空間、上限多少、有沒有受保護。設定頁顯示用。 */
export async function getStorageStatus() {
  const out = { supported: false, persisted: false, usageBytes: 0, quotaBytes: 0 };
  if (!navigator.storage) return out;
  out.supported = true;
  try {
    if (navigator.storage.persisted) out.persisted = await navigator.storage.persisted();
    if (navigator.storage.estimate) {
      const est = await navigator.storage.estimate();
      out.usageBytes = est.usage || 0;
      out.quotaBytes = est.quota || 0;
    }
  } catch {
    // 取不到就顯示未知，不要因此讓設定頁開不起來
  }
  return out;
}

// ---------- Settings ----------
export async function getSetting(key, defaultValue) {
  const rec = await get("meta", key);
  return rec ? rec.value : defaultValue;
}

export async function setSetting(key, value) {
  await put("meta", { key, value });
}

// ---------- Export / Import ----------
// formatVersion 2 起，備份檔會一併帶上「手動上傳／採用的自訂圖片」（base64）。
// 這很重要：IndexedDB 是依「網址（含連接埠）」分開存放的，localhost:8811 與
// localhost:8812 對瀏覽器來說是兩個不同的網站，資料不互通。備份檔含圖片才有
// 辦法在換連接埠、換瀏覽器或換電腦時把自己補的圖一起搬過去。
const EXPORT_FORMAT_VERSION = 2;

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function dataUrlToBlob(dataUrl) {
  const res = await fetch(dataUrl);
  return res.blob();
}

export async function exportAllData() {
  const [manualFlags, cardOwnership, categories, categoryOverrides, customImageRecords] = await Promise.all([
    getAllManualFlags(),
    getAllOwnership(),
    getAllCategories(),
    getAllCategoryOverrides(),
    getAll("customImages")
  ]);

  const customImages = [];
  for (const rec of customImageRecords) {
    if (!rec || !rec.blob) continue;
    customImages.push({
      id: rec.id,
      fileName: rec.fileName || "",
      mimeType: rec.mimeType || rec.blob.type || "application/octet-stream",
      byteSize: rec.byteSize || rec.blob.size,
      uploadedAt: rec.uploadedAt || null,
      dataUrl: await blobToDataUrl(rec.blob)
    });
  }

  return {
    formatVersion: EXPORT_FORMAT_VERSION,
    appId: "pokecard-ptcg-dex",
    exportedAt: new Date().toISOString(),
    manualFlags,
    cardOwnership,
    categories,
    // 手動指定的分類：用穩定卡片 id 保存，備份還原後仍然對得回同一張卡
    categoryOverrides,
    customImages
  };
}

function validateImportShape(payload) {
  if (!payload || typeof payload !== "object") return "不是有效的 JSON 物件";
  // 舊版備份（formatVersion 1，沒有 customImages）也要能匯入，不要讓使用者
  // 之前存下來的備份檔變成廢檔。
  if (payload.formatVersion !== 1 && payload.formatVersion !== 2) {
    return "檔案格式版本不相容（缺少或錯誤的 formatVersion）";
  }
  if (!Array.isArray(payload.manualFlags)) return "缺少 manualFlags 陣列";
  if (!Array.isArray(payload.cardOwnership)) return "缺少 cardOwnership 陣列";
  if (!Array.isArray(payload.categories)) return "缺少 categories 陣列";
  if (payload.customImages !== undefined && !Array.isArray(payload.customImages)) {
    return "customImages 欄位格式錯誤（應為陣列）";
  }
  if (payload.categoryOverrides !== undefined && !Array.isArray(payload.categoryOverrides)) {
    return "categoryOverrides 欄位格式錯誤（應為陣列）";
  }
  return null;
}

// 自訂圖片另外用一個交易寫入：圖片體積大、而且轉 blob 是非同步的，
// 塞進上面的收藏資料交易裡會讓 IndexedDB 交易在 await 之間自動結束而失敗。
async function importCustomImages(list, mode) {
  if (!Array.isArray(list)) return 0;

  const decoded = [];
  for (const item of list) {
    if (!item || !item.id || typeof item.dataUrl !== "string") continue;
    try {
      decoded.push({
        id: item.id,
        blob: await dataUrlToBlob(item.dataUrl),
        fileName: item.fileName || "",
        uploadedAt: item.uploadedAt || Date.now()
      });
    } catch {
      // 單張圖片解碼失敗就跳過，不要讓整份備份匯入失敗
    }
  }

  const db = await openDB();
  const t = tx(db, ["customImages"], "readwrite");
  const store = t.objectStore("customImages");
  if (mode === "overwrite") store.clear();
  for (const d of decoded) {
    store.put({
      id: d.id,
      blob: d.blob,
      mimeType: d.blob.type || "application/octet-stream",
      fileName: d.fileName,
      byteSize: d.blob.size,
      uploadedAt: d.uploadedAt
    });
  }
  await new Promise((resolve, reject) => {
    t.oncomplete = resolve;
    t.onerror = () => reject(t.error);
  });
  return decoded.length;
}

// 手動分類的匯入。merge 時以「比較新的那一筆」為準（比 updatedAt），
// 這樣兩台裝置各自標過的結果合併起來不會互相洗掉。
async function importCategoryOverrides(list, mode) {
  const db = await openDB();
  const current = mode === "overwrite" ? [] : await getAllCategoryOverrides();
  const map = new Map(current.map((o) => [o.cardId, o]));
  for (const item of list) {
    if (!item || !item.cardId || !item.categoryId) continue;
    const existing = map.get(item.cardId);
    if (!existing || (item.updatedAt || 0) >= (existing.updatedAt || 0)) {
      map.set(item.cardId, item);
    }
  }
  const t = tx(db, ["cardCategoryOverrides"], "readwrite");
  const store = t.objectStore("cardCategoryOverrides");
  if (mode === "overwrite") store.clear();
  for (const rec of map.values()) store.put(rec);
  await new Promise((resolve, reject) => {
    t.oncomplete = resolve;
    t.onerror = () => reject(t.error);
  });
  return map.size;
}

export async function importAllData(payload, mode) {
  const err = validateImportShape(payload);
  if (err) throw new Error(err);

  const db = await openDB();

  if (mode === "overwrite") {
    const t = tx(db, ["manualFlags", "cardOwnership", "categories"], "readwrite");
    t.objectStore("manualFlags").clear();
    t.objectStore("cardOwnership").clear();
    t.objectStore("categories").clear();
    for (const f of payload.manualFlags) t.objectStore("manualFlags").put(f);
    for (const c of payload.cardOwnership) t.objectStore("cardOwnership").put(c);
    for (const c of payload.categories) t.objectStore("categories").put(c);
    await new Promise((resolve, reject) => {
      t.oncomplete = resolve;
      t.onerror = () => reject(t.error);
    });
  } else {
    // merge：手動標記與分類設定以匯入檔為主（較新資料覆蓋同 id）；
    // 卡片持有張數採「取較大值」合併，避免誤把已收藏張數蓋回 0。
    const [curFlags, curOwn, curCats] = await Promise.all([
      getAllManualFlags(),
      getAllOwnership(),
      getAllCategories()
    ]);
    const flagMap = new Map(curFlags.map((f) => [f.id, f]));
    for (const f of payload.manualFlags) {
      const existing = flagMap.get(f.id);
      if (!existing || (f.updatedAt || 0) >= (existing.updatedAt || 0)) {
        flagMap.set(f.id, f);
      }
    }
    const ownMap = new Map(curOwn.map((o) => [o.cardId, o]));
    for (const o of payload.cardOwnership) {
      const existing = ownMap.get(o.cardId);
      if (!existing) {
        ownMap.set(o.cardId, o);
      } else {
        ownMap.set(o.cardId, {
          ...existing,
          count: Math.max(existing.count, o.count),
          note: o.note && o.note.length > existing.note.length ? o.note : existing.note,
          updatedAt: Math.max(existing.updatedAt || 0, o.updatedAt || 0)
        });
      }
    }
    const catMap = new Map(curCats.map((c) => [c.id, c]));
    for (const c of payload.categories) catMap.set(c.id, c);

    const t = tx(db, ["manualFlags", "cardOwnership", "categories"], "readwrite");
    t.objectStore("manualFlags").clear();
    t.objectStore("cardOwnership").clear();
    t.objectStore("categories").clear();
    for (const f of flagMap.values()) t.objectStore("manualFlags").put(f);
    for (const o of ownMap.values()) t.objectStore("cardOwnership").put(o);
    for (const c of catMap.values()) t.objectStore("categories").put(c);
    await new Promise((resolve, reject) => {
      t.oncomplete = resolve;
      t.onerror = () => reject(t.error);
    });
  }
  // 舊版備份沒有 customImages 欄位，這時什麼都不做，也不會清掉裝置上現有的圖片。
  if (Array.isArray(payload.customImages)) {
    await importCustomImages(payload.customImages, mode);
  }
  if (Array.isArray(payload.categoryOverrides)) {
    await importCategoryOverrides(payload.categoryOverrides, mode);
  }
  invalidateCategoryCache();
}

export async function clearAllCollectionData() {
  const db = await openDB();
  const t = tx(db, ["manualFlags", "cardOwnership"], "readwrite");
  t.objectStore("manualFlags").clear();
  t.objectStore("cardOwnership").clear();
  await new Promise((resolve, reject) => {
    t.oncomplete = resolve;
    t.onerror = () => reject(t.error);
  });
}
