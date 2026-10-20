/**
 * The new-agency wizard, as data
 * (docs/superpowers/specs/2026-10-16-new-agency-wizard-design.md).
 *
 * Open/Closed, like agents.ts: a field is an entry here, not another form.
 * The checklist on the review step, the server-side check in
 * `submit_agency_for_review` (supabase/migrations/20261106000000_agency_onboarding.sql)
 * and tests/contract/agency-onboarding.contract.test.ts all read the same keys:
 * the RPC refuses an incomplete draft with `incomplete` and the missing keys
 * comma-separated in the error's detail, and `stepOfKey` sends each one back
 * to its step. A required flag changed here and not in the RPC fails the contract.
 *
 * No screen reads this yet (Rollout step 4 builds them).
 */

/** The tables a step writes. A jsonb field's key is `table.column.path`, e.g. `agents.bio.headline`. */
export type OnboardingTable = "agencies" | "agency_profiles" | "agents";

/**
 * When the field must have a value:
 * - "create": `create_agency` refuses without it (step 0);
 * - "submit": `submit_agency_for_review` refuses without it (and `activate_agency` again);
 * - "optional": never.
 */
export type Requirement = "create" | "submit" | "optional";

export interface OnboardingField {
  /** `table.column` or `table.column.path` — the key the RPCs report. */
  key: string;
  label: string;
  required: Requirement;
  /**
   * Required only while this boolean column of the same row is true — the
   * institutional bodies, when "יש זיקה" is answered yes.
   */
  requiredWhen?: string;
  /** Typed once, written to several columns: the one phone number → e164, display, WhatsApp. */
  alsoWrites?: readonly string[];
}

export type StepId = "open" | "licensee" | "licence" | "contact" | "about" | "testimonials" | "meetings" | "review";

export interface OnboardingStep {
  id: StepId;
  /** 0 is the operator's; 1–7 are the owner's (or the operator's on their behalf). */
  number: number;
  title: string;
  fields: readonly OnboardingField[];
}

export const ONBOARDING_STEPS: readonly OnboardingStep[] = [
  {
    id: "open",
    number: 0,
    title: "פתיחת סוכנות",
    fields: [
      { key: "agencies.name", label: "שם הסוכנות", required: "create" },
      // Kept in agency_profiles.onboarding.review: the invitation is invite-user's.
      { key: "agency_profiles.onboarding.review.owner_email", label: "דוא״ל הבעלים", required: "create" },
      // Not needed to open or to send for approval: activation's gate 2.
      { key: "agencies.data_processing_agreement_date", label: "תאריך הסכם עיבוד נתונים", required: "optional" },
    ],
  },
  {
    id: "licensee",
    number: 1,
    title: "בעל/ת הרישיון",
    fields: [
      { key: "agents.full_name", label: "שם מלא", required: "submit" },
      { key: "agents.grammatical_gender", label: "לשון פנייה", required: "submit" },
      { key: "agents.professional_title", label: "תואר מקצועי", required: "submit" },
      { key: "agency_profiles.display_name", label: "השם שמוצג באתר", required: "submit" },
      { key: "agents.photo_path", label: "דיוקן", required: "optional" },
      { key: "agents.photo_alt", label: "תיאור הדיוקן", required: "optional" },
    ],
  },
  {
    id: "licence",
    number: 2,
    title: "רישוי וגילוי נאות",
    fields: [
      { key: "agents.licence_number", label: "מספר רישיון", required: "submit" },
      { key: "agents.licence_types", label: "סוגי רישיון", required: "submit" },
      { key: "agents.licence_regulator", label: "הגוף המפקח", required: "submit" },
      { key: "agents.has_institutional_affiliation", label: "זיקה לגופים מוסדיים", required: "submit" },
      {
        key: "agents.affiliations",
        label: "הגופים המוסדיים",
        required: "submit",
        requiredWhen: "has_institutional_affiliation",
      },
      { key: "agency_profiles.licence_entity", label: "שורת בעל הרישיון", required: "submit" },
    ],
  },
  {
    id: "contact",
    number: 3,
    title: "פרטי קשר",
    fields: [
      {
        key: "agency_profiles.phone_e164",
        label: "טלפון נייד",
        required: "submit",
        alsoWrites: ["agency_profiles.phone_display", "agency_profiles.whatsapp"],
      },
      { key: "agency_profiles.email", label: "דוא״ל", required: "submit" },
      { key: "agency_profiles.default_whatsapp_message", label: "הודעת פתיחה בוואטסאפ", required: "submit" },
      { key: "agency_profiles.service_area", label: "אזור שירות", required: "optional" },
      { key: "agency_profiles.notify_emails", label: "כתובות להתראות", required: "submit" },
    ],
  },
  {
    id: "about",
    number: 4,
    title: "אודות",
    fields: [
      { key: "agents.bio.headline", label: "משפט פתיחה", required: "submit" },
      { key: "agents.bio.career", label: "רקע מקצועי", required: "submit" },
      { key: "agents.bio.credentials", label: "השכלה ותעודות", required: "optional" },
      { key: "agents.bio.unique", label: "מה מייחד אותך", required: "optional" },
      { key: "agents.bio.family", label: "שורה אישית", required: "optional" },
      { key: "agents.stats", label: "עד שלושה מספרים", required: "optional" },
      { key: "agents.bio.signature", label: "חתימה", required: "optional" },
    ],
  },
  {
    id: "testimonials",
    number: 5,
    title: "המלצות ותיקי הצלחה",
    // Testimonials and success cases are rows of their own tables; zero is allowed.
    fields: [{ key: "agents.review_links", label: "קישורים לגוגל ולמידרג", required: "optional" }],
  },
  {
    id: "meetings",
    number: 6,
    title: "פגישות",
    fields: [
      { key: "agents.booking_url", label: "קישור לקביעת פגישה", required: "optional" },
      { key: "agents.meeting_minutes", label: "אורך פגישה", required: "optional" },
    ],
  },
  { id: "review", number: 7, title: "סקירה ושליחה", fields: [] },
];

