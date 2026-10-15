import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "../helpers/entity-schema";

/**
 * Agency roles (docs/superpowers/specs/2026-10-15-agency-roles-design.md),
 * read as source. supabase/tests/agency_roles_check.sql proves the behaviour
 * against a local Supabase; this fails in CI the moment a rule is loosened.
 */
const DIR = join(REPO_ROOT, "supabase/migrations");
const ADDITIVE = "20261029000000_agency_roles_additive.sql";
const strip = (sql: string) =>
  sql
    .split("\n")
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n");
const additive = strip(readFileSync(join(DIR, ADDITIVE), "utf8"));

/** Each `create [or replace] function public.<name>(` block, up to its closing `$$;`. */
function functions(code: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const m of code.matchAll(/create (?:or replace )?function public\.(\w+)\(/g)) {
    const start = m.index ?? 0;
    found.set(m[1], code.slice(start, code.indexOf("$$;", start)));
  }
  return found;
}

describe("agency roles, step 1 (additive)", () => {
  const fns = functions(additive);

  it("sorts after every migration already applied", () => {
    const all = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
    expect(all.indexOf(ADDITIVE)).toBeGreaterThan(all.indexOf("20261027000000_invitee_identity.sql"));
  });

  it("defines the role helpers, the member functions and the two guards", () => {
    for (const name of [
      "agency_role", "has_role", "can_see_lead", "lead_assignee_ok",
      "set_member_role", "remove_member", "memberships_keep_an_owner", "leads_guard_assignment",
    ]) {
      expect(fns.has(name), name).toBe(true);
    }
  });

  it("pins search_path on every function, and revokes each from public, anon and authenticated by name", () => {
    for (const [name, body] of fns) {
      expect(body, name).toContain("set search_path = ''");
      expect(additive, name).toMatch(
        new RegExp(`revoke execute on function public\\.${name}\\([^)]*\\)\\s+from public, anon, authenticated;`),
      );
    }
    for (const grant of additive.match(/grant [^;]+;/gi) ?? []) expect(grant, grant).not.toMatch(/\banon\b/);
  });

  it("runs every function as its definer except the leads trigger, which must see its caller", () => {
    for (const [name, body] of fns) {
      if (name === "leads_guard_assignment") expect(body).not.toMatch(/security definer/);
      else expect(body, name).toMatch(/security definer/);
    }
    expect(fns.get("leads_guard_assignment")).toMatch(/current_user in \('authenticated', 'anon'\)/);
  });

  it("ranks owner over admin over user, and gives a suspended agency's members nothing", () => {
    expect(fns.get("has_role")).toMatch(/array\['user', 'admin', 'owner'\]/);
    expect(fns.get("agency_role")).toMatch(/a\.status = 'active'/);
    expect(fns.get("agency_role")).toMatch(/m\.user_id = auth\.uid\(\)/);
  });

  it("lets a User see a lead only when it is assigned to them", () => {
    const body = fns.get("can_see_lead")!;
    expect(body).toMatch(/public\.has_role\(l\.agency_id, 'admin'\)/);
    expect(body).toMatch(/l\.assigned_user_id = auth\.uid\(\) and public\.has_role\(l\.agency_id, 'user'\)/);
    expect(body).toMatch(/public\.is_admin\(\)/);
  });

  it("lets an Admin grant only User, to someone who is a User or not yet a member", () => {
    const body = fns.get("set_member_role")!;
    expect(body).toMatch(/v_mine = 'admin'[\s\S]*p_role <> 'user' or \(v_old is not null and v_old <> 'user'\)/);
    expect(body).toMatch(/p_role not in \('owner', 'admin', 'user'\)/);
    expect(body).toMatch(/insert into public\.membership_events/);
  });

  it("removes a member's assignments with them, and lets anyone leave", () => {
    const body = fns.get("remove_member")!;
    expect(body).toMatch(/v_self\s+boolean := p_user_id = auth\.uid\(\)/);
    expect(body).toMatch(/set assigned_user_id = null\s+where agency_id = p_agency_id and assigned_user_id = p_user_id/);
    expect(body).toMatch(/case when v_self then 'left' else 'removed' end/);
  });

  it("refuses to demote or remove an agency's last Owner", () => {
    expect(fns.get("memberships_keep_an_owner")).toMatch(/raise exception 'last_owner'/);
    expect(additive).toMatch(/before update or delete on public\.memberships/);
  });

  it("keeps a lead in its agency, and assignment to Admin+ and to the agency's members", () => {
    const body = fns.get("leads_guard_assignment")!;
    expect(body).toMatch(/raise exception 'agency_fixed'/);
    expect(body).toMatch(/public\.has_role\(old\.agency_id, 'admin'\) or public\.is_admin\(\)/);
    expect(body).toMatch(/public\.lead_assignee_ok\(new\.agency_id, new\.assigned_user_id\)/);
    expect(additive).toMatch(/before update on public\.leads/);
  });

  it("makes the membership history read-only to people", () => {
    expect(additive).toMatch(/revoke all on public\.membership_events from anon, authenticated, service_role;/);
    expect(additive).toMatch(/grant select on public\.membership_events to authenticated;/);
    expect(additive).not.toMatch(/grant (?:insert|update|delete|all)[^;]*membership_events/i);
  });
});
