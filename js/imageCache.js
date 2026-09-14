// 遠端卡圖的本機快取（App 版用）。
//
// -- 為什麼需要 -------------------------------------------------------------
// App 內建了 4,064 張官方 CDN 沒有提供的卡圖，其餘 11,782 張走
// assets.tcgdex.net。那些遠端圖每看一次就抓一次的話，離線就全是佔位圖，
// 行動網路也會被吃掉不少流量。
//
// -- 為什麼不用 Service Worker ----------------------------------------------
// Capacitor 是用 WebViewAssetLoader 從 https://localhost 提供檔案，不是真的
// HTTP 伺服器，SW 在各版本 Android WebView 的行為不一致。而且既有的 sw.js
// precache 清單已經漏了 12 個模組，cache.addAll 是全有全無，在 App 版會直接
// 安裝失敗。自己管快取反而更可控：有明確的容量上限，也有「清除快取」可以按。
//
// -- 為什麼用獨立的資料庫 ----------------------------------------------------
// 刻意不放進 pokecard-dex，避免把它從 v4 升版而動到網頁版的結構。
// 這個資料庫壞掉、被清掉都不影響收藏，重新下載即可。

const CACHE_DB = "pokecard-dex-images";
const CACHE_DB_VERSION = 1;
const STORE = "images";

/** 設定用的 meta key，集中在這裡避免打錯字。 */
export const IMAGE_PREFS = {
  quality: "imageQuality",
  wifiOnly: "imageWifiOnly",
  budgetMb: "imageCacheBudgetMb",
  displayLanguage: "displayLanguage"
};

export const DEFAULT_BUDGET_MB = 300;

let dbPromise = null;

function openCacheDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(CACHE_DB, CACHE_DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const s = db.createObjectStore(STORE, { keyPath: "url" });
        s.createIndex("byLastUsed", "lastUsed");
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function reqToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** 目前快取了幾張、佔多少位元組。 */
export async function getImageCacheStatus() {
  try {
    const db = await openCacheDB();
    const store = db.transaction([STORE], "readonly").objectStore(STORE);
    const all = await reqToPromise(store.getAll());
    return {
      count: all.length,
      bytes: all.reduce((sum, r) => sum + (r.bytes || 0), 0)
    };
  } catch {
    return { count: 0, bytes: 0 };
  }
}

/** 清空快取。只碰這個獨立資料庫，收藏資料完全不受影響。 */
export async function clearImageCache() {
  const db = await openCacheDB();
  const t = db.transaction([STORE], "readwrite");
  t.objectStore(STORE).clear();
  await new Promise((resolve, reject) => {
    t.oncomplete = resolve;
    t.onerror = () => reject(t.error);
  });
  for (const url of objectUrls.values()) URL.revokeObjectURL(url);
  objectUrls.clear();
  return true;
}

// 已經建好的 blob: 網址，避免同一張圖重複建立 object URL
const objectUrls = new Map();

/** 快取裡有這張圖的話回傳可直接放進 <img src> 的網址，沒有回 null。 */
export async function getCachedImageUrl(remoteUrl) {
  if (!remoteUrl) return null;
  if (objectUrls.has(remoteUrl)) return objectUrls.get(remoteUrl);
  try {
    const db = await openCacheDB();
    const store = db.transaction([STORE], "readonly").objectStore(STORE);
    const rec = await reqToPromise(store.get(remoteUrl));
    if (!rec || !rec.blob) return null;
    const url = URL.createObjectURL(rec.blob);
    objectUrls.set(remoteUrl, url);
    touch(remoteUrl).catch(() => {});
    return url;
  } catch {
    return null;
  }
}

async function touch(url) {
  const db = await openCacheDB();
  const t = db.transaction([STORE], "readwrite");
  const store = t.objectStore(STORE);
  const rec = await reqToPromise(store.get(url));
  if (rec) store.put({ ...rec, lastUsed: Date.now() });
}

/**
 * 抓一張遠端圖並存進快取。已經有就不重抓。
 * 失敗不丟例外 —— 抓不到圖只是看不到圖，不該讓畫面壞掉。
 */
export async function cacheRemoteImage(remoteUrl) {
  if (!remoteUrl || !/^https?:/i.test(remoteUrl)) return false;
  try {
    const db = await openCacheDB();
    const existing = await reqToPromise(
      db.transaction([STORE], "readonly").objectStore(STORE).get(remoteUrl)
    );
    if (existing) return true;

    const res = await fetch(remoteUrl, { mode: "cors" });
    if (!res.ok) return false;
    const blob = await res.blob();
    if (!blob.size) return false;

    const t = db.transaction([STORE], "readwrite");
    t.objectStore(STORE).put({ url: remoteUrl, blob, bytes: blob.size, lastUsed: Date.now() });
    await new Promise((resolve, reject) => {
      t.oncomplete = resolve;
      t.onerror = () => reject(t.error);
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * 依容量上限淘汰最久沒用到的圖。
 * @param {number} budgetMb 上限（MB）
 */
export async function evictIfOverBudget(budgetMb = DEFAULT_BUDGET_MB) {
  try {
    const db = await openCacheDB();
    const all = await reqToPromise(
      db.transaction([STORE], "readonly").objectStore(STORE).getAll()
    );
    const limit = budgetMb * 1048576;
    let total = all.reduce((sum, r) => sum + (r.bytes || 0), 0);
    if (total <= limit) return { evicted: 0, bytes: total };

    all.sort((a, b) => (a.lastUsed || 0) - (b.lastUsed || 0));
    const t = db.transaction([STORE], "readwrite");
    const store = t.objectStore(STORE);
    let evicted = 0;
    for (const rec of all) {
      if (total <= limit) break;
      store.delete(rec.url);
      const u = objectUrls.get(rec.url);
      if (u) {
        URL.revokeObjectURL(u);
        objectUrls.delete(rec.url);
      }
      total -= rec.bytes || 0;
      evicted += 1;
    }
    await new Promise((resolve, reject) => {
      t.oncomplete = resolve;
      t.onerror = () => reject(t.error);
    });
    return { evicted, bytes: total };
  } catch {
    return { evicted: 0, bytes: 0 };
  }
}

/** 行動網路下要不要省流量。抓不到連線資訊時一律當「可以載入」，不要誤擋。 */
export function onMeteredConnection() {
  const c = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  if (!c) return false;
  if (c.saveData) return true;
  return typeof c.type === "string" && c.type === "cellular";
}
