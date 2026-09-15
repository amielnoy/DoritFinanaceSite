import React from "react";
import FloatingHeader from "@/components/dorit/layout/FloatingHeader";
import Footer from "@/components/dorit/layout/Footer";
import PerspectiveSection from "@/components/dorit/sections/Perspective";
import About from "@/components/dorit/sections/About";
import { SITE_NAME, breadcrumbLd, useSeo } from "@/lib/seo";

/**
 * Her view of the work, and the long version of who she is.
 *
 * The essay ran third on the home page, above the services — a considered piece
 * of writing placed where most readers were still deciding whether to stay. It
 * reads better as somewhere a reader chose to go, and it pairs naturally with
 * the full biography that the home page's About no longer carries.
 */
export default function Perspective() {
  useSeo({
    title: `נקודת מבט | ${SITE_NAME}`,
    description:
      "איך נראה תכנון פיננסי כשהוא נעשה נכון — נקודת המבט של דורית גוב ארי על פנסיה, מיסוי וביטוח, ועל מה שקורה כשמחליטים בלי לראות את התמונה המלאה.",
    path: "/perspective",
    jsonLd: [
      breadcrumbLd([
        { name: "דף הבית", path: "/" },
        { name: "נקודת מבט", path: "/perspective" },
      ]),
    ],
  });

  return (
    <div className="relative bg-background pb-14 md:pb-0">
      <FloatingHeader />
      <main className="pt-24 md:pt-28">
        <PerspectiveSection />
        <About />
      </main>
      <Footer />
    </div>
  );
}
