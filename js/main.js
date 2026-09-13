import { ensureSeeded, getSetting, migrateCardIds, requestPersistentStorage } from "./db.js";
import { loadStaticData } from "./data.js";
import { registerRoute, startRouter } from "./router.js";
import { renderHome } from "./pages/home.js";
import { renderDetail } from "./pages/detail.js";
import { renderCollection } from "./pages/collection.js";
import { renderMissing } from "./pages/missing.js";
import { renderCardTypes, renderCardTypeDetail } from "./pages/cardTypes.js";
import { renderExportPage } from "./pages/exportPage.js";
import { renderSettings } from "./pages/settings.js";
import { applyTheme } from "./theme.js";
import { showToast } from "./utils.js";

const CARD_ID_MIGRATION_VERSION = "v2-tcgdex-2026";

async function runCardIdMigration() {
  try {
    const res = await fetch("data/migration_map.json");
    if (!res.ok) return;
    const payload = await res.json();
    const result = await migrateCardIds(payload.map, CARD_ID_MIGRATION_VERSION);
    if (result.applied && result.migrated > 0) {
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

  registerRoute("/", renderHome);
  registerRoute("/pokemon/:id", renderDetail);
  registerRoute("/collection", renderCollection);
  registerRoute("/types", renderCardTypes);
  registerRoute("/types/:id", renderCardTypeDetail);
  registerRoute("/export", renderExportPage);
  registerRoute("/missing", renderMissing);
  registerRoute("/settings", renderSettings);

  document.getElementById("boot-loading").remove();
  document.getElementById("app").classList.remove("hidden");
  document.querySelector(".bottom-nav").classList.remove("hidden");

  startRouter();

  // 內建稀有度對照表改版時告知使用者，因為圖鑑徽章顯示的分類會跟著變
  // （例如原本被歸到 UR 的卡片，核對卡面後其實是 SR）。收藏紀錄本身不受影響。
  if (seedResult && seedResult.remapped) {
    showToast("已更新稀有度分類對照表：核對卡面印刷代碼後，原本歸在 UR 的「Ultra Rare」已更正為 SR，並新增 HR 與「待確認」分類。收藏紀錄未變動。", { duration: 10000 });
  }

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
}

boot().catch((err) => {
  console.error(err);
  const el = document.getElementById("boot-loading");
  if (el) el.textContent = "載入失敗：" + err.message;
});
