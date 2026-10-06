import React from "react";
import { MessageCircle, Phone } from "lucide-react";
import AgentChat from "@/components/dorit/chat/AgentChat";
import QuickContact from "@/components/dorit/forms/QuickContact";
import { AGENTS } from "@/config/agents";
import { CONTACT } from "@/config/contact";
import Reveal from "@/components/dorit/primitives/Reveal";
import Eyebrow from "@/components/dorit/primitives/Eyebrow";

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
 * underneath for people who would rather not type into a chat at all. The
 * interview agent books the meeting itself now, which is what makes the single
 * path sufficient — see the scheduling step in `base44/agents/needs_interview.jsonc`.
 */
export default function StartConversation() {
  return (
    <section id="start" className="border-b border-border">
      <div className="max-w-[1400px] mx-auto px-[clamp(20px,4vw,40px)] py-[clamp(72px,9vw,120px)] flex flex-col gap-10">
        <Reveal>
          <Eyebrow>03 · ההקשבה</Eyebrow>
          <h2 className="font-heading font-normal text-[clamp(34px,4vw,48px)] mt-[18px] leading-[1.12] max-w-[880px] [text-wrap:balance]">
            נתחיל בשיחה קצרה — כדי שדורית תגיע מוכנה
          </h2>
        </Reveal>

        {/* The chat, at the width of the page. */}
        <AgentChat descriptor={AGENTS.needsInterview} embedded />

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

        {/* Two ways out of the chat, for a visitor who would rather not use it. */}
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,280px),1fr))] gap-4">
          <a
            href={`https://wa.me/${CONTACT.whatsapp}`}
            target="_blank"
            rel="noopener noreferrer"
            className={TILE}
          >
            <MessageCircle size={18} strokeWidth={1.5} className="text-accent shrink-0" aria-hidden="true" />
            עדיף לי בוואטסאפ
          </a>
          <a
            href={`tel:${CONTACT.phoneE164}`}
            className={TILE}
          >
            <Phone size={18} strokeWidth={1.5} className="text-accent shrink-0" aria-hidden="true" />
            עדיף לי בטלפון
          </a>
        </div>

        {/* And the short form: heading and form side by side, on the ground. */}
        <QuickContact embedded />
      </div>
    </section>
  );
}

const TILE =
  "flex items-center justify-center gap-3 min-h-16 rounded-md border border-border text-[17px] text-foreground hover:border-highlight hover:bg-highlight/5 transition-colors duration-200";
