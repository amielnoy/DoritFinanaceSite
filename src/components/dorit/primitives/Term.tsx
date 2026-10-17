import React, { useEffect, useId, useRef, useState } from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { glossaryEntry } from "@/content/glossary";
import { useLocale } from "@/i18n/LocaleContext";

const OPEN_DELAY = 150;
const CLOSE_DELAY = 150;

/**
 * A glossary term in running text: a dotted gold underline, and a short
 * definition on hover (mouse), on tap (touch) or on Enter/Space (keyboard).
 * Escape or a tap elsewhere closes it.
 *
 * A popover rather than Radix Tooltip because a tooltip does not open on
 * touch, and most of the site's visitors read it on a phone. The definition is
 * rendered only while open, so the page's text — and what a crawler reads —
 * is the same as without it.
 */
export default function Term({ id, children }: { id: string; children: React.ReactNode }) {
  const locale = useLocale();
  const entry = glossaryEntry(id);
  const [open, setOpenState] = useState(false);
  // Opened by a click or tap: stays open until a second click, Escape or a
  // click elsewhere — the pointer leaving does not close it.
  const pinned = useRef(false);
  const setOpen = (next: boolean) => {
    if (!next) pinned.current = false;
    setOpenState(next);
  };
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const trigger = useRef<HTMLButtonElement>(null);
  const contentId = useId();

  useEffect(() => () => clearTimeout(timer.current), []);
  if (!entry) return <>{children}</>;
  const text = entry[locale];

  const later = (next: boolean, ms: number) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setOpen(next), ms);
  };
  const cancel = () => clearTimeout(timer.current);
  const onHover = (e: React.PointerEvent) => e.pointerType === "mouse" && later(true, OPEN_DELAY);
  const onLeave = (e: React.PointerEvent) => e.pointerType === "mouse" && !pinned.current && later(false, CLOSE_DELAY);

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <PopoverPrimitive.Anchor asChild>
        <button
          ref={trigger}
          type="button"
          data-term={id}
          aria-expanded={open}
          aria-describedby={open ? contentId : undefined}
          onPointerEnter={onHover}
          onPointerLeave={onLeave}
          onClick={() => {
            cancel();
            if (pinned.current) return setOpen(false);
            pinned.current = true;
            setOpenState(true);
          }}
          className="term inline m-0 p-0 border-0 bg-transparent font-[inherit] text-[length:inherit] leading-[inherit] text-[color:inherit] [text-align:inherit] underline decoration-dotted decoration-highlight decoration-[1.5px] underline-offset-[5px] cursor-help rounded-[2px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-highlight"
        >
          {children}
        </button>
      </PopoverPrimitive.Anchor>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          id={contentId}
          role="tooltip"
          side="top"
          align="center"
          sideOffset={6}
          collisionPadding={16}
          // Focus stays on the term: the definition is read, not operated.
          onOpenAutoFocus={(e) => e.preventDefault()}
          onCloseAutoFocus={(e) => e.preventDefault()}
          // A tap on the term itself is its own toggle, not an outside click.
          onInteractOutside={(e) => {
            if (trigger.current?.contains(e.target as Node)) e.preventDefault();
          }}
          onPointerEnter={(e) => e.pointerType === "mouse" && cancel()}
          onPointerLeave={onLeave}
          dir={locale === "he" ? "rtl" : "ltr"}
          className="z-50 w-max max-w-[min(20rem,calc(100vw-2rem))] rounded-[4px] border border-border bg-popover px-4 py-3 text-start text-popover-foreground shadow-md outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"
        >
          <span className="block font-body text-[15px] font-semibold leading-snug text-foreground">{text.title}</span>
          <span className="mt-1 block font-body text-[15px] leading-relaxed text-foreground">{text.def}</span>
          <PopoverPrimitive.Arrow className="fill-popover" width={12} height={6} />
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
