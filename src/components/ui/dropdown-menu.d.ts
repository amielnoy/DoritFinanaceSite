import * as React from "react";
import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";

type Wrapped<T extends React.ElementType, Extra = object> = React.ForwardRefExoticComponent<
  React.ComponentPropsWithoutRef<T> & Extra & React.RefAttributes<React.ElementRef<T>>
>;

export const DropdownMenu: typeof DropdownMenuPrimitive.Root;

export const DropdownMenuTrigger: typeof DropdownMenuPrimitive.Trigger;

export const DropdownMenuGroup: typeof DropdownMenuPrimitive.Group;

export const DropdownMenuPortal: typeof DropdownMenuPrimitive.Portal;

export const DropdownMenuSub: typeof DropdownMenuPrimitive.Sub;

export const DropdownMenuRadioGroup: typeof DropdownMenuPrimitive.RadioGroup;

export const DropdownMenuSubTrigger: Wrapped<typeof DropdownMenuPrimitive.SubTrigger, { inset?: boolean }>;

export const DropdownMenuSubContent: Wrapped<typeof DropdownMenuPrimitive.SubContent>;

export const DropdownMenuContent: Wrapped<typeof DropdownMenuPrimitive.Content>;

export const DropdownMenuItem: Wrapped<typeof DropdownMenuPrimitive.Item, { inset?: boolean }>;

export const DropdownMenuCheckboxItem: Wrapped<typeof DropdownMenuPrimitive.CheckboxItem>;

export const DropdownMenuRadioItem: Wrapped<typeof DropdownMenuPrimitive.RadioItem>;

export const DropdownMenuLabel: Wrapped<typeof DropdownMenuPrimitive.Label, { inset?: boolean }>;

export const DropdownMenuSeparator: Wrapped<typeof DropdownMenuPrimitive.Separator>;

export const DropdownMenuShortcut: React.FC<React.HTMLAttributes<HTMLSpanElement>>;
