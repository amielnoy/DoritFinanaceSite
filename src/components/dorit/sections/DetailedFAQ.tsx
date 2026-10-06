import React from "react";
import { Minus, Plus } from "lucide-react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import Reveal from "@/components/dorit/primitives/Reveal";
import { HOME_COMMON_QUESTION_IDS, faqByIds } from "@/content/faq";
import Eyebrow from "@/components/dorit/primitives/Eyebrow";
import { ctaClass } from "@/components/dorit/primitives/Cta";

const QA = faqByIds(HOME_COMMON_QUESTION_IDS);

export default function DetailedFAQ() {
  return (
    <section
      id="common-questions"
      className="relative border-b border-border"
    >
      <div className="max-w-[1400px] mx-auto px-[clamp(20px,4vw,40px)] py-[clamp(72px,9vw,120px)] grid grid-cols-1 lg:grid-cols-3 gap-x-24 gap-y-12 items-start">
        <div>
          <Reveal>
            <Eyebrow>
              06 · שאלות ותשובות
            </Eyebrow>
            <h2 className="font-heading font-normal text-[clamp(34px,4vw,48px)] mt-[22px] leading-[1.12]">
              שאלות
              <br />
              נפוצות
            </h2>
            <p className="mt-[22px] text-lg leading-[1.75] text-muted-foreground max-w-[380px]">
              התשובות לשאלות שלקוחות שואלים אותי לעיתים קרובות — לפני פגישת
              הראשונה. אם לא מצאתם את התשובה שחיפשתם, נשמח לענות אישית.
            </p>
            <a
              href="#start"
              className={ctaClass("mt-[22px]")}
            >
              לשיחה קצרה עם דורית
            </a>
          </Reveal>
        </div>

        <div className="lg:col-span-2 min-w-0">
          <Accordion type="single" collapsible className="border-t border-foreground">
            {QA.map((item) => (
              <AccordionItem
                key={item.id}
                value={`cq-${item.id}`}
                className="border-b border-border"
              >
                <AccordionTrigger
                  className="group gap-5 text-right text-[clamp(20px,2vw,24px)] leading-[1.35] font-heading font-normal py-6 hover:no-underline hover:text-accent transition-colors duration-200"
                  icon={
                    <span
                      aria-hidden="true"
                      className="shrink-0 w-8 h-8 flex items-center justify-center rounded-full border border-highlight text-accent"
                    >
                      <Plus size={16} strokeWidth={1.5} className="group-data-[state=open]:hidden" />
                      <Minus size={16} strokeWidth={1.5} className="hidden group-data-[state=open]:block" />
                    </span>
                  }
                >
                  {item.q}
                </AccordionTrigger>
                <AccordionContent className="max-w-[680px] text-foreground/80 leading-[1.8] text-lg pb-7">
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
