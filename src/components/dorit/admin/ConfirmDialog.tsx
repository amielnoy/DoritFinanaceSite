import React from "react";
import * as AlertDialog from "@radix-ui/react-alert-dialog";

/**
 * A yes/no question over the admin screens, on Radix's alert dialog: focus is
 * trapped, Escape and "לא" close it, and the screen reader announces it as an
 * alert. Never `window.confirm`, which blocks the page and cannot be styled.
 */
export default function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel = "ביטול",
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  description: React.ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <AlertDialog.Root open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-50 bg-black/40" />
        <AlertDialog.Content
          dir="rtl"
          className="fixed left-1/2 top-1/2 z-50 w-[min(92vw,26rem)] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-border bg-card p-6 shadow-lg"
        >
          <AlertDialog.Title className="text-lg font-bold">{title}</AlertDialog.Title>
          <AlertDialog.Description className="mt-2 text-sm text-muted-foreground">{description}</AlertDialog.Description>
          <div className="mt-6 flex flex-wrap justify-end gap-2">
            <AlertDialog.Cancel className="min-h-11 rounded-md border border-border px-4 text-sm hover:bg-secondary">
              {cancelLabel}
            </AlertDialog.Cancel>
            <AlertDialog.Action
              onClick={onConfirm}
              className="min-h-11 rounded-md bg-accent px-4 text-sm font-medium text-accent-foreground hover:opacity-90"
            >
              {confirmLabel}
            </AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
