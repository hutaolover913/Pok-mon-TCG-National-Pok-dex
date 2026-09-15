import { label } from "./appLabels.js";

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
// "mechanic"   ：英文卡卡面不印日版代碼，改用卡片機制對應日版同一批次的版面
//                （例如英文 Holo Rare VMAX 的 VMAX，對應日版 VMAX 一般版面的
//                Triple rare，卡面印 RRR）。比 tier 強，因為機制印在卡面上。
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
    description: "卡包內的一般稀有度階梯：C（Common）／U（Uncommon）／R（Rare）與一般閃卡。RR 與 RRR 已各自獨立成分類，不再含在這裡。不含特殊美術卡與密卡。"
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
    id: "RR", label: "RR", order: 12, color: "#5bc0be",
    description: "雙稀有（ダブルレア）。日版卡面右下角印 RR，對應來源稀有度 Double rare。"
      + "機制上是一般版面的 V 與 ex。英文卡不印這個代碼，依同一批次的機制對應（Double Rare＝ex、Holo Rare V＝V）。"
  },
  {
    id: "RRR", label: "RRR", order: 13, color: "#3aa8a4",
    description: "三稀有（トリプルレア）。日版卡面右下角印 RRR，對應來源稀有度 Triple rare。"
      + "機制上是一般版面的 VMAX、VSTAR 與 V-UNION。英文卡不印這個代碼，依機制對應（Holo Rare VMAX／VSTAR）。"
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
  },

  // ---------------------------------------------------------------------
  // 機制分類。與稀有度並存，不互斥。
  //
  // 這兩個跟上面所有分類的性質不同：它們判斷的是**卡片機制**（卡名結尾），
  // 不是稀有度。一張 TAG TEAM GX 同時會有自己的稀有度分類（例如 SR），
  // 兩邊都會出現 —— 就像宣傳卡同時屬於 PR／PROMO 與它的稀有度分類一樣。
  //
  // 日月世代才有這兩種卡，劍盾之後就沒有了。
  // ---------------------------------------------------------------------
  {
    id: "GX", label: "GX", order: 21, color: "#4dc4d6",
    description: "GX 卡（日月世代）。依卡名結尾判定，與稀有度分類並存。"
      + "TAG TEAM GX 同時屬於這一類與「TAG TEAM」。"
  },
  {
    id: "TAG_TEAM", label: "TAG TEAM", order: 22, color: "#d67c4d",
    description: "雙人組 GX（TAG TEAM GX，日月世代）。依卡名「含 & 且以 GX 結尾」判定，"
      + "與稀有度分類並存，同時也會出現在「GX」分類。"
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
    "double rare": { category: "RR", confidence: "printed", note: "卡面 RR（劍盾 S10P #001 スピアーV、朱紫 SV8a #003 リーフィアex 兩個世代都實際核對）" },
    "triple rare": { category: "RRR", confidence: "printed", note: "卡面 RRR（劍盾 S10P #015 ヒードランVMAX、S12a #012 リーフィアVSTAR 實際核對）" },
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
    "promo": { category: "PROMO", confidence: "printed", note: "宣傳卡" },

    // ---- 日月及更早世代（來自 step18 補進來的 27,798 張）----
    // 這些字串在劍盾之後就不再出現。目前沒有逐張核對過那些世代的卡面代碼，
    // 所以一律歸「其他」而不是猜一個等級 —— 依使用者指示，對不上的先放其他。
    "rare holo": { category: "OTHER", confidence: "unresolved", note: "日月及更早世代的用語，尚未逐張核對卡面代碼" },
    "none": { category: "OTHER", confidence: "unresolved", note: "來源把空值序列化成字串 \"None\"，不是真的稀有度" },
    "無稀有度標記（卡面核對）": { category: "OTHER", confidence: "printed", note: "實際核對過卡面，該卡沒有印稀有度代碼" }
  },
  en: {
    "common": { category: "NORMAL", confidence: "tier", note: "英文版一般度數" },
    "uncommon": { category: "NORMAL", confidence: "tier", note: "英文版一般度數" },
    "rare": { category: "NORMAL", confidence: "tier", note: "713 張編號都在卡包總數內" },
    "holo rare": { category: "NORMAL", confidence: "tier", note: "265 張編號都在卡包總數內，屬一般閃卡" },
    "double rare": { category: "RR", confidence: "mechanic", note: "317 張全部是 ex 卡；日版的 ex 一般版面來源稀有度同樣是 Double rare，卡面印 RR" },
    "triple rare": { category: "RRR", confidence: "tier", note: "目前英文卡資料裡沒有出現過這個字串，沒有實例可核對；先比照日版 Triple rare ＝ RRR" },
    // 這三個是「卡包內的一般 V／VMAX／VSTAR」，不是全圖卡。
    // 內部對照可以直接證明：swsh1 #9 Dhelmise V 是 Holo Rare V（一般版面、編號在
    // 202 以內），同一隻的 swsh1 #187 Dhelmise V 才是 Ultra Rare（全圖）。
    // 這三個字串合計 361 張，編號 100% 都在卡包總數以內。
    "holo rare v": { category: "RR", confidence: "mechanic", note: "237 張全部是 V 卡；日版 V 的一般版面是 Double rare，卡面印 RR" },
    "holo rare vmax": { category: "RRR", confidence: "mechanic", note: "日版 VMAX 的一般版面是 Triple rare，卡面印 RRR（S10P #015 核對）。來源有 5 張這個字串其實不是 VMAX，已逐張看卡面另外處理" },
    "holo rare vstar": { category: "RRR", confidence: "mechanic", note: "日版 VSTAR 的一般版面是 Triple rare，卡面印 RRR（S12a #012 核對）" },
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
    "promo": { category: "PROMO", confidence: "tier", note: "宣傳卡" },

    // ---- 日月及更早世代（來自 step18 補進來的 27,798 張）----
    // 同上：沒有逐張核對過那些世代的卡面，一律歸「其他」，不猜等級。
    "rare holo": { category: "OTHER", confidence: "unresolved", note: "日月及更早世代的用語，尚未逐張核對" },
    "rare holo lv.x": { category: "OTHER", confidence: "unresolved", note: "鑽石珍珠世代的 LV.X 卡，尚未核對" },
    "rare prime": { category: "OTHER", confidence: "unresolved", note: "HGSS 世代的 Prime 卡，尚未核對" },
    "legend": { category: "OTHER", confidence: "unresolved", note: "HGSS 世代的 LEGEND 卡（上下兩張組成一張），尚未核對" },
    "none": { category: "OTHER", confidence: "unresolved", note: "來源把空值序列化成字串 \"None\"，不是真的稀有度" }
  }
};

