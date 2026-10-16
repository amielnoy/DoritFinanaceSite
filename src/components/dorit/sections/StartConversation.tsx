import React, { lazy, Suspense, useEffect, useRef, useState } from "react";
import { CalendarDays, MessageCircle, MessagesSquare, Phone, Send } from "lucide-react";
import NeedsWizard from "@/components/dorit/forms/NeedsWizard";
import QuickContact from "@/components/dorit/forms/QuickContact";
import { AGENTS } from "@/config/agents";
import { CONTACT } from "@/config/contact";
import { CAL_LINK } from "@/config/offers";
import { ctaClass } from "@/components/dorit/primitives/Cta";
import Reveal from "@/components/dorit/primitives/Reveal";
import Eyebrow from "@/components/dorit/primitives/Eyebrow";
import { useLocale, useT } from "@/i18n/LocaleContext";

/*
 * The chat opens only when the visitor asks for it, so it — and react-markdown
 * with it — loads then, not with the home page (review 2026-10-15).
 */
const AgentChat = lazy(() => import("@/components/dorit/chat/AgentChat"));

/**
 * The one place on the home page where a visitor makes contact.
 *
 * There used to be five: an interview chat, a booking chat, a three-step
 * consultation wizard, a detailed form and a short form — each with its own
 * heading, each asking for a name and a phone number, and every call to action
 * in the header, hero and footer pointing at a different one of them. A page
 * that offers five ways to do one thing is not offering choice; it is asking
 * the visitor to decide which door is the real one.
 *
 * So: one section, one primary path, and the alternatives stated plainly
 * underneath. The primary path is now the needs wizard — the interview's fields
 * as choices, about two minutes, booking the meeting at the end. The interview
 * chat stays one link away for anyone who would rather write than tap.
 */
