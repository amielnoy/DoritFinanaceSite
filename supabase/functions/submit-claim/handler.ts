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
import { deliveryWarning, mailerConfigured, sendMail } from '../_shared/mail.ts';
import { insertRow, signStorageUrl, supabaseConfigured } from '../_shared/rest.ts';
import {
  clientIp,
  greetingName,
  isEmail,
  isoDateOr,
  knownOr,
  oversizedField,
  sha256Hex,
  withinLimit,
} from '../_shared/guard.ts';

const FN = 'submit-claim';
const log = createLog(FN);

/** The claim form's own list (src/components/dorit/forms/ClaimForm.tsx); the
 *  confirmation names one of these or none. A contract test keeps them equal. */
export const CLAIM_TYPES = [
  'ביטוח בריאות משלים',
  'ביטוח חיים / מקרה מוות',
  'אובדן כושר עבודה',
  'רכוש / דירה / רכב',
  'אחר',
] as const;

/** Claims from one address, per hour. A family reporting two events fits; a script does not. */
const CLAIMS_PER_IP_PER_HOUR = 5;
/** Confirmations to one mailbox, per day — the limit that protects a stranger's inbox. */
const CONFIRMATIONS_PER_ADDRESS_PER_DAY = 3;

/** A document the browser uploaded to Supabase Storage, by path (SupabaseUploadService). */
export const STORAGE_REF_PREFIX = 'storage:claim-documents/';
/** How long the link in the notification mail opens the document. Past that, the admin screen signs a fresh one. */
const MAIL_LINK_SECONDS = 7 * 24 * 60 * 60;

// Several mailboxes, one team — see the note in base44/functions/submitLead/entry.ts.
const NOTIFY_EMAILS = ['amielnoy@gmail.com', 'amielnoy@outlook.com'];
const SECONDARY_EMAIL = 'dorit@govari-fin.co.il';

/** What changes in this function's confirmation — the content only; the template is shared. */
function clientMailFor(data: { name?: string; claimType?: string; eventDate?: string }): ClientMail {
  return {
    firstName: greetingName(data.name),
    eyebrow: 'אישור דיווח',
    heading: 'קיבלנו את דיווח האירוע',
    intro: 'קיבלתי את דיווח האירוע הביטוחי והפרטים תועדו בהצלחה. אחזור אליכם אישית בהקדם האפשרי להמשך טיפול התביעה וליווי צמוד ברגע האמת.',
    panelTitle: 'פרטי האירוע',
    // '—' rather than '': buildClientHtml drops rows with no value, so an empty
    // string would take the row out of the HTML while the plain-text twin went
    // on printing it — the two halves of one email disagreeing about which
    // fields exist. A claim filed without a date should say so in both.
    // Only values this code recognises: a type from the form's list and an
    // ISO date. Whatever else was typed stays in Dorit's copy, not the
    // visitor's — the visitor's copy goes to an address nobody verified.
    details: [
      ['סוג אירוע', knownOr(data.claimType, CLAIM_TYPES, 'כללי')],
      ['תאריך אירוע', isoDateOr(data.eventDate, '—')],
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
      // `ready` answers the production smoke's empty claim: whether a real one
      // could be saved and announced. Two booleans — never a setting's value.
      // The mailer secrets are set by hand and the deploy token cannot read
      // them, so this is the only check that sees one go missing.
      const ready = { db: supabaseConfigured(), mailer: mailerConfigured() };
      return Response.json({ error: 'נדרשים שם וטלפון', rid, ready }, { status: 400, headers: cors });
    }

    const oversized = oversizedField(body);
    if (oversized) {
      log('warn', 'request.rejected', { rid, reason: 'field_too_long', field: oversized });
      return Response.json({ error: 'אחד השדות ארוך מדי. אפשר לקצר ולשלוח שוב.', rid }, { status: 400, headers: cors });
    }

    const ip = clientIp(req);
    if (ip && !(await withinLimit(log, rid, `claim-ip:${await sha256Hex(ip)}`, 3600, CLAIMS_PER_IP_PER_HOUR))) {
      log('warn', 'request.rejected', { rid, reason: 'rate_limited' });
      return Response.json(
        { error: 'התקבלו כמה דיווחים ברצף. אפשר לנסות שוב בעוד שעה, או לפנות לדורית ישירות.', rid },
        { status: 429, headers: cors },
      );
    }

    const docList: string[] = Array.isArray(documents) ? documents : [];
    // A document uploaded to Supabase Storage arrives as its path; the record
    // keeps the path, and the notification gets a link that expires. One that
    // cannot be signed is listed by path, so Dorit still knows it exists.
    const docLinks = await Promise.all(docList.map(async (d) => {
      if (!d.startsWith(STORAGE_REF_PREFIX)) return d;
      try {
        return await signStorageUrl('claim-documents', d.slice(STORAGE_REF_PREFIX.length), MAIL_LINK_SECONDS);
      } catch (e) {
        log('warn', 'document.sign_failed', { rid, err: String((e as Error)?.message ?? e).slice(0, 200) });
        return d;
      }
    }));
    const docLines = docList.length
      ? [
          ``,
          `מסמכים מצורפים (${docList.length}):`,
          ...docLinks.map((d, i) => `${i + 1}. ${d}`),
          // Only files in Supabase Storage expire (claim_documents_expired,
          // migration 20261023000000): two months, then gone.
          ...(docList.some((d) => d.startsWith(STORAGE_REF_PREFIX))
            ? [`הקישורים בתוקף שבוע, והקבצים נמחקים מהאתר אחרי חודשיים — כדאי לשמור אותם בתיק הלקוח.`]
            : []),
        ]
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

    // The reporter's confirmation — best effort, and only to something that is
    // an address, at most a few times a day per address.
    if (email && !isEmail(email)) {
      log('warn', 'mail.skipped', { rid, role: 'visitor', reason: 'invalid_address' });
      warnings.push('client_email_invalid');
    } else if (email && !(await withinLimit(log, rid, `confirm-to:${await sha256Hex(email.toLowerCase())}`, 86400, CONFIRMATIONS_PER_ADDRESS_PER_DAY))) {
      log('warn', 'mail.skipped', { rid, role: 'visitor', reason: 'rate_limited' });
      warnings.push('client_confirmation_rate_limited');
    } else if (email) {
      try {
        const firstName = greetingName(name);
        const clientText = [
          `${firstName ? `שלום ${firstName}, ` : 'שלום, '}קיבלתי את דיווח האירוע הביטוחי והפרטים תועדו בהצלחה.`,
          `סוג אירוע: ${knownOr(claimType, CLAIM_TYPES, 'כללי')} · תאריך: ${isoDateOr(eventDate, '—')}`,
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
