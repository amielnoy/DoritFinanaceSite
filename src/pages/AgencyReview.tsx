import React, { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { ACTIVATION_GATES, ONBOARDING_STEPS } from "@/config/onboarding";
import { services, type OnboardingOutcome, type OnboardingRow } from "@/services";
import { onboardingKeys, useInProgressAgencies, useOnboardingRecord } from "@/hooks/useOnboarding";
import { disclosurePreview, getField, missingKeys, type Gender, type OnboardingDraft } from "@/lib/onboarding-draft";
import { useSeo } from "@/lib/seo";
import { LICENCE_TYPE_LABELS } from "@/components/dorit/onboarding/fields";
import { agentPhotoBase, portraitFor } from "@/lib/portrait";

const STATUS_LABEL: Record<string, string> = { draft: "בהקמה", pending_review: "ממתינה לאישור", active: "פעילה", suspended: "מושעית" };
const LABEL = new Map(ONBOARDING_STEPS.flatMap((s) => s.fields).flatMap((f) => [f.key, ...(f.alsoWrites ?? [])].map((k) => [k, f.label] as const)));
const GENDER_LABEL: Record<string, string> = { f: "נקבה", m: "זכר" };
const REVIEW_SITE_LABEL: Record<string, string> = { google: "Google", midrag: "מידרג" };

/** A filled field as the operator reads it: words, never stored codes or JSON. */
function shown(key: string, v: unknown): string {
  if (v === null || v === undefined || v === "") return "";
  if (key === "agents.grammatical_gender") return GENDER_LABEL[String(v)] ?? String(v);
  if (key === "agents.licence_types" && Array.isArray(v)) return v.map((x) => LICENCE_TYPE_LABELS[String(x)] ?? String(x)).join(", ");
  if (key === "agents.meeting_minutes") return `${String(v)} דקות`;
  if (key === "agents.stats" && Array.isArray(v)) return (v as { num?: string; label?: string }[]).map((r) => `${r.num ?? ""} ${r.label ?? ""}`.trim()).filter(Boolean).join(" · ");
  if (key === "agents.review_links" && typeof v === "object") return Object.entries(v as Record<string, string>).map(([k, u]) => `${REVIEW_SITE_LABEL[k] ?? k}: ${u}`).join("\n");
  if (Array.isArray(v)) return v.map(String).join(", ");
  if (v === true) return "כן";
  if (v === false) return "לא";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}
const GATE_LABEL = new Map<string, string>(ACTIVATION_GATES.map((g) => [g.key, g.label]));
const text = (v: unknown) => (typeof v === "string" ? v : "");
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("he-IL", { timeZone: "Asia/Jerusalem", dateStyle: "short", timeStyle: "short" }) : "—");
const BUTTON = "min-h-11 rounded-md border border-border px-4 text-sm hover:border-accent disabled:opacity-40";

