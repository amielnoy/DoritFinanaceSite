import React from "react";
import { Phone, MessageCircle } from "lucide-react";
import { CONTACT } from "@/config/contact";

export default function FloatingActions() {
  return (
    <div className="hidden md:flex fixed bottom-4 z-50 flex-row gap-3 right-4 left-auto md:flex-col md:left-4 md:right-auto">
      <a
        href={`https://wa.me/${CONTACT.whatsapp}?text=${encodeURIComponent("שלום דורית, אשמח/ה לשמוע פרטים נוספים על ייעוץ ביטוחי ופיננסי.")}`}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="פתיחת שיחה בוואטסאפ"
        className="group w-14 h-14 rounded-full bg-[#25D366] text-white flex items-center justify-center shadow-lg hover:scale-105 transition-transform duration-300"
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
    </div>
  );
}