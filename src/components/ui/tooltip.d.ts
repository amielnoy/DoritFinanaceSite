import * as React from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";

export const TooltipProvider: typeof TooltipPrimitive.Provider;

export const Tooltip: typeof TooltipPrimitive.Root;

export const TooltipTrigger: typeof TooltipPrimitive.Trigger;

export const TooltipContent: React.ForwardRefExoticComponent<
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content> &
    React.RefAttributes<React.ElementRef<typeof TooltipPrimitive.Content>>
>;
