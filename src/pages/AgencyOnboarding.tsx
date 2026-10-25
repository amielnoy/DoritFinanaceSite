import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Check } from "lucide-react";
import { ONBOARDING_STEPS, isLicenceNumber, missingByStep, type OnboardingField, type StepId } from "@/config/onboarding";
import { services, OnboardingConflictError, type OnboardingRecord, type OnboardingRow } from "@/services";
import { onboardingKeys, useOnboardingRecord } from "@/hooks/useOnboarding";
import {
  defaultLicenceEntity,
  defaultWhatsappMessage,
  disclosurePreview,
  fieldProblem,
  getField,
  isMobile,
  missingKeys,
  phoneFields,
  setField,
  stepPatches,
  type Gender,
  type OnboardingDraft,
} from "@/lib/onboarding-draft";
import { FieldInput } from "@/components/dorit/onboarding/fields";
import OnboardingPreview from "@/components/dorit/onboarding/OnboardingPreview";
import PortraitInput from "@/components/dorit/onboarding/PortraitInput";
import TestimonialsEditor from "@/components/dorit/onboarding/TestimonialsEditor";
import { useSeo } from "@/lib/seo";

/** The owner's steps (1–7); step 0 is the operator's, on /admin/agencies/new. */
const STEPS = ONBOARDING_STEPS.filter((s) => s.number > 0);
const LABEL = new Map(ONBOARDING_STEPS.flatMap((s) => s.fields).map((f) => [f.key, f.label]));

const toDraft = (r: OnboardingRecord): OnboardingDraft => ({ agencies: r.agencies, agency_profiles: r.agency_profiles, agents: r.agents });
const text = (v: unknown) => (typeof v === "string" ? v : "");

/**
 * /admin/onboarding/:agencyId — the new-agency wizard, steps 1–7
 * (docs/superpowers/specs/2026-10-16-new-agency-wizard-design.md), for the
 * agency's owner or the platform operator on their behalf (OnboardingRoute).
 *
 * The forms are src/config/onboarding.ts's own fields; a step saves on
 * "המשך" and on leaving a field, only what changed, and resumes where it was
 * left (`onboarding.last_step`). A save that finds the row changed since the
 * step opened reloads it and says so (OnboardingConflictError).
 */
