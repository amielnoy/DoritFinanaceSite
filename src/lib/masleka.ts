import { israelToday } from "@/lib/wall-clock";
import { MaslekaError, type MaslekaFailure, type MaslekaRequest } from "@/services/ports";

/**
 * What the clearinghouse page and the staff board compute, without a DOM.
 *
 * The clearinghouse answers an all-bodies request in about 3–4 hours and
 * deletes the download after 7 business days; `clearinghouseDeletesAt` comes
 * from the server (masleka-submitted), so the board only counts down to it.
 */
export const READY_AFTER_MS = 4 * 60 * 60 * 1000;

/** The board's query — shared with the admin menu's counter, so both read one cache entry. */
export const BOARD_KEY = ["admin", "masleka"] as const;
const DAY_MS = 86_400_000;

export interface BoardColumns {
  invited: MaslekaRequest[];
  waiting: MaslekaRequest[];
  submitted: MaslekaRequest[];
  completed: MaslekaRequest[];
}

const time = (iso: string | null): number => (iso ? Date.parse(iso) || 0 : 0);

/** Each request in its column; the longest-waiting first, so the oldest is worked first. */
export function boardColumns(requests: MaslekaRequest[]): BoardColumns {
  const of = (status: MaslekaRequest["status"]) => requests.filter((r) => r.status === status);
  return {
    invited: of("invited").sort((a, b) => time(a.createdAt) - time(b.createdAt)),
    waiting: of("code_received").sort((a, b) => time(a.codeReceivedAt) - time(b.codeReceivedAt)),
    submitted: of("submitted").sort((a, b) => time(a.submittedAt) - time(b.submittedAt)),
    completed: of("completed").sort((a, b) => time(b.completedAt) - time(a.completedAt)),
  };
}

export function readinessLabel(submittedAt: string | null, now: Date): string {
  if (!submittedAt) return "";
  return now.getTime() - Date.parse(submittedAt) >= READY_AFTER_MS ? "מוכן להורדה" : "מוכן בעוד כ־3–4 שעות";
}

/**
 * Calendar days from today to `iso`, read on the Israeli calendar (a fixed 24 h
 * count is an hour off across the late-October clock change). The date itself
 * comes from the server, which counts Israeli business days
 * (`addBusinessDays`, supabase/functions/_shared/business-days.ts); the board
 * only counts down to it, so it never repeats that calculation. A date still
 * ahead is at least 1; one that has passed is 0.
 */
export function daysUntil(iso: string | null, now: Date): number | null {
  if (!iso) return null;
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  if (at.getTime() <= now.getTime()) return 0;
  const day = (d: Date) => Date.parse(`${israelToday(d)}T00:00:00Z`);
  return Math.max(1, Math.round((day(at) - day(now)) / DAY_MS));
}

export function deletionLabel(iso: string | null, now: Date): string {
  const days = daysUntil(iso, now);
  if (days === null) return "";
  if (days <= 0) return "נמחק במסלקה";
  if (days === 1) return "יום אחד עד מחיקה במסלקה";
  return `${days} ימים עד מחיקה במסלקה`;
}

export interface ClipboardLike {
  writeText(text: string): Promise<void>;
}

/** The little of `document` the copy fallback touches. */
export interface DocumentLike {
  body: { appendChild(el: never): unknown; removeChild(el: never): unknown };
  createElement(tag: string): Record<string, unknown>;
  execCommand(command: string): boolean;
}

/**
 * The old way: select the value in a temporary field and run the copy command.
 * The field is invisible, read-only, emptied and removed in a `finally`, so
 * the value is in the page only for the length of this call. Any failure, or
 * no document, is false.
 */
function copyThroughField(value: string, doc: DocumentLike | null | undefined): boolean {
  if (!doc || typeof doc.createElement !== "function" || typeof doc.execCommand !== "function" || !doc.body) {
    return false;
  }
  let field: Record<string, unknown> | null = null;
  try {
    field = doc.createElement("textarea");
    field.value = value;
    field.readOnly = true;
    (field.setAttribute as ((k: string, v: string) => void) | undefined)?.("aria-hidden", "true");
    Object.assign((field.style as Record<string, string>) ?? {}, { position: "fixed", top: "-1000px", opacity: "0" });
    doc.body.appendChild(field as never);
    (field.focus as (() => void) | undefined)?.();
    (field.select as (() => void) | undefined)?.();
    return doc.execCommand("copy") === true;
  } catch {
    return false;
  } finally {
    if (field) {
      try {
        field.value = "";
      } finally {
        try {
          doc.body.removeChild(field as never);
        } catch {
          // already gone
        }
      }
    }
  }
}

