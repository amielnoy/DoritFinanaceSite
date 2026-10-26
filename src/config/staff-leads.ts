import { SITE_URL } from "@/lib/seo";
import { CONTACT } from "./contact";

/**
 * Staff-created leads (docs/superpowers/specs/2026-10-20-staff-lead-design.md).
 * Off unless the build says exactly "true" (after a trim), like VITE_MEETINGS_STAFF.
 */
export const isStaffLeadsOn = (value: string | undefined): boolean => (value ?? "").trim() === "true";

export const STAFF_LEADS: boolean = isStaffLeadsOn(import.meta.env.VITE_STAFF_LEADS);

import type { Intake, LeadNoticeMethod, NoticeMethod } from "@/lib/staff-lead-types";

export type { Intake, LeadNoticeMethod, NoticeMethod };

export const INTAKE_LABELS: Record<Intake, string> = {
  phone: "שיחת טלפון",
  in_person: "פגישה",
  referral: "הפניה",
  event: "אירוע",
  existing_client: "לקוח/ה קיים/ת",
  other: "אחר",
};

/** The methods the enquiry form offers. A client's list, with "בהסכם ההתקשרות", is in staff-clients.ts. */
export const NOTICE_LABELS: Record<LeadNoticeMethod, string> = {
  verbal: "בעל פה",
  email: "במייל",
  whatsapp: "בוואטסאפ",
};

/** The statuses a member may start a lead with (the server refuses the rest). */
export const STAFF_STATUS_LABELS: Record<"new" | "contacted" | "client", string> = {
  new: "חדשה",
  contacted: "נוצר קשר",
  client: "נסגר (לקוח/ה)",
};

// DRAFT for the compliance adviser: wording not yet approved (staff-leads spec D6).
// Agency 1's notice: it names Dorit's agency as the one keeping the details, so
// the leads screen offers "פנייה חדשה" in agency 1 only until each agency has its own text.
// Same text as supabase/functions/create-lead/notice.ts; tests/contract/staff-intake-notice.contract.test.ts keeps the two identical.
export const STAFF_INTAKE_NOTICE = `סוכנות דורית גוב ארי (רישיון סוכן L-00107009) שומרת את הפרטים שמסרת: שם, טלפון, דוא״ל, נושא הפנייה והערות מהשיחה.
הפרטים משמשים כדי לחזור אליך ולתת את השירות שביקשת.
פנייה שלא הבשילה להתקשרות נשמרת 24 חודשים מהקשר האחרון; מידע על התקשרות בפועל נשמר כנדרש על-פי דין ועל-פי הוראות רשות שוק ההון.
הפרטים גלויים לצוות הסוכנות בלבד.
זכותך לראות את הפרטים, לתקן אותם ולבקש למחוק אותם: ${CONTACT.email}
המדיניות המלאה: ${SITE_URL}/privacy`;
