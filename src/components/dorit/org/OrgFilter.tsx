import React, { useId, useState } from "react";
import { ChevronDown, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { Organization } from "@/config/organizations";
import { OrgMark } from "./OrgBadge";

/** Up to this many organizations the filter is a row of buttons; beyond it, a searchable list. */
export const PILL_LIMIT = 6;

const PILL =
  "inline-flex min-h-11 items-center gap-2 rounded-md border px-3 text-[15px] transition-colors aria-pressed:border-highlight aria-pressed:bg-highlight/10 aria-pressed:text-accent hover:border-highlight";

/**
 * Filtering by organization: "כל הארגונים" and one button per organization
 * (with its mark), or — above PILL_LIMIT — a searchable multi-select whose
 * choices sit under it as removable chips. Selecting several matches a user in
 * ANY of them.
 */
export default function OrgFilter({
  orgs,
  selected,
  onChange,
}: {
  orgs: readonly Organization[];
  selected: readonly string[];
  onChange: (ids: string[]) => void;
}) {
  const toggle = (id: string) => onChange(selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id]);

  if (orgs.length <= PILL_LIMIT) {
    return (
      <div role="group" aria-label="סינון לפי ארגון" className="flex flex-wrap gap-2">
        <button type="button" aria-pressed={selected.length === 0} onClick={() => onChange([])} className={`${PILL} border-border`}>
          כל הארגונים
        </button>
        {orgs.map((o) => (
          <button key={o.id} type="button" aria-pressed={selected.includes(o.id)} onClick={() => toggle(o.id)} className={`${PILL} border-border`}>
            <OrgMark org={o} />
            {o.name}
          </button>
        ))}
      </div>
    );
  }
  return <OrgMultiSelect orgs={orgs} selected={selected} onChange={onChange} toggle={toggle} />;
}

function OrgMultiSelect({
  orgs,
  selected,
  onChange,
  toggle,
}: {
  orgs: readonly Organization[];
  selected: readonly string[];
  onChange: (ids: string[]) => void;
  toggle: (id: string) => void;
}) {
  const [find, setFind] = useState("");
  const listId = useId();
  const shown = orgs.filter((o) => o.name.toLocaleLowerCase("he").includes(find.trim().toLocaleLowerCase("he")));
  const chosen = orgs.filter((o) => selected.includes(o.id));
  return (
    <div className="flex flex-col gap-2">
      <Popover>
        <PopoverTrigger asChild>
          <button type="button" className={`${PILL} self-start border-border`}>
            {selected.length === 0 ? "כל הארגונים" : `ארגונים: ${selected.length} נבחרו`}
            <ChevronDown size={16} aria-hidden="true" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-72 p-2">
          <input
            type="search"
            value={find}
            onChange={(e) => setFind(e.target.value)}
            aria-label="חיפוש ארגון"
            aria-controls={listId}
            placeholder="חיפוש ארגון…"
            className="mb-2 w-full rounded-md border border-border bg-background px-3 py-2 text-[15px]"
          />
          <ul id={listId} aria-label="ארגונים" className="m-0 max-h-72 list-none overflow-y-auto p-0">
            {shown.map((o) => (
              <li key={o.id}>
                <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-md px-2 hover:bg-secondary">
                  <input type="checkbox" checked={selected.includes(o.id)} onChange={() => toggle(o.id)} className="h-4 w-4" />
                  <OrgMark org={o} />
                  <span>{o.name}</span>
                </label>
              </li>
            ))}
            {shown.length === 0 ? <li className="px-2 py-3 text-sm text-muted-foreground">לא נמצא ארגון</li> : null}
          </ul>
        </PopoverContent>
      </Popover>
      {chosen.length > 0 ? (
        <ul aria-label="ארגונים שנבחרו" className="m-0 flex list-none flex-wrap gap-1.5 p-0">
          {chosen.map((o) => (
            <li key={o.id}>
              <span className="inline-flex items-center gap-1 rounded-md ps-2 text-sm font-medium" style={{ background: o.tint, color: o.ink }}>
                <OrgMark org={o} size={16} />
                {o.name}
                <button
                  type="button"
                  onClick={() => onChange(selected.filter((s) => s !== o.id))}
                  aria-label={`הסרת ${o.name} מהסינון`}
                  className="inline-flex min-h-11 min-w-11 items-center justify-center"
                >
                  <X size={14} aria-hidden="true" />
                </button>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
