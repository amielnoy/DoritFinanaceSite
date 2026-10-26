import React, { useState } from "react";
import { Trash2 } from "lucide-react";
import type { LeadRecord } from "@/services";
import { useLeadMeetings } from "@/hooks/useAdmin";
import SideDrawer from "@/components/dorit/admin/SideDrawer";
import LeadMeetings from "@/components/dorit/admin/LeadMeetings";

export type LeadDrawerTab = "details" | "activity" | "briefing" | "meetings";
type Tab = LeadDrawerTab;

/**
 * One lead, in a side drawer over /admin/leads: "פרטים", "פעילות" (the follow-up,
 * notes and the activity log — the lead pipeline), with VITE_LEAD_BRIEFING
 * "תדריך" (the AI's draft before a call) and, with VITE_MEETINGS_STAFF,
 * "פגישות · N" (docs/superpowers/specs/2026-10-17-client-meetings-design.md).
 */
export default function LeadDrawer({
  lead,
  subtitle,
  note = null,
  details,
  activity,
  briefing = null,
  showMeetings = true,
  onClose,
  initialTab = "details",
  meetingId = null,
  startAdding = false,
  onDelete,
  deleting = false,
  deleteFailed = false,
}: {
  lead: LeadRecord | null;
  subtitle: string;
  /** A line under the header (staff-created leads: who entered it, how, how the person was told). */
  note?: string | null;
  /** The "פרטים" tab: what the table's row knows, laid out by the page. */
  details: React.ReactNode;
  /** The "פעילות" tab. */
  activity: React.ReactNode;
  /** The "תדריך" tab, which exists only when given (VITE_LEAD_BRIEFING). */
  briefing?: React.ReactNode;
  /** The "פגישות" tab, which exists only with VITE_MEETINGS_STAFF. */
  showMeetings?: boolean;
  onClose: () => void;
  /**
   * Where it opens. The agenda opens a lead on "פגישות", with its meeting
   * expanded (`meetingId`) or the new-meeting form open (`startAdding`). Read
   * when the drawer mounts: the page gives it a new key for each opening.
   */
  initialTab?: Tab;
  meetingId?: string | null;
  startAdding?: boolean;
  /**
   * Deletes the lead, with its meetings (on delete cascade), from either tab:
   * the agenda opens the drawer on "פגישות", where the table's trash isn't.
   * Absent for those who may not delete.
   */
  onDelete?: () => void;
  deleting?: boolean;
  deleteFailed?: boolean;
}) {
  const [tab, setTab] = useState<Tab>(
    (initialTab === "meetings" && !showMeetings) || (initialTab === "briefing" && !briefing) ? "details" : initialTab,
  );
  const meetings = useLeadMeetings(lead?.id ?? "", Boolean(lead) && showMeetings);
  const count = meetings.data?.length;
  const tabs: { key: Tab; label: string }[] = [
    { key: "details", label: "פרטים" },
    { key: "activity", label: "פעילות" },
    ...(briefing ? [{ key: "briefing" as const, label: "תדריך" }] : []),
    ...(showMeetings ? [{ key: "meetings" as const, label: count === undefined ? "פגישות" : `פגישות · ${count}` }] : []),
  ];

  return (
    <SideDrawer open={Boolean(lead)} onClose={onClose} title={lead?.name ?? ""} subtitle={subtitle}>
      {note ? <p className="-mt-2 mb-4 text-sm text-muted-foreground">{note}</p> : null}
      <div role="tablist" aria-label="פרטי הפנייה" className="-mt-2 mb-5 flex gap-1 border-b border-border">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            id={`lead-tab-${t.key}`}
            aria-selected={tab === t.key}
            aria-controls={`lead-panel-${t.key}`}
            onClick={() => setTab(t.key)}
            className={`-mb-px min-h-11 border-b-2 px-3 ${
              tab === t.key ? "border-highlight text-accent" : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`lead-panel-${tab}`} aria-labelledby={`lead-tab-${tab}`}>
        {lead
          ? tab === "details"
            ? details
            : tab === "activity"
              ? activity
              : tab === "briefing"
                ? briefing
                : <LeadMeetings lead={lead} initialOpenId={meetingId} startAdding={startAdding} />
          : null}
      </div>
      {lead && onDelete ? (
        <div className="mt-8 border-t border-border pt-4">
          {deleteFailed ? (
            <p role="alert" className="mb-2 text-sm text-destructive">
              הפנייה לא נמחקה. ניתן לנסות שוב.
            </p>
          ) : null}
          <button
            type="button"
            onClick={onDelete}
            disabled={deleting}
            className="inline-flex min-h-11 items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-destructive disabled:opacity-40"
          >
            <Trash2 size={15} /> מחיקת הפנייה
          </button>
        </div>
      ) : null}
    </SideDrawer>
  );
}
