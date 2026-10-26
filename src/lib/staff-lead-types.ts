/** Pure types of staff-created leads — no imports, so the api/ typecheck (which reaches ports.ts) stays free of Vite's import.meta. */
export type Intake = "phone" | "in_person" | "referral" | "event" | "existing_client" | "other";
/** How the person was told. "agreement" (in the engagement agreement) only for a client. */
export type NoticeMethod = "verbal" | "email" | "whatsapp" | "agreement";
export type LeadNoticeMethod = Exclude<NoticeMethod, "agreement">;
/** A service line the agency gives a client (supabase/migrations/20261113000000_staff_clients.sql). */
export type Product = "pension" | "provident" | "life" | "health" | "savings" | "planning" | "claims" | "other";
