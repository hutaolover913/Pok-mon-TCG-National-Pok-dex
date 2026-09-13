// ============================================================================
// 卡片分類規則（集中管理）
//
// 這個檔案是「原始稀有度 -> App 分類」對照的唯一來源。要新增分類或修正對照，
// 只改這裡；卡片分類頁、圖鑑徽章、設定頁的預設值都從這份定義推導出來。
//
// -- 為什麼要分語言 --------------------------------------------------------
// TCGdex 的 rarity 欄位是它自己的一套英文正規化用語，同一個字串在日文卡與
// 英文卡上不一定代表同一個等級，不能只看字面就對應到日版的 AR／SR／UR。
// 下面這幾個反例都是實際打開本機卡圖、讀卡面右下角印刷代碼確認的：
//
//   TCGdex "Ultra Rare"       日版 S10P #068 スピアーV            卡面印 "SR"
//   TCGdex "Mega Hyper Rare"  日版 S10P #086 オリジンパルキアVSTAR  卡面印 "UR"
//   TCGdex "Hyper rare"       日版 S8   #116 シャンデラVMAX        卡面印 "HR"
//   TCGdex "Secret Rare"      日版 S8   #125 モココ               卡面印 "UR"
//
// 也就是說，把 "Ultra Rare" 直接當成日版 UR 是錯的 —— 它其實是日版 SR；
// 日版 UR 對應到的是 "Secret Rare" 與 "Mega Hyper Rare"。而且日文與英文的
// "Secret Rare" / "Hyper rare" 指涉的等級剛好相反（英文 Secret Rare 抽驗
// 到的是彩虹卡，日文 Secret Rare 印的是 UR 金卡），所以對照表一定要分語言。
//
// -- confidence 欄位 --------------------------------------------------------
// "printed"    ：實際看過卡面右下角印的稀有度代碼，最可信。
// "structural" ：卡圖解析度讀不出代碼，改用卡包編號位置推定
//                （例如同一個密卡區塊裡、前後卡號已確認是 SR）。
// "tier"       ：英文卡卡面不印日版代碼，依英文版自己的等級名稱對應到同一個
//                實體等級（例如英文 Ultra Rare = 全圖 V／ex，等同日版 SR）。
// "unresolved" ：無法確認，一律進「待確認」，不猜。
// 只要 confidence 不是 "printed"，分類頁與報告都會標示出來。
// ============================================================================

