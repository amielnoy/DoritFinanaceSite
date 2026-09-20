import * as React from "react";
import { OTPInput } from "input-otp";

export const InputOTP: React.ForwardRefExoticComponent<
  React.ComponentPropsWithoutRef<typeof OTPInput> & React.RefAttributes<HTMLInputElement>
>;

export const InputOTPGroup: React.ForwardRefExoticComponent<
  React.HTMLAttributes<HTMLDivElement> & React.RefAttributes<HTMLDivElement>
>;

export const InputOTPSlot: React.ForwardRefExoticComponent<
  React.HTMLAttributes<HTMLDivElement> & { index: number } & React.RefAttributes<HTMLDivElement>
>;

export const InputOTPSeparator: React.ForwardRefExoticComponent<
  React.HTMLAttributes<HTMLDivElement> & React.RefAttributes<HTMLDivElement>
>;
