import React, { useId, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Loader2, Printer } from "lucide-react";
import { analyse, pct, totals, type Severity } from "@/lib/clearinghouse/analysis";
import { forPrint, pendingCount, withReviews, type ReviewedFinding } from "@/lib/clearinghouse/review";
import type { Account } from "@/lib/clearinghouse/snapshot";
import { formatIls } from "@/lib/pension-fee";
import { PENSION_MARKETING_DISCLOSURE } from "@/config/compliance";
import { services, type MaslekaPort, type ReviewDecision } from "@/services";
import { failureText } from "@/lib/masleka";

/**
 * /admin/masleka/analysis/:snapshotId — one client's clearinghouse report,
 * analysed, for Dorit to review before the meeting.
 *
 * Every finding arrives as a draft (src/lib/clearinghouse/analysis.ts — fixed
 * rules, fixed wording, the client's numbers). She approves it, approves it in
 * her own words, or rejects it; "הדפסה" prints the approved ones only, with
 * the pension-marketing disclosure. Nothing here reaches the client by itself.
 */
export interface MaslekaAnalysisProps {
  service?: MaslekaPort;
  /** Tests pass it; the route reads it from the address. */
  snapshotId?: string;
  print?: () => void;
}

const SEVERITY: Record<Severity, { label: string; className: string }> = {
  high: { label: "חשוב", className: "border-destructive/50 text-destructive" },
  medium: { label: "כדאי לבדוק", className: "border-accent/60 text-accent" },
  low: { label: "לידיעה", className: "border-border text-muted-foreground" },
};

const STATE_LABEL: Record<ReviewedFinding["state"], string> = { draft: "טיוטה", approved: "אושר", rejected: "נדחה" };

const KIND: Record<Account["kind"], string> = {
  pension: "קרן פנסיה",
  provident: "קופת גמל",
  study: "קרן השתלמות",
  insurance: "ביטוח מנהלים",
};

const buttonClass =
  "inline-flex items-center gap-1 border border-border/60 px-3 py-1.5 text-sm hover:border-accent disabled:opacity-60";

const day = (iso: string) =>
  iso ? new Date(iso).toLocaleDateString("he-IL", { timeZone: "Asia/Jerusalem", day: "numeric", month: "numeric", year: "numeric" }) : "";

const fee = (n: number | null) => (n === null ? "—" : pct(n));

