import * as React from "react";
import * as AvatarPrimitive from "@radix-ui/react-avatar";
import type { Organization } from "@/config/organizations";

export const Avatar: React.ForwardRefExoticComponent<
  React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Root> & {
    /** The organization's badge on the avatar's corner (src/config/organizations.ts). */
    org?: Organization;
    /** The avatar's width in px; picks the badge's size. 40 when unset. */
    size?: number;
  } & React.RefAttributes<React.ElementRef<typeof AvatarPrimitive.Root>>
>;

export const AvatarImage: React.ForwardRefExoticComponent<
  React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Image> &
    React.RefAttributes<React.ElementRef<typeof AvatarPrimitive.Image>>
>;

export const AvatarFallback: React.ForwardRefExoticComponent<
  React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Fallback> &
    React.RefAttributes<React.ElementRef<typeof AvatarPrimitive.Fallback>>
>;
