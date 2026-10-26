import React from "react";
import { Link } from "react-router-dom";
import { ArrowDown, Check } from "lucide-react";
import ArchStatement from "@/components/dorit/sections/ArchStatement";
import { ctaClass } from "@/components/dorit/primitives/Cta";
import { PENSION_CHECK } from "@/config/offers";
import AgentPortrait from "@/components/dorit/primitives/AgentPortrait";
import { useAgencyContent } from "@/hooks/useAgencyContent";
import { useLocalePath, useT } from "@/i18n/LocaleContext";

/**
 * The portrait itself is `AgentPortrait`, which holds the pre-sized set (see
 * its comment). `sizes` and the srcsets must match the preload in index.html
 * exactly.
 *
 * Below md the portrait is an 88px circle beside the licence line, so `sizes`
 * says 88px there and a phone fetches the 480 file rather than the 1080 one;
 * from md up the two clauses are the ones there always were.
 */
const HERO_SIZES = "(min-width: 1024px) 490px, (min-width: 768px) calc(100vw - 40px), 88px";

export default function Hero() {
  const t = useT("home");
  const tc = useT("common");
  const tp = useT("pension");
  const lp = useLocalePath();
  const content = useAgencyContent();
  return (
    <section id="top" className="relative border-b border-border pt-[80px] md:pt-[127px]">
      <div className="max-w-[1200px] mx-auto w-full px-[clamp(20px,4vw,40px)] py-[clamp(32px,5vw,64px)] grid grid-cols-1 lg:grid-cols-[1.25fr_1fr] gap-[clamp(32px,4vw,56px)] items-center">
        {/* Portrait, in a card frame. The name sits under it as a caption.
            Below md: a byline at the top — an 88px round portrait beside the
            name and the licence line — instead of a plate taller than the screen. */}
        <figure className="order-2 m-0 flex flex-col gap-3 max-md:order-first max-md:flex-row max-md:items-center max-md:gap-4">
          <div className="plate h-[clamp(320px,46vh,440px)] max-md:h-[88px] max-md:w-[88px] max-md:shrink-0 max-md:rounded-full max-md:p-1">
            <AgentPortrait portrait={content.agent.portrait} sizes={HERO_SIZES} />
          </div>
          {/* Stacked on a phone, side by side from sm. Side by side at 390px
              squeezed the title onto two ragged lines and broke the licence
              number at its hyphen (the prefix on one line, the digits on the next). The number never wraps. */}
          <figcaption className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-3 max-md:flex-col max-md:items-start max-md:gap-0.5 max-md:min-w-0 text-sm leading-relaxed text-muted-foreground">
            <span className="max-md:[text-wrap:balance]">{content.agent.byline}</span>
            <bdi dir="ltr" className="self-start sm:self-auto whitespace-nowrap lining-nums tabular-nums">{content.agent.licenceNumber}</bdi>
          </figcaption>
        </figure>

        {/* Headline */}
        <div className="order-1 flex flex-col gap-5">
          {/* No name pill above the headline: the figcaption under the portrait
              already says the byline, and the header says the name, so a third
              copy was a triple-read before the fold (UX review, 2026-10-26). */}
          <ArchStatement />
          {/* Claims of equal weight, each a checkmark and plain text. They were
              outlined pills in the accent colour, the same look as the intake's
              answer chips, so on a phone they read as buttons that did nothing
              when tapped (UX review, 2026-10-26).
              "97% תביעות שאושרו" used to sit in the middle. It is gone: a
              licensed agent quoting a performance figure is a regulated claim,
              and nothing here could substantiate it. */}
          <ul className="m-0 p-0 list-none flex flex-wrap items-center gap-x-5 gap-y-2 text-base font-medium text-foreground/80 animate-fade-up">
            <li className={CLAIM}><Check aria-hidden="true" size={18} strokeWidth={2.5} className="shrink-0 text-highlight" />{t("hero.claimLicence")}</li>
            <li className={CLAIM}><Check aria-hidden="true" size={18} strokeWidth={2.5} className="shrink-0 text-highlight" />{t("hero.claimPersonal")}</li>
            {/* The FAQ already says it ("פגישת ההיכרות הראשונה ללא עלות וללא
                התחייבות"); it belongs where the decision to write is made. */}
            <li className={CLAIM}><Check aria-hidden="true" size={18} strokeWidth={2.5} className="shrink-0 text-highlight" />{t("hero.claimMeeting")}</li>
          </ul>
          {/* The financial work, named. "מתכננת עתיד" is true and says nothing
              a visitor can act on; most people arrive holding a pension, a
              gemel fund and a study fund they have never looked at, and that is
              the conversation. Still no figure and no promise — §2 binds this
              copy as it binds the agents. */}
          <p className="max-w-[480px] text-lg leading-[1.6] text-foreground/80 [text-wrap:pretty] animate-fade-up">
            {content.agent.bio.headline}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-5 max-md:gap-3 animate-fade-up">
            {/* `ctaClass`'s own comment is explicit: "an outline, never a
                fill" — a deliberate system rule, not an oversight, so this
                does not go solid. A heavier border and a translucent tint
                (no opaque fill) is the compromise: more weight than every
                other outline CTA on the site without breaking the rule. */}
            {/* The flagship leads (growth brief, 2026-10-14): the pension-portfolio
                check through the clearinghouse. The conversation stays one tap
                away, as the secondary button. */}
            <Link
              to={lp(PENSION_CHECK.path)}
              className={ctaClass("max-md:w-full", { size: "lg" })}
            >
              {tp("page.title")}
            </Link>
            {/* Below md the sticky bar's "קביעת שיחה" is the way to #start, and a
                second full-width button would push WhatsApp and the call below
                the first screen. */}
            <a href="#start" className={ctaClass("max-md:hidden", { size: "lg", muted: true })}>
              {tc("cta.shortCall")}
            </a>
            {/* Below md, WhatsApp and the phone are in the sticky bar at the
                bottom of the screen (MobileStickyBar) — a second pair here
                showed each one twice on the first screen (review, 2026-10-25).
                The pension check above stays the one main button. */}
            {/* The services start a short scroll below on a phone; the link is
                for the desktop's long first screen. */}
            <a
              href="#services"
              className="inline-flex items-center gap-2 min-h-11 text-[17px] text-accent underline decoration-highlight/50 underline-offset-[6px] hover:decoration-highlight transition-colors duration-200 group max-md:hidden"
            >
              {t("hero.services")}
              <ArrowDown size={16} strokeWidth={1.5} />
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}

const CLAIM = "flex items-center gap-1.5";
