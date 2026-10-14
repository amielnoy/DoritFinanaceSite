import React from "react";
import FloatingHeader from "@/components/dorit/layout/FloatingHeader";
import Footer from "@/components/dorit/layout/Footer";
import Eyebrow from "@/components/dorit/primitives/Eyebrow";
import PensionCheckForm from "@/components/dorit/forms/PensionCheckForm";
import { PENSION_CHECK } from "@/config/offers";
import { SITE_NAME, breadcrumbLd, useSeo } from "@/lib/seo";
import { useLocale, useT } from "@/i18n/LocaleContext";
import { localePath } from "@/i18n/locales";

/**
 * /pension-check — the flagship (growth brief, 2026-10-14): Dorit looks at the
 * whole pension portfolio through the clearinghouse, with the request pipeline
 * already built. The hero's main button, the articles on pension topics and
 * the year-end page all lead here.
 */
const STEPS = [
  ["step1.title", "step1.text"],
  ["step2.title", "step2.text"],
  ["step3.title", "step3.text"],
] as const;

export default function PensionCheck() {
  const t = useT("pension");
  const tc = useT("common");
  const locale = useLocale();
  useSeo({
    title: `${t("seo.title")} | ${SITE_NAME}`,
    description: t("seo.description"),
    path: PENSION_CHECK.path,
    locale,
    translated: true,
    jsonLd: [
      breadcrumbLd([
        { name: tc("nav.home"), path: localePath(locale, "/") },
        { name: t("seo.title"), path: localePath(locale, PENSION_CHECK.path) },
      ]),
    ],
  });

  return (
    <div className="relative bg-background pb-14 md:pb-0">
      <FloatingHeader />
      <main>
        <section className="pt-40 pb-16 md:pt-48 md:pb-20 border-b border-border/50 max-md:pt-28">
          <div className="max-w-[1000px] mx-auto px-6 md:px-10">
            <Eyebrow>{t("page.eyebrow")}</Eyebrow>
            <h1 className="font-heading text-5xl md:text-7xl mt-5 leading-tight max-md:text-4xl">{t("page.title")}</h1>
            <p className="mt-6 text-lg text-foreground/80 max-w-2xl leading-relaxed">
              {t("page.intro")}
            </p>

            <ol className="mt-10 grid gap-4 md:grid-cols-3 list-none p-0">
              {STEPS.map(([title, text], i) => (
                <li key={title} className="rounded-[4px] border border-border p-5">
                  <span className="font-heading text-2xl text-accent lining-nums">{String(i + 1).padStart(2, "0")}</span>
                  <h2 className="font-heading text-xl mt-2">{t(title)}</h2>
                  <p className="mt-2 text-[16px] leading-relaxed text-foreground/80">{t(text)}</p>
                </li>
              ))}
            </ol>

            <div className="mt-10">
              <PensionCheckForm location="page" context="עמוד בדיקת תיק פנסיוני" />
            </div>

            <p className="mt-10 text-xs text-muted-foreground leading-relaxed">{tc("compliance.pensionMarketing")}</p>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
