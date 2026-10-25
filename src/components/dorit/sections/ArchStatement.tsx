import React from "react";
import { useT } from "@/i18n/LocaleContext";

/**
 * The headline: what Dorit does for the visitor, its closing phrase in blue on
 * a line of its own, and the old statement under it as the sub-headline.
 * "מקצועיות, יושר ואנושיות נפגשים" alone read like any agent's (user feedback,
 * 2026-10-14); the headline now names the work, and promises clarity rather
 * than a saving.
 *
 * `arch.titleAccent` names the tail of `arch.title` to colour. The title stays
 * one string, so the heading's text is the same with or without the split; if
 * a translation's title stops ending with its accent, it renders whole.
 */
export default function ArchStatement() {
  const t = useT("home");
  const title = t("arch.title");
  const accent = t("arch.titleAccent");
  const split = accent && title.endsWith(accent) ? title.length - accent.length : -1;
  return (
    <div className="animate-fade-up">
      <h1 className="font-heading font-extrabold text-[clamp(38px,4.8vw,64px)] leading-[1.12] tracking-[-0.02em] [text-wrap:balance]">
        {split > 0 ? (
          <>
            {title.slice(0, split).trimEnd()}{" "}
            <span className="block text-accent">{accent}</span>
          </>
        ) : title}
      </h1>
      <p className="m-0 mt-5 font-heading font-medium text-[clamp(20px,2vw,26px)] leading-snug text-foreground/80 max-md:mt-3">
        {t("arch.sub")}
      </p>
    </div>
  );
}
