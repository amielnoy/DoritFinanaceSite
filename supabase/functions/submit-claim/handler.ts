/**
 * A claim report: saved first, then announced.
 *
 * The Supabase twin of base44/functions/submitClaim — same input, same checks,
 * same mail — except that the record is written to Supabase, the only store
 * from here on. tests/integration/submit-claim.integration.test.ts runs both
 * against one set of cases while both exist.
 */
import { channelLine, validCampaign, validChannel, validLandingPath } from '../_shared/attribution.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { deviceLabel } from '../_shared/device.ts';
import { buildClientHtml, type ClientMail } from '../_shared/html.ts';
import { createLog, newRequestId } from '../_shared/log.ts';
import { deliveryWarning, sendMail } from '../_shared/mail.ts';
import { insertRow } from '../_shared/rest.ts';

const FN = 'submit-claim';
const log = createLog(FN);

// Several mailboxes, one team — see the note in base44/functions/submitLead/entry.ts.
const NOTIFY_EMAILS = ['amielnoy@gmail.com', 'amielnoy@outlook.com'];
const SECONDARY_EMAIL = 'dorit@govari-fin.co.il';

/** What changes in this function's confirmation — the content only; the template is shared. */
function clientMailFor(data: { name?: string; claimType?: string; eventDate?: string }): ClientMail {
  return {
    firstName: (data.name || '').split(' ')[0],
    eyebrow: 'אישור דיווח',
    heading: 'קיבלנו את דיווח האירוע',
    intro: 'קיבלתי את דיווח האירוע הביטוחי והפרטים תועדו בהצלחה. אחזור אליכם אישית בהקדם האפשרי להמשך טיפול התביעה וליווי צמוד ברגע האמת.',
    panelTitle: 'פרטי האירוע',
    // '—' rather than '': buildClientHtml drops rows with no value, so an empty
    // string would take the row out of the HTML while the plain-text twin went
    // on printing it — the two halves of one email disagreeing about which
    // fields exist. A claim filed without a date should say so in both.
    details: [
      ['סוג אירוע', data.claimType || 'כללי'],
      ['תאריך אירוע', data.eventDate || '—'],
    ],
  };
}

// Every `err:` below is truncated inline: tests/contract/logging.contract.test.ts
// reads each log call's text and requires the `.slice(0, N)` to be visible there.

