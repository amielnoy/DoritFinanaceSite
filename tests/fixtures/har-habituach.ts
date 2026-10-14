import { strToU8, zipSync } from "fflate";

/**
 * A made-up Har HaBituach export, in the layout of a real one (2026-10-14):
 * title, blank, header, then sections of policies. Every value is invented —
 * the ID and policy numbers are fixed fakes, the companies and premiums
 * arbitrary.
 */
const HEADER = ["תעודת זהות", "ענף ראשי", "ענף (משני)", "סוג מוצר", "חברה", "תקופת ביטוח", "פרטים נוספים", 'פרמיה בש"ח', "סוג פרמיה", "מספר פוליסה", "סיווג תכנית"];
const row = (main: string, sub: string, product: string, company: string, premium: string, type: string, period = "01/01/2025 - 31/12/2025") =>
  ["000000018", main, sub, product, company, period, "", premium, type, "FAKE-0001", "אישי"];

export const HB_ROWS: string[][] = [
  [],
  ["", "פירוט הפוליסות שנמצאו במערכת הר הביטוח", "", "", "", "", "", "", "", "", "01/01/2026"],
  [],
  HEADER,
  ["", "תחום - כללי"],
  row("ביטוח רכב", "רכב חובה", "פוליסת ביטוח", "חברה א", "1800.00", "שנתית"),
  row("ביטוח רכב", "רכב חובה", "פוליסת ביטוח", "חברה ב", "1500.00", "שנתית"),
  row("ביטוח רכב", "ביטוח מקיף", "כתב שירות שמשות", "חברה א", "120.00", "שנתית"),
  row("ביטוח רכב", "ביטוח מקיף", "פוליסת ביטוח", "חברה א", "2400.00", "שנתית"),
  ["", "תחום - בריאות ותאונות אישיות"],
  row("ביטוח בריאות", "תרופות - בסיס", "פוליסת ביטוח", "חברה ג", "45.50", "חודשית", "מתחדש"),
  row("ביטוח בריאות", "תרופות - בסיס", "פוליסת ביטוח", "חברה ב", "39.90", "חודשית", "מתחדש"),
  row("ביטוח בריאות", "מחלות קשות", "פוליסת ביטוח", "חברה ג", "60.00", "חודשית"),
  ["", "תחום - חיים ואבדן כושר עבודה"],
  row("ביטוח חיים", "ביטוח חיים למקרה מוות", "פוליסת ביטוח", "חברה ב", "80.00", "חודשית", "לכל החיים"),
];

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
const letter = (i: number) => String.fromCharCode(65 + i);

/**
 * The rows as an .xlsx file. `prefixed` writes `x:row`/`x:c` as Har
 * HaBituach's export does; otherwise plain `row`/`c` as Excel does. Text goes
 * to sharedStrings, except each row's last column, written as an inline string.
 */
export function buildXlsx(rows: string[][], prefixed = true): Uint8Array {
  const p = prefixed ? "x:" : "";
  const ns = prefixed
    ? 'xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'
    : 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"';
  const shared: string[] = [];
  const sheetRows = rows
    .map((r, i) => {
      const cells = r
        .map((v, j) => {
          if (v === "") return "";
          const ref = `${letter(j)}${i + 1}`;
          if (j === r.length - 1) return `<${p}c r="${ref}" t="inlineStr"><${p}is><${p}t>${esc(v)}</${p}t></${p}is></${p}c>`;
          shared.push(v);
          return `<${p}c r="${ref}" t="s"><${p}v>${shared.length - 1}</${p}v></${p}c>`;
        })
        .join("");
      return `<${p}row r="${i + 1}">${cells}</${p}row>`;
    })
    .join("");
  const sheet = `<?xml version="1.0" encoding="UTF-8"?><${p}worksheet ${ns}><${p}sheetData>${sheetRows}</${p}sheetData></${p}worksheet>`;
  const sst = `<?xml version="1.0" encoding="UTF-8"?><${p}sst ${ns}>${shared
    .map((s) => `<${p}si><${p}t>${esc(s)}</${p}t></${p}si>`)
    .join("")}</${p}sst>`;
  return zipSync({
    "xl/workbook.xml": strToU8('<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"/>'),
    "xl/worksheets/sheet1.xml": strToU8(sheet),
    "xl/sharedStrings.xml": strToU8(sst),
  });
}
