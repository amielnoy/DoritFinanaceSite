import React, { useId } from "react";
import { Link, NavLink, Outlet, useLocation, useSearchParams } from "react-router-dom";
import { ChevronLeft, ExternalLink, LayoutGrid, LogOut, UserRound } from "lucide-react";
import { useAuth } from "@/lib/AuthContext";
import { useTheme } from "@/hooks/useTheme";
import ThemeSwitch from "@/components/dorit/primitives/ThemeSwitch";
import { OPERATOR_LABEL, ROLE_LABELS } from "@/config/permissions";
import { MASLEKA_ENABLED } from "@/config/masleka";
import { useAdminAccess, useAdminCounts, type AdminCounts } from "@/hooks/useAdminMenu";
import { useCurrentAgency } from "@/hooks/useAgency";
import { useT } from "@/i18n/LocaleContext";
import { cn } from "@/lib/utils";
import { adminNavFor, type AdminNavGroup, type AdminNavItem } from "./adminNav";
import CountBadge from "./CountBadge";

/**
 * The admin interface's frame: a sidebar on the right with the tasks, the
 * screen beside it. Below 900px the sidebar becomes a band across the top,
 * its rows wrapping and its group titles dropped.
 *
 * A layout route only — it sits inside AgencyRoute in App.jsx, which decides
 * who gets in. With `adminOnly` (the personal area, which every signed-in
 * client also has) anyone but the platform operator gets the bare page.
 *
 * Someone in more than one agency gets a switcher; the choice lives in the
 * URL (`?agency=`), and every sidebar link carries it on.
 */
const ROW =
  "group relative flex items-center gap-3 min-h-11 px-3 text-[15px] text-foreground/75 rounded-xl transition-colors duration-200 hover:bg-secondary hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring";

/** The current row: warm gold by day, a blue glow by night, with a bar on its start edge. */
const ACTIVE =
  "font-bold text-foreground bg-amber-50 hover:bg-amber-50 dark:bg-primary/20 dark:hover:bg-primary/20 dark:shadow-[0_0_24px_-8px_hsl(var(--primary))] before:absolute before:inset-y-1 before:start-0 before:w-1 before:rounded-full before:bg-amber-600 dark:before:bg-primary";

/** The row's icon takes the current row's colour. */
const ICON = "shrink-0 group-aria-[current=page]:text-amber-700 dark:group-aria-[current=page]:text-blue-400";

/** The menu's counter: amber, so it stands apart from the blue of the screens. */
const COUNTER = "rounded-md bg-amber-700 text-white font-bold dark:bg-amber-500/25 dark:text-amber-300 dark:ring-1 dark:ring-amber-500/50";

function SidebarLink({ item, counts }: { item: AdminNavItem; counts: AdminCounts }) {
  const Icon = item.icon;
  const [params] = useSearchParams();
  const agency = params.get("agency");
  return (
    <NavLink to={agency ? { pathname: item.to, search: `?agency=${encodeURIComponent(agency)}` } : item.to} end={item.end} className={({ isActive }) => cn(ROW, isActive && ACTIVE)}>
      {({ isActive }) => (
        <>
          <Icon size={19} strokeWidth={1.6} aria-hidden="true" className={ICON} />
          <span>{item.label}</span>
          {item.counter || item.alert || isActive ? (
            <span className="ms-auto flex items-center gap-1.5">
              {item.counter ? <CountBadge count={counts[item.counter.key]} label={item.counter.label} className={COUNTER} /> : null}
              {item.alert ? <CountBadge count={counts[item.alert.key]} label={item.alert.label} tone="alert" className="rounded-md font-bold" /> : null}
              {/* Seen only: the link already says aria-current="page". A dot by night. */}
              {isActive && !item.counter && !item.alert ? (
                <span aria-hidden="true" className="flex items-center">
                  <span className="rounded-md bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:hidden">נוכחי</span>
                  <span className="hidden h-1.5 w-1.5 rounded-full bg-blue-400 dark:block" />
                </span>
              ) : null}
            </span>
          ) : null}
        </>
      )}
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
        <p id={titleId} className="hidden min-[900px]:block px-3 pt-1 pb-1.5 text-xs font-semibold tracking-wider text-muted-foreground">
          {group.title}
        </p>
      ) : null}
      {group.items.map((item) => (
        <SidebarLink key={item.to} item={item} counts={counts} />
      ))}
    </div>
  );
}

