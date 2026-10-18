import React, { useState } from "react";
import type { LeadRecord } from "@/services";
import { useLeadMeetings } from "@/hooks/useAdmin";
import SideDrawer from "@/components/dorit/admin/SideDrawer";
import LeadMeetings from "@/components/dorit/admin/LeadMeetings";

export type LeadDrawerTab = "details" | "meetings";
type Tab = LeadDrawerTab;

/**
 * One lead, in a side drawer over /admin/leads: "פרטים" and "פגישות · N"
 * (docs/superpowers/specs/2026-10-17-client-meetings-design.md, Staff; the
 * user's choice of 2026-10-17 — a new drawer with two tabs, the table as it
 * was). Shown only with VITE_MEETINGS_STAFF.
 */
export default function LeadDrawer({
  lead,
  subtitle,
  details,
  onClose,
  initialTab = "details",
  meetingId = null,
  startAdding = false,
}: {
  lead: LeadRecord | null;
  subtitle: string;
  /** The "פרטים" tab: what the table's row knows, laid out by the page. */
  details: React.ReactNode;
  onClose: () => void;
  /**
   * Where it opens. The agenda opens a lead on "פגישות", with its meeting
   * expanded (`meetingId`) or the new-meeting form open (`startAdding`). Read
   * when the drawer mounts: the page gives it a new key for each opening.
   */
  initialTab?: Tab;
  meetingId?: string | null;
  startAdding?: boolean;
}) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const meetings = useLeadMeetings(lead?.id ?? "", Boolean(lead));
  const count = meetings.data?.length;
  const tabs: { key: Tab; label: string }[] = [
    { key: "details", label: "פרטים" },
    { key: "meetings", label: count === undefined ? "פגישות" : `פגישות · ${count}` },
  ];

  return (
    <SideDrawer open={Boolean(lead)} onClose={onClose} title={lead?.name ?? ""} subtitle={subtitle}>
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
        {lead ? (tab === "details" ? details : <LeadMeetings lead={lead} initialOpenId={meetingId} startAdding={startAdding} />) : null}
      </div>
    </SideDrawer>
  );
}
