/**
 * An enquiry — the contact form, the detailed enquiry, the consultation and the
 * interview's two saves: stored first, then announced.
 *
 * The Supabase twin of base44/functions/submitLead, transcribed top to bottom:
 * same input, same checks, same mail. What differs is decided in
 * docs/superpowers/specs/2026-10-12-connectors-off-base44-design.md — Supabase
 * is the only store, Google is reached through a service account Dorit shared
 * her calendar and the sheet with, there is no per-enquiry Doc, and the
 * meeting reaches each attendee as a mailed invitation rather than from the
 * calendar provider. tests/integration/submit-lead.integration.test.ts runs
 * both against one set of cases while both exist.
 */
import { validCampaign, validChannel, validLandingPath } from '../_shared/attribution.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { deviceLabel } from '../_shared/device.ts';
import { buildClientHtml, type ClientMail } from '../_shared/html.ts';
import { createLog, newRequestId } from '../_shared/log.ts';
import { createRequest, maslekaEnabled } from '../_shared/masleka.ts';
import { deliveryWarning, mailerConfigured, sendMail } from '../_shared/mail.ts';
import { insertRow, selectRows, supabaseConfigured, updateRow, upsertRow } from '../_shared/rest.ts';
import { isEmail, oversizedField, sha256Hex, withinLimit } from '../_shared/guard.ts';
import { googleConfigured } from '../_shared/google.ts';
import { calendarConfigured, createCalendarEvent } from '../_shared/calendar.ts';
import { appendSheetRow } from '../_shared/sheets.ts';
import { buildInvitation } from '../_shared/ics.ts';
import {
  INTERVIEW_TRACKS, INVITE_ATTENDEES, INVITE_FALLBACK_GOOGLE, INVITE_ORGANIZER, INTERVIEW_WINDOW_MS, LEAD_FIELD_LIMITS, NOTIFY_EMAILS, SECONDARY_EMAIL, SHEET_COLUMNS, SHEET_TAB,
  buildAgentBody, buildAgentHtml, buildClientText, buildInterviewProfile, buildLinksFooter, buildOpsFooter,
  clientMailFor, completenessLine, eventTypeFor, interviewCompleteness, israelInstant, profileValue,
  redact, sameInterviewee, subjectFor, tomorrowInIsrael, wallClock, wantsClearinghouse,
} from './lead.js';
// lead.js is plain JavaScript, as Base44's file was. The few `as` casts below
// tell Deno's checker the shapes it cannot infer from it.

const FN = 'submit-lead';
const log = createLog(FN);
const CONFIRMATIONS_PER_ADDRESS_PER_DAY = 3;
const INVITE_DESCRIPTION_MAX = 4_000;

/** The leads sheet, for the link in the mail; sheets.ts reads the same setting to append. */
const SHEET_ID = (Deno.env.get('SHEET_ID') || '').trim();

/** The fields of an open interview the completion carries forward. */
interface OpenInterview {
  id: string;
  name?: string | null;
  email?: string | null;
  timing?: string | null;
  consent_version?: string | null;
  consent_at?: string | null;
}

/**
 * The visitor's open interview, if one is in the window: partial, on this
 * phone, and the same person by name and address (sameInterviewee). Newest
 * first, so a rerun joins the latest. Base44's findOpenInterview, as a query.
 */
async function findOpenInterview(rid: string, phone: string, name: unknown, email: unknown): Promise<OpenInterview | null> {
  if (!phone) return null;
  try {
    const since = new Date(Date.now() - INTERVIEW_WINDOW_MS).toISOString();
    const rows = await selectRows(
      'leads',
      `select=id,name,email,timing,consent_version,consent_at,status,created_at` +
        `&phone=eq.${encodeURIComponent(phone)}&source=eq.interview&status=eq.partial` +
        `&created_at=gte.${encodeURIComponent(since)}&order=created_at.desc`,
    );
    return (rows.find((lead) => sameInterviewee(lead, name, email)) as OpenInterview | undefined) ?? null;
  } catch (e) {
    // Best-effort, as Base44's was: a duplicate beats a lost interview.
    log('warn', 'interview.lookup_failed', { rid, err: String((e as Error)?.message ?? e).slice(0, 200) });
    return null;
  }
}

