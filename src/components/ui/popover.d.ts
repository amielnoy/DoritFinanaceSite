import * as React from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";

export const Popover: typeof PopoverPrimitive.Root;

export const PopoverTrigger: typeof PopoverPrimitive.Trigger;

export const PopoverAnchor: typeof PopoverPrimitive.Anchor;

export const PopoverContent: React.ForwardRefExoticComponent<
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content> &
    React.RefAttributes<React.ElementRef<typeof PopoverPrimitive.Content>>
>;
