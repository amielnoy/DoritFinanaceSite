import React from "react";
import { cn } from "@/lib/utils";

/**
 * A counter on a menu row. Nothing at all for zero — an empty "0" reads as a
 * task. The number is shown once and spoken once, with its word ("3 חדשות"),
 * so a screen reader does not hear a bare figure after the row's name.
 *
 * `alert` is for what a client is waiting on — a request to move or cancel a
 * meeting — so it does not read as one more of the row's own items.
 */
export default function CountBadge({
  count,
  label,
  className,
  tone = "accent",
}: {
  count: number;
  label: string;
  className?: string;
  tone?: "accent" | "alert";
}) {
  if (!(count > 0)) return null;
  return (
    <span
      className={cn(
        "inline-flex min-w-6 h-6 px-1.5 items-center justify-center rounded-sm text-xs font-medium tabular-nums",
        tone === "alert" ? "bg-destructive text-destructive-foreground" : "bg-accent text-accent-foreground",
        className,
      )}
    >
      <span aria-hidden="true">{count > 99 ? "99+" : count}</span>
      <span className="sr-only">{`${count} ${label}`}</span>
    </span>
  );
}
