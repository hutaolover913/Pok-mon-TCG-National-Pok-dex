// 頁面狀態暫存：捲動位置、已載入筆數。
//
// 解決的問題：點進卡片詳情再返回時，會回到清單最上方、而且「載入更多」的
// 進度整個歸零。原因是 router.js 每次換頁都無條件 window.scrollTo(0, 0)，
// 而 cardTypes.js / missing.js 每次 render 都把分頁數重設。
//
// 搜尋字、篩選、排序本來就會留著 —— 那些存在各頁模組的 module-level 物件裡
// （home.js 的 state、cardTypes.js 的 filterState、collection.js 的 cardFilter…），
// ES module 實例在 hash 導覽之間不會被重建。這裡補的是那兩項沒被保留的。
//
// 刻意用記憶體 Map，不寫 IndexedDB 也不用 sessionStorage：
// 生命週期跟上面那些 module-level 物件一致，行為才不會前後矛盾 ——
// 重新整理頁面時，篩選條件本來就會回到預設，捲動位置沒道理反而被記住。

const store = new Map();

/** 記下某條路由的狀態。只覆蓋傳進來的欄位，其餘保留。 */
export function saveView(path, patch) {
  if (!path) return;
  store.set(path, { ...(store.get(path) || {}), ...patch });
}

/** 讀回某條路由的狀態，沒有就回 null。 */
export function readView(path) {
  return store.get(path) || null;
}

/** 丟掉某條路由的狀態。篩選條件改變、資料重載時呼叫，避免還原到對不上的位置。 */
export function clearView(path) {
  store.delete(path);
}

export function clearAllViews() {
  store.clear();
}
