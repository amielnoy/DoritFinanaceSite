import React from "react";
import { cn } from "@/lib/utils";

/**
 * The bronze call-to-action, as a link or a button.
 *
 * The class string behind it had been pasted into ten places across nine
 * files and had already forked: two of them set `text-primary-foreground`
 * (parchment on bronze) where the rest set `text-primary` (obsidian on
 * bronze). The design token for text on the highlight colour is
 * `--highlight-foreground`, which is the dark one, so that is what both
 * variants now use.
 */
export const ctaClass = (className?: string, opts: { muted?: boolean } = {}) =>
  cn(
    "inline-flex items-center gap-2 px-7 py-3.5 font-medium transition-colors duration-300 shadow-sm",
    opts.muted ? "bg-highlight-muted" : "bg-highlight",
    "text-highlight-foreground hover:bg-highlight-strong",
    "disabled:opacity-40 disabled:hover:bg-highlight",
    className
  );

type CtaLinkProps = React.AnchorHTMLAttributes<HTMLAnchorElement> & { muted?: boolean };

export function CtaLink({ className, muted, ...props }: CtaLinkProps) {
  return <a className={ctaClass(className, { muted })} {...props} />;
}

type CtaButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & { muted?: boolean };

export function CtaButton({ className, muted, type = "button", ...props }: CtaButtonProps) {
  return <button type={type} className={ctaClass(className, { muted })} {...props} />;
}
