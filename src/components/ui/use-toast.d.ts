import * as React from "react";

export interface ToastProps {
  id?: string;
  title?: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  variant?: "default" | "destructive";
  duration?: number;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export interface ToastHandle {
  id: string;
  dismiss: () => void;
  update: (props: ToastProps) => void;
}

export function toast(props: ToastProps): ToastHandle;

export function useToast(): {
  toasts: Array<ToastProps & { id: string }>;
  toast: typeof toast;
  dismiss: (toastId?: string) => void;
};
