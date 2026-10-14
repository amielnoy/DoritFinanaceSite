import React from "react";

/**
 * The headline: what Dorit does for the visitor, in light display type, a short
 * gold rule, and the old statement under it as the sub-headline. "מקצועיות,
 * יושר ואנושיות נפגשים" alone read like any agent's (user feedback, 2026-10-14);
 * the headline now names the work, and promises clarity rather than a saving.
 */
export default function ArchStatement() {
  return (
    <div className="animate-fade-up">
      <h1 className="font-heading font-normal text-[clamp(40px,5.2vw,72px)] leading-[1.06] tracking-[-0.01em] [text-wrap:balance]">
        תכנון פנסיה וביטוח בלי אותיות קטנות
      </h1>
      <span aria-hidden="true" className="block w-[72px] h-px bg-highlight my-[22px] max-md:my-4" />
      <p className="m-0 font-heading text-[clamp(22px,2.4vw,32px)] leading-snug text-foreground/80">
        מקצועיות, יושר ואנושיות נפגשים
      </p>
    </div>
  );
}
