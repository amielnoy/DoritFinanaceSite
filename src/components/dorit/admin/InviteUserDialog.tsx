import React, { useId, useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { UserPlus, X } from "lucide-react";
import { services, type InviteInput } from "@/services";
import { ORG_ROLE_LABEL } from "@/lib/admin-users";
import { grantableRoles, meets } from "@/config/permissions";
import { useAgencyRole, useCurrentAgency } from "@/hooks/useAgency";

/**
 * "הוספת משתמש": an agency's Admin or Owner (or the platform operator) adds
 * someone to an organization in a role. Only the organizations the person may
 * add to are offered, and only the roles they may give there — an Admin gives
 * User alone; invite-user and set_member_role refuse anything else. The
 * invite-user Edge Function finds or makes the account and mails the
 * invitation — sign-in is Google's, with the invited address — so this form
 * asks for exactly those three things and says what happened.
 *
 * Radix's dialog supplies the modal behaviour: focus kept inside, Escape and
 * the close button returning focus to "הוספת משתמש".
 */
const EMAIL = /^[^\s@<>()[\]\\,;:"]+@[^\s@]+\.[^\s@]{2,}$/;

const FIELD = "w-full min-h-11 px-3 border border-input rounded-sm bg-background text-[15px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring";

export default function InviteUserDialog() {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const { agencyId, agencies } = useCurrentAgency();
  const [orgId, setOrgId] = useState("");
  const [role, setRole] = useState<InviteInput["role"]>("user");
  const chosen = useAgencyRole(orgId || agencyId);
  const roles = grantableRoles(chosen.role, chosen.isOperator);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const ids = { email: useId(), org: useId(), role: useId() };
  const client = useQueryClient();

  const orgs = useQuery({
    queryKey: ["admin", "organizations"],
    queryFn: () => services.usersAdmin.organizations(),
    enabled: open,
    // The operator adds to any; anyone else, to an agency where they are Admin+.
    select: (all) => (chosen.isOperator ? all : all.filter((o) => agencies.some((a) => a.id === o.id && meets(a.role, "admin")))),
  });
  const send = useMutation({
    mutationFn: (input: InviteInput) => services.usersAdmin.invite(input),
    onSuccess: (result, input) => {
      setDone(
        result.mailed
          ? `ההזמנה נשלחה ל-${input.email}.`
          : `${input.email} נוסף לארגון, אבל המייל לא נשלח — אפשר לשלוח לו בעצמכם את הכתובת govari-fin.co.il/login.`,
      );
      void client.invalidateQueries({ queryKey: ["admin", "users"] });
    },
    onError: (e: Error) => setError(e.message || "ההזמנה נכשלה. נסו שוב."),
  });

  const reset = () => {
    setEmail("");
    setOrgId("");
    setRole("user");
    setError(null);
    setDone(null);
    send.reset();
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setDone(null);
    const address = email.trim();
    if (!EMAIL.test(address)) return setError("יש להזין כתובת דוא״ל תקינה.");
    if (!orgId) return setError("יש לבחור ארגון.");
    if (!roles.includes(role)) return setError("אין לך הרשאה לתת את התפקיד הזה בארגון הזה.");
    send.mutate({ email: address, orgId, role });
  };

  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogPrimitive.Trigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-2 min-h-11 px-4 border border-highlight text-accent rounded-sm text-[15px] hover:bg-highlight/5 transition-colors duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
        >
          <UserPlus size={18} strokeWidth={1.5} aria-hidden="true" />
          הוספת משתמש
        </button>
      </DialogPrimitive.Trigger>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-primary/40" />
        <DialogPrimitive.Content
          dir="rtl"
          className="fixed z-50 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[min(92vw,28rem)] max-h-[90vh] overflow-y-auto bg-surface border border-border rounded-sm p-6 shadow-lg focus-visible:outline-none"
        >
          <div className="flex items-start justify-between gap-4">
            <DialogPrimitive.Title className="font-heading text-2xl">הוספת משתמש</DialogPrimitive.Title>
            <DialogPrimitive.Close
              aria-label="סגירה"
              className="w-11 h-11 -mt-2 -me-2 flex items-center justify-center rounded-sm hover:bg-foreground/[0.06] focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
            >
              <X size={18} aria-hidden="true" />
            </DialogPrimitive.Close>
          </div>
          <DialogPrimitive.Description className="text-sm text-muted-foreground mt-2">
            ההזמנה נשלחת במייל. הכניסה באתר עם חשבון Google של הכתובת הזו.
          </DialogPrimitive.Description>

          <form onSubmit={submit} noValidate className="mt-5 flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label htmlFor={ids.email} className="text-sm">כתובת דוא״ל</label>
              <input id={ids.email} type="email" dir="ltr" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} className={FIELD} />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor={ids.org} className="text-sm">ארגון</label>
              <select id={ids.org} value={orgId} onChange={(e) => setOrgId(e.target.value)} className={FIELD} disabled={orgs.isPending}>
                <option value="">{orgs.isPending ? "טוען…" : "בחירת ארגון"}</option>
                {(orgs.data ?? []).map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor={ids.role} className="text-sm">תפקיד</label>
              <select id={ids.role} value={role} onChange={(e) => setRole(e.target.value as InviteInput["role"])} className={FIELD}>
                {roles.map((r) => (
                  <option key={r} value={r}>
                    {ORG_ROLE_LABEL[r]}
                  </option>
                ))}
              </select>
            </div>

            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
            {done ? (
              <p role="status" className="text-sm text-foreground">
                {done}
              </p>
            ) : null}

            <button
              type="submit"
              disabled={send.isPending}
              className="inline-flex justify-center items-center min-h-11 px-5 bg-accent text-accent-foreground rounded-sm text-[15px] disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
            >
              {send.isPending ? "שולח…" : "שליחת הזמנה"}
            </button>
          </form>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
