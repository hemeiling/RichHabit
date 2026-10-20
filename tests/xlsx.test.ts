import { inflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { buildXlsx, type Cell, type SheetSpec } from "../src/lib/xlsx";

/**
 * The writer's output is read back by a deliberately separate unzip — its own
 * walk from the end-of-central-directory record and its own bitwise CRC-32
 * (the writer's is table-driven) — so a mistake in the writer cannot hide
 * behind the same mistake in the reader. The XML is then checked as text,
 * which is what Excel and openpyxl parse.
 */

const CREATED = new Date("2026-10-20T13:45:30Z");
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

/** The zip/PNG CRC-32, a bit at a time; pinned by its standard check value below. */
function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c ^= bytes[i];
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return (c ^ 0xffffffff) >>> 0;
}

interface Entry { name: string; data: Buffer; time: number; date: number }

/** Every entry in archive order, after checking each local header against its central one, and each size and CRC. */
function unzip(zip: Buffer): Entry[] {
  const end = zip.length - 22; // no archive comment, so the record is the last 22 bytes
  expect(zip.readUInt32LE(end)).toBe(0x06054b50);
  const count = zip.readUInt16LE(end + 10);
  expect(zip.readUInt16LE(end + 8)).toBe(count);
  const dirStart = zip.readUInt32LE(end + 16);
  expect(dirStart + zip.readUInt32LE(end + 12)).toBe(end);
  const entries: Entry[] = [];
  let p = dirStart;
  let next = 0; // entries sit back to back, from byte 0
  for (let i = 0; i < count; i++) {
    expect(zip.readUInt32LE(p)).toBe(0x02014b50);
    const nameLen = zip.readUInt16LE(p + 28);
    const name = zip.toString("utf8", p + 46, p + 46 + nameLen);
    expect(zip.readUInt16LE(p + 6), name).toBe(20); // version needed
    expect(zip.readUInt16LE(p + 8), name).toBe(0x0800); // UTF-8 names; bit 3 (data descriptor) clear
    expect(zip.readUInt16LE(p + 10), name).toBe(8); // deflate
    const local = zip.readUInt32LE(p + 42);
    expect(local, name).toBe(next);
    expect(zip.readUInt32LE(local)).toBe(0x04034b50);
    expect(zip.subarray(local + 4, local + 30).equals(zip.subarray(p + 6, p + 32)), name).toBe(true);
    expect(zip.toString("utf8", local + 30, local + 30 + nameLen)).toBe(name);
    const start = local + 30 + nameLen + zip.readUInt16LE(local + 28);
    const packed = zip.readUInt32LE(p + 20);
    const data = inflateRawSync(zip.subarray(start, start + packed));
    expect(data.length, name).toBe(zip.readUInt32LE(p + 24));
    expect(crc32(data), name).toBe(zip.readUInt32LE(p + 16));
    entries.push({ name, data, time: zip.readUInt16LE(p + 12), date: zip.readUInt16LE(p + 14) });
    next = start + packed;
    p += 46 + nameLen + zip.readUInt16LE(p + 30) + zip.readUInt16LE(p + 32);
  }
  expect(p).toBe(end);
  expect(next).toBe(dirStart);
  return entries;
}

/** Part name → XML text, in archive order. */
const parts = (zip: Buffer) => new Map(unzip(zip).map((e) => [e.name, e.data.toString("utf8")]));
const build = (sheets: SheetSpec[], props: Parameters<typeof buildXlsx>[1] = {}) =>
  parts(buildXlsx(sheets, { created: CREATED, ...props }));
const sheetOf = (p: Map<string, string>, n = 1) => p.get(`xl/worksheets/sheet${n}.xml`)!;

interface Parsed { t?: string; s: number; v?: string; text?: string; preserve: boolean }
const ENTITIES: Record<string, string> = { "&lt;": "<", "&gt;": ">", "&quot;": '"', "&amp;": "&", "&#13;": "\r" };

