export interface ClientMail {
  firstName: string;
  eyebrow: string;
  heading: string;
  intro: string;
  panelTitle: string;
  details: [label: string, value: string][];
  /** One button under the panel. Rendered only for an https:// href with no quote, angle bracket or space. */
  action?: { label: string; href: string };
}

/** The button-style anchor for `action`, or '' when the href is not a plain https:// address. */
function actionBlock(action: ClientMail['action']): string {
  if (!action || !/^https:\/\/[^\s"'<>]+$/.test(action.href)) return '';
  return `
        <p style="margin:0 0 32px; text-align:center;"><a href="${escapeHtml(action.href)}" style="display:inline-block; padding:14px 32px; background:#1A1A1B; color:#F9F7F2; font-family:Arial,sans-serif; font-size:15px; font-weight:bold; text-decoration:none; border-radius:4px;">${escapeHtml(action.label)}</a></p>`;
}


/**
 * בריחת תווים לפני שילוב טקסט מהמבקר בגוף HTML.
 *
 * המייל הזה נשלח לכתובת שהמבקר הקליד, מהדומיין המאומת של הסוכנות, והשם והנושא
 * מגיעים ממנו. בלי בריחה אפשר להגיש טופס עם המייל של מישהו אחר ועם שם שהוא
 * בעצם תגית — והנמען מקבל מייל ממותג של דורית שמכיל קישור של התוקף. זה אינו
 * XSS בדפדפן של המבקר אלא וקטור פישינג על חשבון המוניטין של הסוכנות.
 */
export function escapeHtml(text: unknown): string {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * המייל ללקוח — תבנית אחת לכל הודעה שיוצאת למבקר.
 *
 * זהו המכתב שהלקוח מקבל בשם הסוכנות, ולכן הוא צריך להיראות אותו דבר בכל פעם:
 * אישור בקשת ייעוץ, אישור פנייה ואישור דיווח תביעה. עד כאן היו שתי תבניות —
 * submitClaim החזיק עותק שנשר ממנה: בלי dir="rtl" (כלומר עמודות הפוכות בטבלת
 * הפרטים), בלי text-align, עם גוון פאנל אחר, ובלי escapeHtml על שם הלקוח.
 *
 * מה שמשתנה בין הודעה להודעה הוא תוכן ולא עיצוב, ולכן הוא נכנס כפרמטרים:
 * כותרת קטנה, כותרת, פסקת פתיחה ורשימת שדות. ההודעה עצמה זהה.
 *
 * One letter for every message to a visitor. Edge Functions share this module;
 * the Base44 copies are kept identical by
 * tests/integration/submit-claim.integration.test.ts, which compares the HTML
 * both send.
 *
 * Callers pass raw values. Escaping happens here, at the binding site, so a new
 * field cannot be added without it.
 */
export function buildClientHtml({ firstName, eyebrow, heading, intro, panelTitle, details, action }: ClientMail): string {
  const rows = (details || []).filter(([, value]) => value);
  // No name rather than a doubtful one: greetingName returns '' for anything not made of letters.
  const greeting = firstName ? 'שלום ' + firstName + ',' : 'שלום,';
  const divider =
    `
              <tr>
                <td colspan="2" style="padding:0; font-size:0; line-height:0; border-top:1px solid #E0D4C6;">&nbsp;</td>
              </tr>`;
  const detailRows = rows
    .map(([label, value]) => `
              <tr>
                <td style="padding:10px 0; font-size:13px; color:#7D6B5D; font-family:Arial,sans-serif; width:130px; text-align:right;">${escapeHtml(label)}</td>
                <td style="padding:10px 0; font-size:15px; color:#1A1A1B; font-family:Georgia,serif; font-weight:bold; text-align:right;">${escapeHtml(value)}</td>
              </tr>`)
    .join(divider);

  const detailsBlock = rows.length ? `
        <table dir="rtl" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:32px 0; background:#F6F1EA; border:1px solid #E0D4C6; border-radius:6px;">
          <tr><td style="padding:28px 32px;">
            <p style="margin:0 0 20px; font-size:11px; letter-spacing:0.25em; text-transform:uppercase; color:#7D6B5D; font-family:Arial,sans-serif; text-align:right;">${escapeHtml(panelTitle)}</p>
            <table dir="rtl" cellpadding="0" cellspacing="0" border="0" width="100%">${detailRows}
            </table>
          </td></tr>
        </table>` : '';

  return `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0; padding:0; background:#F9F7F2; font-family:Arial,Helvetica,sans-serif; color:#1A1A1B; line-height:1.7; -webkit-text-size-adjust:100%;">
  <table dir="rtl" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#F9F7F2;">
    <tr><td align="center" style="padding:32px 16px;">
      <table dir="rtl" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width:600px; width:600px; background:#FFFFFF; border:1px solid #E5DDD0; border-radius:6px; overflow:hidden;">
        <!-- Header -->
        <tr><td style="padding:40px 48px 30px; border-bottom:1px solid #E5DDD0; text-align:center;">
          <p style="margin:0 0 6px; font-family:Georgia,serif; font-size:24px; font-weight:bold; color:#1A1A1B; letter-spacing:-0.02em;">דורית גוב ארי</p>
          <p style="margin:0; font-size:10px; letter-spacing:0.3em; text-transform:uppercase; color:#7D6B5D;">התכנון שלי — השקט שלך</p>
        </td></tr>
        <!-- Body -->
        <tr><td style="padding:44px 48px 36px; text-align:right;">
          <p style="margin:0 0 20px; font-size:11px; letter-spacing:0.3em; text-transform:uppercase; color:#7D6B5D;">${escapeHtml(eyebrow)}</p>
          <h1 style="margin:0 0 24px; font-family:Georgia,serif; font-size:28px; font-weight:bold; color:#1A1A1B; line-height:1.3; letter-spacing:-0.02em; text-align:right;">${escapeHtml(heading)}</h1>
          <p style="margin:0 0 16px; font-size:15px; color:#3D3D3F; line-height:1.8; text-align:right;">${escapeHtml(greeting)}</p>
          <p style="margin:0 0 16px; font-size:15px; color:#3D3D3F; line-height:1.8; text-align:right;">${escapeHtml(intro)}</p>
          ${detailsBlock}${actionBlock(action)}
          <div style="height:2px; width:48px; background:#C3AD96; margin:32px 0 20px;"></div>
          <p style="margin:0; font-size:15px; color:#3D3D3F; line-height:1.8; text-align:right;">לכל שאלה או עדכון — ניתן להשיב ישירות למייל זה.</p>
        </td></tr>
        <!-- Signature -->
        <tr><td style="padding:0 48px 40px; text-align:right;">
          <p style="margin:0; font-family:Georgia,serif; font-size:18px; font-weight:bold; color:#1A1A1B;">דורית גוב ארי</p>
          <p style="margin:4px 0 0; font-size:13px; color:#7D6B5D;">מתכננת פיננסית בכירה · רישיון L-00107009</p>
          <p style="margin:8px 0 0; font-size:13px; color:#7D6B5D; direction:ltr; text-align:right;">dorit@govari-fin.co.il</p>
        </td></tr>
        <!-- Footer -->
        <tr><td style="padding:26px 48px; background:#1A1A1B; text-align:center;">
          <p style="margin:0 0 4px; font-size:11px; color:rgba(249,247,242,0.5); line-height:1.6;">דורית גוב ארי — מתכננת פיננסית וסוכנת ביטוח · רישיון סוכן מרשות שוק ההון מספר L-00107009</p>
          <p style="margin:0; font-size:10px; color:rgba(249,247,242,0.35); letter-spacing:0.15em; text-transform:uppercase;">Designed with Structural Serenity</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}
