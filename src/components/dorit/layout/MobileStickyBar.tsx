import React from "react";
import { Phone, MessageCircle } from "lucide-react";
import { CONTACT } from "@/config/contact";
import { useSectionNav } from "@/hooks/useSectionNav";
import { ctaClass } from "@/components/dorit/primitives/Cta";

/**
 * One 64px bar: a wide "לשיחה קצרה" to the conversation in `#start`, and beside
 * it WhatsApp and a call — a person on the other end of every one of them.
 *
 * It used to be four equal cells: WhatsApp, call, "השאירו פרטים" and support.
 * The short form now opens from the chip row under the questionnaire (one
 * scroll below the CTA this bar leads to), and support lives in the header
 * menu as "תמיכה — שאלה לעוזר", next to שאלות ותשובות — the place Dorit looked
 * for it (support-entry.spec.ts). `FloatingActions` is the desktop twin and
 * does not show below `md:`, so nothing else floats over a phone's page.
 *
 * "לשיחה קצרה" is a real `/#start` link, so the site-wide click listener
 * reports it as cta_click (location mobile_sticky_bar), and from another route
 * it goes home first. The page wrappers carry `pb-16` so the bar never covers
 * the last of the footer. E2E-MOB-009b holds every label to one line at 1× and
 * 1.3× text.
 */
const SIDE =
  "flex flex-col items-center justify-center gap-0.5 w-[72px] shrink-0 min-h-12 rounded-md text-[13px] leading-tight font-medium text-center";

export default function MobileStickyBar() {
  // The bar is on every route, `#start` only on the home page.
  const goToSection = useSectionNav();
  return (
    <div
      data-track-location="mobile_sticky_bar"
      className="md:hidden fixed bottom-0 inset-x-0 z-50 bg-background border-t border-border pb-[env(safe-area-inset-bottom)]"
    >
      {/* 63px + the 1px rule above it: the bar is 64px tall. */}
      <div className="h-[63px] flex items-center gap-2 px-3">
        <a
          href="/#start"
          onClick={(e) => goToSection(e, "#start")}
          className={ctaClass("flex-1 min-w-0 border-2 bg-highlight/[0.08] px-3 whitespace-nowrap")}
        >
          לשיחה קצרה
        </a>
        <a
          href={`https://wa.me/${CONTACT.whatsapp}?text=${encodeURIComponent(CONTACT.defaultWhatsappMessage)}`}
          target="_blank"
          rel="noopener noreferrer"
          className={`${SIDE} bg-whatsapp text-white`}
        >
          <MessageCircle size={18} aria-hidden="true" />
          וואטסאפ
        </a>
        <a href={`tel:${CONTACT.phoneE164}`} className={`${SIDE} bg-primary text-primary-foreground`}>
          <Phone size={18} aria-hidden="true" />
          חייגו
        </a>
      </div>
    </div>
  );
}
