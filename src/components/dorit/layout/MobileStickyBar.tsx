import React from "react";
import { Phone, Calendar, LifeBuoy } from "lucide-react";
import { CONTACT } from "@/config/contact";
import SupportLink from "./SupportLink";

export default function MobileStickyBar() {
  return (
    <div data-track-location="mobile_sticky_bar" className="md:hidden fixed bottom-0 inset-x-0 z-50 bg-background border-t border-border">
      {/* The consultation keeps the widest cell: it is the one the page is for. */}
      <div className="grid grid-cols-[1fr_1.5fr_1fr]">
        <a
          href={`tel:${CONTACT.phoneE164}`}
          className="flex items-center justify-center gap-2 py-3.5 text-sm font-medium bg-primary text-primary-foreground"
        >
          <Phone size={18} />
          חייגו עכשיו
        </a>
        <a
          href="#start"
          className="flex items-center justify-center gap-2 py-3.5 text-sm font-medium bg-highlight text-primary"
        >
          <Calendar size={18} />
          לשיחה קצרה עם דורית
        </a>
        <SupportLink className="flex items-center justify-center gap-2 py-3.5 text-sm font-medium bg-card text-accent border-s border-border">
          <LifeBuoy size={18} aria-hidden="true" />
          תמיכה
        </SupportLink>
      </div>
    </div>
  );
}