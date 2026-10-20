import { deflateRawSync } from "node:zlib";

/**
 * Excel workbooks (`.xlsx`), written here rather than by a library.
 *
 * **Server-only:** it imports `node:zlib`.
 *
 * An export is a few typed tables, and the slice of Office Open XML that says
 * that is small: seven XML parts plus one per sheet, in a zip. Writing it
 * directly keeps a spreadsheet library and its dependencies out of the server,
 * and leaves a file a test can take apart byte by byte.
 *
 * What every file promises, because an export carries people's own words out
 * of the app:
 *
 * - **Nothing is a formula.** Strings are inline strings, numbers are numbers,
 *   and no `<f>` is ever written. Text a spreadsheet would read as a formula
 *   once someone edits the cell — first character `=`, `+`, `-`, `@`, tab or
 *   CR — also carries `quotePrefix`, so it stays text after the edit, too.
 * - **Text arrives as typed.** UTF-8 throughout, so Chinese and emoji survive;
 *   only what XML 1.0 cannot carry at all is dropped, and a cell is cut at
 *   Excel's 32,767 characters, never between the halves of an emoji.
 * - **Dates are dates.** "YYYY-MM-DD" becomes a serial shown as yyyy-mm-dd, so
 *   it sorts and filters as a date in any locale's Excel.
 * - **Same input, same bytes.** Every timestamp in the file comes from `created`.
 */

/** One cell. A bare value is the common case; the object form adds a format. */
export type Cell =
  | string | number | null | undefined
  | { value: string | number | null; format?: "date" | "percent" | "text"; bold?: boolean; wrap?: boolean };

export interface SheetSpec {
  /**
   * Sanitized: \ / ? * [ ] : removed, trimmed (of edge apostrophes too), cut to
   * 31 chars, made unique ignoring case (append " (2)" etc. within 31), "Sheet"
   * if empty. Excel reserves "History", so that name gets " (2)" as well.
   */
  name: string;
  /** Row-major. null/undefined cells are simply left empty. Rows may differ in length; an empty row is allowed. */
  rows: Cell[][];
  /** Column widths in Excel character units, from column A. */
  widths?: number[];
  /** Rows frozen at the top (e.g. 1 for a header row). */
  freezeRows?: number;
  /** 0-based row indices whose cells are bold (header rows). */
  boldRows?: number[];
}

type Styled = Extract<Cell, object>;
type StyleId = (bold: boolean, numFmt: number, quote: boolean, wrap: boolean) => number;

/** Excel's own limits: past them it offers to repair the file instead of opening it. */
const MAX_ROWS = 1_048_576;
const MAX_COLS = 16_384;
const MAX_TEXT = 32_767;
/** Number formats 9 (`0%`) and 49 (`@`, text) are built in; 164 is the first id a file may define. */
const PERCENT = 9;
const TEXT = 49;
const DATE = 164;

const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const OOXML = "http://schemas.openxmlformats.org";
const MAIN = `${OOXML}/spreadsheetml/2006/main`;
const DOC_REL = `${OOXML}/officeDocument/2006/relationships`;
const SML = "application/vnd.openxmlformats-officedocument.spreadsheetml";