/** The operator's list: draft and pending agencies, last edited first. */
export function InProgressAgencies() {
  const list = useInProgressAgencies();
  return (
    <section aria-labelledby="in-progress" className="rounded-2xl border border-border bg-card p-5 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 id="in-progress" className="text-base font-bold">סוכנויות בהקמה</h2>
        <Link to="/admin/agencies/new" className="inline-flex min-h-11 items-center rounded-md bg-accent px-4 text-sm font-medium text-accent-foreground">סוכנות חדשה</Link>
      </div>
      {list.isPending ? (
        <p className="text-sm text-muted-foreground">טוען…</p>
      ) : !list.data?.length ? (
        <p className="text-sm text-muted-foreground">אין סוכנויות בהקמה.</p>
      ) : (
        <ul className="divide-y divide-border">
          {list.data.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
              <div>
                <p className="font-medium">{a.name}</p>
                <p className="text-xs text-muted-foreground">
                  {STATUS_LABEL[a.status] ?? a.status} · {a.ownerEmail ?? "—"} · נערכה לאחרונה {when(a.lastEdited)}
                </p>
              </div>
              <div className="flex gap-2">
                <Link to={`/admin/agencies/${a.id}/review`} className={BUTTON + " inline-flex items-center"}>סקירה</Link>
                <Link to={`/admin/onboarding/${a.id}`} className={BUTTON + " inline-flex items-center"}>האשף</Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** /admin/agencies — the operator's list on its own. */
export function AgenciesIndex() {
  useSeo({ title: "סוכנויות בהקמה", description: "סוכנויות בהקמה", path: "/admin/agencies", noIndex: true });
  return (
    <main id="main" className="mx-auto max-w-[1000px] px-6 py-8">
      <h1 className="mb-6 font-heading text-3xl font-bold">סוכנויות</h1>
      <InProgressAgencies />
    </main>
  );
}

/**
 * /admin/agencies/:id/review — the operator checks a new agency and activates
 * it. The three gates block "הפעלה" (activate_agency re-checks them): the
 * licence checked on the regulator's register, the processing agreement's
 * date, the disclosure sentences approved. "החזרה לתיקונים" sends it back to
 * draft with a note the owner sees in the wizard.
 */
export default function AgencyReview() {
  const { agencyId = "" } = useParams();
  useSeo({ title: "סקירת סוכנות", description: "סקירת סוכנות חדשה", path: `/admin/agencies/${agencyId}/review`, noIndex: true });
  const client = useQueryClient();
  const record = useOnboardingRecord(agencyId);
  const [note, setNote] = useState("");
  const [outcome, setOutcome] = useState<OnboardingOutcome | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dpa, setDpa] = useState<string | null>(null);
  const [ops, setOps] = useState<Record<string, string> | null>(null);
  /** Which save just went through, said beside its own button. */
  const [savedNote, setSavedNote] = useState<"dpa" | "operator" | null>(null);

  const refresh = () => Promise.all([
    client.invalidateQueries({ queryKey: onboardingKeys.record(agencyId) }),
    client.invalidateQueries({ queryKey: onboardingKeys.inProgress }),
  ]);
  const act = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      const r = await work();
      if (r && typeof r === "object" && "ok" in r) setOutcome(r as OnboardingOutcome);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (record.isPending) return <p className="p-10 text-center text-muted-foreground">טוען…</p>;
  if (record.isError || !record.data) return <p role="alert" className="p-10 text-center text-destructive">{(record.error as Error)?.message ?? "הסוכנות לא נמצאה."}</p>;

  const r = record.data;
  const draft: OnboardingDraft = { agencies: r.agencies, agency_profiles: r.agency_profiles, agents: r.agents };
  const status = text(r.agencies.status);
  const review = ((r.agency_profiles.onboarding as OnboardingRow | undefined)?.review ?? {}) as OnboardingRow;
  const agentId = text(r.agents?.id);
  const licenceVerified = Boolean(r.agents?.licence_verified_at);
  const dpaDate = dpa ?? (text(r.agencies.data_processing_agreement_date) || "");
  const disclosuresApproved = Boolean(r.agency_profiles.disclosures_approved_at);
  const operatorFields = ops ?? {
    domain: text(r.agency_profiles.domain),
    mail_from: text(r.agency_profiles.mail_from),
    ga4_measurement_id: text(r.agency_profiles.ga4_measurement_id),
  };
  const missing = missingKeys(draft);
  const disclosure = disclosurePreview({
    entity: text(getField(draft, "agency_profiles.licence_entity")),
    gender: getField(draft, "agents.grammatical_gender") as Gender | null,
    regulator: text(getField(draft, "agents.licence_regulator")),
    number: text(getField(draft, "agents.licence_number")),
    affiliated: getField(draft, "agents.has_institutional_affiliation") as boolean | null,
    name: text(getField(draft, "agents.full_name")),
  });
  /** One filled field: the portrait as the picture itself, the phone as the owner typed it, the rest in words. */
  const detail = (key: string): React.ReactNode => {
    if (key === "agents.photo_path") {
      const portrait = portraitFor(
        { agencyId, photoPath: text(getField(draft, key)) || null, photoAlt: text(getField(draft, "agents.photo_alt")) || null, fullName: text(getField(draft, "agents.full_name")) },
        agentPhotoBase(import.meta.env.VITE_SUPABASE_URL),
      );
      return portrait.kind === "photo" ? <img src={portrait.src} alt={portrait.alt} className="h-24 w-24 rounded-full object-cover" /> : "—";
    }
    if (key === "agency_profiles.phone_e164") return <span dir="ltr">{text(getField(draft, "agency_profiles.phone_display")) || "—"}</span>;
    return shown(key, getField(draft, key)) || "—";
  };
  const saveThen = (which: "dpa" | "operator", work: () => Promise<unknown>) => {
    setSavedNote(null);
    void act(async () => {
      await work();
      setSavedNote(which);
    });
  };
  const savedMark = (which: "dpa" | "operator") => (savedNote === which ? <span role="status" className="text-sm text-emerald-700 dark:text-emerald-400">נשמר ✓</span> : null);

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-[1000px] px-6 pt-8">
        <h1 className="font-heading text-3xl font-bold">{text(r.agencies.name)}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {STATUS_LABEL[status] ?? status} · הבעלים: {text(review.owner_email) || "—"} · נערכה לאחרונה {when(text(r.agency_profiles.updated_at) || null)}
        </p>
      </div>
      <main id="main" className="mx-auto max-w-[1000px] space-y-6 px-6 py-6">
        <section aria-labelledby="gates" className="rounded-2xl border border-border bg-card p-5 shadow-sm">
          <h2 id="gates" className="mb-4 text-base font-bold">תנאי ההפעלה</h2>
          <ol className="space-y-4 text-sm">
            <li className="space-y-2">
              <p className="font-medium">1. {GATE_LABEL.get("agents.licence_verified_at")} {licenceVerified ? "✓" : ""}</p>
              <p className="text-muted-foreground">מספר הרישיון: <span dir="ltr">{text(r.agents?.licence_number) || "—"}</span> · {text(r.agents?.full_name) || "—"}</p>
              <button type="button" className={BUTTON} disabled={busy || !agentId} onClick={() => void act(() => services.onboarding.setLicenceVerified(agentId, !licenceVerified))}>
                {licenceVerified ? "ביטול הסימון" : "בדקתי את הרישיון במרשם"}
              </button>
            </li>
            <li className="space-y-2">
              <p className="font-medium">2. {GATE_LABEL.get("agencies.data_processing_agreement_date")} {text(r.agencies.data_processing_agreement_date) ? "✓" : ""}</p>
              <div className="flex flex-wrap items-center gap-2">
                <input type="date" aria-label="תאריך הסכם עיבוד הנתונים" value={dpaDate} onChange={(e) => { setDpa(e.target.value); setSavedNote(null); }} className="min-h-11 rounded-md border border-border bg-card px-2" />
                <button type="button" className={BUTTON} disabled={busy} onClick={() => saveThen("dpa", () => services.onboarding.setDpaDate(agencyId, dpaDate || null))}>שמירת התאריך</button>
                {savedMark("dpa")}
              </div>
            </li>
            <li className="space-y-2">
              <p className="font-medium">3. {GATE_LABEL.get("agency_profiles.disclosures_approved_at")} {disclosuresApproved ? "✓" : ""}</p>
              <blockquote className="rounded-xl bg-background p-3">
                <p>{disclosure.licence}</p>
                <p className="mt-2">{disclosure.bot}</p>
              </blockquote>
              <button type="button" className={BUTTON} disabled={busy} onClick={() => void act(() => services.onboarding.setDisclosuresApproved(agencyId, !disclosuresApproved))}>
                {disclosuresApproved ? "ביטול האישור" : "אישרתי את הנוסחים"}
              </button>
            </li>
          </ol>
        </section>

        <section aria-labelledby="operator" className="rounded-2xl border border-border bg-card p-5 shadow-sm">
          <h2 id="operator" className="mb-4 text-base font-bold">הגדרות המפעיל</h2>
          <div className="grid gap-3 md:grid-cols-3">
            {[
              ["domain", "דומיין"],
              ["mail_from", "כתובת השולח"],
              ["ga4_measurement_id", "GA4"],
            ].map(([k, label]) => (
              <label key={k} className="text-sm">
                {label}
                <input dir="ltr" value={operatorFields[k]} onChange={(e) => { setOps({ ...operatorFields, [k]: e.target.value }); setSavedNote(null); }} className="mt-1 w-full min-h-11 rounded-md border border-border bg-card px-2 text-left" />
              </label>
            ))}
          </div>
          <div className="mt-3 flex items-center gap-3">
            <button
              type="button"
              className={BUTTON}
              disabled={busy}
              onClick={() => saveThen("operator", () => services.onboarding.setOperatorFields(agencyId, Object.fromEntries(Object.entries(operatorFields).map(([k, v]) => [k, v.trim() || null]))))}
            >
              שמירה
            </button>
            {savedMark("operator")}
          </div>
        </section>

        <section aria-labelledby="details" className="rounded-2xl border border-border bg-card p-5 shadow-sm">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h2 id="details" className="text-base font-bold">הפרטים שמולאו</h2>
            <Link to={`/admin/onboarding/${agencyId}`} className={BUTTON + " inline-flex items-center"}>עריכה באשף</Link>
          </div>
          {missing.length ? <p className="mb-3 text-sm text-amber-700 dark:text-amber-400">חסרים: {missing.map((k) => LABEL.get(k) ?? k).join(" · ")}</p> : null}
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            {ONBOARDING_STEPS.filter((s) => s.number > 0).flatMap((s) => s.fields).map((f) => (
              <React.Fragment key={f.key}>
                <dt className="text-muted-foreground">{f.label}</dt>
                <dd className="whitespace-pre-wrap break-words">{detail(f.key)}</dd>
              </React.Fragment>
            ))}
            <dt className="text-muted-foreground">המלצות</dt>
            <dd>{r.testimonials.length}</dd>
          </dl>
        </section>

        <section aria-labelledby="decide" className="space-y-4 rounded-2xl border border-border bg-card p-5 shadow-sm">
          <h2 id="decide" className="text-base font-bold">החלטה</h2>
          {status === "active" ? (
            <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">הסוכנות פעילה.</p>
          ) : status !== "pending_review" ? (
            <p className="text-sm text-muted-foreground">אפשר להפעיל או להחזיר רק סוכנות שנשלחה לאישור.</p>
          ) : null}
          <button
            type="button"
            disabled={busy || status !== "pending_review"}
            onClick={() => void act(() => services.onboarding.activate(agencyId))}
            className="min-h-11 rounded-md bg-accent px-5 text-sm font-medium text-accent-foreground disabled:opacity-40"
          >
            הפעלה
          </button>
          <label className="block text-sm">
            הערה לבעלים
            <textarea value={note} maxLength={2000} rows={3} onChange={(e) => setNote(e.target.value)} className="mt-1 w-full rounded-md border border-border bg-card p-2" />
          </label>
          <button type="button" disabled={busy || status !== "pending_review" || !note.trim()} onClick={() => void act(() => services.onboarding.returnAgency(agencyId, note))} className={BUTTON}>
            החזרה לתיקונים
          </button>
          {outcome && !outcome.ok ? (
            <div role="alert" className="text-sm text-destructive">
              <p>{outcome.message}</p>
              {outcome.gates.length ? <p>{outcome.gates.map((k) => GATE_LABEL.get(k) ?? k).join(" · ")}</p> : null}
              {outcome.missing.length ? <p>{outcome.missing.map((k) => LABEL.get(k) ?? k).join(" · ")}</p> : null}
            </div>
          ) : outcome?.ok ? (
            <p role="status" className="text-sm text-emerald-700 dark:text-emerald-400">בוצע.</p>
          ) : null}
          {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        </section>

        <InProgressAgencies />
      </main>
    </div>
  );
}
