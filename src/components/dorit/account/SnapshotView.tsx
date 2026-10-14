import React, { useId, useState } from "react";
import { Check, Loader2, MessageCircle } from "lucide-react";
import { CtaLink } from "@/components/dorit/primitives/Cta";
import { CONTACT } from "@/config/contact";
import { PENSION_MARKETING_DISCLOSURE } from "@/config/compliance";
import { CAL_LINK, PENSION_CHECK } from "@/config/offers";
import { clientTiles, coverageLines, COVERAGE_STATUS_LABEL } from "@/lib/clearinghouse/client-view";
import { pct } from "@/lib/clearinghouse/analysis";
import type { Account } from "@/lib/clearinghouse/snapshot";
import { formatIls } from "@/lib/pension-fee";
import type { ClientAnswer, ClientSnapshot, PublishedRecommendation } from "@/services/ports";

/**
 * The client's "תמונת מצב": what Dorit published, as the client reads it.
 * One component for the personal area and for Dorit's "תצוגה כפי שהלקוח
 * רואה" (`preview`: the answer buttons are shown but do nothing), so the two
 * cannot drift apart. Every projection is an estimate, and the page says so.
 */
export interface SnapshotViewProps {
  data: ClientSnapshot;
  /** Dorit's preview: everything shown, nothing sent. */
  preview?: boolean;
  onAnswer?: (itemId: string, status: ClientAnswer, note?: string) => Promise<void>;
}

const KIND: Record<Account["kind"], string> = {
  pension: "קרן פנסיה",
  provident: "קופת גמל",
  study: "קרן השתלמות",
  insurance: "ביטוח מנהלים",
};

const day = (iso: string) =>
  iso ? new Date(iso).toLocaleDateString("he-IL", { timeZone: "Asia/Jerusalem", day: "numeric", month: "numeric", year: "numeric" }) : "";

const PRIORITY: Record<PublishedRecommendation["priority"], { label: string; className: string }> = {
  important: { label: "חשוב", className: "border-highlight text-accent" },
  check: { label: "כדאי לבדוק", className: "border-border text-muted-foreground" },
};

function Tile({ label, value, note, highlight = false }: { label: string; value: string; note?: string; highlight?: boolean }) {
  return (
    <div className={`rounded-[4px] border p-4 ${highlight ? "border-highlight" : "border-border"}`}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 font-heading text-2xl text-accent lining-nums tabular-nums">{value}</p>
      {note ? <p className="mt-1 text-xs text-muted-foreground">{note}</p> : null}
    </div>
  );
}

