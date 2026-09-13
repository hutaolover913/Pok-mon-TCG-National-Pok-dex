// 批量選取的共用邏輯。「卡片分類」頁與「我的收藏」頁都用這一份，
// 確保勾選、全選、計數、以及「換條件就清空選取」的行為兩邊一致。
//
// 設計重點：
//  * 「全選目前頁面」與「選取全部篩選結果」是兩個不同的按鈕，各自標出數量，
//    因為兩者差很多（畫面上 120 張 vs 篩選結果 2,640 張），混在一起很容易誤操作。
//  * 只要切換分類、改搜尋或改篩選，選取一律清空並提示 —— 不然使用者會在
//    看不到的情況下對一批舊卡片做批量操作。
import { escapeHtml, showToast } from "../utils.js";

export function createSelection() {
  const set = new Set();
  return {
    set,
    get size() {
      return set.size;
    },
    has: (id) => set.has(id),
    add: (id) => set.add(id),
    delete: (id) => set.delete(id),
    toggle(id, on) {
      if (on === undefined) on = !set.has(id);
      if (on) set.add(id);
      else set.delete(id);
      return on;
    },
    clear: () => set.clear(),
    ids: () => Array.from(set),
    /** 換篩選條件時呼叫：有選取才清空並提示，沒選取就安靜地什麼都不做。 */
    clearOnFilterChange(reason = "篩選條件已變更") {
      if (set.size === 0) return false;
      const n = set.size;
      set.clear();
      showToast(`${reason}，已清除原本勾選的 ${n} 張卡片`);
      return true;
    }
  };
}

/** 卡片上的勾選框（批量模式開啟時才渲染）。 */
export function renderSelectCheckbox(cardId, checked) {
  return `<label class="bulk-check" title="勾選這張卡">
    <input type="checkbox" data-bulk-id="${escapeHtml(cardId)}" ${checked ? "checked" : ""} />
  </label>`;
}

/**
 * 批量工具列。
 * @param {object} opts
 * @param {boolean} opts.active       批量模式開關
 * @param {number}  opts.selected     已選取數
 * @param {number}  opts.pageCount    目前頁面顯示的卡片數
 * @param {number}  opts.totalCount   目前篩選結果的總數
 * @param {string}  opts.actionLabel  主要動作按鈕文字
 * @param {string}  opts.actionId     主要動作按鈕 id
 */
export function renderBulkBar({ active, selected, pageCount, totalCount, actionLabel, actionId }) {
  if (!active) {
    return `<div class="bulk-bar">
      <button class="text-btn" data-action="bulk-on">☑ 批量編輯</button>
    </div>`;
  }
  const canSelectAllFiltered = totalCount > pageCount;
  return `<div class="bulk-bar active">
    <div class="bulk-bar-row">
      <span class="bulk-count">已選取 <strong>${selected}</strong> 張</span>
      <button class="text-btn" data-action="bulk-page">全選目前頁面（${pageCount}）</button>
      ${
        canSelectAllFiltered
          ? `<button class="text-btn" data-action="bulk-all">選取全部篩選結果（${totalCount}）</button>`
          : ""
      }
      <button class="text-btn" data-action="bulk-none">取消全選</button>
      <button class="text-btn" data-action="bulk-off">結束批量編輯</button>
    </div>
    <div class="bulk-bar-row">
      <button class="primary-btn" id="${actionId}" ${selected === 0 ? "disabled" : ""}>${escapeHtml(actionLabel)}</button>
    </div>
  </div>`;
}

/**
 * 綁定工具列上的共用按鈕。
 * @param {ParentNode} root
 * @param {object} handlers { onToggleMode, onSelectPage, onSelectAll, onClearSelection }
 */
export function bindBulkBar(root, handlers) {
  const map = {
    "bulk-on": () => handlers.onToggleMode(true),
    "bulk-off": () => handlers.onToggleMode(false),
    "bulk-page": handlers.onSelectPage,
    "bulk-all": handlers.onSelectAll,
    "bulk-none": handlers.onClearSelection
  };
  root.querySelectorAll("[data-action]").forEach((btn) => {
    const fn = map[btn.getAttribute("data-action")];
    if (fn) btn.addEventListener("click", fn);
  });
}

/** 綁定每張卡片上的勾選框。 */
export function bindCheckboxes(root, selection, onChange) {
  root.querySelectorAll("input[data-bulk-id]").forEach((cb) => {
    cb.addEventListener("change", () => {
      selection.toggle(cb.getAttribute("data-bulk-id"), cb.checked);
      onChange && onChange();
    });
  });
}

/**
 * 防止重複提交：同一個 key 的操作還沒跑完之前，再按不會重複執行。
 */
const running = new Set();
export async function runOnce(key, fn) {
  if (running.has(key)) {
    showToast("上一個操作還在進行中，請稍候");
    return { skipped: true };
  }
  running.add(key);
  try {
    return await fn();
  } finally {
    running.delete(key);
  }
}
