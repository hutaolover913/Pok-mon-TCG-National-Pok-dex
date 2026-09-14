// 路由表：網頁版與 App 版各一份。
//
// -- 為什麼要用動態 import() ------------------------------------------------
// 原本 js/main.js 是把 8 個頁面模組全部靜態 import 進來，再逐一 registerRoute。
// 那樣的話，只要 App 版的 www/ 少複製一個檔案（例如不該出現的 settings.js），
// ES module 的相依圖就解析失敗，**整個 App 開不起來**。
//
// 改成 thunk 之後，沒被註冊的路由永遠不會去 import 它的模組，
// 檔案不存在也不會有人發現。這是「管理功能不進 APK」能成立的前提。
//
// 順帶的好處：開機不再急著解析 settings.js（31 KB）、exportPage.js（17 KB）、
// collection.js（30 KB），手機冷啟動會快一些。
//
// -- App 版少了什麼 ---------------------------------------------------------
//   /export    匯出 Excel／Word —— 整個不註冊
//   /settings  指向 appSettings.js（一般設定），不是 settings.js（管理主控台）
//
// 手動在網址列打 #/export 會落到 router.js 的 404 分支，因為根本沒有這條路由。
// 這是三層鎖定的第二層；第一層是檔案不進 www/，第三層是 db.js 的 tx() 守衛。

export const WEB_ROUTES = [
  ["/", () => import("./pages/home.js").then((m) => m.renderHome)],
  ["/pokemon/:id", () => import("./pages/detail.js").then((m) => m.renderDetail)],
  ["/collection", () => import("./pages/collection.js").then((m) => m.renderCollection)],
  ["/types", () => import("./pages/cardTypes.js").then((m) => m.renderCardTypes)],
  ["/types/:id", () => import("./pages/cardTypes.js").then((m) => m.renderCardTypeDetail)],
  ["/sets", () => import("./pages/seriesBrowse.js").then((m) => m.renderSeriesBrowse)],
  ["/sets/:id", () => import("./pages/seriesBrowse.js").then((m) => m.renderSeriesDetail)],
  ["/export", () => import("./pages/exportPage.js").then((m) => m.renderExportPage)],
  ["/missing", () => import("./pages/missing.js").then((m) => m.renderMissing)],
  ["/settings", () => import("./pages/settings.js").then((m) => m.renderSettings)]
];

export const APP_ROUTES = [
  ["/", () => import("./pages/home.js").then((m) => m.renderHome)],
  ["/pokemon/:id", () => import("./pages/detail.js").then((m) => m.renderDetail)],
  ["/collection", () => import("./pages/collection.js").then((m) => m.renderCollection)],
  ["/types", () => import("./pages/cardTypes.js").then((m) => m.renderCardTypes)],
  ["/types/:id", () => import("./pages/cardTypes.js").then((m) => m.renderCardTypeDetail)],
  ["/sets", () => import("./pages/seriesBrowse.js").then((m) => m.renderSeriesBrowse)],
  ["/sets/:id", () => import("./pages/seriesBrowse.js").then((m) => m.renderSeriesDetail)],
  ["/missing", () => import("./pages/missing.js").then((m) => m.renderMissing)],
  ["/progress", () => import("./pages/progress.js").then((m) => m.renderProgress)],
  ["/settings", () => import("./pages/appSettings.js").then((m) => m.renderAppSettings)]
];
