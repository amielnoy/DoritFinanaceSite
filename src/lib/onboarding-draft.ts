import { ONBOARDING_STEPS, submitRequiredKeys } from "@/config/onboarding";

/**
 * The new-agency wizard's draft: the three rows a step writes, kept as the
 * table has them (snake_case), so every field is reached by the very key
 * src/config/onboarding.ts names — `table.column` or `table.column.path`.
 * The forms, the checklist and the save all go through getField / setField;
 * no screen spells a column of its own.
 */

export type Row = Record<string, unknown>;

export interface OnboardingDraft {
  agencies: Row;
  agency_profiles: Row;
  /** Null until step 1 is first saved: the licensee's row is created then. */
  agents: Row | null;
}

export const DEFAULT_REGULATOR = "רשות שוק ההון, ביטוח וחיסכון";

/** A just-opened agency, as create_agency leaves it: a name, a profile row named after it, no licensee yet. */
export function emptyDraft(agencyId: string, name: string): OnboardingDraft {
  return {
    agencies: { id: agencyId, name, status: "draft", data_processing_agreement_date: null },
    agency_profiles: { agency_id: agencyId, display_name: name, onboarding: {} },
    agents: null,
  };
}

/** The agent row's defaults, as the table gives them, for a licensee not yet saved. */
const AGENT_DEFAULTS: Row = {
  licence_types: [],
  licence_regulator: DEFAULT_REGULATOR,
  affiliations: [],
  bio: {},
  stats: [],
  review_links: {},
  meeting_minutes: 15,
};

const parts = (key: string) => {
  const [table, ...path] = key.split(".");
  return { table: table as keyof OnboardingDraft, path };
};

/** The value at `table.column[.path]`, or undefined. */
export function getField(draft: OnboardingDraft, key: string): unknown {
  const { table, path } = parts(key);
  let at: unknown = table === "agents" ? { ...AGENT_DEFAULTS, ...(draft.agents ?? {}) } : draft[table];
  for (const p of path) {
    if (at === null || typeof at !== "object") return undefined;
    at = (at as Row)[p];
  }
  return at;
}

/** A new draft with `value` at `table.column[.path]`; jsonb objects on the way are copied, never mutated. */
export function setField(draft: OnboardingDraft, key: string, value: unknown): OnboardingDraft {
  const { table, path } = parts(key);
  const write = (obj: Row, rest: string[]): Row => {
    const [head, ...tail] = rest;
    if (!tail.length) return { ...obj, [head]: value };
    const inner = obj[head];
    return { ...obj, [head]: write(inner && typeof inner === "object" && !Array.isArray(inner) ? (inner as Row) : {}, tail) };
  };
  const base = table === "agents" ? { ...AGENT_DEFAULTS, ...(draft.agents ?? {}) } : draft[table] ?? {};
  return { ...draft, [table]: write(base as Row, path) };
}

const empty = (v: unknown): boolean =>
  v === null || v === undefined || (typeof v === "string" && v.trim() === "") || (Array.isArray(v) && v.length === 0);

/**
 * The required keys still empty — the browser's copy of onboarding_missing
 * (which signed-in people may not call), in onboarding.ts order. The RPC's
 * `incomplete` answer stays the authority; this drives the checklist as one types.
 */
export function missingKeys(draft: OnboardingDraft): string[] {
  const conditional = new Map(
    ONBOARDING_STEPS.flatMap((s) => s.fields)
      .filter((f) => f.requiredWhen)
      .map((f) => [f.key, f.requiredWhen!] as const),
  );
  return submitRequiredKeys().filter((key) => {
    const when = conditional.get(key);
    if (when && getField(draft, `agents.${when}`) !== true) return false;
    if (key.startsWith("agents.") && !draft.agents) return key !== "agents.licence_regulator";
    return empty(getField(draft, key));
  });
}

/** Digits of an Israeli mobile as its national 05XXXXXXXX, or null. */
function nationalMobile(input: string): string | null {
  const digits = input.replace(/\D/g, "").replace(/^972/, "0");
  return /^05\d{8}$/.test(digits) ? digits : null;
}

export function isMobile(input: string): boolean {
  return nationalMobile(input) !== null;
}

