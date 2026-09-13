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

export async function loadRegulationMarks() {
  if (regulationMarks) return regulationMarks;
  try {
    const res = await fetch("data/regulation_marks.json");
    if (!res.ok) throw new Error(String(res.status));
    const doc = await res.json();
    regulationMarks = doc.marks || {};
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
  if (info.status === MARK_STATUS.MARKED) return info.mark + (info.manual ? "（手動指定）" : "");
  if (info.status === MARK_STATUS.NONE) return "無標記";
  return "待確認";
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
    // 新的排前面，同日期再依卡包代碼
    list.sort((a, b) => (b.releaseDate || "").localeCompare(a.releaseDate || "") || a.setId.localeCompare(b.setId));
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
  return SERIES_DISPLAY[id] || SERIES_DISPLAY.UNKNOWN;
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
