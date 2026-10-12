import type { LeadAdminPort, LeadRecord, LeadStatus } from "../ports";
import {
  fetchRows,
  toPortRow,
  type SupabaseLeadTableClient,
  type SupabaseReadResult,
} from "./SupabaseTableClient";

/** The port's fields. Not `*`: a lead row also carries the visitor's summary,
 *  profile and consent record, none of which this list shows, and personal data
 *  the screen does not need stays out of the browser. */
const LEAD_COLUMNS = "id,name,phone,email,source,topic,timing,message,status,created_at";

const NOT_APPLIED = "הפעולה לא בוצעה — אין הרשאה או שהפנייה כבר לא קיימת";

/**
 * The admin's leads, read and written in Supabase under her own session.
 *
 * `leads_read_admin`, `leads_update_admin` and `leads_delete_admin` are the gate:
 * `can_see(agency_id) or is_admin()`. No backend function is involved.
 *
 * Leads are handed out under their Supabase `id`, not `base44_id ?? id` as
 * `toPortRow` does for content — the writes below act on `id`, and claims
 * written by the `submit-claim` Edge Function have no Base44 id at all.
 */
export class SupabaseLeadAdminService implements LeadAdminPort {
  constructor(private readonly client: SupabaseLeadTableClient) {}

  async list(limit = 500): Promise<LeadRecord[]> {
    const rows = await fetchRows(
      this.client.from("leads").select(LEAD_COLUMNS).order("created_at", { ascending: false }).limit(limit),
      "leads",
    );
    return rows.map((row) => ({ ...toPortRow(row), id: row.id }) as unknown as LeadRecord);
  }

  setStatus(id: string, status: LeadStatus): Promise<void> {
    return applied(this.client.from("leads").update({ status }).eq("id", id).select("id"), "status");
  }

  remove(id: string): Promise<void> {
    return applied(this.client.from("leads").delete().eq("id", id).select("id"), "delete");
  }
}

/**
 * A write that changed exactly the row it named, or an error.
 *
 * Row-level security does not refuse an update or delete it filters out: it
 * changes nothing and reports success. Asking for the row back is the only way
 * to tell "done" from "not allowed", and the screen must not show a refused
 * deletion as a deleted lead.
 */
async function applied(query: PromiseLike<SupabaseReadResult>, action: string): Promise<void> {
  const { data, error } = await query;
  if (error) throw new Error(`leads ${action} failed: ${error.message}`);
  if (!data || data.length === 0) throw new Error(NOT_APPLIED);
}
