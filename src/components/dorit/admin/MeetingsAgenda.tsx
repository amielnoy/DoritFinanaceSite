import React, { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Plus } from "lucide-react";
import type { AgendaMeeting, LeadRecord } from "@/services";
import { useHandleMeetingRequest } from "@/hooks/useAdmin";
import { ctaClass } from "@/components/dorit/primitives/Cta";
import { Field, inputClass } from "@/components/dorit/primitives/Field";
import SideDrawer from "@/components/dorit/admin/SideDrawer";
import { NewMeetingForm } from "@/components/dorit/admin/LeadMeetings";
import {
  DEFAULT_DURATION_MIN, MEETING_KIND_LABEL, MEETING_MODE_LABEL, MEETING_REQUEST_LABEL, MEETING_STATUS_LABEL,
} from "@/lib/meetings";
import {
  type AgendaFilter, agendaCounts, agendaGroups, meetingTime, needsSummary,
} from "@/lib/meetings-agenda";

/**
 * The agency's meetings, the "פגישות" tab of /admin/leads (behind
 * VITE_MEETINGS_STAFF): four cards, the views as chips, and an agenda grouped
 * by Israel's day. Row-level security decides which meetings arrive —
 * can_see_lead, so a User's agenda holds their assigned leads' meetings — and
 * nothing here filters rows by role; the assignee select is a view, for Admin+.
 *
 * A meeting opens in the lead's drawer, where it is edited; a client's open
 * request is marked handled here or there, through the same hook. Everything a
 * visitor or staff member typed — a name, a topic, a place, a request's note —
 * renders as a text node.
 */

/** "" is everyone; NO_ONE the meetings of leads nobody is assigned. */
const NO_ONE = "__unassigned";

const CHIPS: { key: AgendaFilter; label: string }[] = [
  { key: "upcoming", label: "קרובות" },
  { key: "past", label: "עברו" },
  { key: "requests", label: "בקשות שינוי" },
  { key: "unsummarised", label: "בלי סיכום" },
  { key: "cancelled", label: "בוטלו" },
];

const errorText = (e: unknown) => (e instanceof Error ? e.message : "הפעולה לא נשמרה. ניתן לנסות שוב.");

export interface Assignee {
  id: string;
  label: string;
}

