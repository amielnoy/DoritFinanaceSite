import type { AgencyPort, AgencyProfile, AgencyRole, MyAgency } from "../ports";
import { fetchRows, type SupabaseLeadTableClient } from "./SupabaseTableClient";

/** The one RPC this adapter makes, narrowed as SupabaseTableClient is. */
export interface SupabaseAgencyClient extends SupabaseLeadTableClient {
  rpc(fn: "my_agency_role", args: { p_agency_id: string }): PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

const ROLES = new Set<string>(["owner", "admin", "user"]);
const asRole = (v: unknown): AgencyRole | null => (typeof v === "string" && ROLES.has(v) ? (v as AgencyRole) : null);

const STATUSES = ["draft", "pending_review", "active", "suspended"] as const;

const PROFILE_COLUMNS =
  "agency_id,display_name,phone_e164,phone_display,whatsapp,email,default_whatsapp_message,licence_entity,licence_number,licence_regulator,lead_whatsapp_template";

/** The port's names and the table's, one to one. */
const COLUMN: Record<keyof Omit<AgencyProfile, "agencyId">, string> = {
  displayName: "display_name",
  phoneE164: "phone_e164",
  phoneDisplay: "phone_display",
  whatsapp: "whatsapp",
  email: "email",
  defaultWhatsappMessage: "default_whatsapp_message",
  licenceEntity: "licence_entity",
  licenceNumber: "licence_number",
  licenceRegulator: "licence_regulator",
  leadWhatsappTemplate: "lead_whatsapp_template",
};

/**
 * Who the signed-in person is in their agencies, read under their own session:
 * memberships_read_member and agencies_read_member_or_admin allow the rows,
 * `my_agency_role` answers the role, and agency_profiles_update_owner decides
 * the profile's one write. Nothing here grants anything.
 */
export class SupabaseAgencyService implements AgencyPort {
  constructor(private readonly client: SupabaseAgencyClient) {}

  async myAgencies(userId: string): Promise<MyAgency[]> {
    const [memberships, agencies] = await Promise.all([
      fetchRows(this.client.from("memberships").select("agency_id,role").eq("user_id", userId), "memberships"),
      fetchRows(this.client.from("agencies").select("id,name,status"), "agencies"),
    ]);
    // An agency the person cannot read (suspended) is not theirs to switch to.
    const name = new Map(agencies.map((a) => [String(a.id), String(a.name ?? "")]));
    const status = new Map(agencies.map((a) => [String(a.id), a.status]));
    return memberships
      .filter((m) => name.has(String(m.agency_id)) && asRole(m.role))
      .map((m) => {
        const raw = status.get(String(m.agency_id));
        const s = STATUSES.find((x) => x === raw);
        return {
          id: String(m.agency_id),
          name: name.get(String(m.agency_id)) ?? "",
          role: asRole(m.role)!,
          ...(s ? { status: s } : {}),
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name, "he"));
  }

  async myRole(agencyId: string): Promise<AgencyRole | null> {
    const { data, error } = await this.client.rpc("my_agency_role", { p_agency_id: agencyId });
    if (error) throw new Error("לא הצלחנו לאמת את ההרשאה");
    return asRole(data);
  }

  async profile(agencyId: string): Promise<AgencyProfile | null> {
    const rows = await fetchRows(this.client.from("agency_profiles").select(PROFILE_COLUMNS).eq("agency_id", agencyId), "agency_profiles");
    const r = rows[0];
    if (!r) return null;
    const text = (v: unknown) => (v == null ? "" : String(v));
    return {
      agencyId: text(r.agency_id),
      displayName: text(r.display_name),
      phoneE164: text(r.phone_e164),
      phoneDisplay: text(r.phone_display),
      whatsapp: text(r.whatsapp),
      email: text(r.email),
      defaultWhatsappMessage: text(r.default_whatsapp_message),
      licenceEntity: text(r.licence_entity),
      licenceNumber: text(r.licence_number),
      licenceRegulator: text(r.licence_regulator),
      leadWhatsappTemplate: text(r.lead_whatsapp_template),
    };
  }

  /** A write the policy filters out changes nothing and says nothing, so an empty answer is an error. */
  async updateProfile(agencyId: string, fields: Partial<Omit<AgencyProfile, "agencyId">>): Promise<void> {
    const values: Record<string, unknown> = {};
    for (const [key, column] of Object.entries(COLUMN)) {
      const value = fields[key as keyof typeof COLUMN];
      if (value !== undefined) values[column] = value;
    }
    const { data, error } = await this.client.from("agency_profiles").update(values).eq("agency_id", agencyId).select("agency_id");
    if (error) throw new Error(`השמירה נכשלה: ${error.message}`);
    if (!data || data.length !== 1) throw new Error("הפעולה לא בוצעה — רק בעלי הסוכנות יכולים לערוך את פרטיה");
  }
}
