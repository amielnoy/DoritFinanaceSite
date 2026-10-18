import React, { useEffect, useRef, useState } from "react";
import { Check, Eye, Lock, Loader2, Plus } from "lucide-react";
import type { LeadMeeting, LeadRecord } from "@/services";
import { useAddMeeting, useHandleMeetingRequest, useLeadMeetings, useUpdateMeeting } from "@/hooks/useAdmin";
import { ctaClass } from "@/components/dorit/primitives/Cta";
import { Field, inputClass } from "@/components/dorit/primitives/Field";
import {
  type MeetingKind, type MeetingMode, type MeetingStatus,
  MEETING_DURATIONS, MEETING_KIND_LABEL, MEETING_MODE_LABEL, MEETING_REQUEST_LABEL, MEETING_STATUS_LABEL,
  STAFF_MEETING_KINDS, meetingStamp, meetingWhen,
} from "@/lib/meetings";
import { israelInstant, israelToday } from "@/lib/wall-clock";

/**
 * A lead's meetings, in the lead drawer's "פגישות" tab
 * (docs/superpowers/specs/2026-10-17-client-meetings-design.md, Staff).
 *
 * Every write goes under the person's own session: can_see_lead decides which
 * leads' meetings arrive and which writes apply, and a write it filters out is
 * reported, never shown as saved. Dorit's notes and the client's summary are
 * two fields on purpose — the notes never leave the staff screen; the summary
 * reaches the client's personal area only once published. Everything here is
 * plain text: nothing is rendered as markdown or HTML.
 */

const small = (extra?: string, opts?: { muted?: boolean }) => ctaClass(`min-h-11 px-4 text-base ${extra ?? ""}`, opts);
const errorText = (e: unknown) => (e instanceof Error ? e.message : "הפעולה לא נשמרה. ניתן לנסות שוב.");

