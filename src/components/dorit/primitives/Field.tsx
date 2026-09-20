import React from "react";
import { cn } from "@/lib/utils";

/** The text-control styling shared by every form on the site. */
export const inputClass = (className?: string) =>
  cn(
    "w-full bg-background border border-border px-4 py-3 text-base text-foreground placeholder:text-muted-foreground/60",
    "focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/40 transition-colors",
    className
  );

/**
 * A labelled form control.
 *
 * The control is passed in as a child, so the id is generated here and cloned
 * on — unless the child brings its own, which the e2e page objects rely on
 * (`#qc-name` and friends). Without an id the <label> is associated with
 * nothing and screen readers announce the field as unlabelled (axe: label /
 * select-name, critical). ClaimForm had this; QuickContact hand-wrote four
 * id/htmlFor pairs instead.
 */
export function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  const generated = React.useId();
  const child = React.isValidElement(children)
    ? (children as React.ReactElement<{ id?: string }>)
    : null;
  const id = child?.props.id ?? generated;
  const control = child ? React.cloneElement(child, { id }) : children;

  return (
    <div className={className}>
      <label htmlFor={id} className="block text-xs tracking-[0.15em] uppercase text-muted-foreground mb-2">
        {label}
      </label>
      {control}
    </div>
  );
}
