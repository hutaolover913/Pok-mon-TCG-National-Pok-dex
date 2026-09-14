// 一般設定（App 版專用）。
//
// 這一頁刻意只有六類設定。電腦版 settings.js 那些東西 —— 新增／刪除分類、
// 稀有度對照表、套用分類修正、RR／RRR 歸位、完整 JSON 匯入、危險操作 ——
// 全部不在這裡，而且那個檔案根本不會被複製進 APK。
//
// 「收藏備份與還原」走的是 exportCollectionOnly() / importCollectionOnly()，
// 不是 exportAllData() / importAllData()：備份檔裡只有你的收藏，不含分類定義
// 與逐張分類覆寫。就算匯入一份電腦版的完整備份，那些欄位也會被忽略。
import {
  getSetting,
  setSetting,
  getStorageStatus,
  exportCollectionOnly,
  importCollectionOnly,
  getAllOwnership,
  getAllManualFlags
} from "../db.js";
import { SORT_SETTING_KEY } from "./seriesBrowse.js";
import { SET_SORT, getSetSort, setSetSort } from "../seriesCatalog.js";
import { applyTheme } from "../theme.js";
import { saveJson, pickJsonFile } from "../saveFile.js";
import { escapeHtml, showToast } from "../utils.js";
import { getImageCacheStatus, clearImageCache, IMAGE_PREFS } from "../imageCache.js";

const LANG_CHOICES = [
  ["all", "全部語言"],
  ["ja", "日文版"],
  ["en", "英文版（美版）"],
  ["zh-Hant", "繁體中文版"]
];

const LAYOUT_CHOICES = [
  ["grid", "格狀（圖片為主）"],
  ["list", "清單（資訊為主）"]
];

const SORT_CHOICES = [
  ["dex", "依圖鑑編號"],
  ["set", "依卡包／卡號"]
];

const QUALITY_CHOICES = [
  ["low", "省流量（預設，約 16 KB／張）"],
  ["high", "高畫質（約 5 倍流量）"]
];

export async function renderAppSettings() {
  const app = document.getElementById("app");

  const [theme, displayLanguage, cardLayout, cardSort, quality, wifiOnly, storage, cacheInfo, own, flags] =
    await Promise.all([
      getSetting("theme", "system"),
      getSetting(IMAGE_PREFS.displayLanguage, "all"),
      getSetting("cardLayout", "grid"),
      getSetting("cardSort", "dex"),
      getSetting(IMAGE_PREFS.quality, "low"),
      getSetting(IMAGE_PREFS.wifiOnly, false),
      getStorageStatus(),
      getImageCacheStatus(),
      getAllOwnership(),
      getAllManualFlags()
    ]);

  const setSort = getSetSort();
  const ownedCards = own.filter((o) => o.count > 0).length;
  const totalCopies = own.reduce((sum, o) => sum + (o.count || 0), 0);
  const activeFlags = flags.filter((f) => f.active).length;

  app.innerHTML = `
    <header class="page-header">
      <h1>設定</h1>
    </header>

    <section class="settings-section">
      <h2>外觀</h2>
      <div class="theme-switch">
        ${["system", "light", "dark"]
          .map(
            (t) => `<button class="theme-btn ${theme === t ? "active" : ""}" data-theme="${t}">${
              { system: "跟隨系統", light: "淺色", dark: "深色" }[t]
            }</button>`
          )
          .join("")}
      </div>
    </section>

    <section class="settings-section">
      <h2>顯示語言</h2>
      <p class="hint-text">決定圖鑑與卡片清單預設顯示哪個版本的卡。選「全部語言」就都會出現。</p>
      <label class="modal-label">卡片版本
        <select id="as-language" class="cat-select">
          ${LANG_CHOICES.map(([v, t]) =>
            `<option value="${v}"${displayLanguage === v ? " selected" : ""}>${escapeHtml(t)}</option>`).join("")}
        </select>
      </label>
    </section>

    <section class="settings-section">
      <h2>卡片排列方式</h2>
      <label class="modal-label">版面
        <select id="as-layout" class="cat-select">
          ${LAYOUT_CHOICES.map(([v, t]) =>
            `<option value="${v}"${cardLayout === v ? " selected" : ""}>${escapeHtml(t)}</option>`).join("")}
        </select>
      </label>
      <label class="modal-label">排序
        <select id="as-sort" class="cat-select">
          ${SORT_CHOICES.map(([v, t]) =>
            `<option value="${v}"${cardSort === v ? " selected" : ""}>${escapeHtml(t)}</option>`).join("")}
        </select>
      </label>
    </section>

    <section class="settings-section">
      <h2>卡包日期排序</h2>
      <label class="modal-label">卡包清單順序
        <select id="as-setsort" class="cat-select">
          <option value="${SET_SORT.NEWEST}"${setSort === SET_SORT.NEWEST ? " selected" : ""}>由新到舊</option>
          <option value="${SET_SORT.OLDEST}"${setSort === SET_SORT.OLDEST ? " selected" : ""}>由舊到新</option>
        </select>
      </label>
      <p class="hint-text">沒有發售日期的卡包，兩個方向都固定排在最後。</p>
    </section>

    <section class="settings-section">
      <h2>圖片品質與快取</h2>
      <p class="hint-text">App 內建了 4,064 張官方網站沒有提供的卡圖，其餘 11,782 張從網路載入，看過一次就會存到手機裡，之後離線也看得到。</p>
      <label class="modal-label">圖片品質
        <select id="as-quality" class="cat-select">
          ${QUALITY_CHOICES.map(([v, t]) =>
            `<option value="${v}"${quality === v ? " selected" : ""}>${escapeHtml(t)}</option>`).join("")}
        </select>
      </label>
      <label class="checkbox-row">
        <input type="checkbox" id="as-wifionly" ${wifiOnly ? "checked" : ""} />
        <span>只在 Wi-Fi 載入卡圖（行動網路下只顯示已快取與內建的圖）</span>
      </label>
      <p class="hint-text">目前快取：<strong>${cacheInfo.count}</strong> 張，約 ${(cacheInfo.bytes / 1048576).toFixed(1)} MB。${
        storage.supported && storage.quotaBytes ? `裝置可用空間約 ${Math.round(storage.quotaBytes / 1048576)} MB。` : ""}</p>
      <button class="text-btn" id="as-clear-cache">清除圖片快取</button>
      <p class="hint-text">清除快取只會刪掉暫存的圖片，收藏紀錄完全不受影響，圖片之後會重新下載。</p>
    </section>

    <section class="settings-section">
      <h2>收藏備份與還原</h2>
      <p class="hint-text">
        目前收藏：<strong>${ownedCards}</strong> 張不同卡片、共 ${totalCopies} 張實體卡${
          activeFlags ? `，另有 ${activeFlags} 筆手動點亮紀錄` : ""}。
      </p>
      <p class="hint-text">
        收藏只存在這台手機裡，<strong>不會自動同步</strong>。換手機或重裝 App 前請先備份。
        備份檔裡只有你的收藏紀錄，不含卡片資料與分類。
      </p>
      <div class="settings-actions">
        <button class="primary-btn" id="as-export">匯出收藏備份</button>
        <button class="text-btn" id="as-import">匯入收藏備份</button>
      </div>
      <div id="as-backup-status" class="hint-text"></div>
    </section>

    <section class="settings-section">
      <h2>關於</h2>
      <p class="hint-text">寶可夢資料來自 PokéAPI，卡片資料來自 TCGdex，皆為公開資料。卡圖版權屬於原權利人。</p>
      <p class="hint-text">本 App 不會上傳任何資料，收藏紀錄只存在這台裝置。</p>
      <p class="hint-text">卡片分類、資料匯入與整理功能在電腦版圖鑑提供，App 版為收藏專用。</p>
    </section>`;

  bind();
}

