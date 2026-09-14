// 批量選取的共用邏輯。「卡片分類」頁與「我的收藏」頁都用這一份，
// 確保勾選、全選、計數、以及「換條件就清空選取」的行為兩邊一致。
//
// -- 效能上的三個硬性規則（之前踩過的坑，改動時請保持）-------------------
//
// 1. 勾選框一律用「事件委派」：監聽器綁在容器上，綁一次就好，絕對不要對每個
//    checkbox 各綁一次。舊版在每次選取變動時都重新對 120 個 checkbox 綁
//    change，而 change 處理器又會再觸發一次重綁，監聽器因此每點一下就翻倍
//    （實測 250 -> 500 -> 1,000 …八下後 32,000 個，單次點擊從 1.7ms 變成
//    185ms，再點幾下整頁就卡死）。
//
// 2. 選取狀態變動**不可以**重畫列表。勾選是暫時的 UI 狀態，跟收藏／分類資料
//    無關，不需要重讀資料庫、重新過濾排序、更不需要重建 DOM。舊版每次全選都
//    走一次完整 draw()，量到 137～176ms，而且 innerHTML 重建會讓 120 個
//    <img> 全部變成新元素（complete 由 true 變 false）→ 卡圖重新載入解碼。
//
// 3. 工具列只更新數字，不要整塊 innerHTML 重寫（重寫會把按鈕元素換掉，
//    又得重綁監聽器，繞回問題 1）。
import { escapeHtml, showToast } from "../utils.js";
import { isAppMode } from "../appMode.js";

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
    /** 固定一份當下的 id 快照。批量操作一定要用這個，之後列表怎麼變都不影響。 */
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

/** 卡片上的勾選框（批量模式開啟時才渲染）。不在這裡綁事件，交給委派處理。 */
export function renderSelectCheckbox(cardId, checked) {
  return `<label class="bulk-check" title="勾選這張卡">
    <input type="checkbox" data-bulk-id="${escapeHtml(cardId)}" ${checked ? "checked" : ""} />
  </label>`;
}

/**
 * 批量工具列的骨架。只在「進出批量模式」或「列表重畫」時呼叫一次，
 * 之後數字的變動走 refreshBulkBar()，不重建元素。
 */
export function renderBulkBar({ active, selected, pageCount, totalCount, actionLabel, actionId }) {
  // App 版不提供批量編輯：這一處同時關掉「卡片分類」與「我的收藏」兩個入口
  if (isAppMode()) return "";
  if (!active) {
    return `<div class="bulk-bar">
      <button class="text-btn" data-action="bulk-on">☑ 批量編輯</button>
    </div>`;
  }
  const canSelectAllFiltered = totalCount > pageCount;
  return `<div class="bulk-bar active">
    <div class="bulk-bar-row">
      <span class="bulk-count">已選取 <strong data-bulk-count>${selected}</strong> 張</span>
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
      <span class="bulk-progress hidden" data-bulk-progress></span>
    </div>
  </div>`;
}

/** 只更新工具列上的數字與主按鈕狀態，不動 DOM 結構、不重綁任何監聽器。 */
export function refreshBulkBar(host, { selected, actionLabel, actionId }) {
  if (!host) return;
  const countEl = host.querySelector("[data-bulk-count]");
  if (countEl) countEl.textContent = selected;
  const btn = host.querySelector(`#${actionId}`);
  if (btn) {
    btn.disabled = selected === 0;
    btn.textContent = actionLabel;
  }
}

export function setBulkProgress(host, text) {
  if (!host) return;
  const el = host.querySelector("[data-bulk-progress]");
  if (!el) return;
  el.classList.toggle("hidden", !text);
  el.textContent = text || "";
}

/**
 * 綁定工具列上的共用按鈕。工具列每次重建才呼叫一次。
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

/**
 * 勾選框的事件委派。整個容器只綁一個 change 監聽器，而且用旗標確保
 * 同一個容器不會被重複綁。容器本身被 innerHTML 換掉時旗標也會跟著消失，
 * 新的容器會重新綁一次 —— 這正是我們要的。
 *
 * @param {HTMLElement} container 卡片列表的容器
 * @param {object} selection createSelection() 的結果
 * @param {(cardId:string, checked:boolean)=>void} onToggle 單張勾選後的回呼
 */
export function bindCheckboxDelegation(container, selection, onToggle) {
  if (!container || container.dataset.bulkDelegated === "1") return;
  container.dataset.bulkDelegated = "1";
  container.addEventListener("change", (e) => {
    const input = e.target.closest("input[data-bulk-id]");
    if (!input || !container.contains(input)) return;
    const id = input.getAttribute("data-bulk-id");
    selection.toggle(id, input.checked);
    // 只動這一張卡的外框樣式，其他卡片完全不碰
    const cell = input.closest("[data-card-id]");
    if (cell) cell.classList.toggle("selected", input.checked);
    onToggle && onToggle(id, input.checked);
  });
}

/**
 * 把選取狀態一次同步到畫面上（全選／取消全選用）。
 * 直接改既有元素的 checked 與 class，不重建任何 DOM，所以卡圖不會重新載入。
 */
export function syncSelectionToDom(container, selection) {
  if (!container) return;
  container.querySelectorAll("[data-card-id]").forEach((cell) => {
    const id = cell.getAttribute("data-card-id");
    const on = selection.has(id);
    cell.classList.toggle("selected", on);
    const input = cell.querySelector("input[data-bulk-id]");
    if (input && input.checked !== on) input.checked = on;
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

/**
 * 把一份工作切成小塊、每塊之間把主執行緒讓給瀏覽器，避免長時間卡住畫面。
 * 用在批量操作的「準備資料」階段（真正的寫入仍然是單一交易，維持原子性）。
 *
 * @param {Array} items
 * @param {number} chunkSize
 * @param {(chunk:Array, done:number, total:number)=>void} onChunk
 */
export async function processInChunks(items, chunkSize, onChunk) {
  for (let i = 0; i < items.length; i += chunkSize) {
    const chunk = items.slice(i, i + chunkSize);
    onChunk(chunk, Math.min(i + chunk.length, items.length), items.length);
    // 讓出主執行緒：使用者才捲得動、按鈕才有回饋
    await new Promise((r) => setTimeout(r, 0));
  }
}
