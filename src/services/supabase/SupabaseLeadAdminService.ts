import type { LeadAdminPort, LeadRecord, LeadStatus } from "../ports";
import { fetchRows, toPortRow, type SupabaseTableClient } from "./SupabaseTableClient";

/** The port's fields and the two the mapping needs. Not `*`: a lead row also
 *  carries the visitor's summary, profile and consent record, none of which
 *  this list shows, and personal data the screen does not need stays out of
 *  the browser. */
const LEAD_COLUMNS = "id,base44_id,name,phone,email,source,topic,timing,message,status,created_at";

/**
 * The admin's leads, read from Supabase under her own session.
 *
 * The `leads_read_admin` RLS policy is the gate, as it is for `my_enquiries`
 * in SupabaseAccountService. No backend function is needed to read.
 *
 * Writes are not reimplemented. They go to `writes`, the Base44LeadAdminService
 * that calls `adminLead`, which already writes Supabase first and fails the
 * request if that write fails. The ids match because the list hands out
 * Base44 ids, which is what `adminLead` acts on.
 */
export class SupabaseLeadAdminService implements LeadAdminPort {
  constructor(
    private readonly client: SupabaseTableClient,
    private readonly writes: Pick<LeadAdminPort, "setStatus" | "remove">,
  ) {}

  async list(limit = 500): Promise<LeadRecord[]> {
    const rows = await fetchRows(
      this.client.from("leads").select(LEAD_COLUMNS).order("created_at", { ascending: false }).limit(limit),
      "leads",
    );
    return rows.map((row) => toPortRow(row) as unknown as LeadRecord);
  }

  setStatus(id: string, status: LeadStatus): Promise<void> {
    return this.writes.setStatus(id, status);
  }

  remove(id: string): Promise<void> {
    return this.writes.remove(id);
  }
}
