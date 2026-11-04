import React, { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Pencil, Trash2 } from "lucide-react";
import { services, type OnboardingRow } from "@/services";
import { Bidi } from "./fields";

const INPUT = "w-full min-h-11 rounded-md border border-border bg-card px-3 text-sm focus:border-accent focus:outline-none";
const EMPTY = { name: "", role: "", quote: "", rating: 5, source: "google", source_url: "", consent: false };
const EMPTY_CASE = { title: "", body: "", metric: "" };
export const SOURCE_LABELS: Record<string, string> = { google: "Google", midrag: "מידרג", direct: "ישירות ממני" };
const ICON_BUTTON = "min-h-11 min-w-11 px-2 disabled:opacity-30";

/** A delete asks once more, in place: the row is gone for good after "כן, למחוק". */
function DeleteButton({ label, busy, onConfirm }: { label: string; busy: boolean; onConfirm: () => void }) {
  const [asking, setAsking] = useState(false);
  if (!asking) {
    return (
      <button type="button" aria-label={label} disabled={busy} onClick={() => setAsking(true)} className={`${ICON_BUTTON} hover:text-destructive`}>
        <Trash2 size={15} />
      </button>
    );
  }
  return (
    <span role="group" aria-label={label} className="flex items-center gap-1 text-xs">
      <span>למחוק?</span>
      <button type="button" disabled={busy} onClick={() => { setAsking(false); onConfirm(); }} className="min-h-11 rounded-md bg-destructive px-2 font-medium text-destructive-foreground">כן, למחוק</button>
      <button type="button" onClick={() => setAsking(false)} className="min-h-11 rounded-md border border-border px-2">ביטול</button>
    </span>
  );
}

