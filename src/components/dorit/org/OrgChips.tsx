import React from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { Organization } from "@/config/organizations";
import OrgChip from "./OrgChip";

/**
 * A user's organizations as chips: the first `max` (2) written out, then a
 * "+N" button whose popover lists the rest. The button is a full 44px target;
 * the chip inside it looks like the others.
 */
export default function OrgChips({ orgs, max = 2 }: { orgs: readonly Organization[]; max?: number }) {
  const shown = orgs.slice(0, max);
  const rest = orgs.slice(max);
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      {shown.map((o) => (
        <OrgChip key={o.id} org={o} />
      ))}
      {rest.length > 0 ? (
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label={`ועוד ${rest.length} ארגונים`}
              className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-highlight"
            >
              <span className="rounded-md border border-border bg-secondary px-2 py-0.5 text-sm font-medium leading-6 text-foreground">
                {/* bdi: in a right-to-left line, "+2" would otherwise read "2+". */}
                <bdi dir="ltr">+{rest.length}</bdi>
              </span>
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-auto p-2">
            <ul aria-label="ארגונים נוספים" className="m-0 flex list-none flex-col gap-1.5 p-0">
              {rest.map((o) => (
                <li key={o.id}>
                  <OrgChip org={o} />
                </li>
              ))}
            </ul>
          </PopoverContent>
        </Popover>
      ) : null}
    </span>
  );
}