export const CARD_CATEGORY_DEFS = [
  {
    id: "AR", label: "AR", order: 1, color: "#4f8cff",
    description: "特殊插畫稀有卡（アートレア／Illustration Rare）。卡面代碼 AR。"
  },
  {
    id: "SR", label: "SR", order: 2, color: "#ffb020",
    description: "超級稀有卡（スーパーレア）。多為全圖 V／VMAX／VSTAR／ex。卡面代碼 SR。"
  },
  {
    id: "SAR", label: "SAR", order: 3, color: "#ff7a45",
    description: "特殊美術稀有卡（スペシャルアートレア）。卡面代碼 SAR。"
  },
  {
    id: "CSR", label: "CSR", order: 4, color: "#c14fd6",
    description: "角色超級稀有卡（キャラクタースーパーレア）。卡面代碼 CSR，目前僅見於日版。"
  },
  {
    id: "CHR", label: "CHR", order: 5, color: "#e06fae",
    description: "角色稀有卡（キャラクターレア）。卡面代碼 CHR，目前僅見於日版。"
  },
  {
    id: "HR", label: "HR", order: 6, color: "#7bd3ff",
    description: "超極稀有卡（ハイパーレア），彩虹卡。卡面代碼 HR。與 UR（金卡）是不同等級，所以獨立成一類。"
  },
  {
    id: "UR", label: "UR", order: 7, color: "#f2c94c",
    description: "究極稀有卡（ウルトラレア），金卡。卡面代碼 UR。注意：英文的 Ultra Rare 不是這一類，那是 SR。"
  },
  {
    id: "PROMO", label: "PR／PROMO", order: 8, color: "#33c37c",
    description: "宣傳卡。依宣傳卡卡包或 Promo 稀有度判定。宣傳卡身分與稀有度並存，帶稀有度的宣傳卡會同時出現在這裡與它的稀有度分類。"
  },
  {
    id: "NORMAL", label: "普通卡", order: 9, color: "#8a93a6",
    description: "卡包內的一般稀有度階梯：C／U／R／RR（Double rare）／RRR（Triple Rare）。不含特殊美術卡與密卡。"
  },
  {
    id: "OTHER", label: "其他", order: 10, color: "#6b7280",
    description: "有明確稀有度、但不屬於上列任何一類的特殊系列：かがやく（K）、ACE SPEC、BWR、閃亮系列、Amazing Rare、Trainer Gallery 等。"
  },
  {
    id: "UNVERIFIED", label: "待確認", order: 11, color: "#b06a3b",
    description: "來源沒有提供稀有度，或該稀有度字串在這個語言下無法確認對應哪一個等級。刻意不猜，也不併入普通卡。"
  },

  // ---------------------------------------------------------------------
  // 以下是「只能手動加入」的分類。
  //
  // 它們刻意**沒有任何自動對照規則**（下面的 RARITY_RULES 裡完全找不到它們），
  // 所以 classifyCard() 永遠不會把卡片放進來，即使某張卡的原始稀有度字面上
  // 看起來很像。要有卡片，只能靠使用者單張指定或批量移動。
  //
  // 這是刻意的設計：像「光輝」與「閃光」這種中文分類，沒辦法從 TCGdex 的英文
  // 稀有度字串可靠地推斷，硬猜只會把卡片分錯。寧可讓使用者自己決定。
  // ---------------------------------------------------------------------
  {
    id: "RR", label: "RR", order: 12, color: "#5bc0be", manualOnly: true,
    description: "雙稀有（ダブルレア）。只能手動加入，系統不會自動放卡片進來。"
  },
  {
    id: "RRR", label: "RRR", order: 13, color: "#3aa8a4", manualOnly: true,
    description: "三稀有（トリプルレア）。只能手動加入，系統不會自動放卡片進來。"
  },
  {
    id: "RADIANT_ZH", label: "光輝", order: 14, color: "#f7b955", manualOnly: true,
    description: "光輝。只能手動加入；與「閃光」是各自獨立的分類，系統不會替你推測歸屬。"
  },
  {
    id: "ACE", label: "ACE", order: 15, color: "#e05c7e", manualOnly: true,
    description: "ACE SPEC。只能手動加入，系統不會自動放卡片進來。"
  },
  {
    id: "SSR", label: "SSR", order: 16, color: "#9b6bff", manualOnly: true,
    description: "SSR。只能手動加入，系統不會自動放卡片進來。"
  },
  {
    id: "BWR", label: "BWR", order: 17, color: "#576574", manualOnly: true,
    description: "黑白稀有（Black White Rare）。只能手動加入，系統不會自動放卡片進來。"
  },
  {
    id: "MUR", label: "MUR", order: 18, color: "#d4a017", manualOnly: true,
    description: "MUR。只能手動加入，系統不會自動放卡片進來。"
  },
  {
    id: "MA", label: "MA", order: 19, color: "#6c9a3f", manualOnly: true,
    description: "MA。只能手動加入，系統不會自動放卡片進來。"
  },
  {
    id: "SHINY_ZH", label: "閃光", order: 20, color: "#59c3f0", manualOnly: true,
    description: "閃光。只能手動加入；與「光輝」是各自獨立的分類，系統不會替你推測歸屬。"
  }
];

/** 只能手動加入、沒有自動對照規則的分類 id。 */
export const MANUAL_ONLY_CATEGORY_IDS = new Set(
  CARD_CATEGORY_DEFS.filter((d) => d.manualOnly).map((d) => d.id)
);

