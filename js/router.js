const routes = [];

export function registerRoute(pattern, handler) {
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
  const regex = new RegExp(`^${regexStr}$`);
  routes.push({ regex, paramNames, handler });
}

export function navigate(path) {
  window.location.hash = path;
}

async function handleRoute() {
  const hash = window.location.hash.slice(1) || "/";
  const [path, queryStr] = hash.split("?");
  const query = new URLSearchParams(queryStr || "");
  for (const r of routes) {
    const m = r.regex.exec(path);
    if (m) {
      const params = {};
      r.paramNames.forEach((name, i) => (params[name] = decodeURIComponent(m[i + 1])));
      await r.handler(params, query);
      window.scrollTo(0, 0);
      updateActiveNav(path);
      return;
    }
  }
  // 404 fallback
  document.getElementById("app").innerHTML = `<div class="empty-state">找不到這個頁面</div>`;
}

function updateActiveNav(path) {
  document.querySelectorAll(".bottom-nav a").forEach((a) => {
    const target = a.getAttribute("data-path");
    const isHome = target === "/" && (path === "/" || path.startsWith("/pokemon"));
    // 子頁面（/types/AR）也要讓它的分頁維持選取狀態
    const isSection = target !== "/" && path.startsWith(target + "/");
    a.classList.toggle("active", isHome || isSection || path === target);
  });
}

export function startRouter() {
  window.addEventListener("hashchange", handleRoute);
  handleRoute();
}
