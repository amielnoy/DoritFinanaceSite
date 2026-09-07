import React from "react";
import { Phone, Calendar } from "lucide-react";
import { CONTACT } from "@/config/contact";

export default function MobileStickyBar() {
  return (
    <div className="md:hidden fixed bottom-0 inset-x-0 z-50 bg-background border-t border-border">
      <div className="grid grid-cols-2">
        <a
          href={`tel:${CONTACT.phoneE164}`}
          className="flex items-center justify-center gap-2 py-3.5 text-sm font-medium bg-primary text-primary-foreground"
        >
          <Phone size={18} />
          חייגו עכשיו
        </a>
        <a
          href="#consultation"
          className="flex items-center justify-center gap-2 py-3.5 text-sm font-medium bg-[#C4A484] text-primary"
        >
          <Calendar size={18} />
          קביעת ייעוץ
        </a>
      </div>
    </div>
  );
}