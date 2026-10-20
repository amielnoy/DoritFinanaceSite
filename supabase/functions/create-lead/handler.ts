/**
 * "הוספת פנייה" on /admin/leads: a member of the agency adds a lead they met
 * or spoke to themselves (docs/superpowers/specs/2026-10-20-staff-lead-design.md).
 *
 * POST { agencyId, name, phone, email?, topic?, notes?, intake, referrer?,
 *        status, notice, assignee?, duplicateOk? } with the caller's session.
 *   1. The session, then at least User in that agency (_shared/staff.ts).
 *   2. The input, then 60 creates per member per hour.
 *   3. The lead, through create_staff_lead under the caller's own token: the
 *      database decides who may, whose the lead is, and whether it is a
 *      duplicate. Source, consent and brought_by are set there, never here.
 *      Staff text is `notes`, never `summary` or `message` (the client sees those).
 *   4. Side effects, each on its own so none can undo the lead: the sheet row,
 *      the assignment mail, a notice to the agency's Admins and Owners, and the
 *      privacy notice to the client when the member chose email.
 *
 * A visible duplicate is answered 409 with that lead's id (the caller can see
 * it). A hidden one is answered 200 and says nothing of whose it matched: the
 * answer and the notice carry the new lead's id only.
 *
 * Logged by ids alone: the client's name, phone and address stay out.
 */
import { corsHeaders } from '../_shared/cors.ts';
import { isEmail, oversizedField, sha256Hex, withinLimit } from '../_shared/guard.ts';
import { createLog, newRequestId } from '../_shared/log.ts';
import { deliveryWarning, sendMail } from '../_shared/mail.ts';
import { AGENCY_1, normalizePhone } from '../_shared/masleka.ts';
import { opsNotice, type OpsRow } from '../_shared/ops-notice.ts';
import { contactPhone } from '../_shared/phone.ts';
import { callRpc, refusalReason, selectRows } from '../_shared/rest.ts';
import { appendSheetRow } from '../_shared/sheets.ts';
import { requireAgencyRole } from '../_shared/staff.ts';
import { assignmentMail } from '../assign-lead/handler.ts';
import { redact, SHEET_COLUMNS, SHEET_TAB } from '../submit-lead/lead.js';
import { noticeMail } from './notice.ts';

const FN = 'create-lead';
const log = createLog(FN);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const INTAKES = ['phone', 'in_person', 'referral', 'event', 'existing_client', 'other'];
const STATUSES = ['new', 'contacted', 'client'];
const NOTICES = ['verbal', 'email', 'whatsapp'];
/** The same limits create_staff_lead enforces; the function refuses first, in Hebrew. */
const LIMITS = { name: 80, phone: 30, email: 254, topic: 200, notes: 4000, referrer: 120 };

/** The RPC's own refusals, as a person can read them. */
const REFUSALS: Record<string, string> = {
  bad_status: 'הסטטוס אינו מוכר.',
  bad_intake: 'דרך ההגעה אינה מוכרת.',
  bad_notice: 'אופן ההודעה על הפרטיות אינו תקין.',
  field_required: 'שם וטלפון הם שדות חובה.',
  field_too_long: 'אחד השדות ארוך מדי.',
  assignee_not_member: 'מי שנבחר/ה אינו/ה חבר/ת הסוכנות.',
};

const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

