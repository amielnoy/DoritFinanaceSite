import React from "react";
import { Link } from "react-router-dom";
import { ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MASLEKA_ENABLED } from "@/config/masleka";
import { reaches, type AdminAccess, type AdminCounts } from "@/hooks/useAdminMenu";
import { adminHome } from "./adminNav";
import CountBadge from "./CountBadge";

/**
 * "ניהול" in the public header: the way into the admin interface, apart from
 * the site's own navigation. Shown only to the admin and to agency staff —
 * FloatingHeader decides that, and loads this file only then, so a visitor's
 * page never carries the menu's code.
 *
 * Radix's menu supplies the behaviour the trigger promises: aria-haspopup and
 * aria-expanded, arrow keys between the items, Escape closing with focus back
 * on the button, and a click outside closing it.
 */
export interface AdminMenuProps {
  access: Exclude<AdminAccess, null>;
  counts: AdminCounts;
  name: string;
  roleLabel: string;
  onSignOut: () => void;
}

/** Up to two letters: the first of each of the first two words, or of the email's name. */
export function initials(name: string): string {
  const words = name.split("@")[0].split(/[\s._-]+/).filter(Boolean);
  if (words.length === 0) return "?";
  const letters = words.length === 1 ? [...words[0]].slice(0, 1) : [[...words[0]][0], [...words[1]][0]];
  return letters.join("").toUpperCase();
}

/** The kit's focused item is solid gold, which would swallow a gold counter — a tint instead, as in the sidebar. */
const ITEM =
  "flex w-full items-center gap-2 min-h-11 px-3 text-[15px] rounded-sm cursor-pointer focus:bg-nav-active focus:text-foreground";

export default function AdminMenu({ access, counts, name, roleLabel, onSignOut }: AdminMenuProps) {
  return (
    <DropdownMenu dir="rtl" modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-2 min-h-11 ps-1.5 pe-3 border border-border rounded-sm text-[15px] text-foreground hover:bg-foreground/[0.06] transition-colors duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
        >
          <span
            aria-hidden="true"
            className="w-8 h-8 shrink-0 rounded-full bg-nav-active text-accent font-heading text-sm flex items-center justify-center"
          >
            {initials(name)}
          </span>
          <span>ניהול</span>
          <CountBadge count={counts.total} label="פריטים ממתינים" />
          <ChevronDown size={15} aria-hidden="true" className="text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64 rounded-sm bg-surface border-border">
        <DropdownMenuLabel className="font-normal px-3 py-2">
          <span className="block text-[15px] font-medium truncate">{name}</span>
          <span className="block text-xs text-muted-foreground">{roleLabel}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator className="bg-border" />
        <DropdownMenuItem asChild className={ITEM}>
          <Link to={adminHome(access)}>ממשק ניהול</Link>
        </DropdownMenuItem>
        {/* Admin+ see the queue they assign; a User, their own new leads. */}
        {reaches(access, "admin") ? (
          <DropdownMenuItem asChild className={ITEM}>
            <Link to="/admin/leads">
              <span>פניות שלא שויכו</span>
              <CountBadge count={counts.unassigned} label="לא שויכו" className="ms-auto" />
            </Link>
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem asChild className={ITEM}>
            <Link to="/admin/leads">
              <span>הפניות שלי</span>
              <CountBadge count={counts.newLeads} label="חדשות" className="ms-auto" />
            </Link>
          </DropdownMenuItem>
        )}
        {MASLEKA_ENABLED ? (
          <DropdownMenuItem asChild className={ITEM}>
            <Link to="/admin/masleka">
              <span>בקשות מסלקה</span>
              <CountBadge count={counts.maslekaWaiting} label="ממתינות להגשה" className="ms-auto" />
            </Link>
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuSeparator className="bg-border" />
        <DropdownMenuItem className={ITEM} onSelect={onSignOut}>
          יציאה
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
