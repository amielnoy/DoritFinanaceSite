import React from "react";
import { Link } from "react-router-dom";
import { ChevronLeft, Minus, Plus } from "lucide-react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import Reveal from "@/components/dorit/primitives/Reveal";
import { HOME_COMMON_QUESTION_IDS, faqByIds, localizeFaq } from "@/content/faq";
import Eyebrow from "@/components/dorit/primitives/Eyebrow";
import { ctaClass } from "@/components/dorit/primitives/Cta";
import { MD_UP, useMediaQuery } from "@/hooks/useMediaQuery";
import { useLocale, useLocalePath, useT } from "@/i18n/LocaleContext";

const QA = faqByIds(HOME_COMMON_QUESTION_IDS);

/**
 * How many of the questions a phone shows; the rest are a tap away on /faq,
 * which has all of them. Hidden with CSS, not dropped, so the phone's document
 * still holds what the desktop's does.
 */
const PHONE_QUESTIONS = 4;


export default function DetailedFAQ() {
  const isDesktop = useMediaQuery(MD_UP, true);
  const t = useT("faq");
  const tc = useT("common");
  const locale = useLocale();
  const lp = useLocalePath();
  const INTRO = t("home.intro");
  const INTRO_MORE = t("home.introMore");
  return (
    <section
      id="common-questions"
      className="relative border-b border-border"
    >
      <div className="max-w-[1400px] mx-auto px-[clamp(20px,4vw,40px)] py-[clamp(72px,9vw,120px)] grid grid-cols-1 lg:grid-cols-3 gap-x-24 gap-y-12 items-start max-md:py-10 max-md:gap-y-6">
        <div>
          <Reveal>
            <Eyebrow>
              {t("home.eyebrow")}
            </Eyebrow>
            <h2 className="font-heading font-normal text-[clamp(34px,4vw,48px)] mt-[22px] leading-[1.12]">
              {t("home.title")}
            </h2>
            <p className="mt-[22px] max-md:mt-3 text-[17px] leading-[1.75] text-muted-foreground max-w-[380px]">
              {isDesktop ? (
                `${INTRO} ${INTRO_MORE}`
              ) : (
                // Below md, the first sentence: the offer to answer in person is
                // the sticky bar's "לשיחה קצרה", always in view. The second is
                // hidden, not dropped. Split into two runs only here: from md up
                // the paragraph stays one text node, because a run boundary
                // re-shapes the glyphs after it (as in About).
                <>
                  {INTRO}
                  <span className="hidden"> {INTRO_MORE}</span>
                </>
              )}
            </p>
          </Reveal>
        </div>

        <div className="lg:col-span-2 min-w-0">
          <Accordion type="single" collapsible className="border-t border-foreground">
            {QA.map((entry) => localizeFaq(entry, locale)).map((item, i) => (
              <AccordionItem
                key={item.id}
                value={`cq-${item.id}`}
                className={`border-b border-border${i >= PHONE_QUESTIONS ? " max-md:hidden" : ""}`}
              >
                <AccordionTrigger
                  className="group gap-5 text-start text-[clamp(20px,2vw,24px)] leading-[1.35] font-heading font-normal py-6 max-md:py-4 hover:no-underline hover:text-accent transition-colors duration-200"
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
          <Link
            to={lp("/faq")}
            className="md:hidden mt-5 inline-flex items-center gap-1.5 min-h-11 text-[17px] text-accent underline decoration-highlight/50 underline-offset-[6px] hover:decoration-highlight"
          >
            {t("home.all")}
            <ChevronLeft size={16} strokeWidth={1.5} aria-hidden="true" className="ltr:rotate-180" />
          </Link>
          {/* Hidden below md, not removed: the sticky bar's first cell is the
              same link to #start, always in view. From md up it is the section's
              close, and the site-wide click listener still reports it
              (cta_click, location common-questions). */}
          <a href="#start" className={ctaClass("mt-9 max-md:hidden")}>
            {tc("cta.shortCall")}
          </a>
        </div>
      </div>
    </section>
  );
}
