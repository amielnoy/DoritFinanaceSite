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
    <section id="start" className="py-24 md:py-32 border-t border-border/60">
      <div className="max-w-[1400px] mx-auto px-6 md:px-10">
        <Reveal>
          <Eyebrow>03 · ההקשבה</Eyebrow>
          <h2 className="font-heading text-4xl md:text-6xl mt-5 leading-tight max-w-4xl">
            נתחיל בשיחה קצרה — כדי שדורית תגיע מוכנה
          </h2>
        </Reveal>

        {/* The chat, at the width of the page. */}
        <div className="mt-12">
          <AgentChat descriptor={AGENTS.needsInterview} embedded />
        </div>

        {/* The fence, published beside the chat.
            It used to render in AgentChat's heading column, which the embedded
            layout does not draw — and the boundary a visitor can read is half of
            honouring it. Same markup, moved rather than dropped. */}
        <div className="mt-8 grid grid-cols-1 lg:grid-cols-12 gap-8">
          <p className="lg:col-span-5 border-r-2 border-accent pr-4 font-heading text-[17px] leading-relaxed text-foreground/85">
            {AGENTS.needsInterview.tagline}
          </p>
          {AGENTS.needsInterview.guardrails ? (
            <div className="lg:col-span-7 border border-border/60 bg-secondary/30 px-5 py-5">
              <p className="text-[11px] tracking-[0.12em] text-accent">כללי הגדר</p>
              <dl className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-4 text-[13.5px] leading-relaxed">
                <div>
                  <dt className="text-foreground/50">מה הוא עושה</dt>
                  <dd className="text-foreground/80">
                    {AGENTS.needsInterview.guardrails.allowed.join(" · ")}
                  </dd>
                </div>
                <div>
                  <dt className="text-foreground/50">מה הוא לא עושה</dt>
                  <dd className="text-foreground/80">
                    {AGENTS.needsInterview.guardrails.forbidden.join(" · ")}
                  </dd>
                </div>
                <div>
                  <dt className="text-foreground/50">מתי עובר לאדם</dt>
                  <dd className="text-foreground/80">
                    {AGENTS.needsInterview.guardrails.handoff}
                  </dd>
                </div>
              </dl>
            </div>
          ) : null}
        </div>

        <p className="mt-8 text-[13px] leading-relaxed text-muted-foreground max-w-3xl">
          הסוכן אוסף מידע לקראת הפגישה ואינו נותן ייעוץ. הפרטים נשמרים אצל דורית
          ואצל הצוות שמתפעל את האתר מטעמה.
        </p>

        {/* Two ways out of the chat, for a visitor who would rather not use it. */}
        <div className="mt-10 flex flex-col sm:flex-row gap-4">
          <a
            href={`https://wa.me/${CONTACT.whatsapp}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 inline-flex items-center justify-center gap-3 border border-border/60 bg-card hover:bg-secondary/40 transition-colors px-6 py-5 text-[15px]"
          >
            <MessageCircle size={18} className="text-accent shrink-0" aria-hidden="true" />
            עדיף לי בוואטסאפ
          </a>
          <a
            href={`tel:${CONTACT.phoneE164}`}
            className="flex-1 inline-flex items-center justify-center gap-3 border border-border/60 bg-card hover:bg-secondary/40 transition-colors px-6 py-5 text-[15px]"
          >
            <Phone size={18} className="text-accent shrink-0" aria-hidden="true" />
            עדיף לי בטלפון
          </a>
        </div>

        {/* And the short form, as a secondary card rather than its own section. */}
        <div className="mt-16 border-t border-border/60 pt-16">
          <h3 className="font-heading text-2xl md:text-3xl leading-tight">
            מעדיפים להשאיר פרטים?
          </h3>
          <div className="mt-8">
            <QuickContact embedded />
          </div>
        </div>
      </div>
    </section>
  );
}