/** Which agency the screens act on — only for someone in more than one. */
export function AgencySwitcher() {
  const { agencyId, agencies, setAgency } = useCurrentAgency();
  const id = useId();
  if (agencies.length < 2) return null;
  return (
    <div className="px-5 py-3 border-b border-border">
      <label htmlFor={id} className="block text-xs text-muted-foreground mb-1">
        סוכנות
      </label>
      <select
        id={id}
        value={agencyId}
        onChange={(e) => setAgency(e.target.value)}
        className="w-full min-h-11 rounded-lg border border-border bg-background px-2 text-sm"
      >
        {agencies.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </select>
    </div>
  );
}

export default function AdminLayout({ adminOnly = false }: { adminOnly?: boolean }) {
  const access = useAdminAccess();
  const counts = useAdminCounts(access);
  const { user, logout } = useAuth();
  const t = useT("common");
  const { pathname } = useLocation();
  const [dark, setDark] = useTheme();
  const { agencyId, agencies } = useCurrentAgency();
  const agencyName = agencies.find((a) => a.id === agencyId)?.name;

  if (!access || (adminOnly && access !== "operator")) return <Outlet />;

  const groups = adminNavFor(access, MASLEKA_ENABLED);
  const current = groups
    .flatMap((group) => group.items)
    .find((item) => (item.end ? pathname === item.to : pathname === item.to || pathname.startsWith(`${item.to}/`)));
  const name = (typeof user?.full_name === "string" && user.full_name) || (typeof user?.email === "string" && user.email) || "";
  return (
    <div dir="rtl" className="min-h-screen bg-background font-body text-base min-[900px]:flex">
      <aside className="print:hidden shrink-0 flex flex-col bg-surface border-b border-border min-[900px]:w-72 min-[900px]:h-screen min-[900px]:sticky min-[900px]:top-0 min-[900px]:border-b-0 min-[900px]:border-e">
        <div className="flex items-center gap-3 px-5 py-4 border-b border-border min-[900px]:py-5">
          <span
            aria-hidden="true"
            className="w-11 h-11 shrink-0 flex items-center justify-center rounded-xl border-2 border-amber-500/70 bg-amber-50 text-amber-800 font-heading text-lg font-bold shadow-sm dark:bg-secondary dark:text-amber-400"
          >
            {t("brand.monogram")}
          </span>
          <span className="flex min-w-0 flex-col leading-tight">
            <span className="font-heading text-lg font-bold">{t("brand.name")}</span>
            <span className="truncate text-xs text-muted-foreground">
              ממשק ניהול
              {agencyName ? (
                <>
                  <span aria-hidden="true"> · </span>
                  <span className="font-medium text-amber-700 dark:text-amber-400">{agencyName}</span>
                </>
              ) : null}
            </span>
          </span>
        </div>
        <AgencySwitcher />
        <nav
          aria-label="ממשק ניהול"
          className="flex-1 overflow-y-auto px-3 py-3 flex flex-wrap gap-1 min-[900px]:py-4 min-[900px]:flex-col min-[900px]:flex-nowrap min-[900px]:gap-5"
        >
          {groups.map((group) => (
            <SidebarGroup key={group.title ?? "main"} group={group} counts={counts} />
          ))}
        </nav>
        <div className="border-t border-border px-3 py-3 flex flex-wrap gap-1 min-[900px]:flex-col">
          <Link to="/" className={ROW}>
            <ExternalLink size={18} strokeWidth={1.6} aria-hidden="true" className="shrink-0" />
            <span>צפייה באתר</span>
          </Link>
          <button type="button" onClick={() => logout(true, `${window.location.origin}/`)} className={cn(ROW, "text-start text-destructive hover:bg-destructive/10 hover:text-destructive min-[900px]:w-full")}>
            <LogOut size={18} strokeWidth={1.6} aria-hidden="true" className="shrink-0 ltr:rotate-180" />
            <span>{t("header.logout")}</span>
          </button>
          <div className="hidden min-[900px]:flex items-center gap-3 mt-2 px-3 pt-3 border-t border-border">
            <span aria-hidden="true" className="w-9 h-9 shrink-0 rounded-full bg-nav-active text-accent flex items-center justify-center">
              <UserRound size={18} strokeWidth={1.5} />
            </span>
            <span className="min-w-0 leading-tight">
              <span className="block text-sm font-semibold truncate">{name}</span>
              <span className="block text-xs text-muted-foreground">{access === "operator" ? OPERATOR_LABEL : ROLE_LABELS[access]}</span>
            </span>
          </div>
        </div>
      </aside>
      <div className="flex-1 min-w-0">
        <header className="print:hidden flex items-center justify-between gap-4 min-h-16 px-6 py-3 bg-surface border-b border-border">
          <div className="flex items-center gap-2 text-sm min-w-0">
            <span aria-hidden="true" className="w-8 h-8 shrink-0 rounded-lg bg-nav-active text-accent flex items-center justify-center">
              <LayoutGrid size={16} strokeWidth={1.75} />
            </span>
            <span className="text-muted-foreground">ממשק ניהול</span>
            {current ? (
              <>
                <ChevronLeft size={14} aria-hidden="true" className="text-muted-foreground" />
                <span className="font-semibold truncate">{current.label}</span>
              </>
            ) : null}
          </div>
          <ThemeSwitch dark={dark} onChange={setDark} />
        </header>
        <Outlet />
      </div>
    </div>
  );
}
