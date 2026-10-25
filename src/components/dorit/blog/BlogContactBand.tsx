import React from "react";
import { MessageCircle, Phone } from "lucide-react";
import { useAgencyContent } from "@/hooks/useAgencyContent";
import { ctaClass } from "@/components/dorit/primitives/Cta";

const WHATSAPP_TEXT = "שלום דורית, הגעתי מהבלוג";

const DARK_FOCUS =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-highlight-on-dark";

/** The step after reading: a person, on WhatsApp or the phone. */
export default function BlogContactBand() {
  const { contact } = useAgencyContent();
  return (
    <section
      aria-labelledby="blog-cta-title"
      data-track-location="blog_cta"
      className="bg-[hsl(222_47%_11%)] text-white dark:bg-[hsl(222_50%_5%)] border-b border-white/10"
    >
      <div className="max-w-[1400px] mx-auto px-6 md:px-10 py-16 md:py-20 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-8">
        <div>
          <h2 id="blog-cta-title" className="font-heading font-bold text-3xl md:text-4xl leading-tight">
            קראתם. רוצים שדורית תבדוק את זה אצלכם?
          </h2>
          <p className="mt-4 max-w-2xl text-lg leading-relaxed text-white/75">
            שיחה קצרה, בלי התחייבות. מגיעים עם השאלה — יוצאים עם רשימת צעדים.
          </p>
        </div>
        <div className="flex flex-col sm:flex-row gap-3 shrink-0">
          <a
            href={`https://wa.me/${contact.whatsapp}?text=${encodeURIComponent(WHATSAPP_TEXT)}`}
            target="_blank"
            rel="noopener noreferrer"
            className={`inline-flex items-center justify-center gap-2 min-h-12 px-[26px] rounded-xl bg-white text-[hsl(222_47%_11%)] font-heading font-semibold text-lg hover:bg-white/90 transition-colors ${DARK_FOCUS}`}
          >
            <MessageCircle size={20} aria-hidden="true" />
            כתבו לדורית בוואטסאפ
          </a>
          <a href={`tel:${contact.phoneE164}`} className={ctaClass(DARK_FOCUS, { onDark: true })}>
            <Phone size={20} aria-hidden="true" />
            חייגו <span dir="ltr">{contact.phoneDisplay}</span>
          </a>
        </div>
      </div>
    </section>
  );
}