// 宣傳卡卡包（`${language}:${setId}`）。這份清單是掃 sets.json 裡卡包名稱含
// "Promo"／"プロモ" 的項目得到的，共 1,042 張卡；其中 1,040 張稀有度就是
// Promo，另外 2 張帶有其他稀有度，那 2 張會同時出現在 PROMO 與它的稀有度分類。
export const PROMO_SET_KEYS = new Set([
  "en:swshp", "en:svp", "en:mep", "ja:SV-P", "ja:M-P"
]);

// 來源稀有度字串與實際卡片對不上的個案。
//
// 只放「實際打開高解析卡圖、看過卡面本身」才確定的個案，而且逐張列出證據。
// 這裡刻意不做任何規則化推論（例如「卡名結尾不是 VMAX 就自動降級」），
// 因為卡名本身也可能是來源缺字；有疑義的一律留在對照表的結果，不塞進這裡。
//
// 目前全部 5 張，都是 TCGdex 把 "Holo Rare VMAX" 掛在不是 VMAX 的卡上：
export const CARD_RARITY_EXCEPTIONS = {
  "tcgdex:en:swsh1-34": {
    category: "NORMAL", confidence: "printed",
    note: "卡面是 STAGE 2「Cinderace」HP170，不是 VMAX；來源稀有度 Holo Rare VMAX 有誤，實際是卡包內一般閃卡"
  },
  "tcgdex:en:swsh1-35": {
    category: "NORMAL", confidence: "printed",
    note: "卡面是 STAGE 2「Cinderace」HP170，不是 VMAX；來源稀有度 Holo Rare VMAX 有誤，實際是卡包內一般閃卡"
  },
  "tcgdex:en:swsh10.5-031": {
    category: "RRR", confidence: "printed",
    note: "卡面是「Mewtwo VSTAR」HP280；來源稀有度寫成 Holo Rare VMAX，但 VSTAR 與 VMAX 同屬 RRR，結果相同"
  },
  "tcgdex:en:swsh11-056": {
    category: "RR", confidence: "printed",
    note: "卡面是 BASIC「Magnezone V」HP210，不是 VMAX；V 卡屬 RR，不是 RRR"
  },
  "tcgdex:en:swsh11-058": {
    category: "RR", confidence: "printed",
    note: "卡面是 BASIC「Rotom V」HP190，不是 VMAX；V 卡屬 RR，不是 RRR"
  }
};

