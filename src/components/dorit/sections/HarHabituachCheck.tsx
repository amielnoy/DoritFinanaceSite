import React, { useId, useRef, useState } from "react";
import { Check, ExternalLink, FileSpreadsheet, Loader2, Upload } from "lucide-react";
import Eyebrow from "@/components/dorit/primitives/Eyebrow";
import { CtaButton } from "@/components/dorit/primitives/Cta";
import { Field, inputClass } from "@/components/dorit/primitives/Field";
import { HAR_HABITUACH_URL } from "@/config/har-habituach";
import { HUMAN_HANDOFF } from "@/config/compliance";
import { TOOL_SECTION } from "@/config/tools";
import { useSubmission } from "@/hooks/useSubmission";
import { leadEvents } from "@/lib/analytics";
import { getAttribution } from "@/lib/attribution";
import { checkCoverage, checkSummary, type CoverageCheck } from "@/lib/har-habituach/check";
import { MappingError, readPolicies } from "@/lib/har-habituach/mapping";
import { readFirstSheet, XlsxError } from "@/lib/har-habituach/xlsx";
import { formatIls } from "@/lib/pension-fee";
import { isIsraeliMobile } from "@/lib/phone";
import { services } from "@/services";

/**
 * /tools — "בדיקת כפל ביטוחים": the visitor's Har HaBituach export, read in
 * their browser (src/lib/har-habituach/), grouped by coverage type.
 *
 * The file is never uploaded. Only "לשלוח לדורית לבדיקה" sends anything: a
 * short summary (checkSummary — counts, flagged types, companies; never the ID
 * or a policy number) through the ordinary lead pipeline, counted as a lead
 * once it is saved. GA4 hears only that a check was produced.
 */

export const DUPLICATE_NOTE = "״כפל אפשרי״ לא תמיד אומר לבטל — דורית תבדוק את התנאים.";
export const CHECK_DISCLAIMER =
  "הבדיקה משווה סוג כיסוי בלבד — לא סכומים, תנאים או החרגות — ואינה ייעוץ. כיסויים בקרן הפנסיה לא מופיעים בהר הביטוח.";

const MAX_BYTES = 5 * 1024 * 1024;
const PHONE_ERROR = "מספר נייד צריך להתחיל ב-05 ולהכיל 10 ספרות";

/** A file the visitor picked, read into a check, or why it could not be. */
export async function checkFile(file: File): Promise<CoverageCheck | string> {
  if (!/\.xlsx$/i.test(file.name)) return "אפשר לבדוק קובץ xlsx בלבד — הקובץ שמורידים מהר הביטוח.";
  if (file.size > MAX_BYTES) return "הקובץ גדול מדי לקובץ של הר הביטוח.";
  try {
    const rows = readFirstSheet(new Uint8Array(await file.arrayBuffer()));
    return checkCoverage(readPolicies(rows));
  } catch (e) {
    if (e instanceof XlsxError) return "לא הצלחנו לפתוח את הקובץ. ודאו שזה קובץ ה־Excel שהורד מהר הביטוח.";
    if (e instanceof MappingError) return "לא מצאנו בקובץ את טבלת הפוליסות של הר הביטוח. ודאו שזה הקובץ שהורד משם.";
    return "משהו השתבש בקריאת הקובץ. נסו שוב.";
  }
}

function SendToDorit({ check }: { check: CoverageCheck }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [invalid, setInvalid] = useState<string | null>(null);
  const { sending, sent, error, submit } = useSubmission("request");

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return setInvalid("נא למלא שם.");
    if (!isIsraeliMobile(phone)) return setInvalid(PHONE_ERROR);
    setInvalid(null);
    const ok = await submit(() => {
      const attribution = getAttribution();
      return services.leads.submitLead({
        name: name.trim(),
        phone: phone.trim(),
        source: "quick",
        topic: "בדיקת כפל ביטוחים",
        message: checkSummary(check),
        channel: attribution?.channel,
        campaign: attribution?.campaign ?? undefined,
        landingPath: window.location.pathname,
      });
    });
    // A lead once it is saved — never on the click.
    if (ok) leadEvents.coverageCheckSubmitted();
  };

  if (sent) {
    return (
      <p role="status" className="mt-6 flex items-center gap-2 text-[17px]">
        <Check size={18} className="text-highlight" aria-hidden="true" /> נשלח. דורית תעבור על הבדיקה ותחזור אליכם.
      </p>
    );
  }
  return (
    <form onSubmit={send} noValidate className="mt-6 rounded-[4px] border border-border p-5">
      <h3 className="font-heading text-xl">לשלוח לדורית לבדיקה</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        נשלח סיכום בלבד — סוגי הכיסוי, החברות והכפלים. לא הקובץ, לא תעודת הזהות ולא מספרי הפוליסות.
      </p>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <Field label="שם *">
          <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" className={inputClass()} />
        </Field>
        <Field label="טלפון נייד *">
          <input
            type="tel"
            inputMode="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder={HUMAN_HANDOFF.phonePlaceholder}
            autoComplete="tel"
            aria-invalid={invalid === PHONE_ERROR}
            className={inputClass()}
          />
        </Field>
      </div>
      {invalid || error ? (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {invalid || error}
        </p>
      ) : null}
      <CtaButton type="submit" disabled={sending} className="mt-5 max-sm:w-full">
        {sending ? <Loader2 size={18} className="animate-spin" aria-hidden="true" /> : null}
        לשלוח לדורית לבדיקה
      </CtaButton>
    </form>
  );
}

