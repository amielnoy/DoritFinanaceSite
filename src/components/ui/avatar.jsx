"use client"

import * as React from "react"
import * as AvatarPrimitive from "@radix-ui/react-avatar"

import { cn } from "@/lib/utils"
import OrgBadge from "@/components/dorit/org/OrgBadge"

/**
 * `org` (optional, from src/config/organizations.ts) puts the organization's
 * badge on the avatar's corner; `size` is the avatar's width in px (40 when
 * unset, as h-10 w-10), which picks the badge's size. The badge sits in a
 * wrapper because the avatar clips whatever overflows its circle. Without
 * `org` the avatar renders exactly as it did.
 */
const Avatar = React.forwardRef(({ className, org, size, style, ...props }, ref) => {
  const root = (
    <AvatarPrimitive.Root
      ref={ref}
      className={cn("relative flex h-10 w-10 shrink-0 overflow-hidden rounded-full", className)}
      style={size ? { width: size, height: size, ...style } : style}
      {...props} />
  )
  if (!org) return root
  return (
    <span className="relative inline-flex shrink-0">
      {root}
      <OrgBadge org={org} avatarSize={size ?? 40} />
    </span>
  )
})
Avatar.displayName = AvatarPrimitive.Root.displayName

const AvatarImage = React.forwardRef(({ className, ...props }, ref) => (
  <AvatarPrimitive.Image
    ref={ref}
    className={cn("aspect-square h-full w-full", className)}
    {...props} />
))
AvatarImage.displayName = AvatarPrimitive.Image.displayName

const AvatarFallback = React.forwardRef(({ className, ...props }, ref) => (
  <AvatarPrimitive.Fallback
    ref={ref}
    className={cn(
      "flex h-full w-full items-center justify-center rounded-full bg-muted",
      className
    )}
    {...props} />
))
AvatarFallback.displayName = AvatarPrimitive.Fallback.displayName

export { Avatar, AvatarImage, AvatarFallback }
