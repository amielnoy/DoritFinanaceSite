import React from "react";
import type { LeadRecord } from "@/services";
import { useClearDuplicate } from "@/hooks/useAdmin";

/**
 * A lead flagged "כפילות אפשרית" (Admin+): the agency's other leads with the same
 * national phone number, computed from the loaded list — the database keeps no
 * link to the other lead. "לא כפילות" clears the flag.
 */
export default function DuplicatePointer({
  others,
  onOpen,
  leadId,
}: {
  others: LeadRecord[];
  /** Absent when the lead drawer is not available: the names are then plain text. */
  onOpen?: (leadId: string) => void;
  leadId: string;
}) {
  const clear = useClearDuplicate();
  return (
    <div className="mt-1 space-y-1 text-xs">
      <span className="inline-block bg-highlight/15 px-2 py-0.5 text-highlight-ink">כפילות אפשרית</span>
      {others.length > 0 ? (
        <p className="text-muted-foreground">
          אותו מספר:{" "}
          {others.map((o, i) => (
            <React.Fragment key={o.id}>
              {i > 0 ? ", " : null}
              {onOpen ? (
                <button type="button" onClick={() => onOpen(o.id)} className="underline decoration-highlight underline-offset-4 hover:text-accent">
                  {o.name}
                </button>
              ) : (
                o.name
              )}
            </React.Fragment>
          ))}
        </p>
      ) : null}
      <button type="button" onClick={() => clear.mutate(leadId)} disabled={clear.isPending} className="text-accent underline-offset-4 hover:underline disabled:opacity-40">
        לא כפילות
      </button>
    </div>
  );
}
