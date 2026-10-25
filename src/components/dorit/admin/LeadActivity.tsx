import React, { useState } from "react";
import type { LeadEvent, LeadRecord } from "@/services";
import { useAddLeadNote, useLeadEvents, useSetFollowUp } from "@/hooks/useAdmin";
import { ANY_STATUS_LABEL } from "@/lib/lead-pipeline";

const when = (iso: string) =>
  iso ? new Date(iso).toLocaleString("he-IL", { timeZone: "Asia/Jerusalem", dateStyle: "short", timeStyle: "short" }) : "";
/** A follow-up day (YYYY-MM-DD) as Israelis write it. */
export const dayLabel = (ymd: string) => ymd.split("-").reverse().join(".");
const status = (s: string | null) => (s ? ANY_STATUS_LABEL[s] || s : "—");

/** What one line of the log says. */
export function eventText(e: LeadEvent, memberLabel: (id: string | null) => string): string {
  switch (e.kind) {
    case "created":
      return "הפנייה נוצרה";
    case "status":
      return `הסטטוס שונה מ״${status(e.from)}״ ל״${status(e.to)}״`;
    case "assigned":
      return e.to ? `שויכה ל${memberLabel(e.to)}` : "הוחזרה לתור הלא משויכות";
    case "follow_up":
      return e.to ? `מעקב נקבע ל־${dayLabel(e.to)}` : "המעקב בוטל";
    case "merged":
      return "מוזגה לפנייה אחרת";
    case "unmerged":
      return "המיזוג בוטל";
    case "whatsapp":
      return "נשלחה הודעת וואטסאפ";
    case "note":
      return e.note ?? "";
  }
}

/**
 * The drawer's "פעילות" tab: the next follow-up, a note, and the lead's log —
 * status changes, assignments, notes and the rest, each with who and when.
 * The log is written by the database (lead_events), so a change made anywhere
 * shows here.
 */
export default function LeadActivity({
  lead,
  today,
  memberLabel,
}: {
  lead: LeadRecord;
  /** Israel's date, YYYY-MM-DD: no follow-up in the past. */
  today: string;
  /** Who a member is, as this person may see it; null is the system. */
  memberLabel: (id: string | null) => string;
}) {
  const events = useLeadEvents(lead.id);
  const addNote = useAddLeadNote();
  const setFollowUp = useSetFollowUp();
  const [note, setNote] = useState("");

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!note.trim()) return;
    addNote.mutate({ leadId: lead.id, text: note }, { onSuccess: () => setNote("") });
  };

  return (
    <div className="space-y-6">
      <section aria-labelledby="follow-up-title">
        <h3 id="follow-up-title" className="mb-2 text-sm font-bold">המעקב הבא</h3>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="date"
            aria-label="תאריך המעקב הבא"
            min={today}
            value={lead.nextFollowUpOn ?? ""}
            disabled={setFollowUp.isPending}
            onChange={(e) => setFollowUp.mutate({ leadId: lead.id, on: e.target.value || null })}
            className="min-h-11 rounded-md border border-border bg-card px-2 text-sm focus:border-accent focus:outline-none"
          />
          {lead.nextFollowUpOn ? (
            <button
              type="button"
              onClick={() => setFollowUp.mutate({ leadId: lead.id, on: null })}
              disabled={setFollowUp.isPending}
              className="min-h-11 px-2 text-sm text-muted-foreground hover:text-foreground disabled:opacity-40"
            >
              ביטול המעקב
            </button>
          ) : null}
        </div>
        {setFollowUp.isError ? (
          <p role="alert" className="mt-1 text-sm text-destructive">{(setFollowUp.error as Error).message}</p>
        ) : null}
      </section>

      <form onSubmit={submit} aria-labelledby="note-title">
        <h3 id="note-title" className="mb-2 text-sm font-bold">הערה</h3>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={2000}
          rows={3}
          aria-label="הערה חדשה"
          placeholder="מה סוכם, מה הלאה — בלי מספרי זהות או חשבון"
          className="w-full rounded-md border border-border bg-card p-2 text-sm focus:border-accent focus:outline-none"
        />
        {addNote.isError ? (
          <p role="alert" className="mt-1 text-sm text-destructive">{(addNote.error as Error).message}</p>
        ) : null}
        <button
          type="submit"
          disabled={!note.trim() || addNote.isPending}
          className="mt-2 min-h-11 rounded-md bg-accent px-4 text-sm font-medium text-accent-foreground disabled:opacity-40"
        >
          הוספת הערה
        </button>
      </form>

      <section aria-labelledby="log-title">
        <h3 id="log-title" className="mb-2 text-sm font-bold">יומן פעילות</h3>
        {events.isPending ? (
          <p className="text-sm text-muted-foreground">טוען…</p>
        ) : events.isError ? (
          <p role="alert" className="text-sm text-destructive">לא הצלחנו לטעון את היומן.</p>
        ) : !events.data?.length ? (
          <p className="text-sm text-muted-foreground">אין עדיין פעילות.</p>
        ) : (
          <ol className="space-y-3">
            {events.data.map((e) => (
              <li key={e.id} className="border-s-2 border-border ps-3">
                <p className={`text-sm ${e.kind === "note" ? "whitespace-pre-wrap" : ""}`}>{eventText(e, memberLabel)}</p>
                <p className="text-xs text-muted-foreground">
                  {memberLabel(e.actorId)} · {when(e.at)}
                </p>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
