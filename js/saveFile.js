// 存檔與選檔：在瀏覽器與 Android WebView 都能用。
//
// -- 為什麼需要這個檔案 ------------------------------------------------------
// exporters.js 的 downloadBlob() 用的是「建一個 <a download> 再程式化 click」
// 這個經典手法。**它在 Android WebView 裡完全沒有作用** —— 不會跳錯誤、
// 不會有任何反應，檔案就是不會存下來。
//
// 這件事影響的不只是匯出功能：collection.js 在清除收藏之前會自動下載一份
// 備份，如果那個下載默默失敗，使用者會以為自己有備份，其實沒有。
//
// 所以兩邊各走各的路：
//   網頁版  —— 原本的 <a download>，行為與現在一模一樣
//   App 版  —— Capacitor 的 Filesystem 寫進「文件」資料夾，再叫出分享面板
//
// Capacitor 的原生外掛是由原生端註冊到 window.Capacitor.Plugins 上的，
// 不需要 import，所以這個沒有打包工具的 ESM 專案可以直接用。

import { isAppMode } from "./appMode.js";
import { showToast } from "./utils.js";

function plugins() {
  return (window.Capacitor && window.Capacitor.Plugins) || {};
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error("讀取檔案內容失敗"));
    reader.onload = () => {
      const s = String(reader.result || "");
      const comma = s.indexOf(",");
      resolve(comma >= 0 ? s.slice(comma + 1) : s);
    };
    reader.readAsDataURL(blob);
  });
}

function downloadViaAnchor(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/**
 * 把一個 Blob 存成檔案給使用者。
 *
 * @returns {Promise<{ok: boolean, where: string, error?: Error}>}
 *   刻意回傳成敗而不是靜靜吞掉 —— 呼叫端（特別是「清除前先備份」那條路徑）
 *   必須知道備份到底有沒有成功，不能假設。
 */
export async function saveBlob(blob, fileName) {
  if (!isAppMode()) {
    try {
      downloadViaAnchor(blob, fileName);
      return { ok: true, where: "download" };
    } catch (err) {
      return { ok: false, where: "download", error: err };
    }
  }

  const { Filesystem, Share } = plugins();
  if (!Filesystem) {
    const err = new Error("這個版本缺少檔案存取功能，無法存檔");
    return { ok: false, where: "none", error: err };
  }

  try {
    const data = await blobToBase64(blob);
    const res = await Filesystem.writeFile({
      path: fileName,
      data,
      directory: "DOCUMENTS",
      recursive: true
    });
    // 寫進「文件」之後再叫分享面板，使用者才能把檔案送到雲端硬碟或傳給自己
    if (Share && res && res.uri) {
      try {
        await Share.share({ title: fileName, url: res.uri });
      } catch {
        // 使用者取消分享不算失敗，檔案已經存好了
      }
    }
    return { ok: true, where: res && res.uri ? res.uri : "DOCUMENTS/" + fileName };
  } catch (err) {
    return { ok: false, where: "filesystem", error: err };
  }
}

/** 存 JSON。物件會自己轉字串。 */
export async function saveJson(obj, fileName) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
  return saveBlob(blob, fileName);
}

/**
 * 存檔並顯示結果提示。大部分呼叫端要的是這個。
 * @returns {Promise<boolean>} 有沒有真的存成功
 */
export async function saveJsonWithToast(obj, fileName, successText) {
  const res = await saveJson(obj, fileName);
  if (res.ok) {
    showToast(successText || `已儲存 ${fileName}`);
  } else {
    showToast(`存檔失敗：${res.error ? res.error.message : "原因不明"}`, { duration: 15000 });
  }
  return res.ok;
}

/**
 * 請使用者挑一個 JSON 檔。
 * <input type="file"> 在 Capacitor 的 WebView 是可以用的（原生端有實作
 * onShowFileChooser），所以兩邊共用同一套。
 * @returns {Promise<File|null>} 取消時回 null
 */
export function pickJsonFile() {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json,.json";
    input.style.display = "none";
    document.body.appendChild(input);
    let settled = false;
    const done = (v) => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(v);
    };
    input.addEventListener("change", () => done(input.files && input.files[0] ? input.files[0] : null));
    // 使用者按取消時某些平台不會觸發 change，用 focus 當保險
    window.addEventListener("focus", () => setTimeout(() => done(null), 1500), { once: true });
    input.click();
  });
}