/**
 * The confirmation carrying the link went out: the request's one client
 * reminder counts from now. Never throws — the lead is already stored and the
 * mail already sent.
 */
async function markMaslekaInvited(rid: string, requestId: string): Promise<boolean> {
  try {
    await updateRow('masleka_requests', requestId, { client_invited_at: new Date().toISOString() });
    return true;
  } catch (e) {
    log('warn', 'masleka.invite_mark_failed', { rid, requestId, err: String((e as Error)?.message ?? e).slice(0, 200) });
    return false;
  }
}

// Every `err:` below is truncated inline: tests/contract/logging.contract.test.ts
// reads each log call's text and requires the `.slice(0, N)` to be visible there.

export async function handler(req: Request): Promise<Response> {
  const cors = corsHeaders(req.headers.get('origin'));
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

  const rid = newRequestId();
  const startedAt = Date.now();
  try {
    log('info', 'request.start', { rid });
    // A body that is not JSON is answered as what it amounts to — no name and
    // no phone — rather than as a server fault.
    const body = await req.json().catch(() => null);
    const { name, phone, email, source, topic, timing, message, notes, scheduledAt, summary, profile, track, stage, meetingTopic, consent_version, consent_at, channel, campaign, landingPath } = body || {};
    const safeChannel = validChannel(channel) || 'unknown';
    const safeCampaign = validCampaign(campaign);
    const safeLandingPath = validLandingPath(landingPath);

    if (!name || !phone) {
      log('warn', 'request.rejected', { rid, reason: 'missing_contact_fields', source: source || 'quick' });
      // `ready` answers the production smoke's empty request: whether a real
      // enquiry could be stored, announced and booked. Booleans — never a
      // setting's value.
      const ready = { db: supabaseConfigured(), mailer: mailerConfigured(), google: googleConfigured() };
      return Response.json({ error: 'נדרשים שם וטלפון', rid, ready }, { status: 400, headers: cors });
    }

    // תקרות נדיבות: הסוכן מוסר כאן סיכום ופרופיל שכתב מודל, וראיון אמיתי לא
    // יתקרב אליהן. מה שעובר אותן אינו פנייה אלא מטען.
    const profileTooBig = profile !== undefined && profile !== null &&
      JSON.stringify(profile).length > 20000;
    const oversized = oversizedField(body ?? {}, LEAD_FIELD_LIMITS) || (profileTooBig ? 'profile' : null);
    if (oversized) {
      log('warn', 'request.rejected', { rid, reason: 'field_too_long', field: oversized, source: source || 'quick' });
      return Response.json({ error: 'אחד השדות ארוך מדי. אפשר לקצר ולשלוח שוב.', rid }, { status: 400, headers: cors });
    }

    // התקציר נכתב על ידי מודל, ולכן עובר סינון לפני שהוא נשלח לאן שהוא.
    const safeSummary = redact(summary);

    // ראיון ההיכרות הוא המקור היחיד שבו ה-message נכתב על ידי מודל ולא הוקלד
    // על ידי המבקר — זהו פרופיל שהסוכן ניסח וקיבל עליו אישור. ככזה הוא עובר
    // את אותו סינון כמו התקציר: הסוכן מונחה לא לרשום מזהים, אבל המבקר יכול
    // להקליד ת"ז באמצע השיחה והמודל עלול לשקף אותה בחזרה. בשאר המקורות זהו
    // טקסט חופשי של המבקר עצמו, והוא נשמר כפי שנכתב.
    const safeMessage = source === 'interview' ? redact(message) : message;

    // הפרופיל המובנה. הוא מסונן לשדות המוכרים של המסלול, ומה שנשאר הוא גם מה
    // שנשלח וגם מה שנשמר — הרשומה והמייל אינם יכולים לספר שני סיפורים.
    const safeProfile = (source === 'interview' ? buildInterviewProfile(profile, track) : []) as [string, string][];
    const trackLabel = (INTERVIEW_TRACKS as Record<string, { label: string }>)[track]?.label || '';
    const profileText = safeProfile.map(([label, value]) => `${label}: ${value}`).join('\n');
    const completeness = source === 'interview' ? interviewCompleteness(safeProfile, track) : null;

    // הדאגה המרכזית נשאלה כבר כשדה בסכימה. עד כה הסוכן התבקש למסור אותה שוב
    // כ-topic, כלומר אותה עובדה פעמיים, ואחד העותקים אינו מוצג לדורית כלל.
    // כאן היא נגזרת מהסכימה, ו-topic נותר לטפסים שבאמת שולחים אותו.
    // הראיון מתאם כעת גם את הפגישה, ולכן יש לו שני "נושאים": הדאגה שהביאה את
    // המבקר, והנושא שעליו סוכם להיפגש. מה שנרשם ברשומה הוא השני — זה מה שדורית
    // מכינה לקראתו — והדאגה נשארת בפרופיל, שם היא כבר מוצגת.
    const concern = safeProfile.find(([label]) => label === 'דאגה מרכזית')?.[1] || '';
    const effectiveTopic = source === 'interview'
      ? (meetingTopic || concern || topic || '')
      : topic;

    // ראיון חלקי: הרשומה נשמרת ואיש אינו מקבל הודעה. ההודעה שייכת לראיון
    // שהושלם — מייל על כל מי שהתחיל לענות היה הופך את התיבה לרעש.
    const partial = source === 'interview' && stage === 'partial';

    const data = {
      name, phone, email, topic: effectiveTopic, timing,
      message: safeMessage, notes, summary: safeSummary,
      profile: safeProfile, trackLabel, completeness,
      device: deviceLabel(req.headers.get('user-agent')),
      channel: safeChannel, campaign: safeCampaign, landingPath: safeLandingPath,
    };
    const agentBody: string = buildAgentBody(source, data);
    const subject: string = subjectFor(source, data);
    const leadMessage = profileText || safeMessage || notes || '';

    // ── סדר הפעולות ─────────────────────────────────────────────────────
    // הפנייה נשמרת ראשונה. המייל הוא הערוץ השביר (מסירה, דומיין מאומת,
    // נמען רשום) והמאגר הוא האמין — אם נכשלת שליחת המייל, הפנייה כבר
    // מתועדת ואינה אובדת. כשל בשמירה הוא היחיד שמחזיר שגיאה ללקוח.
    //
    // The record is written first. Email is the fragile channel and the
    // database is the reliable one, so a failed send can no longer lose the
    // enquiry; only a failed write is reported to the caller as an error.
    let leadId: string | null = null;

    // ראיון שכבר נפתח בשיחה הזו מתעדכן במקום להיווצר מחדש.
    const openInterview = source === 'interview' ? await findOpenInterview(rid, phone, name, email) : null;
    // האם השיחה הזו כבר פתחה רשומה. זה מה שמבדיל עדכון מכפילות, וזה השדה
    // שמסביר בדיעבד למה ראיון אחד הופיע פעמיים במסך הפניות.
    log('info', 'lead.resolved', { rid, source: source || 'quick', track: track || '', stage: partial ? 'partial' : 'complete', upsert: Boolean(openInterview?.id) });
    // שם ומועד: מועד שכבר נשמר נשמר, אם הסיום לא שלח חדש; ריק לא דורס אותו.
    const storedName = name || openInterview?.name || '';
    const storedTiming = timing || openInterview?.timing || '';
    // The meeting and what the personal area shows, on the enquiry itself —
    // the fields Base44's mirror wrote beside its own record. `profile` and
    // `summary` are the redacted copies the mail carries, never the raw payload.
    const meetingFields = {
      scheduled_at: israelInstant(scheduledAt),
      meeting_topic: meetingTopic || '',
      notes: notes || '',
      track: track || '',
      summary: safeSummary || null,
      profile: safeProfile.length ? safeProfile : null,
      track_label: trackLabel || null,
    };
    if (openInterview?.id) {
      try {
        await updateRow('leads', openInterview.id, {
          name: storedName,
          timing: storedTiming,
          email: email || openInterview.email || '',
          topic: effectiveTopic || '',
          message: leadMessage,
          status: partial ? 'partial' : 'new',
          // נשמר מה שכבר נרשם: ההסכמה ניתנה בתחילת השיחה, והעדכון הזה מגיע
          // אחריה. דריסה בריק היתה מוחקת את הראייה שהיא ניתנה.
          consent_version: consent_version || openInterview.consent_version || '',
          // A timestamptz: absent is null, as the mirror wrote it — '' is refused.
          consent_at: consent_at || openInterview.consent_at || null,
          ...meetingFields,
        });
        leadId = openInterview.id;
        log('info', 'lead.updated', { rid, leadId });
      } catch (e) {
        log('error', 'lead.update_failed', { rid, leadId: openInterview.id, err: String((e as Error)?.message ?? e).slice(0, 200) });
        return Response.json(
          { error: 'לא הצלחנו לעדכן את הפנייה. נסו שוב או צרו קשר ישירות.', rid },
          { status: 500, headers: cors }
        );
      }
    } else try {
      const row = await insertRow('leads', {
        name,
        phone,
        email: email || '',
        source: source || 'quick',
        topic: effectiveTopic || '',
        timing: timing || '',
        message: leadMessage,
        status: partial ? 'partial' : 'new',
        // איזה נוסח הסכמה הוצג, ומתי. חובת היידוע לפי חוק הגנת הפרטיות
        // (תיקון 13) היא ראייתית: בלי זה אי אפשר לקשור רשומה לנוסח שהמבקר
        // ראה בפועל. ריק כשהפנייה הגיעה ממסלול שלא הציג שער הסכמה — נרשם רק
        // מה שבאמת הוצג, ולעולם לא הסכמה שלא נתבקשה.
        consent_version: consent_version || '',
        // A timestamptz: absent is null, as the mirror wrote it — '' is refused.
        consent_at: consent_at || null,
        ...meetingFields,
        channel: safeChannel,
        campaign: safeCampaign,
      });
      leadId = typeof row.id === 'string' ? row.id : null;
      log('info', 'lead.created', { rid, leadId, source: source || 'quick' });
    } catch (e) {
      log('error', 'lead.create_failed', { rid, source: source || 'quick', err: String((e as Error)?.message ?? e).slice(0, 200) });
      // אין ערוץ גיבוי — הפנייה תאבד. זהו הכשל היחיד שחייב להיכשל בקול.
      return Response.json(
        { error: 'לא הצלחנו לשמור את הפנייה. נסו שוב או צרו קשר ישירות.', rid },
        { status: 500, headers: cors }
      );
    }

    // And the booking as its own row, when there is a booking to speak of. A
    // quick contact form has no meeting and gets none; an interview that
    // agreed nothing still gets one, because "asked for חמישי and nothing was
    // held" is the case worth being able to query.
    const booking = Boolean(scheduledAt || meetingTopic || timing || notes);
    const warnings: string[] = [];
    // Both meetings writes can fail; the warning is pushed once.
    let meetingWriteFailed = false;
    if (booking) {
      try {
        await upsertRow('meetings', {
          scheduled_at: israelInstant(scheduledAt),
          topic: meetingTopic || effectiveTopic || '',
          timing: timing || '',
          notes: notes || '',
          track: track || '',
          source: source === 'consultation' || source === 'interview' ? source : null,
          lead_id: leadId,
        }, 'lead_id');
      } catch (e) {
        log('warn', 'meeting.write_failed', { rid, err: String((e as Error)?.message ?? e).slice(0, 200) });
        if (!meetingWriteFailed) { meetingWriteFailed = true; warnings.push('meeting_write_failed'); }
      }
    }

    // מכאן והלאה — מיטבי. הפנייה כבר שמורה, ולכן כשל בהודעה מדווח
    // בתשובה במקום להיכשל, כדי שניתן יהיה לנטר אותו.

    // ראיון חלקי נגמר בשמירה. הוא ימשיך להתעדכן כשהמבקר יסיים; אם לא יסיים,
    // הרשומה נשארת כ-partial וגלויה במסך הפניות — וזה ההבדל בין נוטש שנעלם
    // לנוטש שאפשר לחזור אליו.
    if (partial) {
      log('info', 'request.end', { rid, ms: Date.now() - startedAt, leadId, stage: 'partial', notified: false });
      return Response.json({ ok: true, rid, leadId, stage: 'partial', notified: false, warnings }, { headers: cors });
    }

    // The clearinghouse request (PR A, dark until MASLEKA_ENABLED): an
    // interview that asked for the pull gets a request, and the confirmation
    // below carries its personal link as a button where the mandate link was —
    // one mail, not two (Ruling 21). If the request cannot be created, the
    // confirmation is today's, mandate and all, and a warning says so. The
    // link stays in this local and the confirmation's own copy of `data`:
    // never in what the staff copies read, a log line or the answer.
    let masleka: { id: string; link: string } | null = null;
    if (source === 'interview' && maslekaEnabled() && wantsClearinghouse(safeProfile)) {
      try {
        masleka = await createRequest({
          clientName: String(name).trim().slice(0, 80),
          contactEmail: email && isEmail(email) ? email : null,
          leadId,
          createdBy: null,
        });
        log('info', 'masleka.request_created', { rid, requestId: masleka.id });
      } catch (e) {
        log('warn', 'masleka.request_failed', { rid, err: String((e as Error)?.message ?? e).slice(0, 200) });
        warnings.push('masleka_request_failed');
      }
    }

    // אישור ללקוח — רק למשהו שהוא כתובת, ולא יותר מכמה פעמים ביום לכתובת.
    if (email && !isEmail(email)) {
      log('warn', 'mail.skipped', { rid, role: 'visitor', reason: 'invalid_address' });
      warnings.push('client_email_invalid');
    } else if (email && !(await withinLimit(log, rid, `confirm-to:${await sha256Hex(email.toLowerCase())}`, 86400, CONFIRMATIONS_PER_ADDRESS_PER_DAY))) {
      log('warn', 'mail.skipped', { rid, role: 'visitor', reason: 'rate_limited' });
      warnings.push('client_confirmation_rate_limited');
    } else if (email) {
      // Only the visitor's letter sees the link; with no request it is `data` itself.
      const clientData = masleka ? { ...data, maslekaLink: masleka.link } : data;
      try {
        // הכותרת חייבת לומר את מה שגוף המכתב אומר. clientMailFor פותח ראיון
        // ב"קיבלנו את סיכום השיחה", ונושא שאומר "פנייתכם" הופך את אותו מייל
        // לשני דברים שונים בשורת הנושא ובפתיחה.
        const clientSubject = source === 'interview'
          ? `אישור — קיבלנו את סיכום השיחה · דורית גוב ארי`
          : source === 'consultation'
          ? `אישור — קיבלנו את בקשת הייעוץ שלכם · דורית גוב ארי`
          : `אישור — קיבלנו את פנייתכם · דורית גוב ארי`;
        await sendMail(log, {
          to: email,
          subject: clientSubject,
          html: buildClientHtml(clientMailFor(source, clientData) as ClientMail),
          text: buildClientText(source, clientData),
          rid,
          role: 'visitor',
        });
        // Marked only once the letter carrying the link has gone out.
        if (masleka && !(await markMaslekaInvited(rid, masleka.id))) warnings.push('masleka_invite_mark_failed');
      } catch (e) {
        log('warn', 'mail.failed', { rid, role: 'visitor', err: String((e as Error)?.message ?? e).slice(0, 200) });
        warnings.push(deliveryWarning('client_confirmation_failed', e));
      }
    }

    // הכתיבות החיצוניות יוצאות יחד: הגיליון רץ ברקע בזמן שהיומן וההזמנות
    // נכתבים, ונאסף אחריהם. אף אחת מהן אינה זקוקה לתוצאה של השנייה, ובתור
    // הסכום שלהן הוא שהרג את הדבר היחיד שהמבקר רואה. ראו A-56.
    //
    // ה-catch מחובר ביצירה ולא בהמתנה, אחרת דחייה שמגיעה לפני ה-await היא
    // unhandled rejection שמפילה את הבקשה כולה.
    const sheetPromise = (async () => {
      try {
        const status = await appendSheetRow(SHEET_TAB, SHEET_COLUMNS.length, [
          // שעון ישראל, לא UTC. העמודה הזו נקראת בידי אדם שיושב כאן, ו-Z
          // בסופה הציגה כל אירוע שלוש שעות מוקדם מכפי שקרה. 'sv-SE' נותן
          // YYYY-MM-DD HH:MM:SS, ש-Sheets מזהה כתאריך ולכן גם ממיין נכון.
          new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Jerusalem' }),
          eventTypeFor(source),
          source || 'quick',
          trackLabel,               // מסלול — רלוונטי רק בראיון
          '',                       // סוכן — רלוונטי רק בהעברה לאדם
          // הנושא הנרשם הוא זה שנשלח בפועל: בראיון הוא נגזר מנושא הפגישה או
          // מהדאגה המרכזית, ו-`topic` הגולמי כבר אינו מגיע מהסוכן.
          effectiveTopic || '',
          timing || '',
          name,
          phone,
          email || '',
          leadId || '',
          '',                       // סיבת העברה — רלוונטי רק בהעברה לאדם
          // התקציר של הראיון הוא הפרופיל שהסוכן מסר, לא שדה summary נפרד. בלי
          // הנפילה הזו שורת הראיון נרשמת ריקה — שם וטלפון בלי מה שנאסף.
          safeSummary || profileText || safeMessage || '',
          // ── ששת שדות הראיון ─────────────────────────────────────────────
          //
          // 'מועד הפגישה' הוא מה שנכנס ליומן, לא 'מועד מבוקש' שהוא תיאור
          // במילים: רק הראשון ניתן למיון, והשאלה "מה יש לי השבוע" נשאלת עליו.
          wallClock(scheduledAt)?.replace('T', ' ').slice(0, 16) || '',
          profileValue(safeProfile, 'שלב חיים'),
          profileValue(safeProfile, 'יעד עיקרי'),
          profileValue(safeProfile, 'דאגה מרכזית'),
          profileValue(safeProfile, 'שליפת נתוני מסלקה — מעוניין/ת'),
          data.completeness ? completenessLine(data.completeness) : '',
        ]);
        log('info', 'sheet.appended', { rid, tab: SHEET_TAB, status });
        return status;
      } catch (e) {
        log('warn', 'sheet.append_failed', { rid, tab: SHEET_TAB, err: String((e as Error)?.message ?? e).slice(0, 200) });
        warnings.push('sheet_append_failed');
        return 'לא נרשם';
      }
    })();

    // אירוע ביומן של דורית — מיטבי, רק עבור בקשות ייעוץ. הראיון מתאם פגישה
    // בעצמו מאז שסוכן התיאום מוזג לתוכו, ולכן הוא מקבל אירוע בדיוק כמו בקשת
    // ייעוץ — אבל רק כשבאמת סוכם מועד.
    const booksCalendar = source === 'consultation' || (source === 'interview' && Boolean(scheduledAt));
    // "לא רלוונטי" על ראיון בלי מועד היה מטעה: הוא נקרא כמו החלטה, בזמן שמה
    // שקרה הוא שהסוכן לא שלח scheduledAt. מי שקרא את המייל לא ידע שיש מה לתקן.
    let calendar = booksCalendar
      ? 'לא נוצר'
      : (source === 'interview' ? 'לא נקבע מועד' : 'לא רלוונטי');
    // The slot the hold was actually placed on, which is not always the slot
    // that was agreed — it falls back to tomorrow 09:00 when nothing was.
    let calendarStartedAt: string | null = null;
    // One event in the calendar GOOGLE_CALENDAR_ID names (amielnoy@gmail.com's,
    // shared with the service account), without attendees; and, independently
    // of it, an invitation by mail to Dorit and to amielnoy@outlook.com. When
    // the event exists the invitations carry its UID — one meeting.
    let invites = booksCalendar ? 'לא נשלחו' : 'לא רלוונטי';
    if (booksCalendar) {
      const calStartIso = wallClock(scheduledAt) ?? `${tomorrowInIsrael()}T09:00:00`;
      const calEndIso = wallClock(calStartIso, 30) as string;
      calendarStartedAt = calStartIso;
      const description = `${agentBody}\n\nלייצר קשר ולתאם מעקב.`;
      // The .ics is capped (20,000 bytes) and a long interview in Hebrew can
      // pass it, which would fail every invitation. The invitation carries the
      // opening of the body; the mail text and the calendar event carry it all.
      const inviteDescription = agentBody.length > INVITE_DESCRIPTION_MAX
        ? `${agentBody.slice(0, INVITE_DESCRIPTION_MAX)}\n…הפרטים המלאים במייל`
        : agentBody;
      // The Google event goes in first, but nothing below waits on it for its
      // own sake: it only supplies the UID when it exists. Unset calendar id,
      // a refusal, a timeout — the invitations go out all the same.
      let ev: Awaited<ReturnType<typeof createCalendarEvent>> | null = null;
      calendar = 'אירוע ביומן Google לא נוצר';
      if (calendarConfigured()) {
        try {
          ev = await createCalendarEvent({ summary: subject, description, startIso: calStartIso, endIso: calEndIso });
          log('info', 'calendar.created', { rid, provider: 'google' });
          calendar = `אירוע נוצר ✓ (google) — ${calStartIso.slice(0, 16).replace('T', ' ')}`;
        } catch (e) {
          const msg = String((e as Error)?.message ?? e);
          const rejected = /^calendar_http_4\d\d$/.test(msg);
          log(rejected ? 'error' : 'warn', rejected ? 'calendar.rejected' : 'calendar.failed', { rid, provider: 'google', err: msg.slice(0, 200) });
          warnings.push(rejected ? 'calendar_google_rejected' : 'calendar_google_failed');
        }
      }
      // One meeting everywhere: the event's own UID when there is one, else a
      // stable local one (the request id when the insert returned no id, so two
      // such leads never share a UID and merge in Outlook). Without an event the instants come from the slot.
      const startAt = ev?.start ?? new Date(israelInstant(calStartIso) ?? Date.now());
      const endAt = ev?.end ?? new Date(startAt.getTime() + 30 * 60000);
      const uid = ev?.iCalUID ?? `lead-${leadId ?? rid}@govari-fin.co.il`;
      // With no event, Gmail's calendar would hold nothing: it gets the invitation.
      const invitees = ev ? INVITE_ATTENDEES : [...INVITE_ATTENDEES, INVITE_FALLBACK_GOOGLE];
      const sent = await Promise.all(invitees.map(async (attendee: string) => {
        try {
          await sendMail(log, {
            to: attendee,
            subject: `הזמנה: ${subject}`,
            text: `${description}${ev ? `\n\nהאירוע ביומן: ${ev.htmlLink}` : ''}`,
            ics: buildInvitation({
              uid, start: startAt, end: endAt, summary: subject, description: inviteDescription,
              organizer: INVITE_ORGANIZER, organizerName: 'דורית גוב ארי', attendee,
            }),
            rid,
            role: 'invite',
          });
          return true;
        } catch (e) {
          log('warn', 'invite.failed', { rid, err: String((e as Error)?.message ?? e).slice(0, 200) });
          warnings.push(deliveryWarning('invite_failed', e));
          return false;
        }
      }));
      invites = `נשלחו ${sent.filter(Boolean).length}/${invitees.length}`;
    }

    // The outcome, written back onto the booking. `scheduled_at` is what was
    // agreed and this is what the diary took — tonight's fault was precisely
    // that those two can differ with nothing anywhere saying so.
    if (booking) {
      try {
        await upsertRow('meetings', {
          calendar_status: calendar,
          calendar_at: israelInstant(calendarStartedAt),
          lead_id: leadId,
        }, 'lead_id');
      } catch (e) {
        log('warn', 'meeting.write_failed', { rid, err: String((e as Error)?.message ?? e).slice(0, 200) });
        if (!meetingWriteFailed) { meetingWriteFailed = true; warnings.push('meeting_write_failed'); }
      }
    }

    // הגיליון, שכבר רץ. מיטבי — הגיליון הוא תצוגה ולא מקור האמת, והרשומה כבר
    // שמורה — ולכן כשל בו מדווח ב-warnings ואינו מפיל את הפנייה. נאסף כאן כי
    // ההודעה לדורית נושאת את הקישור אליו.
    const sheet = await sheetPromise;

    // ── דילוג שקט הוא עדיין דילוג ──────────────────────────────────────────
    //
    // 'אין תקלות' הוא המשפט שעל סמכו לא בודקים כלום, ולכן הוא חייב להיות נכון.
    // 'לא מוגדר' — אין SHEET_ID, כלומר מישהו בחר לא להפעיל את הרישום, והנספח
    // אומר זאת במפורש — אינו תקלה. תקלה היא מה שהיה אמור לעבוד ולא עבד.
    for (const [label, status] of [['sheet', sheet]]) {
      const reason =
        status === 'אין חיבור' ? 'not_connected'
        : status === 'לא נרשם' || status === 'לא נוצר' ? 'failed'
        : null;
      if (!reason) continue;
      log('warn', `${label}.skipped`, { rid, reason });
      warnings.push(`${label}_${reason}`);
    }

    // הודעה לדורית — הפנייה המלאה, כולל תקציר השיחה אם הסוכן מסר אחד, ובצידה
    // הקישור לשורה ביומן האירועים. נשלחת אחרי הגיליון, ולכן לכל כתיבה לפניה
    // יש AbortSignal.timeout: ספק שאינו עונה היה מחזיק את ההודעה היחידה
    // שמישהו ממתין לה.
    //
    // כתובת הגיליון ידועה מ-SHEET_ID ואינה זקוקה לתשובת ה-API. מה שכן נלקח
    // מהסטטוס הוא אם השורה נכתבה: אין טעם לקשר גיליון ששורה לא הגיעה אליו.
    const links = {
      sheet: SHEET_ID && /^נרשם ✓/.test(String(sheet))
        ? `נרשם ✓ — https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit`
        : sheet,
    };
    try {
      await sendMail(log, {
        to: SECONDARY_EMAIL,
        subject,
        // אותה פנייה, בעיצוב האתר. הטקסט נשלח לצידו כגיבוי ולא במקומו.
        // `as never`: lead.js is untyped, and Deno's checker reads its
        // `links = null` default as the parameter's type.
        html: buildAgentHtml(source, data, null, links as never),
        text: [agentBody, buildLinksFooter(links)].filter(Boolean).join('\n\n'),
        rid,
        role: 'agency',
      });
    } catch (e) {
      log('warn', 'mail.failed', { rid, role: 'agency', err: String((e as Error)?.message ?? e).slice(0, 200) });
      warnings.push(deliveryWarning('secondary_email_failed', e));
    }

    // עותק לצוות התפעול — אותה פנייה מלאה, בתוספת נספח המצב. נשלח אחרון
    // כדי שיוכל לדווח גם על תוצאת היומן, הגיליון וההזמנות. ראו ההערה ליד
    // NOTIFY_EMAILS. Each mailbox is its own attempt: one that bounces must
    // not take the others with it.
    const opsOps = { source, leadId, topic, calendar, sheet, invites, warnings, channel: safeChannel, campaign: safeCampaign, landingPath: safeLandingPath };
    const opsHtml = buildAgentHtml(source, data, opsOps);
    const opsText = `${agentBody}\n\n${buildOpsFooter(source, opsOps)}`;
    await Promise.all(NOTIFY_EMAILS.map(async (to: string) => {
      try {
        await sendMail(log, {
          to,
          subject,
          html: opsHtml,
          text: opsText,
          rid,
          role: 'ops',
        });
      } catch (e) {
        log('warn', 'mail.failed', { rid, role: 'ops', err: String((e as Error)?.message ?? e).slice(0, 200) });
        warnings.push(deliveryWarning('notify_email_failed', e));
      }
    }));

    log('info', 'request.end', { rid, ms: Date.now() - startedAt, leadId, source: source || 'quick', warnings: warnings.length });
    return Response.json({ ok: true, rid, leadId, warnings }, { headers: cors });
  } catch (error) {
    log('error', 'request.failed', { rid, ms: Date.now() - startedAt, err: String((error as Error)?.message ?? error).slice(0, 200) });
    // The id, not the message: the visitor can quote it, and it finds the
    // request in one search, without telling anyone the shape of our internals.
    return Response.json({ error: 'השמירה נכשלה. אפשר לנסות שוב, או לפנות לדורית ישירות.', rid }, { status: 500, headers: cors });
  }
}
