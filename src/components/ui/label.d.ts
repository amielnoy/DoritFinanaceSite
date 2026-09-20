import * as React from "react";
import * as LabelPrimitive from "@radix-ui/react-label";

export const Label: React.ForwardRefExoticComponent<
  React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root> &
    React.RefAttributes<React.ElementRef<typeof LabelPrimitive.Root>>
>;
