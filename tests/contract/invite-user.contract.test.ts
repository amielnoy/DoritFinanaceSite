import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "../helpers/entity-schema";

/**
 * invite-user acts for an agency's Admin or Owner (or the platform operator):
 * it can make an account and give it a membership. These are the properties
 * that keep it that narrow; the behaviour is in invite-user.integration.test.ts.
 */
const read = (path: string) => readFileSync(join(REPO_ROOT, path), "utf8");
const fn = read("supabase/functions/invite-user/handler.ts");
const shared = read("supabase/functions/_shared/staff.ts");
const content = read("supabase/functions/content-admin/handler.ts");
const config = read("supabase/config.toml");

describe("invite-user — an agency Admin's act, and nothing wider", () => {
  it("checks the session before reading its input, then Admin+ in that agency", () => {
    expect(fn).toMatch(/const session = await sessionCaller\(req, rid, log\);\s*if \(!session\.ok\)/);
    expect(fn.indexOf("sessionCaller(req")).toBeLessThan(fn.indexOf("await req.json()"));
    expect(fn).toMatch(/allowRole\(session, orgId, 'admin', rid, log\)/);
    expect(content).toMatch(/sessionCaller\(req, rid, log\)/);
    // The operator is read from profiles.role — the one authority is_admin() also reads.
    expect(shared).toMatch(/selectRows\('profiles', `id=eq\.\$\{encodeURIComponent\(user\.id\)\}&select=role`\)/);
    expect(shared).toMatch(/isOperator: rows\[0\]\?\.role === 'admin'/);
  });

  it("lets an Admin grant User only, before making any account, and leaves the grant to set_member_role under the caller's session", () => {
    expect(fn).toMatch(/!session\.isOperator && gate\.role !== 'owner' && role !== 'user'/);
    expect(fn.indexOf("gate.role !== 'owner'")).toBeLessThan(fn.indexOf("createAuthUser(email)"));
    expect(fn).toMatch(/callRpc\('set_member_role', \{ p_agency_id: orgId, p_user_id: userId, p_role: role \}, sessionToken\)/);
    expect(fn).not.toMatch(/upsertRow\('memberships'|insertRow\('memberships'/);
  });

  it("checks the session itself, as content-admin does", () => {
    expect(config).toMatch(/\[functions\.invite-user\]\nverify_jwt = false/);
  });

  it("gives only the three agency roles, in Hebrew, and never the platform operator", () => {
    expect(fn).toMatch(/export const ROLES: Record<string, string> = \{ owner: 'בעלים', admin: 'מנהל\/ת', user: 'משתמש\/ת' \};/);
    // An agency Admin is a membership; profiles.role ('admin', the operator) is never written.
    expect(fn).not.toMatch(/from\('profiles'\)|profiles.*update|updateRows\('profiles'/);
  });

  it("mails through dorit-mailer, never Supabase Auth's invite", () => {
    expect(fn).not.toMatch(/auth\/v1\/invite|inviteUserByEmail/);
    expect(fn).toMatch(/sendMail\(log, \{ to: email,/);
  });

  it("logs ids, never the invitee's address", () => {
    for (const call of fn.match(/log\('[a-z]+', '[^']+', \{[^}]*\}/g) ?? []) expect(call, call).not.toMatch(/\bemail\b/);
  });

  it("resolves invitees from Auth through a service-role-only RPC", () => {
    const sql = read("supabase/migrations/20261027000000_invitee_identity.sql");
    expect(fn).toContain("callRpc('invitee_for', { p_email: email })");
    expect(sql).toMatch(/from auth\.users u\s+join public\.profiles p on p\.id = u\.id/);
    expect(sql).toMatch(/where lower\(u\.email\) = nullif\(lower\(btrim\(p_email\)\), ''\)/);
    expect(sql).toContain("set search_path = ''");
    expect(sql).toContain("revoke execute on function public.invitee_for(text) from public, anon, authenticated");
    expect(sql).toContain("grant execute on function public.invitee_for(text) to service_role");
  });

  it("never resolves an unconfirmed account, in the latest definition of each identity function", () => {
    const dir = join(REPO_ROOT, "supabase/migrations");
    const migrations = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
    // The body of the last migration that (re)defines a function.
    const latest = (name: string) => {
      const pattern = new RegExp(`create (?:or replace )?function public\\.${name}\\([^]*?\\$\\$([^]*?)\\$\\$`, "i");
      let body = "";
      for (const file of migrations) body = pattern.exec(readFileSync(join(dir, file), "utf8"))?.[1] ?? body;
      expect(body, `${name} is defined`).not.toBe("");
      return body;
    };
    expect(latest("invitee_for")).toMatch(/u\.email_confirmed_at is not null/);
    expect(latest("my_email")).toMatch(/email_confirmed_at is not null/);
    expect(latest("my_enquiries")).toContain("public.my_email()");
    expect(latest("my_snapshot")).toContain("public.my_email()");

    const sql = read("supabase/migrations/20261028000000_invitee_confirmed.sql");
    expect(sql).toContain("security definer");
    expect(sql).toContain("set search_path = ''");
    expect(sql).toContain("revoke execute on function public.invitee_for(text) from public, anon, authenticated");
    expect(sql).toContain("grant execute on function public.invitee_for(text) to service_role");
  });
});
