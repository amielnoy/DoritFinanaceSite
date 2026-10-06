import React from "react";
import { cn } from "@/lib/utils";

/** The text-control styling shared by every form on the site — 48px, transparent, hairline, gold focus. */
export const inputClass = (className?: string) =>
  cn(
    "w-full min-h-12 rounded-md bg-transparent border border-input px-3.5 py-2.5 text-[17px] text-foreground placeholder:text-muted-foreground caret-highlight",
    "hover:border-foreground/45 focus:outline-none focus:border-highlight focus:ring-[3px] focus:ring-highlight/20 transition-colors",
    "aria-[invalid=true]:border-destructive",
    className
  );

/** A labelled form control. (Id-cloning behaviour unchanged.) */
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
      <label htmlFor={id} className="block text-[15px] text-foreground/80 mb-1.5">
        {label}
      </label>
      {control}
    </div>
  );
}
