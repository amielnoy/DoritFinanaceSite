import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { AgendaMeeting, LeadRecord, LeadSource, LeadStatus } from "@/services";
import {
  useAdminUsers, useAgencyMeetings, useAssignLead, useLeads, useLeadTranscript, useRemoveLead, useSetLeadStatus, useTranscriptLeadIds,
} from "@/hooks/useAdmin";
import { useCurrentUserId } from "@/hooks/useCurrentUserId";
import { AGENCY_1, useAgencyRole, useCurrentAgency } from "@/hooks/useAgency";
import { csvCell } from "@/lib/csv";
import { ArrowLeft, CalendarDays, Download, Inbox, ListChecks, Loader2, Plus, Trash2, TrendingUp, UserRound, type LucideIcon } from "lucide-react";
import LeadTrackingPanel from "@/components/dorit/admin/LeadTrackingPanel";
import LeadDrawer, { type LeadDrawerTab } from "@/components/dorit/admin/LeadDrawer";
import LeadDetails from "@/components/dorit/admin/LeadDetails";
import MeetingsAgenda from "@/components/dorit/admin/MeetingsAgenda";
import { MEETINGS_STAFF } from "@/config/meetings";
import { INTAKE_LABELS, STAFF_LEADS } from "@/config/staff-leads";
import { GONE_MEMBER, broughtThisMonth, sameNumberLeads, staffLeadLine } from "@/lib/staff-leads";
import NewLeadSheetHost from "@/components/dorit/admin/NewLeadSheetHost";
import StaffLeadsStrip from "@/components/dorit/admin/StaffLeadsStrip";
import DuplicatePointer from "@/components/dorit/admin/DuplicatePointer";
import { agendaCounts, endOfWeek, isAwaitingSummary, meetingDay, nextMeetingByLead, nextMeetingLabel } from "@/lib/meetings-agenda";
import { addDays, israelToday } from "@/lib/wall-clock";

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
  new: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  contacted: "bg-orange-500/10 text-orange-700 dark:text-orange-400",
  closed: "bg-muted text-muted-foreground",
  client: "bg-accent/10 text-accent",
};

const DOT: Record<string, string> = {
  all: "bg-accent",
  new: "bg-emerald-500",
  contacted: "bg-orange-500",
  closed: "bg-slate-400",
  client: "bg-emerald-500",
  escalated: "bg-orange-500",
  partial: "bg-slate-400",
  unassigned: "bg-orange-500",
  staff: "bg-accent",
  duplicate: "bg-destructive",
};

