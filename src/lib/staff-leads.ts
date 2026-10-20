import type { LeadRecord } from "@/services";
import { INTAKE_LABELS, NOTICE_LABELS } from "@/config/staff-leads";
import { israelToday } from "@/lib/wall-clock";

/** What the list says for a `broughtBy` that is no longer among the agency's members. */
export const GONE_MEMBER = "חבר/ה שכבר לא בסוכנות";

/** A phone as its national number: digits only, a leading 972 or 0 dropped — the server's duplicate key. */
export function nationalPhone(phone: string): string {
  return phone.replace(/\D/g, "").replace(/^(972|0)/, "");
}

/** The agency's other leads with this lead's national number: a pointer for a hidden duplicate (the database stores no link). */
export function sameNumberLeads(leads: LeadRecord[], lead: LeadRecord): LeadRecord[] {
  const key = nationalPhone(lead.phone);
  if (!key) return [];
  return leads.filter((l) => l.id !== lead.id && nationalPhone(l.phone) === key);
}

/** Leads per member created in the current Israel-time month, by `broughtBy`; leads nobody brought are skipped. */
export function broughtThisMonth(leads: LeadRecord[], now: Date): Map<string, number> {
  const month = israelToday(now).slice(0, 7);
  const counts = new Map<string, number>();
  for (const l of leads) {
    if (!l.broughtBy || !l.created_date) continue;
    if (israelToday(new Date(l.created_date)).slice(0, 7) !== month) continue;
    counts.set(l.broughtBy, (counts.get(l.broughtBy) ?? 0) + 1);
  }
  return counts;
}

/** "נוספה ידנית ע״י …" for the drawer; null for a lead that did not come through the staff form. */
export function staffLeadLine(lead: LeadRecord, memberLabel: (id: string | null) => string): string | null {
  if (lead.source !== "staff") return null;
  const intake = lead.intake ? INTAKE_LABELS[lead.intake] : "—";
  const notice = lead.noticeMethod ? NOTICE_LABELS[lead.noticeMethod] : "—";
  return `נוספה ידנית ע״י ${memberLabel(lead.broughtBy ?? null)} · ${intake} · יידוע: ${notice}`;
}
