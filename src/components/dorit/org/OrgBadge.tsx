import React from "react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { Organization } from "@/config/organizations";

/**
 * The organization's square on a user's avatar: its colour, its letter in
 * white, a white rim, at the avatar's bottom corner on the inline end (the
 * left in RTL). The full name is the tooltip and the accessible name.
 *
 * Sized to the avatar: 64px → 26px, 40–44px → 20px, and at 32px or smaller a
 * square of colour with no letter — too small to read, and the name is still
 * in the label and the tooltip.
 */
export function badgeSpec(avatarSize: number): { size: number; border: number; radius: number; letter: boolean } {
  if (avatarSize >= 56) return { size: 26, border: 3, radius: 8, letter: true };
  if (avatarSize > 32) return { size: 20, border: 2, radius: 6, letter: true };
  return { size: 12, border: 2, radius: 4, letter: false };
}

export default function OrgBadge({ org, avatarSize }: { org: Organization; avatarSize: number }) {
  const spec = badgeSpec(avatarSize);
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            role="img"
            aria-label={org.name}
            data-org={org.id}
            className="absolute flex items-center justify-center font-body font-semibold leading-none text-white box-content border-solid border-white"
            style={{
              width: spec.size,
              height: spec.size,
              borderWidth: spec.border,
              borderRadius: spec.radius,
              background: org.color,
              fontSize: Math.round(spec.size * 0.55),
              bottom: -spec.border,
              insetInlineEnd: -spec.border,
            }}
          >
            {spec.letter ? <span aria-hidden="true">{org.letter}</span> : null}
          </span>
        </TooltipTrigger>
        <TooltipContent>{org.name}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
