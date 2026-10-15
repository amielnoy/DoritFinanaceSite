/**
 * Who receives an enquiry — one place for every Edge function (Architecture
 * N-01), where submit-lead, submit-claim and escalate-to-human each kept a copy.
 *
 * Two recipients. The agent (SECONDARY_EMAIL) receives the full enquiry. The
 * team that operates the site for her (NOTIFY_EMAILS) receives a notice
 * without the visitor's details (_shared/ops-notice.ts: kind, topic, record id,
 * how the save, the diary and the mails went) and, for a meeting, the name,
 * phone and topic in its diary — N-02, the user's decision of 2026-10-15. The
 * consent wording (src/config/compliance.ts) and the privacy policy still name
 * the team — "אצל דורית ואצל הצוות שמתפעל את האתר מטעמה" — because it runs the
 * database the enquiry is kept in; tests/contract/agents.contract.test.ts holds
 * the code and the wording to each other.
 *
 * NOTIFY_EMAILS can be replaced without a deploy of the code: the function
 * secret NOTIFY_EMAILS, a comma-separated list. An empty or malformed secret is
 * ignored and the default stands — a typo must not leave an enquiry unsent.
 *
 * The diary follows from the mail rather than being a second list to keep in
 * step: everyone who receives the enquiry is invited, and nobody else (A-54,
 * COMPLIANCE.md §6). The Google event is written to its owner's calendar, so the
 * owner gets no invitation — unless the event failed, and only while the owner
 * is still among those notified.
 */

const EMAIL = /^[^@\s,]+@[^@\s,]+\.[^@\s,]+$/;

const DEFAULT_NOTIFY_EMAILS = ['amielnoy@gmail.com', 'amielnoy@outlook.com'];

function fromSecret(): string[] | null {
  const env = (globalThis as { Deno?: { env: { get(key: string): string | undefined } } }).Deno?.env;
  const raw = env?.get('NOTIFY_EMAILS');
  if (!raw) return null;
  const list = raw.split(',').map((a) => a.trim()).filter(Boolean);
  return list.length > 0 && list.every((a) => EMAIL.test(a)) ? list : null;
}

/** The operating team's mailboxes. */
export const NOTIFY_EMAILS: readonly string[] = fromSecret() ?? DEFAULT_NOTIFY_EMAILS;

/** The agent. */
export const SECONDARY_EMAIL = 'dorit@govari-fin.co.il';

/** Whose Google calendar the event is written to (GOOGLE_CALENDAR_ID). */
const GOOGLE_CALENDAR_OWNER = 'amielnoy@gmail.com';

/** Everyone on the enquiry, in the diary. */
export const CALENDAR_ATTENDEES: readonly string[] = [SECONDARY_EMAIL, ...NOTIFY_EMAILS];

/** Who gets the meeting by mail (ICS): everyone in the diary but the calendar's owner, whose calendar holds the event. */
export const INVITE_ATTENDEES: readonly string[] = CALENDAR_ATTENDEES.filter((a) => a !== GOOGLE_CALENDAR_OWNER);

/** When the Google event was not created, the owner gets the meeting by mail instead — if still notified. */
export const INVITE_FALLBACK_GOOGLE: string | null = NOTIFY_EMAILS.includes(GOOGLE_CALENDAR_OWNER) ? GOOGLE_CALENDAR_OWNER : null;
