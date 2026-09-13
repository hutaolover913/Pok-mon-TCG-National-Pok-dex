const CACHE_NAME = "pokecard-dex-v13";
// 注意：資料檔（species.json / cards.json / sets.json / migration_map.json）
// 刻意不放進安裝時的預快取清單 —— cards.json 有數 MB，若放進 cache.addAll()
// 只要有一個檔案抓取失敗，整個 Service Worker 安裝就會失敗。改由下面的
// fetch 事件處理（網路優先、失敗才用快取）在第一次真的載入時快取即可。
const APP_SHELL = [
  "./",
  "index.html",
  "manifest.json",
  "css/style.css",
  "js/main.js",
  "js/router.js",
  "js/db.js",
  "js/data.js",
  "js/state.js",
  "js/theme.js",
  "js/utils.js",
  "js/categories.js",
  "js/components/badges.js",
  "js/components/pokemonTile.js",
  "js/pages/home.js",
  "js/pages/detail.js",
  "js/pages/collection.js",
  "js/pages/missing.js",
  "js/pages/settings.js",
  "icons/icon-192.png",
  "icons/icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // 卡圖／寶可夢圖片走「網路優先，失敗才用快取」，且只快取同網域外的圖片請求本身，
  // 不主動預先抓取全部高解析度圖，避免一次載入過多資料。
  if (event.request.destination === "image") {
    event.respondWith(
      fetch(event.request)
        .then((res) => {
          const resClone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, resClone));
          return res;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // App shell（HTML／CSS／JS／資料 JSON）採「網路優先，離線才用快取」，
  // 確保更新資料庫或程式碼後使用者能盡快拿到新版本，離線時仍可運作。
  if (url.origin === self.location.origin) {
    event.respondWith(
      fetch(event.request)
        .then((res) => {
          const resClone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, resClone));
          return res;
        })
        .catch(() => caches.match(event.request))
    );
  }
});
