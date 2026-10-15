import type { AdminUser, UsersAdminPort } from "../ports";
import { fetchRows, type SupabaseTableClient } from "./SupabaseTableClient";

/**
 * The accounts, their organizations and the organizations' names: three reads
 * under the admin's own session — profiles_select_self_or_admin,
 * memberships_read_self_or_admin and agencies_read_member_or_admin allow them
 * (supabase/migrations) — joined here. Nothing is written.
 */
export class SupabaseUsersAdminService implements UsersAdminPort {
  constructor(private readonly client: SupabaseTableClient) {}

  async list(): Promise<AdminUser[]> {
    const [profiles, memberships, agencies] = await Promise.all([
      fetchRows(this.client.from("profiles").select("id,email,role,created_at").order("created_at", { ascending: true }), "profiles"),
      fetchRows(this.client.from("memberships").select("user_id,agency_id,role,created_at").order("created_at", { ascending: true }), "memberships"),
      fetchRows(this.client.from("agencies").select("id,name"), "agencies"),
    ]);
    const agencyName = new Map(agencies.map((a) => [String(a.id), String(a.name ?? "")]));
    return profiles.map((p) => ({
      id: String(p.id),
      email: p.email ? String(p.email) : null,
      role: p.role === "admin" ? "admin" : "user",
      createdAt: String(p.created_at ?? ""),
      memberships: memberships
        .filter((m) => m.user_id === p.id)
        .map((m) => ({
          orgId: String(m.agency_id),
          orgName: agencyName.get(String(m.agency_id)) || String(m.agency_id),
          role: String(m.role ?? ""),
          joinedAt: String(m.created_at ?? ""),
        })),
    }));
  }
}
