import { createClientFromRequest } from 'npm:@base44/sdk@0.8.44';

const NOTIFY_EMAIL = "amielnoy@gmail.com";
const SECONDARY_EMAIL = "dorit@govari-fin.co.il";

function buildAgentBody(source, data) {
  const header = source === 'consultation'
    ? 'בקשת ייעוץ חדשה'
    : source === 'detailed'
    ? 'פנייה מפורטת מהאתר'
    : 'פנייה חדשה מהאתר';
  const lines = [
    `${header} — ${new Date().toLocaleString("he-IL")}`,
    ``,
    `שם: ${data.name}`,
    `טלפון: ${data.phone}`,
    `אימייל: ${data.email || '—'}`,
  ];
  if (source === 'consultation') {
    lines.push(`תחום ייעוץ: ${data.topic || '—'}`);
    lines.push(`מועד מבוקש: ${data.timing || 'לפי תיאום'}`);
    lines.push(`הערות: ${data.notes || '—'}`);
  } else if (source === 'detailed') {
    lines.push(`שירות מבוקש: ${data.topic || '—'}`);
    lines.push(`מועד מועדף ליצירת קשר: ${data.timing || '—'}`);
    lines.push(``, `הודעה אישית:`, data.message || '—');
  } else {
    lines.push(``, `הודעה:`, data.message || '—');
  }
  return lines.join('\n');
}

function buildClientBody(source, data) {
  const firstName = (data.name || '').split(' ')[0];
  const when = data.timing || 'לפי תיאום';
  if (source === 'consultation') {
    return [
      `שלום ${firstName}, קיבלתי את בקשת הייעוץ והפרטים תועדו בהצלחה.`,
      `נושא: ${data.topic || 'ייעוץ כללי'} · מועד מבוקש: ${when}`,
      `אחזור אליכם אישית תוך יום עסקים אחד לתיאום מדויק.`,
      `לכל שאלה — ניתן להשיב ישירות למייל זה.`,
      `בברכה, דורית גוב ארי · dorit@govari-fin.co.il`,
    ].join('\n');
  }
  return [
    `שלום ${firstName}, קיבלתי את פנייתכם והפרטים תועדו בהצלחה.`,
    `אחזור אליכם אישית בהקדם האפשרי.`,
    `לכל שאלה — ניתן להשיב ישירות למייל זה.`,
    `בברכה, דורית גוב ארי · dorit@govari-fin.co.il`,
  ].join('\n');
}

function subjectFor(source, data) {
  if (source === 'consultation') return `בקשת ייעוץ חדשה — ${data.name}`;
  if (source === 'detailed') return `פנייה מפורטת — ${data.name} (${data.topic || 'כללי'})`;
  return `פנייה חדשה מהאתר — ${data.name}`;
}

export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json();
    const { name, phone, email, source, topic, timing, message, notes } = body || {};

    if (!name || !phone) {
      return Response.json({ error: 'נדרשים שם וטלפון' }, { status: 400 });
    }

    const data = { name, phone, email, topic, timing, message, notes };
    const agentBody = buildAgentBody(source, data);
    const subject = subjectFor(source, data);

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
        const clientSubject = source === 'consultation'
          ? `אישור — קיבלנו את בקשת הייעוץ שלכם · דורית גוב ארי`
          : `אישור — קיבלנו את פנייתכם · דורית גוב ארי`;
        await base44.asServiceRole.integrations.Core.SendEmail({
          to: email,
          subject: clientSubject,
          body: buildClientBody(source, data),
        });
      } catch (e) { /* מיטבי */ }
    }

    // תיעוד הפנייה במאגר
    try {
      await base44.entities.Lead.create({
        name,
        phone,
        email: email || '',
        source: source || 'quick',
        topic: topic || '',
        timing: timing || '',
        message: message || notes || '',
        status: 'new',
      });
    } catch (e) { /* מיטבי */ }

    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}