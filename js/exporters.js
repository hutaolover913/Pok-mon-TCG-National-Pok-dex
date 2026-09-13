// 卡表匯出：產生真正的 .xlsx（OOXML）與 .docx（OOXML），不是把 CSV／HTML
// 改副檔名假裝。
//   Excel：用 SheetJS（vendor/xlsx.full.min.js）
//   Word ：用 JSZip（vendor/jszip.min.js）自己組 WordprocessingML
// 兩個函式庫都放在專案內的 vendor/，不依賴 CDN，離線也能用。
import { CARD_CATEGORY_DEFS } from "./cardCategories.js";

const VENDOR = {
  xlsx: { url: "vendor/xlsx.full.min.js", global: "XLSX" },
  jszip: { url: "vendor/jszip.min.js", global: "JSZip" }
};

const loaded = {};

/** 需要時才載入函式庫（xlsx 有 880KB，不要每次開 App 都拖著跑）。 */
function loadVendor(name) {
  const spec = VENDOR[name];
  if (window[spec.global]) return Promise.resolve(window[spec.global]);
  if (loaded[name]) return loaded[name];
  loaded[name] = new Promise((resolve, reject) => {
    const el = document.createElement("script");
    el.src = spec.url;
    el.onload = () => {
      if (window[spec.global]) resolve(window[spec.global]);
      else reject(new Error(`${spec.url} 載入了但找不到 ${spec.global}`));
    };
    el.onerror = () => reject(new Error(`載入 ${spec.url} 失敗，請確認 vendor/ 資料夾存在`));
    document.head.appendChild(el);
  });
  return loaded[name];
}

function labelOf(id) {
  const d = CARD_CATEGORY_DEFS.find((c) => c.id === id);
  return d ? d.label : id;
}

/**
 * Excel 工作表名稱限制：最多 31 字，不能含 : \ / ? * [ ]，不能空白。
 * 「PR／PROMO」裡的全形斜線其實是合法的，但為了跟使用者說的 PR_PROMO 一致、
 * 也避免在某些版本的 Excel 出狀況，統一把斜線類字元換成底線。
 */
export function safeSheetName(name, used) {
  let s = String(name || "").replace(/[:\\/?*[\]／]/g, "_").trim();
  if (!s) s = "Sheet";
  s = s.slice(0, 31);
  let candidate = s;
  let i = 2;
  while (used.has(candidate)) {
    const suffix = `_${i++}`;
    candidate = s.slice(0, 31 - suffix.length) + suffix;
  }
  used.add(candidate);
  return candidate;
}

// 逐張卡片的明細欄位。每個「不同卡片版本」各佔一列（穩定卡片 ID 唯一），
// 同版本收了幾張用「持有張數」表示，不重複建列。
//
// 刻意沒有的欄位：實體卡冊名稱／頁碼／格位。App 裡根本沒有這些資料，
// 憑空補上只會變成編造，所以寧可不做這幾欄，也在統計總覽裡講明。
const COLUMNS = [
  { key: "cardId", header: "穩定卡片 ID", width: 26, text: true },
  { key: "dex", header: "全國圖鑑編號", width: 13, text: true },
  { key: "speciesName", header: "寶可夢名稱", width: 14 },
  { key: "cardName", header: "卡片名稱", width: 26 },
  { key: "categories", header: "目前所在分類", width: 18 },
  { key: "originalRarity", header: "來源原始稀有度", width: 22 },
  { key: "source", header: "分類依據", width: 12 },
  { key: "language", header: "語言／發行地區", width: 15 },
  { key: "seriesName", header: "所屬大系列", width: 22 },
  { key: "setName", header: "卡包／擴充包名稱", width: 26 },
  { key: "setId", header: "卡包代碼", width: 12, text: true },
  { key: "seriesId", header: "系列代碼", width: 10, text: true },
  { key: "cardNumber", header: "完整卡號", width: 13, text: true },
  { key: "variantMarks", header: "版本／特殊標記", width: 16 },
  { key: "tags", header: "卡片標籤", width: 16 },
  { key: "illustrator", header: "繪師", width: 18 },
  { key: "releaseDate", header: "發售日期", width: 13, text: true },
  { key: "ownedLabel", header: "已收藏／未收藏", width: 14 },
  { key: "count", header: "持有張數", width: 10 },
  { key: "note", header: "備註", width: 24 },
  { key: "sourceUrl", header: "卡片資料來源網址", width: 46, text: true },
  { key: "imageUrl", header: "圖片網址", width: 46, text: true }
];

