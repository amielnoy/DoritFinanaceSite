import React from "react";
import { Phone, MessageCircle, LifeBuoy } from "lucide-react";
import { CONTACT } from "@/config/contact";
import SupportLink from "./SupportLink";

export default function FloatingActions() {
  return (
    <div data-track-location="floating_dock" className="hidden md:flex fixed bottom-4 z-50 flex-row gap-3 right-4 left-auto md:flex-col md:left-4 md:right-auto">
      <a
        href={`https://wa.me/${CONTACT.whatsapp}?text=${encodeURIComponent("שלום דורית, אשמח/ה לשמוע פרטים נוספים על ייעוץ פיננסי וביטוחי.")}`}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="פתיחת שיחה בוואטסאפ"
        className="group w-14 h-14 rounded-full bg-whatsapp text-white flex items-center justify-center shadow-lg hover:scale-105 transition-transform duration-300"
      >
        <MessageCircle size={26} className="group-hover:rotate-6 transition-transform" />
      </a>
      <a
        href={`tel:${CONTACT.phoneE164}`}
        aria-label="התקשרות לדורית גוב ארי"
        className="group w-14 h-14 rounded-full bg-primary text-primary-foreground flex items-center justify-center shadow-lg hover:scale-105 transition-transform duration-300"
      >
        <Phone size={24} className="group-hover:rotate-6 transition-transform" />
      </a>
      {/* The support chat is at the bottom of /faq, and nothing pointed at it
          but the footer. This puts it with the other ways to reach her. */}
      <SupportLink
        aria-label="תמיכה — שאלה לעוזר של דורית"
        title="תמיכה — שאלה לעוזר של דורית"
        className="group w-14 h-14 rounded-full bg-card text-accent border border-accent/40 flex items-center justify-center shadow-lg hover:scale-105 transition-transform duration-300"
      >
        <LifeBuoy size={24} className="group-hover:rotate-6 transition-transform" />
      </SupportLink>
    </div>
  );
}