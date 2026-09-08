import React from "react";
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
import Footer from "@/components/dorit/Footer";
import MobileStickyBar from "@/components/dorit/MobileStickyBar";

export default function Home() {
  return (
    <div className="relative bg-background pb-14 md:pb-0">
      <SecurityScroll />
      <FloatingHeader />
      <main>
        <Hero />
        <CarrierLogos />
        <About />
        <ReviewsWidget />
        <Perspective />
        <ServiceMatrix />
        <PensionFeeCalculator />
        <QuickContact />
        <ProofCarousel />
        <Testimonials />
        <FAQ />
        <ConsultationBuilder />
        <DetailedContactForm />
        <QuickShare />
        <DetailedFAQ />
      </main>
      <SectionNav />
      <MobileStickyBar />
      <Footer />
    </div>
  );
}