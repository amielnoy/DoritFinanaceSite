import { createClientFromRequest } from 'npm:@base44/sdk@0.8.44';

const NOTIFY_EMAIL = "amielnoy@gmail.com";
const SECONDARY_EMAIL = "dorit@govari-fin.co.il";

export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json();
    const { name, phone, email, claimType, eventDate, policyNumber, description, documents } = body || {};

    if (!name || !phone) {
      return Response.json({ error: 'נדרשים שם וטלפון' }, { status: 400 });
    }

    const docList = Array.isArray(documents) ? documents : [];
    const docLines = docList.length
      ? [``, `מסמכים מצורפים (${docList.length}):`, ...docList.map((d, i) => `${i + 1}. ${d}`)]
      : ['', 'מסמכים מצורפים: אין'];

    const agentBody = [
      `דיווח אירוע ביטוחי חדש — ${new Date().toLocaleString("he-IL")}`,
      ``,
      `שם: ${name}`,
      `טלפון: ${phone}`,
      `אימייל: ${email || '—'}`,
      `סוג אירוע: ${claimType || '—'}`,
      `תאריך אירוע: ${eventDate || '—'}`,
      `מספר פוליסה: ${policyNumber || '—'}`,
      ``,
      `תיאור האירוע:`,
      description || '—',
      ...docLines,
    ].join('\n');

    const subject = `דיווח אירוע ביטוחי — ${name} (${claimType || 'כללי'})`;

    // הודעה לסוכנת — חובה
    await base44.asServiceRole.integrations.Core.SendEmail({
      to: NOTIFY_EMAIL,
      subject,
      body: agentBody,
    });

    // עותק לדורית — מיטבי
    try {
      await base44.asServiceRole.integrations.Core.SendEmail({
        to: SECONDARY_EMAIL,
        subject,
        body: agentBody,
      });
    } catch (e) { /* מיטבי */ }

    // אישור ללקוח — מיטבי
    if (email) {
      try {
        const firstName = (name || '').split(' ')[0];
        const claimTypeLabel = claimType || 'כללי';
        const eventDateLabel = eventDate || '—';
        const clientHtml = `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0; padding:0; background:#F9F7F2; font-family:Arial,Helvetica,sans-serif; color:#1A1A1B; line-height:1.7;">
  <table cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#F9F7F2;">
    <tr><td align="center" style="padding:32px 16px;">
      <table cellpadding="0" cellspacing="0" border="0" width="600" style="max-width:600px; background:#FFFFFF; border:1px solid #E5DDD0;">
        <tr><td style="padding:36px 48px 28px; border-bottom:1px solid #E5DDD0; text-align:center;">
          <p style="margin:0 0 6px; font-family:Georgia,serif; font-size:22px; font-weight:bold; color:#1A1A1B; letter-spacing:-0.02em;">דורית גוב ארי</p>
          <p style="margin:0; font-size:10px; letter-spacing:0.3em; text-transform:uppercase; color:#7D6B5D;">התכנון שלי — הרווח שלך</p>
        </td></tr>
        <tr><td style="padding:40px 48px;">
          <p style="margin:0 0 24px; font-size:11px; letter-spacing:0.3em; text-transform:uppercase; color:#7D6B5D;">אישור דיווח</p>
          <h1 style="margin:0 0 20px; font-family:Georgia,serif; font-size:28px; font-weight:bold; color:#1A1A1B; line-height:1.25; letter-spacing:-0.02em;">קיבלנו את דיווח האירוע</h1>
          <p style="margin:0 0 16px; font-size:15px; color:#3D3D3F; line-height:1.8;">שלום ${firstName},</p>
          <p style="margin:0 0 16px; font-size:15px; color:#3D3D3F; line-height:1.8;">קיבלתי את דיווח האירוע הביטוחי והפרטים תועדו בהצלחה. אחזור אליכם אישית בהקדם האפשרי להמשך טיפול התביעה וליווי צמוד ברגע האמת.</p>
          <table cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:28px 0; background:#F3EDE7; border:1px solid #D3C6B9; border-radius:4px;">
            <tr><td style="padding:24px 28px;">
              <p style="margin:0 0 16px; font-size:11px; letter-spacing:0.25em; text-transform:uppercase; color:#7D6B5D; font-family:Arial,sans-serif;">פרטי האירוע</p>
              <table cellpadding="0" cellspacing="0" border="0" width="100%">
                <tr>
                  <td style="padding:6px 0; font-size:13px; color:#7D6B5D; font-family:Arial,sans-serif; width:120px;">סוג אירוע</td>
                  <td style="padding:6px 0; font-size:15px; color:#1A1A1B; font-family:Georgia,serif; font-weight:bold;">${claimTypeLabel}</td>
                </tr>
                <tr>
                  <td style="padding:6px 0; font-size:13px; color:#7D6B5D; font-family:Arial,sans-serif;">תאריך אירוע</td>
                  <td style="padding:6px 0; font-size:15px; color:#1A1A1B; font-family:Georgia,serif; font-weight:bold;">${eventDateLabel}</td>
                </tr>
              </table>
            </td></tr>
          </table>
          <div style="height:2px; width:48px; background:#C3AD96; margin:28px 0;"></div>
          <p style="margin:0 0 8px; font-size:15px; color:#3D3D3F; line-height:1.8;">לכל שאלה או עדכון — ניתן להשיב ישירות למייל זה.</p>
        </td></tr>
        <tr><td style="padding:0 48px 40px;">
          <p style="margin:0; font-family:Georgia,serif; font-size:17px; font-weight:bold; color:#1A1A1B;">דורית גוב ארי</p>
          <p style="margin:4px 0 0; font-size:13px; color:#7D6B5D;">מתכננת פיננסית בכירה · רישיון L-00107009</p>
          <p style="margin:8px 0 0; font-size:13px; color:#7D6B5D; direction:ltr; text-align:right;">dorit@govari-fin.co.il</p>
        </td></tr>
        <tr><td style="padding:24px 48px; background:#1A1A1B; text-align:center;">
          <p style="margin:0 0 4px; font-size:11px; color:rgba(249,247,242,0.5);">דורית גוב ארי — סוכנות ביטוח בע״מ · רישיון סוכן מרשות שוק ההון מספר L-00107009</p>
          <p style="margin:0; font-size:10px; color:rgba(249,247,242,0.35); letter-spacing:0.15em; text-transform:uppercase;">Designed with Structural Serenity</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
        const clientText = [
          `שלום ${firstName}, קיבלתי את דיווח האירוע הביטוחי והפרטים תועדו בהצלחה.`,
          `סוג אירוע: ${claimTypeLabel} · תאריך: ${eventDateLabel}`,
          `אחזור אליכם אישית בהקדם האפשרי להמשך טיפול התביעה.`,
          `לכל שאלה — ניתן להשיב ישירות למייל זה.`,
          `בברכה, דורית גוב ארי · dorit@govari-fin.co.il`,
        ].join('\n');
        await base44.asServiceRole.integrations.Core.SendEmail({
          to: email,
          subject: `אישור — קיבלנו את דיווח האירוע שלכם · דורית גוב ארי`,
          html: clientHtml,
          text: clientText,
        });
      } catch (e) { /* מיטבי */ }
    }

    // תיעוד הפנייה במאגר
    try {
      const messageBody = [
        `סוג: ${claimType || ''}`,
        `תאריך אירוע: ${eventDate || ''}`,
        `פוליסה: ${policyNumber || ''}`,
        ``,
        description || '',
        ``,
        docList.length ? `מסמכים: ${docList.join(' | ')}` : '',
      ].filter(Boolean).join('\n');
      await base44.entities.Lead.create({
        name,
        phone,
        email: email || '',
        source: 'claim',
        topic: claimType || '',
        timing: eventDate || '',
        message: messageBody,
        status: 'new',
      });
    } catch (e) { /* מיטבי */ }

    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}