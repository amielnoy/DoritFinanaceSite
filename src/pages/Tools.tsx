import React from "react";
import FloatingHeader from "@/components/dorit/layout/FloatingHeader";
import Footer from "@/components/dorit/layout/Footer";
import InsuranceAssessment from "@/components/dorit/sections/InsuranceAssessment";
import PensionFeeCalculator from "@/components/dorit/sections/PensionFeeCalculator";
import Reveal from "@/components/dorit/primitives/Reveal";
import { SITE_NAME, breadcrumbLd, useSeo } from "@/lib/seo";

/**
 * The two self-assessment tools, off the home page.
 *
 * Both are worth having and neither belongs between a visitor and the sentence
 * "let's talk". They ask a reader to do work — answer a questionnaire, model a
 * fee — at the point in the page where they had just decided to make contact,
 * and a tool is a very effective way to lose someone who was ready.
 *
 * Here they are the reason for the visit rather than an interruption to it.
 */
export default function Tools() {
  useSeo({
    title: `כלים לבדיקה עצמית | ${SITE_NAME}`,
    description:
      "שני כלים חינמיים לבדיקה עצמית: הערכת כיסוי ביטוחי במספר שאלות קצרות, ומחשבון שמראה כמה דמי הניהול שלכם עולים לאורך שנות החיסכון. ללא הרשמה וללא התחייבות.",
    path: "/tools",
    jsonLd: [
      breadcrumbLd([
        { name: "דף הבית", path: "/" },
        { name: "כלים לבדיקה עצמית", path: "/tools" },
      ]),
    ],
  });

  return (
    <div className="relative bg-background pb-14 md:pb-0">
      <FloatingHeader />
      <main>
        <section className="pt-40 pb-16 md:pt-48 md:pb-20 border-b border-border/50">
          <div className="max-w-[1400px] mx-auto px-6 md:px-10">
            <Reveal>
              <span className="text-[11px] tracking-[0.12em] text-accent">כלים</span>
              <h1 className="font-heading text-5xl md:text-7xl mt-5 leading-tight max-w-4xl">
                כלים לבדיקה עצמית
              </h1>
              <p className="mt-8 text-foreground/70 max-w-2xl leading-relaxed">
                שני כלים שאפשר להריץ לבד, בלי להשאיר פרטים ובלי התחייבות. הם
                מראים תמונה כללית ואינם תחליף לבדיקה אישית — את זו עושים בפגישה.
              </p>
            </Reveal>
          </div>
        </section>
        <InsuranceAssessment />
        <PensionFeeCalculator />
      </main>
      <Footer />
    </div>
  );
}
