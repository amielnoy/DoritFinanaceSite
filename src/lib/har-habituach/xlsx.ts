import { unzipSync, strFromU8 } from "fflate";

/**
 * The first worksheet of an .xlsx file as rows of text, read in the browser.
 *
 * An .xlsx is a ZIP of XML parts: the cells live in xl/worksheets/sheet1.xml,
 * and most text sits once in xl/sharedStrings.xml with cells pointing at it
 * by index. That is all the Har HaBituach export needs — no formulas, styles
 * or dates are interpreted, so a full spreadsheet library is not loaded.
 * Nothing here sends anything anywhere.
 *
 * The legacy binary .xls format is not a ZIP and is refused (`not_xlsx`).
 */
export class XlsxError extends Error {
  constructor(readonly reason: "not_xlsx" | "no_sheet") {
    super(reason);
  }
}

/** "C7" → 2 (zero-based column). */
function columnIndex(ref: string): number {
  let n = 0;
  for (const ch of ref.replace(/\d+$/, "")) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

const xml = (text: string): Document => new DOMParser().parseFromString(text, "application/xml");

/**
 * Elements by local name, whatever their prefix: Har HaBituach's export writes
 * every element as `x:row`, `x:c`, `x:v` — a prefixed default namespace — where
 * Excel itself writes `row`, `c`, `v`.
 */
const byName = (node: Document | Element, name: string): Element[] => Array.from(node.getElementsByTagNameNS("*", name));

/** Every `<t>` inside a node, joined — rich text splits one string into runs. */
const textOf = (node: Element): string =>
  byName(node, "t")
    .map((t) => t.textContent ?? "")
    .join("");

export function readFirstSheet(bytes: Uint8Array): string[][] {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, { filter: (f) => f.name === "xl/sharedStrings.xml" || f.name.startsWith("xl/worksheets/sheet") || f.name === "xl/workbook.xml" });
  } catch {
    throw new XlsxError("not_xlsx");
  }
  const sheetName = Object.keys(files)
    .filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))
    .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]))[0];
  if (!sheetName) throw new XlsxError(files["xl/workbook.xml"] ? "no_sheet" : "not_xlsx");

  const shared = files["xl/sharedStrings.xml"]
    ? byName(xml(strFromU8(files["xl/sharedStrings.xml"])), "si").map(textOf)
    : [];

  const rows: string[][] = [];
  for (const row of byName(xml(strFromU8(files[sheetName])), "row")) {
    const index = Number(row.getAttribute("r") ?? rows.length + 1) - 1;
    const cells: string[] = [];
    for (const c of byName(row, "c")) {
      const col = columnIndex(c.getAttribute("r") ?? "A1");
      const type = c.getAttribute("t");
      const v = byName(c, "v")[0]?.textContent ?? "";
      cells[col] =
        type === "s" ? shared[Number(v)] ?? "" : type === "inlineStr" ? textOf(c) : v;
    }
    rows[index] = Array.from(cells, (x) => (x ?? "").trim());
  }
  return Array.from(rows, (r) => r ?? []);
}
