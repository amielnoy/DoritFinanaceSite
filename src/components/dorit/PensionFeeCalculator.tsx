import React, { useMemo, useState } from "react";
import { Calculator, TrendingDown, Wallet, PiggyBank } from "lucide-react";

const fmtCurrency = (n: number): string =>
  new Intl.NumberFormat("he-IL", {
    style: "currency",
    currency: "ILS",
    maximumFractionDigits: 0,
  }).format(Math.round(n || 0));

interface CalcResult {
  totalDeposited: number;
  totalDepositFees: number;
  totalAnnualFees: number;
  totalFees: number;
  balance: number;
  lostToFees: number;
}

interface NumFieldProps {
  label: string;
  value: number | string;
  onChange: (v: string) => void;
  step?: number;
  min?: number;
}

interface ResultCardProps {
  icon: React.ComponentType<{ size?: number; className?: string }>;
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

  const result: CalcResult = useMemo(() => {
    const M = Number(monthlyDeposit) || 0;
    const df = (Number(depositFee) || 0) / 100;
    const af = (Number(annualFee) || 0) / 100;
    const Y = Number(years) || 0;
    const r = (Number(annualReturn) || 0) / 100;

    let balance = 0;
    let totalDeposited = 0;
    let totalDepositFees = 0;
    let totalAnnualFees = 0;
    const monthlyReturn = r / 12;
    const monthlyAnnualFee = af / 12;

    for (let m = 1; m <= Y * 12; m++) {
      balance *= 1 + monthlyReturn;
      const feeOnDeposit = M * df;
      const netDeposit = M - feeOnDeposit;
      totalDeposited += M;
      totalDepositFees += feeOnDeposit;
      balance += netDeposit;
      const mgmtFee = balance * monthlyAnnualFee;
      balance -= mgmtFee;
      totalAnnualFees += mgmtFee;
    }

    const totalFees = totalDepositFees + totalAnnualFees;
    let optimal = 0;
    for (let m = 1; m <= Y * 12; m++) {
      optimal *= 1 + monthlyReturn;
      optimal += M;
    }
    const lostToFees = optimal - balance;

    return {
      totalDeposited,
      totalDepositFees,
      totalAnnualFees,
      totalFees,
      balance,
      lostToFees,
    };
  }, [monthlyDeposit, depositFee, annualFee, years, annualReturn]);

  return (
    <section id="fee-calculator" className="relative py-24 md:py-32 border-t border-border/60">
      <div className="max-w-[1400px] mx-auto px-6 md:px-10 grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-16">
        <div className="lg:col-span-5 flex flex-col justify-center">
          <span className="text-[11px] tracking-[0.35em] uppercase text-accent">
            04 · Transparency Tool
          </span>
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
              <span className="font-semibold text-[#9C836A]">
                {fmtCurrency(result.lostToFees)}
              </span>{" "}
              שנשאר ברשות הגוף המנהל במקום אצלכם.
            </p>
          </div>

          <a
            href="#quick-contact"
            className="mt-8 inline-flex items-center gap-2 px-7 py-3.5 bg-[#C3AD96] text-primary font-medium hover:bg-[#b89a80] transition-colors duration-300 shadow-sm"
          >
            רוצים לדעת אם אפשר לחסוך? שאלו אותי
          </a>
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
        highlight ? "border-[#C3AD96]/50 bg-[#C3AD96]/5" : "border-border/50 bg-background"
      }`}
    >
      <div className="flex items-center gap-2 text-xs tracking-[0.15em] uppercase text-muted-foreground mb-2">
        <Icon size={14} className={highlight ? "text-[#C3AD96]" : "text-accent"} />
        {label}
      </div>
      <p className={`font-heading text-2xl ${highlight ? "text-foreground" : "text-foreground/85"}`}>
        {value}
      </p>
    </div>
  );
}