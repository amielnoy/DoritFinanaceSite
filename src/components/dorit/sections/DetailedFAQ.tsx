import React from "react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import Reveal from "@/components/dorit/primitives/Reveal";
import { HOME_COMMON_QUESTION_IDS, faqByIds } from "@/content/faq";
import Eyebrow from "@/components/dorit/primitives/Eyebrow";

const QA = faqByIds(HOME_COMMON_QUESTION_IDS);

export default function DetailedFAQ() {
  return (
    <section
      id="common-questions"
      className="relative py-24 md:py-32 border-t border-border/60 bg-secondary/40"
    >
      <div className="max-w-[1400px] mx-auto px-6 md:px-10 grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-16">
        <div className="lg:col-span-4">
          <Reveal>
            <Eyebrow>
              06 · שאלות ותשובות
            </Eyebrow>
            <h2 className="font-heading text-4xl md:text-5xl mt-5 leading-tight">
              שאלות
              <br />
              נפוצות
            </h2>
            <p className="mt-8 text-foreground/70 leading-relaxed max-w-sm">
              התשובות לשאלות שלקוחות שואלים אותי לעיתים קרובות — לפני פגישת
              הייעוץ הראשונה. אם לא מצאתם את התשובה שחיפשתם, נשמח לענות אישית.
            </p>
            <a
              href="#start"
              className="mt-8 inline-flex items-center px-6 py-3 bg-highlight text-primary font-medium hover:bg-highlight-strong transition-colors duration-300"
            >
              לשיחה קצרה עם דורית
            </a>
          </Reveal>
        </div>

        <div className="lg:col-span-8">
          <Accordion type="single" collapsible className="border-t border-border/60">
            {QA.map((item) => (
              <AccordionItem
                key={item.id}
                value={`cq-${item.id}`}
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
      </div>
    </section>
  );
}