// rarity 字串（小寫）-> { category, confidence, note }
// 用小寫比對，因為 TCGdex 同時出現過 "Hyper rare" 與 "Hyper Rare" 這種寫法。
export const RARITY_RULES = {
  ja: {
    "common": { category: "NORMAL", confidence: "printed", note: "卡面 C" },
    "uncommon": { category: "NORMAL", confidence: "printed", note: "卡面 U" },
    "rare": { category: "NORMAL", confidence: "printed", note: "卡面 R（S10P #010 實際核對）" },
    "double rare": { category: "NORMAL", confidence: "printed", note: "卡面 RR（S10P #001 實際核對）" },
    "triple rare": { category: "NORMAL", confidence: "printed", note: "卡面 RRR（S10P #015 實際核對）" },
    "illustration rare": { category: "AR", confidence: "printed", note: "卡面 AR（S12a #173 實際核對）" },
    "special illustration rare": { category: "SAR", confidence: "printed", note: "卡面 SAR（S12a #210 實際核對）" },
    "character rare": { category: "CHR", confidence: "printed", note: "卡面 CHR（S11a #069 實際核對）" },
    "character super rare": { category: "CSR", confidence: "printed", note: "卡面 CSR（S11a #084 實際核對）" },
    "ultra rare": { category: "SR", confidence: "printed", note: "卡面 SR（S10P #068 實際核對）—— 不是日版 UR" },
    "holo rare": { category: "SR", confidence: "structural", note: "卡圖解析度讀不出代碼；27 張全部落在 S10P #068–085 這個已確認是 SR 的密卡區塊內" },
    "hyper rare": { category: "HR", confidence: "printed", note: "卡面 HR（S8 #116 實際核對）" },
    "secret rare": { category: "UR", confidence: "printed", note: "卡面 UR（S8 #125 實際核對）" },
    "mega hyper rare": { category: "UR", confidence: "printed", note: "卡面 UR（S10P #086 實際核對）" },
    "radiant rare": { category: "OTHER", confidence: "printed", note: "卡面 K（かがやくポケモン，S11a #009 實際核對）" },
    "ace spec rare": { category: "OTHER", confidence: "printed", note: "卡面 ACE（SV5K #062 實際核對）" },
    "black white rare": { category: "OTHER", confidence: "printed", note: "卡面 BWR（sv11B #174 實際核對）" },
    "promo": { category: "PROMO", confidence: "printed", note: "宣傳卡" }
  },
  en: {
    "common": { category: "NORMAL", confidence: "tier", note: "英文版一般度數" },
    "uncommon": { category: "NORMAL", confidence: "tier", note: "英文版一般度數" },
    "rare": { category: "NORMAL", confidence: "tier", note: "713 張編號都在卡包總數內" },
    "holo rare": { category: "NORMAL", confidence: "tier", note: "265 張編號都在卡包總數內，屬一般閃卡" },
    "double rare": { category: "NORMAL", confidence: "tier", note: "英文 Double Rare ＝ 日版 RR" },
    "triple rare": { category: "NORMAL", confidence: "tier", note: "英文 Triple Rare ＝ 日版 RRR" },
    // 這三個是「卡包內的一般 V／VMAX／VSTAR」，不是全圖卡。
    // 內部對照可以直接證明：swsh1 #9 Dhelmise V 是 Holo Rare V（一般版面、編號在
    // 202 以內），同一隻的 swsh1 #187 Dhelmise V 才是 Ultra Rare（全圖）。
    // 這三個字串合計 361 張，編號 100% 都在卡包總數以內。
    "holo rare v": { category: "NORMAL", confidence: "tier", note: "卡包內一般版面 V 卡（swsh1 #1 Celebi V 抽驗為一般版面），等同日版 RR" },
    "holo rare vmax": { category: "NORMAL", confidence: "tier", note: "卡包內一般版面卡（swsh1 #34 抽驗為一般版面），等同日版 RR" },
    "holo rare vstar": { category: "NORMAL", confidence: "tier", note: "卡包內一般版面 VSTAR（swsh9 #014 Shaymin VSTAR 抽驗為一般版面），等同日版 RR" },
    "illustration rare": { category: "AR", confidence: "tier", note: "Illustration Rare 就是 AR 這一階的英文名稱" },
    "special illustration rare": { category: "SAR", confidence: "tier", note: "Special Illustration Rare 就是 SAR 這一階的英文名稱" },
    "ultra rare": { category: "SR", confidence: "tier", note: "全圖 V／VMAX／ex 那一階（swsh1 #187–192 抽驗全是 full art V），等同日版 SR；刻意不對應成 UR" },
    "hyper rare": { category: "UR", confidence: "tier", note: "金卡（sv01 #253 Miraidon ex 抽驗為金卡），等同日版 UR；74 張全在密卡區" },
    "mega hyper rare": { category: "UR", confidence: "tier", note: "與日版同名等級一致，金卡" },
    "shiny rare": { category: "OTHER", confidence: "tier", note: "閃亮系列（Shiny Star V／Shining Fates），自成一階" },
    "shiny rare v": { category: "OTHER", confidence: "tier", note: "閃亮系列" },
    "shiny rare vmax": { category: "OTHER", confidence: "tier", note: "閃亮系列" },
    "shiny holo rare": { category: "OTHER", confidence: "tier", note: "閃亮系列" },
    "shiny ultra rare": { category: "OTHER", confidence: "tier", note: "閃亮系列的全圖卡（sv04.5 #212 抽驗為閃亮 full art ex）" },
    "radiant rare": { category: "OTHER", confidence: "tier", note: "Radiant Pokémon，等同日版 K" },
    "amazing rare": { category: "OTHER", confidence: "tier", note: "Amazing Rare，自成一階" },
    "ace spec rare": { category: "OTHER", confidence: "tier", note: "ACE SPEC" },
    "black white rare": { category: "OTHER", confidence: "tier", note: "Black White Rare" },
    "full art trainer": { category: "OTHER", confidence: "tier", note: "Trainer Gallery 全圖支援者卡" },
    "classic collection": { category: "OTHER", confidence: "tier", note: "Classic Collection 復刻卡" },
    "secret rare": {
      category: "UNVERIFIED", confidence: "unresolved",
      note: "英文 Secret Rare 同時涵蓋彩虹卡與金卡兩種等級（swsh1 #203 Lapras VMAX 抽驗為彩虹卡），光看字串無法判斷該歸 HR 還是 UR，因此不猜"
    },
    "promo": { category: "PROMO", confidence: "tier", note: "宣傳卡" }
  }
};

