export function escapeHtml(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function debounce(fn, wait) {
  let t = null;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

export function padDex(id) {
  return String(id).padStart(4, "0");
}

const PLACEHOLDER_SVG =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">
      <rect width="200" height="200" fill="#2a2f3a"/>
      <circle cx="100" cy="80" r="34" fill="none" stroke="#565f70" stroke-width="6"/>
      <path d="M60 130 h80" stroke="#565f70" stroke-width="6" stroke-linecap="round"/>
      <text x="100" y="168" font-size="16" fill="#8a93a6" text-anchor="middle" font-family="sans-serif">圖片無法載入</text>
    </svg>`
  );

export function withImageFallback(imgTagHtml) {
  return imgTagHtml;
}

// 圖片載入失敗時的退路，順序是：本機檔案 -> 原始遠端網址 -> 佔位圖。
//
// 為什麼需要中間那層：`images/` 沒有進 git，從 GitHub clone 下來、或背景補圖
// 還沒跑完時，data/image_local_map.json 可能指到一個還不存在的本機檔案。
// 少了這層就會整頁都是佔位圖，即使那張卡在 TCGdex 上明明有圖可以直接顯示。
if (typeof window !== "undefined" && !window.__imgFallback) {
  window.__imgFallback = (img) => {
    const remote = img.getAttribute("data-remote");
    if (remote && !img.dataset.remoteTried) {
      img.dataset.remoteTried = "1";
      img.src = remote;
      return;
    }

    // App 版：遠端也抓不到（通常是離線）時，先問本機的圖片快取。
    // window.__imgCacheLookup 由 js/imageCache.js 在 App 模式掛上；
    // 網頁版沒有這個函式，行為與改版前完全相同。
    if (remote && !img.dataset.cacheTried && typeof window.__imgCacheLookup === "function") {
      img.dataset.cacheTried = "1";
      window.__imgCacheLookup(remote).then((blobUrl) => {
        if (blobUrl) {
          img.src = blobUrl;
        } else {
          img.onerror = null;
          img.src = PLACEHOLDER_SVG;
          img.classList.add("img-fallback");
        }
      });
      return;
    }

    img.onerror = null;
    img.src = PLACEHOLDER_SVG;
    img.classList.add("img-fallback");
  };
}

/**
 * @param {string} [remoteUrl] 這張圖的原始遠端網址；沒有就直接退回佔位圖。
 */
export function imgFallbackAttr(remoteUrl) {
  const remote = remoteUrl ? ` data-remote="${escapeHtml(remoteUrl)}"` : "";
  return `${remote} onerror="window.__imgFallback(this)"`;
}

export const PLACEHOLDER_IMAGE = PLACEHOLDER_SVG;

let toastTimer = null;
export function showToast(message, { actionLabel, onAction, duration = 6000 } = {}) {
  let el = document.getElementById("toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "toast";
    el.className = "toast";
    document.body.appendChild(el);
  }
  clearTimeout(toastTimer);
  el.innerHTML = `<span class="toast-msg"></span>` + (actionLabel ? `<button class="toast-action">${escapeHtml(actionLabel)}</button>` : "");
  el.querySelector(".toast-msg").textContent = message;
  el.classList.add("show");
  if (actionLabel && onAction) {
    const btn = el.querySelector(".toast-action");
    btn.onclick = () => {
      onAction();
      hideToast();
    };
  }
  toastTimer = setTimeout(hideToast, duration);
}

export function hideToast() {
  const el = document.getElementById("toast");
  if (el) el.classList.remove("show");
  clearTimeout(toastTimer);
}

export function formatDate(iso) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
  } catch {
    return iso;
  }
}

// ---------------------------------------------------- 防連點

const runningKeys = new Set();

/**
 * 同一個 key 的操作在完成前不會被重複觸發。
 *
 * 手機上很容易連按兩下「＋」，如果兩次寫入同時進行，第二次讀到的是第一次
 * 寫入前的數字，結果就是加了兩下只加到一。這裡擋住重入。
 *
 * 原本放在 components/bulkSelect.js，現在計數器也要用，所以移到這裡；
 * bulkSelect 仍然 re-export，既有呼叫端不用改。
 */
export async function runOnce(key, fn) {
  if (runningKeys.has(key)) {
    showToast("上一個操作還在進行中，請稍候");
    return { skipped: true };
  }
  runningKeys.add(key);
  try {
    return await fn();
  } finally {
    runningKeys.delete(key);
  }
}
