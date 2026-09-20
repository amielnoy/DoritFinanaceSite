import React from "react";
import { useSeo } from "@/lib/seo";
import FloatingHeader from "@/components/dorit/layout/FloatingHeader";
import SecurityScroll from "@/components/dorit/layout/SecurityScroll";
import Hero from "@/components/dorit/sections/Hero";
import About from "@/components/dorit/sections/About";
import CarrierLogos from "@/components/dorit/primitives/CarrierLogos";
import ServiceMatrix from "@/components/dorit/sections/ServiceMatrix";
import StartConversation from "@/components/dorit/sections/StartConversation";
import ProofCarousel from "@/components/dorit/sections/ProofCarousel";
import Testimonials from "@/components/dorit/sections/Testimonials";
import DetailedFAQ from "@/components/dorit/sections/DetailedFAQ";
import Footer from "@/components/dorit/layout/Footer";
import MobileStickyBar from "@/components/dorit/layout/MobileStickyBar";

/**
 * The home page, as one argument rather than a catalogue.
 *
 * It used to run seventeen sections and offer five separate ways to make
 * contact — an interview chat, a booking chat, a three-step wizard, a detailed
 * form and a short form — each asking for a name and a phone number, while the
 * header, the hero and the footer each pointed at a different one of them. Two
 * self-assessment tools, a reading recommender and a long essay sat between
 * them. A visitor who wanted to talk to דורית had to decide, repeatedly, which
 * door was the real one.
 *
 * What is left is the shape of a first meeting: who she is, what she does,
 * *start the conversation*, and then the evidence for anyone still deciding.
 * The tools moved to `/tools`, the essay to `/perspective`, the reading
 * recommender to the top of `/blog` — nothing was deleted except the duplicate
 * routes to the same conversation.
 */
export default function Home() {
  useSeo({
    title: "דורית גוב ארי | ייעוץ ביטוחי ופיננסי — אדריכלות של ביטחון",
    description:
      "יועצת ביטוחית ופיננסית עם 30 שנות ניסיון. ייעוץ פנסיוני, ביטוח חיים ובריאות וליווי תביעות — אישי, שקוף ובגובה העיניים. מחשבון דמי ניהול חינם.",
    path: "/",
    // No FAQPage block here. A `HOME_FAQ_LD` constant once carried six pension questions
    // that `/faq` renders in full — the home page never displayed them, it
    // displayed a list of tips — so the markup described content that was not
    // on the page, and duplicated the FAQPage `/faq` already declares. Google's
    // policy is that the answer must be visible on the URL that claims it; this
    // is the same defect as A-6, one section further along.
  });

  return (
    <div className="relative bg-background pb-14 md:pb-0">
      <SecurityScroll />
      <FloatingHeader />
      <main>
        <Hero />
        <CarrierLogos />
        <About variant="brief" />
        <ServiceMatrix />
        <StartConversation />
        <ProofCarousel />
        <Testimonials />
        <DetailedFAQ />
      </main>
      <MobileStickyBar />
      <Footer />
    </div>
  );
}
