import React from "react";
import { Sparkles } from "lucide-react";
import type { LeadRecord } from "@/services";
import { useGenerateBriefing, useLeadBriefing } from "@/hooks/useAdmin";

const when = (iso: string) =>
  iso ? new Date(iso).toLocaleString("he-IL", { timeZone: "Asia/Jerusalem", dateStyle: "short", timeStyle: "short" }) : "";

/** Always on screen with a briefing: what it is, and what it is not. */
export const BRIEFING_NOTE =
  "טיוטה שנכתבה על ידי בינה מלאכותית, לשיקול דעתך בלבד. היא אינה ייעוץ ואינה המלצה ללקוח, ואין להעביר אותה אליו.";

/**
 * The drawer's "תדריך" tab (VITE_LEAD_BRIEFING): the newest briefing — three
 * lines on the interview, the main concern, questions and talking points — or
 * the button that makes one. A briefing is made only when someone asks; it is
 * kept, and "יצירה מחדש" replaces it. Everything shown is plain text.
 */
export default function LeadBriefing({
  lead,
  memberLabel,
}: {
  lead: LeadRecord;
  /** Who a member is, as this person may see it. */
  memberLabel: (id: string | null) => string;
}) {
  const briefing = useLeadBriefing(lead.id);
  const generate = useGenerateBriefing();
  const b = briefing.data ?? null;

  const button = (label: string) => (
    <button
      type="button"
      onClick={() => generate.mutate(lead.id)}
      disabled={generate.isPending}
      aria-busy={generate.isPending}
      className="inline-flex min-h-11 items-center gap-2 rounded-md bg-accent px-4 text-sm font-medium text-accent-foreground disabled:opacity-40"
    >
      <Sparkles size={15} aria-hidden="true" /> {generate.isPending ? "מכין תדריך…" : label}
    </button>
  );

  return (
    <div className="space-y-5">
      <p className="rounded-md border border-border bg-muted/40 p-3 text-sm text-muted-foreground">{BRIEFING_NOTE}</p>

      {briefing.isPending ? (
        <p className="text-sm text-muted-foreground">טוען…</p>
      ) : briefing.isError ? (
        <p role="alert" className="text-sm text-destructive">לא הצלחנו לטעון את התדריך.</p>
      ) : !b ? (
        <div className="space-y-3">
          <p className="text-sm">
            תדריך קצר לקראת השיחה: תקציר הראיון, הדאגה המרכזית, שאלות מוצעות ונושאים לשיחה. הוא נכתב מתוכן הראיון
            בלבד — בלי שם, טלפון או אימייל.
          </p>
          {button("תדריך לפני שיחה")}
        </div>
      ) : (
        <div className="space-y-5">
          <section aria-labelledby="briefing-summary">
            <h3 id="briefing-summary" className="mb-1 text-sm font-bold">תקציר הראיון</h3>
            <ul className="list-disc space-y-1 ps-5 text-sm">
              {b.summary.map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ul>
          </section>
          <section aria-labelledby="briefing-concern">
            <h3 id="briefing-concern" className="mb-1 text-sm font-bold">הדאגה המרכזית</h3>
            <p className="text-sm">{b.concern}</p>
          </section>
          <section aria-labelledby="briefing-questions">
            <h3 id="briefing-questions" className="mb-1 text-sm font-bold">שאלות מוצעות לשיחה</h3>
            <ol className="list-decimal space-y-1 ps-5 text-sm">
              {b.questions.map((q, i) => (
                <li key={i}>{q}</li>
              ))}
            </ol>
          </section>
          <section aria-labelledby="briefing-points">
            <h3 id="briefing-points" className="mb-1 text-sm font-bold">נושאים לשיחה</h3>
            <ul className="list-disc space-y-1 ps-5 text-sm">
              {b.talkingPoints.map((p, i) => (
                <li key={i}>{p}</li>
              ))}
            </ul>
          </section>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
            <p className="text-xs text-muted-foreground">
              נוצר {when(b.createdAt)} · {memberLabel(b.createdBy)}
            </p>
            {button("יצירה מחדש")}
          </div>
        </div>
      )}

      {generate.isError ? (
        <p role="alert" className="text-sm text-destructive">{(generate.error as Error).message}</p>
      ) : null}
    </div>
  );
}
