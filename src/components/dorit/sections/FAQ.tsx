import React from "react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { faqTips } from "@/content/faq";
import Eyebrow from "@/components/dorit/primitives/Eyebrow";

const TIPS = faqTips();

export default function FAQ() {
  return (
    <section id="faq" className="relative py-24 md:py-32 border-t border-border/50">
      <div className="max-w-[1400px] mx-auto px-6 md:px-10 grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-16">
        <div className="lg:col-span-4">
          <Eyebrow>
            06 · בשפה פשוטה
          </Eyebrow>
          <h2 className="font-heading text-4xl md:text-5xl mt-5 leading-tight">
            שאלות
            <br />
            שכדאי לשאול
          </h2>
          <div className="mt-6 h-px w-16 bg-highlight-muted/60" />
          <p className="mt-8 text-foreground/70 leading-relaxed max-w-sm">
            שישה טיפים אפקטיביים מהשטח — כדי שתדעו מה כדאי לבדוק, לשאול ולתקן עוד
            השנה. רוצים ליישם אותם על התיק שלכם? נעשה את זה יחד.
          </p>
        </div>

        <div className="lg:col-span-8">
          <Accordion type="single" collapsible className="border-t border-border/50">
            {TIPS.map((item) => (
              <AccordionItem
                key={item.id}
                value={`faq-${item.id}`}
                className="border-b border-border/50"
              >
                <AccordionTrigger className="text-right text-lg md:text-xl font-heading py-6 hover:no-underline hover:text-accent transition-colors [&[data-state=open]>svg]:text-highlight-muted">
                  {`טיפ ${item.tip.n} · ${item.tip.title}`}
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