function ruleFor(card) {
  const exception = CARD_RARITY_EXCEPTIONS[card.id];
  if (exception) return exception;
  const table = RARITY_RULES[card.language];
  if (!table) return null;
  const key = (card.originalRarity || "").trim().toLowerCase();
  if (!key) return null;
  return table[key] || null;
}

// 對照表認不出來時歸到哪一類。
//
// 原本是 UNVERIFIED（待確認）。補進日月／XY／BW 等世代之後，光是「來源根本
// 沒給稀有度」的日版卡就有 6,246 張，全部堆在待確認會讓那一類變成垃圾桶。
// 依使用者指示改成「其他」—— 這與更早的「無法確認就放待確認」相反，是刻意的
// 決定，不是疏忽。
//
// 「待確認」分類保留著，仍然可以手動指定過去，只是不再是自動歸屬的預設。
const UNMATCHED_CATEGORY = "OTHER";

/** 這張卡的「稀有度分類」（單一），不含宣傳卡與機制身分。 */
export function rarityCategoryId(card) {
  const rule = ruleFor(card);
  return rule ? rule.category : UNMATCHED_CATEGORY;
}

/** 分類理由，UI 與報告用。 */
export function rarityRuleInfo(card) {
  const rule = ruleFor(card);
  if (rule) return rule;
  const hasRarity = !!(card.originalRarity || "").trim();
  return {
    category: UNMATCHED_CATEGORY,
    confidence: "unresolved",
    note: hasRarity
      ? `對照表沒有「${card.originalRarity}」這個稀有度（${card.language}），尚未核對等級`
      : "來源資料沒有提供稀有度"
  };
}

/**
 * 這張卡的機制分類（可複數）。與稀有度並存，不互斥。
 *
 * 判斷依據是 tags 欄位（由 step19 依卡名結尾產生），不是稀有度字串 ——
 * 日月世代的 GX 卡稀有度字串跟一般卡一樣是 Ultra Rare／Secret Rare，
 * 從稀有度看不出它是不是 GX。
 */
export function mechanicCategoryIds(card) {
  const tags = card.tags || [];
  const ids = [];
  if (tags.includes("GX")) ids.push("GX");
  if (tags.includes("TAG TEAM")) ids.push("TAG_TEAM");
  return ids;
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
  // 機制分類與稀有度並存，做法同宣傳卡
  ids.push(...mechanicCategoryIds(card));
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
  // 機制身分同理：手動改稀有度分類不會讓一張 GX 卡不再是 GX
  ids.push(...mechanicCategoryIds(card));
  return Array.from(new Set(ids));
}

/** 最終的「稀有度分類」（不含 PROMO 身分），匯出的「最終分類」欄位用這個。 */
export function resolveRarityCategoryId(card, overrideCategoryId) {
  if (overrideCategoryId) return overrideCategoryId;
  return rarityCategoryId(card);
}

export function getCategoryDef(id) {
  const def = CARD_CATEGORY_DEFS.find((c) => c.id === id) || null;
  if (!def) return null;
  // App 版把「待確認」這類整理用語換成收藏者看得懂的說法。
  // 只換顯示文字：id、涵蓋的卡片、資料庫內容全部不動。
  // 網頁版的 label() 是原樣回傳，所以這裡對網頁版沒有任何影響。
  const shown = label(def.label);
  return shown === def.label ? def : { ...def, label: shown };
}

export const CONFIDENCE_LABEL = {
  printed: "已核對卡面印刷代碼",
  structural: "依卡包編號位置推定",
  mechanic: "依卡片機制對應日版同批次",
  tier: "依英文版等級名稱對應",
  unresolved: "無法確認"
};
