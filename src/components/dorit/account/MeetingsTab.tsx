import React, { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarPlus, Check, Clock, Info, MapPin, X } from "lucide-react";
import Eyebrow from "@/components/dorit/primitives/Eyebrow";
import { CtaLink, ctaClass } from "@/components/dorit/primitives/Cta";
import { useT } from "@/i18n/LocaleContext";
import {
  CLIENT_MODE_LABEL, MEETING_KIND_LABEL, MEETING_STATUS_LABEL, DEFAULT_DURATION_MIN,
  dateTile, dayMonth, longWhen, orderClientMeetings, timeRange,
  type ClientMeeting, type MeetingRequestKind,
} from "@/lib/meetings";
import { eventTitle, googleCalendarUrl, icsFor } from "@/lib/calendar-file";

/**
 * "הפגישות שלי" in /account (docs/superpowers/specs/2026-10-17-client-meetings-design.md,
 * Frontend — Client; the canvas "הפגישות שלי — לקוח"). Behind VITE_MEETINGS_CLIENT.
 *
 * The next meeting on its own card, with "הוספה ליומן שלי" and a request to
 * change it; then the other upcoming ones; then the past ones with the summary
 * Dorit chose to publish ("מה סיכמנו"); cancelled ones collapsed. Everything is
 * plain text — a summary is shown as written, never as markdown or HTML.
 */

const BOOKING_HREF = "/#start";
const titleOf = (m: ClientMeeting) => m.topic || MEETING_KIND_LABEL[m.kind];

