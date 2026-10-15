import React, { useRef, useState } from "react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { Organization } from "@/config/organizations";

/**
 * The organization's square on a user's avatar: its colour, its code (or its
 * logo) in white, a white rim, at the avatar's bottom corner on the inline end
 * (the left in RTL). "ארגון: <name>" is its accessible name and its tooltip —
 * which opens on hover, on keyboard focus, and on a tap on a touch screen.
 *
 * Sized to the avatar: 64px → 26px, 40–44px → 20px, and at 32px or smaller a
 * square of colour with no code — too small to read; the name is still in the
 * label and the tooltip.
 */
export function badgeSpec(avatarSize: number): { size: number; border: number; radius: number; code: boolean; font: number } {
  if (avatarSize >= 56) return { size: 26, border: 3, radius: 8, code: true, font: 11 };
  if (avatarSize > 32) return { size: 20, border: 2, radius: 6, code: true, font: 9.5 };
  return { size: 12, border: 2, radius: 4, code: false, font: 0 };
}

export const orgLabel = (org: Pick<Organization, "name">) => `ארגון: ${org.name}`;

export default function OrgBadge({ org, avatarSize }: { org: Organization; avatarSize: number }) {
  const spec = badgeSpec(avatarSize);
  const [open, setOpen] = useState(false);
  // A tap: Radix closes the tooltip on pointerdown and never opens it for
  // touch, so the click that follows a touch toggles it from what it was.
  const touch = useRef<{ wasOpen: boolean } | null>(null);
  const label = orgLabel(org);
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip open={open} onOpenChange={setOpen}>
        <TooltipTrigger asChild>
          <span
            role="img"
            aria-label={label}
            tabIndex={0}
            data-org={org.id}
            onPointerDown={(e) => {
              touch.current = e.pointerType === "touch" ? { wasOpen: open } : null;
            }}
            onClick={() => {
              if (touch.current) setOpen(!touch.current.wasOpen);
            }}
            className="absolute flex items-center justify-center overflow-hidden font-body font-semibold leading-none text-white box-content border-solid border-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-highlight"
            style={{
              width: spec.size,
              height: spec.size,
              borderWidth: spec.border,
              borderRadius: spec.radius,
              background: org.color,
              fontSize: spec.font || undefined,
              letterSpacing: spec.code ? "-0.02em" : undefined,
              bottom: -spec.border,
              insetInlineEnd: -spec.border,
            }}
          >
            {!spec.code ? null : org.logoUrl ? (
              <img src={org.logoUrl} alt="" aria-hidden="true" className="h-full w-full object-cover" />
            ) : (
              <span aria-hidden="true">{org.code}</span>
            )}
          </span>
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/** The organization's colour and code as an inline square — beside its name in a filter, never alone. */
export function OrgMark({ org, size = 20 }: { org: Organization; size?: number }) {
  return (
    <span
      aria-hidden="true"
      className="inline-flex shrink-0 items-center justify-center overflow-hidden rounded-[5px] font-body font-semibold leading-none text-white"
      style={{ width: size, height: size, background: org.color, fontSize: Math.round(size * 0.48) }}
    >
      {org.logoUrl ? <img src={org.logoUrl} alt="" className="h-full w-full object-cover" /> : org.code}
    </span>
  );
}
