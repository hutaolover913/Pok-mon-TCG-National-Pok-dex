// 系列／卡包目錄與規則標記。
//
// 這個模組在載入卡表後建一次索引（系列 -> 卡包 -> 卡片），之後所有查詢都是
// Map 查表，不會每次點選都重新掃全部 15,846 張卡。
//
// -- 系列怎麼判定 ----------------------------------------------------------
// 一律以 sets.json 裡該卡包的 seriesId 為準，**不看卡片名稱**。
// 卡名含 Mega／M 不代表它屬於 Mega Evolution 系列（例如日版 M2a 裡的
// メガリザードンXex 之所以歸在 MEGA，是因為 M2a 這個卡包屬於 M 系列，
// 不是因為卡名有「メガ」）。
//
// -- 語言不合併 ------------------------------------------------------------
// 英文的 sv 與日文的 SV 在瀏覽時歸在同一個「大系列」底下方便找，但每個卡包
// 仍然保留自己的語言、卡包代碼與原始 seriesId，不會被合併成同一個卡包。
import { getAllCards, getAllSetsMeta } from "./data.js";
import { label as appLabel, markLabelForMode } from "./appLabels.js";

// 大系列的正規化對照。key 是 `${language}:${seriesId}`，值是正規化後的大系列。
// 這份對照是掃過 data/sets.json 裡實際存在的 6 組 (語言, seriesId) 後列出來的，
// 不是推測；新增系列時要在這裡補上，對不到的會落到「系列待確認」。
const SERIES_CANON = {
  "en:sv": "SV",
  "ja:SV": "SV",
  "en:swsh": "SWSH",
  "ja:S": "SWSH",
  "en:me": "MEGA",
  "ja:M": "MEGA"
};

const SERIES_DISPLAY = {
  SV: { zh: "朱＆紫", en: "Scarlet & Violet", ja: "スカーレット&バイオレット", order: 3 },
  SWSH: { zh: "劍＆盾", en: "Sword & Shield", ja: "剣と盾", order: 2 },
  MEGA: { zh: "超級進化", en: "Mega Evolution", ja: "ポケモンカードゲーム MEGA", order: 4 },
  UNKNOWN: { zh: "系列待確認", en: "Series unconfirmed", ja: "", order: 99 }
};

export const SERIES_UNKNOWN = "UNKNOWN";

let catalog = null;
let regulationMarks = null; // cardId -> "G" | null；沒有這個 key 代表狀態不明

/** 規則標記的三種狀態，刻意分開：有標記／確定無標記／尚未核實。 */
export const MARK_STATUS = { MARKED: "marked", NONE: "none", UNKNOWN: "unknown" };

/**
 * 清理來源資料裡少數不合法的標記值。實測 TCGdex 回傳過兩種異常：
 *
 *   "j"（小寫）× 1 張：mep-051。同一個卡包裡有 50 張是大寫 "J"，明顯只是
 *                      大小寫誤植，統一成大寫 "J"。
 *   "None"（字串）× 2 張：mfb-33 Potion、mfb-34 Switch。"None" 不是合法的
 *                      規則標記，看起來是來源端把空值序列化成字串了。雖然同
 *                      卡包其他 32 張都確認是「無標記」，但我們不能替來源
 *                      斷定，所以這兩張一律當成「待確認」，不併入「無標記」。
 *
 * 規則：單一 A–Z 字母才算有效標記；小寫轉大寫；其餘一律視為未解析。
 */
function sanitizeMarks(raw) {
  const out = {};
  for (const [cardId, value] of Object.entries(raw)) {
    if (value === null) {
      out[cardId] = null; // 來源明確沒有標記
      continue;
    }
    const v = String(value).trim();
    if (/^[A-Za-z]$/.test(v)) {
      out[cardId] = v.toUpperCase();
    }
    // 其他值（例如 "None"）不寫進來，等於維持「待確認」
  }
  return out;
}

