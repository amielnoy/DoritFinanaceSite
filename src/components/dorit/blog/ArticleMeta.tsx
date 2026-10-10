import React from "react";
import { cn } from "@/lib/utils";
import { readingMinutes } from "@/lib/reading-time";

/** "ביצוע: X" (when the article has one) and "קריאה: כ־N דק׳". */
export default function ArticleMeta({
  actionTime,
  body,
  className,
}: {
  actionTime?: string;
  body?: string;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm text-muted-foreground", className)}>
      {actionTime ? (
        <span className="bg-highlight/15 text-accent px-2 py-0.5 rounded-sm">ביצוע: {actionTime}</span>
      ) : null}
      <span>קריאה: כ־{readingMinutes(body)} דק׳</span>
    </div>
  );
}
