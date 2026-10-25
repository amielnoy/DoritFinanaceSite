import React from "react";
import { Bot, Calculator, ListChecks } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import AgentChat from "@/components/dorit/chat/AgentChat";
import FloatingHeader from "@/components/dorit/layout/FloatingHeader";
import Footer from "@/components/dorit/layout/Footer";
import InsuranceAssessment from "@/components/dorit/sections/InsuranceAssessment";
import PensionFeeCalculator from "@/components/dorit/sections/PensionFeeCalculator";
import RetirementCalculator from "@/components/dorit/sections/RetirementCalculator";
import HarHabituachCheck from "@/components/dorit/sections/HarHabituachCheck";
import { SNAPSHOT_HOME } from "@/config/snapshot";
import { TOOL_SECTION } from "@/config/tools";
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

  const jumps: { href: string; label: string; icon: LucideIcon }[] = [
    { href: `#${TOOL_SECTION.assessment}`, label: t("page.jumpAssess"), icon: ListChecks },
    { href: `#${TOOL_SECTION.feeCalculator}`, label: t("page.jumpFee"), icon: Calculator },
    ...(he ? [{ href: `#${AGENTS.procedures.sectionId}`, label: t("page.jumpChat"), icon: Bot }] : []),
  ];

  return (
    <div className="relative bg-background pb-14 md:pb-0">
      <FloatingHeader />
      <main id="main">
        <section className="pt-40 pb-12 md:pt-48 md:pb-16 border-b border-border">
          <div className="max-w-[1200px] mx-auto px-[clamp(20px,4vw,40px)]">
            <Reveal>
              <Eyebrow>{t("page.eyebrow")}</Eyebrow>
              <h1 className="font-heading font-extrabold text-[clamp(38px,4.8vw,60px)] mt-4 leading-[1.1] tracking-[-0.02em] max-w-4xl">
                {t("page.title")}
              </h1>
              <p className="mt-5 text-foreground/75 max-w-3xl leading-relaxed">
                <Glossed text={t("page.intro")} />
              </p>
              {/* One way to each tool below; the chat is on the Hebrew page only. */}
              <nav aria-label={t("page.title")} className="mt-8 flex flex-wrap gap-2.5">
                {jumps.map(({ href, label, icon: Icon }) => (
                  <a key={href} href={href} className={JUMP}>
                    <Icon size={18} strokeWidth={1.75} className="text-accent" aria-hidden="true" />
                    {label}
                  </a>
                ))}
              </nav>
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

const JUMP =
  "inline-flex items-center gap-2 min-h-11 rounded-xl border border-border bg-card px-4 text-[15px] font-semibold text-foreground shadow-sm hover:border-highlight hover:text-accent transition-colors duration-200";