function bind() {
  document.querySelectorAll(".theme-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const t = btn.getAttribute("data-theme");
      applyTheme(t);
      await setSetting("theme", t);
      document.querySelectorAll(".theme-btn").forEach((b) => b.classList.toggle("active", b === btn));
    });
  });

  const onSelect = (id, key, after) =>
    document.getElementById(id).addEventListener("change", async (e) => {
      await setSetting(key, e.target.value);
      if (after) await after(e.target.value);
      showToast("已儲存");
    });

  onSelect("as-language", IMAGE_PREFS.displayLanguage);
  onSelect("as-layout", "cardLayout");
  onSelect("as-sort", "cardSort");
  onSelect("as-quality", IMAGE_PREFS.quality);
  document.getElementById("as-setsort").addEventListener("change", async (e) => {
    setSetSort(e.target.value);
    await setSetting(SORT_SETTING_KEY, getSetSort());
    showToast("已儲存");
  });

  document.getElementById("as-wifionly").addEventListener("change", async (e) => {
    await setSetting(IMAGE_PREFS.wifiOnly, e.target.checked);
    showToast(e.target.checked ? "行動網路下不會再下載新卡圖" : "已允許用行動網路載入卡圖");
  });

  document.getElementById("as-clear-cache").addEventListener("click", async () => {
    const info = await getImageCacheStatus();
    if (info.count === 0) {
      showToast("目前沒有快取的圖片");
      return;
    }
    await clearImageCache();
    showToast(`已清除 ${info.count} 張快取圖片，收藏紀錄未變動`);
    renderAppSettings();
  });

  document.getElementById("as-export").addEventListener("click", async () => {
    const status = document.getElementById("as-backup-status");
    status.textContent = "準備中…";
    const data = await exportCollectionOnly();
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const res = await saveJson(data, `寶可夢PTCG收藏備份_${ts}.json`);
    status.textContent = res.ok
      ? `已匯出 ${data.cardOwnership.length} 筆收藏紀錄`
      : `匯出失敗：${res.error ? res.error.message : "原因不明"}`;
    if (!res.ok) showToast(status.textContent, { duration: 15000 });
  });

  document.getElementById("as-import").addEventListener("click", async () => {
    const status = document.getElementById("as-backup-status");
    const file = await pickJsonFile();
    if (!file) return;
    status.textContent = "讀取中…";
    try {
      const payload = JSON.parse(await file.text());
      const hadCuration = !!(payload.categories || payload.categoryOverrides || payload.fieldOverrides);
      const res = await importCollectionOnly(payload, "merge");
      status.textContent = `已匯入：${res.cardOwnership} 筆收藏、${res.manualFlags} 筆點亮紀錄。`
        + (hadCuration ? "備份檔裡的分類設定已略過（App 版不修改分類）。" : "");
      showToast("匯入完成，正在重新載入…");
      setTimeout(() => window.location.reload(), 1200);
    } catch (err) {
      status.textContent = `匯入失敗：${err.message}`;
      showToast(status.textContent, { duration: 15000 });
    }
  });
}