export default function LeadMeetings({
  lead,
  initialOpenId = null,
  startAdding = false,
}: {
  lead: LeadRecord;
  /** A meeting to show expanded on arrival — the agenda's "פתיחה". */
  initialOpenId?: string | null;
  /** Open the new-meeting form on arrival — the leads table's "+ קביעת פגישה". */
  startAdding?: boolean;
}) {
  const { data, isPending, isError } = useLeadMeetings(lead.id);
  const [adding, setAdding] = useState(startAdding);
  const [openId, setOpenId] = useState<string | null>(initialOpenId);

  return (
    <section aria-labelledby="lead-meetings" className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h2 id="lead-meetings" className="font-heading text-2xl">פגישות</h2>
        {!adding ? (
          <button type="button" onClick={() => setAdding(true)} className={small()}>
            <Plus size={16} aria-hidden="true" /> פגישה חדשה
          </button>
        ) : null}
      </div>

      {adding ? <NewMeetingForm lead={lead} onDone={() => setAdding(false)} /> : null}

      {isPending ? (
        <div className="flex justify-center py-8"><Loader2 className="animate-spin text-accent" size={22} aria-label="טוען" /></div>
      ) : isError ? (
        <p role="alert" className="text-sm text-destructive">לא הצלחנו לטעון את הפגישות. ניתן לנסות שוב.</p>
      ) : data.length === 0 ? (
        <p className="text-muted-foreground">אין עדיין פגישות לפנייה הזו.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {data.map((m) => (
            <li key={m.id}>
              <MeetingCard
                leadId={lead.id}
                meeting={m}
                open={openId === m.id}
                onToggle={() => setOpenId((id) => (id === m.id ? null : m.id))}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** "14.12 · 17:30 · 45 דק׳ · וידאו · פגישת המשך" — and, for a booking from the site, where it came from. */
function metaLine(m: LeadMeeting): string {
  const parts = [meetingWhen(m.scheduledAt)];
  if (m.durationMin) parts.push(`${m.durationMin} דק׳`);
  if (m.mode) parts.push(MEETING_MODE_LABEL[m.mode]);
  parts.push(m.source ? `נקבעה מהאתר${m.source === "interview" ? " (ראיון)" : ""}` : MEETING_KIND_LABEL[m.kind]);
  return parts.join(" · ");
}

function MeetingCard({ leadId, meeting: m, open, onToggle }: { leadId: string; meeting: LeadMeeting; open: boolean; onToggle: () => void }) {
  const handled = useHandleMeetingRequest(leadId);
  const past = m.status !== "scheduled";
  const panelId = `meeting-${m.id}`;
  // A meeting opened from the agenda may sit below the drawer's fold: bring it into view once.
  const card = useRef<HTMLElement>(null);
  const openedOnArrival = useRef(open);
  useEffect(() => {
    if (openedOnArrival.current) card.current?.scrollIntoView?.({ block: "nearest" });
  }, []);
  return (
    <article ref={card} className={`flex flex-col rounded-[4px] border ${open ? "border-highlight" : "border-border"}`}>
      {m.openRequest ? (
        <div role="status" className="flex items-center justify-between gap-3 border-b border-highlight-muted bg-highlight/10 px-4 py-2.5">
          <span>
            <span className="font-semibold">{MEETING_REQUEST_LABEL[m.openRequest.kind]}</span>
            {m.openRequest.note ? <> · ״{m.openRequest.note}״</> : null}
          </span>
          <button
            type="button"
            onClick={() => handled.mutate(m.openRequest!.id)}
            disabled={handled.isPending}
            className={small("min-h-9 px-3 text-sm")}
          >
            טופל
          </button>
        </div>
      ) : null}
      {handled.isError ? <p role="alert" className="px-4 pt-2 text-sm text-destructive">{errorText(handled.error)}</p> : null}

      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={panelId}
        className="flex items-start justify-between gap-3 p-4 text-right focus-visible:outline focus-visible:outline-2 focus-visible:outline-highlight"
      >
        <span className="flex flex-col">
          <span className="font-heading text-lg font-medium">{m.topic || MEETING_KIND_LABEL[m.kind]}</span>
          <span className="text-muted-foreground">{metaLine(m)}</span>
        </span>
        <span className="whitespace-nowrap rounded-[4px] border border-border px-2 text-sm">
          {MEETING_STATUS_LABEL[m.status]}
          {past && m.status === "done" && !m.summaryPublishedAt ? " · אין סיכום" : ""}
        </span>
      </button>

      {open ? <MeetingEditor leadId={leadId} meeting={m} id={panelId} /> : null}
    </article>
  );
}

function MeetingEditor({ leadId, meeting: m, id }: { leadId: string; meeting: LeadMeeting; id: string }) {
  const update = useUpdateMeeting(leadId);
  const [notes, setNotes] = useState(m.notes);
  const [summary, setSummary] = useState(m.clientSummary);
  const published = Boolean(m.summaryPublishedAt);
  const save = (fields: Parameters<typeof update.mutate>[0]["update"]) => update.mutate({ id: m.id, update: fields });

  return (
    <div id={id} className="flex flex-col gap-4 border-t border-border px-4 pb-4 pt-4">
      <label className="flex items-center gap-2 text-sm">
        <span className="text-muted-foreground">סטטוס</span>
        <select
          value={m.status}
          onChange={(e) => save({ status: e.target.value as MeetingStatus })}
          disabled={update.isPending}
          className="min-h-10 rounded-[4px] border border-input bg-transparent px-2"
        >
          {(Object.keys(MEETING_STATUS_LABEL) as MeetingStatus[]).map((s) => (
            <option key={s} value={s}>{MEETING_STATUS_LABEL[s]}</option>
          ))}
        </select>
      </label>

      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${id}-notes`} className="flex items-center gap-2 font-semibold">
          <Lock size={16} aria-hidden="true" className="text-muted-foreground" />
          הערות פנימיות
          <span className="text-sm font-normal text-muted-foreground">— רק הצוות רואה</span>
        </label>
        <textarea
          id={`${id}-notes`}
          rows={3}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className="w-full resize-y rounded-[4px] border border-input bg-secondary px-3 py-2.5 leading-relaxed"
        />
        <div>
          <button type="button" onClick={() => save({ notes })} disabled={update.isPending || notes === m.notes} className={small("", { muted: true })}>
            שמירת ההערות
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${id}-summary`} className="flex items-center gap-2 font-semibold">
          <Eye size={16} aria-hidden="true" className="text-highlight" />
          סיכום ללקוח
          <span className="text-sm font-normal text-muted-foreground">— יוצג באזור האישי שלו אחרי פרסום</span>
        </label>
        <textarea
          id={`${id}-summary`}
          rows={5}
          maxLength={5000}
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          aria-describedby={`${id}-summary-hint`}
          className="w-full resize-y rounded-[4px] border border-highlight bg-transparent px-3 py-2.5 leading-relaxed"
        />
        <span id={`${id}-summary-hint`} className="text-sm text-muted-foreground">
          תיעוד של מה שדובר — לא המלצה בכתב ולא מסמך הנמקה. בלי מספרי פוליסה או מידע רפואי.
        </span>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3.5">
        <span className="flex items-center gap-2 text-sm text-muted-foreground">
          {published ? (
            <>
              <Check size={16} aria-hidden="true" className="text-accent" />
              פורסם ללקוח · {meetingStamp(m.summaryPublishedAt)}
            </>
          ) : (
            "טרם פורסם ללקוח"
          )}
        </span>
        <div className="flex flex-wrap gap-2">
          {published ? (
            <>
              <button type="button" onClick={() => save({ summaryPublishedAt: null })} disabled={update.isPending} className={small("", { muted: true })}>
                ביטול פרסום
              </button>
              <button
                type="button"
                onClick={() => save({ clientSummary: summary.trim(), summaryPublishedAt: new Date().toISOString() })}
                disabled={update.isPending || !summary.trim() || summary === m.clientSummary}
                className={small()}
              >
                עדכון הסיכום
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => save({ clientSummary: summary.trim(), summaryPublishedAt: new Date().toISOString() })}
              disabled={update.isPending || !summary.trim()}
              className={small()}
            >
              פרסום ללקוח
            </button>
          )}
        </div>
      </div>
      {update.isError ? <p role="alert" className="text-sm text-destructive">{errorText(update.error)}</p> : null}
    </div>
  );
}

/**
 * A meeting staff add: Israel's wall clock in, an instant out (A-63). Also the
 * agenda's "פגישה חדשה", once a lead is picked.
 */
export function NewMeetingForm({ lead, onDone }: { lead: LeadRecord; onDone: () => void }) {
  const add = useAddMeeting(lead.id);
  const [day, setDay] = useState(israelToday(new Date()));
  const [time, setTime] = useState("10:00");
  const [duration, setDuration] = useState<number>(45);
  const [mode, setMode] = useState<MeetingMode>("office");
  const [location, setLocation] = useState("");
  const [kind, setKind] = useState<MeetingKind>("follow_up");
  const [topic, setTopic] = useState("");
  const scheduledAt = israelInstant(day, time);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!scheduledAt || !lead.agency_id) return;
    add.mutate(
      { leadId: lead.id, agencyId: lead.agency_id, scheduledAt, durationMin: duration, mode, location: location.trim(), kind, topic: topic.trim() },
      { onSuccess: onDone },
    );
  };

  return (
    <form onSubmit={submit} aria-label="פגישה חדשה" className="flex flex-col gap-3 rounded-[4px] border border-highlight p-4">
      <div className="grid grid-cols-2 gap-3">
        <Field label="תאריך"><input type="date" required value={day} onChange={(e) => setDay(e.target.value)} className={inputClass()} /></Field>
        <Field label="שעה"><input type="time" required value={time} onChange={(e) => setTime(e.target.value)} className={inputClass()} /></Field>
        <Field label="משך">
          <select value={duration} onChange={(e) => setDuration(Number(e.target.value))} className={inputClass()}>
            {MEETING_DURATIONS.map((d) => <option key={d} value={d}>{d} דק׳</option>)}
          </select>
        </Field>
        <Field label="אופן">
          <select value={mode} onChange={(e) => setMode(e.target.value as MeetingMode)} className={inputClass()}>
            {(Object.keys(MEETING_MODE_LABEL) as MeetingMode[]).map((m) => <option key={m} value={m}>{MEETING_MODE_LABEL[m]}</option>)}
          </select>
        </Field>
      </div>
      <Field label="סוג">
        <select value={kind} onChange={(e) => setKind(e.target.value as MeetingKind)} className={inputClass()}>
          {STAFF_MEETING_KINDS.map((k) => <option key={k} value={k}>{MEETING_KIND_LABEL[k]}</option>)}
        </select>
      </Field>
      <Field label="נושא"><input type="text" maxLength={200} value={topic} onChange={(e) => setTopic(e.target.value)} className={inputClass()} /></Field>
      <Field label={mode === "video" ? "קישור לפגישה" : "מקום"}>
        <input type="text" maxLength={500} value={location} onChange={(e) => setLocation(e.target.value)} className={inputClass()} />
      </Field>
      {add.isError ? <p role="alert" className="text-sm text-destructive">{errorText(add.error)}</p> : null}
      <div className="flex gap-2">
        <button type="submit" disabled={add.isPending || !scheduledAt} className={small()}>שמירת הפגישה</button>
        <button type="button" onClick={onDone} className={small("", { muted: true })}>ביטול</button>
      </div>
    </form>
  );
}
