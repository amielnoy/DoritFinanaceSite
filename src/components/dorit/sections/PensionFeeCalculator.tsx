import React, { useMemo, useState } from "react";
import { Calculator, TrendingDown, Wallet, PiggyBank } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { CtaLink } from "@/components/dorit/primitives/Cta";
import {
  computePensionFees,
  formatIls as fmtCurrency,
  type PensionFeeResult,
} from "@/lib/pension-fee";
import Eyebrow from "@/components/dorit/primitives/Eyebrow";

interface NumFieldProps {
  label: string;
  value: number | string;
  onChange: (v: string) => void;
  step?: number;
  min?: number;
}

interface ResultCardProps {
  icon: LucideIcon;
  label: string;
  value: string;
  highlight?: boolean;
}

export default function PensionFeeCalculator() {
  const [monthlyDeposit, setMonthlyDeposit] = useState<number | string>(2000);
  const [depositFee, setDepositFee] = useState<number | string>(2);
  const [annualFee, setAnnualFee] = useState<number | string>(0.5);
  const [years, setYears] = useState<number | string>(25);
  const [annualReturn, setAnnualReturn] = useState<number | string>(5);

  const result: PensionFeeResult = useMemo(
    () =>
      computePensionFees({
        monthlyDeposit,
        depositFee,
        annualFee,
        years,
        annualReturn,
      }),
    [monthlyDeposit, depositFee, annualFee, years, annualReturn]
  );

  return (
    <section id="fee-calculator" className="relative py-24 md:py-32 border-t border-border/60">
      <div className="max-w-[1400px] mx-auto px-6 md:px-10 grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-16">
        <div className="lg:col-span-5 flex flex-col justify-center">
          <Eyebrow>
            כלי שקיפות
          </Eyebrow>
          <h2 className="font-heading text-5xl md:text-6xl mt-5 leading-tight">
            כמה באמת
            <br />
            עולה לכם החיסכון?
          </h2>
          <p className="mt-8 text-foreground/70 max-w-md leading-relaxed">
            דמי הניהול נראים קטנים בכל חודש, אך לאורך שנים הם מתגלגלים למאות אלפי
            שקלים מהצבירה שלכם. המחשבון הזה מעניק תמונה כנה — כי ידע הוא הצעד
            הראשון לקראת החלטה מושכלת.
          </p>
          <div className="mt-10 flex items-center gap-3 text-sm text-foreground/50">
            <Calculator size={16} className="text-accent" />
            <span>הערכה כללית בלבד — אינה מחליפה ייעוץ אישי.</span>
          </div>
        </div>

        <div className="lg:col-span-7 bg-card border border-border/60 p-8 md:p-12">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <NumField
              label="הפקדה חודשית (₪)"
              value={monthlyDeposit}
              onChange={setMonthlyDeposit}
              step={100}
              min={0}
            />
            <NumField
              label="שנות חיסכון"
              value={years}
              onChange={setYears}
              step={1}
              min={1}
            />
            <NumField
              label="דמי ניהול בהפקדה (%)"
              value={depositFee}
              onChange={setDepositFee}
              step={0.1}
              min={0}
            />
            <NumField
              label="דמי ניהול שוטפים (% שנתי)"
              value={annualFee}
              onChange={setAnnualFee}
              step={0.05}
              min={0}
            />
            <div className="sm:col-span-2">
              <NumField
                label="תשואה שנתית צפויה (%)"
                value={annualReturn}
                onChange={setAnnualReturn}
                step={0.5}
                min={0}
              />
            </div>
          </div>

          <div className="mt-10 grid grid-cols-2 gap-4">
            <ResultCard
              icon={PiggyBank}
              label="סך הפקדות"
              value={fmtCurrency(result.totalDeposited)}
            />
            <ResultCard
              icon={Wallet}
              label="יתרה מצופה בסוף התקופה"
              value={fmtCurrency(result.balance)}
              highlight
            />
            <ResultCard
              icon={TrendingDown}
              label="דמי ניהול בהפקדה (צבירה)"
              value={fmtCurrency(result.totalDepositFees)}
            />
            <ResultCard
              icon={TrendingDown}
              label="דמי ניהול שוטפים (צבירה)"
              value={fmtCurrency(result.totalAnnualFees)}
            />
          </div>

          <div className="mt-6 p-5 bg-background border border-border/60">
            <p className="text-sm text-foreground/70 leading-relaxed">
              סך דמי הניהול שישולמו:{" "}
              <span className="font-semibold text-foreground">
                {fmtCurrency(result.totalFees)}
              </span>
              . ללא דמי ניהול כלל, היתרה הייתה עומדת על{" "}
              <span className="font-semibold text-foreground">
                {fmtCurrency(result.balance + result.lostToFees)}
              </span>{" "}
              — הפרש של{" "}
              <span className="font-semibold text-highlight-ink">
                {fmtCurrency(result.lostToFees)}
              </span>{" "}
              שנשאר ברשות הגוף המנהל במקום אצלכם.
            </p>
          </div>

          <CtaLink muted href="/#start" className="mt-8">
            רוצים לדעת אם אפשר לחסוך? שאלו אותי
          </CtaLink>
        </div>
      </div>
    </section>
  );
}

function NumField({ label, value, onChange, step = 1, min = 0 }: NumFieldProps) {
  const id = React.useId();
  return (
    <div>
      <label htmlFor={id} className="block text-xs tracking-[0.15em] uppercase text-muted-foreground mb-2">
        {label}
      </label>
      <input
        id={id}
        type="number"
        value={value}
        min={min}
        step={step}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-background border border-border px-4 py-3 text-base focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/40 transition-colors"
      />
    </div>
  );
}

function ResultCard({ icon: Icon, label, value, highlight }: ResultCardProps) {
  return (
    <div
      className={`p-4 border ${
        highlight ? "border-highlight-muted/50 bg-highlight-muted/5" : "border-border/50 bg-background"
      }`}
    >
      <div className="flex items-center gap-2 text-xs tracking-[0.15em] uppercase text-muted-foreground mb-2">
        <Icon size={14} className={highlight ? "text-highlight-ink" : "text-accent"} />
        {label}
      </div>
      <p className={`font-heading text-2xl ${highlight ? "text-highlight-ink" : "text-foreground"}`}>
        {value}
      </p>
    </div>
  );
}