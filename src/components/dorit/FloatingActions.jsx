import React from "react";
import { Phone, MessageCircle } from "lucide-react";

// החלפ/י במספר האמיתי בשני המקומות (ללא 0 מוביל, עם קידומת 972)
const PHONE = "+972508311776";
const WHATSAPP = "972508311776";

export default function FloatingActions() {
  return (
    <div className="fixed left-4 bottom-4 z-50 flex flex-col gap-3">
      <a
        href={`https://wa.me/${WHATSAPP}?text=${encodeURIComponent("שלום דורית, אשמח/ה לשמוע פרטים נוספים על ייעוץ ביטוחי ופיננסי.")}`}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="פתיחת שיחה בוואטסאפ"
        className="group w-14 h-14 rounded-full bg-[#25D366] text-white flex items-center justify-center shadow-lg hover:scale-105 transition-transform duration-300"
      >
        <MessageCircle size={26} className="group-hover:rotate-6 transition-transform" />
      </a>
      <a
        href={`https://wa.me/${WHATSAPP}?text=${encodeURIComponent("שלום דורית, אשמח/ה לשוחח על ייעוץ ביטוחי ופיננסי.")}`}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="שיחת וואטסאפ"
        className="group w-14 h-14 rounded-full bg-primary text-primary-foreground flex items-center justify-center shadow-lg hover:scale-105 transition-transform duration-300"
      >
        <Phone size={24} />
      </a>
    </div>
  );
}