/** Why a testimonial cannot be saved yet, in Hebrew; null when it can. The consent box is the database's rule too. */
export function testimonialProblem(t: typeof EMPTY): string | null {
  if (!t.name.trim()) return "חסר שם הממליץ/ה (אפשר ראשי תיבות).";
  if (!t.quote.trim()) return "חסר נוסח ההמלצה.";
  if (t.source_url.trim() && !/^https:\/\//.test(t.source_url.trim())) return "הקישור למקור צריך להתחיל ב-https://";
  if (!t.consent) return "יש לאשר שההמלצה אמיתית ושהממליץ/ה הסכים/ה לפרסומה.";
  return null;
}

/**
 * Step 5: testimonials, with the required consent checkbox (the table refuses
 * one without it), ordered by up/down; and optional success cases with the
 * anonymisation warning. Zero of each is fine — the section hides.
 */
export default function TestimonialsEditor({
  agencyId,
  agentId,
  testimonials,
  cases,
  onChanged,
  onUnfinished,
}: {
  agencyId: string;
  agentId: string | null;
  testimonials: OnboardingRow[];
  cases: OnboardingRow[];
  onChanged: () => void;
  /** Whether a testimonial or a case is typed and not yet added — the page asks before leaving the step. */
  onUnfinished?: (unfinished: boolean) => void;
}) {
  const [form, setForm] = useState(EMPTY);
  const [caseForm, setCaseForm] = useState(EMPTY_CASE);
  /** The row open for editing in the form below, or null for a new one. */
  const [editing, setEditing] = useState<string | null>(null);
  const [editingCase, setEditingCase] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const problem = testimonialProblem(form);
  const unfinished =
    Boolean(form.name.trim() || form.role.trim() || form.quote.trim() || form.source_url.trim()) ||
    Boolean(caseForm.title.trim() || caseForm.body.trim() || caseForm.metric.trim());
  useEffect(() => {
    onUnfinished?.(unfinished);
  }, [unfinished, onUnfinished]);
  // Leaving the step unmounts the forms: nothing is unfinished any more.
  useEffect(() => () => onUnfinished?.(false), [onUnfinished]);

  const run = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const move = (i: number, by: -1 | 1) => {
    const order = [...testimonials];
    const [row] = order.splice(i, 1);
    order.splice(i + by, 0, row);
    void run(() => Promise.all(order.map((t, n) => services.onboarding.saveTestimonial(agencyId, { id: t.id, sort_order: n }))));
  };

  if (!agentId) return <p className="text-sm text-muted-foreground">אפשר להוסיף המלצות אחרי שמשלימים את שלב 1.</p>;
  return (
    <div className="space-y-6">
      <section aria-labelledby="testimonials-title" className="space-y-3">
        <h3 id="testimonials-title" className="text-sm font-bold">המלצות ({testimonials.length})</h3>
        <ol className="space-y-2">
          {testimonials.map((t, i) => (
            <li key={String(t.id)} className="flex items-start justify-between gap-3 rounded-xl border border-border p-3">
              <div className="min-w-0">
                <p className="text-sm">״{String(t.quote ?? "")}״</p>
                <p className="text-xs text-muted-foreground">
                  {String(t.name ?? "")}
                  {t.role ? ` · ${String(t.role)}` : ""} · {SOURCE_LABELS[String(t.source ?? "")] ?? String(t.source ?? "")}
                </p>
              </div>
              <div className="flex shrink-0 gap-1">
                <button type="button" aria-label="למעלה" disabled={busy || i === 0} onClick={() => move(i, -1)} className={ICON_BUTTON}><ArrowUp size={15} /></button>
                <button type="button" aria-label="למטה" disabled={busy || i === testimonials.length - 1} onClick={() => move(i, 1)} className={ICON_BUTTON}><ArrowDown size={15} /></button>
                <button
                  type="button"
                  aria-label={`עריכת ההמלצה של ${String(t.name ?? "")}`}
                  disabled={busy}
                  onClick={() => {
                    setEditing(String(t.id));
                    // Consent is asked again: the text it was given for may change.
                    setForm({ name: String(t.name ?? ""), role: String(t.role ?? ""), quote: String(t.quote ?? ""), rating: Number(t.rating ?? 5), source: String(t.source ?? "google"), source_url: String(t.source_url ?? ""), consent: false });
                  }}
                  className={ICON_BUTTON}
                >
                  <Pencil size={15} />
                </button>
                <DeleteButton
                  label={`מחיקת ההמלצה של ${String(t.name ?? "")}`}
                  busy={busy}
                  onConfirm={() =>
                    void run(async () => {
                      await services.onboarding.deleteTestimonial(String(t.id));
                      if (editing === String(t.id)) { setEditing(null); setForm(EMPTY); }
                    })
                  }
                />
              </div>
            </li>
          ))}
        </ol>

        <form
          aria-label={editing ? "עריכת המלצה" : "המלצה חדשה"}
          onSubmit={(e) => {
            e.preventDefault();
            if (problem) return;
            void run(async () => {
              const values = {
                name: form.name.trim(),
                role: form.role.trim() || null,
                quote: form.quote.trim(),
                rating: form.rating,
                source: form.source,
                source_url: form.source_url.trim() || null,
                consent_confirmed_at: new Date().toISOString(),
              };
              await services.onboarding.saveTestimonial(agencyId, editing ? { id: editing, ...values } : { agent_id: agentId, ...values, sort_order: testimonials.length });
              setForm(EMPTY);
              setEditing(null);
            });
          }}
          className="grid gap-3 rounded-xl border border-dashed border-border p-4 md:grid-cols-2"
        >
          <label className="text-sm">שם הממליץ/ה<input value={form.name} maxLength={80} onChange={(e) => setForm({ ...form, name: e.target.value })} className={`${INPUT} mt-1`} /></label>
          <label className="text-sm">הקשר<input value={form.role} maxLength={80} placeholder="לקוחה מאז 2019" onChange={(e) => setForm({ ...form, role: e.target.value })} className={`${INPUT} mt-1`} /></label>
          <label className="text-sm md:col-span-2">ההמלצה<textarea value={form.quote} maxLength={600} rows={3} onChange={(e) => setForm({ ...form, quote: e.target.value })} className={`${INPUT} mt-1 py-2`} /></label>
          <label className="text-sm">דירוג
            <select value={form.rating} onChange={(e) => setForm({ ...form, rating: Number(e.target.value) })} className={`${INPUT} mt-1`}>
              {[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <label className="text-sm">מקור
            <select value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} className={`${INPUT} mt-1`}>
              <option value="google">Google</option>
              <option value="midrag">מידרג</option>
              <option value="direct">ישירות ממני</option>
            </select>
          </label>
          <label className="text-sm md:col-span-2">קישור להמלצה המקורית (רשות)<input type="url" dir="ltr" value={form.source_url} onChange={(e) => setForm({ ...form, source_url: e.target.value })} className={`${INPUT} mt-1 text-left`} placeholder="https://" /></label>
          <label className="flex items-start gap-2 text-sm md:col-span-2">
            <input type="checkbox" checked={form.consent} onChange={(e) => setForm({ ...form, consent: e.target.checked })} className="mt-1 h-5 w-5" />
            ההמלצה אמיתית, והממליץ/ה הסכים/ה לפרסומה
          </label>
          {form.name || form.quote ? (problem ? <p role="alert" className="text-xs text-destructive md:col-span-2"><Bidi text={problem} /></p> : null) : null}
          <div className="flex flex-wrap gap-2 md:col-span-2">
            <button type="submit" disabled={Boolean(problem) || busy} className="min-h-11 rounded-md bg-accent px-4 text-sm font-medium text-accent-foreground disabled:opacity-40">
              {editing ? "שמירת השינויים" : "הוספת ההמלצה"}
            </button>
            {editing ? (
              <button type="button" onClick={() => { setEditing(null); setForm(EMPTY); }} className="min-h-11 rounded-md border border-border px-4 text-sm">
                ביטול העריכה
              </button>
            ) : null}
          </div>
        </form>
      </section>

      <section aria-labelledby="cases-title" className="space-y-3">
        <h3 id="cases-title" className="text-sm font-bold">תיקי הצלחה (רשות)</h3>
        <p className="rounded-xl bg-amber-500/10 p-3 text-xs">בלי שמות, תעודות זהות, סכומים מדויקים או פרטים שמאפשרים לזהות את הלקוח/ה.</p>
        <ul className="space-y-2">
          {cases.map((c) => (
            <li key={String(c.id)} className="flex items-start justify-between gap-3 rounded-xl border border-border p-3 text-sm">
              <div>
                <p className="font-medium">{String(c.title ?? "")}</p>
                <p className="text-muted-foreground">{String(c.body ?? "")}</p>
              </div>
              <div className="flex shrink-0 gap-1">
                <button
                  type="button"
                  aria-label={`עריכת ${String(c.title ?? "")}`}
                  disabled={busy}
                  onClick={() => {
                    setEditingCase(String(c.id));
                    setCaseForm({ title: String(c.title ?? ""), body: String(c.body ?? ""), metric: String(c.metric ?? "") });
                  }}
                  className={ICON_BUTTON}
                >
                  <Pencil size={15} />
                </button>
                <DeleteButton
                  label={`מחיקת ${String(c.title ?? "")}`}
                  busy={busy}
                  onConfirm={() =>
                    void run(async () => {
                      await services.onboarding.deleteSuccessCase(String(c.id));
                      if (editingCase === String(c.id)) { setEditingCase(null); setCaseForm(EMPTY_CASE); }
                    })
                  }
                />
              </div>
            </li>
          ))}
        </ul>
        <form
          aria-label={editingCase ? "עריכת תיק הצלחה" : "תיק הצלחה חדש"}
          onSubmit={(e) => {
            e.preventDefault();
            if (!caseForm.title.trim() || !caseForm.body.trim()) return;
            void run(async () => {
              const values = { title: caseForm.title.trim(), body: caseForm.body.trim(), metric: caseForm.metric.trim() || null };
              await services.onboarding.saveSuccessCase(agencyId, editingCase ? { id: editingCase, ...values } : { agent_id: agentId, ...values, sort_order: cases.length, published: true });
              setCaseForm(EMPTY_CASE);
              setEditingCase(null);
            });
          }}
          className="grid gap-3 rounded-xl border border-dashed border-border p-4"
        >
          <label className="text-sm">כותרת<input value={caseForm.title} maxLength={200} onChange={(e) => setCaseForm({ ...caseForm, title: e.target.value })} className={`${INPUT} mt-1`} /></label>
          <label className="text-sm">מה היה ומה עשינו<textarea value={caseForm.body} maxLength={2000} rows={3} onChange={(e) => setCaseForm({ ...caseForm, body: e.target.value })} className={`${INPUT} mt-1 py-2`} /></label>
          <label className="text-sm">התוצאה במילים (רשות)<input value={caseForm.metric} maxLength={100} onChange={(e) => setCaseForm({ ...caseForm, metric: e.target.value })} className={`${INPUT} mt-1`} /></label>
          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={busy || !caseForm.title.trim() || !caseForm.body.trim()} className="min-h-11 rounded-md border border-border px-4 text-sm disabled:opacity-40">{editingCase ? "שמירת השינויים" : "הוספת תיק"}</button>
            {editingCase ? (
              <button type="button" onClick={() => { setEditingCase(null); setCaseForm(EMPTY_CASE); }} className="min-h-11 rounded-md border border-border px-4 text-sm">ביטול העריכה</button>
            ) : null}
          </div>
        </form>
      </section>
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}
