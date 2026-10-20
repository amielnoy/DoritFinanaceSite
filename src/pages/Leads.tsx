import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { AgendaMeeting, LeadRecord, LeadSource, LeadStatus } from "@/services";
import {
  useAdminUsers, useAgencyMeetings, useAssignLead, useLeads, useLeadTranscript, useRemoveLead, useSetLeadStatus, useTranscriptLeadIds,
} from "@/hooks/useAdmin";
import { useAgencyRole, useCurrentAgency } from "@/hooks/useAgency";
import Eyebrow from "@/components/dorit/primitives/Eyebrow";
import { csvCell } from "@/lib/csv";
import { Loader2, Download, Trash2 } from "lucide-react";
import LeadTrackingPanel from "@/components/dorit/admin/LeadTrackingPanel";
import LeadDrawer, { type LeadDrawerTab } from "@/components/dorit/admin/LeadDrawer";
import LeadDetails from "@/components/dorit/admin/LeadDetails";
import MeetingsAgenda from "@/components/dorit/admin/MeetingsAgenda";
import { MEETINGS_STAFF } from "@/config/meetings";
import { agendaCounts, nextMeetingByLead, nextMeetingLabel } from "@/lib/meetings-agenda";

type LeadItem = LeadRecord;

/* The statuses an admin may set. `escalated` and `partial` are written by the
   backend and are not offered here — an admin moves such a lead on to
   "contacted" or "closed" rather than back into them. */
/* "לקוח/ה" is what keeps an enquiry from being anonymized 24 months after its
   last contact (the privacy policy's period for an enquiry that did not become
   an engagement) — see 20261025000000_lead_retention.sql. */
const STATUS: LeadStatus[] = ["new", "contacted", "closed", "client"];
const STATUS_LABEL: Record<LeadStatus, string> = {
  new: "חדשה",
  contacted: "טופלה",
  closed: "נסגרה",
  client: "לקוח/ה",
};
/* Display labels for every status the entity can hold, settable or not. Without
   the backend-written ones a lead rendered with its raw English key. */
const ANY_STATUS_LABEL: Record<string, string> = {
  ...STATUS_LABEL,
  escalated: "הועברה לטיפול אישי",
  partial: "ראיון שלא הושלם",
};
const STATUS_COLOR: Record<LeadStatus, string> = {
  new: "bg-highlight/15 text-highlight-ink",
  contacted: "bg-accent/15 text-accent",
  closed: "bg-muted text-muted-foreground",
  client: "bg-primary/10 text-foreground",
};
/* Every value the Lead entity's `source` enum can hold. `escalation` was missing
   while this screen kept its own narrower copy of the type, so a lead handed over
   by an agent rendered with its raw English key. */
const SOURCE_LABEL: Record<LeadSource, string> = {
  consultation: "בנאי ייעוץ",
  detailed: "טופס מפורט",
  quick: "פנייה מהירה",
  claim: "דיווח תביעה",
  escalation: "העברה לטיפול אנושי",
  interview: "ראיון היכרות",
  staff: "דרך הצוות",
};

