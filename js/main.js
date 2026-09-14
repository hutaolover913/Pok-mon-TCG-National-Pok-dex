import { ensureSeeded, getSetting, migrateCardIds, requestPersistentStorage } from "./db.js";
import { loadStaticData } from "./data.js";
import { registerLazyRoute, registerNotFound, startRouter } from "./router.js";
import { WEB_ROUTES, APP_ROUTES } from "./routes.js";
import { loadRegulationMarks } from "./seriesCatalog.js";
import { restoreSetSort } from "./pages/seriesBrowse.js";
import { isAppMode } from "./appMode.js";
import { applyTheme } from "./theme.js";
import { escapeHtml, showToast } from "./utils.js";

const CARD_ID_MIGRATION_VERSION = "v2-tcgdex-2026";

// App 版的底部導覽列。與網頁版的差別：
//   拿掉「系列卡包」獨立分頁（改到「卡片」分頁內用切換鈕進入，不會變成無法抵達）
//   新增「收藏進度」
//   「設定」指向一般設定，不是管理主控台
// data-also 讓 /sets 也算在「卡片」分頁的選取範圍內。
const APP_NAV_HTML = `
    <a href="#/" data-path="/">
      <span class="nav-icon">📖</span><span>圖鑑</span>
    </a>
    <a href="#/types" data-path="/types" data-also="/sets">
      <span class="nav-icon">🏷️</span><span>卡片</span>
    </a>
    <a href="#/collection" data-path="/collection">
      <span class="nav-icon">🗂️</span><span>我的收藏</span>
    </a>
    <a href="#/missing" data-path="/missing">
      <span class="nav-icon">📋</span><span>缺卡清單</span>
    </a>
    <a href="#/progress" data-path="/progress">
      <span class="nav-icon">📊</span><span>收藏進度</span>
    </a>
    <a href="#/settings" data-path="/settings">
      <span class="nav-icon">⚙️</span><span>設定</span>
    </a>`;

async function runCardIdMigration() {
  try {
    const res = await fetch("data/migration_map.json");
    if (!res.ok) return;
    const payload = await res.json();
    const result = await migrateCardIds(payload.map, CARD_ID_MIGRATION_VERSION);
    // 這個提示講的是資料庫維護細節，App 版的一般使用者不需要看到
    if (result.applied && result.migrated > 0 && !isAppMode()) {
      showToast(`卡片資料庫已更新，已自動搬移 ${result.migrated} 筆舊收藏紀錄到新卡片 ID，收藏資料未遺失。`, { duration: 8000 });
    }
  } catch (err) {
    console.warn("card id migration skipped:", err);
  }
}

async function boot() {
  // 先把 IndexedDB 升級成「瀏覽器不可自行清除」，再開始讀寫收藏資料
  await requestPersistentStorage();
  const seedResult = await ensureSeeded();
  const theme = await getSetting("theme", "system");
  applyTheme(theme);

  await runCardIdMigration();
  await loadStaticData();
  // 規則標記另外一個檔案，抓不到就全部當「待確認」，不影響其他功能
  await loadRegulationMarks();
  // 卡包排序方向是使用者偏好，開機時讀回來
  await restoreSetSort();

  const app = isAppMode();

  if (app) {
    const nav = document.querySelector(".bottom-nav");
    if (nav) nav.innerHTML = APP_NAV_HTML;
    registerNotFound((path) => {
      document.getElementById("app").innerHTML = `
        <div class="empty-state">這個畫面在 App 版沒有提供<br />
          <span class="hint-text">卡片分類、匯入匯出與資料整理功能請在電腦版圖鑑使用。
          （${escapeHtml(path)}）</span><br />
          <a class="primary-btn" href="#/" style="text-decoration:none;margin-top:12px;display:inline-block">回圖鑑</a>
        </div>`;
    });
  }

  for (const [pattern, loader] of (app ? APP_ROUTES : WEB_ROUTES)) {
    registerLazyRoute(pattern, loader);
  }

  document.getElementById("boot-loading").remove();
  document.getElementById("app").classList.remove("hidden");
  document.querySelector(".bottom-nav").classList.remove("hidden");

  startRouter();

  // 內建稀有度對照表改版時告知使用者，因為圖鑑徽章顯示的分類會跟著變
  // （例如原本被歸到 UR 的卡片，核對卡面後其實是 SR）。收藏紀錄本身不受影響。
  // 這段講的是資料整理過程，App 版不顯示。
  if (seedResult && seedResult.remapped && !app) {
    showToast("已更新稀有度分類對照表：核對卡面印刷代碼後，原本歸在 UR 的「Ultra Rare」已更正為 SR，並新增 HR 與「待確認」分類。收藏紀錄未變動。", { duration: 10000 });
  }

  if (app) {
    // 返回鍵、狀態列、啟動畫面。失敗不影響 App 本身能不能用。
    import("./nativeShell.js").then((m) => m.initNativeShell()).catch(() => {});
  } else if ("serviceWorker" in navigator) {
    // Service Worker 只給網頁版。App 版的程式與資料本來就是本機檔案，
    // 而且 Capacitor 的 https://localhost 上註冊 SW 在各版本 WebView 行為不一致。
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
}

boot().catch((err) => {
  console.error(err);
  const el = document.getElementById("boot-loading");
  if (el) el.textContent = "載入失敗：" + err.message;
});
