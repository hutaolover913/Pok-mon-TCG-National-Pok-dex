// 「App 收藏分類」定義 —— 圖鑑頁徽章與「設定 > 分類對照」用的那一套。
//
// 每個分類保存自己的「原始稀有度」清單 (rarities)，用來把卡片的 originalRarity
// 對應到收藏分類。這份對照可在「設定」頁調整，調整結果存進 IndexedDB，
// 不會影響卡片本身保存的原始稀有度字串。
//
// 重要：這份清單是從 js/cardCategories.js 那份「分語言、已核對」的規則推導
// 出來的，兩邊同源，不會出現「分類頁說 SR、圖鑑徽章說 UR」的矛盾。
//
// 但這份清單有一個先天限制：它**不分語言**，只能用一個稀有度字串對應一個分類。
// 有三個字串在日文卡與英文卡代表不同等級：
//
//   "Holo Rare"    日版＝SR 密卡區塊       英文＝卡包內一般閃卡（普通卡）
//   "Hyper rare"   日版＝HR 彩虹卡         英文＝UR 金卡
//   "Secret Rare"  日版＝UR 金卡           英文＝彩虹／金卡混用，無法確認
//
// 這裡一律採用日版的意思（AR／SR／UR 這套代碼本來就是日版的），因此英文卡的
// 徽章在這三個字串上會不夠精確。要看分語言的精確分類，請用「卡片分類」頁，
// 那一頁走的是 js/cardCategories.js 的完整規則。
import { CARD_CATEGORY_DEFS } from "./cardCategories.js";

// 對照表改版時要跟著 +1。db.js 的 ensureSeeded() 看到版本變了，就會把內建分類的
// rarities 重設成下面的新預設值（使用者自己新增的自訂分類不動）。
// v2：修正「Ultra Rare」原本被錯誤歸到 UR 的問題 —— 實際核對日版 S10P #068
// スピアーV 的卡面印的是 SR，日版 UR 對應到的是 Secret Rare / Mega Hyper Rare。
// 同時新增 HR（彩虹卡）與「待確認」兩個分類。
export const BUILTIN_RARITY_MAPPING_VERSION = 5;

// 分類 -> 涵蓋的原始稀有度字串（採用資料庫裡實際出現的大小寫寫法）。
// 來源：data/cards.json 裡所有出現過的 originalRarity，逐一人工核對，
// 核對方式與證據見 js/cardCategories.js 的 RARITY_RULES。
const RARITIES_BY_CATEGORY = {
  AR: ["Illustration rare", "Illustration Rare"],
  SR: ["Ultra Rare", "Rare Ultra", "Holo Rare"],
  SAR: ["Special illustration rare", "Special Illustration Rare"],
  CSR: ["Character Super Rare", "Character super rare"],
  CHR: ["Character Rare", "Character rare"],
  HR: ["Hyper rare", "Hyper Rare"],
  UR: ["Secret Rare", "Rare Secret", "Mega Hyper Rare"],
  PROMO: ["Promo"],
  NORMAL: [
    "Common", "Uncommon", "Rare", "Rare Holo",
    "Double rare", "Double Rare", "Triple Rare",
    "Holo Rare V", "Holo Rare VMAX", "Holo Rare VSTAR",
    "Rare Holo V", "Rare Holo VMAX", "Rare Holo VSTAR"
  ],
  OTHER: [
    "Radiant Rare", "Amazing Rare", "ACE SPEC Rare", "Black White Rare",
    "Shiny rare", "Shiny rare V", "Shiny rare VMAX", "Shiny holo rare",
    "Shiny Ultra Rare", "Full Art Trainer", "Classic Collection",
    "Rare Rainbow", "Rare Shining", "Gold Secret Rare"
  ],
  UNVERIFIED: []
};

export const DEFAULT_CATEGORIES = CARD_CATEGORY_DEFS.map((def) => ({
  id: def.id,
  label: def.label,
  order: def.order,
  color: def.color,
  builtin: true,
  description: def.description,
  rarities: RARITIES_BY_CATEGORY[def.id] || []
}));

// 已知的「額外標籤」(非互斥，可多選，與稀有度分開保存)
// 卡片的 tags 欄位會直接沿用來源資料的 stage/suffix（例如 ex／V／VMAX／VSTAR／MEGA），
// 這裡僅作為 UI 篩選清單參考。ex／V／VMAX／VSTAR 是卡片機制，不是稀有度，
// 所以一律放在 tags，不會進入上面的稀有度分類。
export const KNOWN_TAGS = [
  "ex", "EX", "GX", "V", "VMAX", "VSTAR", "MEGA", "Tera", "Star",
  "BREAK", "Prime", "LEGEND", "Radiant", "Restored",
  "Fusion Strike", "Single Strike", "Rapid Strike"
];
