import React, { useLayoutEffect, useRef, useState } from "react";
import { ctaClass } from "@/components/dorit/primitives/Cta";
import { Link } from "react-router-dom";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { ChevronLeft, HelpCircle, Phone, MessageCircle } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import FloatingHeader from "@/components/dorit/layout/FloatingHeader";
import Footer from "@/components/dorit/layout/Footer";
import { absoluteUrl, breadcrumbLd, useSeo } from "@/lib/seo";
import { faqLd } from "@/lib/structured-data";
import Reveal from "@/components/dorit/primitives/Reveal";
import { CtaLink } from "@/components/dorit/primitives/Cta";
import CredentialsStrip from "@/components/dorit/primitives/CredentialsStrip";
import { useAgencyContent } from "@/hooks/useAgencyContent";
import AgentChat from "@/components/dorit/chat/AgentChat";
import { AGENTS } from "@/config/agents";
import { FAQ_CATEGORIES, faqByCategory } from "@/content/faq";
import { faqCategoryLabel, localizeFaq } from "@/i18n/faq";
import type { FaqCategory, FaqEntry } from "@/content/faq";
import Eyebrow from "@/components/dorit/primitives/Eyebrow";
import { MD_UP, useMediaQuery } from "@/hooks/useMediaQuery";
import { useLocale, useLocalePath, useT } from "@/i18n/LocaleContext";
import type { Locale } from "@/i18n/locales";
import Glossed from "@/components/dorit/primitives/Glossed";

const IN_LANGUAGE: Record<Locale, string> = { he: "he-IL", en: "en", fr: "fr" };

interface FAQCategoryView extends FaqCategory {
  icon: LucideIcon;
  items: FaqEntry[];
}

const CATEGORIES: FAQCategoryView[] = FAQ_CATEGORIES.map((c) => ({
  ...c,
  icon: HelpCircle,
  items: faqByCategory(c.id),
}));

/** One cell of the CTA band's three-across row below md; nothing from md up. */
const CTA_CELL =
  "max-md:flex-col max-md:justify-center max-md:gap-1 max-md:min-h-16 max-md:px-1 max-md:py-2 max-md:text-[15px] max-md:leading-tight";

