import { escapeHtml } from "../utils.js";

// status: owned | confirmed_not_owned | confirmed_absent | unknown
const STATUS_CLASS = {
  owned: "badge-owned",
  confirmed_not_owned: "badge-known",
  confirmed_absent: "badge-absent",
  unknown: "badge-unknown"
};

const STATUS_TITLE = {
  owned: "已收藏",
  confirmed_not_owned: "已確認有此分類卡片，尚未收藏",
  confirmed_absent: "目前收錄範圍內已確認沒有此分類卡片",
  unknown: "資料尚未收錄或尚未確認"
};

export function renderCategoryBadge(cat, catState, { compact = false } = {}) {
  const cls = STATUS_CLASS[catState.status] || "badge-unknown";
  const title = STATUS_TITLE[catState.status] || "";
  const style = catState.status === "owned" ? `style="--badge-color:${cat.color}"` : "";
  return `<span class="cat-badge ${cls} ${compact ? "compact" : ""}" ${style} title="${escapeHtml(cat.label)}：${title}" data-cat="${cat.id}">${escapeHtml(cat.label)}</span>`;
}

export function renderBadgeRow(categories, statusMap, { compact = false } = {}) {
  return categories
    .map((cat) => renderCategoryBadge(cat, statusMap.categories[cat.id], { compact }))
    .join("");
}