/** The one number typed in step 3, written to the three columns onboarding.ts names (`alsoWrites`). */
export function phoneFields(input: string): { phone_e164: string; phone_display: string; whatsapp: string } {
  const n = nationalMobile(input);
  if (!n) throw new Error("not a mobile number");
  return {
    phone_e164: `+972${n.slice(1)}`,
    phone_display: `${n.slice(0, 3)}-${n.slice(3, 6)}-${n.slice(6)}`,
    whatsapp: `972${n.slice(1)}`,
  };
}

/** "שם — תואר", the shape of Dorit's own licence line. */
export function defaultLicenceEntity(fullName: string, title: string): string {
  const name = fullName.trim();
  return title.trim() ? `${name} — ${title.trim()}` : name;
}

export const firstName = (fullName: string) => fullName.trim().split(/\s+/)[0] ?? "";

/** The message a visitor's WhatsApp opens with, addressed to the licensee by first name (Dorit's, generalised). */
export function defaultWhatsappMessage(fullName: string): string {
  return `שלום ${firstName(fullName)}, אשמח/ה לשמוע פרטים נוספים על תכנון פיננסי וביטוחי.`;
}

export type Gender = "f" | "m";
const g = (gender: Gender | null, f: string, m: string) => (gender === "m" ? m : f);

/**
 * The disclosure sentences the visitor will see, built from step 2's fields
 * and step 1's gender — the text the compliance reviewer approves. With an
 * affiliation it is compliance.ts's PENSION_MARKETING_DISCLOSURE word for word.
 */
export function disclosurePreview(input: {
  entity: string;
  gender: Gender | null;
  regulator: string;
  number: string;
  affiliated: boolean | null;
  displayName: string;
}): { licence: string; bot: string } {
  const holder = `${input.entity} ${g(input.gender, "בעלת", "בעל")} רישיון סוכן מ${input.regulator} מס' ${input.number}`;
  const licence = input.affiliated
    ? `${holder}, ו${g(input.gender, "לה", "לו")} זיקה לגופים מוסדיים. הפעילות היא שיווק פנסיוני ולא ייעוץ פנסיוני אובייקטיבי.`
    : `${holder}, ואין ${g(input.gender, "לה", "לו")} זיקה לגופים מוסדיים.`;
  const bot = `זהו עוזר אוטומטי (בינה מלאכותית) של ${input.displayName} — לא ${input.displayName} ${g(input.gender, "עצמה", "עצמו")} ולא ${g(input.gender, "בעלת", "בעל")} רישיון.`;
  return { licence, bot };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * What a step changed, per table, as whole columns: a jsonb path's change
 * (agents.bio.headline) writes the whole bio object. `agencies.*` is the
 * operator's step 0 and is never written from the wizard.
 */
export function stepPatches(keys: readonly string[], draft: OnboardingDraft, saved: OnboardingDraft): { agency_profiles: Row; agents: Row } {
  const out = { agency_profiles: {} as Row, agents: {} as Row };
  for (const key of keys) {
    const [table, column] = key.split(".");
    if (table !== "agency_profiles" && table !== "agents") continue;
    const now = getField(draft, `${table}.${column}`);
    if (!same(now, getField(saved, `${table}.${column}`)) || (table === "agents" && !saved.agents && now !== undefined)) {
      out[table][column] = now;
    }
  }
  return out;
}

const EMAIL = /^[^@\s,;<>"]+@[^@\s,;<>"]+\.[^@\s,;<>"]+$/;

/** Why a typed value cannot be saved as it is, in Hebrew; null when it can (empty is allowed — the checklist asks for it). */
export function fieldProblem(key: string, value: unknown): string | null {
  const text = typeof value === "string" ? value.trim() : "";
  if (key.endsWith(".email") || key.endsWith(".owner_email")) return text && !EMAIL.test(text) ? "כתובת הדוא״ל אינה תקינה." : null;
  if (key === "agency_profiles.notify_emails") {
    const bad = (Array.isArray(value) ? value : []).find((e) => !EMAIL.test(String(e)));
    return bad ? `הכתובת ${String(bad)} אינה תקינה.` : null;
  }
  if (key === "agents.booking_url") return text && !/^https:\/\//.test(text) ? "הקישור צריך להתחיל ב-https://" : null;
  if (key === "agents.review_links") {
    const bad = Object.values((value ?? {}) as Record<string, string>).find((u) => !/^https:\/\//.test(u));
    return bad ? "הקישורים צריכים להתחיל ב-https://" : null;
  }
  return null;
}
