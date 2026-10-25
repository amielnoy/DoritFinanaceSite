import React from "react";
import FloatingHeader from "@/components/dorit/layout/FloatingHeader";
import Footer from "@/components/dorit/layout/Footer";
import PensionCheckForm from "@/components/dorit/forms/PensionCheckForm";
import { PENSION_CHECK } from "@/config/offers";
import { breadcrumbLd, siteNameIn, useSeo } from "@/lib/seo";
import { useLocale, useT } from "@/i18n/LocaleContext";
import { localePath } from "@/i18n/locales";
import Glossed from "@/components/dorit/primitives/Glossed";
import { useAgencyContent } from "@/hooks/useAgencyContent";
import { BadgeCheck, KeyRound, LineChart, UserRound } from "lucide-react";

/**
 * /pension-check — the flagship (growth brief, 2026-10-14): Dorit looks at the
 * whole pension portfolio through the clearinghouse, with the request pipeline
 * already built. The hero's main button, the articles on pension topics and
 * the year-end page all lead here.
 */
const STEPS = [
  ["step1.title", "step1.text", UserRound],
  ["step2.title", "step2.text", KeyRound],
  ["step3.title", "step3.text", LineChart],
] as const;

export default function PensionCheck() {
  const t = useT("pension");
  const tc = useT("common");
  const locale = useLocale();
  const { agent } = useAgencyContent();
  useSeo({
    title: `${t("seo.title")} | ${siteNameIn(locale)}`,
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
      <main id="main">
        <section className="pt-40 pb-16 md:pt-48 md:pb-24 max-md:pt-28">
          <div className="max-w-[1100px] mx-auto px-6 md:px-10">
            <div className="card-raised relative overflow-hidden px-6 py-10 text-center md:px-12 md:py-14">
              <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-gradient-to-b from-highlight/10 to-transparent" />
              <div className="relative">
                <span className="inline-flex items-center gap-2 rounded-full border border-highlight/30 bg-card px-3 py-1 text-sm font-semibold text-accent">
                  <span aria-hidden="true" className="h-2 w-2 rounded-full bg-green-500" />
                  {t("page.eyebrow")}
                </span>
                <h1 className="font-heading font-extrabold text-5xl md:text-6xl mt-5 leading-tight max-md:text-4xl [text-wrap:balance]">{t("page.title")}</h1>
                <p className="mt-5 mx-auto text-lg text-foreground/80 max-w-2xl leading-relaxed">
                  <Glossed text={t("page.intro")} />
                </p>
                <p className="mt-7 inline-flex items-center gap-2 rounded-xl border border-border bg-card px-3.5 py-2 text-sm text-foreground/80">
                  <BadgeCheck size={16} aria-hidden="true" className="shrink-0 text-highlight" />
                  {tc("credentials.licence")}{" "}
                  <bdi dir="ltr" className="whitespace-nowrap font-medium text-foreground lining-nums tabular-nums">{agent.licenceNumber}</bdi>
                </p>
              </div>
            </div>

            <ol className="mt-10 grid gap-5 md:grid-cols-3 list-none p-0">
              {STEPS.map(([title, text, Icon], i) => (
                <li key={title} className="card-raised p-6">
                  <div className="flex items-start justify-between">
                    <span className="font-heading font-extrabold text-4xl text-accent/30 lining-nums leading-none">{String(i + 1).padStart(2, "0")}</span>
                    <span aria-hidden="true" className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-highlight/10 text-accent">
                      <Icon size={20} />
                    </span>
                  </div>
                  <h2 className="font-heading font-bold text-xl mt-4">{t(title)}</h2>
                  <p className="mt-2 text-[16px] leading-relaxed text-foreground/80"><Glossed text={t(text)} /></p>
                </li>
              ))}
            </ol>

            <div className="mt-10 max-w-3xl mx-auto">
              <PensionCheckForm location="page" context="עמוד בדיקת תיק פנסיוני" roomy />
            </div>

            <p className="mt-10 max-w-3xl mx-auto text-xs text-muted-foreground leading-relaxed">{tc("compliance.pensionMarketing")}</p>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
