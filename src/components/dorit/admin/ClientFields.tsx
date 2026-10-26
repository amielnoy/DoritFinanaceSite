import React from "react";
import { Field, inputClass } from "@/components/dorit/primitives/Field";
import { PRODUCT_LABELS, PRODUCTS } from "@/config/staff-clients";
import type { Product } from "@/lib/staff-lead-types";
import { israelToday } from "@/lib/wall-clock";

/**
 * "לקוח/ה מאז" and "תחומים" (docs/superpowers/specs/2026-10-22-staff-client-design.md):
 * a month and year from 01/1990 to this month in Israel — nobody remembers the
 * day a relationship began, and on the 31st at 23:30 UTC it is already next
 * month there — and the service lines as chips, at least one. The add sheet and
 * the drawer of any client row share it.
 */
export const FIRST_YEAR = 1990;

/** This month in Israel, YYYY-MM. */
export const israelMonth = (now: Date): string => israelToday(now).slice(0, 7);

export default function ClientFields({
  since,
  products,
  onChange,
  now = new Date(),
}: {
  /** YYYY-MM. */
  since: string;
  products: Product[];
  onChange(v: { since: string; products: Product[] }): void;
  now?: Date;
}) {
  const latest = israelMonth(now);
  const [lastYear, lastMonth] = latest.split("-").map(Number);
  const [year, month] = since ? since.split("-") : ["", ""];
  const years = Array.from({ length: lastYear - FIRST_YEAR + 1 }, (_, i) => String(lastYear - i));
  const months = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, "0"));
  // A year change that would land in the future comes back to this month.
  const at = (y: string, m: string) => {
    const next = `${y}-${m}`;
    return next > latest ? latest : next;
  };
  const toggle = (p: Product) =>
    onChange({ since, products: products.includes(p) ? products.filter((x) => x !== p) : PRODUCTS.filter((x) => x === p || products.includes(x)) });

  return (
    <>
      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1.5 text-[15px] text-foreground/80">לקוח/ה מאז</legend>
        <div className="grid grid-cols-2 gap-3">
          <Field label="חודש">
            <select value={month} onChange={(e) => onChange({ since: at(year || String(lastYear), e.target.value), products })} className={inputClass()}>
              {months.map((m) => (
                <option key={m} value={m} disabled={Number(year) === lastYear && Number(m) > lastMonth}>{m}</option>
              ))}
            </select>
          </Field>
          <Field label="שנה">
            <select value={year} onChange={(e) => onChange({ since: at(e.target.value, month || "01"), products })} className={inputClass()}>
              {years.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </Field>
        </div>
      </fieldset>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1.5 text-[15px] text-foreground/80">תחומים</legend>
        <div className="flex flex-wrap gap-2">
          {PRODUCTS.map((p) => (
            <button key={p} type="button" aria-pressed={products.includes(p)} onClick={() => toggle(p)}
              className={`min-h-11 rounded-md border px-3 text-base ${products.includes(p) ? "border-highlight bg-highlight/15" : "border-input"}`}>
              {PRODUCT_LABELS[p]}
            </button>
          ))}
        </div>
      </fieldset>
    </>
  );
}
