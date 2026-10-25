import React from "react";
import { cn } from "@/lib/utils";

/**
 * Section kicker: tabular index in a chip, then the label.
 * 14px plain (no letter-spacing — Hebrew has no capitals to track).
 *
 * Existing call sites pass "02 · תחומי הליווי" as children; that string is
 * split on " · " so no caller has to change. New callers may pass `index`.
 */
export default function Eyebrow({
  className,
  children,
  index,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { index?: string }) {
  let idx = index;
  let label: React.ReactNode = children;
  if (!idx && typeof children === "string") {
    const m = children.match(/^\s*(\d{2})\s*·\s*(.+)$/);
    if (m) { idx = m[1]; label = m[2]; }
  }
  return (
    <span className={cn("inline-flex items-center gap-2.5 text-sm font-medium", idx ? "text-muted-foreground" : "text-accent", className)} {...props}>
      {idx ? (
        <span className="rounded-md border border-highlight/25 bg-highlight/10 px-2 py-0.5 text-xs font-semibold leading-5 text-accent lining-nums tabular-nums">{idx}</span>
      ) : null}
      <span>{label}</span>
    </span>
  );
}
