/**
 * A conversation handed to a person — the agent has decided it may not answer.
 *
 * Where base44/functions/escalateToHuman used to do this work, and now forwards
 * here. Decided in docs/superpowers/specs/2026-10-12-connectors-off-base44-design.md:
 * Supabase is the only store (no entity write, no mirror), and the sheet row
 * goes in through the service account. tests/integration/
 * escalate-to-human.integration.test.ts runs it.
 */
import { channelLine, validCampaign, validChannel, validLandingPath } from '../_shared/attribution.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { deviceLabel } from '../_shared/device.ts';
import { createLog, newRequestId } from '../_shared/log.ts';
import { deliveryWarning, sendMail } from '../_shared/mail.ts';
import { clientIp, isEmail, oversizedField, sha256Hex, withinLimit } from '../_shared/guard.ts';
import { insertRow } from '../_shared/rest.ts';
import { opsNotice } from '../_shared/ops-notice.ts';
import { appendSheetRow } from '../_shared/sheets.ts';
import {
  HUMAN_CONTACT, NOTIFY_EMAILS, REASONS, SECONDARY_EMAIL, SHEET_COLUMNS, SHEET_TAB, URGENT,
  buildEscalationHtml, buildNotification, redact, validPhone,
} from './escalation.js';
// escalation.js is plain JavaScript, as Base44's file was. The few casts below
// tell Deno's checker the shapes it cannot infer from it.

const FN = 'escalate-to-human';
const log = createLog(FN);

// The global cap on the staff's mail. Urgent reasons (URGENT: a complaint, a
// privacy request…) are never held back by it — a hand-off that does not reach
// a person is a regulatory failure — and hitting it alerts (an error line).
const NOTIFY_PER_HOUR = 60;
/**
 * Hand-offs per caller. Generous: a Base44 agent's call reaches this function
 * from Base44's server, so its address stands for every visitor those agents
 * serve. Urgent reasons are never refused by it either.
 */
const HANDOFFS_PER_IP_PER_HOUR = 20;
/** Longest value accepted per field: generous for a person, useless for a payload. */
const FIELD_LIMITS = { name: 80, phone: 30, email: 254, topic: 200, agent: 60, summary: 8000 };

// Every `err:` below is truncated inline: tests/contract/logging.contract.test.ts
// reads each log call's text and requires the `.slice(0, N)` to be visible there.

