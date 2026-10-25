import React, { useMemo, useState } from "react";
import { Calculator, TrendingDown, Wallet, PiggyBank } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { CtaLink } from "@/components/dorit/primitives/Cta";
import { PENSION_FEE_RANGES, clamp, computePensionFees, type PensionFeeResult } from "@/lib/pension-fee";
import Eyebrow from "@/components/dorit/primitives/Eyebrow";
import CalculatorLeadBox from "@/components/dorit/sections/CalculatorLeadBox";
import { feeCalculatorMessageIn, formatIlsIn } from "@/i18n/tools";
import { useCalculatorResultEvent } from "@/hooks/useCalculatorResultEvent";
import { TOOL_SECTION } from "@/config/tools";
import PensionCheckForm from "@/components/dorit/forms/PensionCheckForm";
import { useLocale, useLocalePath, useT } from "@/i18n/LocaleContext";
import Glossed from "@/components/dorit/primitives/Glossed";

interface NumFieldProps {
  label: string;
  value: number | string;
  onChange: (v: string) => void;
  step?: number;
  range: { min: number; max: number };
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
    <section id={TOOL_SECTION.feeCalculator} className="relative py-16 md:py-24 border-t border-border scroll-mt-28">
      <div className="max-w-[1200px] mx-auto px-[clamp(20px,4vw,40px)] grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8 items-start">
        <div className="lg:col-span-12 max-w-3xl mb-4">
          <Eyebrow>
            {t("fee.eyebrow")}
          </Eyebrow>
          <h2 className="font-heading font-bold text-[clamp(28px,3.2vw,40px)] mt-4 leading-tight">
            {t("fee.titleLine1")}
            <br className="sm:hidden" />{" "}
            {t("fee.titleLine2")}
          </h2>
          <p className="mt-4 text-foreground/75 leading-relaxed">
            <Glossed text={t("fee.intro")} />
          </p>
          <div className="mt-4 flex items-center gap-3 text-sm text-muted-foreground">
            <Calculator size={16} className="text-accent" aria-hidden="true" />
            <span>{t("fee.estimate")}</span>
          </div>
        </div>

        <div className="lg:col-span-5 card-raised p-6 md:p-8 lg:sticky lg:top-32">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 gap-5">
            <NumField
              label={t("fee.deposit")}
              value={monthlyDeposit}
              onChange={edit(setMonthlyDeposit)}
              step={100}
              range={PENSION_FEE_RANGES.monthlyDeposit}
            />
            <NumField
              label={t("fee.years")}
              value={years}
              onChange={edit(setYears)}
              step={1}
              range={{ ...PENSION_FEE_RANGES.years, min: 1 }}
            />
            <NumField
              label={t("fee.depositFee")}
              value={depositFee}
              onChange={edit(setDepositFee)}
              step={0.1}
              range={PENSION_FEE_RANGES.depositFee}
            />
            <NumField
              label={t("fee.annualFee")}
              value={annualFee}
              onChange={edit(setAnnualFee)}
              step={0.05}
              range={PENSION_FEE_RANGES.annualFee}
            />
            <div className="sm:col-span-2 lg:col-span-1">
              <NumField
                label={t("fee.return")}
                value={annualReturn}
                onChange={edit(setAnnualReturn)}
                step={0.5}
                range={PENSION_FEE_RANGES.annualReturn}
              />
            </div>
          </div>
        </div>

        <div className="lg:col-span-7 flex flex-col gap-6">
          <div className="grid grid-cols-2 gap-3 sm:gap-4">
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

          <div className="flex items-start gap-4 rounded-2xl border border-highlight/25 bg-highlight/10 p-5 md:p-6">
            <span className="shrink-0 w-11 h-11 rounded-xl bg-primary text-primary-foreground flex items-center justify-center" aria-hidden="true">
              <Wallet size={20} strokeWidth={1.75} />
            </span>
            <p className="text-[15px] text-foreground/80 leading-relaxed">
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
          <div>
            <PensionCheckForm location="calculator_check" context="אחרי מחשבון דמי הניהול" heading={tp("form.calculatorHeadline")} />
          </div>

          <CalculatorLeadBox message={feeCalculatorMessageIn(locale, { monthlyDeposit, years }, result)}>
            <CtaLink muted href={lp("/#start")} className="max-sm:w-full">
              {t("fee.ask")}
            </CtaLink>
          </CalculatorLeadBox>
        </div>
      </div>
    </section>
  );
}

/**
 * A number field with the calculator's own limits (PENSION_FEE_RANGES). The
 * math clamps on its own; leaving the field clamps what it shows too, so the
 * visitor never reads a result for a figure other than the one on screen.
 * An emptied field stays empty until they type again.
 */
function NumField({ label, value, onChange, step = 1, range }: NumFieldProps) {
  const id = React.useId();
  const settle = () => {
    if (value === "") return;
    const n = Number(value);
    if (!Number.isFinite(n)) return;
    const kept = clamp(n, range);
    if (kept !== n) onChange(String(kept));
  };
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-foreground/80 mb-2">
        {label}
      </label>
      <input
        id={id}
        type="number"
        value={value}
        min={range.min}
        max={range.max}
        step={step}
        onChange={(e) => onChange(e.target.value)}
        onBlur={settle}
        className="w-full rounded-xl bg-secondary/60 border border-input px-4 py-3 text-base font-medium focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/40 transition-colors"
      />
    </div>
  );
}

function ResultCard({ icon: Icon, label, value, highlight }: ResultCardProps) {
  return (
    <div
      className={`card-raised p-4 sm:p-5 ${highlight ? "!border-highlight/40" : ""}`}
    >
      <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
        <Icon size={14} className={highlight ? "text-highlight-ink" : "text-accent"} />
        {label}
      </div>
      <p className={`font-heading font-extrabold text-[clamp(22px,2.4vw,30px)] leading-tight lining-nums tabular-nums ${highlight ? "text-accent" : "text-foreground"}`}>
        {value}
      </p>
    </div>
  );
}