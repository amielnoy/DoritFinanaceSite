import React from "react";
import { Link } from "react-router-dom";
import FloatingHeader from "@/components/dorit/layout/FloatingHeader";
import Footer from "@/components/dorit/layout/Footer";
import Eyebrow from "@/components/dorit/primitives/Eyebrow";
import PensionCheckForm from "@/components/dorit/forms/PensionCheckForm";
import { YEAR_END } from "@/config/offers";
import { SITE_NAME, breadcrumbLd, useSeo } from "@/lib/seo";
import { useLocale, useT } from "@/i18n/LocaleContext";
import { localePath } from "@/i18n/locales";

/**
 * /atzmaim-31-12 — the year-end campaign for the self-employed (growth brief,
 * 2026-10-14; paid promotion in November and December). Every figure is the
 * published article's (/blog/sof-shana-atzmaim, tax year 2026), with its own
 * caveat; the page adds the offer, not new numbers. Update both together.
 */
const POINTS = ["p1", "p2", "p3"] as const;

export default function YearEndSelfEmployed() {
  const t = useT("yearend");
  const tc = useT("common");
  const locale = useLocale();
  useSeo({
    title: `${t("seo.title")} | ${SITE_NAME}`,
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
      <main>
        <section className="pt-40 pb-16 md:pt-48 md:pb-20 border-b border-border/50 max-md:pt-28">
          <div className="max-w-[1000px] mx-auto px-6 md:px-10">
            <Eyebrow>{t("eyebrow")}</Eyebrow>
            <h1 className="font-heading text-5xl md:text-7xl mt-5 leading-tight max-md:text-4xl">
              {t("title")}
            </h1>
            <p className="mt-6 text-lg text-foreground/80 max-w-2xl leading-relaxed">
              {t("intro")}
            </p>

            <ul className="mt-10 grid gap-4 md:grid-cols-3 list-none p-0">
              {POINTS.map((p) => (
                <li key={p} className="rounded-[4px] border border-border p-5">
                  <h2 className="font-heading text-xl">{t(`${p}.title`)}</h2>
                  <p className="mt-2 text-[16px] leading-relaxed text-foreground/80">{t(`${p}.body`)}</p>
                </li>
              ))}
            </ul>
            <p className="mt-4 text-sm text-muted-foreground">
              {t("caveat")}{" "}
              <Link to={YEAR_END.article} className="underline underline-offset-4">
                {t("guide")}
                {/* The article is on the Hebrew blog only. */}
                {locale === "he" ? null : ` ${tc("lang.hebrewOnly")}`}
              </Link>
            </p>

            <div className="mt-10">
              <PensionCheckForm
                location="year_end"
                context="עצמאים — עד 31.12"
                heading={t("formHeading")}
              />
            </div>

            <p className="mt-10 text-xs text-muted-foreground leading-relaxed">
              {t("notAdvice")} {tc("compliance.pensionMarketing")}
            </p>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
