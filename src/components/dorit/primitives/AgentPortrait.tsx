import React from "react";
import { AGENCY1_PORTRAIT_BASE } from "@/config/agency1";
import { PORTRAIT_WIDTHS, type Portrait } from "@/lib/portrait";

/**
 * The portrait, pre-sized. The original PNG was 1.85 MB — 79% of the home
 * page's weight and its LCP element. These are generated from it (480/768/1080
 * wide, AVIF + WebP); the PNG stays only as the source and is not served here.
 * `sizes` and the srcsets must match the preload in index.html exactly.
 */
const HERO = AGENCY1_PORTRAIT_BASE;
const WIDTHS = PORTRAIT_WIDTHS;
const srcset = (ext: string) => WIDTHS.map((w) => `${HERO}-${w}.${ext} ${w}w`).join(", ");

export default function AgentPortrait({ portrait, sizes }: { portrait: Portrait; sizes: string }) {
  if (portrait.kind === "monogram") {
    // A first-class state, not a placeholder: an agency without a photo is
    // the normal case at onboarding, and a broken or borrowed image would be
    // worse than the initials.
    return (
      <div
        role="img"
        aria-label={portrait.alt}
        className="w-full h-full flex items-center justify-center bg-primary text-primary-foreground font-heading text-[clamp(40px,6vw,96px)] max-md:text-2xl"
      >
        {portrait.initials}
      </div>
    );
  }

  if (portrait.kind === "photo") {
    return (
      <img
        src={portrait.src}
        srcSet={portrait.srcSet ?? undefined}
        sizes={sizes}
        alt={portrait.alt}
        className="w-full h-full object-cover object-[center_20%]"
        loading="eager"
        // Lowercase, through a spread: see the bundled branch.
        {...{ fetchpriority: "high" }}
        decoding="async"
      />
    );
  }

  return (
    <picture className="block w-full h-full">
      <source type="image/avif" srcSet={srcset("avif")} sizes={sizes} />
      <source type="image/webp" srcSet={srcset("webp")} sizes={sizes} />
      <img
        src={`${HERO}-768.webp`}
        alt={portrait.alt}
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
  );
}
