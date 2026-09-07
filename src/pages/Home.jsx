import React from "react";
import FloatingHeader from "@/components/dorit/FloatingHeader";
import SecurityScroll from "@/components/dorit/SecurityScroll";
import Hero from "@/components/dorit/Hero";
import BrandStatement from "@/components/dorit/BrandStatement";
import About from "@/components/dorit/About";
import ServiceMatrix from "@/components/dorit/ServiceMatrix";
import ProofCarousel from "@/components/dorit/ProofCarousel";
import ConsultationBuilder from "@/components/dorit/ConsultationBuilder";
import Footer from "@/components/dorit/Footer";

export default function Home() {
  return (
    <div className="relative bg-background">
      <SecurityScroll />
      <FloatingHeader />
      <main>
        <Hero />
        <BrandStatement />
        <About />
        <ServiceMatrix />
        <ProofCarousel />
        <ConsultationBuilder />
      </main>
      <Footer />
    </div>
  );
}