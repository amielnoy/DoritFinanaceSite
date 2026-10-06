import React from "react";
import { cn } from "@/lib/utils";

/**
 * Section kicker: tabular index · short gold rule · label.
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
    <span className={cn("inline-flex items-center gap-3 text-sm text-accent", className)} {...props}>
      {idx ? (
        <>
          <span className="font-heading text-xl leading-none tabular-nums">{idx}</span>
          <span aria-hidden="true" className="w-7 h-px bg-highlight" />
        </>
      ) : null}
      <span>{label}</span>
    </span>
  );
}
