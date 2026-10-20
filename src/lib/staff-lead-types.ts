/** Pure types of staff-created leads — no imports, so the api/ typecheck (which reaches ports.ts) stays free of Vite's import.meta. */
export type Intake = "phone" | "in_person" | "referral" | "event" | "existing_client" | "other";
export type NoticeMethod = "verbal" | "email" | "whatsapp";
