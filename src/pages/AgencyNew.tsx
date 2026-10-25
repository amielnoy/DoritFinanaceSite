import React, { useState } from "react";
import { Link } from "react-router-dom";
import { ONBOARDING_STEPS } from "@/config/onboarding";
import { services } from "@/services";
import { getField, setField, emptyDraft, fieldProblem } from "@/lib/onboarding-draft";
import { FieldInput } from "@/components/dorit/onboarding/fields";
import { useSeo } from "@/lib/seo";

const OPEN = ONBOARDING_STEPS.find((s) => s.id === "open")!;

/**
 * /admin/agencies/new — step 0, the operator's: name, the owner's email, the
 * processing-agreement date. create_agency opens the draft; the owner is then
 * invited with invite-user, as the users screen invites anyone. A failed
 * invitation leaves the agency open, says so, and can be sent again.
 */
export default function AgencyNew() {
  useSeo({ title: "סוכנות חדשה", description: "פתיחת סוכנות חדשה", path: "/admin/agencies/new", noIndex: true });
  const [draft, setDraft] = useState(() => emptyDraft("", ""));
  const [agencyId, setAgencyId] = useState<string | null>(null);
  const [invited, setInvited] = useState<"no" | "sending" | "sent" | "failed">("no");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const name = String(getField(draft, "agencies.name") ?? "").trim();
  const email = String(getField(draft, "agency_profiles.onboarding.review.owner_email") ?? "").trim();
  const dpa = (getField(draft, "agencies.data_processing_agreement_date") as string | null) || null;
  const emailProblem = fieldProblem("agency_profiles.onboarding.review.owner_email", email);
  const ready = Boolean(name && email && !emailProblem);

  const invite = async (id: string) => {
    setInvited("sending");
    try {
      const r = await services.usersAdmin.invite({ email, orgId: id, role: "owner" });
      setInvited(r.mailed ? "sent" : "failed");
    } catch {
      setInvited("failed");
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-[760px] px-6 pt-8">
        <h1 className="font-heading text-3xl font-bold">סוכנות חדשה</h1>
        <p className="mt-1 text-sm text-muted-foreground">פותחים טיוטה ומזמינים את הבעלים. את שאר הפרטים הם ממלאים באשף — או שממלאים בשבילם.</p>
      </div>
      <main id="main" className="mx-auto max-w-[760px] px-6 py-6">
        {agencyId ? (
          <section className="space-y-4 rounded-2xl border border-border bg-card p-6 shadow-sm">
            <p className="font-medium">הסוכנות ״{name}״ נפתחה כטיוטה.</p>
            {invited === "sent" ? (
              <p role="status" className="text-sm text-emerald-700 dark:text-emerald-400">הזמנה נשלחה אל {email}.</p>
            ) : invited === "sending" ? (
              <p role="status" className="text-sm text-muted-foreground">שולחים הזמנה…</p>
            ) : (
              <div role="alert" className="space-y-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm">
                <p>ההזמנה אל {email} לא נשלחה. הסוכנות פתוחה — אפשר לשלוח שוב.</p>
                <button type="button" onClick={() => void invite(agencyId)} className="min-h-11 rounded-md border border-border bg-card px-4">שליחת ההזמנה שוב</button>
              </div>
            )}
            <div className="flex flex-wrap gap-3">
              <Link to={`/admin/onboarding/${agencyId}`} className="inline-flex min-h-11 items-center rounded-md bg-accent px-4 text-sm font-medium text-accent-foreground">מילוי האשף בשם הבעלים</Link>
              <Link to={`/admin/agencies/${agencyId}/review`} className="inline-flex min-h-11 items-center rounded-md border border-border px-4 text-sm">לסקירה</Link>
            </div>
          </section>
        ) : (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (!ready) return;
              setBusy(true);
              setError(null);
              try {
                const id = await services.onboarding.createAgency({ name, ownerEmail: email, dpaDate: dpa });
                setAgencyId(id);
                await invite(id);
              } catch (err) {
                setError((err as Error).message);
              } finally {
                setBusy(false);
              }
            }}
            className="space-y-5 rounded-2xl border border-border bg-card p-6 shadow-sm"
          >
            {OPEN.fields.map((f) => (
              <FieldInput
                key={f.key}
                field={f}
                value={getField(draft, f.key)}
                onChange={(v) => setDraft((d) => setField(d, f.key, v))}
                problem={f.key.endsWith("owner_email") && email ? emailProblem : null}
              />
            ))}
            {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
            <button type="submit" disabled={!ready || busy} className="min-h-11 rounded-md bg-accent px-5 text-sm font-medium text-accent-foreground disabled:opacity-40">
              פתיחת הסוכנות ושליחת הזמנה
            </button>
          </form>
        )}
      </main>
    </div>
  );
}