export async function loadRegulationMarks() {
  if (regulationMarks) return regulationMarks;
  try {
    const res = await fetch("data/regulation_marks.json");
    if (!res.ok) throw new Error(String(res.status));
    const doc = await res.json();
    regulationMarks = sanitizeMarks(doc.marks || {});
  } catch {
    // 檔案還沒產生或讀取失敗：全部當成「待確認」，不要用其他欄位推算
    regulationMarks = {};
  }
  return regulationMarks;
}

/**
 * 這張卡的規則標記。
 * @returns {{mark: string|null, status: string}}
 *   status = marked（來源有給）／none（來源明確沒有）／unknown（尚未核實）
 */
export function getRegulationMark(card) {
  if (card.regulationMarkOverride !== undefined && card.regulationMarkOverride !== null) {
    return { mark: card.regulationMarkOverride, status: MARK_STATUS.MARKED, manual: true };
  }
  if (!regulationMarks || !Object.prototype.hasOwnProperty.call(regulationMarks, card.id)) {
    return { mark: null, status: MARK_STATUS.UNKNOWN };
  }
  const v = regulationMarks[card.id];
  return v ? { mark: v, status: MARK_STATUS.MARKED } : { mark: null, status: MARK_STATUS.NONE };
}

export function markLabel(info) {
  if (info.status === MARK_STATUS.MARKED) {
    // App 版不顯示「（手動指定）」——那是整理資料時的註記
    const manualNote = appLabel("手動指定") ? "（手動指定）" : "";
    return info.mark + (info.manual ? manualNote : "");
  }
  if (info.status === MARK_STATUS.NONE) return "無標記";
  return markLabelForMode("待確認");
}

// ---------------------------------------------------------------- 卡包排序
//
// 一律依「該語言／發行地區自己的卡包發售日期」排，日版與英文版各用各的日期。
// 比較用的是真正的時間值（Date.parse），不是直接比字串，避免不同格式的日期
// 字串排出奇怪的順序。
//
// 同一天發售的卡包再依卡包代碼、卡包 ID 排，確保每次顯示順序都一樣。
// 沒有日期或日期無效的卡包，兩種排序方向下都固定放最後，並標「發售日期待確認」。

export const SET_SORT = { NEWEST: "newest", OLDEST: "oldest" };
let currentSetSort = SET_SORT.NEWEST;

/** 把卡包的發售日期轉成可比較的時間值；無效回傳 null（代表待確認）。 */
export function setReleaseTime(meta) {
  const raw = meta && meta.releaseDate;
  if (!raw) return null;
  const t = Date.parse(String(raw).trim());
  return Number.isFinite(t) ? t : null;
}

export function hasValidReleaseDate(meta) {
  return setReleaseTime(meta) !== null;
}

