import React from "react";
import { Link } from "react-router-dom";
import { ArrowDown, MessageCircle, Phone } from "lucide-react";
import { CONTACT } from "@/config/contact";
import ArchStatement from "@/components/dorit/sections/ArchStatement";
import { ctaClass } from "@/components/dorit/primitives/Cta";
import { PENSION_CHECK } from "@/config/offers";
import { useLocalePath, useT } from "@/i18n/LocaleContext";

/**
 * The portrait, pre-sized. The original PNG was 1.85 MB — 79% of the home
 * page's weight and its LCP element. These are generated from it (480/768/1080
 * wide, AVIF + WebP); the PNG stays only as the source and is not served here.
 * `sizes` and the srcsets must match the preload in index.html exactly.
 *
 * Below md the portrait is an 88px circle beside the licence line, so `sizes`
 * says 88px there and a phone fetches the 480 file rather than the 1080 one;
 * from md up the two clauses are the ones there always were.
 */
const HERO = "/images/dorit-office-portrait";
const WIDTHS = [480, 768, 1080] as const;
const srcset = (ext: string) => WIDTHS.map((w) => `${HERO}-${w}.${ext} ${w}w`).join(", ");
const HERO_SIZES = "(min-width: 1024px) 490px, (min-width: 768px) calc(100vw - 40px), 88px";

export default function Hero() {
  const t = useT("home");
  const tc = useT("common");
  const tp = useT("pension");
  const lp = useLocalePath();
  return (
    <section id="top" className="relative border-b border-border pt-[80px] md:pt-[127px]">
      <div className="max-w-[1200px] mx-auto w-full px-[clamp(20px,4vw,40px)] py-[clamp(32px,5vw,64px)] grid grid-cols-1 lg:grid-cols-[1fr_1.2fr] gap-[clamp(32px,4vw,56px)] items-center">
        {/* Portrait, in a matted plate. The name sits under it as a caption.
            Below md: a byline at the top — an 88px round portrait beside the
            name and the licence line — instead of a plate taller than the screen. */}
        <figure className="order-2 lg:order-1 m-0 flex flex-col gap-3 max-md:order-first max-md:flex-row max-md:items-center max-md:gap-4">
          <div className="plate h-[clamp(320px,46vh,440px)] max-md:h-[88px] max-md:w-[88px] max-md:shrink-0 max-md:rounded-full max-md:border-[3px]">
            <picture className="block w-full h-full">
              <source type="image/avif" srcSet={srcset("avif")} sizes={HERO_SIZES} />
              <source type="image/webp" srcSet={srcset("webp")} sizes={HERO_SIZES} />
              <img
                src={`${HERO}-768.webp`}
                alt={t("hero.portraitAlt")}
                width={1122}
                height={1402}
                className="w-full h-full object-cover object-[center_20%]"
                loading="eager"
                // Lowercase, through a spread: React 18 does not know the
                // camelCase `fetchPriority` prop and warns in development (which
                // fails home.spec's "no console error" in the dev-mode Docker
                // build), while it passes a lowercase attribute straight through.
                // React 19 knows `fetchPriority`; switch back when upgrading.
                {...{ fetchpriority: "high" }}
                decoding="async"
              />
            </picture>
          </div>
          {/* Stacked on a phone, side by side from sm. Side by side at 390px
              squeezed the title onto two ragged lines and broke the licence
              number at its hyphen ("L-" / "00107009"). The number never wraps. */}
          <figcaption className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-3 max-md:flex-col max-md:items-start max-md:gap-0.5 max-md:min-w-0 text-sm leading-relaxed text-muted-foreground">
            <span className="max-md:[text-wrap:balance]">{t("hero.byline")}</span>
            <bdi dir="ltr" className="self-start sm:self-auto whitespace-nowrap lining-nums tabular-nums">L-00107009</bdi>
          </figcaption>
        </figure>

        {/* Headline */}
        <div className="order-1 lg:order-2 flex flex-col gap-5">
          {/* The figcaption below the portrait repeats this exact line, so on a
              phone — where the two sit one above the other instead of side by
              side — it is a double-read of the same name before the fold.
              Hidden under `sm`, still shown wherever there is room to spare. */}
          <span className="hidden text-sm text-accent animate-fade-up sm:block">
            {t("hero.byline")}
          </span>
          <ArchStatement />
          {/* Claims of equal weight, a gold diamond between them.
              "97% תביעות שאושרו" used to sit in the middle. It is gone: a
              licensed agent quoting a performance figure is a regulated claim,
              and nothing here could substantiate it. */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 font-heading text-xl text-accent animate-fade-up">
            <span>{t("hero.claimLicence")}</span>
            <span aria-hidden="true" className="w-1.5 h-1.5 rotate-45 border border-highlight" />
            <span>{t("hero.claimPersonal")}</span>
            {/* The FAQ already says it ("פגישת ההיכרות הראשונה ללא עלות וללא
                התחייבות"); it belongs where the decision to write is made. */}
            <span aria-hidden="true" className="w-1.5 h-1.5 rotate-45 border border-highlight" />
            <span>{t("hero.claimMeeting")}</span>
          </div>
          {/* The financial work, named. "מתכננת עתיד" is true and says nothing
              a visitor can act on; most people arrive holding a pension, a
              gemel fund and a study fund they have never looked at, and that is
              the conversation. Still no figure and no promise — §2 binds this
              copy as it binds the agents. */}
          <p className="max-w-[480px] text-lg leading-[1.6] text-foreground/80 [text-wrap:pretty] animate-fade-up">
            {t("hero.lead")}
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
              className={ctaClass("border-2 bg-highlight/[0.08] hover:bg-highlight/[0.18] max-md:w-full", { size: "lg" })}
            >
              {tp("page.title")}
            </Link>
            {/* Below md the sticky bar's "קביעת שיחה" is the way to #start, and a
                second full-width button would push WhatsApp and the call below
                the first screen. */}
            <a href="#start" className={ctaClass("max-md:hidden", { size: "lg", muted: true })}>
              {tc("cta.shortCall")}
            </a>
            {/* Below md: WhatsApp and the phone side by side under the CTA. The
                global click listener reports them as click_whatsapp and
                click_phone, location "top". */}
            <div className="md:hidden grid w-full grid-cols-2 gap-3">
              <a
                href={`https://wa.me/${CONTACT.whatsapp}?text=${encodeURIComponent(tc("contact.whatsappDefault"))}`}
                target="_blank"
                rel="noopener noreferrer"
                className={HERO_ALT}
              >
                <MessageCircle size={18} strokeWidth={1.5} className="text-accent shrink-0" aria-hidden="true" />
                {tc("sticky.whatsapp")}
              </a>
              <a href={`tel:${CONTACT.phoneE164}`} className={HERO_ALT}>
                <Phone size={18} strokeWidth={1.5} className="text-accent shrink-0" aria-hidden="true" />
                {tc("nav.call")}
              </a>
            </div>
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

const HERO_ALT =
  "flex items-center justify-center gap-2 min-h-12 rounded-md border border-border text-[17px] text-foreground hover:border-highlight hover:bg-highlight/5 transition-colors duration-200";
