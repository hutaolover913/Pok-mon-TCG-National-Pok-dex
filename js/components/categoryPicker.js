// 「手動指定卡片分類」的共用元件。待確認頁與寶可夢詳細頁都用這一份，
// 確保兩邊的行為、儲存方式與提示文字完全一致。
//
// 互動設計上的三個重點：
//  1. 選完就存，不需要另外按儲存按鈕。
//  2. 「待確認」是一個可以主動選的分類（意思是「我看過了，確實無法判斷」），
//     跟「恢復自動分類」（清掉手動覆寫）是兩個不同的操作，所以分成下拉選單
//     的一個選項與旁邊獨立的一顆按鈕。
//  3. 存檔失敗要講清楚並且能重試，不能默默吃掉。
import { CARD_CATEGORY_DEFS } from "../cardCategories.js";
import { setCategoryOverride, clearCategoryOverride, getCategoryOverride } from "../db.js";
import { refreshCategoryOverrideForCard } from "../data.js";
import { showToast, escapeHtml } from "../utils.js";

export const AUTO_VALUE = "__AUTO__";

/** 上一次的分類操作，供「復原」使用。只保留一步。 */
let lastAction = null;

/**
 * 產生一個分類選擇器的 HTML。
 * @param {object} card
 * @param {{compact?: boolean}} opts
 */
export function renderCategoryPicker(card, { compact = false } = {}) {
  const override = card.categoryOverrideId;
  const autoLabel = labelOf(card.autoRarityCategoryId);
  const value = override || AUTO_VALUE;

  return `
  <div class="cat-picker${compact ? " compact" : ""}" data-picker-card="${escapeHtml(card.id)}">
    <label class="cat-picker-label">分類</label>
    <select class="cat-picker-select" aria-label="指定這張卡的分類">
      <option value="${AUTO_VALUE}">自動：${escapeHtml(autoLabel)}</option>
      ${CARD_CATEGORY_DEFS.map(
        (d) => `<option value="${d.id}"${d.id === override ? " selected" : ""}>${escapeHtml(d.label)}</option>`
      ).join("")}
    </select>
    <button class="text-btn cat-picker-reset${override ? "" : " hidden"}" data-action="reset-category"
            title="清除手動指定，回到系統自動判定的分類">恢復自動</button>
    <span class="cat-picker-status" role="status" aria-live="polite"></span>
  </div>`;
}

/**
 * 綁定一個（或一組）分類選擇器。
 * @param {ParentNode} root 要在裡面找 .cat-picker 的容器
 * @param {(cardId: string) => void} onChanged 存檔成功後呼叫，用來重畫畫面
 */
export function bindCategoryPickers(root, onChanged) {
  root.querySelectorAll(".cat-picker").forEach((picker) => {
    const cardId = picker.getAttribute("data-picker-card");
    const select = picker.querySelector(".cat-picker-select");
    const resetBtn = picker.querySelector('[data-action="reset-category"]');
    const status = picker.querySelector(".cat-picker-status");

    select.addEventListener("change", () => {
      const chosen = select.value;
      applyChange(cardId, chosen === AUTO_VALUE ? null : chosen, { picker, status, onChanged });
    });

    resetBtn.addEventListener("click", () => {
      applyChange(cardId, null, { picker, status, onChanged });
    });
  });
}

function labelOf(categoryId) {
  const def = CARD_CATEGORY_DEFS.find((d) => d.id === categoryId);
  return def ? def.label : categoryId;
}

function setStatus(status, text, kind) {
  if (!status) return;
  status.textContent = text;
  status.className = `cat-picker-status ${kind || ""}`;
}

/**
 * 實際寫入。newCategoryId === null 代表「恢復自動分類」。
 */
async function applyChange(cardId, newCategoryId, { picker, status, onChanged, isUndo = false } = {}) {
  setStatus(status, "儲存中…", "saving");
  let previous = null;
  try {
    // 先記住原本的狀態，存檔成功後才拿來當「復原」的依據
    const existing = await getCategoryOverride(cardId);
    previous = existing ? existing.categoryId : null;

    if (newCategoryId === null) {
      await clearCategoryOverride(cardId);
    } else {
      await setCategoryOverride(cardId, newCategoryId);
    }
    refreshCategoryOverrideForCard(cardId, newCategoryId);

    setStatus(status, "已儲存", "saved");
    if (picker) {
      const resetBtn = picker.querySelector('[data-action="reset-category"]');
      if (resetBtn) resetBtn.classList.toggle("hidden", !newCategoryId);
    }

    if (!isUndo) {
      lastAction = { cardId, from: previous, to: newCategoryId };
      showToast(
        newCategoryId === null
          ? "已恢復為自動分類"
          : `已將這張卡指定為「${labelOf(newCategoryId)}」`,
        {
          actionLabel: "復原",
          onAction: () => undoLastAction(onChanged)
        }
      );
    }

    onChanged && onChanged(cardId);
  } catch (err) {
    // 失敗要講清楚，而且要能重試 —— 不可以只在 console 留訊息就當沒事
    setStatus(status, "儲存失敗", "failed");
    showToast(`分類儲存失敗：${err && err.message ? err.message : err}`, {
      actionLabel: "重試",
      onAction: () => applyChange(cardId, newCategoryId, { picker, status, onChanged, isUndo }),
      duration: 12000
    });
  }
}

/** 復原上一次的分類操作（只回復一步）。 */
export async function undoLastAction(onChanged) {
  if (!lastAction) {
    showToast("沒有可以復原的分類操作");
    return;
  }
  const { cardId, from } = lastAction;
  lastAction = null;
  await applyChange(cardId, from, { onChanged, isUndo: true });
  showToast("已復原上一次的分類操作");
}

export function hasUndoableAction() {
  return !!lastAction;
}
