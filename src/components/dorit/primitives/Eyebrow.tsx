import React from "react";
import { cn } from "@/lib/utils";

/**
 * The small tracked label above a section heading ("06 · בשפה פשוטה").
 * One definition for the fifteen places that carried the same three classes.
 */
export default function Eyebrow({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span className={cn("text-[11px] tracking-[0.12em] text-accent", className)} {...props}>
      {children}
    </span>
  );
}
