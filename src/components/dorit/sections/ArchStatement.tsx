import React from "react";

/**
 * The headline: two lines of light display type with a short gold rule between
 * them. It used to sit inside a graph-paper box with a drawing of columns
 * behind it; the type is the whole statement now.
 */
export default function ArchStatement() {
  return (
    <h1 className="animate-fade-up font-heading font-normal text-[clamp(44px,5.6vw,76px)] leading-[1.06] tracking-[-0.01em] [text-wrap:balance]">
      <span className="block">מקצועיות, יושר</span>
      <span aria-hidden="true" className="block w-[72px] h-px bg-highlight my-[22px]" />
      <span className="block">ואנושיות נפגשים</span>
    </h1>
  );
}
