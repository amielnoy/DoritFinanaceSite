import React from "react";
import { Link } from "react-router-dom";
import FloatingHeader from "@/components/dorit/layout/FloatingHeader";
import Footer from "@/components/dorit/layout/Footer";
import PensionCheckForm from "@/components/dorit/forms/PensionCheckForm";
import { YEAR_END } from "@/config/offers";
import { breadcrumbLd, siteNameIn, useSeo } from "@/lib/seo";
import { useLocale, useT } from "@/i18n/LocaleContext";
import { localePath } from "@/i18n/locales";
import Glossed from "@/components/dorit/primitives/Glossed";
import { ArrowLeft, CalendarClock, CalendarX2, ShieldCheck, Wallet, type LucideIcon } from "lucide-react";

/**
 * /atzmaim-31-12 — the year-end campaign for the self-employed (growth brief,
 * 2026-10-14; paid promotion in November and December). Every figure is the
 * published article's (/blog/sof-shana-atzmaim, tax year 2026), with its own
 * caveat; the page adds the offer, not new numbers. Update both together.
 */
const POINTS = ["p1", "p2", "p3"] as const;

/** Each point's icon and accent; the first — the deadline — is the warning. */
const POINT_STYLE: Record<(typeof POINTS)[number], { icon: LucideIcon; tile: string; rule: string }> = {
  p1: { icon: CalendarX2, tile: "bg-destructive/10 text-destructive", rule: "bg-destructive" },
  p2: { icon: ShieldCheck, tile: "bg-green-500/10 text-green-700 dark:text-green-400", rule: "bg-green-600" },
  p3: { icon: Wallet, tile: "bg-highlight/10 text-accent", rule: "bg-primary" },
};

export default function YearEndSelfEmployed() {
  const t = useT("yearend");
  const tc = useT("common");
  const locale = useLocale();
  useSeo({
    title: `${t("seo.title")} | ${siteNameIn(locale)}`,
    description: t("seo.description"),
    path: YEAR_END.path,
    locale,
    translated: true,
    jsonLd: [
      breadcrumbLd([
        { name: tc("nav.home"), path: localePath(locale, "/") },
        { name: t("crumb"), path: localePath(locale, YEAR_END.path) },
      ]),
    ],
  });

  return (
    <div className="relative bg-background pb-14 md:pb-0">
      <FloatingHeader />
      <main id="main">
        <section className="pt-40 pb-16 md:pt-48 md:pb-24 max-md:pt-28">
          <div className="max-w-[1100px] mx-auto px-6 md:px-10">
            <div className="text-center">
              <span className="inline-flex items-center gap-2 rounded-full border border-highlight/30 bg-highlight/10 px-3.5 py-1 text-sm font-semibold text-accent">
                <CalendarClock size={16} aria-hidden="true" />
                {t("eyebrow")}
              </span>
              <h1 className="font-heading font-extrabold text-5xl md:text-6xl mt-5 leading-tight max-md:text-4xl [text-wrap:balance]">
                {t("title")}
              </h1>
              <p className="mt-5 mx-auto text-lg text-foreground/80 max-w-2xl leading-relaxed">
                <Glossed text={t("intro")} />
              </p>
            </div>

            <ul className="mt-12 grid gap-5 md:grid-cols-3 list-none p-0">
              {POINTS.map((p) => {
                const { icon: Icon, tile, rule } = POINT_STYLE[p];
                return (
                  <li key={p} className="card-raised p-6">
                    <span aria-hidden="true" className={`inline-flex h-10 w-10 items-center justify-center rounded-xl ${tile}`}>
                      <Icon size={20} />
                    </span>
                    <h2 className="font-heading font-bold text-xl mt-4 leading-snug">{t(`${p}.title`)}</h2>
                    <span aria-hidden="true" className={`mt-3 block h-1 w-10 rounded-full ${rule}`} />
                    <p className="mt-3 text-[16px] leading-relaxed text-foreground/80"><Glossed text={t(`${p}.body`)} /></p>
                  </li>
                );
              })}
            </ul>
            <p className="mt-5 text-center text-sm text-muted-foreground">
              {t("caveat")}{" "}
              <Link to={YEAR_END.article} className="inline-flex items-center gap-1 font-medium text-accent underline underline-offset-4">
                {t("guide")}
                {/* The article is on the Hebrew blog only. */}
                {locale === "he" ? null : ` ${tc("lang.hebrewOnly")}`}
                <ArrowLeft size={14} aria-hidden="true" className="ltr:rotate-180" />
              </Link>
            </p>

            <div className="relative mt-12 max-w-3xl mx-auto overflow-hidden rounded-2xl">
              <span aria-hidden="true" className="absolute inset-x-0 top-0 z-10 h-1.5 bg-primary" />
              <PensionCheckForm
                location="year_end"
                context="עצמאים — עד 31.12"
                heading={t("formHeading")}
                roomy
              />
            </div>

            <p className="mt-10 max-w-3xl mx-auto rounded-xl border border-border bg-secondary/40 p-4 text-xs text-muted-foreground leading-relaxed">
              {t("notAdvice")} {tc("compliance.pensionMarketing")}
            </p>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
