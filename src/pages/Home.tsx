import React from "react";
import { useSeo } from "@/lib/seo";
import { HOME_FAQ_LD } from "@/lib/structured-data";
import AgentChat from "@/components/dorit/chat/AgentChat";
import { AGENTS } from "@/config/agents";
import FloatingHeader from "@/components/dorit/layout/FloatingHeader";
import SecurityScroll from "@/components/dorit/layout/SecurityScroll";
import Hero from "@/components/dorit/sections/Hero";
import About from "@/components/dorit/sections/About";
import CarrierLogos from "@/components/dorit/primitives/CarrierLogos";
import ReviewsWidget from "@/components/dorit/sections/ReviewsWidget";
import Perspective from "@/components/dorit/sections/Perspective";
import ServiceMatrix from "@/components/dorit/sections/ServiceMatrix";
import InsuranceAssessment from "@/components/dorit/sections/InsuranceAssessment";
import ProofCarousel from "@/components/dorit/sections/ProofCarousel";
import Testimonials from "@/components/dorit/sections/Testimonials";
import FAQ from "@/components/dorit/sections/FAQ";
import ConsultationBuilder from "@/components/dorit/forms/ConsultationBuilder";
import DetailedContactForm from "@/components/dorit/forms/DetailedContactForm";
import PensionFeeCalculator from "@/components/dorit/sections/PensionFeeCalculator";
import QuickContact from "@/components/dorit/forms/QuickContact";
import QuickShare from "@/components/dorit/primitives/QuickShare";
import DetailedFAQ from "@/components/dorit/sections/DetailedFAQ";
import Footer from "@/components/dorit/layout/Footer";
import MobileStickyBar from "@/components/dorit/layout/MobileStickyBar";
import CredentialsStrip from "@/components/dorit/primitives/CredentialsStrip";

export default function Home() {
  useSeo({
    title: "דורית גוב ארי | ייעוץ ביטוחי ופיננסי — אדריכלות של ביטחון",
    description:
      "יועצת ביטוחית ופיננסית עם 30 שנות ניסיון. ייעוץ פנסיוני, ביטוח חיים ובריאות וליווי תביעות — אישי, שקוף ובגובה העיניים. מחשבון דמי ניהול חינם.",
    path: "/",
    // FAQPage markup belongs only where the questions are actually rendered.
    jsonLd: [HOME_FAQ_LD],
  });

  return (
    <div className="relative bg-background pb-14 md:pb-0">
      <SecurityScroll />
      <FloatingHeader />
      <main>
        <Hero />
        <CredentialsStrip />
        <CarrierLogos />
        <About />
        <ReviewsWidget />
        <Perspective />
        <ServiceMatrix />
        <InsuranceAssessment />
        <AgentChat descriptor={AGENTS.needsInterview} />
        <PensionFeeCalculator />
        <QuickContact />
        <ProofCarousel />
        <Testimonials />
        <FAQ />
        <AgentChat descriptor={AGENTS.bookingAssistant} />
        <ConsultationBuilder />
        <DetailedContactForm />
        <QuickShare />
        <AgentChat descriptor={AGENTS.blogRecommender} />
        <DetailedFAQ />
      </main>
      <MobileStickyBar />
      <Footer />
    </div>
  );
}