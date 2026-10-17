import React, { useId, useMemo, useState } from "react";
import { Info } from "lucide-react";
import Eyebrow from "@/components/dorit/primitives/Eyebrow";
import { CtaLink } from "@/components/dorit/primitives/Cta";
import CalculatorLeadBox from "@/components/dorit/sections/CalculatorLeadBox";
import { TOOL_SECTION } from "@/config/tools";
import { useCalculatorResultEvent } from "@/hooks/useCalculatorResultEvent";
import { retirementMessage } from "@/lib/calculator-lead";
import { formatIls } from "@/lib/pension-fee";
import {
  clampTo,
  projectRetirement,
  RANGES,
  whatIf,
  WHAT_IF,
  type RetirementInput,
} from "@/lib/retirement-projection";
import Glossed from "@/components/dorit/primitives/Glossed";

/**
 * /tools — "מחשבון פרישה": where today's savings and deposits could reach by
 * retirement, the fees paid on the way, and what two changes would do. Every
 * figure is an estimate (src/lib/retirement-projection.ts) and the disclaimer
 * says what it leaves out. GA4 hears only that a result was produced
 * (`calculator_result`, tool `retirement_projection`) — never a figure.
 */

export const RETIREMENT_DISCLAIMER =
  "הערכה כללית בלבד ואינה ייעוץ. מניח הפקדות ותשואה קבועות ומקדם המרה 200, ללא מס, עליות שכר ואינפלציה.";

const DEFAULTS: RetirementInput = {
  currentAge: 40,
  retirementAge: 67,
  currentBalance: 200_000,
  monthlyDeposit: 2_000,
  feeOnBalance: 0.3,
  annualReturn: 4,
};

const FIELDS: { key: keyof RetirementInput; label: string; unit: "years" | "ils" | "pct" }[] = [
  { key: "currentAge", label: "גיל היום", unit: "years" },
  { key: "retirementAge", label: "גיל פרישה", unit: "years" },
  { key: "currentBalance", label: "חיסכון קיים", unit: "ils" },
  { key: "monthlyDeposit", label: "הפקדה חודשית", unit: "ils" },
  { key: "feeOnBalance", label: "דמי ניהול מהצבירה", unit: "pct" },
  { key: "annualReturn", label: "תשואה שנתית", unit: "pct" },
];

const shown = (unit: "years" | "ils" | "pct", v: number) =>
  unit === "ils" ? formatIls(v) : unit === "pct" ? `${Number(v.toFixed(2))}%` : String(v);

function SliderField({
  label,
  unit,
  field,
  value,
  onChange,
}: {
  label: string;
  unit: "years" | "ils" | "pct";
  field: keyof RetirementInput;
  value: number;
  onChange: (v: number) => void;
}) {
  const id = useId();
  const { min, max, step } = RANGES[field];
  // What is being typed, until it is a value in range or the field is left:
  // clamping each keystroke would turn the "4" of "45" into 20.
  const [draft, setDraft] = useState<string | null>(null);
  const type = (text: string) => {
    setDraft(text);
    const n = Number(text);
    if (text.trim() !== "" && Number.isFinite(n) && n >= min && n <= max) onChange(n);
  };
  const commit = () => {
    if (draft !== null && draft.trim() !== "") onChange(clampTo(field, Number(draft)));
    setDraft(null);
  };
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-sm text-muted-foreground">
          {label}
        </label>
        <input
          type="number"
          inputMode="decimal"
          aria-label={`${label} — ערך`}
          value={draft ?? value}
          min={min}
          max={max}
          step={step}
          onChange={(e) => type(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
          }}
          className="w-32 min-h-11 rounded-[4px] border border-border bg-background px-2 text-left font-heading text-lg text-accent lining-nums tabular-nums focus:outline-none focus:border-highlight focus:ring-2 focus:ring-highlight/40"
          dir="ltr"
        />
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-valuetext={shown(unit, value)}
        onChange={(e) => onChange(clampTo(field, Number(e.target.value)))}
        className="mt-2 w-full min-h-11 accent-[hsl(var(--highlight))]"
      />
    </div>
  );
}

function Figure({ label, value, highlight = false }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`rounded-[4px] border p-4 ${highlight ? "border-highlight" : "border-border"}`}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`mt-1 font-heading lining-nums tabular-nums text-accent ${highlight ? "text-3xl" : "text-2xl"}`}>{value}</p>
    </div>
  );
}