function Results({ check }: { check: CoverageCheck }) {
  return (
    <div className="mt-8" aria-live="polite">
      <dl className="grid grid-cols-3 gap-3 max-sm:gap-2">
        {[
          ["כפל אפשרי", String(check.possibleDuplicates), check.possibleDuplicates > 0],
          ["כדאי לבדוק", String(check.missing.length), false],
          ["פרמיה חודשית", formatIls(check.totalMonthlyPremium), false],
        ].map(([label, value, gold]) => (
          <div key={label as string} className={`rounded-[4px] border p-4 max-sm:p-3 ${gold ? "border-highlight" : "border-border"}`}>
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="m-0 mt-1 font-heading text-2xl text-accent lining-nums tabular-nums max-sm:text-xl">{value}</dd>
          </div>
        ))}
      </dl>

      <p className="mt-4 text-sm">{DUPLICATE_NOTE}</p>

      <ul className="mt-6 divide-y divide-border border-y border-border list-none p-0" aria-label="הפוליסות לפי סוג כיסוי">
        {check.groups.map((g) => (
          <li key={`${g.section}|${g.type}`} className="py-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <div className="min-w-0">
              <p className="font-medium">
                {g.type}
                {g.possibleDuplicate ? (
                  <span className="ms-2 rounded-[4px] border border-highlight px-1.5 py-0.5 text-xs text-accent">כפל אפשרי</span>
                ) : null}
              </p>
              <p className="text-xs text-muted-foreground">
                {g.policies.length > 1 ? `${g.policies.length} פוליסות · ` : ""}
                {[...new Set(g.policies.map((p) => p.company))].join(", ")}
              </p>
            </div>
            <p className="text-sm lining-nums tabular-nums">{formatIls(g.monthlyPremium)} לחודש</p>
          </li>
        ))}
      </ul>

      {check.missing.length ? (
        <div className="mt-6">
          <h3 className="font-heading text-xl">כדאי לבדוק</h3>
          <p className="mt-1 text-sm text-muted-foreground">כיסויים שלא מופיעים באף פוליסה בקובץ:</p>
          <ul className="mt-2 flex flex-wrap gap-2 list-none p-0">
            {check.missing.map((m) => (
              <li key={m} className="rounded-[4px] border border-border px-2.5 py-1 text-sm">
                {m}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <SendToDorit check={check} />
    </div>
  );
}

export default function HarHabituachCheck() {
  const inputId = useId();
  const counted = useRef(false);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [check, setCheck] = useState<CoverageCheck | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const read = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setProblem(null);
    const result = await checkFile(file);
    setBusy(false);
    if (typeof result === "string") {
      setCheck(null);
      setProblem(result);
      return;
    }
    setCheck(result);
    // A check the visitor produced counts once per visit; no figure goes with it.
    if (!counted.current) {
      counted.current = true;
      leadEvents.calculatorResult("coverage_check");
    }
  };

  return (
    <section id={TOOL_SECTION.harHabituach} aria-labelledby="har-habituach-title" className="py-24 md:py-32 border-t border-border max-md:py-14">
      <div className="max-w-[1000px] mx-auto px-6 md:px-10">
        <Eyebrow>חדש · בדיקת כפל ביטוחים</Eyebrow>
        <h2 id="har-habituach-title" className="font-heading text-5xl md:text-6xl mt-5 leading-tight max-md:text-4xl">
          משלמים פעמיים על אותו ביטוח?
        </h2>

        <ol className="mt-8 grid gap-4 md:grid-cols-3 list-none p-0">
          <li className="rounded-[4px] border border-border p-4">
            <span className="font-heading text-2xl text-accent lining-nums">01</span>
            <p className="mt-1">
              נכנסים ל
              <a href={HAR_HABITUACH_URL} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 underline underline-offset-4">
                הר הביטוח <ExternalLink size={14} aria-hidden="true" />
              </a>{" "}
              עם תעודת הזהות.
            </p>
          </li>
          <li className="rounded-[4px] border border-border p-4">
            <span className="font-heading text-2xl text-accent lining-nums">02</span>
            <p className="mt-1">מורידים את רשימת הפוליסות כקובץ Excel.</p>
          </li>
          <li className="rounded-[4px] border border-border p-4">
            <span className="font-heading text-2xl text-accent lining-nums">03</span>
            <p className="mt-1">מעלים אותו כאן. הקובץ נקרא בדפדפן שלכם ולא נשלח לשום מקום.</p>
          </li>
        </ol>

        <label
          htmlFor={inputId}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            void read(e.dataTransfer.files[0]);
          }}
          className={`mt-8 flex min-h-32 cursor-pointer flex-col items-center justify-center gap-2 rounded-[4px] border border-dashed p-6 text-center transition-colors ${
            dragging ? "border-highlight bg-highlight/5" : "border-border hover:border-highlight"
          }`}
        >
          {busy ? <Loader2 size={24} className="animate-spin text-highlight" aria-hidden="true" /> : check ? <FileSpreadsheet size={24} className="text-highlight" aria-hidden="true" /> : <Upload size={24} className="text-highlight" aria-hidden="true" />}
          <span className="font-heading text-lg">{check ? "לבדוק קובץ אחר" : "בחירת קובץ הר הביטוח (xlsx)"}</span>
          <span className="text-sm text-muted-foreground">או גררו אותו לכאן</span>
          <input
            id={inputId}
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="sr-only"
            onChange={(e) => {
              void read(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </label>

        {problem ? (
          <p role="alert" className="mt-4 text-sm text-destructive">
            {problem}
          </p>
        ) : null}

        {check ? <Results check={check} /> : null}

        <p className="mt-8 text-sm text-muted-foreground">{CHECK_DISCLAIMER}</p>
      </div>
    </section>
  );
}
