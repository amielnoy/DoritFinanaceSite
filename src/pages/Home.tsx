import React from "react";
import { useSeo } from "@/lib/seo";
import { HOME_FAQ_LD } from "@/lib/structured-data";
import FloatingHeader from "@/components/dorit/FloatingHeader";
import SectionNav from "@/components/dorit/SectionNav";
import SecurityScroll from "@/components/dorit/SecurityScroll";
import Hero from "@/components/dorit/Hero";
import About from "@/components/dorit/About";
import CarrierLogos from "@/components/dorit/CarrierLogos";
import ReviewsWidget from "@/components/dorit/ReviewsWidget";
import Perspective from "@/components/dorit/Perspective";
import ServiceMatrix from "@/components/dorit/ServiceMatrix";
import ProofCarousel from "@/components/dorit/ProofCarousel";
import Testimonials from "@/components/dorit/Testimonials";
import FAQ from "@/components/dorit/FAQ";
import ConsultationBuilder from "@/components/dorit/ConsultationBuilder";
import DetailedContactForm from "@/components/dorit/DetailedContactForm";
import PensionFeeCalculator from "@/components/dorit/PensionFeeCalculator";
import QuickContact from "@/components/dorit/QuickContact";
import QuickShare from "@/components/dorit/QuickShare";
import DetailedFAQ from "@/components/dorit/DetailedFAQ";
import NeedsInterviewChat from "@/components/dorit/NeedsInterviewChat";
import BookingAssistantChat from "@/components/dorit/BookingAssistantChat";
import BlogRecommenderChat from "@/components/dorit/BlogRecommenderChat";
import Footer from "@/components/dorit/Footer";
import MobileStickyBar from "@/components/dorit/MobileStickyBar";
import CredentialsStrip from "@/components/dorit/CredentialsStrip";

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
        <NeedsInterviewChat />
        <PensionFeeCalculator />
        <QuickContact />
        <ProofCarousel />
        <Testimonials />
        <FAQ />
        <BookingAssistantChat />
        <ConsultationBuilder />
        <DetailedContactForm />
        <QuickShare />
        <BlogRecommenderChat />
        <DetailedFAQ />
      </main>
      <SectionNav />
      <MobileStickyBar />
      <Footer />
    </div>
  );
}