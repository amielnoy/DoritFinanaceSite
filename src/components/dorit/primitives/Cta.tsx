import React from "react";
import { cn } from "@/lib/utils";

/**
 * The gold call-to-action — an outline, never a fill (Classical).
 * `muted` is kept for API compatibility and now renders the secondary
 * (hairline) variant. `onDark` is for the footer / colophon band.
 */
export const ctaClass = (
  className?: string,
  opts: { muted?: boolean; onDark?: boolean; size?: "md" | "lg" } = {}
) =>
  cn(
    "inline-flex items-center justify-center gap-2 rounded-md border bg-transparent font-heading font-medium transition-colors duration-200",
    opts.size === "lg" ? "min-h-[54px] px-[30px] text-xl" : "min-h-12 px-[26px] text-lg",
    opts.onDark
      ? "border-highlight-on-dark text-highlight-on-dark hover:bg-highlight-on-dark/15"
      : opts.muted
        ? "border-border text-foreground hover:bg-foreground/[0.06]"
        : "border-highlight text-highlight-foreground hover:bg-highlight/[0.12] active:bg-highlight/[0.22]",
    "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-highlight",
    "disabled:opacity-45 disabled:hover:bg-transparent",
    className
  );

type Opts = { muted?: boolean; onDark?: boolean; size?: "md" | "lg" };
type CtaLinkProps = React.AnchorHTMLAttributes<HTMLAnchorElement> & Opts;
export function CtaLink({ className, muted, onDark, size, ...props }: CtaLinkProps) {
  return <a className={ctaClass(className, { muted, onDark, size })} {...props} />;
}

type CtaButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & Opts;
export function CtaButton({ className, muted, onDark, size, type = "button", ...props }: CtaButtonProps) {
  return <button type={type} className={ctaClass(className, { muted, onDark, size })} {...props} />;
}