export async function handler(req: Request): Promise<Response> {
  const cors = corsHeaders(req.headers.get('origin'));
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

  const rid = newRequestId();
  const startedAt = Date.now();
  try {
    log('info', 'request.start', { rid, source: 'claim' });
    // A body that is not JSON is answered as what it amounts to — no name and
    // no phone — rather than as a server fault.
    const body = await req.json().catch(() => null);
    const { name, phone, email, claimType, eventDate, policyNumber, description, documents, channel, campaign, landingPath } = body || {};
    const safeChannel = validChannel(channel) || 'unknown';
    const safeCampaign = validCampaign(campaign);
    const safeLandingPath = validLandingPath(landingPath);

    if (!name || !phone) {
      log('warn', 'request.rejected', { rid, reason: 'missing_contact_fields' });
      return Response.json({ error: 'נדרשים שם וטלפון', rid }, { status: 400, headers: cors });
    }

    const docList: unknown[] = Array.isArray(documents) ? documents : [];
    const docLines = docList.length
      ? [``, `מסמכים מצורפים (${docList.length}):`, ...docList.map((d, i) => `${i + 1}. ${d}`)]
      : ['', 'מסמכים מצורפים: אין'];

    const claimChannelText = channelLine({ channel: safeChannel, campaign: safeCampaign, landingPath: safeLandingPath });
    const agentBody = [
      `דיווח אירוע ביטוחי חדש — ${new Date().toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem' })}`,
      ``,
      `שם: ${name}`,
      `טלפון: ${phone}`,
      `אימייל: ${email || '—'}`,
      `נשלח מ: ${deviceLabel(req.headers.get('user-agent'))}`,
      ...(claimChannelText ? [`הגיע/ה דרך: ${claimChannelText}`] : []),
      `סוג אירוע: ${claimType || '—'}`,
      `תאריך אירוע: ${eventDate || '—'}`,
      `מספר פוליסה: ${policyNumber || '—'}`,
      ``,
      `תיאור האירוע:`,
      description || '—',
      ...docLines,
    ].join('\n');

    const subject = `דיווח אירוע ביטוחי — ${name} (${claimType || 'כללי'})`;

    // הפנייה נשמרת ראשונה — ראו את ההסבר ב-submitLead.
    // The record is written first; see submitLead for the reasoning.
    const messageBody = [
      `סוג: ${claimType || ''}`,
      `תאריך אירוע: ${eventDate || ''}`,
      `פוליסה: ${policyNumber || ''}`,
      ``,
      description || '',
      ``,
      docList.length ? `מסמכים: ${docList.join(' | ')}` : '',
    ].filter(Boolean).join('\n');

    let leadId: string | null = null;
    try {
      const row = await insertRow('leads', {
        name,
        phone,
        email: email || '',
        source: 'claim',
        topic: claimType || '',
        timing: eventDate || '',
        message: messageBody,
        status: 'new',
        channel: safeChannel,
        campaign: safeCampaign,
      });
      leadId = typeof row.id === 'string' ? row.id : null;
      log('info', 'lead.created', { rid, leadId, source: 'claim' });
    } catch (e) {
      // The one hard failure: a report nobody stored is never announced.
      log('error', 'lead.create_failed', { rid, err: String((e as Error)?.message ?? e).slice(0, 200) });
      return Response.json(
        { error: 'לא הצלחנו לשמור את הדיווח. נסו שוב או צרו קשר ישירות.', rid },
        { status: 500, headers: cors },
      );
    }

    const warnings: string[] = [];

    // The operations mailboxes — one that fails does not stop the others.
    for (const to of NOTIFY_EMAILS) {
      try {
        await sendMail(log, { to, subject, body: agentBody, rid, role: 'ops' });
      } catch (e) {
        log('warn', 'mail.failed', { rid, role: 'ops', err: String((e as Error)?.message ?? e).slice(0, 200) });
        warnings.push(deliveryWarning('notify_email_failed', e));
      }
    }

    // Dorit's copy.
    try {
      await sendMail(log, { to: SECONDARY_EMAIL, subject, body: agentBody, rid, role: 'agency' });
    } catch (e) {
      log('warn', 'mail.failed', { rid, role: 'agency', err: String((e as Error)?.message ?? e).slice(0, 200) });
      warnings.push(deliveryWarning('secondary_email_failed', e));
    }

    // The reporter's confirmation — best effort.
    if (email) {
      try {
        const firstName = (name || '').split(' ')[0];
        const clientText = [
          `שלום ${firstName}, קיבלתי את דיווח האירוע הביטוחי והפרטים תועדו בהצלחה.`,
          `סוג אירוע: ${claimType || 'כללי'} · תאריך: ${eventDate || '—'}`,
          `אחזור אליכם אישית בהקדם האפשרי להמשך טיפול התביעה.`,
          `לכל שאלה — ניתן להשיב ישירות למייל זה.`,
          `בברכה, דורית גוב ארי · dorit@govari-fin.co.il`,
        ].join('\n');
        await sendMail(log, {
          to: email,
          subject: `אישור — קיבלנו את דיווח האירוע שלכם · דורית גוב ארי`,
          html: buildClientHtml(clientMailFor({ name, claimType, eventDate })),
          text: clientText,
          rid,
          role: 'visitor',
        });
      } catch (e) {
        log('warn', 'mail.failed', { rid, role: 'visitor', err: String((e as Error)?.message ?? e).slice(0, 200) });
        warnings.push(deliveryWarning('client_confirmation_failed', e));
      }
    }

    log('info', 'request.end', { rid, ms: Date.now() - startedAt, leadId, warnings: warnings.length });
    return Response.json({ ok: true, rid, leadId, warnings }, { headers: cors });
  } catch (error) {
    log('error', 'request.failed', { rid, ms: Date.now() - startedAt, err: String((error as Error)?.message ?? error).slice(0, 200) });
    return Response.json(
      { error: 'השמירה נכשלה. אפשר לנסות שוב, או לפנות לדורית ישירות.', rid },
      { status: 500, headers: cors },
    );
  }
}
