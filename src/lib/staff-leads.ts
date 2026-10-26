import type { LeadRecord } from "@/services";
import { INTAKE_LABELS } from "@/config/staff-leads";
import { CLIENT_NOTICE_LABELS, PRODUCT_LABELS } from "@/config/staff-clients";
import type { Product } from "@/lib/staff-lead-types";
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

/** Of those, the clients a member added by hand (opened as a client) — "פניות · לקוחות" on the strip, with VITE_STAFF_CLIENTS. */
export function clientsThisMonth(leads: LeadRecord[], now: Date): Map<string, number> {
  return broughtThisMonth(leads.filter((l) => l.openedAs === "client"), now);
}

/** A client's service lines in Hebrew, ", "-joined; "" for none. */
export function productsLabel(products: Product[] | null | undefined): string {
  return (products ?? []).map((p) => PRODUCT_LABELS[p] ?? p).join(", ");
}

/** "YYYY-MM" as "MM/YYYY"; "" for none. */
export function sinceLabel(since: string | null | undefined): string {
  return since && /^\d{4}-\d{2}$/.test(since) ? `${since.slice(5)}/${since.slice(0, 4)}` : "";
}

/** "נוספה ידנית ע״י …" (or, for a client added by hand, "נפתח/ה כלקוח/ה ע״י …") for the drawer; null for a lead that did not come through the staff form. */
export function staffLeadLine(lead: LeadRecord, memberLabel: (id: string | null) => string): string | null {
  if (lead.source !== "staff") return null;
  if (lead.openedAs === "client") {
    return [`נפתח/ה כלקוח/ה ע״י ${memberLabel(lead.broughtBy ?? null)}`, lead.clientSince ? `לקוח/ה מאז ${sinceLabel(lead.clientSince)}` : "", productsLabel(lead.products)]
      .filter(Boolean)
      .join(" · ");
  }
  const intake = lead.intake ? INTAKE_LABELS[lead.intake] : "—";
  const notice = lead.noticeMethod ? CLIENT_NOTICE_LABELS[lead.noticeMethod] : "—";
  return `נוספה ידנית ע״י ${memberLabel(lead.broughtBy ?? null)} · ${intake} · יידוע: ${notice}`;
}
