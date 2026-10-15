import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "../helpers/entity-schema";

/**
 * invite-user acts with the service role on behalf of an admin: it can make
 * an account and give it a membership. These are the properties that keep it
 * that narrow; the behaviour is in invite-user.integration.test.ts.
 */
const read = (path: string) => readFileSync(join(REPO_ROOT, path), "utf8");
const fn = read("supabase/functions/invite-user/handler.ts");
const shared = read("supabase/functions/_shared/admin.ts");
const content = read("supabase/functions/content-admin/handler.ts");
const config = read("supabase/config.toml");

describe("invite-user — an admin's act, and nothing wider", () => {
  it("passes the same admin gate as content-admin, before reading its input", () => {
    expect(fn).toMatch(/const gate = await requireAdminSession\(req, rid, log\);\s*if \(!gate\.ok\)/);
    expect(fn.indexOf("requireAdminSession(req")).toBeLessThan(fn.indexOf("await req.json()"));
    expect(content).toMatch(/requireAdminSession\(req, rid, log\)/);
    // The gate reads profiles.role — the one authority is_admin() also reads.
    expect(shared).toMatch(/selectRows\('profiles', `id=eq\.\$\{encodeURIComponent\(user\.id\)\}&select=role`\)/);
    expect(shared).toMatch(/role !== 'admin'/);
  });

  it("checks the session itself, as content-admin does", () => {
    expect(config).toMatch(/\[functions\.invite-user\]\nverify_jwt = false/);
  });

  it("gives only the three membership roles, never the site admin", () => {
    expect(fn).toMatch(/export const ROLES: Record<string, string> = \{ owner: 'בעלים', agent: 'סוכן\/ת', staff: 'צוות' \};/);
    expect(fn).not.toMatch(/role: 'admin'|profiles.*update/);
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
});
