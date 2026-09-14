// Android 原生殼層的接線：返回鍵、狀態列、啟動畫面。
//
// 只在 App 模式載入（js/main.js 用動態 import）。整個檔案失敗也不影響 App
// 能不能用 —— 頂多是返回鍵行為回到 Capacitor 預設。
//
// Capacitor 的原生外掛是由原生端註冊在 window.Capacitor.Plugins 上的，
// 不需要 import，所以這個沒有打包工具的 ESM 專案可以直接取用。

function plugins() {
  return (window.Capacitor && window.Capacitor.Plugins) || {};
}

/**
 * 返回鍵。
 *
 * Capacitor 的預設行為是「WebView 沒有上一頁就直接關掉 App」，在 hash 路由的
 * SPA 裡會變成從任何畫面按返回都可能直接離開。只要註冊了 backButton 監聽器，
 * 預設行為就完全交給我們，所以這裡要把三種情況都處理掉。
 *
 * 附帶的好處：history.back() 會觸發 hashchange -> handleRoute()，
 * 而 router.js 的捲動還原就掛在那裡，所以硬體返回鍵自動有位置記憶。
 */
function wireBackButton() {
  const { App } = plugins();
  if (!App || !App.addListener) return;

  App.addListener("backButton", ({ canGoBack }) => {
    // 1. 有開著的對話框就先關掉，不要直接離開頁面
    const modal = document.querySelector(".modal-backdrop");
    if (modal) {
      modal.remove();
      return;
    }

    const path = (window.location.hash.slice(1) || "/").split("?")[0];

    // 2. 已經在首頁：離開 App
    if (path === "/") {
      App.exitApp();
      return;
    }

    // 3. 其餘往回走；沒有歷史紀錄就回首頁，不要卡住
    if (canGoBack) {
      window.history.back();
    } else {
      window.location.hash = "/";
    }
  });
}

/** 狀態列顏色跟著深淺色主題走。 */
async function syncStatusBar() {
  const { StatusBar } = plugins();
  if (!StatusBar) return;
  try {
    const dark = document.documentElement.getAttribute("data-theme") === "dark"
      || (!document.documentElement.getAttribute("data-theme")
        && window.matchMedia("(prefers-color-scheme: dark)").matches);
    await StatusBar.setStyle({ style: dark ? "DARK" : "LIGHT" });
    await StatusBar.setBackgroundColor({ color: "#14151c" });
  } catch {
    // 部分裝置不支援，忽略即可
  }
}

/** 資料載完才收起啟動畫面，避免使用者看到空白頁。 */
async function hideSplash() {
  const { SplashScreen } = plugins();
  if (!SplashScreen || !SplashScreen.hide) return;
  try {
    await SplashScreen.hide();
  } catch {
    // 忽略
  }
}

/** 深層連結 ptcgdex://card/25 -> #/pokemon/25 */
function wireDeepLinks() {
  const { App } = plugins();
  if (!App || !App.addListener) return;
  App.addListener("appUrlOpen", ({ url }) => {
    try {
      const m = /^ptcgdex:\/\/card\/(\d+)/i.exec(String(url || ""));
      if (m) window.location.hash = "/pokemon/" + m[1];
    } catch {
      // 網址不認得就不做事，不要讓 App 當掉
    }
  });
}

export function initNativeShell() {
  wireBackButton();
  wireDeepLinks();
  syncStatusBar();
  hideSplash();
}
