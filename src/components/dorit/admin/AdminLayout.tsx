import React, { useId } from "react";
import { Link, NavLink, Outlet } from "react-router-dom";
import { ExternalLink, LogOut } from "lucide-react";
import { useAuth } from "@/lib/AuthContext";
import { MASLEKA_ENABLED } from "@/config/masleka";
import { useAdminAccess, useAdminCounts, type AdminCounts } from "@/hooks/useAdminMenu";
import { useT } from "@/i18n/LocaleContext";
import { cn } from "@/lib/utils";
import { adminNavFor, type AdminNavGroup, type AdminNavItem } from "./adminNav";
import CountBadge from "./CountBadge";

/**
 * The admin interface's frame: a sidebar on the right with the tasks, the
 * screen beside it. Below 900px the sidebar becomes a band across the top,
 * its rows wrapping and its group titles dropped.
 *
 * A layout route only — it sits inside AdminRoute or StaffRoute in App.jsx,
 * which decide who gets in. With `adminOnly` (the personal area, which every
 * signed-in client also has) anyone but the admin gets the bare page.
 */
const ROW =
  "relative flex items-center gap-3 min-h-11 px-3 text-[15px] text-foreground rounded-sm transition-colors duration-200 hover:bg-nav-active/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring";

/** The active row: the tint, and a bronze bar on the outer edge. */
const ACTIVE = "bg-nav-active before:absolute before:inset-y-0 before:start-0 before:w-[3px] before:bg-accent";

function SidebarLink({ item, counts }: { item: AdminNavItem; counts: AdminCounts }) {
  const Icon = item.icon;
  return (
    <NavLink to={item.to} end={item.end} className={({ isActive }) => cn(ROW, isActive && ACTIVE)}>
      <Icon size={18} strokeWidth={1.5} aria-hidden="true" className="shrink-0 text-accent" />
      <span>{item.label}</span>
      {item.counter ? <CountBadge count={counts[item.counter.key]} label={item.counter.label} className="ms-auto" /> : null}
    </NavLink>
  );
}

function SidebarGroup({ group, counts }: { group: AdminNavGroup; counts: AdminCounts }) {
  const titleId = useId();
  return (
    <div
      role={group.title ? "group" : undefined}
      aria-labelledby={group.title ? titleId : undefined}
      className="flex flex-wrap gap-1 min-[900px]:flex-col min-[900px]:flex-nowrap"
    >
      {group.title ? (
        <p id={titleId} className="hidden min-[900px]:block px-3 pt-1 pb-1 text-xs text-accent">
          {group.title}
        </p>
      ) : null}
      {group.items.map((item) => (
        <SidebarLink key={item.to} item={item} counts={counts} />
      ))}
    </div>
  );
}

export default function AdminLayout({ adminOnly = false }: { adminOnly?: boolean }) {
  const access = useAdminAccess();
  const counts = useAdminCounts(access);
  const { logout } = useAuth();
  const t = useT("common");

  if (!access || (adminOnly && access !== "admin")) return <Outlet />;

  const groups = adminNavFor(access, MASLEKA_ENABLED);
  return (
    <div dir="rtl" className="min-h-screen bg-background min-[900px]:flex">
      <aside className="print:hidden shrink-0 flex flex-col bg-surface border-b border-border min-[900px]:w-64 min-[900px]:h-screen min-[900px]:sticky min-[900px]:top-0 min-[900px]:border-b-0 min-[900px]:border-e">
        <div className="flex items-center gap-3 px-5 py-4 min-[900px]:py-6 border-b border-border">
          <span
            aria-hidden="true"
            className="w-[38px] h-[38px] shrink-0 flex items-center justify-center border border-highlight font-heading text-[19px] text-accent"
          >
            {t("brand.monogram")}
          </span>
          <span className="flex flex-col leading-tight">
            <span className="font-heading text-lg font-medium">{t("brand.name")}</span>
            <span className="text-[13px] text-muted-foreground">ממשק ניהול</span>
          </span>
        </div>
        <nav
          aria-label="ממשק ניהול"
          className="flex-1 overflow-y-auto px-3 py-3 flex flex-wrap gap-1 min-[900px]:py-5 min-[900px]:flex-col min-[900px]:flex-nowrap min-[900px]:gap-5"
        >
          {groups.map((group) => (
            <SidebarGroup key={group.title ?? "main"} group={group} counts={counts} />
          ))}
        </nav>
        <div className="border-t border-border px-3 py-3 flex flex-wrap gap-1 min-[900px]:flex-col">
          <Link to="/" className={ROW}>
            <ExternalLink size={18} strokeWidth={1.5} aria-hidden="true" className="shrink-0 text-accent" />
            <span>צפייה באתר</span>
          </Link>
          {/* Home rather than this page: the guard would bounce a signed-out visitor to the login screen. */}
          <button type="button" onClick={() => logout(true, `${window.location.origin}/`)} className={cn(ROW, "text-start min-[900px]:w-full")}>
            <LogOut size={18} strokeWidth={1.5} aria-hidden="true" className="shrink-0 text-accent" />
            <span>{t("header.logout")}</span>
          </button>
        </div>
      </aside>
      <div className="flex-1 min-w-0">
        <Outlet />
      </div>
    </div>
  );
}
