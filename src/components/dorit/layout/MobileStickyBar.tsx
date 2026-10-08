import React from "react";
import { Phone, MessageCircle, Send } from "lucide-react";
import { CONTACT } from "@/config/contact";

/**
 * Each cell is a phone tab: icon above, label below, so the label gets the
 * whole width of its cell. With the icon beside the label (and the CTA's 26px
 * side padding on the middle cell), a longer label broke onto two lines
 * at default size and three at a phone's large-text setting. E2E-MOB-009b holds
 * every label to one line at 1× and 1.3×; past that a label wraps balanced
 * rather than overflowing its cell.
 */
const CELL = "flex flex-col items-center justify-center gap-1 min-h-14 px-1.5 py-2 text-[13px] leading-tight text-center [text-wrap:balance]";

/**
 * WhatsApp, call, leave details — a person on the other end of all three,
 * none of them the chat. `FloatingActions` is the desktop twin of the first
 * two; `#quick-contact` is the short name-and-phone form further down `#start`,
 * not the interview agent above it — a visitor who taps this did not ask for
 * four more screens of questions.
 *
 * The FAQ support chat lost its mobile-sticky-bar slot to make room for
 * WhatsApp. `FloatingActions` does not show it either (`hidden md:flex`), so
 * on a phone it is reachable only from the footer and from `/faq` itself —
 * worth a second look if that turns out to matter.
 */
export default function MobileStickyBar() {
  return (
    <div data-track-location="mobile_sticky_bar" className="md:hidden fixed bottom-0 inset-x-0 z-50 bg-background border-t border-border">
      <div className="grid grid-cols-3">
        <a
          href={`https://wa.me/${CONTACT.whatsapp}?text=${encodeURIComponent(CONTACT.defaultWhatsappMessage)}`}
          target="_blank"
          rel="noopener noreferrer"
          className={`${CELL} font-medium bg-whatsapp text-white`}
        >
          <MessageCircle size={18} aria-hidden="true" />
          וואטסאפ
        </a>
        <a
          href={`tel:${CONTACT.phoneE164}`}
          className={`${CELL} font-medium bg-primary text-primary-foreground`}
        >
          <Phone size={18} aria-hidden="true" />
          חייגו
        </a>
        <a
          href="#quick-contact"
          className={`${CELL} font-medium bg-card text-accent`}
        >
          <Send size={18} aria-hidden="true" />
          השאירו פרטים
        </a>
      </div>
    </div>
  );
}
