// 使用者手動上傳替代圖片的共用邏輯。圖片存進 IndexedDB（跟收藏資料同一個
// 資料庫，不會因為清瀏覽器快取而消失），優先權高於本機下載快取與遠端網址。
import { setCustomImage, deleteCustomImage, getCustomImage } from "./db.js";
import { refreshCustomImageForId } from "./data.js";
import { showToast } from "./utils.js";

const MAX_BYTES = 8 * 1024 * 1024; // 8MB，個人相簿用途足夠，避免誤傳超大檔案塞爆 IndexedDB

function validateImageFile(file) {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith("image/")) {
      reject(new Error("這不是圖片檔案"));
      return;
    }
    if (file.size > MAX_BYTES) {
      reject(new Error(`檔案太大（${(file.size / 1024 / 1024).toFixed(1)}MB），請壓縮到 8MB 以內`));
      return;
    }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve();
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("檔案無法解碼成圖片，可能已損毀或不是有效的圖片格式"));
    };
    img.src = url;
  });
}

let sharedInput = null;
function getSharedInput() {
  if (!sharedInput) {
    sharedInput = document.createElement("input");
    sharedInput.type = "file";
    sharedInput.accept = "image/*";
    sharedInput.style.display = "none";
    document.body.appendChild(sharedInput);
  }
  return sharedInput;
}

/**
 * 開啟檔案選擇視窗，使用者選好圖片後驗證＋存檔＋刷新畫面。
 * @param {string} id - "species:<圖鑑編號>" 或卡片 id
 * @param {() => void} onDone - 成功上傳後呼叫，用來重新渲染畫面
 */
export function promptUploadImage(id, onDone) {
  const input = getSharedInput();
  input.value = "";
  input.onchange = async () => {
    const file = input.files[0];
    if (!file) return;
    try {
      await validateImageFile(file);
      await setCustomImage(id, file, file.name);
      await refreshCustomImageForId(id);
      showToast("圖片已上傳並儲存到本機收藏資料中");
      onDone && onDone();
    } catch (err) {
      alert("上傳失敗：" + err.message);
    }
  };
  input.click();
}

export async function removeCustomImage(id, onDone) {
  const existing = await getCustomImage(id);
  if (!existing) return;
  await deleteCustomImage(id);
  await refreshCustomImageForId(id);
  showToast("已移除自訂圖片，恢復成預設圖片", {
    actionLabel: "復原",
    onAction: async () => {
      await setCustomImage(id, existing.blob, existing.fileName);
      await refreshCustomImageForId(id);
      onDone && onDone();
    }
  });
  onDone && onDone();
}

export async function hasCustomImage(id) {
  const rec = await getCustomImage(id);
  return !!rec;
}

/**
 * 採用一張「待核對的候選圖片」：把該檔案讀成 blob 後，存成這張卡的自訂圖片。
 * 走的是跟手動上傳完全一樣的路徑，所以之後一樣可以隨時移除復原。
 * @param {string} cardId
 * @param {string} path - 例如 "images/candidates/ja_MC-DAR__1.webp"
 * @param {() => void} onDone
 */
export async function acceptCandidateImage(cardId, path, onDone) {
  try {
    const res = await fetch(path);
    if (!res.ok) throw new Error(`讀取圖片失敗（HTTP ${res.status}）`);
    const blob = await res.blob();
    await validateImageFile(new File([blob], path.split("/").pop(), { type: blob.type }));
    await setCustomImage(cardId, blob, path.split("/").pop());
    await refreshCustomImageForId(cardId);
    showToast("已採用這張候選圖片；不滿意可以再移除或改用手動上傳");
    onDone && onDone();
  } catch (err) {
    alert("採用候選圖片失敗：" + err.message);
  }
}
