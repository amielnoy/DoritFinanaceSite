import * as React from "react";
import * as AccordionPrimitive from "@radix-ui/react-accordion";

export const Accordion: typeof AccordionPrimitive.Root;

export const AccordionItem: React.ForwardRefExoticComponent<
  React.ComponentPropsWithoutRef<typeof AccordionPrimitive.Item> &
    React.RefAttributes<React.ElementRef<typeof AccordionPrimitive.Item>>
>;

export const AccordionTrigger: React.ForwardRefExoticComponent<
  React.ComponentPropsWithoutRef<typeof AccordionPrimitive.Trigger> &
    React.RefAttributes<React.ElementRef<typeof AccordionPrimitive.Trigger>>
>;

export const AccordionContent: React.ForwardRefExoticComponent<
  React.ComponentPropsWithoutRef<typeof AccordionPrimitive.Content> &
    React.RefAttributes<React.ElementRef<typeof AccordionPrimitive.Content>>
>;
