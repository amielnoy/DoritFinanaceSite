import { isIsraeliMobile } from "@/lib/phone";
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

const time = (iso: string | null): number => (iso ? Date.parse(iso) || 0 : 0);

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

/** A time a person reads on the board: Israel time, day and month and the hour. */
export function boardTime(iso: string | null): string {
  return iso
    ? new Date(iso).toLocaleString("he-IL", {
        timeZone: "Asia/Jerusalem",
        day: "numeric",
        month: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";
}

/** The board's four stages, in the order a request moves through them. */
export const BOARD_STAGES = ["invited", "code_received", "submitted", "completed"] as const;
export type BoardStage = (typeof BOARD_STAGES)[number];

export const STAGE_LABEL: Record<BoardStage, string> = {
  invited: "ממתין ללקוח",
  code_received: "מוכן להגשה",
  submitted: "הוגש במסלקה",
  completed: "הושלם",
};

/** An invited client is chased after this many days without a code. */
export const INVITE_NUDGE_DAYS = 3;
/** A download this many days or fewer from its deletion is urgent. */
export const URGENT_DAYS = 2;

/** The one thing a row offers. `none` is a sentence, not a button. */
export type BoardAction =
  | { kind: "submit"; label: "להגשה" }
  | { kind: "download"; label: "להורדה במסלקה" }
  | { kind: "relink"; label: "קישור חדש" }
  | { kind: "analysis"; label: "לניתוח"; snapshotId: string }
  | { kind: "none"; label: "אין צורך בפעולה" };

export interface RowPlan {
  /** 1–4: the request's step. */
  step: 1 | 2 | 3 | 4;
  stage: BoardStage;
  reason: string;
  action: BoardAction;
  /** In "לטיפול עכשיו". */
  needsAction: boolean;
  /** A download about to be deleted by the clearinghouse: first in "now", said in red. */
  urgent: boolean;
  /** When the request entered its stage, for "oldest first". */
  since: number;
}

const NONE: BoardAction = { kind: "none", label: "אין צורך בפעולה" };

/** "היום", "אתמול", or "לפני N ימים", counted on the Israeli calendar. */
function daysAgo(iso: string, now: Date): string {
  const day = (d: Date) => Date.parse(`${israelToday(d)}T00:00:00Z`);
  const n = Math.max(0, Math.round((day(now) - day(new Date(iso))) / DAY_MS));
  return n === 0 ? "היום" : n === 1 ? "אתמול" : `לפני ${n} ימים`;
}

/**
 * What one row says and offers, and whether it waits for someone now — the
 * board's whole "needs action" rule, here so it is tested without a page.
 *
 * - code_received: the code is in; "להגשה" (the guided submit). Now.
 * - submitted and ready (READY_AFTER_MS): "להורדה במסלקה". Now; urgent when
 *   the clearinghouse deletes the files in URGENT_DAYS or fewer.
 * - submitted, not ready yet: nothing to do.
 * - invited: "קישור חדש" always; now only after INVITE_NUDGE_DAYS.
 * - completed: "לניתוח" when a report exists; never now.
 */
export function actionFor(request: MaslekaRequest, now: Date, snapshotIdByRequest: ReadonlyMap<string, string>): RowPlan {
  switch (request.status) {
    case "code_received": {
      const last4 = request.idLast4 ? ` · ת״ז מסתיימת ב־${request.idLast4}` : "";
      return {
        step: 2,
        stage: "code_received",
        reason: `קוד האימות התקבל ${boardTime(request.codeReceivedAt)}${last4}`,
        action: { kind: "submit", label: "להגשה" },
        needsAction: true,
        urgent: false,
        since: time(request.codeReceivedAt),
      };
    }
    case "submitted": {
      const submittedAt = time(request.submittedAt);
      if (now.getTime() - submittedAt >= READY_AFTER_MS) {
        const days = daysUntil(request.clearinghouseDeletesAt, now);
        const deletion = deletionLabel(request.clearinghouseDeletesAt, now);
        return {
          step: 3,
          stage: "submitted",
          reason: deletion ? `מוכן להורדה · ${deletion}` : "מוכן להורדה",
          action: { kind: "download", label: "להורדה במסלקה" },
          needsAction: true,
          urgent: days !== null && days <= URGENT_DAYS,
          since: submittedAt + READY_AFTER_MS,
        };
      }
      return {
        step: 3,
        stage: "submitted",
        reason: `הוגש ${boardTime(request.submittedAt)} · יהיה מוכן בעוד כ־3–4 שעות`,
        action: NONE,
        needsAction: false,
        urgent: false,
        since: submittedAt,
      };
    }
    case "completed": {
      const snapshotId = snapshotIdByRequest.get(request.id);
      return {
        step: 4,
        stage: "completed",
        reason: `הושלם ${boardTime(request.completedAt)}`,
        action: snapshotId ? { kind: "analysis", label: "לניתוח", snapshotId } : NONE,
        needsAction: false,
        urgent: false,
        since: time(request.completedAt),
      };
    }
    default: {
      const sent = request.clientInvitedAt ?? request.createdAt;
      return {
        step: 1,
        stage: "invited",
        reason: `קיבל/ה קישור ${daysAgo(sent, now)} ועוד לא מילא/ה`,
        action: { kind: "relink", label: "קישור חדש" },
        needsAction: now.getTime() - time(sent) > INVITE_NUDGE_DAYS * DAY_MS,
        urgent: false,
        since: time(sent),
      };
    }
  }
}

export interface PlannedRow {
  request: MaslekaRequest;
  plan: RowPlan;
}

const onBoard = (r: MaslekaRequest): boolean => (BOARD_STAGES as readonly string[]).includes(r.status);

/** Every request still on the board (not expired or cancelled), with its plan. */
export function planRows(requests: MaslekaRequest[], now: Date, snapshotIdByRequest: ReadonlyMap<string, string>): PlannedRow[] {
  return requests.filter(onBoard).map((request) => ({ request, plan: actionFor(request, now, snapshotIdByRequest) }));
}

/** The stage bar: "now" first, then the four stages in order. */
export type BoardView = "now" | BoardStage;
export const BOARD_VIEWS: readonly { view: BoardView; label: string; hint: string }[] = [
  { view: "now", label: "לטיפול עכשיו", hint: "מה שמחכה לפעולה שלך" },
  { view: "invited", label: "1 · ממתין ללקוח", hint: "קיבלו קישור, טרם מילאו" },
  { view: "code_received", label: "2 · מוכן להגשה", hint: "קוד האימות התקבל" },
  { view: "submitted", label: "3 · הוגש במסלקה", hint: "ממתין להורדה" },
  { view: "completed", label: "4 · הושלם", hint: "ניתוח והמלצות" },
];

/** `?stage=` as the bar reads it: one of its views, else "now". */
export function viewFromParam(value: string | null): BoardView {
  return BOARD_VIEWS.some((v) => v.view === value) ? (value as BoardView) : "now";
}

/** "לטיפול עכשיו": the rows that need someone, urgent first, then the oldest first. */
export function nowRows(rows: PlannedRow[]): PlannedRow[] {
  return rows
    .filter((r) => r.plan.needsAction)
    .sort((a, b) => Number(b.plan.urgent) - Number(a.plan.urgent) || a.plan.since - b.plan.since);
}

/** One stage's rows, oldest first — except "הושלם", newest first. */
export function stageRows(rows: PlannedRow[], stage: BoardStage): PlannedRow[] {
  return rows
    .filter((r) => r.plan.stage === stage)
    .sort((a, b) => (stage === "completed" ? b.plan.since - a.plan.since : a.plan.since - b.plan.since));
}

/** The first word of a name, for "שליחה ל<first name>". */
export const firstNameOf = (name: string): string => name.trim().split(/\s+/)[0] ?? "";

/**
 * An Israeli mobile as wa.me takes it: 972 and the number without its leading
 * 0, digits only. Null for anything isIsraeliMobile refuses.
 */
export function whatsappNumber(phone: string): string | null {
  if (!isIsraeliMobile(phone)) return null;
  const digits = phone.replace(/\D/g, "");
  return digits.startsWith("972") ? digits : `972${digits.replace(/^0/, "")}`;
}

/**
 * The click-to-chat link that opens WhatsApp with the client's link in a
 * short message — built in the browser, never sent anywhere: the number is not
 * stored, and goes to no server of ours. No sender is named, since whoever
 * sends it may not be Dorit.
 */
export function whatsappInviteUrl(phone: string, clientName: string, link: string): string | null {
  const number = whatsappNumber(phone);
  if (!number) return null;
  const first = firstNameOf(clientName);
  const text = `${first ? `שלום ${first}, ` : "שלום, "}זה הקישור האישי למסירת קוד האימות של המסלקה, יחד עם מספר הזהות. ההסבר המלא, צעד אחר צעד, מחכה בו:\n${link}`;
  return `https://wa.me/${number}?text=${encodeURIComponent(text)}`;
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
