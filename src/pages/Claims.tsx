import React from "react";
import { Link } from "react-router-dom";
import {
  Phone,
  MessageCircle,
  Mail,
  Camera,
  FileText,
  ShieldCheck,
  Clock,
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import FloatingHeader from "@/components/dorit/layout/FloatingHeader";
import Footer from "@/components/dorit/layout/Footer";
import { SITE_NAME, absoluteUrl, breadcrumbLd, useSeo } from "@/lib/seo";
import Reveal from "@/components/dorit/primitives/Reveal";
import { CtaLink } from "@/components/dorit/primitives/Cta";
import { useAgencyContent } from "@/hooks/useAgencyContent";
import CredentialsStrip from "@/components/dorit/primitives/CredentialsStrip";
import ClaimForm from "@/components/dorit/forms/ClaimForm";
import { useSectionNav } from "@/hooks/useSectionNav";
import Eyebrow from "@/components/dorit/primitives/Eyebrow";
import { useLocale, useLocalePath, useT } from "@/i18n/LocaleContext";
import type { KeyOf } from "@/i18n/resources";
import type { Locale } from "@/i18n/locales";
import Glossed from "@/components/dorit/primitives/Glossed";

const IN_LANGUAGE: Record<Locale, string> = { he: "he-IL", en: "en", fr: "fr" };

interface ClaimType {
  icon: LucideIcon;
  /** The type's keys in claims.json: `types.<id>.title`, `types.<id>.p1`… */
  id: "t1" | "t2" | "t3" | "t4";
  points: number;
}

const STEPS = [
  { n: "01", id: "s1" },
  { n: "02", id: "s2" },
  { n: "03", id: "s3" },
  { n: "04", id: "s4" },
] as const;

const CLAIM_TYPES: ClaimType[] = [
  { icon: ShieldCheck, id: "t1", points: 3 },
  { icon: AlertTriangle, id: "t2", points: 3 },
  { icon: Clock, id: "t3", points: 3 },
  { icon: Camera, id: "t4", points: 3 },
];

/** The documents to prepare: `docs.d1`..`docs.d6` in claims.json. */
const DOCS = [1, 2, 3, 4, 5, 6] as const;

export default function Claims() {
  const { contact } = useAgencyContent();
  const goToSection = useSectionNav();
  const t = useT("claims");
  const locale = useLocale();
  const lp = useLocalePath();

  useSeo({
    title: t("seo.title"),
    description:
      t("seo.description"),
    path: "/claims",
    locale,
    translated: true,
    jsonLd: [
      breadcrumbLd([
        { name: t("seo.crumbHome"), path: lp("/") },
        { name: t("seo.crumb"), path: lp("/claims") },
      ]),
      {
        "@context": "https://schema.org",
        "@type": "Service",
        name: t("seo.service"),
        serviceType: t("seo.serviceType"),
        areaServed: { "@type": "Country", name: "IL" },
        inLanguage: IN_LANGUAGE[locale],
        url: absoluteUrl(lp("/claims")),
        provider: { "@type": "FinancialService", name: SITE_NAME, url: absoluteUrl("/") },
      },
    ],
  });
  return (
    <div className="min-h-screen bg-background">
      <FloatingHeader />

      <main id="main" className="pt-32 md:pt-40">
        {/* Hero */}
        <section className="relative max-w-[1400px] mx-auto px-6 md:px-10 pb-16 md:pb-20">
          <Reveal>
            <Eyebrow>
              {t("hero.eyebrow")}
            </Eyebrow>
            <h1 className="font-heading text-5xl md:text-6xl mt-5 leading-tight max-w-3xl">
              {t("hero.titleLine1")}
              <br />
              {t("hero.titleLine2")}
            </h1>
            <p className="mt-8 text-lg text-foreground/70 max-w-2xl leading-relaxed">
              <Glossed text={t("hero.intro")} />
            </p>
          </Reveal>

          {/* Urgent contact bar */}
          <Reveal delay={0.1}>
            <div className="mt-12 grid grid-cols-1 md:grid-cols-3 gap-4">
              <a
                href={`tel:${contact.phoneE164}`}
                className="flex items-center gap-4 p-5 bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                <Phone size={22} className="text-highlight" />
                <span className="flex flex-col">
                  <span className="text-xs tracking-[0.2em] uppercase text-primary-foreground/60">{t("hero.reportNow")}</span>
                  <span dir="ltr" className="font-medium">{contact.phoneDisplay}</span>
                </span>
              </a>
              <a
                href={`https://wa.me/${contact.whatsapp}?text=${encodeURIComponent(t("hero.whatsappText"))}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-4 p-5 border border-border hover:border-accent hover:text-accent transition-colors"
              >
                <MessageCircle size={22} className="text-whatsapp" />
                <span className="flex flex-col">
                  <span className="text-xs tracking-[0.2em] uppercase text-muted-foreground">{t("hero.quickMessage")}</span>
                  <span className="font-medium">WhatsApp</span>
                </span>
              </a>
              <a
                href={`mailto:${contact.email}`}
                className="flex items-center gap-4 p-5 border border-border hover:border-accent hover:text-accent transition-colors"
              >
                <Mail size={22} className="text-accent" />
                <span className="flex flex-col">
                  <span className="text-xs tracking-[0.2em] uppercase text-muted-foreground">{t("hero.documents")}</span>
                  <span dir="ltr" className="font-medium">{contact.email}</span>
                </span>
              </a>
            </div>
          </Reveal>
        </section>

        <div className="max-w-[1400px] mx-auto px-6 md:px-10">
          <CredentialsStrip />
        </div>

        {/* Steps */}
        <section className="relative py-20 md:py-24 border-t border-border/60 bg-secondary/40">
          <div className="max-w-[1400px] mx-auto px-6 md:px-10">
            <Reveal>
              <div className="max-w-2xl mb-14">
                <Eyebrow>
                  {t("steps.eyebrow")}
                </Eyebrow>
                <h2 className="font-heading text-4xl md:text-5xl mt-4">
                  {t("steps.title")}
                </h2>
              </div>
            </Reveal>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-px bg-border/60 border border-border/60">
              {STEPS.map((s, i) => (
                <Reveal key={s.n} delay={i * 0.08}>
                  <div className="h-full bg-background p-8 flex flex-col">
                    <span className="font-heading text-5xl text-highlight-ink leading-none">{s.n}</span>
                    <h3 className="font-heading text-xl mt-6 mb-3">{t(`steps.${s.id}.title`)}</h3>
                    <p className="text-foreground/70 leading-relaxed text-sm"><Glossed text={t(`steps.${s.id}.body`)} /></p>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* Claim types */}
        <section className="relative py-20 md:py-24">
          <div className="max-w-[1400px] mx-auto px-6 md:px-10">
            <Reveal>
              <div className="max-w-2xl mb-14">
                <Eyebrow>
                  {t("types.eyebrow")}
                </Eyebrow>
                <h2 className="font-heading text-4xl md:text-5xl mt-4">
                  {t("types.title")}
                </h2>
                <p className="mt-5 text-foreground/70 leading-relaxed">
                  <Glossed text={t("types.intro")} />
                </p>
              </div>
            </Reveal>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {CLAIM_TYPES.map((c, i) => (
                <Reveal key={c.id} delay={i * 0.06}>
                  <div className="h-full border border-border/60 p-8 hover:border-accent/50 transition-colors">
                    <div className="flex items-center gap-4 mb-6">
                      <span className="w-12 h-12 flex items-center justify-center border border-accent/40 text-accent">
                        <c.icon size={22} />
                      </span>
                      <h3 className="font-heading text-2xl">{t(`types.${c.id}.title`)}</h3>
                    </div>
                    <ul className="space-y-3">
                      {Array.from({ length: c.points }, (_, k) => `types.${c.id}.p${k + 1}`).map((p) => (
                        <li key={p} className="flex items-start gap-3 text-foreground/75 leading-relaxed">
                          <CheckCircle2 size={18} className="text-highlight mt-1 shrink-0" />
                          <span><Glossed text={t(p as KeyOf<"claims">)} /></span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* Documents checklist */}
        <section className="relative py-20 md:py-24 border-t border-border/60 bg-primary text-primary-foreground">
          <div className="max-w-[1400px] mx-auto px-6 md:px-10 grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-16">
            <div className="lg:col-span-5">
              <Reveal>
                <span className="text-sm text-highlight">
                  03 · Checklist
                </span>
                <h2 className="font-heading text-4xl md:text-5xl mt-4 leading-tight">
                  {t("docs.titleLine1")}
                  <br />
                  {t("docs.titleLine2")}
                </h2>
                <p className="mt-6 text-primary-foreground/70 leading-relaxed max-w-md">
                  {t("docs.intro")}
                </p>
                <div className="mt-8 flex items-center gap-3 text-highlight">
                  <FileText size={20} />
                  <span className="text-sm tracking-wide">{t("docs.keep")}</span>
                </div>
              </Reveal>
            </div>
            <div className="lg:col-span-7">
              <Reveal delay={0.1}>
                <ul className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {DOCS.map((d) => (
                    <li
                      key={d}
                      className="flex items-start gap-3 p-4 border border-primary-foreground/15 hover:border-highlight/50 transition-colors"
                    >
                      <CheckCircle2 size={20} className="text-highlight mt-0.5 shrink-0" />
                      <span className="text-primary-foreground/85 leading-relaxed">{t(`docs.d${d}`)}</span>
                    </li>
                  ))}
                </ul>
              </Reveal>
            </div>
          </div>
        </section>

        {/* Claim submission form */}
        <section className="relative py-20 md:py-24 border-t border-border/60">
          <div className="max-w-[1100px] mx-auto px-6 md:px-10">
            <Reveal>
              <div className="max-w-2xl mb-10">
                <Eyebrow>
                  {t("report.eyebrow")}
                </Eyebrow>
                <h2 className="font-heading text-4xl md:text-5xl mt-4 leading-tight">
                  {t("report.title")}
                </h2>
                <p className="mt-5 text-foreground/70 leading-relaxed">
                  <Glossed text={t("report.intro")} />
                </p>
              </div>
            </Reveal>
            <Reveal delay={0.1}>
              <ClaimForm />
            </Reveal>
          </div>
        </section>

        {/* Reassurance / CTA */}
        <section className="relative py-24 md:py-32">
          <div className="max-w-3xl mx-auto px-6 text-center">
            <Reveal>
              <ShieldCheck size={40} className="mx-auto text-accent" />
              <h2 className="font-heading text-4xl md:text-5xl mt-8 leading-tight">
                {t("close.title")}
              </h2>
              <p className="mt-6 text-foreground/70 leading-relaxed">
                <Glossed text={t("close.text")} />
              </p>
              <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
                <a
                  href={`tel:${contact.phoneE164}`}
                  className="inline-flex items-center gap-2 px-7 py-3.5 bg-primary text-primary-foreground font-medium hover:bg-primary/90 transition-colors"
                >
                  <Phone size={18} />
                  {t("close.call")}
                </a>
                {/* `#start` is a home-page section, and this is /claims —
                    as a bare hash it did nothing at all. */}
                <CtaLink href={lp("/#start")} onClick={(e) => goToSection(e, "#start")}>
                  {t("close.intro")}
                </CtaLink>
              </div>
              <Link
                to={lp("/")}
                className="mt-10 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-accent transition-colors"
              >
                <ChevronLeft size={16} className="ltr:rotate-180" />
                {t("close.back")}
              </Link>
            </Reveal>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}