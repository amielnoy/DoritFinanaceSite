import React, { useEffect, useId, useState } from "react";
import type { OnboardingField } from "@/config/onboarding";

/**
 * How each field of src/config/onboarding.ts is typed. The wizard renders a
 * step from onboarding.ts's own list — this only says which input a key is.
 * tests/contract/agency-onboarding-ui.contract.test.ts fails when a field in
 * onboarding.ts has no widget here, so a new field cannot be left without a form.
 */
export type Widget =
  | { kind: "text"; maxLength: number; dir?: "ltr"; hint?: string }
  | { kind: "textarea"; maxLength: number; recommended?: number; hint?: string }
  | { kind: "email" }
  | { kind: "date"; hint?: string }
  | { kind: "gender" }
  | { kind: "title" }
  | { kind: "photo" }
  | { kind: "licenceTypes" }
  | { kind: "yesno" }
  | { kind: "list"; hint?: string }
  | { kind: "phone" }
  | { kind: "emails" }
  | { kind: "stats" }
  | { kind: "reviewLinks" }
  | { kind: "url"; hint?: string }
  | { kind: "minutes" };

export const FIELD_WIDGETS: Record<string, Widget> = {
  // 0 · פתיחת סוכנות
  "agencies.name": { kind: "text", maxLength: 200 },
  "agency_profiles.onboarding.review.owner_email": { kind: "email" },
  "agencies.data_processing_agreement_date": { kind: "date", hint: "אפשר להשאיר ריק עכשיו — הוא נדרש רק להפעלה." },
  // 1 · בעל/ת הרישיון
  "agents.full_name": { kind: "text", maxLength: 120 },
  "agents.grammatical_gender": { kind: "gender" },
  "agents.professional_title": { kind: "title" },
  "agency_profiles.display_name": { kind: "text", maxLength: 120, hint: "כך יופיע השם בכותרת האתר ובהודעות." },
  "agents.photo_path": { kind: "photo" },
  "agents.photo_alt": { kind: "text", maxLength: 200, hint: "למי שלא רואה את התמונה, למשל ״דנה כהן במשרד״." },
  // 2 · רישוי וגילוי נאות
  "agents.licence_number": { kind: "text", maxLength: 20, dir: "ltr", hint: "למשל L-0012345. הבדיקה מול מרשם הרשות נעשית לפני ההפעלה." },
  "agents.licence_types": { kind: "licenceTypes" },
  "agents.licence_regulator": { kind: "text", maxLength: 120 },
  "agents.has_institutional_affiliation": { kind: "yesno" },
  "agents.affiliations": { kind: "list", hint: "שם אחד בכל שורה." },
  "agency_profiles.licence_entity": { kind: "text", maxLength: 200, hint: "השורה שמופיעה בגילוי הנאות. מולאה מהשם והתואר." },
  // 3 · פרטי קשר
  "agency_profiles.phone_e164": { kind: "phone" },
  "agency_profiles.email": { kind: "email" },
  "agency_profiles.default_whatsapp_message": { kind: "textarea", maxLength: 500, hint: "ההודעה שהמבקר/ת שולח/ת כשלוחצים על וואטסאפ באתר." },
  "agency_profiles.service_area": { kind: "text", maxLength: 200 },
  "agency_profiles.notify_emails": { kind: "emails" },
  "agency_profiles.website_url": { kind: "url", hint: "אם יש לסוכנות אתר משלה, למשל https://www.example.co.il" },
  "agency_profiles.whatsapp_group_url": { kind: "url", hint: "קישור ההצטרפות לקבוצה, https://chat.whatsapp.com/…" },
  "agency_profiles.facebook_group_url": { kind: "url", hint: "הקישור לקבוצה או לעמוד, https://www.facebook.com/…" },
  // 4 · אודות
  "agents.bio.headline": {
    kind: "textarea",
    maxLength: 200,
    recommended: 90,
    hint: "משפט אחד שאומר ללקוחות למה לבחור בך. מופיע בראש האתר, מתחת לשם.",
  },
  "agents.bio.career": { kind: "textarea", maxLength: 1200, recommended: 500 },
  "agents.bio.credentials": { kind: "textarea", maxLength: 600, recommended: 250 },
  "agents.bio.unique": { kind: "textarea", maxLength: 600, recommended: 250 },
  "agents.bio.family": { kind: "textarea", maxLength: 300, recommended: 120, hint: "השורה הזו מוצגת לכולם באתר." },
  "agents.stats": { kind: "stats" },
  "agents.bio.signature": { kind: "text", maxLength: 40, hint: "ברירת המחדל: השם הפרטי." },
  // 5 · המלצות
  "agents.review_links": { kind: "reviewLinks" },
  // 6 · פגישות
  "agents.booking_url": { kind: "url", hint: "Google appointment schedule, Calendly או Outlook Bookings." },
  "agents.meeting_minutes": { kind: "minutes" },
};