export default function MeetingsAgenda({
  meetings,
  isPending,
  isError,
  now,
  assigns,
  assignees,
  assigneeLabel,
  leads,
  onOpenMeeting,
  focusMeetingId = null,
}: {
  meetings: AgendaMeeting[] | undefined;
  isPending: boolean;
  isError: boolean;
  now: Date;
  /** Admin+: the assignee on each card, and the select that narrows to one. */
  assigns: boolean;
  assignees: Assignee[];
  assigneeLabel: (id: string | null | undefined) => string;
  /** The leads the person can see — "פגישה חדשה" picks one of these. */
  leads: LeadRecord[];
  onOpenMeeting: (leadId: string, meetingId: string) => void;
  /** A meeting to bring into view on arrival — the leads table's "הפגישה הבאה". */
  focusMeetingId?: string | null;
}) {
  const [filter, setFilter] = useState<AgendaFilter>("upcoming");
  const [assignee, setAssignee] = useState("");
  const [adding, setAdding] = useState(false);

  const shown = useMemo(
    () =>
      (meetings ?? []).filter(
        (m) => !assigns || assignee === "" || (assignee === NO_ONE ? !m.assignedUserId : m.assignedUserId === assignee),
      ),
    [meetings, assigns, assignee],
  );
  const counts = useMemo(() => agendaCounts(shown, now), [shown, now]);
  const groups = useMemo(() => agendaGroups(shown, filter, now), [shown, filter, now]);

  // "הפגישה הבאה" lands here: bring that meeting into view once it has rendered.
  const focused = useRef(false);
  useEffect(() => {
    if (focused.current || !focusMeetingId || !meetings) return;
    focused.current = true;
    document.getElementById(`agenda-meeting-${focusMeetingId}`)?.scrollIntoView?.({ block: "center" });
  }, [focusMeetingId, meetings]);

  const cards: { key: AgendaFilter; label: string; count: number; hint: string }[] = [
    { key: "today", label: "היום", count: counts.today, hint: "פגישות שנקבעו להיום" },
    { key: "week", label: "השבוע", count: counts.week, hint: "מהיום ועד שבת" },
    { key: "requests", label: "בקשות שינוי פתוחות", count: counts.requests, hint: "לקוחות שביקשו מועד אחר או ביטול" },
    { key: "unsummarised", label: "התקיימו, בלי סיכום", count: counts.unsummarised, hint: "עוד לא פורסם סיכום ללקוח" },
  ];

  return (
    <div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
        {cards.map((c) => {
          const active = filter === c.key;
          return (
            <button
              key={c.key}
              type="button"
              aria-pressed={active}
              onClick={() => setFilter(c.key)}
              className={`rounded-[4px] border p-5 text-right transition-colors ${
                active ? "border-highlight bg-secondary" : "border-border bg-card hover:border-highlight"
              }`}
            >
              <span className="block text-sm text-muted-foreground">{c.label}</span>
              <span className={`block font-heading text-3xl mt-2 ${active ? "text-accent" : ""}`}>{isPending || isError ? "—" : c.count}</span>
              <span className="block text-sm text-muted-foreground mt-1">{c.hint}</span>
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="תצוגת הפגישות">
          {CHIPS.map((c) => {
            const active = filter === c.key;
            return (
              <button
                key={c.key}
                type="button"
                aria-pressed={active}
                onClick={() => setFilter(c.key)}
                className={`min-h-10 rounded-[4px] border px-4 text-sm transition-colors ${
                  active ? "border-highlight bg-secondary text-accent" : "border-border hover:border-highlight"
                }`}
              >
                {c.label}
              </button>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {assigns ? (
            <label className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">צוות</span>
              <select
                value={assignee}
                onChange={(e) => setAssignee(e.target.value)}
                className="min-h-10 max-w-[14rem] rounded-[4px] border border-input bg-background px-2 text-sm focus:outline-none focus:border-highlight"
              >
                <option value="">כל הצוות</option>
                <option value={NO_ONE}>לא שויכו</option>
                {assignees.map((a) => (
                  <option key={a.id} value={a.id}>{a.label}</option>
                ))}
              </select>
            </label>
          ) : null}
          <button type="button" onClick={() => setAdding(true)} className={ctaClass("min-h-11 px-4 text-base")}>
            <Plus size={16} aria-hidden="true" /> פגישה חדשה
          </button>
        </div>
      </div>

      {isPending ? (
        <div className="flex justify-center py-20">
          <Loader2 className="animate-spin text-accent" size={28} aria-label="טוען" />
        </div>
      ) : isError ? (
        <div className="text-center py-20 border border-dashed border-border">
          <p role="alert" className="text-destructive">לא הצלחנו לטעון את הפגישות. ניתן לרענן את הדף.</p>
        </div>
      ) : groups.length === 0 ? (
        <div className="text-center py-20 border border-dashed border-border">
          <p className="text-muted-foreground">אין פגישות להצגה.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-8">
          {groups.map((g) => (
            <section key={g.key} aria-labelledby={`agenda-day-${g.key}`}>
              <h2 id={`agenda-day-${g.key}`} className="mb-3 flex items-baseline gap-2 border-b border-border pb-2 font-heading text-xl">
                {g.label}
                <span className="text-sm text-muted-foreground">{g.meetings.length === 1 ? "פגישה אחת" : `${g.meetings.length} פגישות`}</span>
              </h2>
              <ul className="flex flex-col gap-3">
                {g.meetings.map((m) => (
                  <li key={m.id}>
                    <AgendaCard
                      meeting={m}
                      now={now}
                      assignee={assigns ? (m.assignedUserId ? assigneeLabel(m.assignedUserId) : "לא שויכה") : null}
                      onOpen={() => onOpenMeeting(m.leadId, m.id)}
                    />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      <NewMeetingPicker open={adding} leads={leads} onClose={() => setAdding(false)} />
    </div>
  );
}

/** One meeting: its time on the right, who and what, its status and one action. */
function AgendaCard({
  meeting: m,
  now,
  assignee,
  onOpen,
}: {
  meeting: AgendaMeeting;
  now: Date;
  assignee: string | null;
  onOpen: () => void;
}) {
  const name = m.leadName || "פנייה ללא שם";
  const meta = [MEETING_KIND_LABEL[m.kind], m.mode ? MEETING_MODE_LABEL[m.mode] : "", m.location, assignee ?? ""].filter(Boolean).join(" · ");
  const action = needsSummary(m, now) ? "כתיבת סיכום" : "פתיחה";
  return (
    <article id={`agenda-meeting-${m.id}`} aria-label={`${meetingTime(m) || "ללא מועד"} · ${name}`} className="rounded-[4px] border border-border bg-card">
      {m.openRequest ? <RequestStrip leadId={m.leadId} request={m.openRequest} /> : null}
      <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:gap-5">
        <div className="flex shrink-0 items-baseline gap-2 sm:w-20 sm:flex-col sm:gap-0">
          <span className="font-heading text-2xl tabular-nums">{meetingTime(m) || "—"}</span>
          <span className="text-sm text-muted-foreground">{m.durationMin ?? DEFAULT_DURATION_MIN} דק׳</span>
        </div>
        <div className="min-w-0 flex-1">
          <button
            type="button"
            onClick={onOpen}
            className="text-right font-heading text-lg font-medium underline decoration-highlight underline-offset-4 hover:text-accent"
          >
            {name}
          </button>
          <p className="mt-0.5">{m.topic || MEETING_KIND_LABEL[m.kind]}</p>
          <p className="mt-0.5 text-sm text-muted-foreground">{meta}</p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-3 sm:flex-col sm:items-end">
          <span className="whitespace-nowrap rounded-[4px] border border-border px-2 text-sm">{MEETING_STATUS_LABEL[m.status]}</span>
          <button type="button" onClick={onOpen} aria-label={`${action}: ${name}`} className={ctaClass("min-h-11 px-4 text-base")}>
            {action}
          </button>
        </div>
      </div>
    </article>
  );
}

/** A client's open request on top of its meeting, with "טופל". The meeting itself is changed in the drawer, or not. */
function RequestStrip({ leadId, request }: { leadId: string; request: NonNullable<AgendaMeeting["openRequest"]> }) {
  const handled = useHandleMeetingRequest(leadId);
  return (
    <div role="group" aria-label={MEETING_REQUEST_LABEL[request.kind]} className="border-b border-highlight-muted bg-highlight/10 px-4 py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p>
          <span className="font-semibold">{MEETING_REQUEST_LABEL[request.kind]}</span>
          {request.note ? <> · ״{request.note}״</> : null}
        </p>
        <button
          type="button"
          onClick={() => handled.mutate(request.id)}
          disabled={handled.isPending}
          className={ctaClass("min-h-9 px-3 text-sm")}
        >
          טופל
        </button>
      </div>
      {handled.isError ? <p role="alert" className="pt-2 text-sm text-destructive">{errorText(handled.error)}</p> : null}
    </div>
  );
}

/** "פגישה חדשה" from the agenda: pick one of the visible leads, then the drawer's own form. */
function NewMeetingPicker({ open, leads, onClose }: { open: boolean; leads: LeadRecord[]; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<LeadRecord | null>(null);
  const close = () => {
    setPicked(null);
    setQuery("");
    onClose();
  };
  const q = query.trim();
  const matches = (q ? leads.filter((l) => (l.name ?? "").includes(q) || (l.phone ?? "").includes(q)) : leads).slice(0, 30);

  return (
    <SideDrawer open={open} onClose={close} title="פגישה חדשה" subtitle={picked ? picked.name : "בחירת פנייה"}>
      {picked ? (
        <div className="flex flex-col gap-4">
          <div>
            <button type="button" onClick={() => setPicked(null)} className="text-sm underline decoration-highlight underline-offset-4 hover:text-accent">
              בחירת פנייה אחרת
            </button>
          </div>
          <NewMeetingForm lead={picked} onDone={close} />
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <Field label="חיפוש פנייה">
            <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="שם או טלפון" className={inputClass()} />
          </Field>
          {matches.length === 0 ? (
            <p className="text-muted-foreground">{leads.length === 0 ? "אין פניות לבחור מהן." : "לא נמצאה פנייה כזו."}</p>
          ) : (
            <ul className="flex flex-col gap-2" aria-label="פניות">
              {matches.map((l) => (
                <li key={l.id}>
                  <button
                    type="button"
                    onClick={() => setPicked(l)}
                    className="flex w-full min-h-11 items-center justify-between gap-3 rounded-[4px] border border-border px-3 py-2 text-right hover:border-highlight"
                  >
                    <span className="font-medium">{l.name}</span>
                    <span dir="ltr" className="text-sm text-muted-foreground">{l.phone}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </SideDrawer>
  );
}