export default function StartConversation() {
  const [chatOpen, setChatOpen] = useState<boolean>(false);
  // Below md the short form waits behind "השארת פרטים" in the chip row; from
  // md up it is always open, as it was. A link to `#quick-contact` opens it.
  const [formOpen, setFormOpen] = useState<boolean>(false);
  const chatRef = useRef<HTMLDivElement>(null);
  const t = useT("home");
  const he = useLocale() === "he";

  useEffect(() => {
    const openOnHash = () => {
      if (window.location.hash === "#quick-contact") setFormOpen(true);
    };
    openOnHash();
    window.addEventListener("hashchange", openOnHash);
    return () => window.removeEventListener("hashchange", openOnHash);
  }, []);

  // Opened below the link, the chat would start under the fold, with only its
  // first line showing. Bring it into view — without the glide for anyone who
  // asked the system for less motion.
  useEffect(() => {
    if (!chatOpen) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    chatRef.current?.scrollIntoView?.({ block: "start", behavior: reduce ? "auto" : "smooth" });
  }, [chatOpen]);

  return (
    <section id="start" className="border-b border-border">
      {/* `md:pl-20`: `FloatingActions` is a fixed dock at `left-4` (desktop only),
          and without this reserved clearance its top button clips the chat
          panel's own left border at common desktop widths — worse the
          narrower the viewport, since centering stops adding its own margin
          below the 1400px breakpoint. */}
      <div className="max-w-[1400px] mx-auto px-[clamp(20px,4vw,40px)] md:pl-20 py-[clamp(72px,9vw,120px)] flex flex-col gap-10 max-md:py-10">
        <Reveal>
          <Eyebrow>{t("start.eyebrow")}</Eyebrow>
          <h2 className="font-heading font-normal text-[clamp(34px,4vw,48px)] mt-[18px] leading-[1.12] max-w-[880px] [text-wrap:balance]">
            {t("start.title")}
          </h2>
        </Reveal>

        {/* A 15-minute phone call on Dorit's diary, first, once VITE_CAL_LINK is
            set (growth brief, 2026-10-14); the questionnaire below becomes the
            second path. Unset, the section is as it was. */}
        {CAL_LINK ? (
          <div data-track-location="start_booking" className="max-w-[880px] w-full rounded-[4px] border border-highlight p-5 md:p-6 flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="m-0 font-heading text-xl md:text-2xl">{t("start.calTitle")}</p>
              <p className="m-0 mt-1 text-[15px] text-muted-foreground">{t("start.calText")}</p>
            </div>
            <a href={CAL_LINK} target="_blank" rel="noopener noreferrer" className={ctaClass("max-sm:w-full")}>
              <CalendarDays size={18} aria-hidden="true" /> {t("start.calButton")}
            </a>
          </div>
        ) : null}

        {/* The wizard, where the interview chat used to be. `#interview` keeps
            the interview's anchor alive; `#start`, above, is what the CTAs use. */}
        {he ? (
        <div id="interview" className="max-w-[880px] w-full">
          {CAL_LINK ? <p className="m-0 mb-4 text-[15px] text-muted-foreground">או, אם נוח יותר — שלוש שאלות קצרות, ודורית חוזרת אליכם:</p> : null}
          <NeedsWizard />
          <p className="m-0 mt-6 text-[15px] leading-[1.7] text-muted-foreground">
            השאלון אוסף מידע לקראת הפגישה ואינו נותן ייעוץ.
          </p>
          <button
            type="button"
            onClick={() => setChatOpen((v) => !v)}
            aria-expanded={chatOpen}
            aria-controls="interview-chat"
            className="mt-3 min-h-11 inline-flex items-center text-[15px] text-accent underline decoration-highlight/50 underline-offset-4 hover:decoration-highlight max-md:hidden"
          >
            מעדיפ/ה לכתוב במקום ללחוץ? לשיחה עם העוזר
          </button>

          {/* Below md: every other way in, as one row of chips instead of two
              tiles, a link and a form standing open under the questionnaire.
              WhatsApp and the phone are the tiles' own links, so click_whatsapp
              and click_phone still report location "start"; צ'אט is the same
              toggle as the link above, and השארת פרטים opens the form in place. */}
          <div className="md:hidden mt-5 flex flex-col gap-2.5">
            <p id="start-alternatives" className="m-0 text-[15px] text-muted-foreground">מעדיפים אחרת?</p>
            <ul aria-labelledby="start-alternatives" className="m-0 p-0 list-none flex flex-wrap gap-2">
              <li>
                <a href={`https://wa.me/${CONTACT.whatsapp}`} target="_blank" rel="noopener noreferrer" className={CHIP}>
                  <MessageCircle size={16} strokeWidth={1.5} className="text-accent shrink-0" aria-hidden="true" />
                  וואטסאפ
                </a>
              </li>
              <li>
                <a href={`tel:${CONTACT.phoneE164}`} className={CHIP}>
                  <Phone size={16} strokeWidth={1.5} className="text-accent shrink-0" aria-hidden="true" />
                  טלפון
                </a>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => setFormOpen((v) => !v)}
                  aria-expanded={formOpen}
                  aria-controls="quick-contact"
                  className={CHIP}
                >
                  <Send size={16} strokeWidth={1.5} className="text-accent shrink-0" aria-hidden="true" />
                  השארת פרטים
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => setChatOpen((v) => !v)}
                  aria-expanded={chatOpen}
                  aria-controls="interview-chat"
                  className={CHIP}
                >
                  <MessagesSquare size={16} strokeWidth={1.5} className="text-accent shrink-0" aria-hidden="true" />
                  צ'אט
                </button>
              </li>
            </ul>
          </div>
        </div>
        ) : (
          // English and French: the wizard and the chat speak Hebrew (their answers
          // are Hebrew values Dorit reads), so the short form below leads instead.
          <p className="m-0 max-w-[880px] text-[17px] leading-[1.7] text-foreground/80">{t("start.formFirst")}</p>
        )}

        {/* The chat, for anyone who would rather write — with its fence and
            disclaimer, which describe the agent and so travel with it. */}
        {he && chatOpen ? (
          <div id="interview-chat" ref={chatRef} className="flex flex-col gap-10 scroll-mt-28">
            <Suspense fallback={<div className="min-h-[420px]" aria-busy="true" />}>
              <AgentChat descriptor={AGENTS.needsInterview} embedded />
            </Suspense>
            {/* The fence, published beside the chat.
                It used to render in AgentChat's heading column, which the embedded
                layout does not draw — and the boundary a visitor can read is half of
                honouring it. Same markup, moved rather than dropped. */}
            <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,340px),1fr))] gap-8">
              <p className="m-0 border-r border-highlight pr-[18px] font-heading text-[21px] leading-[1.6]">
                {AGENTS.needsInterview.tagline}
              </p>
              {AGENTS.needsInterview.guardrails ? (
                <div className="border-t border-border pt-[18px]">
                  <p className="text-sm text-accent">כללי הגדר</p>
                  <dl className="mt-4 grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-5 text-[15px] leading-[1.7]">
                    <div className="flex flex-col gap-1.5">
                      <dt className="text-sm text-accent">מה הוא עושה</dt>
                      <dd className="text-foreground/80">
                        {AGENTS.needsInterview.guardrails.allowed.join(" · ")}
                      </dd>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <dt className="text-sm text-accent">מה הוא לא עושה</dt>
                      <dd className="text-foreground/80">
                        {AGENTS.needsInterview.guardrails.forbidden.join(" · ")}
                      </dd>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <dt className="text-sm text-accent">מתי עובר לאדם</dt>
                      <dd className="text-foreground/80">
                        {AGENTS.needsInterview.guardrails.handoff}
                      </dd>
                    </div>
                  </dl>
                </div>
              ) : null}
            </div>

            <p className="m-0 max-w-[760px] text-[15px] leading-[1.7] text-muted-foreground">
              הסוכן אוסף מידע לקראת הפגישה ואינו נותן ייעוץ. הפרטים נשמרים אצל דורית
              ואצל הצוות שמתפעל את האתר מטעמה.
            </p>
          </div>
        ) : null}

        {/* Two ways out of the chat, for a visitor who would rather not use it. */}
        <div className={`grid grid-cols-[repeat(auto-fit,minmax(min(100%,280px),1fr))] gap-4${he ? " max-md:hidden" : ""}`}>
          <a
            href={`https://wa.me/${CONTACT.whatsapp}`}
            target="_blank"
            rel="noopener noreferrer"
            className={TILE}
          >
            <MessageCircle size={18} strokeWidth={1.5} className="text-accent shrink-0" aria-hidden="true" />
            {t("start.preferWhatsapp")}
          </a>
          <a
            href={`tel:${CONTACT.phoneE164}`}
            className={TILE}
          >
            <Phone size={18} strokeWidth={1.5} className="text-accent shrink-0" aria-hidden="true" />
            {t("start.preferPhone")}
          </a>
        </div>

        {/* And the short form: heading and form side by side, on the ground.
            Below md it stays in the page (and in the document) but hidden until
            the chip above opens it. */}
        <QuickContact embedded className={!he || formOpen ? undefined : "max-md:hidden"} />
      </div>
    </section>
  );
}

const CHIP =
  "inline-flex items-center gap-2 min-h-11 px-4 rounded-full border border-border text-[16px] text-foreground hover:border-highlight hover:bg-highlight/5 aria-expanded:border-highlight aria-expanded:bg-highlight/10 transition-colors duration-200";

const TILE =
  "flex items-center justify-center gap-3 min-h-16 rounded-md border border-border text-[17px] text-foreground hover:border-highlight hover:bg-highlight/5 transition-colors duration-200";