/**
 * Copy, or say it must be done by hand.
 *
 * `navigator.clipboard` is missing outside a secure context and in older
 * browsers, and a browser may refuse it (permissions, focus) by rejecting or
 * by throwing. The next try is the copy command through a temporary field
 * (above). Only when that fails too is the answer "manual": the caller then
 * shows the value selected in a read-only field with "העתק ידנית" and must
 * clear it on the next click, never keep it. Nothing here stores or logs the
 * value.
 */
export async function copyOrFallback(
  value: string,
  clipboard: ClipboardLike | null | undefined,
  doc: DocumentLike | null | undefined = typeof document === "undefined" ? null : (document as unknown as DocumentLike),
): Promise<"copied" | "manual"> {
  if (clipboard && typeof clipboard.writeText === "function") {
    try {
      await clipboard.writeText(value);
      return "copied";
    } catch {
      // refused, or thrown: try the old way
    }
  }
  return copyThroughField(value, doc) ? "copied" : "manual";
}

/** The token from `#t=<43 base64url characters>`, and nothing looser. */
export function readTokenFromHash(hash: string): string | null {
  const match = /^#t=([A-Za-z0-9_-]{43})$/.exec(hash);
  return match ? match[1] : null;
}

/** The same shape `masleka-code` accepts (normalizeCode): 4–64 letters, digits, hyphens. */
export function isPlausibleCode(value: string): boolean {
  return /^[A-Za-z0-9-]{4,64}$/.test(value.trim());
}

export type MessageTone = "error" | "state";
export interface Message {
  tone: MessageTone;
  text: string;
}

const reasonOf = (error: unknown): MaslekaFailure => (error instanceof MaslekaError ? error.reason : "failed");

/**
 * What the client's page says after a failed send. Three answers are worded for
 * what they mean, not for their status: a client who typed too many wrong IDs is
 * told to wait and that the link is fine; a send the function knows stored
 * nothing (`not_saved`) is told so plainly and asked to send again — staff get
 * an alert either way (decision 2026-10-14); and a failure after which the code
 * may already have been stored never invites a second send.
 */
export function clientMessage(error: unknown): Message {
  const reason = reasonOf(error);
  const say = (text: string): Message => ({ tone: "error", text });
  switch (reason) {
    case "disabled":
      return say("השירות אינו זמין כרגע");
    case "link_invalid":
    case "not_found":
      return say("הקישור אינו תקף יותר. אפשר לבקש מדורית קישור חדש.");
    case "bad_id":
      return say("מספר הזהות אינו תקין. בדקו אותו ונסו שוב.");
    case "bad_code":
    case "invalid":
      return say("הקוד אינו תקין. בדקו אותו ונסו שוב.");
    case "rate_limited":
      return say("היו יותר מדי ניסיונות. הקישור תקין, נסו שוב בעוד זמן מה.");
    case "unavailable":
      return say("השירות אינו זמין כרגע. הקוד לא נשמר, נסו שוב מאוחר יותר.");
    case "already_submitted":
      return say("הקוד כבר התקבל. דורית תיצור קשר.");
    case "not_saved":
      return say("השליחה לא עברה והקוד לא נשמר. נסו לשלוח שוב בעוד כמה דקות — הקישור עדיין בתוקף.");
    default:
      return say("ייתכן שהקוד כבר התקבל. אין צורך לשלוח שוב, דורית תיצור קשר.");
  }
}

/** What the staff board says after a failed call; a second הגשתי is a state, not an error (Ruling 18). */
export function staffMessage(error: unknown): Message {
  const reason = reasonOf(error);
  const say = (text: string): Message => ({ tone: "error", text });
  switch (reason) {
    case "already_submitted":
      return { tone: "state", text: "כבר סומן כהוגש" };
    case "disabled":
      return say("השירות כבוי כרגע");
    case "unauthorized":
      return say("צריך להתחבר מחדש");
    case "forbidden":
      return say("ההרשאה שלך הוסרה");
    case "not_found":
      return say("הבקשה לא נמצאה");
    case "not_available":
      return say("אי אפשר לבצע את הפעולה במצב הנוכחי של הבקשה");
    case "invalid_name":
      return say("השם אינו תקין");
    case "invalid_email":
      return say("כתובת הדוא״ל אינה תקינה");
    case "rate_limited":
      return say("יותר מדי ניסיונות, נסו שוב בעוד זמן מה");
    case "unavailable":
      return say("השירות אינו זמין כרגע, נסו שוב מאוחר יותר");
    default:
      return say("הפעולה נכשלה, נסו שוב");
  }
}

/** Every failure in the staff vocabulary (staffMessage), with the request id for support. */
export function failureText(error: unknown): string {
  const message = staffMessage(error);
  return message.tone === "error" && error instanceof MaslekaError && error.rid
    ? `${message.text} (קוד ${error.rid})`
    : message.text;
}