// 宣傳卡卡包（`${language}:${setId}`）。這份清單是掃 sets.json 裡卡包名稱含
// "Promo"／"プロモ" 的項目得到的，共 1,042 張卡；其中 1,040 張稀有度就是
// Promo，另外 2 張帶有其他稀有度，那 2 張會同時出現在 PROMO 與它的稀有度分類。
export const PROMO_SET_KEYS = new Set([
  "en:swshp", "en:svp", "en:mep", "ja:SV-P", "ja:M-P"
]);

function ruleFor(card) {
  const table = RARITY_RULES[card.language];
  if (!table) return null;
  const key = (card.originalRarity || "").trim().toLowerCase();
  if (!key) return null;
  return table[key] || null;
}

/** 這張卡的「稀有度分類」（單一），不含宣傳卡身分。對不到就是 UNVERIFIED。 */
export function rarityCategoryId(card) {
  const rule = ruleFor(card);
  return rule ? rule.category : "UNVERIFIED";
}

/** 分類理由，UI 與報告用。 */
export function rarityRuleInfo(card) {
  const rule = ruleFor(card);
  if (rule) return rule;
  const hasRarity = !!(card.originalRarity || "").trim();
  return {
    category: "UNVERIFIED",
    confidence: "unresolved",
    note: hasRarity
      ? `對照表沒有「${card.originalRarity}」這個稀有度（${card.language}），需要人工確認等級`
      : "來源資料沒有提供稀有度"
  };
}

export function isPromoCard(card) {
  return PROMO_SET_KEYS.has(`${card.language}:${card.setId}`)
    || (card.originalRarity || "").trim().toLowerCase() === "promo";
}

/**
 * 這張卡屬於哪些分類（可複數）。
 *
 * 宣傳卡身分與稀有度並存：帶稀有度的宣傳卡會同時出現在 PROMO 與該稀有度分類。
 * 這只是同一筆卡片資料被列進兩個清單，不會產生第二筆卡片或收藏紀錄；所有統計
 * 一律以不重複的卡片 id 計算，所以總數不會被重複加總。
 */
export function classifyCard(card) {
  const ids = [];
  const rarity = rarityCategoryId(card);
  if (rarity !== "PROMO") ids.push(rarity);
  if (isPromoCard(card) || rarity === "PROMO") ids.push("PROMO");
  return Array.from(new Set(ids));
}

/**
 * 套用使用者手動指定的分類，算出這張卡最終屬於哪些分類。
 *
 * 三層資料是分開的：originalRarity（來源，永不更動）、自動判定、手動覆寫。
 * 這裡只做「最終顯示／匯出要用哪一個」的決定：有手動就用手動，沒有就用自動。
 *
 * 宣傳卡標記是獨立於稀有度的身分，所以**手動改稀有度分類不會弄掉 PROMO**。
 * 反過來，如果使用者手動把一張卡指定成 PR／PROMO，那它就只在 PROMO 這一類。
 *
 * @param {object} card
 * @param {string|null} overrideCategoryId 使用者指定的分類；null 代表沿用自動
 */
export function resolveCategoryIds(card, overrideCategoryId) {
  if (!overrideCategoryId) return classifyCard(card);

  if (overrideCategoryId === "PROMO") return ["PROMO"];

  const ids = [overrideCategoryId];
  // 原本就是宣傳卡的話，改了稀有度分類仍然保留宣傳卡身分
  if (isPromoCard(card)) ids.push("PROMO");
  return Array.from(new Set(ids));
}

/** 最終的「稀有度分類」（不含 PROMO 身分），匯出的「最終分類」欄位用這個。 */
export function resolveRarityCategoryId(card, overrideCategoryId) {
  if (overrideCategoryId) return overrideCategoryId;
  return rarityCategoryId(card);
}

export function getCategoryDef(id) {
  return CARD_CATEGORY_DEFS.find((c) => c.id === id) || null;
}

export const CONFIDENCE_LABEL = {
  printed: "已核對卡面印刷代碼",
  structural: "依卡包編號位置推定",
  tier: "依英文版等級名稱對應",
  unresolved: "無法確認"
};
