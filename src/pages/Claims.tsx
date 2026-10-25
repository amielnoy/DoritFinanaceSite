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
            <h1 className="font-heading font-extrabold text-[clamp(38px,4.8vw,60px)] mt-5 leading-[1.12] tracking-[-0.02em] max-w-3xl">
              {t("hero.titleLine1")}
              <br />
              {t("hero.titleLine2")}
            </h1>
            <p className="mt-6 text-lg text-foreground/75 max-w-2xl leading-relaxed">
              <Glossed text={t("hero.intro")} />
            </p>
          </Reveal>

          {/* Urgent contact bar */}
          <Reveal delay={0.1}>
            <div className="mt-12 grid grid-cols-1 md:grid-cols-3 gap-4">
              <a
                href={`tel:${contact.phoneE164}`}
                className={`flex items-center gap-4 p-5 rounded-2xl shadow-md ${SLATE} hover:opacity-95 transition-opacity`}
              >
                <span className="w-12 h-12 shrink-0 rounded-xl bg-white/10 flex items-center justify-center" aria-hidden="true"><Phone size={22} /></span>
                <span className="flex flex-col">
                  <span className="text-sm text-white/75">{t("hero.reportNow")}</span>
                  <span dir="ltr" className="font-heading font-bold text-xl lining-nums tabular-nums">{contact.phoneDisplay}</span>
                </span>
              </a>
              <a
                href={`https://wa.me/${contact.whatsapp}?text=${encodeURIComponent(t("hero.whatsappText"))}`}
                target="_blank"
                rel="noopener noreferrer"
                className={CONTACT_CARD}
              >
                <span className="w-12 h-12 shrink-0 rounded-xl bg-[hsl(var(--brand-whatsapp)/0.12)] flex items-center justify-center" aria-hidden="true"><MessageCircle size={22} className="text-whatsapp" /></span>
                <span className="flex flex-col">
                  <span className="text-sm text-muted-foreground">{t("hero.quickMessage")}</span>
                  <span className="font-heading font-bold text-xl">WhatsApp</span>
                </span>
              </a>
              <a
                href={`mailto:${contact.email}`}
                className={CONTACT_CARD}
              >
                <span className="w-12 h-12 shrink-0 rounded-xl bg-secondary flex items-center justify-center" aria-hidden="true"><Mail size={22} className="text-accent" /></span>
                <span className="flex flex-col min-w-0">
                  <span className="text-sm text-muted-foreground">{t("hero.documents")}</span>
                  <span dir="ltr" className="font-heading font-bold text-lg truncate">{contact.email}</span>
                </span>
              </a>
            </div>
          </Reveal>
        </section>

        <div className="max-w-[1400px] mx-auto px-6 md:px-10">
          <CredentialsStrip />
        </div>

        {/* Steps */}
        <section className="relative py-16 md:py-24 border-t border-border bg-secondary/60">
          <div className="max-w-[1400px] mx-auto px-6 md:px-10">
            <Reveal>
              <div className="max-w-2xl mb-14">
                <Eyebrow>
                  {t("steps.eyebrow")}
                </Eyebrow>
                <h2 className="font-heading font-bold text-[clamp(28px,3.2vw,40px)] mt-4 leading-tight">
                  {t("steps.title")}
                </h2>
              </div>
            </Reveal>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {STEPS.map((s, i) => (
                <Reveal key={s.n} delay={i * 0.08}>
                  <div className="group h-full card-raised p-7 flex flex-col transition-shadow duration-300 hover:shadow-md">
                    <span className="font-heading font-extrabold text-5xl leading-none text-muted-foreground group-hover:text-accent transition-colors duration-300 lining-nums tabular-nums">{s.n}</span>
                    <h3 className="font-heading font-bold text-xl mt-5 mb-3">{t(`steps.${s.id}.title`)}</h3>
                    <p className="text-foreground/75 leading-relaxed text-[15px]"><Glossed text={t(`steps.${s.id}.body`)} /></p>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* Claim types */}
        <section className="relative py-16 md:py-24 border-t border-border">
          <div className="max-w-[1400px] mx-auto px-6 md:px-10">
            <Reveal>
              <div className="max-w-2xl mb-12">
                <Eyebrow>
                  {t("types.eyebrow")}
                </Eyebrow>
                <h2 className="font-heading font-bold text-[clamp(28px,3.2vw,40px)] mt-4 leading-tight">
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
                  <div className="group h-full card-raised p-7 md:p-8 transition-shadow duration-300 hover:shadow-md">
                    <div className="flex items-center gap-4 mb-6">
                      <span className="w-12 h-12 shrink-0 rounded-xl bg-secondary flex items-center justify-center text-accent transition-colors duration-300 group-hover:bg-primary group-hover:text-primary-foreground" aria-hidden="true">
                        <c.icon size={22} />
                      </span>
                      <h3 className="font-heading font-bold text-[22px] leading-snug">{t(`types.${c.id}.title`)}</h3>
                    </div>
                    <ul className="space-y-3">
                      {Array.from({ length: c.points }, (_, k) => `types.${c.id}.p${k + 1}`).map((p) => (
                        <li key={p} className="flex items-start gap-3 text-foreground/75 leading-relaxed">
                          <CheckCircle2 size={18} className="text-accent mt-1 shrink-0" aria-hidden="true" />
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
        <section className="relative py-16 md:py-24 bg-[hsl(222_47%_11%)] text-white dark:bg-[hsl(222_50%_5%)]">
          <div className="max-w-[1400px] mx-auto px-6 md:px-10 grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-16">
            <div className="lg:col-span-5">
              <Reveal>
                <span className="text-sm font-semibold text-highlight-on-dark">
                  03 · Checklist
                </span>
                <h2 className="font-heading font-bold text-[clamp(28px,3.2vw,40px)] mt-4 leading-tight">
                  {t("docs.titleLine1")}
                  <br />
                  {t("docs.titleLine2")}
                </h2>
                <p className="mt-6 text-white/75 leading-relaxed max-w-md">
                  {t("docs.intro")}
                </p>
                <div className="mt-8 flex items-center gap-3 text-highlight-on-dark">
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
                      className="flex items-start gap-3 p-4 rounded-xl bg-white/5 border border-white/10 hover:border-white/25 transition-colors"
                    >
                      <CheckCircle2 size={20} className="text-[hsl(var(--brand-whatsapp))] mt-0.5 shrink-0" aria-hidden="true" />
                      <span className="font-medium text-white/90 leading-relaxed">{t(`docs.d${d}`)}</span>
                    </li>
                  ))}
                </ul>
              </Reveal>
            </div>
          </div>
        </section>

        {/* Claim submission form */}
        <section className="relative py-16 md:py-24 bg-secondary/60">
          <div className="max-w-[880px] mx-auto px-6 md:px-10">
            <Reveal>
              <div className="max-w-2xl mx-auto mb-10 text-center">
                <Eyebrow>
                  {t("report.eyebrow")}
                </Eyebrow>
                <h2 className="font-heading font-bold text-[clamp(28px,3.2vw,40px)] mt-4 leading-tight">
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
        <section className="relative py-16 md:py-24 border-t border-border">
          <div className={`max-w-[1100px] mx-[clamp(20px,4vw,40px)] lg:mx-auto rounded-3xl px-6 py-12 md:px-16 md:py-16 text-center shadow-xl ${SLATE}`}>
            <Reveal>
              <span className="mx-auto w-14 h-14 rounded-2xl bg-primary flex items-center justify-center" aria-hidden="true">
                <ShieldCheck size={28} className="text-primary-foreground" />
              </span>
              <h2 className="font-heading font-bold text-[clamp(28px,3.2vw,40px)] mt-6 leading-tight">
                {t("close.title")}
              </h2>
              <p className="mt-5 text-white/75 leading-relaxed max-w-2xl mx-auto">
                <Glossed text={t("close.text")} />
              </p>
              <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
                <a
                  href={`tel:${contact.phoneE164}`}
                  className="inline-flex items-center gap-2 min-h-12 px-7 rounded-xl bg-white text-[hsl(222_47%_11%)] font-semibold hover:bg-white/90 transition-colors"
                >
                  <Phone size={18} />
                  {t("close.call")}
                </a>
                {/* `#start` is a home-page section, and this is /claims —
                    as a bare hash it did nothing at all. */}
                <CtaLink href={lp("/#start")} onClick={(e) => goToSection(e, "#start")} onDark>
                  {t("close.intro")}
                </CtaLink>
              </div>
              <Link
                to={lp("/")}
                className="mt-8 inline-flex items-center gap-1 text-sm text-white/70 hover:text-white transition-colors"
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

/** The footer's slate, for the page's two dark surfaces. */
const SLATE = "bg-[hsl(222_47%_11%)] text-white dark:bg-[hsl(222_50%_5%)] dark:border dark:border-border";

const CONTACT_CARD =
  "flex items-center gap-4 p-5 rounded-2xl border border-border bg-card shadow-sm hover:border-highlight transition-colors";