export default function MeetingsTab({
  userKey,
  load,
  requestChange,
  now = new Date(),
}: {
  userKey: string;
  load: () => Promise<ClientMeeting[]>;
  requestChange: (meetingId: string, kind: MeetingRequestKind, note?: string) => Promise<void>;
  now?: Date;
}) {
  const tc = useT("common");
  const client = useQueryClient();
  const key = ["account", "meetings", userKey] as const;
  const query = useQuery<ClientMeeting[], unknown>({ queryKey: key, queryFn: load, retry: false });
  const [asking, setAsking] = useState<ClientMeeting | null>(null);

  if (query.isPending) return <p role="status" className="text-muted-foreground">טוען…</p>;
  if (query.isError) {
    return (
      <div role="alert">
        לא הצלחנו לטעון את הפגישות.{" "}
        <button type="button" className="underline" onClick={() => void query.refetch()}>ניסיון נוסף</button>
      </div>
    );
  }
  if (query.data.length === 0) {
    return (
      <div className="rounded-[4px] border border-border p-6">
        <p className="font-heading text-xl">עוד אין כאן פגישות</p>
        <p className="mt-2 text-muted-foreground">פגישות שתקבעו עם דורית יופיעו כאן, עם מה שסיכמתם בהן.</p>
        <CtaLink href={BOOKING_HREF} className="mt-4">לתיאום פגישה עם דורית</CtaLink>
      </div>
    );
  }

  const { next, upcoming, past, cancelled } = orderClientMeetings(query.data, now);
  const anyPublished = past.some((m) => m.clientSummary);

  return (
    <div className="flex flex-col gap-10">
      {next ? (
        <section aria-labelledby="meetings-next" className="flex flex-col gap-3">
          <h2 id="meetings-next"><Eyebrow index="01">הפגישה הבאה</Eyebrow></h2>
          <NextMeeting meeting={next} onAsk={() => setAsking(next)} />
        </section>
      ) : null}

      {upcoming.length ? (
        <section aria-labelledby="meetings-upcoming" className="flex flex-col gap-3">
          <h2 id="meetings-upcoming"><Eyebrow index={next ? "02" : "01"}>בהמשך</Eyebrow></h2>
          <ul className="flex flex-col gap-3">
            {upcoming.map((m) => (
              <li key={m.id} className="flex flex-col gap-1 rounded-[4px] border border-border px-5 py-4">
                <h3 className="font-heading text-xl font-medium">{titleOf(m)}</h3>
                <span className="text-muted-foreground">
                  {[longWhen(m.scheduledAt), m.mode ? CLIENT_MODE_LABEL[m.mode] : null].filter(Boolean).join(" · ")}
                </span>
                <RequestState meeting={m} onAsk={() => setAsking(m)} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {past.length ? (
        <section aria-labelledby="meetings-past" className="flex flex-col gap-3">
          <h2 id="meetings-past"><Eyebrow index={String((next ? 1 : 0) + (upcoming.length ? 1 : 0) + 1).padStart(2, "0")}>פגישות שהתקיימו</Eyebrow></h2>
          <ul className="flex flex-col gap-3">
            {past.map((m) => (
              <li key={m.id} className="flex flex-col gap-2.5 rounded-[4px] border border-border p-5">
                <div className="flex flex-col gap-0.5">
                  <h3 className="font-heading text-xl font-medium">{titleOf(m)}</h3>
                  <span className="text-muted-foreground">
                    {[dayMonth(m.scheduledAt), MEETING_STATUS_LABEL[m.status === "scheduled" ? "done" : m.status], m.mode ? CLIENT_MODE_LABEL[m.mode] : null]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </div>
                {m.clientSummary ? (
                  <div className="flex flex-col gap-1.5 rounded-[4px] bg-secondary px-4 py-3.5">
                    <span className="text-sm font-semibold text-accent">מה סיכמנו</span>
                    <p className="whitespace-pre-line leading-relaxed">{m.clientSummary}</p>
                    <span className="text-sm text-muted-foreground">פורסם על ידי דורית · {dayMonth(m.summaryPublishedAt)}</span>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {cancelled.length ? (
        <details className="border-t border-border pt-2">
          <summary className="flex min-h-11 cursor-pointer items-center text-muted-foreground">
            {cancelled.length === 1 ? "פגישה אחת בוטלה" : `${cancelled.length} פגישות בוטלו`}
          </summary>
          <ul className="flex flex-col gap-1 text-muted-foreground">
            {cancelled.map((m) => (
              <li key={m.id}>{[dayMonth(m.scheduledAt), titleOf(m), "בוטלה"].filter(Boolean).join(" · ")}</li>
            ))}
          </ul>
        </details>
      ) : null}

      <section aria-labelledby="meetings-more" className="flex flex-col gap-3 border-t border-foreground pt-6">
        <h2 id="meetings-more" className="font-heading text-2xl">רוצים לקבוע פגישה נוספת?</h2>
        <CtaLink href={BOOKING_HREF} className="self-start">לתיאום פגישה עם דורית</CtaLink>
        {/* Under the summaries, always: a summary is an account of the meeting,
            not advice in writing (spec, Retention and privacy). */}
        <p className="text-sm leading-relaxed text-muted-foreground">
          {anyPublished ? "הסיכומים כאן הם תיעוד של מה שדובר בפגישה ואינם ייעוץ בכתב. " : ""}
          {tc("compliance.pensionMarketing")}
        </p>
      </section>

      <ChangeRequestSheet
        meeting={asking}
        onClose={() => setAsking(null)}
        onSend={async (kind, note) => {
          await requestChange(asking!.id, kind, note);
          await client.invalidateQueries({ queryKey: key });
        }}
      />
    </div>
  );
}

function NextMeeting({ meeting: m, onAsk }: { meeting: ClientMeeting; onAsk: () => void }) {
  const tile = dateTile(m.scheduledAt!);
  return (
    <article className="flex flex-col gap-4 rounded-[4px] border border-highlight p-5 sm:p-7">
      <div className="flex items-start gap-4">
        <div className="w-16 shrink-0 rounded-[4px] border border-border bg-secondary pb-2 pt-1.5 text-center">
          <div className="text-sm text-muted-foreground">{tile.month}</div>
          <div className="font-heading text-[32px] leading-none">{tile.day}</div>
          <div className="text-sm text-muted-foreground">{tile.weekday}</div>
        </div>
        <div className="flex min-w-0 flex-col gap-0.5">
          <h3 className="font-heading text-2xl font-medium leading-snug">{titleOf(m)}</h3>
          <span className="text-muted-foreground">{MEETING_KIND_LABEL[m.kind]} · עם דורית</span>
        </div>
      </div>
      <dl className="grid grid-cols-[24px_minmax(0,1fr)] gap-2.5">
        <dt className="flex items-center"><Clock size={18} className="text-highlight" aria-label="שעה" /></dt>
        <dd>{timeRange(m.scheduledAt!, m.durationMin)} · {m.durationMin ?? DEFAULT_DURATION_MIN} דקות</dd>
        {m.mode || m.location ? (
          <>
            <dt className="flex items-center"><MapPin size={18} className="text-highlight" aria-label="מקום" /></dt>
            <dd className="break-words">{[m.mode ? CLIENT_MODE_LABEL[m.mode] : null, m.location || null].filter(Boolean).join(" — ")}</dd>
          </>
        ) : null}
        <dt className="flex items-center"><Check size={18} className="text-highlight" aria-label="סטטוס" /></dt>
        <dd>{m.inCalendar ? "ביומן של דורית" : "ממתינה לאישור דורית"}</dd>
      </dl>
      <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:gap-4">
        <AddToCalendar meeting={m} />
        <RequestState meeting={m} onAsk={onAsk} />
      </div>
    </article>
  );
}

/** "בקשה לשינוי", or — while one is open — that Dorit will answer it. */
function RequestState({ meeting: m, onAsk }: { meeting: ClientMeeting; onAsk: () => void }) {
  if (m.openRequest) {
    return (
      <button type="button" disabled className="self-start rounded-[4px] border border-highlight-muted px-2 text-sm text-accent">
        {m.openRequest === "cancel" ? "ביקשת לבטל" : "ביקשת מועד אחר"} — דורית תחזור אליך
      </button>
    );
  }
  return (
    <button type="button" onClick={onAsk} className="flex min-h-11 items-center self-start text-accent underline underline-offset-4">
      צריך לשנות? בקשה לשינוי מועד או ביטול
    </button>
  );
}

/** Google, or an .ics for Apple and Outlook — both made here, from the row. */
function AddToCalendar({ meeting: m }: { meeting: ClientMeeting }) {
  const [open, setOpen] = useState(false);
  const title = eventTitle(m, MEETING_KIND_LABEL[m.kind]);
  const google = googleCalendarUrl(m, title);
  const ics = icsFor(m, title);
  if (!google || !ics) return null;
  const download = () => {
    const url = URL.createObjectURL(new Blob([ics], { type: "text/calendar;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "meeting-dorit.ics";
    a.click();
    URL.revokeObjectURL(url);
    setOpen(false);
  };
  return (
    <div className="relative">
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className={ctaClass("w-full sm:w-auto")}>
        <CalendarPlus size={18} aria-hidden="true" /> הוספה ליומן שלי
      </button>
      {open ? (
        <div className="mt-2 flex flex-col rounded-[4px] border border-border bg-background sm:absolute sm:z-10 sm:min-w-56">
          <a href={google} target="_blank" rel="noopener noreferrer" onClick={() => setOpen(false)} className="flex min-h-11 items-center px-4 hover:bg-secondary">
            יומן Google
          </a>
          <button type="button" onClick={download} className="flex min-h-11 items-center px-4 text-right hover:bg-secondary">
            Apple / Outlook (קובץ ‎.ics)
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** The change request (the canvas's sheet): a bottom sheet on a phone, a dialog from sm up. */
function ChangeRequestSheet({
  meeting,
  onClose,
  onSend,
}: {
  meeting: ClientMeeting | null;
  onClose: () => void;
  onSend: (kind: MeetingRequestKind, note?: string) => Promise<void>;
}) {
  const [kind, setKind] = useState<MeetingRequestKind>("reschedule");
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    setKind("reschedule");
    setNote("");
    setError(null);
    onClose();
  };
  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    setSending(true);
    setError(null);
    try {
      await onSend(kind, note.trim() || undefined);
      close();
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : "הבקשה לא נשלחה. אפשר לנסות שוב.");
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog.Root open={Boolean(meeting)} onOpenChange={(next) => (next ? undefined : close())}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-primary/40" />
        <Dialog.Content
          aria-modal="true"
          dir="rtl"
          className="fixed inset-x-0 bottom-0 z-50 flex max-h-[90vh] flex-col gap-5 overflow-y-auto rounded-t-[4px] border-t border-highlight bg-background px-5 pb-7 pt-4 sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:w-full sm:max-w-md sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-[4px] sm:border"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex flex-col gap-1">
              <Dialog.Title className="font-heading text-2xl">בקשה לשינוי</Dialog.Title>
              <Dialog.Description className="text-muted-foreground">
                {meeting ? `${titleOf(meeting)} · ${longWhen(meeting.scheduledAt)}` : ""}
              </Dialog.Description>
            </div>
            <Dialog.Close aria-label="סגירה" className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[4px] border border-border">
              <X size={18} aria-hidden="true" />
            </Dialog.Close>
          </div>

          <form onSubmit={send} className="flex flex-col gap-5">
            <fieldset className="flex flex-col gap-2.5">
              <legend className="mb-2.5 font-semibold">מה צריך?</legend>
              {([["reschedule", "מועד אחר", "דורית תציע מועד חדש"], ["cancel", "ביטול הפגישה", null]] as const).map(([value, label, hint]) => (
                <label
                  key={value}
                  className={`flex min-h-14 items-center gap-3 rounded-[4px] border px-4 ${kind === value ? "border-highlight bg-secondary" : "border-border"}`}
                >
                  <input type="radio" name="request-kind" value={value} checked={kind === value} onChange={() => setKind(value)} className="h-5 w-5 accent-[hsl(var(--accent))]" />
                  <span className="flex flex-col leading-snug">
                    <span>{label}</span>
                    {hint ? <span className="text-sm text-muted-foreground">{hint}</span> : null}
                  </span>
                </label>
              ))}
            </fieldset>

            <div className="flex flex-col gap-2">
              <label htmlFor="request-note" className="font-semibold">
                הערה לדורית <span className="font-normal text-muted-foreground">(לא חובה)</span>
              </label>
              <textarea
                id="request-note"
                rows={3}
                maxLength={500}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="למשל: מתאים לי יותר אחר הצהריים באותו שבוע"
                aria-describedby="request-note-hint"
                className="min-h-24 w-full resize-y rounded-[4px] border border-input bg-transparent px-3.5 py-3 leading-relaxed"
              />
              <span id="request-note-hint" className="text-sm text-muted-foreground">בלי מספר זהות, מספרי פוליסה או מידע רפואי.</span>
            </div>

            <p className="flex items-start gap-2.5">
              <Info size={18} aria-hidden="true" className="mt-1 shrink-0 text-highlight" />
              <span>הפגישה נשארת ביומן כפי שהיא עד שדורית תאשר את השינוי.</span>
            </p>

            {error ? <p role="alert" className="text-destructive">{error}</p> : null}

            <div className="flex flex-col gap-2">
              <button type="submit" disabled={sending} className={ctaClass("w-full")}>
                {sending ? "שולחים…" : "שליחת הבקשה לדורית"}
              </button>
              <Dialog.Close className="flex min-h-11 items-center justify-center text-muted-foreground">חזרה בלי לשלוח</Dialog.Close>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