function FindingCard({
  finding,
  busy,
  onDecide,
}: {
  finding: ReviewedFinding;
  busy: boolean;
  onDecide: (decision: ReviewDecision | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(finding.text);
  const fieldId = useId();
  const severity = SEVERITY[finding.severity];
  const headingId = `${fieldId}-title`;
  return (
    <li
      aria-labelledby={headingId}
      className={`border p-4 ${finding.state === "rejected" ? "border-border/40 opacity-60 print:hidden" : "border-border/60"} ${
        finding.state === "draft" ? "print:hidden" : ""
      }`}
    >
      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <span className={`border px-2 py-0.5 text-xs ${severity.className}`}>{severity.label}</span>
        <span className="text-xs text-muted-foreground">
          {STATE_LABEL[finding.state]}
          {finding.edited ? " · בנוסח של דורית" : ""}
        </span>
      </div>
      <h3 id={headingId} className="mt-2 font-medium">
        {finding.title}
      </h3>
      {editing ? (
        <div className="mt-2 print:hidden">
          <label htmlFor={fieldId} className="sr-only">
            הנוסח של ההמלצה
          </label>
          <textarea
            id={fieldId}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={5}
            maxLength={4000}
            className="w-full border border-border bg-background p-2 text-sm leading-relaxed"
          />
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy || !draft.trim()}
              onClick={() => {
                const text = draft.trim();
                onDecide({ status: "approved", finalText: text === finding.body ? null : text });
                setEditing(false);
              }}
              className={`${buttonClass} border-primary`}
            >
              שמירה ואישור
            </button>
            <button type="button" onClick={() => { setDraft(finding.text); setEditing(false); }} className={buttonClass}>
              ביטול
            </button>
          </div>
        </div>
      ) : (
        <p className="mt-2 text-sm leading-relaxed whitespace-pre-line">{finding.text}</p>
      )}
      {editing ? null : (
        <div className="mt-3 flex flex-wrap gap-2 print:hidden">
          {finding.state !== "approved" || finding.edited ? (
            <button type="button" disabled={busy} onClick={() => onDecide({ status: "approved", finalText: null })} className={`${buttonClass} border-primary`}>
              {finding.edited ? "אישור בנוסח המקורי" : "אישור"}
            </button>
          ) : null}
          <button type="button" disabled={busy} onClick={() => { setDraft(finding.text); setEditing(true); }} className={buttonClass}>
            עריכה
          </button>
          {finding.state !== "rejected" ? (
            <button type="button" disabled={busy} onClick={() => onDecide({ status: "rejected", finalText: null })} className={buttonClass}>
              דחייה
            </button>
          ) : null}
          {finding.state !== "draft" ? (
            <button type="button" disabled={busy} onClick={() => onDecide(null)} className={buttonClass}>
              החזרה לטיוטה
            </button>
          ) : null}
        </div>
      )}
    </li>
  );
}

export default function MaslekaAnalysis({
  service = services.masleka,
  snapshotId: given,
  print = () => window.print(),
}: MaslekaAnalysisProps) {
  const params = useParams();
  const snapshotId = given ?? params.snapshotId ?? "";
  const client = useQueryClient();
  const snapshotKey = ["admin", "masleka", "snapshot", snapshotId] as const;
  const reviewsKey = ["admin", "masleka", "reviews", snapshotId] as const;
  const stored = useQuery({ queryKey: snapshotKey, queryFn: () => service.getSnapshot(snapshotId), enabled: !!snapshotId });
  const reviews = useQuery({ queryKey: reviewsKey, queryFn: () => service.listReviews(snapshotId), enabled: !!snapshotId });
  const [error, setError] = useState<string | null>(null);
  const decide = useMutation({
    mutationFn: ({ key, decision }: { key: string; decision: ReviewDecision | null }) => service.decide(snapshotId, key, decision),
    onMutate: () => setError(null),
    onSuccess: () => client.invalidateQueries({ queryKey: reviewsKey }),
    onError: (e) => setError(failureText(e)),
  });

  const header = (title: string) => (
    <header className="border-b border-border/60 bg-card print:border-0 print:bg-transparent">
      <div className="max-w-[1000px] mx-auto px-4 sm:px-6 py-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm text-accent print:hidden">מסלקה · ניתוח</p>
          <h1 className="font-heading text-2xl md:text-3xl mt-1">{title}</h1>
        </div>
        <div className="flex items-center gap-4 text-sm print:hidden">
          <Link to="/admin/masleka" className="inline-flex items-center gap-2 text-muted-foreground hover:text-accent">
            חזרה ללוח <ArrowRight size={16} />
          </Link>
        </div>
      </div>
    </header>
  );

  if (stored.isPending || reviews.isPending) {
    return (
      <div dir="rtl" className="min-h-screen bg-background">
        {header("ניתוח מסלקה")}
        <Loader2 className="animate-spin m-8" aria-label="טוען" />
      </div>
    );
  }
  if (stored.isError || reviews.isError || !stored.data) {
    return (
      <div dir="rtl" className="min-h-screen bg-background">
        {header("ניתוח מסלקה")}
        <p role="alert" className="max-w-[1000px] mx-auto px-4 sm:px-6 py-8 text-sm">
          {stored.data === null
            ? "הדוח לא נמצא — ייתכן שנמחק, או שאינו קריא."
            : `לא הצלחנו לטעון את הדוח. ${failureText(stored.error ?? reviews.error)}`}
        </p>
      </div>
    );
  }

  const { snapshot, clientName, takenAt } = stored.data;
  const findings = withReviews(analyse(snapshot), reviews.data ?? []);
  const sum = totals(snapshot);
  const pending = pendingCount(findings);
  const approved = forPrint(findings).length;

  return (
    <div dir="rtl" className="min-h-screen bg-background print:bg-white">
      {header(`ניתוח מסלקה — ${clientName}`)}
      <main className="max-w-[1000px] mx-auto px-4 sm:px-6 py-8 space-y-8">
        <p className="text-sm text-muted-foreground">
          דוח מסלקה מ־{day(takenAt)} · ממשק {snapshot.interfaceVersion}
          {snapshot.client.age !== null ? ` · גיל ${snapshot.client.age}` : ""}
        </p>

        <section aria-label="סיכום" className="grid gap-4 sm:grid-cols-3">
          <div className="border border-border/60 p-4">
            <p className="text-xs text-muted-foreground">סך החיסכון</p>
            <p className="font-heading text-2xl lining-nums">{formatIls(sum.balance)}</p>
          </div>
          <div className="border border-border/60 p-4">
            <p className="text-xs text-muted-foreground">דמי ניהול השנה (הערכה)</p>
            <p className="font-heading text-2xl lining-nums">{formatIls(sum.yearlyFees)}</p>
          </div>
          <div className="border border-border/60 p-4">
            <p className="text-xs text-muted-foreground">מוצרים</p>
            <p className="font-heading text-2xl lining-nums">
              {sum.accounts} <span className="text-base text-muted-foreground">({sum.activeAccounts} פעילים)</span>
            </p>
          </div>
        </section>

        <section aria-labelledby="findings-title">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 id="findings-title" className="font-heading text-xl">
              המלצות
            </h2>
            <div className="flex items-center gap-3 print:hidden">
              <p role="status" className="text-sm text-muted-foreground">
                {findings.length === 0
                  ? "לא נמצאו נקודות לבדיקה."
                  : pending > 0
                    ? `${pending} ממתינות לבדיקה · ${approved} אושרו`
                    : `הכול נבדק · ${approved} אושרו`}
              </p>
              <button type="button" onClick={print} disabled={approved === 0} className={buttonClass}>
                <Printer size={14} aria-hidden="true" /> הדפסה
              </button>
            </div>
          </div>
          {error ? (
            <p role="alert" className="mt-3 border border-destructive/40 bg-destructive/5 p-3 text-sm print:hidden">
              {error}
            </p>
          ) : null}
          <ol className="mt-4 space-y-3">
            {findings.map((f) => (
              <FindingCard
                key={`${f.key}|${f.state}|${f.text}`}
                finding={f}
                busy={decide.isPending}
                onDecide={(decision) => decide.mutate({ key: f.key, decision })}
              />
            ))}
          </ol>
        </section>

        <section aria-labelledby="products-title">
          <h2 id="products-title" className="font-heading text-xl">
            המוצרים בדוח
          </h2>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b border-border text-right text-xs text-muted-foreground">
                  <th className="py-2 pl-3 font-normal">מוצר</th>
                  <th className="py-2 pl-3 font-normal">גוף מנהל</th>
                  <th className="py-2 pl-3 font-normal">יתרה</th>
                  <th className="py-2 pl-3 font-normal">הפקדה חודשית</th>
                  <th className="py-2 pl-3 font-normal">מהפקדה</th>
                  <th className="py-2 pl-3 font-normal">מצבירה</th>
                  <th className="py-2 pl-3 font-normal">כיסוי</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.accounts.map((a) => (
                  <tr key={a.id} className="border-b border-border/40 align-top">
                    <td className="py-2 pl-3">
                      {KIND[a.kind]}
                      <span className="block text-xs text-muted-foreground">
                        {a.planName}
                        {a.active ? "" : " · לא פעיל"}
                      </span>
                    </td>
                    <td className="py-2 pl-3">{a.provider}</td>
                    <td className="py-2 pl-3 lining-nums tabular-nums">{formatIls(a.balance)}</td>
                    <td className="py-2 pl-3 lining-nums tabular-nums">{a.monthlyDeposit === null ? "—" : formatIls(a.monthlyDeposit)}</td>
                    <td className="py-2 pl-3 lining-nums tabular-nums">{fee(a.feeFromDeposits)}</td>
                    <td className="py-2 pl-3 lining-nums tabular-nums">{fee(a.feeFromBalance)}</td>
                    <td className="py-2 pl-3">
                      {[a.coverage.death ? "שארים" : null, a.coverage.disability ? "נכות" : null].filter(Boolean).join(" · ") || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <footer className="border-t border-border/60 pt-4 text-xs text-muted-foreground leading-relaxed">
          <p>הכנה לפגישה על סמך נתוני המסלקה הפנסיונית מ־{day(takenAt)}. הנתונים כפי שדווחו על ידי הגופים המוסדיים.</p>
          <p className="mt-1">{PENSION_MARKETING_DISCLOSURE}</p>
        </footer>
      </main>
    </div>
  );
}