const TONES = {
  green: { tile: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400", line: "text-emerald-500", dot: "bg-emerald-500" },
  blue: { tile: "bg-accent/10 text-accent", line: "text-accent", dot: "bg-accent" },
  orange: { tile: "bg-orange-500/10 text-orange-600 dark:text-orange-400", line: "text-orange-500", dot: "bg-orange-500" },
};

const BUTTON =
  "inline-flex min-h-10 items-center gap-2 rounded-lg border border-border bg-card px-3.5 py-2 text-sm font-medium transition-colors hover:bg-secondary disabled:opacity-40";

function Sparkline({ values, className }: { values: number[]; className: string }) {
  const max = Math.max(1, ...values);
  const step = 100 / Math.max(1, values.length - 1);
  const points = values.map((v, i) => `${100 - i * step},${34 - (v / max) * 28}`).join(" ");
  return (
    <svg viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true" className={className}>
      <rect width="100" height="40" rx="6" className="fill-current opacity-10" />
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="2" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function KpiCard({
  title,
  value,
  note,
  icon: Icon,
  tone,
  series,
}: {
  title: string;
  value: number | string;
  note: string;
  icon: LucideIcon;
  tone: keyof typeof TONES;
  series: number[];
}) {
  const colors = TONES[tone];
  return (
    <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
      <div className="flex items-center gap-3">
        <span aria-hidden="true" className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${colors.tile}`}>
          <Icon size={18} strokeWidth={1.75} />
        </span>
        <h2 className="text-sm font-semibold">{title}</h2>
        <span className="ms-auto rounded-full bg-secondary px-2.5 py-0.5 text-xs text-muted-foreground">השבוע</span>
      </div>
      <div className="mt-4 flex items-center justify-between gap-4">
        <p className="font-heading text-4xl font-bold tabular-nums">{value}</p>
        <Sparkline values={series} className={`h-10 w-1/2 ${colors.line}`} />
      </div>
      <div className="mt-3 flex items-center justify-between gap-3 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${colors.dot}`} />
          {note}
        </span>
        {series.some(Boolean) ? null : <span>ללא פעילות</span>}
      </div>
    </section>
  );
}

function EmptyInbox() {
  return (
    <svg viewBox="0 0 120 100" aria-hidden="true" className="h-24 w-28">
      <circle cx="60" cy="48" r="42" className="fill-accent/10 stroke-border" />
      <rect x="34" y="16" width="52" height="40" rx="6" transform="rotate(-6 60 36)" className="fill-card stroke-border" />
      <rect x="42" y="26" width="26" height="4" rx="2" transform="rotate(-6 60 36)" className="fill-muted-foreground/30" />
      <rect x="42" y="35" width="34" height="4" rx="2" transform="rotate(-6 60 36)" className="fill-muted-foreground/20" />
      <path d="M28 52h20l4 8h16l4-8h20v26a6 6 0 0 1-6 6H34a6 6 0 0 1-6-6z" className="fill-primary" />
      <circle cx="90" cy="18" r="7" className="fill-emerald-500/15 stroke-emerald-500" />
      <path d="M90 15v6M87 18h6" className="stroke-emerald-600" strokeWidth="1.5" />
      <circle cx="16" cy="60" r="3" className="fill-orange-500" />
      <circle cx="104" cy="68" r="2.5" className="fill-emerald-500" />
    </svg>
  );
}
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
const PINNED = "sticky left-0 shadow-[inset_-1px_0_0_hsl(var(--border)/0.6)]";

const EXTRA_FILTERS: { key: string; label: string; adminOnly?: boolean; staffLeads?: boolean }[] = [
  { key: "escalated", label: "הועברו לטיפול" },
  { key: "partial", label: "ראיונות שלא הושלמו" },
  { key: "unassigned", label: "לא שויכו", adminOnly: true },
  // VITE_STAFF_LEADS: the leads a member entered by hand, and (Admin+) the ones that may repeat another.
  { key: "staff", label: "דרך הצוות", staffLeads: true },
  { key: "duplicate", label: "כפילות אפשרית", adminOnly: true, staffLeads: true },
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
  labels: Record<PageTab, { title: string; figure: string; icon: LucideIcon }>;
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
    <div role="tablist" aria-label="פניות ופגישות" className="flex gap-6 overflow-x-auto">
      {tabs.map((key) => {
        const active = tab === key;
        const { title, figure, icon: Icon } = labels[key];
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
            className={`-mb-px flex shrink-0 items-center gap-2 border-b-2 py-4 text-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring ${
              active ? "border-accent font-semibold text-accent" : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <Icon size={17} strokeWidth={1.75} aria-hidden="true" />
            <span>{title}</span>
            {figure ? <span className="rounded-full bg-secondary px-2 py-0.5 text-xs tabular-nums text-muted-foreground">{figure}</span> : null}
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
  const myId = useCurrentUserId();
  // Agency 1 only: the privacy notice the client is told names Dorit's agency (src/config/staff-leads.ts).
  const creates = STAFF_LEADS && agencyId === AGENCY_1 && can("leads.create");
  const [sheetOpen, setSheetOpen] = useState(false);
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
  const openFromTable = (leadId: string) => {
    setDrawerStart((d) => ({ ...d, meetingId: null, adding: false }));
    setOpenLeadId(leadId);
  };
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
  const assigneeLabel = (id: string | null | undefined) => (id ? assignees.find((a) => a.id === id)?.label ?? GONE_MEMBER : "—");
  /* Who brought a lead: "אני" for the signed-in person; a User's screen knows no other member addresses, so "חבר/ה בצוות". */
  const broughtLabel = (id: string | null) =>
    !id ? GONE_MEMBER : id === myId ? "אני" : assigns ? assigneeLabel(id) : "חבר/ה בצוות";
  const showBrought = STAFF_LEADS && assigns;

  const filtered = leads.filter(
    (l) =>
      filter === "all" ||
      (filter === "staff"
        ? l.source === "staff"
        : filter === "duplicate"
          ? l.possibleDuplicate === true
          : filter === "unassigned"
        ? !l.assigned_user_id && l.status !== "closed"
        : filter === ATTENTION
          ? NEEDS_ATTENTION.includes(l.status)
          : l.status === filter),
  );

  const exportCsv = (all: boolean) => {
    const source = all ? leads : filtered;
    const headers = ["תאריך", "שם", "טלפון", "אימייל", "מקור", "תחום/שירות", "מועד", "סטטוס", "הודעה", ...(STAFF_LEADS ? ["הובאה ע״י", "איך הגיע/ה", "מי הפנה"] : [])];
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
      ...(STAFF_LEADS ? [l.broughtBy ? broughtLabel(l.broughtBy) : "", l.intake ? INTAKE_LABELS[l.intake] : "", l.referrerNote || ""] : []),
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

  const brought = useMemo(() => (showBrought ? broughtThisMonth(leads, new Date()) : new Map<string, number>()), [showBrought, leads]);
  const openLead = openLeadId ? leads.find((l) => l.id === openLeadId) ?? null : null;

  const counts = leads.reduce<Record<string, number>>((acc, l) => {
    acc[l.status] = (acc[l.status] || 0) + 1;
    if (!l.assigned_user_id && l.status !== "closed") acc.unassigned = (acc.unassigned || 0) + 1;
    if (l.source === "staff") acc.staff = (acc.staff || 0) + 1;
    if (l.possibleDuplicate) acc.duplicate = (acc.duplicate || 0) + 1;
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

            {showBrought ? <StaffLeadsStrip counts={brought} label={assigneeLabel} /> : null}

            <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
              {[
                { key: "all", title: "סה״כ פניות", value: leads.length, line: "כל הרשומות במערכת" },
                { key: ATTENTION, title: "דורשות טיפול", value: (counts.new || 0) + (counts.escalated || 0), line: "חדשות, ומי שביקשו את דורית — ליצור קשר" },
                { key: "contacted", title: "בתהליך", value: counts.contacted || 0, line: "נוצר קשר — להמשיך במכירה" },
                { key: "closed", title: "נסגרו", value: counts.closed || 0, line: "טופלו והסתיימו" },
              ].map(({ key, title, value, line }) => {
                const active = filter === key;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setFilter(key)}
                    className={`flex items-center justify-between gap-3 rounded-xl border p-4 text-right transition-colors ${
                      active ? "border-accent/30 bg-accent/10" : "border-transparent bg-secondary hover:border-border"
                    }`}
                  >
                    <span className="min-w-0">
                      <span className="flex items-center gap-1.5 text-sm font-semibold">
                        <span aria-hidden="true" className={`h-1.5 w-1.5 shrink-0 rounded-full ${DOT[key === ATTENTION ? "new" : key]}`} />
                        <span>{title}</span>
                      </span>
                      <span className="mt-1 block text-xs text-muted-foreground">{line}</span>
                    </span>
                    <span className={`font-heading text-3xl font-bold tabular-nums ${active ? "text-accent" : ""}`}>{value}</span>
                  </button>
                );
              })}
            </div>

            <div className="mb-6 flex flex-wrap gap-1 rounded-xl bg-secondary p-1">
              {[
                { key: "all", label: "הכל" },
                ...STATUS.map((s) => ({ key: s, label: STATUS_LABEL[s] })),
                ...EXTRA_FILTERS.filter((f) => (!f.adminOnly || assigns) && (!f.staffLeads || STAFF_LEADS)),
              ].map(({ key: s, label }) => {
                const active = filter === s;
                const count = s === "all" ? leads.length : counts[s] || 0;
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setFilter(s)}
                    className={`inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm transition-colors ${
                      active ? "bg-card font-semibold text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${DOT[s] ?? "bg-slate-400"}`} />
                    {label}
                    <span className="rounded-full bg-background px-1.5 text-xs tabular-nums">{count}</span>
                  </button>
                );
              })}
            </div>

            <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
              <h2 className="flex items-center gap-2 text-base font-bold">
                רשימת פניות
                <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-normal tabular-nums text-muted-foreground">{filtered.length}</span>
              </h2>
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" onClick={() => exportCsv(false)} disabled={!filtered.length} className={BUTTON}>
                  <Download size={15} /> ייצוא מסונן
                </button>
                <button type="button" onClick={() => exportCsv(true)} disabled={!leads.length} className={BUTTON}>
                  <Download size={15} /> ייצוא הכל ל-CSV
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
              <div className="py-20 text-center">
                <p className="text-destructive">לא הצלחנו לטעון את הפניות. ניתן לרענן את הדף.</p>
              </div>
            ) : filtered.length === 0 ? (
              <div className="flex flex-col items-center py-14 text-center">
                <EmptyInbox />
                <p className="mt-4 text-lg font-bold">אין פניות להצגה.</p>
                <p className="mt-1 text-sm text-muted-foreground">כאן יופיעו הפניות שלך, מרגע יצירתן ועד לסיום הטיפול.</p>
                {creates && leads.length === 0 ? (
                  <button type="button" onClick={() => setSheetOpen(true)} className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-accent hover:underline">
                    יצירת פנייה ראשונה <ArrowLeft size={14} aria-hidden="true" />
                  </button>
                ) : null}
              </div>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-border">
                <table className="w-full text-sm">
                  <thead className="bg-secondary text-muted-foreground">
                    <tr className="text-right">
                      <th className="px-4 py-3 font-medium">תאריך</th>
                      <th className="px-4 py-3 font-medium">שם</th>
                      <th className="px-4 py-3 font-medium">טלפון</th>
                      <th className="px-4 py-3 font-medium">אימייל</th>
                      <th className="px-4 py-3 font-medium">מקור</th>
                      <th className="px-4 py-3 font-medium">פרטים</th>
                      <th className="px-4 py-3 font-medium">סטטוס</th>
                      {assigns ? <th className="px-4 py-3 font-medium">משויכת ל</th> : null}
                      {showBrought ? <th className="px-4 py-3 font-medium">הובאה ע״י</th> : null}
                      {staff ? <th className="px-4 py-3 font-medium whitespace-nowrap">הפגישה הבאה</th> : null}
                      <th className={`px-4 py-3 font-medium ${PINNED} bg-secondary`}>
                        <span className="sr-only">פעולות</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((l) => (
                      <tr key={l.id} className="border-t border-border align-top">
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
                        <td className="px-4 py-3 text-foreground/70">
                          {SOURCE_LABEL[l.source] || "—"}
                          {STAFF_LEADS && l.source === "staff" && l.intake ? (
                            <span className="ms-2 inline-block border border-border/60 px-1.5 py-0.5 text-xs">{INTAKE_LABELS[l.intake]}</span>
                          ) : null}
                          {STAFF_LEADS && assigns && l.possibleDuplicate ? (
                            <DuplicatePointer
                              others={sameNumberLeads(leads, l)}
                              onOpen={MEETINGS_STAFF ? openFromTable : undefined}
                              leadId={l.id}
                            />
                          ) : null}
                        </td>
                        <td className="px-4 py-3">
                          <LeadDetails lead={l} />
                          {withTranscript.has(l.id) && <LeadTranscript leadId={l.id} />}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`inline-block whitespace-nowrap rounded-full px-2.5 py-1 text-xs ${STATUS_COLOR[l.status] || ""}`}>
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
                              className="text-xs rounded-md border border-border bg-card px-2 py-1 max-w-[12rem] focus:outline-none focus:border-accent"
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
                        {showBrought ? <td className="px-4 py-3 text-foreground/70">{l.broughtBy ? broughtLabel(l.broughtBy) : "—"}</td> : null}
                        {staff ? (
                          <td className="px-4 py-3 whitespace-nowrap">
                            <NextMeetingCell
                              staff={staff}
                              meeting={staff.next.get(l.id)}
                              onSchedule={() => openOnMeetings(l.id, null, true)}
                            />
                          </td>
                        ) : null}
                        <td className={`px-4 py-3 ${PINNED} bg-card`}>
                          <div className="flex items-center gap-2">
                            <select
                              aria-label={`סטטוס הפנייה של ${l.name}`}
                              value={l.status}
                              onChange={(e) => updateStatus(l.id, e.target.value as LeadStatus)}
                              disabled={busy}
                              className="text-xs rounded-md border border-border bg-card px-2 py-1 focus:outline-none focus:border-accent"
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
            {!loading && !isError ? (
              <p className="mt-4 border-t border-border pt-4 text-xs text-muted-foreground">{filtered.length} פניות להצגה</p>
            ) : null}
      </>
    );
    const agenda = staff?.agenda.isSuccess ? agendaCounts(staff.agenda.data ?? [], staff.now) : null;
    const n = (v: number | undefined) => (v === undefined ? "—" : String(v));
    const today = israelToday(staff?.now ?? new Date());
    const week = Array.from({ length: 7 }, (_, i) => addDays(endOfWeek(today), i - 6));
    const meetings = staff?.agenda.data ?? [];
    const perDay = <T,>(items: readonly T[], day: (item: T) => string | null) => week.map((d) => items.filter((item) => day(item) === d).length);
    const attention = (counts.new || 0) + (counts.escalated || 0);
    const leadDay = (l: LeadItem) => (l.created_date ? israelToday(new Date(l.created_date)) : null);
    return (
      <div className="min-h-screen bg-background">
        <div className="max-w-[1200px] mx-auto px-6 pt-8 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="font-heading text-3xl font-bold">{staff ? "פניות ופגישות" : assigns ? "ניהול פניות" : "הפניות שלי"}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{staff ? "כל הפניות והפגישות שלך — במקום אחד." : "כל הפניות שלך — במקום אחד."}</p>
          </div>
          {creates ? (
            <button
              type="button"
              onClick={() => setSheetOpen(true)}
              className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
            >
              <Plus size={16} /> פנייה חדשה
            </button>
          ) : null}
        </div>

        {sheetOpen ? (
          // Mounted only while open: the sheet's form is not reset between openings.
          <NewLeadSheetHost
            onClose={() => setSheetOpen(false)}
            agencyId={agencyId}
            canAssign={assigns}
            assignees={assignees}
            leads={leads}
            onOpenLead={MEETINGS_STAFF ? openFromTable : undefined}
          />
        ) : null}

        <main id="main" className="max-w-[1200px] mx-auto px-6 py-6 space-y-6">
          <div className={`grid gap-4 ${staff ? "md:grid-cols-3" : "md:grid-cols-1"}`}>
            <KpiCard
              title="לידים פעילים"
              value={leads.filter((l) => l.status !== "closed" && l.status !== "client").length}
              note={[`${attention} דורשות טיפול`, ...(assigns ? [`${counts.unassigned || 0} לא שויכו`] : [])].join(" · ")}
              icon={UserRound}
              tone="green"
              series={perDay(leads, leadDay)}
            />
            {staff ? (
              <>
                <KpiCard
                  title="פגישות השבוע"
                  value={n(agenda?.week)}
                  note={`${n(agenda?.today)} היום`}
                  icon={CalendarDays}
                  tone="blue"
                  series={perDay(meetings.filter((m) => m.status === "scheduled"), meetingDay)}
                />
                <KpiCard
                  title="משימות פתוחות"
                  value={agenda ? agenda.requests + agenda.unsummarised : "—"}
                  note={`${n(agenda?.requests)} בקשות שינוי · ${n(agenda?.unsummarised)} בלי סיכום`}
                  icon={ListChecks}
                  tone="orange"
                  series={perDay(meetings.filter((m) => m.openRequest || isAwaitingSummary(m)), meetingDay)}
                />
              </>
            ) : null}
          </div>
          <div className="rounded-2xl border border-border bg-card shadow-sm">
            {staff ? (
              <>
                <div className="border-b border-border px-5">
                  <PageTabs
                    tabs={tabs}
                    tab={staff.tab}
                    onSelect={staff.setTab}
                    labels={{
                      leads: { title: assigns ? "פניות" : "הפניות שלי", figure: String(leads.length), icon: Inbox },
                      meetings: { title: "פגישות", figure: n(agenda?.week), icon: CalendarDays },
                      tracking: { title: "מעקב לידים", figure: "", icon: TrendingUp },
                    }}
                  />
                </div>
                <div className="p-5">
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
                </div>
              </>
            ) : (
              <div className="p-5">{leadsContent}</div>
            )}
          </div>
        </main>

          {MEETINGS_STAFF ? (
            <LeadDrawer
              key={drawerStart.seq}
              lead={openLead}
              initialTab={drawerStart.tab}
              meetingId={drawerStart.meetingId}
              startAdding={drawerStart.adding}
              onClose={() => setOpenLeadId(null)}
              note={STAFF_LEADS && openLead ? staffLeadLine(openLead, broughtLabel) : null}
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
