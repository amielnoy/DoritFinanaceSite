import React from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { LeadRecord } from "@/services";
import { adminKeys } from "@/hooks/useAdmin";
import NewLeadSheet from "@/components/dorit/admin/NewLeadSheet";

/**
 * The "פנייה חדשה" sheet on the leads screen. After a create the list is read
 * again and the new lead's drawer opens (`onOpenLead`; the sheet has toasted).
 * When the sheet stays on its confirmation instead (`onSaved`), the list is
 * read again right away, so closing it shows the new lead.
 * Render it only while open: the sheet's form is not reset between openings.
 */
export default function NewLeadSheetHost({
  onClose,
  agencyId,
  canAssign,
  assignees,
  leads,
  onOpenLead,
}: {
  onClose(): void;
  agencyId: string;
  canAssign: boolean;
  assignees: { id: string; label: string }[];
  leads: LeadRecord[];
  /** Absent when the lead drawer is not available. */
  onOpenLead?: (leadId: string) => void;
}) {
  const client = useQueryClient();
  return (
    <NewLeadSheet
      open
      onClose={onClose}
      agencyId={agencyId}
      canAssign={canAssign}
      assignees={assignees}
      leads={leads}
      onCreated={(leadId) => {
        onClose();
        void client.invalidateQueries({ queryKey: adminKeys.leads });
        onOpenLead?.(leadId);
      }}
      onSaved={() => void client.invalidateQueries({ queryKey: adminKeys.leads })}
      onOpenExisting={(leadId) => {
        onClose();
        onOpenLead?.(leadId);
      }}
    />
  );
}
