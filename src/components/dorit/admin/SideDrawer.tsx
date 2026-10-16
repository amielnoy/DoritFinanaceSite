import React, { useLayoutEffect, useRef } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";

/**
 * A side panel over the admin screen: from the left edge (the end of a
 * right-to-left page), full screen on a phone. Radix keeps the focus inside
 * while it is open; Esc and the X close it. Opened by state rather than by a
 * Radix trigger, it remembers what had the focus when it opened and gives the
 * focus back there on close. Radix sets role="dialog" but not aria-modal, so
 * it is set here.
 */
export default function SideDrawer({
  open,
  onClose,
  title,
  subtitle,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  /** A line under the title, read as the dialog's description. */
  subtitle?: React.ReactNode;
  children: React.ReactNode;
}) {
  const opener = useRef<HTMLElement | null>(null);
  // Before the dialog takes the focus: whatever had it opened the drawer.
  useLayoutEffect(() => {
    if (open && document.activeElement instanceof HTMLElement) opener.current = document.activeElement;
  }, [open]);
  return (
    <Dialog.Root open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-primary/40" />
        <Dialog.Content
          aria-modal="true"
          dir="rtl"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            opener.current?.focus();
            opener.current = null;
          }}
          {...(subtitle ? {} : { "aria-describedby": undefined })}
          className="fixed inset-y-0 left-0 z-50 flex w-full flex-col border-e border-border bg-background shadow-xl sm:max-w-md"
        >
          <div className="flex items-start gap-3 border-b border-border/60 bg-card px-5 py-4">
            <div className="min-w-0 flex-1">
              <Dialog.Title className="font-heading text-2xl">{title}</Dialog.Title>
              {subtitle ? <Dialog.Description className="mt-1 text-sm text-muted-foreground">{subtitle}</Dialog.Description> : null}
            </div>
            <Dialog.Close
              aria-label="סגירה"
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center text-muted-foreground hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
            >
              <X size={20} aria-hidden="true" />
            </Dialog.Close>
          </div>
          <div className="flex-1 overflow-y-auto px-5 py-5">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
