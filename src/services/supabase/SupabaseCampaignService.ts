import type { Campaign, CampaignPort, NewCampaign } from "../ports";
import { newCampaignCode } from "@/lib/campaigns";
import { fetchRows, type SupabaseLeadTableClient, type SupabaseReadResult } from "./SupabaseTableClient";

const COLUMNS = "id,agency_id,name,code,message,created_by,created_at,archived_at";

const text = (v: unknown) => (typeof v === "string" ? v : null);
const toCampaign = (r: Record<string, unknown>): Campaign => ({
  id: String(r.id),
  agencyId: String(r.agency_id),
  name: String(r.name ?? ""),
  code: String(r.code ?? ""),
  message: String(r.message ?? ""),
  createdBy: text(r.created_by),
  createdAt: String(r.created_at ?? ""),
  archivedAt: text(r.archived_at),
});

/**
 * Reactivation campaigns (20261111000000_campaigns.sql), under the signed-in
 * person's session: campaigns_read_member lets every member read the agency's,
 * campaigns_insert_admin and campaigns_update_admin let only Admin+ write.
 * A refused write changes nothing and says nothing, so an empty answer is an error.
 */
export class SupabaseCampaignService implements CampaignPort {
  constructor(private readonly client: SupabaseLeadTableClient) {}

  async list(agencyId: string): Promise<Campaign[]> {
    const rows = await fetchRows(
      this.client.from("campaigns").select(COLUMNS).eq("agency_id", agencyId).order("created_at", { ascending: false }),
      "campaigns",
    );
    return rows.map(toCampaign);
  }

  async create(input: NewCampaign): Promise<Campaign> {
    // A random code that another campaign of the agency already holds is
    // refused by the unique key; a fresh one is drawn, a few times at most.
    for (let attempt = 0; attempt < 3; attempt++) {
      const { data, error } = (await this.client
        .from("campaigns")
        .insert({ agency_id: input.agencyId, name: input.name.trim(), message: input.message, code: newCampaignCode() })
        .select(COLUMNS)) as SupabaseReadResult;
      if (error?.code === "23505") continue;
      if (error) throw new Error(error.code === "42501" ? "רק מנהל/ת בסוכנות יכול/ה ליצור קמפיין." : `שמירת הקמפיין נכשלה: ${error.message}`);
      const row = data?.[0] as Record<string, unknown> | undefined;
      if (!row) throw new Error("רק מנהל/ת בסוכנות יכול/ה ליצור קמפיין.");
      return toCampaign(row);
    }
    throw new Error("שמירת הקמפיין נכשלה. נסו שוב.");
  }

  async update(id: string, fields: { name?: string; message?: string; archived?: boolean }): Promise<void> {
    const values: Record<string, unknown> = {};
    if (fields.name !== undefined) values.name = fields.name.trim();
    if (fields.message !== undefined) values.message = fields.message;
    if (fields.archived !== undefined) values.archived_at = fields.archived ? new Date().toISOString() : null;
    const { data, error } = await this.client.from("campaigns").update(values).eq("id", id).select("id");
    if (error) throw new Error(`שמירת הקמפיין נכשלה: ${error.message}`);
    if (!data || data.length === 0) throw new Error("הפעולה לא בוצעה — רק מנהל/ת בסוכנות יכול/ה לערוך קמפיין.");
  }
}
