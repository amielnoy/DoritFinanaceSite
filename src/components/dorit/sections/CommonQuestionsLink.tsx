import React from "react";
import { Link } from "react-router-dom";
import { ctaClass } from "@/components/dorit/primitives/Cta";
import { useLocalePath, useT } from "@/i18n/LocaleContext";

/**
 * The home page's common questions, as a pointer rather than the questions.
 * `/faq` has all of them; the accordion that sat here (DetailedFAQ) repeated
 * a subset of it at the bottom of the longest page on the site. The id stays
 * `common-questions` so the anchors and the click reports that name it still
 * find it.
 */
export default function CommonQuestionsLink() {
  const t = useT("faq");
  const lp = useLocalePath();
  return (
    <section id="common-questions" className="relative border-b border-border">
      <div className="max-w-[1200px] mx-auto px-[clamp(20px,4vw,40px)] py-[clamp(32px,5vw,56px)] max-md:py-10 flex flex-wrap items-center justify-between gap-4">
        <h2 className="font-heading font-normal text-[clamp(26px,3vw,36px)] leading-[1.15]">{t("home.title")}</h2>
        <Link to={lp("/faq")} className={ctaClass(undefined, { muted: true })}>
          {t("home.all")}
        </Link>
      </div>
    </section>
  );
}
