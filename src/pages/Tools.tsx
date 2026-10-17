import React from "react";
import AgentChat from "@/components/dorit/chat/AgentChat";
import FloatingHeader from "@/components/dorit/layout/FloatingHeader";
import Footer from "@/components/dorit/layout/Footer";
import InsuranceAssessment from "@/components/dorit/sections/InsuranceAssessment";
import PensionFeeCalculator from "@/components/dorit/sections/PensionFeeCalculator";
import RetirementCalculator from "@/components/dorit/sections/RetirementCalculator";
import HarHabituachCheck from "@/components/dorit/sections/HarHabituachCheck";
import { SNAPSHOT_HOME } from "@/config/snapshot";
import Reveal from "@/components/dorit/primitives/Reveal";
import { breadcrumbLd, siteNameIn, useSeo } from "@/lib/seo";
import Eyebrow from "@/components/dorit/primitives/Eyebrow";
import { AGENTS } from "@/config/agents";
import { useLocale, useT } from "@/i18n/LocaleContext";
import { localePath } from "@/i18n/locales";
import Glossed from "@/components/dorit/primitives/Glossed";

/**
 * The two self-assessment tools, off the home page.
 *
 * Both are worth having and neither belongs between a visitor and the sentence
 * "let's talk". They ask a reader to do work — answer a questionnaire, model a
 * fee — at the point in the page where they had just decided to make contact,
 * and a tool is a very effective way to lose someone who was ready.
 *
 * Here they are the reason for the visit rather than an interruption to it.
 *
 * The procedures chat sits below them because it is the same errand one step
 * on. The tools estimate; the chat says what you actually do about it — which
 * steps, which documents, and how to read the real numbers on the regulator's
 * own sites. A visitor who has just modelled a fee is exactly the one who
 * wants to know where to read their own, and until now the page ended without
 * telling them.
 */
export default function Tools() {
  const t = useT("tools");
  const locale = useLocale();
  const he = locale === "he";
  useSeo({
    title: `${t("page.seoTitle")} | ${siteNameIn(locale)}`,
    description:
      t("page.seoDescription"),
    path: "/tools",
    locale,
    translated: true,
    jsonLd: [
      breadcrumbLd([
        { name: t("page.crumbHome"), path: localePath(locale, "/") },
        { name: t("page.crumb"), path: localePath(locale, "/tools") },
      ]),
    ],
  });

  return (
    <div className="relative bg-background pb-14 md:pb-0">
      <FloatingHeader />
      <main id="main">
        <section className="pt-40 pb-16 md:pt-48 md:pb-20 border-b border-border/50">
          <div className="max-w-[1400px] mx-auto px-6 md:px-10">
            <Reveal>
              <Eyebrow>{t("page.eyebrow")}</Eyebrow>
              <h1 className="font-heading text-5xl md:text-7xl mt-5 leading-tight max-w-4xl">
                {t("page.title")}
              </h1>
              <p className="mt-8 text-muted-foreground max-w-2xl leading-relaxed">
                <Glossed text={t("page.intro")} />
              </p>
            </Reveal>
          </div>
        </section>
        <InsuranceAssessment />
        <PensionFeeCalculator />
        {/* The snapshot programme's new tools ship with its switch (VITE_SNAPSHOT_HOME). */}
        {/* Hebrew only for now, like the snapshot section on the home page. */}
        {SNAPSHOT_HOME && he ? <RetirementCalculator /> : null}
        {SNAPSHOT_HOME && he ? <HarHabituachCheck /> : null}
        {/* The procedures chat answers in Hebrew: on the Hebrew page only. */}
        {he ? <AgentChat descriptor={AGENTS.procedures} /> : null}
      </main>
      <Footer />
    </div>
  );
}