/** 建一張逐卡明細工作表（全部明細與各分類明細共用同一套欄位）。 */
function buildDetailSheet(XLSX, rows) {
  const aoa = [COLUMNS.map((c) => c.header)];
  for (const r of rows) {
    aoa.push(COLUMNS.map((c) => (r[c.key] === undefined || r[c.key] === null ? "" : r[c.key])));
  }
  const sheet = XLSX.utils.aoa_to_sheet(aoa);

  // 標成 text 的欄位一律存成字串，否則 Excel 會把 "025/165" 當公式、
  // "0007" 掉前導零、"2022-04-08" 變成日期序號。
  COLUMNS.forEach((col, ci) => {
    if (!col.text) return;
    for (let row = 1; row < aoa.length; row++) {
      const addr = XLSX.utils.encode_cell({ c: ci, r: row });
      if (sheet[addr]) {
        sheet[addr].t = "s";
        sheet[addr].z = "@";
      }
    }
  });

  sheet["!cols"] = COLUMNS.map((c) => ({ wch: c.width }));
  sheet["!autofilter"] = {
    ref: XLSX.utils.encode_range({
      s: { c: 0, r: 0 },
      e: { c: COLUMNS.length - 1, r: Math.max(1, aoa.length - 1) }
    })
  };
  return sheet;
}

// ------------------------------------------------------------------ Excel

