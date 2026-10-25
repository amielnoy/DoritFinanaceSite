import type { LeadRecord } from "@/services/ports";
import { nationalPhone } from "@/lib/staff-leads";

/**
 * One person, several leads: the duplicate keys and the rows the leads table
 * shows for them.
 *
 * The keys are the database's (`leads.phone_key`, `leads.email_key`, in
 * 20261108000000_lead_duplicates.sql), so the screen groups exactly what the
 * server would merge. A merged lead (`mergedInto`) is history: it folds under
 * the lead it was merged into and leaves the counts and the filters.
 */

/**
 * The phone as leads.phone_key keys it: digits, without a leading 972 or 0.
 * Null below 8 digits — a landline's national number is 8, a mobile's 9 — so a
 * placeholder like "050" makes no one a duplicate.
 */
export function phoneKey(phone: string | null | undefined): string | null {
  const national = nationalPhone(phone ?? "");
  return national.length >= 8 ? national : null;
}

/** The email as leads.email_key keys it: trimmed, lower case. Null when blank. */
export function emailKey(email: string | null | undefined): string | null {
  return (email ?? "").trim().toLowerCase() || null;
}

/**
 * The leads that stand on their own, and under each main lead the leads merged
 * into it. A lead merged into one this person cannot see stays on top: hiding
 * it would hide a lead they are allowed to work.
 */
export function foldMerged(leads: LeadRecord[]): { top: LeadRecord[]; mergedBy: Map<string, LeadRecord[]> } {
  const ids = new Set(leads.map((l) => l.id));
  const top: LeadRecord[] = [];
  const mergedBy = new Map<string, LeadRecord[]>();
  for (const l of leads) {
    if (l.mergedInto && ids.has(l.mergedInto)) {
      mergedBy.set(l.mergedInto, [...(mergedBy.get(l.mergedInto) ?? []), l]);
    } else {
      top.push(l);
    }
  }
  return { top, mergedBy };
}

const time = (l: LeadRecord) => Date.parse(l.created_date) || 0;
/** Newest submission first. */
export const newestFirst = (a: LeadRecord, b: LeadRecord): number => time(b) - time(a);

/**
 * The lead a group merges into, by the same rule as merge_duplicate_leads: a
 * client first, then a lead others were already merged into, then the oldest.
 */
export function mergeTarget(members: LeadRecord[], mergedBy: Map<string, LeadRecord[]>): LeadRecord {
  const rank = (l: LeadRecord) => [l.status === "client" ? 0 : 1, mergedBy.has(l.id) ? 0 : 1, time(l)];
  return [...members].sort((a, b) => {
    const [ra, rb] = [rank(a), rank(b)];
    return ra[0] - rb[0] || ra[1] - rb[1] || ra[2] - rb[2];
  })[0];
}

/** One row of the leads table. */
export interface LeadRow {
  /** The lead the row shows: the newest of its group. */
  lead: LeadRecord;
  /** The group's other leads that are not merged yet, newest first. */
  duplicates: LeadRecord[];
  /** The leads already merged into any lead of the group, newest first. */
  merged: LeadRecord[];
  /** Where "מזג" folds the group; null when there is nothing to merge. */
  mergeTarget: LeadRecord | null;
}

/**
 * The table's rows: leads that share a phone or an email key — directly or
 * through another lead — become one row, shown at its newest lead's place.
 * `top` arrives in the order the table shows it.
 */
export function duplicateRows(top: LeadRecord[], mergedBy: Map<string, LeadRecord[]>): LeadRow[] {
  // Union-find over the leads' indices, joined by each key's first holder.
  const parent = top.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const firstByKey = new Map<string, number>();
  top.forEach((l, i) => {
    for (const key of [phoneKey(l.phone), emailKey(l.email)].map((k, n) => (k ? `${n}:${k}` : null))) {
      if (!key) continue;
      const first = firstByKey.get(key);
      if (first === undefined) firstByKey.set(key, i);
      else parent[find(i)] = find(first);
    }
  });

  const groups = new Map<number, LeadRecord[]>();
  top.forEach((l, i) => groups.set(find(i), [...(groups.get(find(i)) ?? []), l]));

  const rows: LeadRow[] = [];
  const placed = new Set<number>();
  top.forEach((_, i) => {
    const root = find(i);
    if (placed.has(root)) return;
    placed.add(root);
    const members = [...groups.get(root)!].sort(newestFirst);
    const [shown, ...duplicates] = members;
    rows.push({
      lead: shown,
      duplicates,
      merged: members.flatMap((m) => mergedBy.get(m.id) ?? []).sort(newestFirst),
      mergeTarget: duplicates.length ? mergeTarget(members, mergedBy) : null,
    });
  });
  // Newest activity first, as the list reads: a person who wrote again — even
  // into a lead already merged — comes back to the top. The sort is stable, so
  // rows without a merged submission keep the order they arrived in.
  const newest = (r: LeadRow) => Math.max(time(r.lead), ...r.merged.map(time));
  return rows.sort((a, b) => newest(b) - newest(a));
}