/**
 * The three gates of "הפעלה", as `activate_agency` names them in `gates_closed`.
 * Not wizard fields: the operator passes them on the review screen.
 */
export const ACTIVATION_GATES = [
  { key: "agents.licence_verified_at", label: "הרישיון נבדק במרשם הרשות" },
  { key: "agencies.data_processing_agreement_date", label: "הסכם עיבוד נתונים נחתם" },
  { key: "agency_profiles.disclosures_approved_at", label: "נוסחי הגילוי הנאות אושרו" },
] as const;

/**
 * Columns only the platform operator writes. The owner sees them read-only;
 * the database's guard triggers refuse anyone else (`operator_only`).
 */
export const OPERATOR_ONLY_COLUMNS = {
  agency_profiles: [
    "domain",
    "mail_from",
    "ga4_measurement_id",
    "consent_version",
    "disclosures_approved_at",
    "disclosures_approved_by",
  ],
  agents: ["licence_verified_at", "licence_verified_by", "verified_licence_number"],
} as const;

const ALL_FIELDS = ONBOARDING_STEPS.flatMap((s) => s.fields);

/**
 * Every key `submit_agency_for_review` holds the draft to, in step order —
 * conditional ones included, and each column a typed-once field also writes.
 */
export function submitRequiredKeys(): string[] {
  return ALL_FIELDS.filter((f) => f.required === "submit").flatMap((f) => [f.key, ...(f.alsoWrites ?? [])]);
}

const STEP_OF_KEY = new Map<string, StepId>(
  ONBOARDING_STEPS.flatMap((s) => s.fields.flatMap((f) => [f.key, ...(f.alsoWrites ?? [])].map((k) => [k, s.id] as const))),
);

/** The step a key the RPC reported belongs to — where the checklist links. Null for an unknown key. */
export function stepOfKey(key: string): StepId | null {
  return STEP_OF_KEY.get(key) ?? null;
}

/**
 * The keys in an `incomplete` refusal's detail ("a,b,c"), grouped by step in
 * step order. A key this file does not know goes under "review", so a field
 * added to the RPC first is still listed, never dropped.
 */
export function missingByStep(detail: string): Array<{ step: StepId; keys: string[] }> {
  const keys = detail.split(",").map((k) => k.trim()).filter(Boolean);
  const grouped = new Map<StepId, string[]>();
  for (const key of keys) {
    const step = stepOfKey(key) ?? "review";
    grouped.set(step, [...(grouped.get(step) ?? []), key]);
  }
  return ONBOARDING_STEPS.filter((s) => grouped.has(s.id)).map((s) => ({ step: s.id, keys: grouped.get(s.id)! }));
}

/**
 * The licence number's format check — loose on purpose ("L-" and digits, the
 * dash and case forgiven). Real verification is the operator's, on the register.
 */
export function isLicenceNumber(value: string): boolean {
  return /^L-?\d{1,12}$/i.test(value.trim());
}
