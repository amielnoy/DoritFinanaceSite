import React from "react";

const WIDTHS = [480, 768, 1080] as const;

interface PhotoProps {
  /** Path without the width and extension: `/images/about-pen` serves `/images/about-pen-768.webp` and its siblings. */
  base: string;
  alt: string;
  /** The rendered width per breakpoint, so a phone fetches the 480 file and not the 1080 one. */
  sizes: string;
  className?: string;
}

/**
 * A decorative photo served from `public/images`, pre-sized to 480/768/1080
 * WebP like the Hero portrait. All three sources are 1200×896, so the
 * width and height give the browser the aspect ratio before the file loads.
 */
export default function Photo({ base, alt, sizes, className }: PhotoProps) {
  return (
    <picture className="block w-full h-full">
      <source type="image/webp" srcSet={WIDTHS.map((w) => `${base}-${w}.webp ${w}w`).join(", ")} sizes={sizes} />
      <img
        src={`${base}-768.webp`}
        alt={alt}
        width={1200}
        height={896}
        className={className}
        loading="lazy"
        decoding="async"
      />
    </picture>
  );
}
