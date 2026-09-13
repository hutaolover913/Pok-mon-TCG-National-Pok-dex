// 卡片的「系列／卡包／規則標記」顯示與手動修正。
//
// 這三個欄位與稀有度分類（AR／SAR／CHR…）是完全獨立的兩套資料：
// 改這裡不會動到使用者整理好的分類，也不會動到收藏與備註。
// 之後更新來源資料時，手動指定一律優先，不會被覆蓋。
import { getSeriesList, getSetsOfSeries, getSeriesDisplay, seriesOfCard,
         getRegulationMark, markLabel, getAllMarks, MARK_STATUS } from "../seriesCatalog.js";
import { getCategoryDef } from "../cardCategories.js";
import { setFieldOverride, clearFieldOverride } from "../db.js";
import { refreshFieldOverrideForCard } from "../data.js";
import { escapeHtml, showToast } from "../utils.js";

const LANG_LABEL = { en: "英文版（美版）", ja: "日文版", "zh-Hant": "繁體中文版", "zh-Hans": "簡體中文版" };

/** 卡片詳細頁的資訊區塊：所屬大系列、卡包名稱與代碼、語言、卡號、規則標記、稀有度分類。 */
export function renderFieldInfo(card) {
  const seriesId = seriesOfCard(card);
  const disp = getSeriesDisplay(seriesId);
  const mk = getRegulationMark(card);
  const cats = (card.categoryIds || []).map((id) => getCategoryDef(id)).filter(Boolean);
  const number = card.printedTotal ? `${card.cardNumber}/${card.printedTotal}` : card.cardNumber;
  const manualSeries = !!card.seriesOverrideId;
  const manualSet = !!card.setKeyOverride;
  const needsEdit = mk.status === MARK_STATUS.UNKNOWN || seriesId === "UNKNOWN";

  return `
  <div class="field-info" data-field-card="${escapeHtml(card.id)}">
    <div class="field-row"><span class="field-key">大系列</span>
      <span>${escapeHtml(disp.zh)}<span class="field-sub">（${escapeHtml(disp.en || "")}${
        card.seriesId ? `・${escapeHtml(card.seriesId)}` : ""}）</span>${manualSeries ? `<span class="manual-tag">手動指定</span>` : ""}</span></div>
    <div class="field-row"><span class="field-key">卡包</span>
      <span>${escapeHtml(card.setName || "")}<span class="field-sub">（${escapeHtml(card.setId || "")}）</span>${
        manualSet ? `<span class="manual-tag">手動指定</span>` : ""}</span></div>
    <div class="field-row"><span class="field-key">語言／地區</span><span>${escapeHtml(LANG_LABEL[card.language] || card.language)}</span></div>
    <div class="field-row"><span class="field-key">完整卡號</span><span>${escapeHtml(String(number))}</span></div>
    <div class="field-row"><span class="field-key">規則標記</span>
      <span class="mark-tag mark-${mk.status}">${escapeHtml(markLabel(mk))}</span></div>
    <div class="field-row"><span class="field-key">稀有度分類</span>
      <span>${cats.map((c) => `<span class="mech-tag" style="border-color:${c.color};color:${c.color}">${escapeHtml(c.label)}</span>`).join(" ") || "—"}</span></div>
    <div class="field-row">
      <button class="text-btn" data-action="edit-fields">${needsEdit ? "修正待確認欄位…" : "修改系列／卡包／標記…"}</button>
    </div>
  </div>`;
}

export function bindFieldEditors(root, onChanged) {
  root.querySelectorAll('[data-action="edit-fields"]').forEach((btn) => {
    btn.addEventListener("click", () => {
      const host = btn.closest("[data-field-card]");
      openEditor(host.getAttribute("data-field-card"), onChanged);
    });
  });
}

