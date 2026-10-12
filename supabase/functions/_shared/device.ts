/**
 * מאיזה מכשיר נשלחה הפנייה.
 *
 * נגזר מ-User-Agent של הבקשה, ולא ממשהו שהדפדפן מוסר בגוף הפנייה: זה מגיע
 * מאותה בקשה שיצרה את הפנייה, ואין טופס שיכול לשקר עליו בטעות.
 *
 * תווית ולא המחרוזת המלאה. ל-User-Agent אין מה לחפש במייל שנשמר שנים, והשאלה
 * שהוא עונה עליה כאן היא "מהטלפון או מהמחשב" — לא איזו גרסת דפדפן.
 *
 * iPadOS מדווח על עצמו כ-Macintosh, ולכן אייפד ללא בקשת אתר-שולחן ייספר
 * כ-Mac. עדיף מלנחש: תווית שגויה גרועה מתווית כללית.
 */
export function deviceLabel(ua: string | null): string {
  const s = String(ua || '');
  if (!s) return 'לא ידוע';
  if (/Android/i.test(s)) return 'אנדרואיד';
  if (/iPhone/i.test(s)) return 'אייפון';
  if (/iPad/i.test(s)) return 'אייפד';
  if (/Macintosh|Mac OS X/i.test(s)) return 'מחשב Mac';
  if (/Windows/i.test(s)) return 'מחשב Windows';
  if (/Linux/i.test(s)) return 'מחשב Linux';
  return 'לא ידוע';
}