/** Ref → cell, decoded the way an XML parser would (Excel's `_xHHHH_` left alone). */
function cells(sheet: string): Map<string, Parsed> {
  const out = new Map<string, Parsed>();
  for (const [, ref, attrs, body] of sheet.matchAll(/<c r="([A-Z]+\d+)"([^>]*)>(.*?)<\/c>/gs)) {
    const t = /<t( xml:space="preserve")?>(.*?)<\/t>/s.exec(body);
    out.set(ref, {
      t: /\bt="(\w+)"/.exec(attrs)?.[1],
      s: Number(/\bs="(\d+)"/.exec(attrs)?.[1] ?? 0),
      v: /<v>(.*?)<\/v>/.exec(body)?.[1],
      text: t ? t[2].replace(/&(?:lt|gt|quot|amp|#13);/g, (e) => ENTITIES[e]) : undefined,
      preserve: Boolean(t?.[1]),
    });
  }
  return out;
}

/** The cellXfs entries, so a cell's `s` can be looked up. */
function xfs(styles: string): string[] {
  const [, count, body] = /<cellXfs count="(\d+)">(.*?)<\/cellXfs>/s.exec(styles)!;
  const list = body.match(/<xf [^>]*?(?:\/>|>.*?<\/xf>)/gs) ?? [];
  expect(list).toHaveLength(Number(count));
  return list;
}

/** Refs breaking Excel's rule: rows ascending, and cells ascending within, and on, their row. */
function outOfOrder(sheet: string): string[] {
  const bad: string[] = [];
  let lastRow = 0;
  for (const [, r, body] of sheet.matchAll(/<row r="(\d+)">(.*?)<\/row>/gs)) {
    if (Number(r) <= lastRow) bad.push(`row ${r}`);
    lastRow = Number(r);
    let lastCol = 0;
    for (const [, letters, n] of body.matchAll(/<c r="([A-Z]+)(\d+)"/g)) {
      const col = [...letters].reduce((acc, ch) => acc * 26 + ch.charCodeAt(0) - 64, 0);
      if (Number(n) !== lastRow || col <= lastCol) bad.push(`${letters}${n}`);
      lastCol = col;
    }
  }
  return bad;
}

describe("the unzip these tests read with", () => {
  it("has the standard CRC-32", () => {
    expect(crc32(Buffer.from("123456789"))).toBe(0xcbf43926);
  });
});

describe("the package", () => {
  it("holds every part, [Content_Types].xml first, each wired to the others", () => {
    const p = build([{ name: "One", rows: [["a"]] }, { name: "Two", rows: [[1]] }]);
    expect([...p.keys()]).toEqual([
      "[Content_Types].xml", "_rels/.rels", "docProps/core.xml", "docProps/app.xml",
      "xl/workbook.xml", "xl/_rels/workbook.xml.rels", "xl/styles.xml",
      "xl/worksheets/sheet1.xml", "xl/worksheets/sheet2.xml",
    ]);
    for (const [name, xml] of p) expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'), name).toBe(true);

    const types = p.get("[Content_Types].xml")!;
    expect(types).toContain('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">');
    expect(types).toContain('<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>');
    expect(types).toContain('<Default Extension="xml" ContentType="application/xml"/>');
    for (const [part, type] of [
      ["/xl/workbook.xml", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"],
      ["/xl/styles.xml", "application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"],
      ["/xl/worksheets/sheet1.xml", "application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"],
      ["/xl/worksheets/sheet2.xml", "application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"],
      ["/docProps/core.xml", "application/vnd.openxmlformats-package.core-properties+xml"],
      ["/docProps/app.xml", "application/vnd.openxmlformats-officedocument.extended-properties+xml"],
    ]) expect(types).toContain(`<Override PartName="${part}" ContentType="${type}"/>`);

    const root = p.get("_rels/.rels")!;
    expect(root).toContain(`Type="${R}/officeDocument" Target="xl/workbook.xml"`);
    expect(root).toContain('Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"');
    expect(root).toContain(`Type="${R}/extended-properties" Target="docProps/app.xml"`);
    const rels = p.get("xl/_rels/workbook.xml.rels")!;
    expect(rels).toContain(`<Relationship Id="rId1" Type="${R}/worksheet" Target="worksheets/sheet1.xml"/>`);
    expect(rels).toContain(`<Relationship Id="rId2" Type="${R}/worksheet" Target="worksheets/sheet2.xml"/>`);
    expect(rels).toContain(`<Relationship Id="rId3" Type="${R}/styles" Target="styles.xml"/>`);

    const workbook = p.get("xl/workbook.xml")!;
    expect(workbook).toContain(`<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${R}">`);
    expect(workbook).toContain('<sheets><sheet name="One" sheetId="1" r:id="rId1"/><sheet name="Two" sheetId="2" r:id="rId2"/></sheets>');
    expect(p.get("docProps/app.xml")).toContain("<Application>RichHabit</Application>");
  });

  it("names sheets the way Excel accepts them, in the order given", () => {
    const wanted = [
      "Tasks", "tasks", "a/b\\c?d*e[f]g:h", "   ", "", "x".repeat(40), "x".repeat(40),
      "History", "'Mei's plan'", "项目进展与贡献", 'R&D "core"', "A", "A", "a",
    ];
    const workbook = build(wanted.map((name) => ({ name, rows: [] }))).get("xl/workbook.xml")!;
    const sheets = [...workbook.matchAll(/<sheet name="([^"]*)" sheetId="(\d+)" r:id="rId(\d+)"\/>/g)];
    const names = sheets.map(([, name]) => name.replace(/&quot;/g, '"').replace(/&amp;/g, "&"));
    expect(names).toEqual([
      "Tasks", "tasks (2)", "abcdefgh", "Sheet", "Sheet (2)", "x".repeat(31), `${"x".repeat(27)} (2)`,
      "History (2)", "Mei's plan", "项目进展与贡献", 'R&D "core"', "A", "A (2)", "a (3)",
    ]);
    expect(Math.max(...names.map((n) => n.length))).toBe(31);
    expect(sheets.map(([, , id, rid]) => [Number(id), Number(rid)])).toEqual(wanted.map((_, i) => [i + 1, i + 1]));
    expect(workbook).toContain('name="R&amp;D &quot;core&quot;"');
  });

  it("still writes a valid workbook when given no sheets", () => {
    const p = build([]);
    expect(p.get("xl/workbook.xml")).toContain('<sheets><sheet name="Sheet" sheetId="1" r:id="rId1"/></sheets>');
    expect(sheetOf(p)).toContain("<sheetData/>");
  });

  it("records title, creator and whole-second W3CDTF times in core.xml", () => {
    const core = build([{ name: "S", rows: [] }], {
      title: 'Q4 <plan> & "goals"', creator: "梅玲", created: new Date("2026-10-20T13:45:30.789Z"),
    }).get("docProps/core.xml")!;
    expect(core).toContain('xmlns:dc="http://purl.org/dc/elements/1.1/"');
    expect(core).toContain('xmlns:dcterms="http://purl.org/dc/terms/"');
    expect(core).toContain('xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"');
    expect(core).toContain("<dc:title>Q4 &lt;plan&gt; &amp; &quot;goals&quot;</dc:title><dc:creator>梅玲</dc:creator>");
    expect(core).toContain('<dcterms:created xsi:type="dcterms:W3CDTF">2026-10-20T13:45:30Z</dcterms:created>');
    expect(core).toContain('<dcterms:modified xsi:type="dcterms:W3CDTF">2026-10-20T13:45:30Z</dcterms:modified>');
    expect(build([{ name: "S", rows: [] }]).get("docProps/core.xml")).not.toContain("<dc:");
  });

  it("is byte-for-byte the same for the same input and created, and stamps the zip with created", () => {
    const sheets: SheetSpec[] = [{ name: "进展", rows: [["a", 1, { value: "2026-10-20", format: "date" }]], freezeRows: 1 }];
    const a = buildXlsx(sheets, { created: CREATED });
    expect(a.equals(buildXlsx(sheets, { created: CREATED }))).toBe(true);
    expect(a.equals(buildXlsx(sheets, { created: new Date("2026-10-21T13:45:30Z") }))).toBe(false);
    for (const e of unzip(a)) {
      expect(e.time, e.name).toBe((13 << 11) | (45 << 5) | (30 >> 1)); // 13:45:30, in two-second steps
      expect(e.date, e.name).toBe(((2026 - 1980) << 9) | (10 << 5) | 20); // 2026-10-20
    }
  });
});

describe("cells", () => {
  it("writes strings inline, with Chinese and emoji intact", () => {
    const p = build([{ name: "S", rows: [["项目进展与贡献", "Done 🎉", "plain"]] }]);
    const c = cells(sheetOf(p));
    expect(c.get("A1")).toEqual({ t: "inlineStr", s: 0, v: undefined, text: "项目进展与贡献", preserve: false });
    expect(c.get("B1")?.text).toBe("Done 🎉");
    expect(sheetOf(p)).toContain('<c r="C1" t="inlineStr"><is><t>plain</t></is></c>');
    expect(p.get("xl/styles.xml")).toContain('<cellXfs count="1">'); // nothing but the default was needed
  });

  it("writes numbers as numbers, exactly, and leaves NaN and infinities empty", () => {
    const c = cells(sheetOf(build([{ name: "S", rows: [[0.5, 1, 8, 23.5, -3, NaN, Infinity, -Infinity, 0]] }])));
    expect(["A1", "B1", "C1", "D1", "E1", "I1"].map((ref) => c.get(ref)?.v)).toEqual(["0.5", "1", "8", "23.5", "-3", "0"]);
    expect(Number(c.get("A1")!.v)).toBe(0.5);
    expect(c.get("A1")).toMatchObject({ t: undefined, s: 0 });
    expect(["F1", "G1", "H1"].filter((ref) => c.has(ref))).toEqual([]);
  });

  it("turns YYYY-MM-DD into 1900-system serials shown as yyyy-mm-dd, and anything else into an empty cell", () => {
    expect((Date.UTC(2026, 9, 20) - Date.UTC(1899, 11, 30)) / 86_400_000).toBe(46315);
    const d = (value: string | number | null): Cell => ({ value, format: "date" });
    const p = build([{ name: "S", rows: [[
      d("2026-10-20"), d("1900-03-01"), d("1900-02-28"), d("1900-01-01"), d("9999-12-31"),
      d("1899-12-31"), d("2026-02-30"), d("2026-1-5"), d("20261020"), d("2026-10-20T00:00"), d(""), d(null), d(46315),
    ]] }]);
    const c = cells(sheetOf(p));
    // Excel counts a 29 February 1900 that never was, so its first two months sit one lower.
    expect([...c].map(([ref, cell]) => [ref, cell.v])).toEqual([
      ["A1", "46315"], ["B1", "61"], ["C1", "59"], ["D1", "1"], ["E1", "2958465"],
    ]);
    expect(xfs(p.get("xl/styles.xml")!)[c.get("A1")!.s]).toBe(
      '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>');
    expect(p.get("xl/styles.xml")).toContain('<numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy-mm-dd"/></numFmts>');
  });

  it("writes percents as fractions formatted 0%, and text-format numbers as text", () => {
    const p = build([{ name: "S", rows: [[
      { value: 0.625, format: "percent" }, { value: 42, format: "text" }, { value: "007", format: "text" }, { value: -2, format: "text" },
    ]] }]);
    const c = cells(sheetOf(p));
    const list = xfs(p.get("xl/styles.xml")!);
    expect(c.get("A1")).toMatchObject({ t: undefined, v: "0.625" });
    expect(list[c.get("A1")!.s]).toContain('numFmtId="9"');
    expect(c.get("B1")).toMatchObject({ t: "inlineStr", text: "42" });
    expect(c.get("C1")).toMatchObject({ t: "inlineStr", text: "007" });
    expect(list[c.get("B1")!.s]).toContain('numFmtId="49"');
    expect(list[c.get("D1")!.s]).toMatch(/numFmtId="49".* quotePrefix="1"/); // "-2" as text still starts with "-"
  });

  it("makes header rows and bold cells bold, keeping their formats, from a table of the combinations used", () => {
    const p = build([{ name: "S", boldRows: [0], rows: [
      ["Task", "Points", { value: "2026-10-20", format: "date" }],
      ["Write", 3, { value: "2026-10-21", format: "date" }],
      [{ value: "Total", bold: true }, 3],
    ] }]);
    const styles = p.get("xl/styles.xml")!;
    const c = cells(sheetOf(p));
    const list = xfs(styles);
    const style = (ref: string) => list[c.get(ref)!.s];
    for (const ref of ["A1", "B1", "C1", "A3"]) expect(style(ref), ref).toContain('fontId="1"');
    for (const ref of ["A2", "B2", "C2", "B3"]) expect(style(ref), ref).toContain('fontId="0"');
    expect(style("C1")).toContain('numFmtId="164"');
    expect(list[0]).toBe('<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>');
    expect(list).toHaveLength(new Set(list).size); // each combination once: bold, bold date, date
    expect(list).toHaveLength(4);
    expect(styles).toContain('<fonts count="2"><font><sz val="11"/><name val="Calibri"/><family val="2"/></font>' +
      '<font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font></fonts>');
    expect(styles).toContain('<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>');
    expect(styles).toContain('<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>');
    expect(styles).toContain('<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>');
    expect(styles).toContain('<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>');
  });

  it("wraps when asked", () => {
    const p = build([{ name: "S", rows: [[{ value: "line one\nline two", wrap: true }]] }]);
    const cell = cells(sheetOf(p)).get("A1")!;
    expect(cell).toMatchObject({ text: "line one\nline two", preserve: true });
    expect(xfs(p.get("xl/styles.xml")!)[cell.s]).toBe(
      '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment wrapText="1"/></xf>');
  });

  it("gives quotePrefix to text a spreadsheet would read as a formula, and only to that", () => {
    const risky = ["=1+1", "+cmd", "-2", "@SUM(A1)", "\tx", "\rx"];
    const safe = ["a=b", "x-1", " =1", "1+1"];
    const p = build([{ name: "S", rows: [risky, safe, [{ value: '=HYPERLINK("http://x")', bold: true, wrap: true }]] }]);
    const c = cells(sheetOf(p));
    const list = xfs(p.get("xl/styles.xml")!);
    risky.forEach((text, i) => {
      const cell = c.get(`${"ABCDEF"[i]}1`)!;
      expect(cell.text, JSON.stringify(text)).toBe(text);
      expect(list[cell.s], JSON.stringify(text)).toBe('<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" quotePrefix="1"/>');
    });
    safe.forEach((text, i) => expect(c.get(`${"ABCD"[i]}2`), text).toMatchObject({ text, s: 0 }));
    expect(list[c.get("A3")!.s]).toBe('<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" ' +
      'quotePrefix="1" applyAlignment="1"><alignment wrapText="1"/></xf>');
  });

  it("never writes a formula", () => {
    const p = build([{ name: "S", rows: [["=1+1", "=SUM(A1:A2)", { value: "=A1", format: "text" }, "@x", "-1"]] }]);
    for (const [name, xml] of p) expect(xml, name).not.toMatch(/<f[\s>/]/);
  });

  it("escapes markup, drops what XML cannot carry, and keeps whitespace", () => {
    const sheet = sheetOf(build([{ name: "S", rows: [[
      '<b>&"x"</b>', "a\u0001b\uFFFFc", "x\uD800y", "\uDC00", "🙂", "  padded  ", "line1\nline2", "tab\tinside", "plain", "\u0001", "", "_x0041_",
      "cr\r\nlf",
    ]] }]));
    const c = cells(sheet);
    // A raw CR would reach a reader as LF (XML folds line ends); a character reference does not.
    expect(sheet).toContain('<t xml:space="preserve">cr&#13;\nlf</t>');
    expect(sheet).not.toContain("\r");
    expect(c.get("M1")?.text).toBe("cr\r\nlf");
    expect(sheet).toContain("<t>&lt;b&gt;&amp;&quot;x&quot;&lt;/b&gt;</t>");
    expect(c.get("A1")?.text).toBe('<b>&"x"</b>');
    expect(c.get("B1")?.text).toBe("abc");
    expect(c.get("C1")?.text).toBe("xy"); // a lone surrogate is not text
    expect(c.get("E1")?.text).toBe("🙂"); // a pair is
    expect(c.get("F1")).toMatchObject({ text: "  padded  ", preserve: true });
    expect(c.get("G1")).toMatchObject({ text: "line1\nline2", preserve: true });
    expect(c.get("H1")).toMatchObject({ text: "tab\tinside", preserve: true });
    expect(c.get("I1")).toMatchObject({ text: "plain", preserve: false });
    expect(["D1", "J1", "K1"].filter((ref) => c.has(ref))).toEqual([]); // nothing was left to write
    expect(sheet).toContain("<t>_x005F_x0041_</t>"); // Excel would otherwise decode it and show "A"
    expect(sheet).not.toMatch(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/);
  });

  it("cuts text at Excel's 32,767 characters without splitting an emoji", () => {
    const c = cells(sheetOf(build([{ name: "S", rows: [[
      "a".repeat(40_000), `${"a".repeat(32_766)}😀`, `${"a".repeat(32_765)}😀`,
    ]] }])));
    expect(c.get("A1")?.text).toHaveLength(32_767);
    expect(c.get("B1")?.text).toBe("a".repeat(32_766)); // the emoji's first half would have been unit 32,767
    expect(c.get("C1")?.text).toBe(`${"a".repeat(32_765)}😀`);
  });

  it("references columns past Z correctly, out to Excel's last, XFD", () => {
    const sheet = sheetOf(build([{ name: "S", rows: [Array.from({ length: 16_384 }, (_, i) => i)] }]));
    const refOf = new Map([...cells(sheet)].map(([ref, cell]) => [Number(cell.v), ref]));
    expect([0, 25, 26, 51, 52, 701, 702, 16_383].map((i) => refOf.get(i))).toEqual(
      ["A1", "Z1", "AA1", "AZ1", "BA1", "ZZ1", "AAA1", "XFD1"]);
    expect(sheet).toContain('<dimension ref="A1:XFD1"/>');
    expect(outOfOrder(sheet)).toEqual([]);
  });
});

describe("sheets", () => {
  it("accept no rows at all, empty rows and rows of different lengths", () => {
    const p = build([{ name: "Empty", rows: [] }, { name: "Gaps", rows: [[1], [], [null, 2], [undefined, null], ["last"]] }]);
    expect(sheetOf(p, 1)).toContain('<dimension ref="A1"/>');
    expect(sheetOf(p, 1)).toContain("<sheetData/>");
    const gaps = sheetOf(p, 2);
    expect([...gaps.matchAll(/<row r="(\d+)">/g)].map(([, r]) => Number(r))).toEqual([1, 3, 5]);
    expect([...cells(gaps).keys()]).toEqual(["A1", "B3", "A5"]);
    expect(gaps).toContain('<dimension ref="A1:B5"/>');
    expect(outOfOrder(gaps)).toEqual([]);
  });

  it("freeze header rows and select the first sheet, keeping CT_Worksheet's order", () => {
    const p = build([
      { name: "A", rows: [["h"], [1]], freezeRows: 1, widths: [20] },
      { name: "B", rows: [["h"], ["h2"], [1]], freezeRows: 2 },
      { name: "C", rows: [[1]], freezeRows: 0 },
    ]);
    const [a, b, c] = [1, 2, 3].map((n) => sheetOf(p, n));
    expect(a).toContain('<sheetViews><sheetView workbookViewId="0" tabSelected="1">' +
      '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>');
    expect(b).toContain('<sheetViews><sheetView workbookViewId="0">' +
      '<pane ySplit="2" topLeftCell="A3" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>');
    expect(c).toContain('<sheetViews><sheetView workbookViewId="0"/></sheetViews>');
    const at = ["<dimension ", "<sheetViews>", "<cols>", "<sheetData>"].map((tag) => a.indexOf(tag));
    expect(at.every((i, k) => i > 0 && (k === 0 || i > at[k - 1])), String(at)).toBe(true);
    expect(p.get("xl/workbook.xml")).toContain('<bookViews><workbookView activeTab="0"/></bookViews>');
  });

  it("set the column widths given, and write no <cols> without any", () => {
    const p = build([
      { name: "A", rows: [[1]], widths: [20, 12.5, 0, NaN, 300] },
      { name: "B", rows: [[1]], widths: [] },
      { name: "C", rows: [[1]] },
    ]);
    expect(sheetOf(p, 1)).toContain('<cols><col min="1" max="1" width="20" customWidth="1"/>' +
      '<col min="2" max="2" width="12.5" customWidth="1"/><col min="5" max="5" width="255" customWidth="1"/></cols>');
    expect(sheetOf(p, 2)).not.toContain("<cols");
    expect(sheetOf(p, 3)).not.toContain("<cols");
  });

  it("refuse, plainly, more than Excel holds", () => {
    expect(() => buildXlsx([{ name: "Long", rows: new Array(1_048_577) }])).toThrow(/"Long" has 1048577 rows/);
    expect(() => buildXlsx([{ name: "Wide", rows: [new Array(16_385)] }])).toThrow(/"Wide" has 16385 cells/);
  });

  it("of 5,000 rows × 10 columns build in well under a second", () => {
    const rows: Cell[][] = [Array.from({ length: 10 }, (_, i) => `Column ${i + 1}`)];
    for (let r = 1; r < 5_000; r++) {
      rows.push([
        `任务 ${r}`, r, r / 7, { value: "2026-10-20", format: "date" }, { value: (r % 100) / 100, format: "percent" },
        r % 2 ? "=not a formula" : "plain", { value: r, format: "text" }, r % 3 ? "done" : "open", 23.5, `note ${r} 🎉`,
      ]);
    }
    const t0 = performance.now();
    const zip = buildXlsx([{ name: "Big", rows, freezeRows: 1, boldRows: [0], widths: [30, 10] }], { created: CREATED });
    const ms = performance.now() - t0;
    expect(ms, `${ms.toFixed(0)} ms`).toBeLessThan(1_000);
    const sheet = sheetOf(parts(zip));
    expect(sheet.match(/<row /g)).toHaveLength(5_000);
    expect(sheet).toContain('<dimension ref="A1:J5000"/>');
    expect(outOfOrder(sheet)).toEqual([]);
  });
});