/** The interview behind a lead, read-only — what the client actually said, for the meeting. Plain text only: it is visitor-typed. */
function LeadTranscript({ leadId }: { leadId: string }) {
  const [open, setOpen] = useState(false);
  const { data, isLoading, error } = useLeadTranscript(leadId, open);
  return (
    <div className="mt-2">
      <button type="button" onClick={() => setOpen((o) => !o)} className="text-xs underline text-accent hover:text-foreground">
        {open ? "הסתרת השיחה" : "שיחה"}
      </button>
      {open && (
        <div className="mt-2 max-h-64 overflow-y-auto border border-border/60 p-2 text-xs leading-relaxed whitespace-pre-wrap">
          {isLoading && <span className="text-muted-foreground">טוען…</span>}
          {error && <span className="text-destructive">לא ניתן לטעון את השיחה</span>}
          {data && data.length === 0 && <span className="text-muted-foreground">אין תמליל שמור לפנייה הזו</span>}
          {data?.map((line, i) => (
            <p key={i} className="mb-1">
              <span className="font-medium">{line.role === "user" ? "מבקר/ת" : "עוזר"}:</span> {line.content}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

/** The chips past the settable statuses: what the backend writes, and the unassigned queue. */
/**
 * "דורשות טיפול": new leads, and escalated ones — a visitor who asked for Dorit
 * herself (review 2026-10-15). The card counts both and its filter shows both.
 */
const NEEDS_ATTENTION: string[] = ["new", "escalated"];
const ATTENTION = "attention";
/**
 * The row's actions (status, delete), pinned to the table's left edge: in this
 * right-to-left table they are the last column, the first one a screen too
 * narrow for every column scrolled out of sight — with the trash in it.
 */
const PINNED = "sticky left-0 bg-background shadow-[inset_-1px_0_0_hsl(var(--border)/0.6)]";

const EXTRA_FILTERS: { key: string; label: string; adminOnly?: boolean }[] = [
  { key: "escalated", label: "הועברו לטיפול" },
  { key: "partial", label: "ראיונות שלא הושלמו" },
  { key: "unassigned", label: "לא שויכו", adminOnly: true },
];

type PageTab = "leads" | "meetings" | "tracking";
/**
 * In reading order, right to left: "מעקב לידים" is the leftmost, and the
 * Owner's alone (`leads.tracking`). Whoever may not see it gets the other two.
 */
const PAGE_TABS: PageTab[] = ["leads", "meetings", "tracking"];

/** What the screen adds with VITE_MEETINGS_STAFF: the agenda's one read, the clock, and the tab in the URL. */
interface StaffView {
  agenda: { data: AgendaMeeting[] | undefined; isPending: boolean; isError: boolean; isSuccess: boolean };
  now: Date;
  tab: PageTab;
  setTab(tab: PageTab): void;
  /** Each lead's next meeting — the table's "הפגישה הבאה". */
  next: Map<string, AgendaMeeting>;
  /** The meeting "הפגישה הבאה" pointed at, for the agenda to bring into view. */
  focusMeetingId: string | null;
  showMeeting(meetingId: string): void;
}

/** The time, again each minute: "היום" turns into the next day at midnight without a reload. */
function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

/**
 * Holds the meetings' hooks, so that without VITE_MEETINGS_STAFF the screen
 * calls none of them and is the leads screen exactly as it was. `?tab=` is set
 * beside `?agency=`, never in place of it.
 */
function WithStaffView({
  agencyId,
  tabs,
  children,
}: {
  agencyId: string;
  /** The tabs this person may open; `?tab=` naming another opens "פניות". */
  tabs: PageTab[];
  children: (view: StaffView) => React.ReactNode;
}) {
  const agenda = useAgencyMeetings(agencyId);
  const now = useNow();
  const [params, setParams] = useSearchParams();
  const asked = params.get("tab") as PageTab | null;
  const tab: PageTab = asked && tabs.includes(asked) ? asked : "leads";
  const [focusMeetingId, setFocusMeetingId] = useState<string | null>(null);
  const setTab = useCallback(
    (next: PageTab) =>
      setParams(
        (prev) => {
          const url = new URLSearchParams(prev);
          url.set("tab", next);
          return url;
        },
        { replace: true },
      ),
    [setParams],
  );
  const next = useMemo(() => nextMeetingByLead(agenda.data ?? [], now), [agenda.data, now]);
  const view: StaffView = {
    agenda,
    now,
    tab,
    setTab,
    next,
    focusMeetingId,
    showMeeting: (meetingId) => {
      setFocusMeetingId(meetingId);
      setTab("meetings");
    },
  };
  return <>{children(view)}</>;
}

/**
 * "פניות", "פגישות" and, for the Owner, "מעקב לידים", side by side under the
 * heading: a real tablist, its choice in the URL, the arrow keys moving between
 * them (in a right-to-left page the left arrow goes to the next tab on the left).
 */
function PageTabs({
  tabs,
  tab,
  onSelect,
  labels,
}: {
  tabs: PageTab[];
  tab: PageTab;
  onSelect(tab: PageTab): void;
  labels: Record<PageTab, { title: string; figure: string; line: string }>;
}) {
  const refs = useRef<Record<PageTab, HTMLButtonElement | null>>({ leads: null, meetings: null, tracking: null });
  const go = (next: PageTab) => {
    onSelect(next);
    refs.current[next]?.focus();
  };
  const onKeyDown = (event: React.KeyboardEvent, current: PageTab) => {
    const at = tabs.indexOf(current);
    const step = { ArrowLeft: 1, ArrowRight: -1 }[event.key];
    if (step !== undefined) go(tabs[(at + step + tabs.length) % tabs.length]);
    else if (event.key === "Home") go(tabs[0]);
    else if (event.key === "End") go(tabs[tabs.length - 1]);
    else return;
    event.preventDefault();
  };
  return (
    <div role="tablist" aria-label="פניות ופגישות" className={`grid ${tabs.length === 3 ? "grid-cols-3" : "grid-cols-2"}`}>
      {tabs.map((key) => {
        const active = tab === key;
        const { title, figure, line } = labels[key];
        return (
          <button
            key={key}
            ref={(el) => {
              refs.current[key] = el;
            }}
            type="button"
            role="tab"
            id={`leads-tab-${key}`}
            aria-selected={active}
            aria-controls={`leads-panel-${key}`}
            tabIndex={active ? 0 : -1}
            onClick={() => onSelect(key)}
            onKeyDown={(e) => onKeyDown(e, key)}
            className={`-mb-px min-w-0 border-b-[3px] px-4 py-3 text-right transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-highlight ${
              active ? "border-highlight bg-secondary text-accent" : "border-transparent text-foreground hover:bg-secondary"
            }`}
          >
            <span className="flex flex-wrap items-baseline gap-x-2">
              <span className="font-heading text-xl md:text-2xl">{title}</span>
              {figure ? <span className="font-heading text-xl md:text-2xl tabular-nums">{figure}</span> : null}
            </span>
            <span className="block text-sm text-muted-foreground">{line}</span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * The agency's leads. A User sees only those assigned to them ("הפניות שלי")
 * and may change their status; Admin+ see them all, assign them and delete
 * them. Row-level security decides which rows arrive; the buttons follow
 * src/config/permissions.ts and are refused by the database when shown wrongly.
 *
 * With VITE_MEETINGS_STAFF the screen is "פניות ופגישות": the same leads in the
 * "פניות" tab, with each lead's next meeting, and the agency's agenda in
 * "פגישות" (MeetingsAgenda). Without it, it is the leads screen as it was.
 */
export default function Leads() {
  const { data, isPending: loading, isError } = useLeads();
  const { agencyId } = useCurrentAgency();
  const { can } = useAgencyRole(agencyId);
  const assigns = can("leads.assign");
  const deletes = can("leads.delete");
  const tracks = can("leads.tracking");
  const tabs = useMemo(() => PAGE_TABS.filter((t) => t !== "tracking" || tracks), [tracks]);
  const members = useAdminUsers(assigns);
  const transcriptIds = useTranscriptLeadIds();
  const withTranscript = useMemo(() => new Set(transcriptIds.data ?? []), [transcriptIds.data]);
  const setStatus = useSetLeadStatus();
  const removeLead = useRemoveLead();
  const assignLead = useAssignLead();
  const [filter, setFilter] = useState<string>("all");
  // The lead open in the drawer (VITE_MEETINGS_STAFF), by id so a reload keeps it current.
  const [openLeadId, setOpenLeadId] = useState<string | null>(null);
  // Where the drawer opens when the agenda or "+ קביעת פגישה" opens it. Each such
  // opening is a new drawer (`seq` is its key); the name in the table opens it as before.
  const [drawerStart, setDrawerStart] = useState<{ seq: number; tab: LeadDrawerTab; meetingId: string | null; adding: boolean }>({
    seq: 0, tab: "details", meetingId: null, adding: false,
  });
  const openOnMeetings = (leadId: string, meetingId: string | null, adding = false) => {
    setDrawerStart((d) => ({ seq: d.seq + 1, tab: "meetings", meetingId, adding }));
    setOpenLeadId(leadId);
  };

  // One agency at a time: someone in two sees the one the switcher names.
  const leads: LeadItem[] = (data ?? []).filter((l) => !l.agency_id || l.agency_id === agencyId);
  const busy = setStatus.isPending || removeLead.isPending || assignLead.isPending;
  const writeError = setStatus.isError || removeLead.isError || assignLead.isError;
  /** Who a lead of this agency may go to: its members, by address. */
  const assignees = useMemo(
    () =>
      (members.data ?? [])
        .filter((u) => u.memberships.some((m) => m.orgId === agencyId))
        .map((u) => ({ id: u.id, label: u.email ?? u.id }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [members.data, agencyId],
  );
  const assigneeLabel = (id: string | null | undefined) => (id ? assignees.find((a) => a.id === id)?.label ?? "חבר/ה שכבר לא בסוכנות" : "—");

  const filtered = leads.filter(
    (l) =>
      filter === "all" ||
      (filter === "unassigned"
        ? !l.assigned_user_id && l.status !== "closed"
        : filter === ATTENTION
          ? NEEDS_ATTENTION.includes(l.status)
          : l.status === filter),
  );

  const exportCsv = (all: boolean) => {
    const source = all ? leads : filtered;
    const headers = ["תאריך", "שם", "טלפון", "אימייל", "מקור", "תחום/שירות", "מועד", "סטטוס", "הודעה"];
    const rows = source.map((l) => [
      l.created_date ? new Date(l.created_date).toLocaleString("he-IL") : "",
      l.name,
      l.phone,
      l.email || "",
      SOURCE_LABEL[l.source] || l.source || "",
      l.topic || "",
      l.timing || "",
      ANY_STATUS_LABEL[l.status] || l.status || "",
      l.message || "",
    ]);
    const csv = [headers, ...rows].map((r) => r.map(csvCell).join(",")).join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `leads-${new Date().toISOString().slice(0, 10)}${all ? "-all" : ""}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const updateStatus = (id: string, status: LeadStatus) => setStatus.mutate({ id, status });

  // The lead's meetings and their requests go with it (on delete cascade), so it
  // leaves both tabs at once; the confirmation says so.
  const remove = (lead: LeadItem) => {
    if (!window.confirm(`למחוק את הפנייה של ${lead.name}, עם כל הפגישות שלה? אי אפשר לשחזר.`)) return;
    removeLead.mutate(lead.id, { onSuccess: () => setOpenLeadId((open) => (open === lead.id ? null : open)) });
  };

  const openLead = openLeadId ? leads.find((l) => l.id === openLeadId) ?? null : null;

  const counts = leads.reduce<Record<string, number>>((acc, l) => {
    acc[l.status] = (acc[l.status] || 0) + 1;
    if (!l.assigned_user_id && l.status !== "closed") acc.unassigned = (acc.unassigned || 0) + 1;
    return acc;
  }, {});

  /**
   * The screen, given the meetings' view or — without VITE_MEETINGS_STAFF — none:
   * then it is the leads screen exactly as it was, title and all.
   */
  const page = (staff: StaffView | null) => {
    const leadsContent = (
      <>
            {/* With the tabs it is the Owner's "מעקב לידים" tab; without them, folded above the leads. */}
            {!staff && tracks ? <LeadTrackingPanel /> : null}

            {/* תצוגת סיכום סטטוסים */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
              <button
                onClick={() => setFilter("all")}
                className={`text-right p-5 border transition-colors ${filter === "all" ? "border-primary bg-primary/[0.03]" : "border-border/60 hover:border-accent/50 bg-card"}`}
              >
                <p className="text-sm text-muted-foreground">סה״כ פניות</p>
                <p className="font-heading text-3xl mt-2">{leads.length}</p>
                <p className="text-xs text-muted-foreground mt-1">כל הרשומות במערכת</p>
              </button>
              <button
                onClick={() => setFilter(ATTENTION)}
                className={`text-right p-5 border transition-colors ${filter === ATTENTION ? "border-highlight bg-highlight/10" : "border-border/60 hover:border-highlight/50 bg-card"}`}
              >
                <p className="text-sm text-highlight-ink">דורשות טיפול</p>
                <p className="font-heading text-3xl mt-2 text-highlight-ink">{(counts.new || 0) + (counts.escalated || 0)}</p>
                <p className="text-xs text-muted-foreground mt-1">חדשות, ומי שביקשו את דורית — ליצור קשר</p>
              </button>
              <button
                onClick={() => setFilter("contacted")}
                className={`text-right p-5 border transition-colors ${filter === "contacted" ? "border-accent bg-accent/10" : "border-border/60 hover:border-accent/50 bg-card"}`}
              >
                <p className="text-sm text-accent">בתהליך</p>
                <p className="font-heading text-3xl mt-2 text-accent">{counts.contacted || 0}</p>
                <p className="text-xs text-muted-foreground mt-1">נוצר קשר — להמשיך במכירה</p>
              </button>
              <button
                onClick={() => setFilter("closed")}
                className={`text-right p-5 border transition-colors ${filter === "closed" ? "border-primary bg-primary/[0.03]" : "border-border/60 hover:border-accent/50 bg-card"}`}
              >
                <p className="text-sm text-muted-foreground">נסגרו</p>
                <p className="font-heading text-3xl mt-2 text-muted-foreground">{counts.closed || 0}</p>
                <p className="text-xs text-muted-foreground mt-1">טופלו והסתיימו</p>
              </button>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
              <div className="flex flex-wrap items-center gap-2">
                {[
                  { key: "all", label: "הכל" },
                  ...STATUS.map((s) => ({ key: s, label: STATUS_LABEL[s] })),
                  ...EXTRA_FILTERS.filter((f) => !f.adminOnly || assigns),
                ].map(({ key: s, label }) => {
                  const active = filter === s;
                  const count = s === "all" ? leads.length : counts[s] || 0;
                  return (
                    <button
                      key={s}
                      onClick={() => setFilter(s)}
                      className={`px-4 py-2 text-sm border transition-colors ${
                        active
                          ? "bg-primary text-primary-foreground border-primary"
                          : "border-border hover:border-accent"
                      }`}
                    >
                      {label} <span className="opacity-60">({count})</span>
                    </button>
                  );
                })}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => exportCsv(false)}
                  disabled={!filtered.length}
                  className="inline-flex items-center gap-2 px-4 py-2.5 border border-border text-sm font-medium hover:border-accent hover:text-accent disabled:opacity-40 transition-colors"
                >
                  <Download size={15} /> ייצוא מסונן
                </button>
                <button
                  onClick={() => exportCsv(true)}
                  disabled={!leads.length}
                  className="inline-flex items-center gap-2 px-5 py-2.5 bg-accent text-accent-foreground font-medium hover:bg-accent/90 disabled:opacity-40 transition-colors"
                >
                  <Download size={16} /> ייצוא הכל ל-CSV
                </button>
              </div>
            </div>

            {writeError && (
              <p role="alert" className="mb-4 text-sm text-destructive">
                הפעולה האחרונה לא נשמרה. ניתן לנסות שוב.
              </p>
            )}

            {loading ? (
              <div className="flex justify-center py-20">
                <Loader2 className="animate-spin text-accent" size={28} />
              </div>
            ) : isError ? (
              <div className="text-center py-20 border border-dashed border-border">
                <p className="text-destructive">לא הצלחנו לטעון את הפניות. ניתן לרענן את הדף.</p>
              </div>
            ) : filtered.length === 0 ? (
              <div className="text-center py-20 border border-dashed border-border">
                <p className="text-muted-foreground">אין פניות להצגה.</p>
              </div>
            ) : (
              <div className="overflow-x-auto border border-border/60">
                <table className="w-full text-sm">
                  <thead className="bg-secondary/40 text-muted-foreground">
                    <tr className="text-right">
                      <th className="px-4 py-3 font-medium">תאריך</th>
                      <th className="px-4 py-3 font-medium">שם</th>
                      <th className="px-4 py-3 font-medium">טלפון</th>
                      <th className="px-4 py-3 font-medium">אימייל</th>
                      <th className="px-4 py-3 font-medium">מקור</th>
                      <th className="px-4 py-3 font-medium">פרטים</th>
                      <th className="px-4 py-3 font-medium">סטטוס</th>
                      {assigns ? <th className="px-4 py-3 font-medium">משויכת ל</th> : null}
                      {staff ? <th className="px-4 py-3 font-medium whitespace-nowrap">הפגישה הבאה</th> : null}
                      <th className={`px-4 py-3 font-medium ${PINNED} bg-[image:linear-gradient(hsl(var(--secondary)/0.4),hsl(var(--secondary)/0.4))]`}>
                        <span className="sr-only">פעולות</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((l) => (
                      <tr key={l.id} className="border-t border-border/60 align-top">
                        <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                          {l.created_date ? new Date(l.created_date).toLocaleDateString("he-IL") : "—"}
                        </td>
                        <td className="px-4 py-3 font-medium">
                          {MEETINGS_STAFF ? (
                            <button
                              type="button"
                              onClick={() => {
                                // As before: the drawer opens where it was; no meeting expanded, no form open.
                                setDrawerStart((d) => ({ ...d, meetingId: null, adding: false }));
                                setOpenLeadId(l.id);
                              }}
                              className="text-right underline decoration-highlight underline-offset-4 hover:text-accent"
                            >
                              {l.name}
                            </button>
                          ) : (
                            l.name
                          )}
                        </td>
                        <td className="px-4 py-3" dir="ltr">{l.phone}</td>
                        <td className="px-4 py-3 text-foreground/70" dir="ltr">{l.email || "—"}</td>
                        <td className="px-4 py-3 text-foreground/70">{SOURCE_LABEL[l.source] || "—"}</td>
                        <td className="px-4 py-3">
                          <LeadDetails lead={l} />
                          {withTranscript.has(l.id) && <LeadTranscript leadId={l.id} />}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`inline-block px-2.5 py-1 text-xs ${STATUS_COLOR[l.status] || ""}`}>
                            {ANY_STATUS_LABEL[l.status] || l.status}
                          </span>
                        </td>
                        {assigns ? (
                          <td className="px-4 py-3">
                            <select
                              aria-label={`שיוך הפנייה של ${l.name}`}
                              value={l.assigned_user_id ?? ""}
                              onChange={(e) => assignLead.mutate({ id: l.id, userId: e.target.value || null })}
                              disabled={busy}
                              className="text-xs border border-border bg-background px-2 py-1 max-w-[12rem] focus:outline-none focus:border-accent"
                            >
                              <option value="">לא שויכה</option>
                              {l.assigned_user_id && !assignees.some((a) => a.id === l.assigned_user_id) ? (
                                <option value={l.assigned_user_id}>{assigneeLabel(l.assigned_user_id)}</option>
                              ) : null}
                              {assignees.map((a) => (
                                <option key={a.id} value={a.id}>{a.label}</option>
                              ))}
                            </select>
                          </td>
                        ) : null}
                        {staff ? (
                          <td className="px-4 py-3 whitespace-nowrap">
                            <NextMeetingCell
                              staff={staff}
                              meeting={staff.next.get(l.id)}
                              onSchedule={() => openOnMeetings(l.id, null, true)}
                            />
                          </td>
                        ) : null}
                        <td className={`px-4 py-3 ${PINNED}`}>
                          <div className="flex items-center gap-2">
                            <select
                              aria-label={`סטטוס הפנייה של ${l.name}`}
                              value={l.status}
                              onChange={(e) => updateStatus(l.id, e.target.value as LeadStatus)}
                              disabled={busy}
                              className="text-xs border border-border bg-background px-2 py-1 focus:outline-none focus:border-accent"
                            >
                              {/* A status the backend wrote shows as it is, and cannot be chosen back. */}
                              {!STATUS.includes(l.status) ? (
                                <option value={l.status} disabled>{ANY_STATUS_LABEL[l.status] || l.status}</option>
                              ) : null}
                              {STATUS.map((s) => (
                                <option key={s} value={s}>{STATUS_LABEL[s]}</option>
                              ))}
                            </select>
                            {deletes ? (
                              <button
                                onClick={() => remove(l)}
                                disabled={busy}
                                className="text-muted-foreground hover:text-destructive transition-colors disabled:opacity-30"
                                aria-label="מחיקה"
                              >
                                <Trash2 size={15} />
                              </button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
      </>
    );
    const agenda = staff?.agenda.isSuccess ? agendaCounts(staff.agenda.data ?? [], staff.now) : null;
    const n = (v: number | undefined) => (v === undefined ? "—" : String(v));
    return (
      <div className="min-h-screen bg-background">
        <header className="border-b border-border/60 bg-card">
          <div className="max-w-[1200px] mx-auto px-6 py-5 flex items-center justify-between">
            <div>
              <Eyebrow>טיפול שוטף</Eyebrow>
              <h1 className="font-heading text-2xl md:text-3xl mt-1">{staff ? "פניות ופגישות" : assigns ? "ניהול פניות" : "הפניות שלי"}</h1>
            </div>
          </div>
          {staff ? (
            <div className="max-w-[1200px] mx-auto px-6">
              <PageTabs
                tabs={tabs}
                tab={staff.tab}
                onSelect={staff.setTab}
                labels={{
                  leads: {
                    // A User's are only theirs: the tab keeps the screen's old name for them.
                    title: assigns ? "פניות" : "הפניות שלי",
                    figure: String(leads.length),
                    line: [
                      `${(counts.new || 0) + (counts.escalated || 0)} דורשות טיפול`,
                      ...(assigns ? [`${counts.unassigned || 0} לא שויכו`] : []),
                    ].join(" · "),
                  },
                  meetings: {
                    title: "פגישות",
                    figure: `${n(agenda?.week)} השבוע`,
                    line: `${n(agenda?.today)} היום · ${n(agenda?.requests)} בקשות שינוי · ${n(agenda?.unsummarised)} בלי סיכום`,
                  },
                  tracking: {
                    title: "מעקב לידים",
                    figure: "",
                    line: "מה האתר מדווח ל-Google Analytics",
                  },
                }}
              />
            </div>
          ) : null}
        </header>

        <main id="main" className="max-w-[1200px] mx-auto px-6 py-8">
          {staff ? (
            <>
              <div role="tabpanel" id="leads-panel-leads" aria-labelledby="leads-tab-leads" hidden={staff.tab !== "leads"}>
                {staff.tab === "leads" ? leadsContent : null}
              </div>
              <div role="tabpanel" id="leads-panel-meetings" aria-labelledby="leads-tab-meetings" hidden={staff.tab !== "meetings"}>
                {staff.tab === "meetings" ? (
                  <MeetingsAgenda
                    meetings={staff.agenda.data}
                    isPending={staff.agenda.isPending}
                    isError={staff.agenda.isError}
                    now={staff.now}
                    assigns={assigns}
                    assignees={assignees}
                    assigneeLabel={assigneeLabel}
                    leads={leads}
                    onOpenMeeting={(leadId, meetingId) => openOnMeetings(leadId, meetingId)}
                    focusMeetingId={staff.focusMeetingId}
                  />
                ) : null}
              </div>
              {tracks ? (
                <div role="tabpanel" id="leads-panel-tracking" aria-labelledby="leads-tab-tracking" hidden={staff.tab !== "tracking"}>
                  {staff.tab === "tracking" ? <LeadTrackingPanel collapsible={false} /> : null}
                </div>
              ) : null}
            </>
          ) : (
            leadsContent
          )}
        </main>

          {MEETINGS_STAFF ? (
            <LeadDrawer
              key={drawerStart.seq}
              lead={openLead}
              initialTab={drawerStart.tab}
              meetingId={drawerStart.meetingId}
              startAdding={drawerStart.adding}
              onClose={() => setOpenLeadId(null)}
              onDelete={deletes && openLead ? () => remove(openLead) : undefined}
              deleting={removeLead.isPending}
              deleteFailed={removeLead.isError}
              subtitle={openLead ? `${ANY_STATUS_LABEL[openLead.status] || openLead.status} · ${SOURCE_LABEL[openLead.source] || "—"}` : ""}
              details={
                openLead ? (
                  <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
                    <dt className="text-muted-foreground">תאריך</dt>
                    <dd>{openLead.created_date ? new Date(openLead.created_date).toLocaleString("he-IL", { timeZone: "Asia/Jerusalem" }) : "—"}</dd>
                    <dt className="text-muted-foreground">טלפון</dt>
                    {/* Text, not a tel: link — the number is visitor-typed (agent-surface.security). */}
                    <dd dir="ltr" className="text-right">{openLead.phone}</dd>
                    <dt className="text-muted-foreground">אימייל</dt>
                    <dd dir="ltr" className="text-right">{openLead.email || "—"}</dd>
                    <dt className="text-muted-foreground">משויכת ל</dt>
                    <dd>{assigneeLabel(openLead.assigned_user_id)}</dd>
                    <dt className="text-muted-foreground">פרטים</dt>
                    <dd>
                      <LeadDetails lead={openLead} compact={false} />
                      {withTranscript.has(openLead.id) && <LeadTranscript leadId={openLead.id} />}
                    </dd>
                  </dl>
                ) : null
              }
            />
          ) : null}
      </div>
    );
  };

  return MEETINGS_STAFF ? (
    <WithStaffView agencyId={agencyId} tabs={tabs}>
      {page}
    </WithStaffView>
  ) : (
    page(null)
  );
}

/** "הפגישה הבאה": the lead's next meeting, which opens the agenda; or "+ קביעת פגישה"; "—" until the agenda has loaded. */
function NextMeetingCell({ staff, meeting, onSchedule }: { staff: StaffView; meeting: AgendaMeeting | undefined; onSchedule: () => void }) {
  if (!staff.agenda.isSuccess) return <span className="text-muted-foreground">—</span>;
  if (meeting?.scheduledAt) {
    return (
      <button
        type="button"
        onClick={() => staff.showMeeting(meeting.id)}
        className="text-right underline decoration-highlight underline-offset-4 hover:text-accent"
      >
        {nextMeetingLabel(meeting.scheduledAt, staff.now)}
      </button>
    );
  }
  return (
    <button type="button" onClick={onSchedule} className="text-sm text-accent underline-offset-4 hover:underline">
      + קביעת פגישה
    </button>
  );
}