/** YYYY/MM/DD；沒有有效日期時回傳「發售日期待確認」。 */
export function formatReleaseDate(meta) {
  const t = setReleaseTime(meta);
  if (t === null) return appLabel("發售日期待確認");
  const d = new Date(t);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())}`;
}

/** 就地排序一份卡包清單。回傳同一個陣列，方便串接。 */
export function sortSets(list, direction = currentSetSort) {
  const dir = direction === SET_SORT.OLDEST ? 1 : -1;
  list.sort((a, b) => {
    const ta = setReleaseTime(a);
    const tb = setReleaseTime(b);
    // 沒有日期的一律沉底，不論由新到舊還是由舊到新
    if (ta === null && tb === null) return cmpStable(a, b);
    if (ta === null) return 1;
    if (tb === null) return -1;
    if (ta !== tb) return (ta - tb) * dir;
    return cmpStable(a, b);
  });
  return list;
}

function cmpStable(a, b) {
  return String(a.setId || "").localeCompare(String(b.setId || ""))
    || String(a.setKey || "").localeCompare(String(b.setKey || ""));
}

export function getSetSort() {
  return currentSetSort;
}

/** 改排序方向：重排所有已建好的清單，不需要重建整個索引。 */
export function setSetSort(direction) {
  currentSetSort = direction === SET_SORT.OLDEST ? SET_SORT.OLDEST : SET_SORT.NEWEST;
  if (catalog) {
    for (const list of catalog.setsBySeries.values()) sortSets(list, currentSetSort);
  }
  return currentSetSort;
}

/** 全部卡包（跨系列），依目前排序方向排好。 */
export function getAllSetsSorted(direction = currentSetSort) {
  const all = [];
  for (const list of buildCatalog().setsBySeries.values()) all.push(...list);
  return sortSets(all, direction);
}

function canonSeries(language, seriesId) {
  return SERIES_CANON[`${language}:${seriesId}`] || SERIES_UNKNOWN;
}

/**
 * 建索引。只跑一次，之後都從 Map 取。
 * 結構：
 *   series: [{ id, zh, en, order, setCount, cardCount, languages:Set }]
 *   setsBySeries: Map<seriesCanonId, Array<setInfo>>
 *   cardsBySetKey: Map<`${lang}:${setId}`, Array<card>>
 */
export function buildCatalog() {
  if (catalog) return catalog;
  const cards = getAllCards();
  const setsMeta = getAllSetsMeta();

  const cardsBySetKey = new Map();
  for (const card of cards) {
    const key = `${card.language}:${card.setId}`;
    if (!cardsBySetKey.has(key)) cardsBySetKey.set(key, []);
    cardsBySetKey.get(key).push(card);
  }

  const setsBySeries = new Map();
  const seriesAgg = new Map();
  for (const [key, meta] of Object.entries(setsMeta)) {
    const cardsInSet = cardsBySetKey.get(key) || [];
    if (cardsInSet.length === 0) continue; // 沒有任何卡片的卡包不列出來
    const canon = canonSeries(meta.language, meta.seriesId);
    const info = {
      setKey: key,
      setId: meta.setId,
      setName: meta.setName,
      language: meta.language,
      seriesId: meta.seriesId,
      seriesName: meta.seriesName,
      canonSeriesId: canon,
      releaseDate: meta.releaseDate || "",
      printedTotal: meta.printedTotal,
      cardCount: cardsInSet.length
    };
    if (!setsBySeries.has(canon)) setsBySeries.set(canon, []);
    setsBySeries.get(canon).push(info);

    if (!seriesAgg.has(canon)) {
      seriesAgg.set(canon, { id: canon, setCount: 0, cardCount: 0, languages: new Set() });
    }
    const agg = seriesAgg.get(canon);
    agg.setCount += 1;
    agg.cardCount += cardsInSet.length;
    agg.languages.add(meta.language);
  }

  for (const list of setsBySeries.values()) {
    sortSets(list, currentSetSort);
  }

  const series = Array.from(seriesAgg.values())
    .map((s) => ({ ...s, ...(SERIES_DISPLAY[s.id] || SERIES_DISPLAY.UNKNOWN) }))
    .sort((a, b) => a.order - b.order);

  catalog = { series, setsBySeries, cardsBySetKey };
  return catalog;
}

export function invalidateCatalog() {
  catalog = null;
}

export function getSeriesList() {
  return buildCatalog().series;
}

export function getSetsOfSeries(seriesCanonId) {
  return buildCatalog().setsBySeries.get(seriesCanonId) || [];
}

export function getCardsOfSet(setKey) {
  return buildCatalog().cardsBySetKey.get(setKey) || [];
}

export function getSeriesDisplay(id) {
  const d = SERIES_DISPLAY[id] || SERIES_DISPLAY.UNKNOWN;
  const shown = appLabel(d.zh);
  return shown === d.zh ? d : { ...d, zh: shown };
}

/** 這張卡目前歸在哪個大系列（含手動指定）。 */
export function seriesOfCard(card) {
  if (card.seriesOverrideId) return card.seriesOverrideId;
  return canonSeries(card.language, card.seriesId);
}

/** 資料中實際出現過的規則標記，依字母排序。 */
export function getAllMarks() {
  const set = new Set();
  for (const v of Object.values(regulationMarks || {})) if (v) set.add(v);
  return Array.from(set).sort();
}