/** Balance by age as plain bars. The figures it draws are in the text around it. */
function BalanceChart({ points }: { points: { age: number; balance: number }[] }) {
  const top = Math.max(1, ...points.map((p) => p.balance));
  const first = points[0];
  const last = points[points.length - 1];
  return (
    <figure className="m-0">
      <div
        role="img"
        aria-label={`יתרה לפי גיל: ${formatIls(first.balance)} בגיל ${first.age}, ${formatIls(last.balance)} בגיל ${last.age}`}
        className="flex h-40 items-end gap-[2px]"
      >
        {points.map((p) => (
          <div
            key={p.age}
            title={`גיל ${p.age}: ${formatIls(p.balance)}`}
            className="flex-1 rounded-t-[2px] bg-highlight/70"
            style={{ height: `${Math.max(1, (p.balance / top) * 100)}%` }}
          />
        ))}
      </div>
      <figcaption className="mt-2 flex justify-between text-xs text-muted-foreground lining-nums" aria-hidden="true">
        <span>גיל {first.age}</span>
        <span>גיל {last.age}</span>
      </figcaption>
    </figure>
  );
}

export default function RetirementCalculator() {
  const [input, setInput] = useState<RetirementInput>(DEFAULTS);
  // The defaults are the calculator's, not the visitor's: nothing counts for GA4 until one moves.
  const [touched, setTouched] = useState(false);
  const set = (key: keyof RetirementInput) => (v: number) => {
    setTouched(true);
    setInput((prev) => ({ ...prev, [key]: v }));
  };

  const result = useMemo(() => projectRetirement(input), [input]);
  const variants = useMemo(() => whatIf(input), [input]);
  const years = Math.max(0, input.retirementAge - input.currentAge);

  useCalculatorResultEvent(
    "retirement_projection",
    touched && years > 0 && Number.isFinite(result.finalBalance) ? Object.values(input).join("|") : null,
  );

  return (
    <section id={TOOL_SECTION.retirement} aria-labelledby="retirement-title" className="py-24 md:py-32 border-t border-border max-md:py-14">
      <div className="max-w-[1400px] mx-auto px-6 md:px-10 grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-16">
        <div className="lg:col-span-5">
          <Eyebrow>חדש · מחשבון פרישה</Eyebrow>
          <h2 id="retirement-title" className="font-heading text-5xl md:text-6xl mt-5 leading-tight max-md:text-4xl">
            לאן החיסכון יכול להגיע?
          </h2>
          <p className="mt-6 text-foreground/70 max-w-md leading-relaxed">
            <Glossed text="הזיזו את הנתונים וראו איך הגיל, ההפקדה ודמי הניהול משנים את הקצבה הצפויה." />
          </p>
          <p className="mt-8 flex items-start gap-3 text-sm text-muted-foreground max-w-md">
            <Info size={16} className="mt-0.5 shrink-0 text-accent" aria-hidden="true" />
            <span>{RETIREMENT_DISCLAIMER}</span>
          </p>
        </div>

        <div className="lg:col-span-7 rounded-[4px] border border-border p-8 md:p-10 max-md:p-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-6">
            {FIELDS.map((f) => (
              <SliderField key={f.key} field={f.key} label={f.label} unit={f.unit} value={input[f.key]} onChange={set(f.key)} />
            ))}
          </div>

          {years === 0 ? (
            <p role="status" className="mt-8 text-sm text-muted-foreground">
              גיל הפרישה צריך להיות אחרי הגיל היום.
            </p>
          ) : null}

          <div className="mt-10 grid grid-cols-1 sm:grid-cols-3 gap-4" aria-live="polite">
            <Figure label={`קצבה חודשית צפויה בגיל ${input.retirementAge}`} value={formatIls(result.monthlyPension)} highlight />
            <Figure label="יתרה בפרישה" value={formatIls(result.finalBalance)} />
            <Figure label="דמי ניהול מצטברים" value={formatIls(result.cumulativeFees)} />
          </div>

          <div className="mt-8">
            <BalanceChart points={result.yearly} />
          </div>

          <div className="mt-8 rounded-[4px] border border-border p-5">
            <h3 className="font-heading text-xl">ומה אם?</h3>
            <dl className="mt-3 grid gap-3 sm:grid-cols-2">
              <div>
                <dt className="text-sm text-muted-foreground">מפקידים ₪{WHAT_IF.extraDeposit} יותר בחודש</dt>
                <dd className="m-0 mt-1 font-heading text-xl text-accent lining-nums">
                  {formatIls(variants.moreDeposit.monthlyPension)} לחודש
                </dd>
              </div>
              <div>
                <dt className="text-sm text-muted-foreground">דמי הניהול יורדים ל־{WHAT_IF.lowerFee}%</dt>
                <dd className="m-0 mt-1 font-heading text-xl text-accent lining-nums">
                  {input.feeOnBalance <= WHAT_IF.lowerFee ? "כבר שם" : `${formatIls(variants.lowerFee.monthlyPension)} לחודש`}
                </dd>
              </div>
            </dl>
          </div>

          <CalculatorLeadBox className="mt-8" message={retirementMessage(input, result)}>
            <CtaLink href="/#start" className="max-sm:w-full">
              לחשב לפי הנתונים האמיתיים שלי
            </CtaLink>
          </CalculatorLeadBox>
        </div>
      </div>
    </section>
  );
}