export default function FAQPage() {
  const { contact } = useAgencyContent();
  const t = useT("faq");
  const locale = useLocale();
  const lp = useLocalePath();
  const he = locale === "he";
  // The same categories and entries, in the page's language.
  const categories = CATEGORIES.map((c) => ({
    ...c,
    label: faqCategoryLabel(c.id, locale),
    items: c.items.map((e) => localizeFaq(e, locale)),
  }));
  useSeo({
    title: t("page.seoTitle"),
    description: t("page.seoDescription"),
    path: "/faq",
    locale,
    translated: true,
    jsonLd: [
      breadcrumbLd([
        { name: t("page.crumbHome"), path: lp("/") },
        { name: t("page.name"), path: lp("/faq") },
      ]),
      {
        "@context": "https://schema.org",
        "@type": "CollectionPage",
        name: t("page.name"),
        url: absoluteUrl(lp("/faq")),
        inLanguage: IN_LANGUAGE[locale],
      },
      // Built from the same array rendered below, so the markup cannot claim a
      // question the page does not show. This is the only URL on the site that
      // declares FAQPage — the home page used to as well, for questions it
      // never displayed.
      faqLd(categories.flatMap((c) => c.items)),
    ],
  });

  const [activeCat, setActiveCat] = useState<string>(categories[0].id);
  // Below md the topics are a bar pinned under the header, and a question
  // opens without closing the one above it: closing it pulled the clicked
  // question up the screen by the height of the answer that vanished.
  // From md up, nothing about this page changes.
  const isDesktop = useMediaQuery(MD_UP, true);
  const topicBarRef = useRef<HTMLElement>(null);
  const panelRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const switchedTopic = useRef(false);

  /** A chip half off the edge of the bar, tapped or reached by Tab, slides fully into it. */
  const revealTopic = (chip: HTMLButtonElement) => {
    if (isDesktop) return;
    const row = chip.parentElement;
    if (!row) return;
    const c = chip.getBoundingClientRect();
    const r = row.getBoundingClientRect();
    const pad = 24;
    if (c.left < r.left) row.scrollBy({ left: c.left - r.left - pad });
    else if (c.right > r.right) row.scrollBy({ left: c.right - r.right + pad });
  };

  const selectTopic = (id: string, chip: HTMLButtonElement) => {
    switchedTopic.current = true;
    setActiveCat(id);
    revealTopic(chip);
  };

  // A topic chosen from the pinned bar, deep in a long list, starts the new
  // list at its heading, just under the bar — not somewhere in its middle, or
  // past its end. Above that point the page is left exactly where it was.
  useLayoutEffect(() => {
    if (!switchedTopic.current) return;
    switchedTopic.current = false;
    if (isDesktop) return;
    const panel = panelRefs.current[activeCat];
    const bar = topicBarRef.current;
    if (!panel || !bar) return;
    if (panel.getBoundingClientRect().top < bar.getBoundingClientRect().bottom) {
      panel.scrollIntoView({ block: "start" });
    }
  }, [activeCat, isDesktop]);

  return (
    <div className="min-h-screen bg-background">
      <FloatingHeader />

      <main id="main" className="pt-[104px] md:pt-40">
        {/* Hero */}
        <section className="relative max-w-[1400px] mx-auto px-6 md:px-10 pb-6 md:pb-16">
          <Reveal>
            {/* Below md the kicker repeats the heading word for word, and the
                heading is one line, not two. The <title> and description are
                useSeo's above, and do not change. */}
            <Eyebrow className="max-md:hidden">
              {t("page.name")}
            </Eyebrow>
            <h1 className="font-heading font-extrabold text-4xl md:text-[clamp(44px,5vw,64px)] md:mt-5 leading-[1.1] tracking-[-0.02em] max-w-3xl">
              {t("page.titleLine1")}{" "}
              <br className="max-md:hidden" />
              {t("page.titleLine2")}
            </h1>
            <p className="mt-8 text-lg text-foreground/70 max-w-2xl leading-relaxed max-md:mt-3 max-md:text-base max-md:leading-relaxed">
              <span className="md:hidden">
                {t("page.introPhone")}
              </span>
              <span className="max-md:hidden">
                {t("page.intro")}
              </span>
            </p>
          </Reveal>
        </section>

        <div className="max-w-[1400px] mx-auto px-6 md:px-10">
          <CredentialsStrip />
        </div>

        {/* Category tabs + accordion */}
        <section className="relative pt-4 pb-12 md:py-24">
          <div className="max-w-[1400px] mx-auto px-6 md:px-10 grid grid-cols-1 lg:grid-cols-12 gap-10 max-md:gap-5 lg:gap-16">
            {/* Sidebar. Below md it is only the topics, as a bar pinned under
                the fixed header (79px; 78 tucks it under the header's border)
                that scrolls sideways. It is the grid's child so that it stays
                pinned for the length of the questions, and lets go before the
                support chat. */}
            <aside
              ref={topicBarRef}
              className="lg:col-span-4 max-md:sticky max-md:top-[78px] max-md:z-30 max-md:-mx-6 max-md:px-6 max-md:py-2 max-md:bg-background max-md:border-b max-md:border-border/60"
            >
              <div className="lg:sticky lg:top-32">
                <p id="faq-topics-label" className="text-sm text-muted-foreground mb-5 max-md:sr-only">
                  {t("page.topics")}
                </p>
                <div
                  role="group"
                  aria-labelledby="faq-topics-label"
                  className="flex lg:flex-col gap-2 overflow-x-auto lg:overflow-visible pb-2 lg:pb-0 max-md:pb-0 max-md:[scrollbar-width:none] max-md:[&::-webkit-scrollbar]:hidden"
                >
                  {categories.map((cat) => {
                    const active = cat.id === activeCat;
                    return (
                      <button
                        key={cat.id}
                        type="button"
                        aria-pressed={active}
                        onClick={(e) => selectTopic(cat.id, e.currentTarget)}
                        onFocus={(e) => revealTopic(e.currentTarget)}
                        className={`flex items-center gap-3 px-5 py-4 rounded-xl border transition-all duration-300 text-start whitespace-nowrap lg:whitespace-normal max-md:shrink-0 max-md:min-h-11 max-md:px-4 max-md:py-2 ${
                          active
                            ? "bg-primary text-primary-foreground border-primary shadow-md"
                            : "bg-card border-border shadow-sm hover:border-accent"
                        }`}
                      >
                        <cat.icon size={18} className={`max-md:hidden ${active ? "text-primary-foreground" : "text-accent"}`} aria-hidden="true" />
                        <span className="font-heading font-semibold text-lg max-md:text-base">{cat.label}</span>
                      </button>
                    );
                  })}
                </div>

                {/* Below md the support chat's card says this directly
                    underneath, and the CTA band after it. */}
                <div className="mt-8 p-6 card-raised max-md:hidden">
                  <p className="font-heading font-bold text-xl mb-2">{t("page.notFoundTitle")}</p>
                  <p className="text-sm text-foreground/70 leading-relaxed mb-5">
                    {t("page.notFoundText")}
                  </p>
                  <a
                    href={lp("/#start")}
                    className={ctaClass("w-full")}
                  >
                    {t("page.contact")}
                  </a>
                </div>
              </div>
            </aside>

            {/* Accordion */}
            <div className="lg:col-span-8">
              {/* Every category is rendered; the inactive ones are hidden with
                  CSS rather than unmounted. This page declares FAQPage markup
                  for all of them, and markup may only describe content that is
                  actually in the HTML — see 10-known-issues B-0. Nothing about
                  what a visitor sees changes. */}
              {categories.map((cat) => (
                <div
                  key={cat.id}
                  hidden={cat.id !== activeCat}
                  ref={(el) => {
                    panelRefs.current[cat.id] = el;
                  }}
                  // Clear of the header and the pinned topics bar (79 + 61).
                  className="max-md:scroll-mt-[148px]"
                >
                  <div className="mb-6 max-md:mb-4">
                    <h2 className="font-heading font-bold text-3xl md:text-4xl">{cat.label}</h2>
                    <p className="text-sm font-semibold tracking-[0.08em] uppercase text-accent mt-2">
                      {he ? `${cat.labelEn} · ` : ""}{t("page.count", { count: cat.items.length })}
                    </p>
                  </div>
                  <Accordion
                    {...(isDesktop
                      ? { type: "single" as const, collapsible: true }
                      : { type: "multiple" as const })}
                    className="flex flex-col gap-3"
                  >
                    {cat.items.map((item) => (
                      <AccordionItem
                        key={item.id}
                        value={item.id}
                        className="card-raised px-5 md:px-6 transition-shadow hover:shadow-md"
                      >
                        <AccordionTrigger className="text-start text-lg md:text-xl font-heading font-semibold py-5 max-md:py-4 hover:no-underline hover:text-accent transition-colors data-[state=open]:text-accent [&[data-state=open]>svg]:text-accent">
                          {item.q}
                        </AccordionTrigger>
                        <AccordionContent className="text-foreground/80 leading-relaxed text-base pb-6">
                          <Glossed text={item.a} />
                        </AccordionContent>
                      </AccordionItem>
                    ))}
                  </Accordion>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* The open question, where the answered ones end.
            A visitor who has just read every answer on the page and not found
            theirs is the one person on the site who definitely has a question,
            and until now the only thing offered to them was a phone number. */}
        {/* The support chat answers in Hebrew: on the Hebrew page only. */}
        {he ? <AgentChat descriptor={AGENTS.support} /> : null}

        {/* CTA */}
        <section data-track-location="faq" className="relative py-12 md:py-24 bg-primary text-primary-foreground">
          <div className="max-w-3xl mx-auto px-6 text-center">
            <Reveal>
              <h2 className="font-heading font-extrabold text-3xl md:text-5xl leading-tight">
                {t("page.ctaTitle")}
              </h2>
              <p className="mt-3 md:mt-6 text-muted-foreground-on-dark leading-relaxed">
                {t("page.ctaText")}
              </p>
              {/* Below md: one row, a grid of three, each a label under its icon. */}
              <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4 max-md:mt-6 max-md:grid max-md:grid-cols-3 max-md:gap-2 max-md:items-stretch">
                <CtaLink href={lp("/#start")} className={`border-white bg-white text-primary shadow-md hover:bg-white/90 ${CTA_CELL}`}>{t("page.ctaMeeting")}</CtaLink>
                <a
                  href={`tel:${contact.phoneE164}`}
                  className={`inline-flex items-center gap-2 min-h-12 px-7 rounded-xl border border-primary-foreground/40 text-primary-foreground font-semibold hover:bg-white/10 transition-colors ${CTA_CELL}`}
                >
                  <Phone size={18} className="shrink-0" />
                  <span dir="ltr" className="max-md:hidden">{contact.phoneDisplay}</span>
                  <span className="md:hidden">{t("page.ctaPhone")}</span>
                </a>
                <a
                  href={`https://wa.me/${contact.whatsapp}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`inline-flex items-center gap-2 min-h-12 px-7 rounded-xl border border-primary-foreground/40 text-primary-foreground font-semibold hover:bg-white/10 transition-colors ${CTA_CELL}`}
                >
                  <MessageCircle size={18} className="shrink-0" />
                  WhatsApp
                </a>
              </div>
              <Link
                to={lp("/")}
                className="mt-10 max-md:mt-6 inline-flex items-center gap-1 text-sm text-muted-foreground-on-dark hover:text-highlight transition-colors"
              >
                <ChevronLeft size={16} className="ltr:rotate-180" />
                {t("page.backHome")}
              </Link>
            </Reveal>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}