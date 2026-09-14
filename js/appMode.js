// App 模式旗標。
//
// 這份程式碼同時給「電腦網頁版」與「Android App 版」使用，是同一套原始碼，
// 不是兩份複本。差異全部由這個旗標控制，所以兩邊不會跡飛。
//
// -- 怎麼判定 ---------------------------------------------------------------
// 兩個獨立訊號，任一成立就是 App 模式：
//
//   A. Capacitor.isNativePlatform()
//      只有原生 bridge 注入 capacitor.js 時才存在。用瀏覽器開網頁版時，
//      window.Capacitor 根本不存在，這個訊號不可能成立。
//
//   B. <meta name="ptcg-app-mode" content="native">
//      由 android-app/build_www.py 在組裝 www/ 時注入。
//      **根目錄的 index.html 永遠不會有這個 meta tag**，所以網頁版一定是 false。
//
// 訊號 B 的用意是：在還沒安裝 Node.js 與 Android Studio 之前，就能用
//
//     python android-app/build_www.py
//     python -m http.server 8899 -d android-app/www
//
// 在桌機 Chrome 完整測試 App 模式的行為。請用 8899 而不是 8811 ——
// IndexedDB 是依網址（含連接埠）分開存放的，用不同的埠測試才不會碰到
// 你在 8811 底下的真實收藏資料。
//
// -- 為什麼在模組載入時就凍結 ------------------------------------------------
// 算一次存成常數，之後誰都改不動。如果做成每次呼叫都重新偵測，
// 任何人只要在 DOM 裡塞一個 meta tag 或蓋掉 window.Capacitor 就能翻轉它。

const NATIVE = !!(window.Capacitor
  && typeof window.Capacitor.isNativePlatform === "function"
  && window.Capacitor.isNativePlatform());

const TAGGED = (() => {
  const el = document.querySelector('meta[name="ptcg-app-mode"]');
  return !!el && el.getAttribute("content") === "native";
})();

const APP_MODE = NATIVE || TAGGED;

/** 目前是不是 App 模式。電腦網頁版永遠回 false。 */
export function isAppMode() {
  return APP_MODE;
}

/** 判定依據，除錯與驗收時用。 */
export const APP_MODE_REASON = NATIVE ? "capacitor-native" : TAGGED ? "build-meta" : "web";

/** 只在網頁版才做的事，寫起來比 if (!isAppMode()) 好讀一點。 */
export function webOnly(value, fallback = "") {
  return APP_MODE ? fallback : value;
}

/** 只在 App 模式才做的事。 */
export function appOnly(value, fallback = "") {
  return APP_MODE ? value : fallback;
}
