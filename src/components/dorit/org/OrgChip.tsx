import React from "react";
import { cn } from "@/lib/utils";
import type { Organization } from "@/config/organizations";

/**
 * The organization as a label — for a table column or a profile card: its
 * tint behind its name in its ink, with an 8px square of its colour first.
 * The name is always written out, so the colour is never the only cue.
 */
export default function OrgChip({ org, className }: { org: Organization; className?: string }) {
  return (
    <span
      data-org={org.id}
      className={cn("inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-sm font-medium leading-6", className)}
      style={{ background: org.tint, color: org.ink }}
    >
      <span aria-hidden="true" className="inline-block h-2 w-2 shrink-0 rounded-[2px]" style={{ background: org.color }} />
      {org.name}
    </span>
  );
}
