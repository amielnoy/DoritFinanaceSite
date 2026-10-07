import React from "react";
import { ctaClass } from "@/components/dorit/primitives/Cta";
import { Phone, Calendar, LifeBuoy } from "lucide-react";
import { CONTACT } from "@/config/contact";
import SupportLink from "./SupportLink";

/**
 * Each cell is a phone tab: icon above, label below, so the label gets the
 * whole width of its cell. With the icon beside the label (and the CTA's 26px
 * side padding on the middle cell), "לשיחה קצרה עם דורית" broke onto two lines
 * at default size and three at a phone's large-text setting. E2E-MOB-009b holds
 * every label to one line at 1× and 1.3×; past that a label wraps balanced
 * rather than overflowing its cell.
 */
const CELL = "flex flex-col items-center justify-center gap-1 min-h-14 px-1.5 py-2 text-[13px] leading-tight text-center [text-wrap:balance]";

export default function MobileStickyBar() {
  return (
    <div data-track-location="mobile_sticky_bar" className="md:hidden fixed bottom-0 inset-x-0 z-50 bg-background border-t border-border">
      {/* The consultation keeps the widest cell: it is the one the page is for. */}
      <div className="grid grid-cols-[1fr_1.5fr_1fr]">
        <a
          href={`tel:${CONTACT.phoneE164}`}
          className={`${CELL} font-medium bg-primary text-primary-foreground`}
        >
          <Phone size={18} aria-hidden="true" />
          חייגו עכשיו
        </a>
        <a
          href="#start"
          className={ctaClass(`${CELL} rounded-none`)}
        >
          <Calendar size={18} aria-hidden="true" />
          לשיחה קצרה עם דורית
        </a>
        <SupportLink className={`${CELL} font-medium bg-card text-accent`}>
          <LifeBuoy size={18} aria-hidden="true" />
          תמיכה
        </SupportLink>
      </div>
    </div>
  );
}