export default function AgencyOnboarding() {
  const { agencyId = "" } = useParams();
  useSeo({ title: "הקמת סוכנות", description: "הקמת סוכנות חדשה", path: `/admin/onboarding/${agencyId}`, noIndex: true });
  const client = useQueryClient();
  const record = useOnboardingRecord(agencyId);

  /** What the server last said, and what is typed now. */
  const [saved, setSaved] = useState<OnboardingDraft | null>(null);
  const [draft, setDraft] = useState<OnboardingDraft | null>(null);
  const [step, setStep] = useState<StepId | null>(null);
  const [phoneText, setPhoneText] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [submitted, setSubmitted] = useState<{ ok: boolean; missing: string[]; message?: string } | null>(null);
  const loadedFor = useRef<string | null>(null);
  /**
   * Saves run one at a time, each from the latest state: leaving a field and
   * clicking "המשך" a moment later are two saves, and the second must see what
   * the first created — or it creates the licensee a second time.
   */
  const savedRef = useRef<OnboardingDraft | null>(null);
  const draftRef = useRef<OnboardingDraft | null>(null);
  draftRef.current = draft;
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const commitSaved = useCallback((d: OnboardingDraft | null) => {
    savedRef.current = d;
    setSaved(d);
  }, []);

  /** A fresh record replaces the draft entirely (the first load, and after a conflict). */
  const adopt = useCallback((r: OnboardingRecord) => {
    const d = toDraft(r);
    commitSaved(d);
    draftRef.current = d;
    setDraft(d);
    setPhoneText(text(r.agency_profiles.phone_display));
  }, [commitSaved]);

  useEffect(() => {
    if (!record.data || loadedFor.current === agencyId) return;
    loadedFor.current = agencyId;
    adopt(record.data);
    const last = (record.data.agency_profiles.onboarding as OnboardingRow | undefined)?.last_step;
    setStep(STEPS.some((s) => s.id === last) ? (last as StepId) : "licensee");
  }, [record.data, agencyId, adopt]);

  const current = STEPS.find((s) => s.id === step) ?? STEPS[0];
  const gender = (draft ? getField(draft, "agents.grammatical_gender") : null) as Gender | null;
  const g = (f: string, m: string) => (gender === "m" ? m : f);

  /** The checklist as one types; the server's answer replaces it on submit. */
  const missing = useMemo(() => (draft ? missingKeys(draft) : []), [draft]);
  const problems = useMemo(() => {
    const out = new Map<string, string>();
    if (!draft) return out;
    for (const f of current.fields) {
      const p = fieldProblem(f.key, getField(draft, f.key));
      if (p) out.set(f.key, p);
    }
    if (current.id === "contact" && phoneText.trim() && !isMobile(phoneText)) out.set("agency_profiles.phone_e164", "נדרש מספר נייד ישראלי, למשל 052-1234567.");
    if (current.id === "licence") {
      const n = text(getField(draft, "agents.licence_number"));
      if (n.trim() && !isLicenceNumber(n)) out.set("agents.licence_number", "מספר רישיון נראה כמו L-0012345.");
    }
    return out;
  }, [draft, current, phoneText]);

  const update = (key: string, value: unknown) => {
    setDraft((d) => (d ? setField(d, key, value) : d));
    setNotice(null);
  };

  /** Saves the open step; `next` also moves on and remembers where. Resolves false when nothing could be saved. */
  const save = (next?: StepId): Promise<boolean> => {
    if (problems.size) {
      setError("יש שדות שצריך לתקן לפני השמירה.");
      return Promise.resolve(false);
    }
    const keys = current.fields.flatMap((f) => [f.key, ...(f.alsoWrites ?? [])]);
    const run = chain.current.then(() => saveNow(keys, next));
    chain.current = run.catch(() => undefined);
    return run;
  };

  const saveNow = async (keys: string[], next?: StepId): Promise<boolean> => {
    const draft = draftRef.current;
    const saved = savedRef.current;
    if (!draft || !saved) return false;
    const patch = stepPatches(keys, draft, saved);
    const agentPatch = patch.agents;
    const writesAgent = Object.keys(agentPatch).length > 0;
    if (writesAgent && !saved.agents && !text(getField(draft, "agents.full_name")).trim()) {
      setError("כדי לשמור, יש להשלים קודם את השם המלא בשלב 1.");
      return false;
    }
    const onboarding = next ? { ...((saved.agency_profiles.onboarding as OnboardingRow) ?? {}), last_step: next } : null;
    const profilePatch = onboarding ? { ...patch.agency_profiles, onboarding } : patch.agency_profiles;
    if (!writesAgent && !Object.keys(profilePatch).length) {
      if (next) setStep(next);
      return true;
    }
    setSaving(true);
    setError(null);
    try {
      let nextSaved = saved;
      if (writesAgent) {
        const row = await services.onboarding.saveAgent(agencyId, text(saved.agents?.id) || null, agentPatch, text(saved.agents?.updated_at) || null);
        nextSaved = { ...nextSaved, agents: row };
      }
      if (Object.keys(profilePatch).length) {
        const row = await services.onboarding.saveProfile(agencyId, profilePatch, text(saved.agency_profiles.updated_at) || null);
        nextSaved = { ...nextSaved, agency_profiles: row };
      }
      commitSaved(nextSaved);
      // What was typed meanwhile stays; the saved rows' timestamps move on.
      setDraft((d) => (d ? { ...d, agents: nextSaved.agents ? { ...nextSaved.agents, ...(d.agents ?? {}), id: nextSaved.agents.id, updated_at: nextSaved.agents.updated_at } : d.agents, agency_profiles: { ...d.agency_profiles, updated_at: nextSaved.agency_profiles.updated_at, onboarding: nextSaved.agency_profiles.onboarding } } : d));
      if (next) setStep(next);
      return true;
    } catch (e) {
      if (e instanceof OnboardingConflictError) {
        const fresh = await client.fetchQuery({ queryKey: onboardingKeys.record(agencyId), queryFn: () => services.onboarding.load(agencyId), staleTime: 0 });
        adopt(fresh);
        setNotice(e.message);
      } else {
        setError((e as Error).message);
      }
      return false;
    } finally {
      setSaving(false);
    }
  };

  // Step moves are never disabled while a save runs: leaving a field saves on
  // mousedown, and a button disabled by that save would swallow the click.
  // Saves queue (`chain`), so a move waits for the save before it.
  const go = (id: StepId) => void save(id);
  const index = STEPS.findIndex((s) => s.id === current.id);

  /** Defaults offered once their source is typed, never over what the owner wrote. */
  const offerDefaults = (key: string) => {
    if (!draft) return;
    const name = text(getField(draft, "agents.full_name"));
    if (key === "agents.full_name" || key === "agents.professional_title") {
      // Filled once the name is there, and brought up to date when the title follows —
      // never over a line the owner wrote themselves.
      const entity = text(getField(draft, "agency_profiles.licence_entity")).trim();
      if (name.trim() && (!entity || entity === defaultLicenceEntity(name, ""))) {
        update("agency_profiles.licence_entity", defaultLicenceEntity(name, text(getField(draft, "agents.professional_title"))));
      }
      if (!text(getField(draft, "agency_profiles.default_whatsapp_message")).trim() && name.trim()) {
        update("agency_profiles.default_whatsapp_message", defaultWhatsappMessage(name));
      }
    }
    if (key === "agency_profiles.email") {
      const email = text(getField(draft, "agency_profiles.email")).trim();
      const notify = getField(draft, "agency_profiles.notify_emails");
      if (email && !(Array.isArray(notify) && notify.length) && !fieldProblem("agency_profiles.email", email)) update("agency_profiles.notify_emails", [email]);
    }
  };

  const onPhone = (value: string) => {
    setPhoneText(value);
    if (isMobile(value)) setDraft((d) => (d ? { ...d, agency_profiles: { ...d.agency_profiles, ...phoneFields(value) } } : d));
  };

  if (record.isPending || !draft || !step) return <p className="p-10 text-center text-muted-foreground">טוען…</p>;
  if (record.isError) return <p role="alert" className="p-10 text-center text-destructive">{(record.error as Error).message}</p>;

  const status = text(draft.agencies.status);
  const review = ((saved?.agency_profiles.onboarding as OnboardingRow | undefined)?.review ?? {}) as OnboardingRow;
  const fieldsOf = (fields: readonly OnboardingField[]) =>
    fields.map((f) => (
      <FieldInput
        key={f.key}
        field={f}
        value={getField(draft, f.key)}
        onChange={(v) => update(f.key, v)}
        onBlur={() => {
          offerDefaults(f.key);
          void save();
        }}
        problem={problems.get(f.key)}
        phoneText={phoneText}
        onPhoneText={onPhone}
        photo={
          <PortraitInput
            agencyId={agencyId}
            agentId={text(saved?.agents?.id) || null}
            photoPath={text(getField(draft, "agents.photo_path")) || null}
            onChanged={(path, updatedAt) => {
              const s = savedRef.current;
              if (s && s.agents) commitSaved({ ...s, agents: { ...s.agents, photo_path: path, updated_at: updatedAt ?? s.agents.updated_at } });
              setDraft((d) => (d && d.agents ? { ...d, agents: { ...d.agents, photo_path: path, updated_at: updatedAt ?? d.agents.updated_at } } : d));
            }}
          />
        }
      />
    ));

  const disclosure = disclosurePreview({
    entity: text(getField(draft, "agency_profiles.licence_entity")) || "[שורת בעל הרישיון]",
    gender,
    regulator: text(getField(draft, "agents.licence_regulator")),
    number: text(getField(draft, "agents.licence_number")) || "[מספר רישיון]",
    affiliated: getField(draft, "agents.has_institutional_affiliation") as boolean | null,
    displayName: text(getField(draft, "agency_profiles.display_name")) || "[השם באתר]",
  });

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-[1200px] px-6 pt-8">
        <h1 className="font-heading text-3xl font-bold">הקמת {text(draft.agencies.name)}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {g("את", "אתה")} בשלב {current.number} מתוך 7. כל שלב נשמר כשממשיכים או כשעוזבים שדה, ואפשר לחזור לכאן בכל זמן.
        </p>
      </div>
      <main id="main" className="mx-auto max-w-[1200px] px-6 py-6">
        {status === "pending_review" ? (
          <p role="status" className="mb-4 rounded-xl border border-accent/30 bg-accent/10 p-4 text-sm">הסוכנות נשלחה לאישור. אפשר עדיין לתקן פרטים — הבודק/ת יראה את הגרסה העדכנית.</p>
        ) : review.return_note && status === "draft" ? (
          <p role="status" className="mb-4 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm">הסוכנות הוחזרה לתיקונים: {text(review.return_note)}</p>
        ) : null}
        {notice ? <p role="alert" className="mb-4 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm">{notice}</p> : null}

        <nav aria-label="שלבי ההקמה" className="mb-6 flex flex-wrap gap-2">
          {STEPS.map((s) => {
            const open = missingByStep(missing.join(",")).some((m) => m.step === s.id);
            return (
              <button
                key={s.id}
                type="button"
                aria-current={s.id === current.id ? "step" : undefined}
                onClick={() => go(s.id)}
                className={`inline-flex min-h-11 items-center gap-1.5 rounded-full border px-3 text-sm ${s.id === current.id ? "border-accent bg-accent/10 font-semibold text-accent" : "border-border hover:border-accent"}`}
              >
                {!open && s.id !== "review" ? <Check size={14} aria-hidden="true" className="text-emerald-600" /> : null}
                {s.number} · {s.title}
              </button>
            );
          })}
        </nav>

        <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
          <section aria-labelledby="step-title" className="rounded-2xl border border-border bg-card p-6 shadow-sm">
            <h2 id="step-title" className="mb-5 text-xl font-bold">{current.title}</h2>

            {current.id === "review" ? (
              <div className="space-y-5">
                {(() => {
                  const list = submitted && !submitted.ok && submitted.missing.length ? submitted.missing : missing;
                  const grouped = missingByStep(list.join(","));
                  return grouped.length ? (
                    <div>
                      <p className="mb-2 text-sm font-medium">עוד {list.length} פרטים לפני שליחה לאישור:</p>
                      <ul className="space-y-2">
                        {grouped.map(({ step: s, keys }) => {
                          const st = ONBOARDING_STEPS.find((x) => x.id === s)!;
                          return (
                            <li key={s} className="rounded-xl border border-border p-3 text-sm">
                              <button type="button" onClick={() => go(s)} className="font-medium text-accent hover:underline">
                                שלב {st.number} · {st.title}
                              </button>
                              <p className="text-muted-foreground">{[...new Set(keys.map((k) => LABEL.get(k) ?? k))].join(" · ")}</p>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  ) : (
                    <p className="rounded-xl bg-emerald-500/10 p-3 text-sm">כל פרטי החובה מולאו.</p>
                  );
                })()}
                <OnboardingPreview draft={draft} large />
                {submitted?.ok || status === "pending_review" ? (
                  <p role="status" className="text-sm font-medium text-emerald-700 dark:text-emerald-400">נשלח לאישור. נעדכן בדוא״ל כשהסוכנות תופעל.</p>
                ) : (
                  <button
                    type="button"
                    disabled={saving}
                    onClick={async () => {
                      setSaving(true);
                      const out = await services.onboarding.submit(agencyId);
                      setSaving(false);
                      setSubmitted(out.ok ? { ok: true, missing: [] } : { ok: false, missing: out.missing, message: out.message });
                      if (out.ok) await client.invalidateQueries({ queryKey: onboardingKeys.record(agencyId) });
                    }}
                    className="min-h-11 rounded-md bg-accent px-5 text-sm font-medium text-accent-foreground disabled:opacity-40"
                  >
                    שליחה לאישור
                  </button>
                )}
                {submitted && !submitted.ok ? <p role="alert" className="text-sm text-destructive">{submitted.message}</p> : null}
              </div>
            ) : (
              <div className="space-y-5">
                {fieldsOf(current.fields)}
                {current.id === "licence" ? (
                  <div className="rounded-xl border border-border bg-background p-4">
                    <p className="mb-2 text-xs font-semibold text-muted-foreground">כך יופיע הגילוי הנאות לגולשים</p>
                    <p className="text-sm">{disclosure.licence}</p>
                    <p className="mt-2 text-sm">{disclosure.bot}</p>
                    <p className="mt-2 text-xs text-muted-foreground">זה הנוסח שמאושר בבדיקת הציות לפני ההפעלה.</p>
                  </div>
                ) : null}
                {current.id === "testimonials" ? (
                  <TestimonialsEditor
                    agencyId={agencyId}
                    agentId={text(saved?.agents?.id) || null}
                    testimonials={record.data?.testimonials ?? []}
                    cases={record.data?.success_cases ?? []}
                    onChanged={() => void client.invalidateQueries({ queryKey: onboardingKeys.record(agencyId) })}
                  />
                ) : null}
              </div>
            )}

            {error ? <p role="alert" className="mt-4 text-sm text-destructive">{error}</p> : null}
            {current.id !== "review" ? (
              <div className="mt-6 flex flex-wrap items-center gap-3">
                <button type="button" onClick={() => go(STEPS[index + 1].id)} className="min-h-11 rounded-md bg-accent px-5 text-sm font-medium text-accent-foreground disabled:opacity-40">
                  המשך
                </button>
                {index > 0 ? (
                  <button type="button" onClick={() => go(STEPS[index - 1].id)} className="min-h-11 rounded-md border border-border px-4 text-sm">
                    הקודם
                  </button>
                ) : null}
                {saving ? <span role="status" className="text-xs text-muted-foreground">שומרים…</span> : null}
              </div>
            ) : null}
          </section>
          <aside className="lg:sticky lg:top-6 lg:self-start">
            <OnboardingPreview draft={draft} />
          </aside>
        </div>
      </main>
    </div>
  );
}
