import React from "react";
import { Phone, MessageCircle, MessagesSquare, LifeBuoy } from "lucide-react";
import { CONTACT } from "@/config/contact";
import { useSectionNav } from "@/hooks/useSectionNav";
import SupportLink from "./SupportLink";
import { useLocalePath, useT } from "@/i18n/LocaleContext";

/**
 * One 64px bar of four phone tabs: "קביעת שיחה" to the conversation in
 * `#start`, WhatsApp, a call and "שאלה לעוזר" (the support chat). Until
 * 2026-10-14 they read "לשיחה קצרה" and "תמיכה" — "תמיכה" said nothing to
 * someone who is not a client yet (user feedback).
 *
 * It used to be WhatsApp, call, "השאירו פרטים" and support in 57px. The short
 * form now opens from the chip row under the questionnaire — one scroll below
 * the conversation this bar leads to — so its cell became "לשיחה קצרה".
 *
 * Support keeps its cell: `support-entry.spec.ts` exists because Dorit herself
 * once could not find the FAQ chat on her own phone (A-64), and
 * `FloatingActions`, the desktop twin, does not show below `md:`. The header
 * menu lists it too, as "תמיכה — שאלה לעוזר", beside שאלות ותשובות.
 *
 * Each cell is icon above label, so the label gets the whole width of its cell;
 * "קביעת שיחה" and "שאלה לעוזר", two words each, borrow width from the two one-word cells. E2E-MOB-009b holds every
 * label to one line at 1× and 1.3× text, at 390 and at 360. "קביעת שיחה" is a
 * real `/#start` link, so the site-wide click listener reports it as cta_click
 * (location mobile_sticky_bar), and from another route it goes home first. The
 * page wrappers carry `pb-16` plus the safe area, so the bar never covers the
 * last of the footer.
 */
const CELL =
  "flex flex-col items-center justify-center gap-0.5 min-w-0 min-h-[52px] px-0.5 rounded-md text-[13px] leading-tight font-medium text-center [text-wrap:balance]";

export default function MobileStickyBar() {
  // The bar is on every route, `#start` only on the home page.
  const goToSection = useSectionNav();
  const t = useT("common");
  const lp = useLocalePath();
  return (
    <div
      data-track-location="mobile_sticky_bar"
      className="md:hidden fixed bottom-0 inset-x-0 z-50 bg-background border-t border-border pb-[env(safe-area-inset-bottom)]"
    >
      {/* 63px + the 1px rule above it: the bar is 64px tall. */}
      <div className="h-[63px] grid grid-cols-[1.35fr_0.85fr_0.85fr_1.35fr] items-center gap-1 px-1.5">
        <a
          href={lp("/#start")}
          onClick={(e) => goToSection(e, "#start")}
          className={`${CELL} border-2 border-highlight bg-highlight/[0.08] text-accent`}
        >
          <MessagesSquare size={18} aria-hidden="true" />
          {t("sticky.book")}
        </a>
        <a
          href={`https://wa.me/${CONTACT.whatsapp}?text=${encodeURIComponent(t("contact.whatsappDefault"))}`}
          target="_blank"
          rel="noopener noreferrer"
          className={`${CELL} bg-whatsapp text-white`}
        >
          <MessageCircle size={18} aria-hidden="true" />
          {t("sticky.whatsapp")}
        </a>
        <a href={`tel:${CONTACT.phoneE164}`} className={`${CELL} bg-primary text-primary-foreground`}>
          <Phone size={18} aria-hidden="true" />
          {t("sticky.call")}
        </a>
        <SupportLink className={`${CELL} border border-border bg-card text-accent`}>
          <LifeBuoy size={18} aria-hidden="true" />
          {t("sticky.ask")}
        </SupportLink>
      </div>
    </div>
  );
}
