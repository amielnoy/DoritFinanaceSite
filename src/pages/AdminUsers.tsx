import React, { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import Eyebrow from "@/components/dorit/primitives/Eyebrow";
import InviteUserDialog from "@/components/dorit/admin/InviteUserDialog";
import AgencyMembers from "@/components/dorit/admin/AgencyMembers";
import { useAgencyRole, useCurrentAgency } from "@/hooks/useAgency";
import { useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Search } from "lucide-react";
import { services } from "@/services";
import type { AdminUser } from "@/services/ports";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import OrgChips from "@/components/dorit/org/OrgChips";
import OrgFilter from "@/components/dorit/org/OrgFilter";
import { useSeo } from "@/lib/seo";
import {
  SITE_ROLE_LABEL,
  directoryFor,
  displayName,
  filterUsers,
  orgsOf,
  primaryOrg,
  sortUsers,
  type SortDir,
  type SortKey,
} from "@/lib/admin-users";

/**
 * /admin/users — the accounts and the organizations they belong to (user,
 * 2026-10-15). Search and the organization filter combine, and live in the
 * URL (?q=…&org=a,b&sort=…&dir=…) so a view can be shared and survives a
 * refresh. From 640px up a sortable table, below it cards with the same data.
 *
 * The table's organization column is the organization indicator there, so its
 * avatars carry no badge; the cards, which have no such column, keep it.
 */

const SORTABLE: { key: SortKey; label: string }[] = [
  { key: "name", label: "משתמש/ת" },
  { key: "role", label: "תפקיד" },
  { key: "org", label: "ארגון" },
];

const initial = (u: AdminUser) => (displayName(u)[0] ?? "?").toUpperCase();

export default function AdminUsers() {
  useSeo({ title: "ניהול משתמשים", description: "ניהול משתמשים", path: "/admin/users", noIndex: true });
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const selected = useMemo(() => (params.get("org") ?? "").split(",").filter(Boolean), [params]);
  const sort: SortKey = (["name", "role", "org"] as const).find((k) => k === params.get("sort")) ?? "name";
  const dir: SortDir = params.get("dir") === "desc" ? "desc" : "asc";

  const update = (patch: Record<string, string | null>) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const [k, v] of Object.entries(patch)) {
          if (v) next.set(k, v);
          else next.delete(k);
        }
        return next;
      },
      { replace: true },
    );

  // The field answers at once; the URL and the list follow 200ms after the last key.
  const [draft, setDraft] = useState(q);
  useEffect(() => {
    if (draft === q) return;
    const t = setTimeout(() => update({ q: draft.trim() ? draft : null }), 200);
    return () => clearTimeout(t);
  }, [draft]); // eslint-disable-line react-hooks/exhaustive-deps

  const { data: users, isLoading, error } = useQuery({ queryKey: ["admin", "users"], queryFn: () => services.usersAdmin.list() });
  const { agencyId } = useCurrentAgency();
  const { can } = useAgencyRole(agencyId);
  const all = users ?? [];
  const dirOrgs = useMemo(() => directoryFor(all), [all]);
  const orgs = useMemo(() => [...dirOrgs.values()].sort((a, b) => a.name.localeCompare(b.name, "he")), [dirOrgs]);
  const shown = useMemo(() => sortUsers(filterUsers(all, q, selected), sort, dir), [all, q, selected, sort, dir]);
  const filtering = q.trim() !== "" || selected.length > 0;

  const clear = () => {
    setDraft("");
    update({ q: null, org: null });
  };
  const sortBy = (key: SortKey) => update({ sort: key === "name" ? null : key, dir: key === sort && dir === "asc" ? "desc" : null });

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border/60 bg-card">
        <div className="max-w-[1200px] mx-auto px-6 py-5 flex flex-wrap items-center justify-between gap-4">
          <div>
            <Eyebrow>תוכן והגדרות</Eyebrow>
            <h1 className="font-heading text-2xl md:text-3xl mt-1">ניהול משתמשים</h1>
          </div>
          {can("members.manageUsers") ? <InviteUserDialog /> : null}
        </div>
      </header>

      <main id="main" className="max-w-[1200px] mx-auto px-6 py-8 flex flex-col gap-5">
        <AgencyMembers />
        <div className="flex flex-col gap-3">
          <label className="relative block max-w-md">
            <span className="sr-only">חיפוש משתמשים</span>
            <Search size={16} aria-hidden="true" className="pointer-events-none absolute top-1/2 -translate-y-1/2 start-3 text-muted-foreground" />
            <input
              type="search"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              aria-label="חיפוש משתמשים"
              placeholder="שם, תפקיד או ארגון"
              className="w-full min-h-11 rounded-md border border-border bg-background ps-9 pe-3 text-[15px]"
            />
          </label>
          {orgs.length > 0 ? <OrgFilter orgs={orgs} selected={selected} onChange={(ids) => update({ org: ids.join(",") || null })} /> : null}
        </div>

        {error ? (
          <p role="alert" className="text-destructive">
            לא הצלחנו לטעון את המשתמשים. נסו לרענן.
          </p>
        ) : null}

        {!isLoading && !error ? (
          <p role="status" className="text-sm text-muted-foreground">
            מציג {shown.length} מתוך {all.length} משתמשים
          </p>
        ) : null}

        {isLoading ? (
          <div aria-busy="true" aria-label="טוען משתמשים" className="flex flex-col gap-3">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} data-testid="user-skeleton" className="flex items-center gap-3 rounded-md border border-border/60 p-3">
                <Skeleton className="h-10 w-10 rounded-full" />
                <div className="flex flex-1 flex-col gap-2">
                  <Skeleton className="h-4 w-1/3" />
                  <Skeleton className="h-3 w-1/5" />
                </div>
              </div>
            ))}
          </div>
        ) : !error && shown.length === 0 ? (
          <div className="flex flex-col items-start gap-3 rounded-md border border-border/60 p-6">
            <p className="m-0 font-heading text-xl">{filtering ? "לא נמצאו משתמשים שמתאימים לחיפוש" : "עדיין אין משתמשים"}</p>
            {filtering ? (
              <button type="button" onClick={clear} className="min-h-11 rounded-md border border-border px-4 hover:border-highlight">
                ניקוי סינון
              </button>
            ) : null}
          </div>
        ) : !error ? (
          <>
            {/* From 640px: the table. Its organization column is the indicator, so no avatar badge here. */}
            <table className="hidden w-full border-collapse text-start min-[680px]:table">
              <thead>
                <tr className="border-b border-border">
                  {SORTABLE.map(({ key, label }) => (
                    <th
                      key={key}
                      scope="col"
                      aria-sort={sort === key ? (dir === "asc" ? "ascending" : "descending") : "none"}
                      className="py-2 text-start font-medium"
                    >
                      <button type="button" onClick={() => sortBy(key)} className="inline-flex min-h-11 items-center gap-1 hover:text-accent">
                        {label}
                        {sort === key ? dir === "asc" ? <ArrowUp size={14} aria-hidden="true" /> : <ArrowDown size={14} aria-hidden="true" /> : null}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shown.map((u) => (
                  <tr key={u.id} className="border-b border-border/60">
                    <td className="py-3">
                      <span className="inline-flex items-center gap-3">
                        <Avatar>
                          <AvatarFallback>{initial(u)}</AvatarFallback>
                        </Avatar>
                        <bdi dir="ltr">{displayName(u)}</bdi>
                      </span>
                    </td>
                    <td className="py-3">{SITE_ROLE_LABEL[u.role]}</td>
                    <td className="py-3">
                      <OrgChips orgs={orgsOf(u, dirOrgs)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Below 640px: the same users as cards, the avatar carrying the primary organization's badge. */}
            <ul aria-label="משתמשים" className="m-0 flex list-none flex-col gap-3 p-0 min-[680px]:hidden">
              {shown.map((u) => {
                const primary = primaryOrg(u, dirOrgs);
                return (
                  <li key={u.id} className="flex items-start gap-3 rounded-md border border-border/60 p-3">
                    <Avatar org={primary} size={44}>
                      <AvatarFallback>{initial(u)}</AvatarFallback>
                    </Avatar>
                    <div className="flex min-w-0 flex-col gap-1.5">
                      <bdi dir="ltr" className="truncate font-medium">
                        {displayName(u)}
                      </bdi>
                      <span className="text-sm text-muted-foreground">{SITE_ROLE_LABEL[u.role]}</span>
                      <OrgChips orgs={orgsOf(u, dirOrgs)} />
                    </div>
                  </li>
                );
              })}
            </ul>
          </>
        ) : null}
      </main>
    </div>
  );
}
