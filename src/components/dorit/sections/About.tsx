import React, { useState } from "react";
import { Link } from "react-router-dom";
import { ChevronDown, ChevronLeft } from "lucide-react";
import Photo from "@/components/dorit/primitives/Photo";
import Reveal from "@/components/dorit/primitives/Reveal";
import Eyebrow from "@/components/dorit/primitives/Eyebrow";
import { MD_UP, useMediaQuery } from "@/hooks/useMediaQuery";
import { useLocale, useT } from "@/i18n/LocaleContext";

// The two plates share a 3fr/2fr row: half the section from lg up, the
// whole width below it.
const ATMOS = "/images/about-glass";
const ATMOS_SIZES = "(min-width: 1024px) 30vw, 60vw";
const PEN = "/images/about-pen";
const PEN_SIZES = "(min-width: 1024px) 20vw, 40vw";

// Three, not four. "97% שיעור תביעות שאושרו" was here and is gone: a licensed
// agent quoting a performance figure is a regulated claim, and nothing in this
// repo could substantiate it. The grid below is sized to this list — keep the
// two in step, or the bordered strip renders with an empty cell.
const STATS = [
  ["about.stat1Num", "about.stat1"],
  ["about.stat2Num", "about.stat2"],
  ["about.stat3Num", "about.stat3"],
] as const;

/**
 * `brief` keeps the first paragraph and the numbers, and drops the career
 * history and the closing note.
 *
 * On the home page this section sits between the hero and the services, where
 * its job is to establish who she is in one breath before the reader moves on.
 * Four paragraphs of biography is the right depth on a page someone chose to
 * open about her — `/perspective` — and the wrong depth here, where it pushes
 * the actual conversation below a second screenful.
 *
 * Below md, `brief` goes one step further: one sentence and the three figures,
 * with the rest folded behind "עוד עליי" — a disclosure that puts the personal
 * first sentence back and offers the full story on /perspective. The pictures
 * and the folded sentence are hidden with CSS rather than left out, so the
 * phone's document still carries everything the desktop's does
 * (e2e/seo/mobile-parity.spec.ts).
 */
export default function About({ variant = "full" }: { variant?: "full" | "brief" }) {
  const brief = variant === "brief";
  const isDesktop = useMediaQuery(MD_UP, true);
  const oneSentence = brief && !isDesktop;
  const [more, setMore] = useState<boolean>(false);
  const t = useT("home");
  const he = useLocale() === "he";
  return (
    <section id="about" className="relative border-b border-border">
      <div className={`max-w-[1400px] mx-auto px-[clamp(20px,4vw,40px)] py-[clamp(72px,9vw,120px)] grid grid-cols-1 lg:grid-cols-2 gap-[clamp(40px,6vw,96px)] items-center${brief ? " max-md:py-10" : ""}`}>
        <div className={`order-2 lg:order-1 grid grid-cols-[3fr_2fr] gap-4${brief ? " max-md:hidden" : ""}`}>
          <div className="plate h-[clamp(220px,28vw,360px)]">
            <Photo base={ATMOS} sizes={ATMOS_SIZES} alt={t("about.imgAtmos")} className="w-full h-full object-cover" />
          </div>
          <div className="plate h-[clamp(220px,28vw,360px)]">
            <Photo base={PEN} sizes={PEN_SIZES} alt={t("about.imgPen")} className="w-full h-full object-cover" />
          </div>
        </div>

        <div className="order-1 lg:order-2 flex flex-col justify-center">
          <Reveal>
            <Eyebrow>
              {t("about.eyebrow")}
            </Eyebrow>
            <h2 className="font-heading font-normal text-[clamp(34px,4vw,48px)] mt-5 leading-[1.12]">
              {t("about.titleLine1")}
              <br />
              {t("about.titleLine2")}
            </h2>
          </Reveal>
          <div className={`mt-6 space-y-5 text-foreground/80 max-w-[600px] text-justify text-[19px] leading-[1.8] hyphens-none${brief ? " max-md:mt-4 max-md:text-start max-md:text-[17px] max-md:leading-[1.7]" : ""}`}>
            {oneSentence ? (
              // The same paragraph, its personal first sentence hidden. Split
              // into two runs only here: from md up the paragraph stays one
              // text node, because a run boundary moves the justified line by
              // a pixel.
              <p id="about-more">
                <span className={more ? undefined : "hidden"}>{t("about.family")} </span>
                {t("about.credentials")}
              </p>
            ) : (
              <p>
                {`${t("about.family")} ${t("about.credentials")}`}
              </p>
            )}
            {brief ? null : <p>
              {t("about.career")}
            </p>}
            {brief ? null : <p>
              {t("about.insight")}
            </p>}
            {brief ? null : <p>
              {t("about.unique")}
            </p>}
          </div>
          {oneSentence ? (
            // The remainder, folded: "עוד עליי" puts the personal sentence back
            // in the paragraph it follows and offers the whole story, a page away.
            <div className="mt-2 flex flex-wrap items-center gap-x-6">
              <button
                type="button"
                onClick={() => setMore((v) => !v)}
                aria-expanded={more}
                aria-controls="about-more"
                className={ABOUT_LINK}
              >
                {t("about.more")}
                <ChevronDown
                  size={16}
                  strokeWidth={1.5}
                  aria-hidden="true"
                  className={`motion-safe:transition-transform duration-200 ${more ? "rotate-180" : ""}`}
                />
              </button>
              {/* /perspective is Hebrew only: no link to it from English or French. */}
              {more && he ? (
                <Link to="/perspective" className={ABOUT_LINK}>
                  {t("about.fullStory")}
                  <ChevronLeft size={16} strokeWidth={1.5} aria-hidden="true" />
                </Link>
              ) : null}
            </div>
          ) : null}
          {brief ? null : (
            <p className="mt-6 font-heading italic text-2xl text-accent">
              {t("about.signature")}
            </p>
          )}

          <div className={`mt-8 grid grid-cols-3 border-y border-border${brief ? " max-md:mt-6" : ""}`}>
            {STATS.map(([num, label], i) => (
              <div
                key={i}
                className={`px-2 py-6 flex flex-col items-center gap-2 text-center ${i > 0 ? "border-s border-border" : ""}${brief ? " max-md:py-4" : ""}`}
              >
                <p className="font-heading text-[clamp(36px,4vw,52px)] text-accent leading-none lining-nums tabular-nums">
                  {t(num)}
                </p>
                <p className="text-[15px] text-muted-foreground">
                  {t(label)}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

const ABOUT_LINK =
  "inline-flex items-center gap-1.5 min-h-11 text-[17px] text-accent underline decoration-highlight/50 underline-offset-[6px] hover:decoration-highlight";
