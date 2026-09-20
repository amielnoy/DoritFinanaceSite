import React, { useState } from "react";
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
import { CONTACT } from "@/config/contact";
import AgentChat from "@/components/dorit/chat/AgentChat";
import { AGENTS } from "@/config/agents";
import { FAQ_CATEGORIES, faqByCategory } from "@/content/faq";
import type { FaqCategory, FaqEntry } from "@/content/faq";
import Eyebrow from "@/components/dorit/primitives/Eyebrow";

interface FAQCategoryView extends FaqCategory {
  icon: LucideIcon;
  items: FaqEntry[];
}

const CATEGORIES: FAQCategoryView[] = FAQ_CATEGORIES.map((c) => ({
  ...c,
  icon: HelpCircle,
  items: faqByCategory(c.id),
}));

export default function FAQPage() {
  useSeo({
    title: "שאלות ותשובות — פנסיה, גמל, ביטוח ומיסוי | דורית גוב ארי",
    description:
      "תשובות ברורות לשאלות הנפוצות על פנסיה, קרנות השתלמות, דמי ניהול, קיבוע זכויות, תיקון 190 וביטוחי חיים ובריאות.",
    path: "/faq",
    jsonLd: [
      breadcrumbLd([
        { name: "ראשי", path: "/" },
        { name: "שאלות ותשובות", path: "/faq" },
      ]),
      {
        "@context": "https://schema.org",
        "@type": "CollectionPage",
        name: "שאלות ותשובות",
        url: absoluteUrl("/faq"),
        inLanguage: "he-IL",
      },
      // Built from the same array rendered below, so the markup cannot claim a
      // question the page does not show. This is the only URL on the site that
      // declares FAQPage — the home page used to as well, for questions it
      // never displayed.
      faqLd(CATEGORIES.flatMap((c) => c.items)),
    ],
  });

  const [activeCat, setActiveCat] = useState<string>(CATEGORIES[0].id);
  const current = CATEGORIES.find((c) => c.id === activeCat)!;

  return (
    <div className="min-h-screen bg-background">
      <FloatingHeader />

      <main className="pt-32 md:pt-40">
        {/* Hero */}
        <section className="relative max-w-[1400px] mx-auto px-6 md:px-10 pb-12 md:pb-16">
          <Reveal>
            <Eyebrow>
              שאלות ותשובות
            </Eyebrow>
            <h1 className="font-heading text-5xl md:text-6xl mt-5 leading-tight max-w-3xl">
              שאלות
              <br />
              ותשובות
            </h1>
            <p className="mt-8 text-lg text-foreground/70 max-w-2xl leading-relaxed">
              מענה מהיר לנושאים מרכזיים במס הכנסה, פנסיה וביטוח. בחרו את הנושא
              שמעניין אתכם — ואם לא מצאתם את התשובה, אשמח לענות אישית.
            </p>
          </Reveal>
        </section>

        <div className="max-w-[1400px] mx-auto px-6 md:px-10">
          <CredentialsStrip />
        </div>

        {/* Category tabs + accordion */}
        <section className="relative py-16 md:py-24">
          <div className="max-w-[1400px] mx-auto px-6 md:px-10 grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-16">
            {/* Sidebar */}
            <aside className="lg:col-span-4">
              <div className="lg:sticky lg:top-32">
                <p className="text-[11px] tracking-[0.12em] text-muted-foreground mb-5">
                  ניווט לפי נושא
                </p>
                <div className="flex lg:flex-col gap-2 overflow-x-auto lg:overflow-visible pb-2 lg:pb-0">
                  {CATEGORIES.map((cat) => {
                    const active = cat.id === activeCat;
                    return (
                      <button
                        key={cat.id}
                        onClick={() => setActiveCat(cat.id)}
                        className={`flex items-center gap-3 px-5 py-4 border transition-all duration-300 text-right whitespace-nowrap lg:whitespace-normal ${
                          active
                            ? "bg-primary text-primary-foreground border-primary"
                            : "border-border hover:border-accent hover:bg-secondary/40"
                        }`}
                      >
                        <cat.icon size={18} className={active ? "text-highlight" : "text-accent"} />
                        <span className="font-heading text-lg">{cat.label}</span>
                      </button>
                    );
                  })}
                </div>

                <div className="mt-8 p-6 border border-border/60 bg-secondary/30">
                  <p className="font-heading text-xl mb-2">לא מצאתם תשובה?</p>
                  <p className="text-sm text-foreground/70 leading-relaxed mb-5">
                    שאלו אותי ישירות — אחזור אליכם אישית תוך יום עסקים אחד.
                  </p>
                  <a
                    href="/#start"
                    className="inline-flex items-center gap-2 px-5 py-3 bg-highlight text-primary font-medium hover:bg-highlight-strong transition-colors w-full justify-center"
                  >
                    יצירת קשר
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
              {CATEGORIES.map((cat) => (
                <div key={cat.id} hidden={cat.id !== activeCat}>
                  <div className="mb-6">
                    <h2 className="font-heading text-3xl md:text-4xl">{cat.label}</h2>
                    <p className="text-sm tracking-[0.2em] uppercase text-accent mt-2">
                      {cat.labelEn} · {cat.items.length} שאלות
                    </p>
                  </div>
                  <Accordion type="single" collapsible className="border-t border-border/60">
                    {cat.items.map((item) => (
                      <AccordionItem
                        key={item.id}
                        value={item.id}
                        className="border-b border-border/60"
                      >
                        <AccordionTrigger className="text-right text-lg md:text-xl font-heading py-6 hover:no-underline hover:text-accent transition-colors [&[data-state=open]>svg]:text-highlight">
                          {item.q}
                        </AccordionTrigger>
                        <AccordionContent className="text-foreground/70 leading-relaxed text-base pb-6">
                          {item.a}
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
        <AgentChat descriptor={AGENTS.support} />

        {/* CTA */}
        <section className="relative py-24 md:py-32 border-t border-border/60 bg-primary text-primary-foreground">
          <div className="max-w-3xl mx-auto px-6 text-center">
            <Reveal>
              <h2 className="font-heading text-4xl md:text-5xl leading-tight">
                עדיין מתלבטים?
              </h2>
              <p className="mt-6 text-primary-foreground/70 leading-relaxed">
                כל שאלה ראויה לתשובה אישי. נשוחח — ונבנה יחד את התכנון הנכון עבורכם.
              </p>
              <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
                <CtaLink href="/#start">קביעת פגישת ייעוץ</CtaLink>
                <a
                  href={`tel:${CONTACT.phoneE164}`}
                  className="inline-flex items-center gap-2 px-7 py-3.5 border border-primary-foreground/30 text-primary-foreground font-medium hover:border-highlight hover:text-highlight transition-colors"
                >
                  <Phone size={18} />
                  <span dir="ltr">{CONTACT.phoneDisplay}</span>
                </a>
                <a
                  href={`https://wa.me/${CONTACT.whatsapp}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 px-7 py-3.5 border border-primary-foreground/30 text-primary-foreground font-medium hover:border-highlight hover:text-highlight transition-colors"
                >
                  <MessageCircle size={18} />
                  WhatsApp
                </a>
              </div>
              <Link
                to="/"
                className="mt-10 inline-flex items-center gap-1 text-sm text-primary-foreground/60 hover:text-highlight transition-colors"
              >
                <ChevronLeft size={16} />
                חזרה לדף הבית
              </Link>
            </Reveal>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}