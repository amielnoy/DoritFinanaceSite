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
    .replace(/\b\d{4}[- ]?\d{4}[- ]?\d{4}[- ]?\d{4}\b/g, '[הושמט — מספר כרטיס]')
    .replace(/\bIL\d{2}[A-Z0-9]{17,}\b/gi, '[הושמט — חשבון בנק]')
    .replace(/\b\d{9}\b/g, '[הושמט — מספר מזהה]')
    .replace(/\b\d{6,8}\b/g, '[הושמט — מספר]')
    .slice(0, 2000);
}
