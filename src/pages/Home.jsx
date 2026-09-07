import React from "react";
import FloatingHeader from "@/components/dorit/FloatingHeader";
import SecurityScroll from "@/components/dorit/SecurityScroll";
import Hero from "@/components/dorit/Hero";
import About from "@/components/dorit/About";
import Perspective from "@/components/dorit/Perspective";
import ServiceMatrix from "@/components/dorit/ServiceMatrix";
import ProofCarousel from "@/components/dorit/ProofCarousel";
import Testimonials from "@/components/dorit/Testimonials";
import ConsultationBuilder from "@/components/dorit/ConsultationBuilder";
import QuickContact from "@/components/dorit/QuickContact";
import Footer from "@/components/dorit/Footer";

export default function Home() {
  return (
    <div className="relative bg-background">
      <SecurityScroll />
      <FloatingHeader />
      <main>
        <Hero />
        <About />
        <Perspective />
        <ServiceMatrix />
        <ProofCarousel />
        <Testimonials />
        <ConsultationBuilder />
        <QuickContact />
      </main>
      <Footer />
    </div>
  );
}