export async function handler(req: Request): Promise<Response> {
  const cors = corsHeaders(req.headers.get('origin'));
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

  const rid = newRequestId();
  const startedAt = Date.now();
  try {
    log('info', 'request.start', { rid });
    const body = await req.json();
    const { reason, summary, name, phone, email, agent, topic, consentVersion, consentAt, channel, campaign, landingPath } = body || {};

    // An empty request is not a hand-off: nobody to call back and nothing said.
    // It would mail staff a blank message, so it stops here. A summary alone is
    // enough — an anonymous visitor may still ask to be put through to a person.
    const present = (v: unknown) => String(v ?? '').trim() !== '';
    if (!present(summary) && !present(name) && !present(phone) && !present(email)) {
      log('warn', 'request.rejected', { rid, reason: 'nothing_to_hand_over' });
      return Response.json({ error: 'אין מה להעביר', rid }, { status: 400, headers: cors });
    }

    const oversized = oversizedField(body ?? {}, FIELD_LIMITS);
    if (oversized) {
      log('warn', 'request.rejected', { rid, reason: 'field_too_long', field: oversized });
      return Response.json({ error: 'אחד השדות ארוך מדי. אפשר לקצר ולשלוח שוב.', rid }, { status: 400, headers: cors });
    }

    const reasonKnown = Object.prototype.hasOwnProperty.call(REASONS, reason);
    const urgent = reasonKnown && URGENT.has(reason);
    const ip = clientIp(req);
    if (!urgent && ip && !(await withinLimit(log, rid, `escalate-ip:${await sha256Hex(ip)}`, 3600, HANDOFFS_PER_IP_PER_HOUR))) {
      log('warn', 'request.rejected', { rid, reason: 'rate_limited' });
      return Response.json(
        { error: 'התקבלו כמה בקשות ברצף. אפשר לנסות שוב בעוד שעה, או לפנות לדורית ישירות.', rid },
        { status: 429, headers: cors },
      );
    }

    const safeChannel = validChannel(channel) || 'unknown';
    const safeCampaign = validCampaign(campaign);
    const safeLandingPath = validLandingPath(landingPath);

    const safeReason: string = reasonKnown ? reason : 'uncertain';
    const reasonText = (REASONS as Record<string, string>)[safeReason];
    const safeSummary: string = redact(summary);
    const contactable = Boolean(name && phone && validPhone(phone));

    // ── סדר הפעולות ─────────────────────────────────────────────────────
    // ההודעה לדורית היא העיקר: העברה לאדם שלא הגיעה לאדם היא כישלון
    // רגולטורי, לא רק תקלה. לכן היא נשלחת גם כשאין פרטי קשר לשמור, וכשל
    // בשמירה במאגר אינו מונע אותה.
    const warnings: string[] = [];
    let leadId: string | null = null;
    // Something that is not an address is dropped rather than refusing the
    // hand-off: the phone still reaches Dorit, and a bad address mails nobody.
    if (email && !isEmail(email)) {
      log('warn', 'escalation.email_dropped', { rid, reason: 'invalid_address' });
      warnings.push('email_invalid');
    }
    const safeEmail = email && isEmail(email) ? email : '';

    // הסיבה והסוכן — לא התקציר. ההעברה היא האירוע שהכי חשוב לעקוב אחריו,
    // והתקציר הוא בדיוק מה שהמבקר אמר.
    log('info', 'escalation.received', { rid, reason: safeReason, agent: agent || 'unknown', contactable });

    if (contactable) {
      try {
        const row = await insertRow('leads', {
          name,
          phone,
          email: safeEmail,
          source: 'escalation',
          topic: topic || reasonText,
          timing: '',
          message: `[הועבר לטיפול אנושי — ${reasonText}]\n\n${safeSummary}`,
          status: 'escalated',
          escalation_reason: safeReason,
          handled_by_agent: agent || '',
          consent_version: consentVersion || '',
          // A timestamptz: absent is null, as the mirror wrote it — '' is refused.
          consent_at: consentAt || null,
          channel: safeChannel,
          campaign: safeCampaign,
        });
        leadId = typeof row.id === 'string' ? row.id : null;
      } catch (e) {
        log('error', 'lead.create_failed', { rid, err: String((e as Error)?.message ?? e).slice(0, 200) });
        warnings.push('lead_write_failed');
      }
    } else {
      log('info', 'escalation.anonymous', { rid, reason: safeReason });
      warnings.push('no_contact_details');
    }

    const escalationAttribution = { channel: safeChannel, campaign: safeCampaign, landingPath: safeLandingPath };
    const notification: string = buildNotification(safeReason, { name, phone, email: safeEmail, agent, summary: safeSummary, device: deviceLabel(req.headers.get('user-agent')), ...escalationAttribution });
    const subject = `${URGENT.has(safeReason) ? '🔴 ' : ''}העברה לטיפול אנושי — ${reasonText}${name ? ` · ${name}` : ''}`;
    const escalationHtml: string = buildEscalationHtml(safeReason, {
      name, phone, email: safeEmail, agent, summary: safeSummary, contactable,
      device: deviceLabel(req.headers.get('user-agent')),
      ...escalationAttribution,
    });

    // The operating team is told that a hand-off happened and why, never who
    // asked or what they said (N-02): Dorit gets the whole of it.
    const notice = opsNotice(`${URGENT.has(safeReason) ? '🔴 ' : ''}העברה לטיפול אנושי — ${reasonText}`, [
      ['סוכן', agent || ''],
      ['מזהה רשומה', leadId || (contactable ? 'לא נשמרה' : 'אין — לא נמסרו פרטי קשר')],
      ...(channelLine(escalationAttribution) ? [['הגיע/ה דרך', channelLine(escalationAttribution)] as [string, string]] : []),
    ]);

    let notified = false;
    // Checked once per hand-off, not once per recipient. Over the cap the lead
    // and the sheet row are still written; only the staff mail is held back.
    const mayNotify = urgent || (await withinLimit(log, rid, 'escalate:notify', 3600, NOTIFY_PER_HOUR));
    if (!mayNotify) {
      // An error, so it alerts: hand-offs are arriving faster than anyone should.
      log('error', 'mail.skipped', { rid, role: 'ops', reason: 'rate_limited' });
      warnings.push('notify_rate_limited');
    }
    // One sender for all three, through the mailer.
    for (const to of mayNotify ? [...NOTIFY_EMAILS, SECONDARY_EMAIL] : []) {
      try {
        const forDorit = to === SECONDARY_EMAIL;
        await sendMail(log, {
          to,
          subject: forDorit ? subject : notice.subject,
          html: forDorit ? escalationHtml : notice.html,
          text: forDorit ? notification : notice.text,
          body: forDorit ? notification : notice.text,
          rid,
          role: forDorit ? 'agency' : 'ops',
        });
        notified = true;
      } catch (e) {
        // ההתראה שלא יצאה היא הכשל היחיד כאן שהוא רגולטורי ולא תפעולי.
        log('error', 'mail.failed', { rid, role: to === SECONDARY_EMAIL ? 'agency' : 'ops', err: String((e as Error)?.message ?? e).slice(0, 200) });
        warnings.push(deliveryWarning('notify_email_failed', e));
      }
    }

    // רישום ביומן האירועים — מיטבי, ואחרי ההתראה. התראה שלא יצאה היא כשל
    // רגולטורי; שורה שלא נרשמה בגיליון אינה, ולכן הגיליון אף פעם לא חוסם.
    try {
      await appendSheetRow(SHEET_TAB, SHEET_COLUMNS.length, [
        new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Jerusalem' }),
        'conversation_escalation',
        'escalation',
        '',                       // מסלול — רלוונטי רק בראיון
        agent || '',
        topic || reasonText,
        '',                       // מועד מבוקש — אין בהעברה לאדם
        name || '',
        phone || '',
        safeEmail,
        leadId || '',
        safeReason,
        safeSummary,
        // שש עמודות הראיון. העברה לאדם אינה ראיון ואין לה מה למלא בהן — ריק
        // ולא מושמט, אחרת השורה מתקצרת והכותרות מפסיקות להתיישר.
        '', '', '', '', '', '',
      ]);
      log('info', 'sheet.appended', { rid, tab: SHEET_TAB });
    } catch (e) {
      log('warn', 'sheet.append_failed', { rid, tab: SHEET_TAB, err: String((e as Error)?.message ?? e).slice(0, 200) });
      warnings.push('sheet_append_failed');
    }

    // התשובה נבנית כדי שהסוכן יוכל להקריא אותה כמות שהיא. גם כשהכל נכשל
    // המבקר מקבל דרך ישירה לאדם — זו הנקודה שבה אסור להשאיר אותו בלי מענה.
    const acknowledgement = contactable
      ? 'הפרטים הועברו לדורית והיא תחזור אישית תוך יום עסקים אחד.'
      : 'אפשר לפנות לדורית ישירות בכל אחד מהערוצים הבאים.';

    log('info', 'request.end', { rid, ms: Date.now() - startedAt, reason: safeReason, notified, recorded: leadId !== null, warnings: warnings.length });
    return Response.json({
      ok: true,
      rid,
      leadId,
      recorded: leadId !== null,
      notified,
      reason: safeReason,
      contact: HUMAN_CONTACT,
      acknowledgement,
      warnings,
    }, { headers: cors });
  } catch (error) {
    log('error', 'request.failed', { rid, ms: Date.now() - startedAt, err: String((error as Error)?.message ?? error).slice(0, 200) });
    // גם מסלול הכישלון מחזיר ערוצי קשר — סוכן שנתקל בשגיאה עדיין חייב
    // להיות מסוגל למסור למבקר איך להגיע לאדם.
    return Response.json(
      {
        ok: false,
        rid,
        contact: HUMAN_CONTACT,
        acknowledgement: 'אפשר לפנות לדורית ישירות בטלפון או בוואטסאפ.',
      },
      { status: 200, headers: cors },
    );
  }
}
