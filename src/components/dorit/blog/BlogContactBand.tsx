import React from "react";
import { MessageCircle, Phone } from "lucide-react";
import { CONTACT } from "@/config/contact";
import { ctaClass } from "@/components/dorit/primitives/Cta";

const WHATSAPP_TEXT = "שלום דורית, הגעתי מהבלוג";

const DARK_FOCUS =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-highlight-on-dark";

/** The step after reading: a person, on WhatsApp or the phone. */
export default function BlogContactBand() {
  return (
    <section
      aria-labelledby="blog-cta-title"
      data-track-location="blog_cta"
      className="bg-primary text-primary-foreground border-b border-primary-foreground/[0.14]"
    >
      <div className="max-w-[1400px] mx-auto px-6 md:px-10 py-16 md:py-20">
        <h2 id="blog-cta-title" className="font-heading text-3xl md:text-4xl leading-tight">
          קראתם. רוצים שדורית תבדוק את זה אצלכם?
        </h2>
        <p className="mt-4 max-w-2xl text-lg leading-relaxed">
          שיחה קצרה, בלי התחייבות. מגיעים עם השאלה — יוצאים עם רשימת צעדים.
        </p>
        <div className="mt-8 flex flex-col sm:flex-row gap-3">
          <a
            href={`https://wa.me/${CONTACT.whatsapp}?text=${encodeURIComponent(WHATSAPP_TEXT)}`}
            target="_blank"
            rel="noopener noreferrer"
            className={`inline-flex items-center justify-center gap-2 min-h-12 px-[26px] rounded-md bg-highlight-on-dark text-primary font-heading font-medium text-lg hover:bg-highlight-on-dark/90 transition-colors ${DARK_FOCUS}`}
          >
            <MessageCircle size={20} aria-hidden="true" />
            כתבו לדורית בוואטסאפ
          </a>
          <a href={`tel:${CONTACT.phoneE164}`} className={ctaClass(DARK_FOCUS, { onDark: true })}>
            <Phone size={20} aria-hidden="true" />
            חייגו <span dir="ltr">{CONTACT.phoneDisplay}</span>
          </a>
        </div>
      </div>
    </section>
  );
}
