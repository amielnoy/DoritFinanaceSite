import React, { useMemo, useState } from "react";
import { Calculator, TrendingDown, Wallet, PiggyBank } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { CtaLink } from "@/components/dorit/primitives/Cta";
import { computePensionFees, type PensionFeeResult } from "@/lib/pension-fee";
import Eyebrow from "@/components/dorit/primitives/Eyebrow";
import CalculatorLeadBox from "@/components/dorit/sections/CalculatorLeadBox";
import { feeCalculatorMessageIn, formatIlsIn } from "@/i18n/tools";
import { useCalculatorResultEvent } from "@/hooks/useCalculatorResultEvent";
import { TOOL_SECTION } from "@/config/tools";
import PensionCheckForm from "@/components/dorit/forms/PensionCheckForm";
import { useLocale, useLocalePath, useT } from "@/i18n/LocaleContext";

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
  // The defaults are the calculator's, not the visitor's: no result counts
  // for GA4 until they change something.
  const [touched, setTouched] = useState(false);
  const t = useT("tools");
  const tp = useT("pension");
  const ils = (n: number) => formatIlsIn(locale, n);
  const locale = useLocale();
  const lp = useLocalePath();
  const edit = (set: (v: string) => void) => (v: string) => {
    setTouched(true);
    set(v);
  };

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

  useCalculatorResultEvent(
    "fee_calculator",
    // No deposits (an emptied field, zero years) is no result at all.
    touched && result.totalDeposited > 0 && Number.isFinite(result.balance)
      ? [monthlyDeposit, depositFee, annualFee, years, annualReturn].join("|")
      : null
  );

  return (
    <section id={TOOL_SECTION.feeCalculator} className="relative py-24 md:py-32 border-t border-border/60">
      <div className="max-w-[1400px] mx-auto px-6 md:px-10 grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-16">
        <div className="lg:col-span-5 flex flex-col justify-center">
          <Eyebrow>
            {t("fee.eyebrow")}
          </Eyebrow>
          <h2 className="font-heading text-5xl md:text-6xl mt-5 leading-tight">
            {t("fee.titleLine1")}
            <br />
            {t("fee.titleLine2")}
          </h2>
          <p className="mt-8 text-foreground/70 max-w-md leading-relaxed">
            {t("fee.intro")}
          </p>
          <div className="mt-10 flex items-center gap-3 text-sm text-muted-foreground">
            <Calculator size={16} className="text-accent" />
            <span>{t("fee.estimate")}</span>
          </div>
        </div>

        <div className="lg:col-span-7 bg-card border border-border/60 p-8 md:p-12">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <NumField
              label={t("fee.deposit")}
              value={monthlyDeposit}
              onChange={edit(setMonthlyDeposit)}
              step={100}
              min={0}
            />
            <NumField
              label={t("fee.years")}
              value={years}
              onChange={edit(setYears)}
              step={1}
              min={1}
            />
            <NumField
              label={t("fee.depositFee")}
              value={depositFee}
              onChange={edit(setDepositFee)}
              step={0.1}
              min={0}
            />
            <NumField
              label={t("fee.annualFee")}
              value={annualFee}
              onChange={edit(setAnnualFee)}
              step={0.05}
              min={0}
            />
            <div className="sm:col-span-2">
              <NumField
                label={t("fee.return")}
                value={annualReturn}
                onChange={edit(setAnnualReturn)}
                step={0.5}
                min={0}
              />
            </div>
          </div>

          <div className="mt-10 grid grid-cols-2 gap-4">
            <ResultCard
              icon={PiggyBank}
              label={t("fee.totalDeposited")}
              value={ils(result.totalDeposited)}
            />
            <ResultCard
              icon={Wallet}
              label={t("fee.balance")}
              value={ils(result.balance)}
              highlight
            />
            <ResultCard
              icon={TrendingDown}
              label={t("fee.depositFees")}
              value={ils(result.totalDepositFees)}
            />
            <ResultCard
              icon={TrendingDown}
              label={t("fee.annualFees")}
              value={ils(result.totalAnnualFees)}
            />
          </div>

          <div className="mt-6 p-5 bg-background border border-border/60">
            <p className="text-sm text-foreground/70 leading-relaxed">
              {t("fee.sumTotal")}{" "}
              <span className="font-semibold text-foreground">
                {ils(result.totalFees)}
              </span>
              {t("fee.sumWithout")}{" "}
              <span className="font-semibold text-foreground">
                {ils(result.balance + result.lostToFees)}
              </span>{" "}
              {t("fee.sumDiff")}{" "}
              <span className="font-semibold text-highlight-ink">
                {ils(result.lostToFees)}
              </span>{" "}
              {t("fee.sumKept")}
            </p>
          </div>

          {/* The strongest moment on the site, turned into a lead: right after
              the result, the clearinghouse check that shows the real fees. */}
          <div className="mt-8">
            <PensionCheckForm location="calculator_check" context="אחרי מחשבון דמי הניהול" heading={tp("form.calculatorHeadline")} />
          </div>

          <CalculatorLeadBox className="mt-8" message={feeCalculatorMessageIn(locale, { monthlyDeposit, years }, result)}>
            <CtaLink muted href={lp("/#start")} className="max-sm:w-full">
              {t("fee.ask")}
            </CtaLink>
          </CalculatorLeadBox>
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