function RecommendationCard({
  item,
  preview,
  onAnswer,
}: {
  item: PublishedRecommendation;
  preview: boolean;
  onAnswer?: SnapshotViewProps["onAnswer"];
}) {
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const noteId = useId();
  const headingId = `${noteId}-h`;
  const priority = PRIORITY[item.priority];

  const answer = async (status: ClientAnswer, text?: string) => {
    if (preview || !onAnswer) return;
    setBusy(true);
    setFailed(false);
    try {
      await onAnswer(item.id, status, text);
      setAsking(false);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <li aria-labelledby={headingId} className="rounded-[4px] border border-border p-5">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded-[4px] border px-2 py-0.5 text-xs ${priority.className}`}>{priority.label}</span>
        {item.clientStatus === "accepted" ? (
          <span className="inline-flex items-center gap-1 text-xs text-accent">
            <Check size={14} aria-hidden="true" /> ביקשת לטפל בזה
          </span>
        ) : item.clientStatus === "question" ? (
          <span className="text-xs text-accent">שאלת את דורית — היא תחזור אליך</span>
        ) : null}
      </div>
      <h3 id={headingId} className="mt-2 font-heading text-xl">{item.title}</h3>
      <p className="mt-2 text-[16px] leading-relaxed whitespace-pre-line text-foreground/85">{item.body}</p>

      {asking ? (
        <div className="mt-4">
          <label htmlFor={noteId} className="block text-sm text-muted-foreground">
            השאלה שלך לדורית
          </label>
          <textarea
            id={noteId}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            maxLength={1000}
            className="mt-1 w-full rounded-md border border-input bg-transparent p-2.5 text-[16px]"
          />
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy || preview}
              onClick={() => void answer("question", note.trim() || undefined)}
              className="inline-flex min-h-11 items-center gap-2 rounded-md border border-highlight px-4 text-accent disabled:opacity-60"
            >
              {busy ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : null}
              שליחת השאלה
            </button>
            <button type="button" onClick={() => setAsking(false)} className="min-h-11 px-3 text-sm underline">
              ביטול
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-4 flex flex-wrap gap-2">
          {item.clientStatus !== "accepted" ? (
            <button
              type="button"
              disabled={busy || preview}
              onClick={() => void answer("accepted")}
              className="inline-flex min-h-11 items-center gap-2 rounded-md border border-highlight px-4 text-accent disabled:opacity-60"
            >
              {busy ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : null}
              כן, לטפל בזה
            </button>
          ) : null}
          <button
            type="button"
            disabled={busy || preview}
            onClick={() => setAsking(true)}
            className="inline-flex min-h-11 items-center rounded-md border border-border px-4 disabled:opacity-60"
          >
            יש לי שאלה
          </button>
        </div>
      )}
      {failed ? (
        <p role="alert" className="mt-2 text-sm text-destructive">
          לא הצלחנו לשלוח. נסו שוב, או כתבו לדורית בוואטסאפ.
        </p>
      ) : null}
    </li>
  );
}

export default function SnapshotView({ data, preview = false, onAnswer }: SnapshotViewProps) {
  const { snapshot, items } = data;
  const tiles = clientTiles(snapshot, items);
  const coverages = coverageLines(snapshot);
  const booking = CAL_LINK ?? "/#start";

  return (
    <div className="space-y-10">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[4px] border border-border bg-secondary/40 p-4 text-sm">
        <p className="m-0">
          נתוני המסלקה מתאריך {day(data.takenAt)} · נבדקו על ידי דורית ב־{day(data.publishedAt)}
        </p>
        <a href={PENSION_CHECK.path} className="underline underline-offset-4">
          לבקש עדכון נתונים
        </a>
      </div>

      <section aria-label="סיכום" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="סך החיסכון" value={formatIls(tiles.totalSavings)} highlight />
        <Tile
          label="קצבה צפויה בגיל 67 (הערכה)"
          value={tiles.pensionAt67 === null ? "—" : formatIls(tiles.pensionAt67)}
          note="מקרנות הפנסיה בלבד"
        />
        <Tile
          label="דמי ניהול בשנה"
          value={formatIls(tiles.yearlyFees)}
          note={tiles.feesAboveUsual >= 1 ? `מזה כ־${formatIls(tiles.feesAboveUsual)} מעל המקובל` : undefined}
        />
        <Tile label="המלצות פתוחות" value={String(tiles.openRecommendations)} />
      </section>

      <section aria-labelledby="snapshot-products">
        <h2 id="snapshot-products" className="font-heading text-2xl">המוצרים שלך</h2>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm border-collapse">
            <thead>
              <tr className="border-b border-border text-right text-xs text-muted-foreground">
                <th className="py-2 pl-3 font-normal">מוצר</th>
                <th className="py-2 pl-3 font-normal">גוף מנהל</th>
                <th className="py-2 pl-3 font-normal">יתרה</th>
                <th className="py-2 pl-3 font-normal">הפקדה חודשית</th>
                <th className="py-2 pl-3 font-normal">דמי ניהול (הפקדה / צבירה)</th>
              </tr>
            </thead>
            <tbody>
              {snapshot.accounts.map((a) => (
                <tr key={a.id} className="border-b border-border/40 align-top">
                  <td className="py-2 pl-3">
                    {KIND[a.kind]}
                    {a.active ? "" : <span className="block text-xs text-muted-foreground">לא פעיל</span>}
                  </td>
                  <td className="py-2 pl-3">{a.provider}</td>
                  <td className="py-2 pl-3 lining-nums tabular-nums">{formatIls(a.balance)}</td>
                  <td className="py-2 pl-3 lining-nums tabular-nums">{a.monthlyDeposit === null ? "—" : formatIls(a.monthlyDeposit)}</td>
                  <td className="py-2 pl-3 lining-nums tabular-nums">
                    {a.feeFromDeposits === null ? "—" : pct(a.feeFromDeposits)} / {a.feeFromBalance === null ? "—" : pct(a.feeFromBalance)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="snapshot-coverages">
        <h2 id="snapshot-coverages" className="font-heading text-2xl">כיסויים</h2>
        <ul className="mt-4 divide-y divide-border border-y border-border list-none p-0">
          {coverages.map((c) => (
            <li key={c.kind} className="flex flex-wrap items-baseline justify-between gap-2 py-3">
              <span>{c.label}</span>
              <span className={`text-sm ${c.status === "covered" ? "text-accent" : "text-foreground"}`}>{COVERAGE_STATUS_LABEL[c.status]}</span>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-muted-foreground">לפי דוח המסלקה בלבד — פוליסות פרטיות לא מופיעות בו.</p>
      </section>

      <section aria-labelledby="snapshot-recommendations">
        <h2 id="snapshot-recommendations" className="font-heading text-2xl">ההמלצות של דורית</h2>
        <ol className="mt-4 space-y-3 list-none p-0">
          {items.map((item) => (
            <RecommendationCard key={`${item.id}|${item.clientStatus}`} item={item} preview={preview} onAnswer={onAnswer} />
          ))}
        </ol>
      </section>

      <section aria-labelledby="snapshot-together" className="rounded-[4px] bg-primary p-6 text-primary-foreground md:p-8">
        <h2 id="snapshot-together" className="font-heading text-2xl">רוצים לעבור על זה יחד?</h2>
        <div className="mt-4 flex flex-wrap gap-3">
          <CtaLink href={booking} onDark {...(CAL_LINK ? { target: "_blank", rel: "noopener noreferrer" } : {})} className="max-sm:w-full">
            לקביעת שיחה
          </CtaLink>
          <CtaLink
            href={`https://wa.me/${CONTACT.whatsapp}?text=${encodeURIComponent("שלום דורית, עברתי על תמונת המצב באזור האישי ואשמח לדבר")}`}
            target="_blank"
            rel="noopener noreferrer"
            onDark
            className="max-sm:w-full"
          >
            <MessageCircle size={18} aria-hidden="true" /> וואטסאפ
          </CtaLink>
        </div>
      </section>

      <p className="text-xs text-muted-foreground leading-relaxed">
        התחזיות הן הערכה בלבד: הן מניחות תשואה שנתית קבועה של 4%, הפקדות קבועות ומקדם המרה 200, ללא מס, עליות שכר
        ואינפלציה. ההמלצות אישיות ונכתבו ונבדקו על ידי דורית. {PENSION_MARKETING_DISCLOSURE}
      </p>
    </div>
  );
}
