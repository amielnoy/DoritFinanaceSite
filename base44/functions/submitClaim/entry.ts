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
        const clientBody = [
          `שלום ${(name || '').split(' ')[0]}, קיבלתי את דיווח האירוע הביטוחי והפרטים תועדו בהצלחה.`,
          `סוג אירוע: ${claimType || 'כללי'} · תאריך: ${eventDate || '—'}`,
          `אחזור אליכם אישית בהקדם האפשרי להמשך טיפול התביעה.`,
          `לכל שאלה — ניתן להשיב ישירות למייל זה.`,
          `בברכה, דורית גוב ארי · dorit@govari-fin.co.il`,
        ].join('\n');
        await base44.asServiceRole.integrations.Core.SendEmail({
          to: email,
          subject: `אישור — קיבלנו את דיווח האירוע שלכם · דורית גוב ארי`,
          body: clientBody,
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