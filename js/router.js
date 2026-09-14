import { saveView } from "./viewState.js";

const routes = [];
let notFoundHandler = null;

function compile(pattern) {
  // pattern like "/" or "/pokemon/:id"
  const paramNames = [];
  const regexStr = pattern
    .split("/")
    .map((seg) => {
      if (seg.startsWith(":")) {
        paramNames.push(seg.slice(1));
        return "([^/]+)";
      }
      return seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    })
    .join("/");
  return { regex: new RegExp(`^${regexStr}$`), paramNames };
}

export function registerRoute(pattern, handler) {
  const { regex, paramNames } = compile(pattern);
  routes.push({ pattern, regex, paramNames, handler });
}

/**
 * 註冊一條「用到才載入」的路由。
 *
 * loader 是一個回傳 Promise<handler> 的函式，通常是 () => import(...)。
 * 沒有被註冊的路由永遠不會去 import 它的模組，所以 App 版把管理用的頁面
 * 檔案整個拿掉也不會出錯 —— 這是 js/routes.js 那套設計能成立的原因。
 */
export function registerLazyRoute(pattern, loader) {
  const { regex, paramNames } = compile(pattern);
  let cached = null;
  routes.push({
    pattern,
    regex,
    paramNames,
    handler: async (params, query) => {
      if (!cached) cached = await loader();
      return cached(params, query);
    }
  });
}

/** 換掉預設的 404 畫面。App 版用來顯示比較友善的訊息。 */
export function registerNotFound(handler) {
  notFoundHandler = handler;
}

export function navigate(path) {
  window.location.hash = path;
}

// ---------------------------------------------------------------- 捲動位置
//
// 原本這裡是每次換頁都無條件 window.scrollTo(0, 0)，所以從卡片詳情返回清單時
// 一定會跳回最上面。現在改成：
//
//   離開一頁時   -> 記下當時的 scrollY（此時畫面還沒重畫，讀得到正確值）
//   進入一頁時   -> 誰都沒有要求還原的話，維持原本的 scrollTo(0, 0)
//
// 頁面要還原位置就在自己的 render 過程中呼叫 requestScrollRestore(y)。
// 沒有呼叫的頁面行為與改版前**完全相同**，所以網頁版不會有任何回歸。

let currentPath = null;
let pendingScrollY = null;

/** 由路由 handler 在 render 時呼叫，表示這一頁要還原到指定的捲動位置。 */
export function requestScrollRestore(y) {
  if (typeof y === "number" && y >= 0) pendingScrollY = y;
}

/** 目前所在的路由路徑，頁面模組用來存／取自己的 viewState。 */
export function currentRoutePath() {
  return currentPath;
}

/**
 * 套用捲動位置。
 *
 * 看起來該是一行 window.scrollTo(0, y) 就好，實際上不行。實測到的順序是：
 *
 *   1. 路由 handler 回來時，文件高度還是**上一頁**留下的（詳情頁很長）
 *   2. scrollTo(0, 3000) 於是成功了
 *   3. 清單接著非同步重畫，grid.innerHTML = "" 讓高度瞬間塌掉
 *   4. 瀏覽器把捲動位置夾回 0
 *   5. 圖片是 loading="lazy" 又沒有指定尺寸，高度要等圖片進來才撐得回去
 *
 * 所以要在一小段時間內持續確認，被夾掉就再捲回去。
 *
 * 判斷「使用者自己捲動了」不能看位置變化 —— 第 4 步的夾回跟使用者捲動長得
 * 一模一樣，會誤判成使用者操作而提早放棄。改成直接聽實際的輸入事件。
 */
function applyScroll(target) {
  const y = target === null ? 0 : target;
  window.scrollTo(0, y);
  if (y === 0) return;

  let userMoved = false;
  const onUserInput = () => {
    userMoved = true;
  };
  const events = ["wheel", "touchstart", "keydown", "pointerdown"];
  for (const e of events) window.addEventListener(e, onUserInput, { passive: true });
  const stop = () => {
    for (const e of events) window.removeEventListener(e, onUserInput);
  };

  const deadline = Date.now() + 1500;
  const tick = () => {
    if (userMoved || Date.now() > deadline) {
      stop();
      return;
    }
    if (Math.abs(window.scrollY - y) >= 4) window.scrollTo(0, y);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

async function handleRoute() {
  const hash = window.location.hash.slice(1) || "/";
  const [path, queryStr] = hash.split("?");
  const query = new URLSearchParams(queryStr || "");

  // 先把離開前的捲動位置存起來，之後回到這一頁才還原得了
  if (currentPath !== null && currentPath !== path) {
    saveView(currentPath, { scrollY: window.scrollY });
  }
  pendingScrollY = null;

  for (const r of routes) {
    const m = r.regex.exec(path);
    if (m) {
      const params = {};
      r.paramNames.forEach((name, i) => (params[name] = decodeURIComponent(m[i + 1])));
      await r.handler(params, query);
      applyScroll(pendingScrollY);
      updateActiveNav(path);
      currentPath = path;
      return;
    }
  }

  currentPath = path;
  if (notFoundHandler) {
    notFoundHandler(path);
    return;
  }
  document.getElementById("app").innerHTML = `<div class="empty-state">找不到這個頁面</div>`;
}

function updateActiveNav(path) {
  document.querySelectorAll(".bottom-nav a").forEach((a) => {
    const target = a.getAttribute("data-path");
    const isHome = target === "/" && (path === "/" || path.startsWith("/pokemon"));
    // 子頁面（/types/AR）也要讓它的分頁維持選取狀態
    const isSection = target !== "/" && path.startsWith(target + "/");
    // App 版的「卡片」分頁同時涵蓋 /types 與 /sets，用 data-also 標示
    const also = (a.getAttribute("data-also") || "").split(",").filter(Boolean);
    const isAlso = also.some((p) => path === p || path.startsWith(p + "/"));
    a.classList.toggle("active", isHome || isSection || isAlso || path === target);
  });
}

export function startRouter() {
  window.addEventListener("hashchange", handleRoute);
  handleRoute();
}