async function openEditor(cardId, onChanged) {
  const { getCard } = await import("../data.js");
  const card = getCard(cardId);
  if (!card) return;

  const old = document.getElementById("field-dialog");
  if (old) old.remove();

  const currentSeries = seriesOfCard(card);
  const mk = getRegulationMark(card);
  const marks = getAllMarks();

  const dlg = document.createElement("div");
  dlg.id = "field-dialog";
  dlg.className = "modal-backdrop";
  dlg.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true">
      <h3>修改系列／卡包／規則標記</h3>
      <p class="hint-text">${escapeHtml(card.name)}（${escapeHtml(card.setId)} · ${escapeHtml(String(card.cardNumber))}）</p>
      <p class="hint-text">這三個欄位與你整理好的 AR／SAR／CHR 等<strong>稀有度分類、收藏狀態與備註完全獨立</strong>，改這裡不會動到它們。選好會自動儲存。</p>

      <label class="modal-label">大系列
        <select id="fd-series" class="cat-select">
          <option value="">（沿用來源資料：${escapeHtml(getSeriesDisplay(currentSeries).zh)}）</option>
          ${getSeriesList().map((s) => `<option value="${s.id}"${card.seriesOverrideId === s.id ? " selected" : ""}>${escapeHtml(s.zh)}</option>`).join("")}
        </select>
      </label>

      <label class="modal-label">所屬卡包（只列出該系列的卡包，避免系列與卡包對不上）
        <select id="fd-set" class="cat-select"></select>
      </label>

      <label class="modal-label">規則標記
        <select id="fd-mark" class="cat-select">
          <option value="">（沿用來源資料：${escapeHtml(markLabel(mk))}）</option>
          ${marks.map((m) => `<option value="${escapeHtml(m)}"${card.regulationMarkOverride === m ? " selected" : ""}>${escapeHtml(m)}</option>`).join("")}
        </select>
      </label>

      <div id="fd-status" class="cat-picker-status"></div>
      <div class="modal-actions">
        <button class="text-btn" data-action="reset">清除全部手動指定</button>
        <button class="text-btn" data-action="close">關閉</button>
      </div>
    </div>`;
  document.body.appendChild(dlg);

  const seriesSel = dlg.querySelector("#fd-series");
  const setSel = dlg.querySelector("#fd-set");
  const markSel = dlg.querySelector("#fd-mark");
  const status = dlg.querySelector("#fd-status");

  const fillSets = () => {
    const sid = seriesSel.value || currentSeries;
    const sets = getSetsOfSeries(sid);
    setSel.innerHTML = `<option value="">（沿用來源資料：${escapeHtml(card.setName || card.setId)}）</option>`
      + sets.map((s) => `<option value="${escapeHtml(s.setKey)}"${card.setKeyOverride === s.setKey ? " selected" : ""}>`
        + `${escapeHtml(s.setName)}（${escapeHtml(s.setId)}・${escapeHtml(LANG_LABEL[s.language] || s.language)}）</option>`).join("");
  };
  fillSets();

  const save = async (patch) => {
    status.textContent = "儲存中…";
    status.className = "cat-picker-status saving";
    try {
      const rec = await setFieldOverride(cardId, patch);
      refreshFieldOverrideForCard(cardId, rec);
      status.textContent = "已儲存";
      status.className = "cat-picker-status saved";
      onChanged && onChanged();
    } catch (err) {
      status.textContent = "儲存失敗";
      status.className = "cat-picker-status failed";
      showToast(`儲存失敗：${err.message}`, { actionLabel: "重試", onAction: () => save(patch) });
    }
  };

  seriesSel.addEventListener("change", async () => {
    // 換系列時，原本選的卡包若不屬於新系列就一併清掉，避免系列與卡包矛盾
    const sid = seriesSel.value;
    const stillValid = !card.setKeyOverride || (sid && getSetsOfSeries(sid).some((s) => s.setKey === card.setKeyOverride));
    await save({ seriesId: sid || null, ...(stillValid ? {} : { setKey: null }) });
    fillSets();
  });
  setSel.addEventListener("change", () => save({ setKey: setSel.value || null }));
  markSel.addEventListener("change", () => save({ regulationMark: markSel.value || null }));

  dlg.querySelector('[data-action="reset"]').addEventListener("click", async () => {
    await clearFieldOverride(cardId);
    refreshFieldOverrideForCard(cardId, null);
    status.textContent = "已清除手動指定，回到來源資料";
    status.className = "cat-picker-status saved";
    seriesSel.value = "";
    markSel.value = "";
    fillSets();
    onChanged && onChanged();
  });
  dlg.querySelector('[data-action="close"]').addEventListener("click", () => dlg.remove());
  dlg.addEventListener("click", (e) => {
    if (e.target === dlg) dlg.remove();
  });
}
