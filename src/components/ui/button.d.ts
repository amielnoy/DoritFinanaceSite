import * as React from "react";

export type ButtonVariant = "default" | "destructive" | "outline" | "secondary" | "ghost" | "link";
export type ButtonSize = "default" | "sm" | "lg" | "icon";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant | null;
  size?: ButtonSize | null;
  /** Render the child element instead of a <button>, passing the styles down. */
  asChild?: boolean;
}

export const Button: React.ForwardRefExoticComponent<ButtonProps & React.RefAttributes<HTMLButtonElement>>;

export function buttonVariants(opts?: {
  variant?: ButtonVariant | null;
  size?: ButtonSize | null;
  className?: string;
}): string;
