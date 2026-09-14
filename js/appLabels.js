// App 版的顯示文字覆寫。
//
// -- 這個檔案不刪任何東西 ----------------------------------------------------
// 「待確認」是一個**合法的分類**（js/cardCategories.js 的 UNVERIFIED，底下有
// 2,640 張卡），不是錯誤也不是垃圾資料。它代表「來源沒給稀有度，或那個稀有度
// 字串在這個語言下無法確認等級，刻意不猜」。
//
// 對整理資料的人來說這個詞很精確；對一般收藏者來說它像是系統還沒做完。
// 所以 App 版只換**顯示出來的字**，分類 id、卡片歸屬、資料庫內容一律不動。
// 網頁版看到的仍然是原本的「待確認」。
//
// 值是空字串代表「整個元素不要顯示」，不是顯示一個空白標籤。
// 呼叫端要自己判斷：label(x) 回空字串就不要產生那個 <span>。

import { isAppMode } from "./appMode.js";

const APP_LABEL = new Map([
  // 分類與狀態用詞：換成收藏者看得懂的說法
  ["待確認", "其他／未分類"],
  ["系列待確認", "其他系列"],
  ["發售日期待確認", "發售日期未提供"],

  // 資料品質標記：這些是整理資料時用來判斷可信度的，收藏者不需要看到
  ["已核對卡面印刷代碼", ""],
  ["依卡包編號位置推定", ""],
  ["依卡片機制對應日版同批次", ""],
  ["依英文版等級名稱對應", ""],
  ["無法確認", ""],
  ["手動指定", ""],
  ["樣本資料", ""]
]);

/**
 * 取得這個字串在目前模式下該顯示的文字。
 * 網頁版永遠原樣回傳。
 * @returns {string} 空字串代表「不要顯示這個元素」
 */
export function label(text) {
  if (!isAppMode()) return text;
  const override = APP_LABEL.get(String(text || "").trim());
  return override === undefined ? text : override;
}

/** 這個標籤在目前模式下要不要顯示。 */
export function shows(text) {
  return label(text) !== "";
}

/**
 * 規則標記那種「待確認」比較特別：它講的是「這張卡有沒有規則標記還沒核實」，
 * 跟分類的「待確認」不是同一件事，所以分開處理。
 */
export function markLabelForMode(text) {
  if (!isAppMode()) return text;
  return String(text).trim() === "待確認" ? "未標示" : label(text);
}
