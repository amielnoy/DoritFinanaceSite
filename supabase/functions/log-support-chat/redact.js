/**
 * הסרת מזהים רגישים מתקציר שנכתב על ידי מודל.
 *
 * משוכפל מ-escalateToHuman/entry.ts בכוונה: כל פונקציה ב-Base44 היא נקודת
 * כניסה עצמאית ואין ביניהן מודול משותף. שתי העותקות חייבות להישאר זהות —
 * tests/contract/agents.contract.test.ts נכשל אם אחת מהן מתפצלת.
 */
export function redact(text) {
  if (!text) return '';
  return String(text)
    .replace(/(?<![0-9])[0-9]{4}[- ]?[0-9]{4}[- ]?[0-9]{4}[- ]?[0-9]{4}(?![0-9])/g, '[הושמט — מספר כרטיס]')
    .replace(/(?<![A-Za-z0-9])[Ii][Ll][0-9]{2}[A-Za-z0-9]{17,}(?![A-Za-z0-9])/g, '[הושמט — חשבון בנק]')
    .replace(/(?<![0-9])[0-9]{9}(?![0-9])/g, '[הושמט — מספר מזהה]')
    .replace(/(?<![0-9])[0-9]{6,8}(?![0-9])/g, '[הושמט — מספר]')
    .slice(0, 2000)
    .replace(/[\uD800-\uDBFF]$/, ''); // a cut through an emoji leaves half of it, which is not valid JSON
}
