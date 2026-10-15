import type { AdminOrganization, AdminUser, InviteInput, InviteResult, UsersAdminPort } from "../ports";
import type { ContentFunctionsClient } from "./EdgeContentAdminService";
import { fetchRows, type SupabaseTableClient } from "./SupabaseTableClient";

/**
 * The accounts, their organizations and the organizations' names: three reads
 * under the admin's own session — profiles_select_self_or_admin,
 * memberships_read_self_or_admin and agencies_read_member_or_admin allow them
 * (supabase/migrations) — joined here. Nothing is written.
 */
export class SupabaseUsersAdminService implements UsersAdminPort {
  /**
   * `functions` and `accessToken` serve the invitation alone (invite-user):
   * reading needs only the table client, and a build without them still lists.
   */
  constructor(
    private readonly client: SupabaseTableClient,
    private readonly functions: ContentFunctionsClient | null = null,
    private readonly accessToken: () => Promise<string | null> = async () => null,
  ) {}

  /** Every organization, by name — agencies_read_member_or_admin lets the admin read them all. */
  async organizations(): Promise<AdminOrganization[]> {
    const rows = await fetchRows(this.client.from("agencies").select("id,name"), "agencies");
    return rows
      .map((r) => ({ id: String(r.id), name: String(r.name ?? "") }))
      .sort((a, b) => a.name.localeCompare(b.name, "he"));
  }

  /**
   * The invite-user Edge Function, under the admin's own session: it finds or
   * makes the account, adds the membership and mails the invitation. Its
   * refusal is reported in its own words, as content-admin's are.
   */
  async invite(input: InviteInput): Promise<InviteResult> {
    const token = await this.accessToken();
    if (!token || !this.functions) throw new Error("נדרשת התחברות.");
    const { data, error } = await this.functions.functions.invoke("invite-user", {
      body: { ...input },
      headers: { Authorization: `Bearer ${token}` },
    });
    if (error) {
      const res = error.context instanceof Response ? error.context : null;
      const answer = res ? ((await res.json().catch(() => null)) as { error?: string } | null) : null;
      throw new Error(answer?.error ?? `ההזמנה נכשלה (${res?.status ?? "ללא תשובה"}).`);
    }
    const body = (data ?? {}) as { created?: unknown; mailed?: unknown };
    return { created: body.created === true, mailed: body.mailed === true };
  }

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