export const PROFESSIONAL_TITLES = ["סוכנת ביטוח", "סוכן ביטוח", "מתכננת פיננסית", "מתכנן פיננסי", "סוכנת פנסיוני", "סוכן פנסיוני", "יועצת פנסיונית", "יועץ פנסיוני"];

export const LICENCE_TYPE_LABELS: Record<string, string> = {
  pension_agent: "סוכן/ת ביטוח פנסיוני",
  life_agent: "סוכן/ת ביטוח חיים",
  general_agent: "סוכן/ת ביטוח כללי",
  pension_advisor: "יועץ/ת פנסיוני",
  pension_marketer: "משווק/ת פנסיוני",
};

const INPUT = "w-full min-h-11 rounded-md border border-border bg-card px-3 text-sm focus:border-accent focus:outline-none";
const CHIP = (on: boolean) =>
  `min-h-11 rounded-full border px-3 text-sm ${on ? "border-accent bg-accent/10 text-accent" : "border-border hover:border-accent"}`;

/**
 * Hebrew text with a link or an address inside: each Latin run is isolated
 * left-to-right, or the bidi algorithm prints "https://chat.whatsapp.com/…"
 * back to front inside the right-to-left line.
 */
export function Bidi({ text }: { text: string }) {
  // A Latin run keeps its spaces and commas while Latin follows: "Google appointment schedule, Calendly" is one isolate, not four.
  const parts = text.split(/((?:https?:\/\/)?[A-Za-z0-9](?:[\w\-/:?=&%#@+…]|\.(?=[\w/])|[ ,]+(?=[A-Za-z0-9]))*)/);
  return (
    <>
      {parts.map((p, i) => (i % 2 ? <bdi key={i} dir="ltr">{p}</bdi> : p))}
    </>
  );
}

type StatRow = { num?: string; label?: string };
const statFilled = (r: StatRow) => Boolean((r.num ?? "").trim() || (r.label ?? "").trim());

/**
 * The three stat rows keep their places while one types: the stored list
 * drops empty rows (the site shows only filled ones), the rows on screen do not.
 */
function StatsRows({ value, onChange, onBlur, readOnly }: { value: unknown; onChange: (v: unknown) => void; onBlur?: () => void; readOnly?: boolean }) {
  const stored = (Array.isArray(value) ? value : []) as StatRow[];
  const fill = (list: StatRow[]) => [0, 1, 2].map((i) => list[i] ?? { num: "", label: "" });
  const [rows, setRows] = useState<StatRow[]>(() => fill(stored));
  // Follow the stored list when it changes from outside (a reload after a conflict).
  useEffect(() => {
    if (JSON.stringify(rows.filter(statFilled)) !== JSON.stringify(stored)) setRows(fill(stored));
  }, [JSON.stringify(stored)]);
  const write = (i: number, key: "num" | "label", v: string) => {
    const next = rows.map((r, j) => (j === i ? { ...r, [key]: v } : r));
    setRows(next);
    onChange(next.filter(statFilled));
  };
  return (
    <div className="mt-1 space-y-2">
      {rows.map((r, i) => (
        <div key={i} className="grid grid-cols-[6rem_1fr] gap-2">
          <input aria-label={`מספר ${i + 1}`} maxLength={12} value={r.num ?? ""} onChange={(e) => write(i, "num", e.target.value)} onBlur={onBlur} disabled={readOnly} className={INPUT} placeholder="15+" />
          <input aria-label={`תיאור מספר ${i + 1}`} maxLength={40} value={r.label ?? ""} onChange={(e) => write(i, "label", e.target.value)} onBlur={onBlur} disabled={readOnly} className={INPUT} placeholder="שנות ניסיון" />
        </div>
      ))}
    </div>
  );
}

const parseList = (text: string) => text.split(/\n|,/).map((s) => s.trim()).filter(Boolean);

/**
 * One item per line. The box keeps exactly what is typed — a new line
 * included — and the stored list is parsed from it; rebuilding the box from
 * the list on every key would swallow the Enter before the next item is typed.
 */
function ListText({ value, onChange, ...rest }: { value: unknown; onChange: (v: unknown) => void } & Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "onChange">) {
  const stored = (Array.isArray(value) ? value : []).map(String);
  const [text, setText] = useState(() => stored.join("\n"));
  // Follow the stored list when it changes from outside (a reload, "לא" clearing the bodies).
  useEffect(() => {
    if (JSON.stringify(parseList(text)) !== JSON.stringify(stored)) setText(stored.join("\n"));
  }, [JSON.stringify(stored)]);
  return (
    <textarea
      {...rest}
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        onChange(parseList(e.target.value));
      }}
    />
  );
}

const asText = (v: unknown) => (typeof v === "string" ? v : "");
const asList = (v: unknown) => (Array.isArray(v) ? (v as unknown[]).map(String) : []);

export interface FieldInputProps {
  field: OnboardingField;
  value: unknown;
  /** The stored value changed (it is saved on blur and on "המשך"). */
  onChange: (value: unknown) => void;
  onBlur?: () => void;
  /** Shown under the field: why it is not acceptable yet. */
  problem?: string | null;
  /** The phone is typed as one number and stored as three; the page derives them. */
  phoneText?: string;
  onPhoneText?: (text: string) => void;
  /** The photo has its own upload flow; the page renders it. */
  photo?: React.ReactNode;
  readOnly?: boolean;
}

/** One field of a step, by its widget. */
export function FieldInput({ field, value, onChange, onBlur, problem, phoneText, onPhoneText, photo, readOnly }: FieldInputProps) {
  const id = useId();
  const widget = FIELD_WIDGETS[field.key];
  const required = field.required !== "optional";
  const label = (
    <span className="block text-sm font-medium">
      {field.label}
      {required ? <span aria-hidden="true" className="text-destructive"> *</span> : <span className="text-xs text-muted-foreground"> (רשות)</span>}
    </span>
  );
  const hint = widget && "hint" in widget && widget.hint ? <span className="mt-1 block text-xs text-muted-foreground"><Bidi text={widget.hint} /></span> : null;
  const issue = problem ? <span role="alert" className="mt-1 block text-xs text-destructive"><Bidi text={problem} /></span> : null;
  const common = { id, onBlur, disabled: readOnly, "aria-invalid": problem ? true : undefined, "aria-required": required || undefined };

  if (!widget) return null;
  switch (widget.kind) {
    case "text":
    case "email":
    case "url":
      return (
        <label htmlFor={id} className="block">
          {label}
          <input
            {...common}
            type={widget.kind === "text" ? "text" : widget.kind}
            dir={widget.kind === "text" ? widget.dir : "ltr"}
            maxLength={widget.kind === "text" ? widget.maxLength : 254}
            value={asText(value)}
            // A cleared link is stored as null, never "": the url columns' CHECKs refuse an empty string.
            onChange={(e) => onChange(widget.kind === "url" ? e.target.value.trim() || null : e.target.value)}
            className={`${INPUT} mt-1 ${widget.kind !== "text" || widget.dir ? "text-left" : ""}`}
          />
          {hint}
          {issue}
        </label>
      );
    case "date":
      return (
        <label htmlFor={id} className="block">
          {label}
          <input {...common} type="date" value={asText(value)} onChange={(e) => onChange(e.target.value || null)} className={`${INPUT} mt-1`} />
          {hint}
          {issue}
        </label>
      );
    case "textarea": {
      const text = asText(value);
      return (
        <label htmlFor={id} className="block">
          {label}
          <textarea {...common} rows={widget.maxLength > 300 ? 5 : 3} maxLength={widget.maxLength} value={text} onChange={(e) => onChange(e.target.value)} className={`${INPUT} mt-1 py-2`} />
          {widget.recommended ? (
            <span className={`mt-1 block text-xs ${text.length > widget.recommended ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground"}`}>
              {text.length} תווים · מומלץ עד {widget.recommended}
            </span>
          ) : null}
          {hint}
          {issue}
        </label>
      );
    }
    case "gender":
      return (
        <fieldset>
          <legend>{label}</legend>
          <div className="mt-1 flex gap-2">
            {[
              ["f", "נקבה"],
              ["m", "זכר"],
            ].map(([v, text]) => (
              <button key={v} type="button" aria-pressed={value === v} disabled={readOnly} onClick={() => onChange(v)} className={CHIP(value === v)}>
                {text}
              </button>
            ))}
          </div>
          <span className="mt-1 block text-xs text-muted-foreground">כך האתר והגילוי הנאות ינסחו את הפנייה אליך ועליך.</span>
          {issue}
        </fieldset>
      );
    case "title":
      return (
        <label htmlFor={id} className="block">
          {label}
          <input {...common} list={`${id}-titles`} maxLength={120} value={asText(value)} onChange={(e) => onChange(e.target.value)} className={`${INPUT} mt-1`} />
          <datalist id={`${id}-titles`}>{PROFESSIONAL_TITLES.map((t) => <option key={t} value={t} />)}</datalist>
          <span className="mt-1 block text-xs text-muted-foreground">אפשר לבחור מהרשימה או לכתוב בחופשיות.</span>
          {issue}
        </label>
      );
    case "photo":
      return (
        <div>
          {label}
          <div className="mt-1">{photo}</div>
        </div>
      );
    case "licenceTypes": {
      const chosen = asList(value);
      return (
        <fieldset>
          <legend>{label}</legend>
          <div className="mt-1 flex flex-wrap gap-2">
            {Object.entries(LICENCE_TYPE_LABELS).map(([v, text]) => {
              const on = chosen.includes(v);
              return (
                <button key={v} type="button" aria-pressed={on} disabled={readOnly} onClick={() => onChange(on ? chosen.filter((x) => x !== v) : [...chosen, v])} className={CHIP(on)}>
                  {text}
                </button>
              );
            })}
          </div>
          {issue}
        </fieldset>
      );
    }
    case "yesno":
      return (
        <fieldset>
          <legend>{label}</legend>
          <div className="mt-1 flex gap-2">
            {[
              [true, "כן"],
              [false, "לא"],
            ].map(([v, text]) => (
              <button key={String(v)} type="button" aria-pressed={value === v} disabled={readOnly} onClick={() => onChange(v)} className={CHIP(value === v)}>
                {text as string}
              </button>
            ))}
          </div>
          <span className="mt-1 block text-xs text-muted-foreground">זיקה לחברות ביטוח או לבתי השקעות קובעת אם הפעילות היא שיווק פנסיוני או ייעוץ.</span>
          {issue}
        </fieldset>
      );
    case "list":
    case "emails":
      return (
        <label htmlFor={id} className="block">
          {label}
          <ListText
            {...common}
            rows={3}
            dir={widget.kind === "emails" ? "ltr" : undefined}
            value={value}
            onChange={onChange}
            className={`${INPUT} mt-1 py-2 ${widget.kind === "emails" ? "text-left" : ""}`}
          />
          <span className="mt-1 block text-xs text-muted-foreground">
            {widget.kind === "emails" ? "כתובת אחת בכל שורה. לשם יישלחו הודעות על פניות חדשות." : widget.hint ? <Bidi text={widget.hint} /> : null}
          </span>
          {issue}
        </label>
      );
    case "phone":
      return (
        <label htmlFor={id} className="block">
          {label}
          <input {...common} type="tel" dir="ltr" value={phoneText ?? ""} onChange={(e) => onPhoneText?.(e.target.value)} className={`${INPUT} mt-1 text-left`} />
          <span className="mt-1 block text-xs text-muted-foreground">מספר נייד אחד — לשיחות ולוואטסאפ.</span>
          {issue}
        </label>
      );
    case "stats":
      return (
        <fieldset>
          <legend>{label}</legend>
          <StatsRows value={value} onChange={onChange} onBlur={onBlur} readOnly={readOnly} />
          {issue}
        </fieldset>
      );
    case "reviewLinks": {
      const links = (value && typeof value === "object" ? value : {}) as Record<string, string>;
      const write = (k: string, v: string) => {
        const next = { ...links, [k]: v.trim() };
        if (!next[k]) delete next[k];
        onChange(next);
      };
      return (
        <fieldset>
          <legend>{label}</legend>
          <div className="mt-1 space-y-2">
            {[
              ["google", "Google"],
              ["midrag", "מידרג"],
            ].map(([k, text]) => (
              <label key={k} className="block text-sm">
                {text}
                <input type="url" dir="ltr" value={links[k] ?? ""} onChange={(e) => write(k, e.target.value)} onBlur={onBlur} disabled={readOnly} className={`${INPUT} mt-1 text-left`} placeholder="https://" />
              </label>
            ))}
          </div>
          {issue}
        </fieldset>
      );
    }
    case "minutes":
      return (
        <label htmlFor={id} className="block">
          {label}
          <select {...common} value={String(value ?? 15)} onChange={(e) => onChange(Number(e.target.value))} className={`${INPUT} mt-1`}>
            {[15, 20, 30, 45, 60].map((m) => (
              <option key={m} value={m}>{m} דקות</option>
            ))}
          </select>
          {issue}
        </label>
      );
  }
}
