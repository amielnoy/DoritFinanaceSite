import React, { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { canManage, grantableRoles, ROLE_LABELS, type AgencyRole } from "@/config/permissions";
import { adminKeys, useAdminUsers, useLeads } from "@/hooks/useAdmin";
import { useAgencyRole, useCurrentAgency } from "@/hooks/useAgency";
import { useAuth } from "@/lib/AuthContext";
import { displayName } from "@/lib/admin-users";
import { services } from "@/services";

const ROLES = new Set<string>(["owner", "admin", "user"]);
const BUTTON =
  "min-h-11 px-3 rounded-sm border border-border text-sm hover:border-highlight disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring";

/**
 * The current agency's members and what the signed-in person may change
 * (docs/superpowers/specs/2026-10-15-agency-roles-design.md): a role from those
 * they may give, removing a member (whose leads go back to the queue — the
 * screen says how many), leaving, and, for an Owner, handing over ownership.
 *
 * Everything goes through member-admin under the person's own session; the
 * database's set_member_role / remove_member decide, and their refusal is shown
 * as it is. This only hides what a role could not do anyway.
 */
export default function AgencyMembers() {
  const { user } = useAuth();
  const me = typeof user?.id === "string" ? user.id : "";
  const { agencyId, agencies } = useCurrentAgency();
  const { role, isOperator, can } = useAgencyRole(agencyId);
  const users = useAdminUsers();
  const leads = useLeads();
  const client = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [heir, setHeir] = useState("");

  const members = useMemo(
    () =>
      (users.data ?? [])
        .map((u) => ({ user: u, role: u.memberships.find((m) => m.orgId === agencyId)?.role ?? "" }))
        .filter((m): m is { user: (typeof m)["user"]; role: AgencyRole } => ROLES.has(m.role))
        .sort((a, b) => displayName(a.user).localeCompare(displayName(b.user))),
    [users.data, agencyId],
  );
  /** Open leads each member works in this agency — what goes back to the queue with them. */
  const workload = useMemo(() => {
    const count = new Map<string, number>();
    for (const l of leads.data ?? []) {
      if (l.agency_id !== agencyId || !l.assigned_user_id || l.status === "closed") continue;
      count.set(l.assigned_user_id, (count.get(l.assigned_user_id) ?? 0) + 1);
    }
    return count;
  }, [leads.data, agencyId]);

  const change = useMutation({
    mutationFn: (run: () => Promise<void>) => run(),
    onMutate: () => setError(null),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["admin", "users"] });
      void client.invalidateQueries({ queryKey: adminKeys.leads });
      void client.invalidateQueries({ queryKey: ["agency"] });
    },
    onError: (e: Error) => setError(e.message || "הפעולה נכשלה. נסו שוב."),
  });

  const agencyName = agencies.find((a) => a.id === agencyId)?.name ?? "";
  const grantable = grantableRoles(role, isOperator);
  const amMember = members.some((m) => m.user.id === me);

  const remove = (id: string, name: string) => {
    const open = workload.get(id) ?? 0;
    const note = open ? ` ${open} פניות פתוחות שלו/ה יחזרו לתור "לא שויכו".` : "";
    if (!window.confirm(`להסיר את ${name} מהסוכנות?${note}`)) return;
    change.mutate(() => services.usersAdmin.remove(agencyId, id));
  };
  const leave = () => {
    if (!window.confirm(`לעזוב את ${agencyName || "הסוכנות"}? הפניות ששויכו אלייך יחזרו לתור.`)) return;
    change.mutate(() => services.usersAdmin.leave(agencyId));
  };
  const transfer = () => {
    const to = members.find((m) => m.user.id === heir);
    if (!to) return;
    if (!window.confirm(`להעביר את הבעלות ל-${displayName(to.user)}? את/ה תהפוך/י למנהל/ת.`)) return;
    change.mutate(() => services.usersAdmin.transferOwnership(agencyId, heir));
  };

  if (!can("members.view")) return null;
  return (
    <section aria-labelledby="agency-members-title" className="flex flex-col gap-3 rounded-md border border-border/60 p-4">
      <h2 id="agency-members-title" className="m-0 font-heading text-xl">
        חברי הסוכנות{agencyName ? ` — ${agencyName}` : ""}
      </h2>
      {error ? (
        <p role="alert" className="m-0 text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {users.isLoading ? <p className="m-0 text-sm text-muted-foreground">טוען…</p> : null}
      <ul aria-label="חברי הסוכנות" className="m-0 flex list-none flex-col gap-2 p-0">
        {members.map(({ user: u, role: theirs }) => {
          const name = displayName(u);
          const self = u.id === me;
          const manageable = !self && canManage(role, isOperator, theirs);
          return (
            <li key={u.id} className="flex flex-wrap items-center gap-3 border-b border-border/40 pb-2">
              <bdi dir="ltr" className="min-w-[12rem] font-medium">
                {name}
              </bdi>
              {manageable && grantable.length > 1 ? (
                <select
                  aria-label={`התפקיד של ${name}`}
                  value={theirs}
                  disabled={change.isPending}
                  onChange={(e) => {
                    // Read now: the mutation runs later, after React has put
                    // the controlled select back to the current role.
                    const next = e.target.value as AgencyRole;
                    change.mutate(() => services.usersAdmin.setRole(agencyId, u.id, next));
                  }}
                  className="min-h-11 rounded-sm border border-border bg-background px-2 text-sm"
                >
                  {grantable.map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABELS[r]}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="text-sm text-muted-foreground">{ROLE_LABELS[theirs]}</span>
              )}
              {workload.get(u.id) ? <span className="text-xs text-muted-foreground">{workload.get(u.id)} פניות פתוחות</span> : null}
              {manageable ? (
                <button type="button" className={BUTTON} disabled={change.isPending} onClick={() => remove(u.id, name)}>
                  הסרה
                </button>
              ) : null}
              {self ? (
                <button type="button" className={BUTTON} disabled={change.isPending} onClick={leave}>
                  עזיבת הסוכנות
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>
      {can("members.transferOwnership") && amMember && role === "owner" ? (
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-sm">
            העברת בעלות ל
            <select value={heir} onChange={(e) => setHeir(e.target.value)} className="min-h-11 rounded-sm border border-border bg-background px-2">
              <option value="">בחירת חבר/ה</option>
              {members
                .filter((m) => m.user.id !== me)
                .map((m) => (
                  <option key={m.user.id} value={m.user.id}>
                    {displayName(m.user)}
                  </option>
                ))}
            </select>
          </label>
          <button type="button" className={BUTTON} disabled={!heir || change.isPending} onClick={transfer}>
            העברת בעלות
          </button>
        </div>
      ) : null}
    </section>
  );
}