/** What XML 1.0 cannot carry at all. Under `u` a lone surrogate is a code point of its own; a valid pair is not. */
const NOT_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF\uD800-\uDFFF]/gu;
/** Excel decodes `_xHHHH_` inside strings, so a literal one keeps its text by escaping its underscore. */
const XSTRING = /_(?=x[0-9A-Fa-f]{4}_)/g;
const ENTITY: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "\r": "&#13;" };
/** For text and attributes alike. CR goes as a reference, which parsers do not fold into LF as they do a raw one. */
const esc = (s: string) => s.replace(/[&<>"\r]/g, (c) => ENTITY[c]);

/** The first `n` UTF-16 units, without splitting a surrogate pair. */
function cut(s: string, n: number): string {
  if (s.length <= n) return s;
  const last = s.charCodeAt(n - 1);
  return s.slice(0, last >= 0xd800 && last < 0xdc00 ? n - 1 : n);
}

/** 0 → A, 25 → Z, 26 → AA: bijective base 26. */
function column(i: number): string {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

const DAY = 86_400_000;
const EPOCH = Date.UTC(1899, 11, 30);

/**
 * "YYYY-MM-DD" as a 1900-system serial, or null. Days since 1899-12-30 is the
 * serial from 1900-03-01 on; before that Excel's serials are one lower, because
 * it counts a 29 February 1900 that never was (kept for Lotus 1-2-3).
 */
function dateSerial(s: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]) - 1, Number(m[3])];
  const t = new Date(Date.UTC(y, mo, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== mo || t.getUTCDate() !== d) return null; // 2026-02-30, year 0050
  const n = (t.getTime() - EPOCH) / DAY;
  return n >= 61 ? n : n >= 2 ? n - 1 : null;
}

/**
 * Names Excel accepts: none of \ / ? * [ ] :, no apostrophe at either end, at
 * most 31 characters, unique ignoring case — Excel's own comparison — and never
 * "History", which it keeps for its change log.
 */
function sheetNames(wanted: string[]): string[] {
  const taken = new Set(["history"]);
  const tidy = (s: string) => s.replace(/^[\s']+|[\s']+$/g, "");
  return wanted.map((raw) => {
    const clean = raw.replace(NOT_XML, "").replace(/[\t\n\r]/g, " ").replace(/[\\/?*[\]:]/g, "");
    const base = tidy(cut(tidy(clean), 31)) || "Sheet";
    let name = base;
    for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${tidy(cut(base, 31 - ` (${n})`.length))} (${n})`;
    taken.add(name.toLowerCase());
    return name;
  });
}

/** The cellXfs table, holding only the combinations cells actually use; 0 is the default. */
function styleTable(): { id: StyleId; xml: () => string } {
  const combos = [[0, 0, 0, 0]];
  const index = new Map([["0,0,0,0", 0]]);
  const id: StyleId = (bold, numFmt, quote, wrap) => {
    const combo = [+bold, numFmt, +quote, +wrap];
    const key = combo.join();
    let i = index.get(key);
    if (i === undefined) index.set(key, (i = combos.push(combo) - 1));
    return i;
  };
  const xml = () => {
    const xfs = combos.map(([b, numFmt, q, w]) =>
      `<xf numFmtId="${numFmt}" fontId="${b}" fillId="0" borderId="0" xfId="0"` +
      `${numFmt ? ' applyNumberFormat="1"' : ""}${b ? ' applyFont="1"' : ""}${q ? ' quotePrefix="1"' : ""}` +
      (w ? ' applyAlignment="1"><alignment wrapText="1"/></xf>' : "/>"));
    const font = (b: string) => `<font>${b}<sz val="11"/><name val="Calibri"/><family val="2"/></font>`;
    return `${HEAD}<styleSheet xmlns="${MAIN}">` +
      `<numFmts count="1"><numFmt numFmtId="${DATE}" formatCode="yyyy-mm-dd"/></numFmts>` +
      `<fonts count="2">${font("")}${font("<b/>")}</fonts>` +
      `<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>` +
      `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>` +
      `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
      `<cellXfs count="${xfs.length}">${xfs.join("")}</cellXfs>` +
      `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
  };
  return { id, xml };
}

/** One `<c>`, or "" for a cell left empty. */
function cellXml(ref: string, cell: Cell, rowBold: boolean, style: StyleId): string {
  const o: Styled = typeof cell === "object" && cell !== null ? cell : { value: cell ?? null };
  const bold = rowBold || o.bold === true;
  const wrap = o.wrap === true;
  const s = (id: number) => (id ? ` s="${id}"` : "");
  let v = o.value;
  if (o.format === "date") v = typeof v === "string" ? dateSerial(v) : null;
  else if (o.format === "text" && typeof v === "number" && Number.isFinite(v)) v = String(v);
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return "";
    const numFmt = o.format === "date" ? DATE : o.format === "percent" ? PERCENT : 0;
    return `<c r="${ref}"${s(style(bold, numFmt, false, wrap))}><v>${v}</v></c>`;
  }
  if (typeof v !== "string") return "";
  const text = cut(v.replace(NOT_XML, ""), MAX_TEXT);
  if (!text) return "";
  const id = style(bold, o.format === "text" ? TEXT : 0, /^[=+\-@\t\r]/.test(text), wrap);
  const space = /^\s|\s$|[\t\n\r]/.test(text) ? ' xml:space="preserve"' : "";
  return `<c r="${ref}" t="inlineStr"${s(id)}><is><t${space}>${esc(text.replace(XSTRING, "_x005F_"))}</t></is></c>`;
}

function sheetXml(spec: SheetSpec, name: string, first: boolean, style: StyleId): string {
  const { rows, widths = [], boldRows = [] } = spec;
  if (rows.length > MAX_ROWS) throw new Error(`xlsx: sheet "${name}" has ${rows.length} rows; Excel holds ${MAX_ROWS}`);
  const bold = new Set(boldRows);
  const refs: string[] = [];
  const data: string[] = [];
  let lastRow = 0;
  let lastCol = 0;
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r] ?? [];
    if (row.length > MAX_COLS) throw new Error(`xlsx: row ${r + 1} of "${name}" has ${row.length} cells; Excel holds ${MAX_COLS}`);
    const rowBold = bold.has(r);
    let cells = "";
    for (let c = 0; c < row.length; c++) {
      const xml = cellXml(`${(refs[c] ??= column(c))}${r + 1}`, row[c], rowBold, style);
      if (!xml) continue;
      cells += xml;
      lastCol = Math.max(lastCol, c + 1);
    }
    if (!cells) continue;
    data.push(`<row r="${r + 1}">${cells}</row>`);
    lastRow = r + 1;
  }
  const freeze = Math.floor(spec.freezeRows ?? 0);
  const pane = freeze > 0 && freeze < MAX_ROWS
    ? `<pane ySplit="${freeze}" topLeftCell="A${freeze + 1}" activePane="bottomLeft" state="frozen"/>`
    : "";
  const view = `<sheetView workbookViewId="0"${first ? ' tabSelected="1"' : ""}${pane ? `>${pane}</sheetView>` : "/>"}`;
  const cols = widths.slice(0, MAX_COLS).map((w, i) =>
    Number.isFinite(w) && w > 0 ? `<col min="${i + 1}" max="${i + 1}" width="${Math.min(w, 255)}" customWidth="1"/>` : "").join("");
  // CT_Worksheet is a sequence: dimension, sheetViews, cols, sheetData — in that order, or Excel repairs the file.
  return `${HEAD}<worksheet xmlns="${MAIN}"><dimension ref="${lastRow ? `A1:${column(lastCol - 1)}${lastRow}` : "A1"}"/>` +
    `<sheetViews>${view}</sheetViews>${cols && `<cols>${cols}</cols>`}` +
    (data.length ? `<sheetData>${data.join("")}</sheetData>` : "<sheetData/>") + "</worksheet>";
}

const CRC_TABLE = new Int32Array(256).map((_, n) => {
  for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n;
});

/** CRC-32 as zip uses it. Our own, because `zlib.crc32` needs Node 20.15/22.2 and production runs any Node 20. */
function crc32(buf: Uint8Array): number {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
}

/** MS-DOS time and date (two-second steps, 1980–2107), read in UTC so the bytes do not depend on the server's zone. */
function dosStamp(d: Date): [time: number, date: number] {
  const t = new Date(Math.min(Math.max(d.getTime(), Date.UTC(1980, 0, 1)), Date.UTC(2107, 11, 31, 23, 59, 58)));
  return [
    (t.getUTCHours() << 11) | (t.getUTCMinutes() << 5) | (t.getUTCSeconds() >> 1),
    ((t.getUTCFullYear() - 1980) << 9) | ((t.getUTCMonth() + 1) << 5) | t.getUTCDate(),
  ];
}

/**
 * Classic PKZIP: deflate, UTF-8 names, sizes in the local headers (no data
 * descriptors) and no ZIP64. An export is kilobytes; one that outgrows the
 * 32- and 16-bit fields is refused rather than written broken.
 */
function zip(files: [name: string, data: Buffer][], when: Date): Buffer {
  const LIMIT = 0xffffffff; // all ones in a size, offset or count field means "see ZIP64"
  const tooBig = () => new Error("xlsx: the workbook needs ZIP64 (4 GiB or more, or 65,535+ parts), which this writer does not do");
  if (files.length >= 0xffff) throw tooBig();
  const [time, date] = dosStamp(when);
  const body: Buffer[] = [];
  const dir: Buffer[] = [];
  let offset = 0;
  for (const [name, data] of files) {
    const file = Buffer.from(name, "utf8");
    const packed = deflateRawSync(data);
    if (data.length >= LIMIT || offset + 30 + file.length + packed.length >= LIMIT) throw tooBig();
    const fields = Buffer.alloc(26); // the run the local and central headers share
    fields.writeUInt16LE(20, 0); // version needed: 2.0, for deflate
    fields.writeUInt16LE(0x0800, 2); // bit 11: the name is UTF-8
    fields.writeUInt16LE(8, 4); // method: deflate
    fields.writeUInt16LE(time, 6);
    fields.writeUInt16LE(date, 8);
    fields.writeUInt32LE(crc32(data), 10);
    fields.writeUInt32LE(packed.length, 14);
    fields.writeUInt32LE(data.length, 18);
    fields.writeUInt16LE(file.length, 22); // the extra field's length, at 24, stays 0
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    fields.copy(local, 4);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4); // made by: MS-DOS, 2.0 — no Unix modes to get wrong
    fields.copy(central, 6);
    central.writeUInt32LE(offset, 42);
    body.push(local, file, packed);
    dir.push(central, file);
    offset += 30 + file.length + packed.length;
  }
  const dirSize = dir.reduce((n, b) => n + b.length, 0);
  if (offset + dirSize >= LIMIT) throw tooBig();
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(dirSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...body, ...dir, end]);
}

/**
 * The workbook as `.xlsx` bytes. Sheets keep their order and the first is the
 * one that opens. No sheets still makes a valid file: one empty "Sheet".
 */
export function buildXlsx(sheets: SheetSpec[], props: { title?: string; creator?: string; created?: Date } = {}): Buffer {
  const created = props.created ?? new Date();
  if (Number.isNaN(created.getTime())) throw new Error("xlsx: props.created is an invalid Date");
  const specs: SheetSpec[] = sheets.length ? sheets : [{ name: "Sheet", rows: [] }];
  const names = sheetNames(specs.map((s) => s.name));
  const styles = styleTable();
  const sheetFiles = specs.map((spec, i): [string, string] =>
    [`xl/worksheets/sheet${i + 1}.xml`, sheetXml(spec, names[i], i === 0, styles.id)]);
  const rels = (list: [type: string, target: string][]) =>
    `${HEAD}<Relationships xmlns="${OOXML}/package/2006/relationships">` +
    list.map(([type, target], i) => `<Relationship Id="rId${i + 1}" Type="${type}" Target="${target}"/>`).join("") +
    "</Relationships>";
  const override = (part: string, type: string) => `<Override PartName="/${part}" ContentType="${type}"/>`;
  const meta = (tag: string, v?: string) => (v ? `<${tag}>${esc(v.replace(NOT_XML, ""))}</${tag}>` : "");
  const stamp = created.toISOString().replace(/\.\d+Z$/, "Z"); // W3CDTF, whole seconds as Office writes it
  const files: [string, string][] = [
    ["[Content_Types].xml", `${HEAD}<Types xmlns="${OOXML}/package/2006/content-types">` +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      override("xl/workbook.xml", `${SML}.sheet.main+xml`) + override("xl/styles.xml", `${SML}.styles+xml`) +
      sheetFiles.map(([part]) => override(part, `${SML}.worksheet+xml`)).join("") +
      override("docProps/core.xml", "application/vnd.openxmlformats-package.core-properties+xml") +
      override("docProps/app.xml", "application/vnd.openxmlformats-officedocument.extended-properties+xml") + "</Types>"],
    ["_rels/.rels", rels([
      [`${DOC_REL}/officeDocument`, "xl/workbook.xml"],
      [`${OOXML}/package/2006/relationships/metadata/core-properties`, "docProps/core.xml"],
      [`${DOC_REL}/extended-properties`, "docProps/app.xml"],
    ])],
    ["docProps/core.xml", `${HEAD}<cp:coreProperties xmlns:cp="${OOXML}/package/2006/metadata/core-properties" ` +
      'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" ' +
      'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
      meta("dc:title", props.title) + meta("dc:creator", props.creator) +
      `<dcterms:created xsi:type="dcterms:W3CDTF">${stamp}</dcterms:created>` +
      `<dcterms:modified xsi:type="dcterms:W3CDTF">${stamp}</dcterms:modified></cp:coreProperties>`],
    ["docProps/app.xml", `${HEAD}<Properties xmlns="${OOXML}/officeDocument/2006/extended-properties">` +
      "<Application>RichHabit</Application></Properties>"],
    ["xl/workbook.xml", `${HEAD}<workbook xmlns="${MAIN}" xmlns:r="${DOC_REL}"><bookViews><workbookView activeTab="0"/></bookViews>` +
      `<sheets>${names.map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>`],
    ["xl/_rels/workbook.xml.rels", rels([
      ...sheetFiles.map((_, i): [string, string] => [`${DOC_REL}/worksheet`, `worksheets/sheet${i + 1}.xml`]),
      [`${DOC_REL}/styles`, "styles.xml"],
    ])],
    ["xl/styles.xml", styles.xml()], // after the sheets, which chose the styles
    ...sheetFiles,
  ];
  return zip(files.map(([name, xml]) => [name, Buffer.from(xml, "utf8")]), created);
}
