import React, { useMemo, useState } from "react";
import { services, type LeadRecord, type LeadSource, type LeadStatus } from "@/services";
import {
  useAdminUsers, useAssignLead, useLeads, useLeadTranscript, useRemoveLead, useSetLeadStatus, useTranscriptLeadIds,
} from "@/hooks/useAdmin";
import { useAgencyRole, useCurrentAgency } from "@/hooks/useAgency";
import Eyebrow from "@/components/dorit/primitives/Eyebrow";
import { csvCell } from "@/lib/csv";
import { Loader2, Download, Trash2 } from "lucide-react";
import LeadTrackingPanel from "@/components/dorit/admin/LeadTrackingPanel";

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
};

/** A claim document stored in Supabase, as `submit-claim` writes it into the message. */
const DOCUMENT_REF = /(storage:claim-documents\/[^\s|]+)/;

/**
 * Opens one claim document. The link is signed on the click, for five minutes,
 * so nothing long-lived sits in the page or in a copied URL.
 *
 * The tab is opened before the await: Safari blocks a window opened after one,
 * and the signing is a round trip.
 */
function DocumentLink({ docRef, index, leadId }: { docRef: string; index: number; leadId: string }) {
  const [error, setError] = useState<string | null>(null);
  const open = async () => {
    setError(null);
    const tab = window.open("about:blank", "_blank");
    try {
      const url = await services.leadsAdmin.documentLink(docRef, leadId);
      if (tab) {
        tab.opener = null;
        tab.location.href = url;
      } else {
        setError("הדפדפן חסם את החלון — אפשר לאשר חלונות קופצים ולנסות שוב");
      }
    } catch (e) {
      tab?.close();
      setError(e instanceof Error ? e.message : "לא ניתן לפתוח את המסמך");
    }
  };
  return (
    <span>
      <button type="button" onClick={open} className="underline text-accent hover:text-foreground">
        מסמך {index}
      </button>
      {error && <span className="block text-xs text-destructive">{error}</span>}
    </span>
  );
}

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

/** The details column: topic, time and message, with any stored document as a button. */
function LeadDetails({ lead }: { lead: LeadRecord }) {
  const text = [lead.topic, lead.timing, lead.message].filter(Boolean).join(" · ");
  if (!text) return <>—</>;
  const parts = text.split(DOCUMENT_REF);
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <DocumentLink key={i} docRef={part} index={(i + 1) / 2} leadId={lead.id} />
        ) : (
          <React.Fragment key={i}>{part}</React.Fragment>
        ),
      )}
    </>
  );
}

/** The chips past the settable statuses: what the backend writes, and the unassigned queue. */
/**
 * "דורשות טיפול": new leads, and escalated ones — a visitor who asked for Dorit
 * herself (review 2026-10-15). The card counts both and its filter shows both.
 */
const NEEDS_ATTENTION: string[] = ["new", "escalated"];
const ATTENTION = "attention";

const EXTRA_FILTERS: { key: string; label: string; adminOnly?: boolean }[] = [
  { key: "escalated", label: "הועברו לטיפול" },
  { key: "partial", label: "ראיונות שלא הושלמו" },
  { key: "unassigned", label: "לא שויכו", adminOnly: true },
];

/**
 * The agency's leads. A User sees only those assigned to them ("הפניות שלי")
 * and may change their status; Admin+ see them all, assign them and delete
 * them. Row-level security decides which rows arrive; the buttons follow
 * src/config/permissions.ts and are refused by the database when shown wrongly.
 */
export default function Leads() {
  const { data, isPending: loading, isError } = useLeads();
  const { agencyId } = useCurrentAgency();
  const { can } = useAgencyRole(agencyId);
  const assigns = can("leads.assign");
  const deletes = can("leads.delete");
  const members = useAdminUsers(assigns);
  const transcriptIds = useTranscriptLeadIds();
  const withTranscript = useMemo(() => new Set(transcriptIds.data ?? []), [transcriptIds.data]);
  const setStatus = useSetLeadStatus();
  const removeLead = useRemoveLead();
  const assignLead = useAssignLead();
  const [filter, setFilter] = useState<string>("all");

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

  const remove = (id: string) => {
    if (!window.confirm("למחוק את הפנייה?")) return;
    removeLead.mutate(id);
  };

  const counts = leads.reduce<Record<string, number>>((acc, l) => {
    acc[l.status] = (acc[l.status] || 0) + 1;
    if (!l.assigned_user_id && l.status !== "closed") acc.unassigned = (acc.unassigned || 0) + 1;
    return acc;
  }, {});

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border/60 bg-card">
        <div className="max-w-[1200px] mx-auto px-6 py-5 flex items-center justify-between">
          <div>
            <Eyebrow>טיפול שוטף</Eyebrow>
            <h1 className="font-heading text-2xl md:text-3xl mt-1">{assigns ? "ניהול פניות" : "הפניות שלי"}</h1>
          </div>
        </div>
      </header>

      <main id="main" className="max-w-[1200px] mx-auto px-6 py-8">
        {assigns ? <LeadTrackingPanel /> : null}

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
                  <th className="px-4 py-3 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((l) => (
                  <tr key={l.id} className="border-t border-border/60 align-top">
                    <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                      {l.created_date ? new Date(l.created_date).toLocaleDateString("he-IL") : "—"}
                    </td>
                    <td className="px-4 py-3 font-medium">{l.name}</td>
                    <td className="px-4 py-3" dir="ltr">{l.phone}</td>
                    <td className="px-4 py-3 text-foreground/70" dir="ltr">{l.email || "—"}</td>
                    <td className="px-4 py-3 text-foreground/70">{SOURCE_LABEL[l.source] || "—"}</td>
                    <td className="px-4 py-3 text-foreground/70 max-w-xs">
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
                    <td className="px-4 py-3">
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
                            onClick={() => remove(l.id)}
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
      </main>
    </div>
  );
}