export async function handler(req: Request): Promise<Response> {
  const cors = corsHeaders(req.headers.get('origin'));
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

  const rid = newRequestId();
  const startedAt = Date.now();
  const json = (body: Record<string, unknown>, status = 200) => Response.json({ ...body, rid }, { status, headers: cors });

  log('info', 'request.start', { rid });
  try {
    if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    const agencyId = typeof body?.agencyId === 'string' ? body.agencyId : '';
    if (!body || !UUID.test(agencyId)) return json({ error: 'הסוכנות אינה מוכרת.' }, 400);

    const gate = await requireAgencyRole(req, agencyId, 'user', rid, log);
    if (!gate.ok) return json({ error: gate.error }, gate.status);

    const name = text(body.name);
    const phone = text(body.phone);
    const email = text(body.email).toLowerCase();
    const topic = redact(text(body.topic));
    const notes = redact(text(body.notes));
    const referrer = redact(text(body.referrer));
    const intake = text(body.intake);
    const status = text(body.status);
    const notice = text(body.notice);
    const assignee = text(body.assignee).toLowerCase();

    if (oversizedField({ name: body.name, phone: body.phone, email: body.email, topic: body.topic, notes: body.notes, referrer: body.referrer }, LIMITS)) {
      return json({ error: REFUSALS.field_too_long }, 400);
    }
    if (!name) return json({ error: REFUSALS.field_required }, 400);
    const normalized = normalizePhone(phone);
    if (!contactPhone(phone) || !normalized) return json({ error: 'מספר הטלפון אינו תקין.' }, 400);
    if (email && !isEmail(email)) return json({ error: 'כתובת הדוא״ל אינה תקינה.' }, 400);
    if (!INTAKES.includes(intake)) return json({ error: REFUSALS.bad_intake }, 400);
    if (!STATUSES.includes(status)) return json({ error: REFUSALS.bad_status }, 400);
    if (!NOTICES.includes(notice)) return json({ error: REFUSALS.bad_notice }, 400);
    if (notice === 'email' && !email) return json({ error: 'כדי להודיע במייל יש להזין כתובת דוא״ל.' }, 400);
    if (assignee && !UUID.test(assignee)) return json({ error: REFUSALS.assignee_not_member }, 400);

    if (!(await withinLimit(log, rid, `staff-lead:${gate.userId}`, 3600, 60))) {
      log('warn', 'limit.exceeded', { rid, userId: gate.userId });
      return json({ error: 'יותר מדי פניות בשעה האחרונה. נסו שוב מאוחר יותר.' }, 429);
    }

    // Admin+ choose whose the lead is; for a User the database makes it theirs
    // whatever is sent, so nothing is sent.
    const mayAssign = gate.isOperator || gate.role === 'admin' || gate.role === 'owner';
    let created: { lead_id?: unknown; duplicate?: unknown } | undefined;
    try {
      const answer = await callRpc(
        'create_staff_lead',
        {
          p_agency_id: agencyId,
          p_name: name,
          p_phone: normalized,
          p_email: email || null,
          p_topic: topic || null,
          p_notes: notes || null,
          p_intake: intake,
          p_referrer: referrer || null,
          p_status: status,
          p_notice: notice,
          p_assignee: mayAssign && assignee ? assignee : null,
          p_duplicate_ok: body.duplicateOk === true,
        },
        gate.token,
      );
      created = (Array.isArray(answer) ? answer[0] : answer) as typeof created;
    } catch (e) {
      const why = refusalReason(e);
      if (why === 'forbidden') {
        log('warn', 'create.forbidden', { rid, userId: gate.userId });
        return json({ error: 'אין לך הרשאה להוסיף פנייה בסוכנות הזו.' }, 403);
      }
      if (Object.hasOwn(REFUSALS, why)) {
        log('warn', 'create.refused', { rid, userId: gate.userId, why });
        return json({ error: REFUSALS[why] }, 400);
      }
      throw e;
    }
    const leadId = typeof created?.lead_id === 'string' ? created.lead_id : '';
    if (!leadId) throw new Error('create_unexpected_answer');
    const duplicate = created?.duplicate === 'visible' || created?.duplicate === 'hidden' ? created.duplicate : null;

    if (duplicate === 'visible') {
      log('info', 'create.duplicate_visible', { rid, userId: gate.userId, leadId });
      return json({ duplicate, leadId }, 409);
    }
    log('info', 'create.ok', { rid, userId: gate.userId, agencyId, leadId, duplicate, intake, status, notice });

    const warnings: string[] = [];

    // The sheet is Dorit's (agency 1): another agency's leads never go into it.
    if (agencyId === AGENCY_1) try {
      const sheetStatus = await appendSheetRow(SHEET_TAB, SHEET_COLUMNS.length, [
        // Israel time, as submit-lead writes it: 'sv-SE' gives YYYY-MM-DD HH:MM:SS, which Sheets sorts as a date.
        new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Jerusalem' }),
        'פנייה ידנית',
        'staff',
        '',
        '',
        topic,
        '',
        name,
        normalized,
        email,
        leadId,
        ...SHEET_COLUMNS.slice(11).map(() => ''),
      ]);
      log('info', 'sheet.appended', { rid, tab: SHEET_TAB, status: sheetStatus });
    } catch (e) {
      log('warn', 'sheet.append_failed', { rid, tab: SHEET_TAB, err: String((e as Error)?.message ?? e).slice(0, 200) });
      warnings.push('sheet_append_failed');
    }

    if (mayAssign && assignee && assignee !== gate.userId.toLowerCase()) {
      try {
        const profiles = await selectRows('profiles', `id=eq.${assignee}&select=email`);
        const to = typeof profiles[0]?.email === 'string' ? profiles[0].email.trim().toLowerCase() : '';
        if (!isEmail(to)) {
          log('warn', 'mail.skipped', { rid, role: 'assignee', reason: 'no_address' });
          warnings.push('assignee_no_address');
        } else {
          await sendMail(log, { to, ...assignmentMail(leadId), rid, role: 'assignee' });
        }
      } catch (e) {
        log('warn', 'mail.failed', { rid, role: 'assignee', err: String((e as Error)?.message ?? e).slice(0, 200) });
        warnings.push(deliveryWarning('assignee_mail_failed', e));
      }
    }

    // The agency's Admins and Owners: who added a lead, about what, and where
    // to look. Never the client's details, and on a possible duplicate never
    // whose lead it matched — the screen shows the flag.
    try {
      const members = await selectRows('memberships', `agency_id=eq.${agencyId}&role=in.(admin,owner)&select=user_id`, gate.token);
      const ids = [...new Set(members.map((m) => String(m.user_id ?? '')).filter((id) => /^[\w-]+$/.test(id)))];
      const mine = await selectRows('profiles', `id=eq.${gate.userId}&select=email`);
      const who = typeof mine[0]?.email === 'string' && mine[0].email ? mine[0].email : 'חבר/ת צוות';
      const title = duplicate === 'hidden' ? `כפילות אפשרית: ${who} הוסיף/ה פנייה` : `${who} הוסיף/ה פנייה`;
      const rows: OpsRow[] = [
        ['נושא', topic],
        ['מזהה רשומה', leadId],
        ...(duplicate === 'hidden' ? [['כפילות', 'כפילות אפשרית — הפנייה מסומנת במסך הפניות'] as OpsRow] : []),
      ];
      const ops = opsNotice(title, rows);
      const recipients = ids.length
        ? (await selectRows('profiles', `id=in.(${ids.join(',')})&select=email`))
            .map((p) => (typeof p.email === 'string' ? p.email.trim().toLowerCase() : ''))
            .filter(isEmail)
        : [];
      if (recipients.length === 0) warnings.push('ops_notice_no_recipient');
      for (const to of new Set(recipients)) {
        try {
          await sendMail(log, { to, ...ops, rid, role: 'ops' });
        } catch (e) {
          log('warn', 'mail.failed', { rid, role: 'ops', err: String((e as Error)?.message ?? e).slice(0, 200) });
          warnings.push(deliveryWarning('ops_notice_failed', e));
        }
      }
    } catch (e) {
      log('warn', 'ops_notice.failed', { rid, err: String((e as Error)?.message ?? e).slice(0, 200) });
      warnings.push('ops_notice_failed');
    }

    let noticeSent: boolean | null = null;
    if (notice === 'email') {
      try {
        // Not a way to mail arbitrary addresses: one notice per address per 30 days, 30 per agency per hour.
        const addressOk = await withinLimit(log, rid, `staff-notice-addr:${await sha256Hex(email.toLowerCase())}`, 2592000, 1);
        const agencyOk = addressOk && (await withinLimit(log, rid, `staff-notice-agency:${agencyId}`, 3600, 30));
        if (!addressOk || !agencyOk) {
          noticeSent = false;
          log('warn', 'notice.rate_limited', { rid, userId: gate.userId });
          warnings.push('notice_rate_limited');
        } else {
          await sendMail(log, { to: email, ...noticeMail(), rid, role: 'client' });
          noticeSent = true;
        }
      } catch (e) {
        noticeSent = false;
        log('warn', 'mail.failed', { rid, role: 'client', err: String((e as Error)?.message ?? e).slice(0, 200) });
        warnings.push(deliveryWarning('privacy_notice_failed', e));
      }
    }

    log('info', 'request.end', { rid, ms: Date.now() - startedAt, leadId, noticeSent, warnings: warnings.length });
    return json({ leadId, duplicate, noticeSent, ...(warnings.length ? { warnings } : {}) });
  } catch (e) {
    log('error', 'request.failed', { rid, ms: Date.now() - startedAt, err: String((e as Error)?.message ?? e).slice(0, 200) });
    return json({ error: 'הוספת הפנייה נכשלה. נסו שוב.' }, 500);
  }
}
