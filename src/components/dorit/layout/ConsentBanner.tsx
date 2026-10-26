import React, { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { ctaClass } from "@/components/dorit/primitives/Cta";
import { isUnmeasuredPath } from "@/lib/analytics";
import { CONSENT_REOPEN_EVENT, GA_CONSENT, declineConsent, grantConsent, readConsent } from "@/lib/consent";

// DRAFT for Dorit's compliance adviser (docs/COMPLIANCE.md §8), with the privacy policy's line.
export const CONSENT_TITLE = "סטטיסטיקה אנונימית";

/**
 * The question before Google Analytics, behind VITE_GA_CONSENT (src/lib/consent.ts).
 * The card chosen in Sneak Peek (dorit-finance › consent › Card): above the
 * phone's sticky contact bar, bottom-right on desktop, clear of the floating
 * dock on the left. "לא, תודה" has the same size and weight as "אישור", and the
 * site works the same either way. Not shown on /admin, which is never measured.
 */
export default function ConsentBanner({ enabled = GA_CONSENT }: { enabled?: boolean }) {
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    setOpen(readConsent() === null);
    const reopen = () => setOpen(true);
    window.addEventListener(CONSENT_REOPEN_EVENT, reopen);
    return () => window.removeEventListener(CONSENT_REOPEN_EVENT, reopen);
  }, [enabled]);

  if (!enabled || !open || isUnmeasuredPath(pathname)) return null;

  const choose = (yes: boolean) => {
    if (yes) grantConsent();
    else declineConsent();
    setOpen(false);
  };
  const button = (muted: boolean) => ctaClass("flex-1 md:flex-none whitespace-nowrap", { muted });

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-labelledby="ga-consent-title"
      className="fixed z-[60] inset-x-3 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] md:inset-x-auto md:right-6 md:bottom-6 md:w-[380px] rounded-2xl border border-border bg-card p-5 shadow-xl"
    >
      <p id="ga-consent-title" className="m-0 font-heading text-lg font-semibold text-foreground">
        {CONSENT_TITLE}
      </p>
      <p className="m-0 mt-2 text-[15px] leading-relaxed text-muted-foreground">
        כדי להבין באילו עמודים מבקרים ומה עוזר, האתר יכול להשתמש ב־<bdi dir="ltr">Google Analytics</bdi>, בלי שם, טלפון או
        מייל. אפשר לאשר או לסרב, והאתר יעבוד בדיוק אותו דבר.
      </p>
      <div className="mt-4 flex gap-2">
        <button type="button" className={button(false)} onClick={() => choose(true)}>
          אישור
        </button>
        <button type="button" className={button(true)} onClick={() => choose(false)}>
          לא, תודה
        </button>
      </div>
      <div className="mt-3">
        <Link to="/privacy" className="text-sm text-highlight-ink underline underline-offset-4">
          מדיניות הפרטיות
        </Link>
      </div>
    </div>
  );
}
