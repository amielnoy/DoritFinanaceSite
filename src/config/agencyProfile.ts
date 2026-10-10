/**
 * Everything hard-coded for Dorit today, in one place.
 *
 * Phase 0 of docs/superpowers/specs/2026-10-10-multi-agent-platform-design.md:
 * `contact.ts`, `compliance.ts`'s `LICENCE` and `analytics.ts`'s
 * `GA4_MEASUREMENT_ID` now read from here instead of declaring their own
 * values — no behaviour change, no database yet. This object's shape is what
 * a later phase turns into an `agency_profiles` row for agency 1.
 */
export const AGENCY_PROFILE = {
  phoneE164: "+972508311776",
  phoneDisplay: "050-831-1776",
  whatsapp: "972508311776",
  email: "dorit@govari-fin.co.il",
  defaultWhatsappMessage: "שלום דורית, אשמח/ה לשמוע פרטים נוספים על תכנון פיננסי וביטוחי.",
  licenceEntity: "דורית גוב ארי — מתכננת פיננסית וסוכנת ביטוח",
  licenceNumber: "L-00107009",
  licenceRegulator: "רשות שוק ההון, ביטוח וחיסכון",
  ga4MeasurementId: "G-LLSYPMGV58",
} as const;
