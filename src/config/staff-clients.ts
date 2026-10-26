import { SITE_URL } from "@/lib/seo";
import { CONTACT } from "./contact";
import { NOTICE_LABELS } from "./staff-leads";
import type { NoticeMethod, Product } from "@/lib/staff-lead-types";

/**
 * Staff-added clients (docs/superpowers/specs/2026-10-22-staff-client-design.md).
 * Off unless the build says exactly "true" (after a trim), like VITE_STAFF_LEADS.
 * The client mode needs both switches: it lives in the staff-lead sheet.
 */
export const isStaffClientsOn = (value: string | undefined): boolean => (value ?? "").trim() === "true";

export const STAFF_CLIENTS: boolean = isStaffClientsOn(import.meta.env.VITE_STAFF_CLIENTS);

/** Same list and labels as supabase/functions/_shared/staff-clients.ts and the migration's check. */
export const PRODUCT_LABELS: Record<Product, string> = {
  pension: "פנסיה",
  provident: "גמל והשתלמות",
  life: "ביטוח חיים ומשכנתא",
  health: "בריאות וסיעוד",
  savings: "חיסכון והשקעות",
  planning: "תכנון פיננסי",
  claims: "ליווי תביעות",
  other: "אחר",
};
export const PRODUCTS = Object.keys(PRODUCT_LABELS) as Product[];

/** Every method, as the drawer and CSV name it; a client's form offers them in this order. */
export const CLIENT_NOTICE_LABELS: Record<NoticeMethod, string> = {
  agreement: "בהסכם ההתקשרות",
  ...NOTICE_LABELS,
};
export const CLIENT_NOTICE_METHODS = Object.keys(CLIENT_NOTICE_LABELS) as NoticeMethod[];

// DRAFT for the compliance adviser: wording not yet approved (staff-client spec C5).
// Agency 1's notice, like the intake one. Retention is the engagement's, not the
// enquiry's 24 months.
// Same text as supabase/functions/create-lead/notice.ts; tests/contract/staff-intake-notice.contract.test.ts keeps the two identical.
export const STAFF_CLIENT_NOTICE = `סוכנות דורית גוב ארי (רישיון סוכן L-00107009) שומרת את הפרטים שמסרת במסגרת הסכם ההתקשרות: שם, טלפון, דוא״ל, תחומי השירות והערות מהשיחות.
הפרטים משמשים כדי לתת לך את השירות שסוכם בהסכם ההתקשרות.
הפרטים נשמרים כנדרש על-פי דין ועל-פי הוראות רשות שוק ההון.
הפרטים גלויים לצוות הסוכנות בלבד.
זכותך לראות את הפרטים, לתקן אותם ולבקש למחוק אותם: ${CONTACT.email}
המדיניות המלאה: ${SITE_URL}/privacy`;