export async function exportXlsx(payload, fileName) {
  const XLSX = await loadVendor("xlsx");
  const wb = XLSX.utils.book_new();
  const used = new Set();
  const dataSheetNames = [];

  // --- 1. 全部明細：本次範圍內每個穩定卡片 ID 一列，不重複 ---
  const allName = safeSheetName("全部明細", used);
  XLSX.utils.book_append_sheet(wb, buildDetailSheet(XLSX, payload.allRows), allName);
  dataSheetNames.push(allName);

  // --- 2. 各分類明細：一樣是逐卡完整資料，不是只有數量 ---
  for (const g of payload.groups) {
    const name = safeSheetName(labelOf(g.categoryId), used);
    XLSX.utils.book_append_sheet(wb, buildDetailSheet(XLSX, g.rows), name);
    dataSheetNames.push(name);
  }

  // --- 3. 統計總覽：輔助用，不取代明細 ---
  const ov = [];
  ov.push(["寶可夢 PTCG 收藏 — 卡表匯出"]);
  ov.push([]);
  ov.push(["匯出時間", payload.exportedAt]);
  ov.push(["匯出條件", payload.conditionText]);
  ov.push([]);
  ov.push(["工作表", "說明"]);
  ov.push([allName, `本次範圍內全部 ${payload.allRows.length} 張不同卡片，每個穩定卡片 ID 一列；一張卡若屬於多個分類，分類欄會列出全部，不重複建列`]);
  ov.push(["各分類明細", `依所選分類各一張工作表，內容同樣是逐卡完整資料（共 ${payload.groups.length} 張）`]);
  ov.push([]);
  ov.push(["分類", "不重複卡片數", "已收藏卡片數", "持有總張數"]);
  for (const g of payload.groups) {
    ov.push([labelOf(g.categoryId), g.rows.length, g.ownedCount, g.totalCopies]);
  }
  ov.push([]);
  ov.push(["本次匯出不重複卡片總數", payload.distinctCount]);
  ov.push(["其中已收藏（不重複卡片）", payload.ownedDistinct]);
  ov.push(["持有總張數", payload.totalCopiesAll]);
  ov.push(["各分類相加", payload.sumOfGroups]);
  ov.push([
    "重複計算說明",
    "同一張卡若同時符合多個分類（例如帶稀有度的宣傳卡），會出現在多個分類工作表，"
      + "所以「各分類相加」會大於「不重複卡片總數」。全部明細與上面的不重複總數都已去除重複計算。"
  ]);
  ov.push([
    "沒有提供的欄位",
    "實體卡冊名稱／頁碼／格位：目前 App 沒有保存這類實體收納位置資料，所以不輸出這幾欄，也不會自行填造。"
  ]);
  ov.push([
    "版本／特殊標記說明",
    "這一欄只填資料已確認的內容（宣傳卡卡包、樣本資料）。異圖、閃卡、反閃、蓋章版等資訊"
      + "來源資料庫並未提供，因此留空而不是猜測。"
  ]);
  ov.push([
    "範圍聲明",
    "本表僅涵蓋本次匯出所選範圍內、且目前 App 資料庫已收錄的卡片，不是官方歷年完整卡表。"
  ]);
  const ws = XLSX.utils.aoa_to_sheet(ov);
  ws["!cols"] = [{ wch: 28 }, { wch: 60 }, { wch: 16 }, { wch: 14 }];
  XLSX.utils.book_append_sheet(wb, ws, safeSheetName("統計總覽", used));

  const out = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  // SheetJS 社群版不會把凍結窗格寫進檔案（實測產出的 sheet XML 裡沒有 <pane>），
  // 所以這裡把它產生的 xlsx 拆開，自己在每個明細工作表的 sheetView 裡補上
  // <pane>，再重新打包。這樣拿到的仍然是標準的 xlsx，Excel 開起來標題列會凍結。
  const finalBuf = await addFreezePanes(out, wb, dataSheetNames);
  downloadBlob(
    new Blob([finalBuf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    fileName
  );
}

const FREEZE_PANE =
  '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>'
  + '<selection pane="bottomLeft" activeCell="A2" sqref="A2"/>';

async function addFreezePanes(arrayBuffer, wb, dataSheetNames) {
  const JSZip = await loadVendor("jszip");
  const zip = await JSZip.loadAsync(arrayBuffer);
  // 工作表在 zip 內是 sheet1.xml、sheet2.xml…，順序與 wb.SheetNames 一致
  for (let i = 0; i < wb.SheetNames.length; i++) {
    if (!dataSheetNames.includes(wb.SheetNames[i])) continue; // 總覽不用凍結
    const path = `xl/worksheets/sheet${i + 1}.xml`;
    const file = zip.file(path);
    if (!file) continue;
    let xmlText = await file.async("string");
    if (xmlText.includes("<pane ")) continue;
    if (/<sheetView[^>]*\/>/.test(xmlText)) {
      xmlText = xmlText.replace(/<sheetView([^>]*)\/>/, `<sheetView$1>${FREEZE_PANE}</sheetView>`);
    } else if (xmlText.includes("<sheetView")) {
      xmlText = xmlText.replace(/(<sheetView[^>]*>)/, `$1${FREEZE_PANE}`);
    } else {
      xmlText = xmlText.replace(
        /(<worksheet[^>]*>)/,
        `$1<sheetViews><sheetView workbookViewId="0">${FREEZE_PANE}</sheetView></sheetViews>`
      );
    }
    zip.file(path, xmlText);
  }
  return zip.generateAsync({ type: "arraybuffer", compression: "DEFLATE" });
}

// ------------------------------------------------------------------ Word

const XML_ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" };
function xml(text) {
  return String(text === undefined || text === null ? "" : text).replace(/[&<>"']/g, (c) => XML_ESC[c]);
}

function para(text, { bold = false, size = 22, spacingAfter = 120, heading = null } = {}) {
  const style = heading ? `<w:pStyle w:val="${heading}"/>` : "";
  return `<w:p><w:pPr>${style}<w:spacing w:after="${spacingAfter}"/></w:pPr>`
    + `<w:r><w:rPr>${bold ? "<w:b/>" : ""}<w:sz w:val="${size}"/></w:rPr>`
    + `<w:t xml:space="preserve">${xml(text)}</w:t></w:r></w:p>`;
}

// Word 表格的欄寬用 twips（1/20 pt）。A4 直式扣掉左右邊界大約 9360 twips 可用，
// 六欄加起來刻意壓在這個數字以內，避免表格超出頁面。
const W_COLS = [
  { header: "卡片名稱", width: 2600 },
  { header: "卡包", width: 2300 },
  { header: "卡號", width: 1100 },
  { header: "語言", width: 1100 },
  { header: "收藏狀態", width: 1200 },
  { header: "張數", width: 900 }
];

function cell(text, { bold = false, width = 1200 } = {}) {
  return `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/></w:tcPr>`
    + `<w:p><w:pPr><w:spacing w:after="0"/></w:pPr>`
    + `<w:r><w:rPr>${bold ? "<w:b/>" : ""}<w:sz w:val="18"/></w:rPr>`
    + `<w:t xml:space="preserve">${xml(text)}</w:t></w:r></w:p></w:tc>`;
}

function table(rows) {
  const borders = `<w:tblBorders>
    ${["top", "left", "bottom", "right", "insideH", "insideV"]
      .map((s) => `<w:${s} w:val="single" w:sz="4" w:color="BFBFBF"/>`)
      .join("")}
  </w:tblBorders>`;
  const grid = `<w:tblGrid>${W_COLS.map((c) => `<w:gridCol w:w="${c.width}"/>`).join("")}</w:tblGrid>`;
  const header = `<w:tr><w:trPr><w:tblHeader/></w:trPr>`
    + W_COLS.map((c) => cell(c.header, { bold: true, width: c.width })).join("")
    + `</w:tr>`;
  const body = rows
    .map(
      (r) => `<w:tr>`
        + cell(r.cardName, { width: W_COLS[0].width })
        + cell(r.setName, { width: W_COLS[1].width })
        + cell(r.cardNumber, { width: W_COLS[2].width })
        + cell(r.language, { width: W_COLS[3].width })
        + cell(r.ownedLabel, { width: W_COLS[4].width })
        + cell(String(r.count), { width: W_COLS[5].width })
        + `</w:tr>`
    )
    .join("");
  return `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/>${borders}</w:tblPr>${grid}${header}${body}</w:tbl>`
    + `<w:p><w:pPr><w:spacing w:after="200"/></w:pPr></w:p>`;
}

export async function exportDocx(payload, fileName) {
  const JSZip = await loadVendor("jszip");

  let body = "";
  body += para("寶可夢 PTCG 收藏 — 卡表", { bold: true, size: 36, heading: "Heading1" });
  body += para(`匯出時間：${payload.exportedAt}`, { size: 20 });
  body += para(`匯出範圍：${payload.conditionText}`, { size: 20 });
  body += para(
    `本次匯出不重複卡片 ${payload.distinctCount} 張（各分類相加 ${payload.sumOfGroups} 張，`
      + "差額是同時符合多個分類的卡片)。本表僅涵蓋本次所選範圍內、目前資料庫已收錄的卡片，不是官方完整卡表。",
    { size: 18, spacingAfter: 300 }
  );

  for (const g of payload.groups) {
    body += para(
      `${labelOf(g.categoryId)}（${g.rows.length} 張，已收藏 ${g.ownedCount} 張，持有 ${g.totalCopies} 張）`,
      { bold: true, size: 28, heading: "Heading2", spacingAfter: 160 }
    );
    if (g.rows.length === 0) {
      body += para("此分類在目前條件下沒有卡片。", { size: 18 });
    } else {
      body += table(g.rows);
    }
  }

  // A4 直式 + 適合列印的邊界
  const sectPr = `<w:sectPr>
    <w:pgSz w:w="11906" w:h="16838"/>
    <w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"
             w:header="709" w:footer="709" w:gutter="0"/>
  </w:sectPr>`;

  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
  xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
  xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math">
  <w:body>${body}${sectPr}</w:body>
</w:document>`;

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`;

  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

  const docRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

  // 指定中文字型，不然 Word 在某些環境會用預設英文字型導致中文顯示不佳
  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults><w:rPrDefault><w:rPr>
    <w:rFonts w:ascii="Microsoft JhengHei" w:hAnsi="Microsoft JhengHei" w:eastAsia="Microsoft JhengHei"/>
    <w:sz w:val="20"/>
  </w:rPr></w:rPrDefault></w:docDefaults>
  <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/>
    <w:pPr><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="36"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/>
    <w:pPr><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:sz w:val="28"/></w:rPr></w:style>
</w:styles>`;

  const zip = new JSZip();
  zip.file("[Content_Types].xml", contentTypes);
  zip.folder("_rels").file(".rels", rootRels);
  const word = zip.folder("word");
  word.file("document.xml", documentXml);
  word.file("styles.xml", stylesXml);
  word.folder("_rels").file("document.xml.rels", docRels);

  const blob = await zip.generateAsync({
    type: "blob",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    compression: "DEFLATE"
  });
  downloadBlob(blob, fileName);
}

// ------------------------------------------------------------------ 共用

export function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export { COLUMNS as EXPORT_COLUMNS };
