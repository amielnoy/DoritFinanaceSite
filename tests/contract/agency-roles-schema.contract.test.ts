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

const NARROWING = "20261030000000_agency_roles_narrowing.sql";
const narrowing = strip(readFileSync(join(DIR, NARROWING), "utf8"));

/** Tables whose rows are a client's: a User reads them only through their own leads. */
const LEAD_DATA = [
  "leads", "meetings", "contacts", "chat_conversations", "chat_messages", "chat_usage",
  "masleka_requests", "masleka_access_log",
  "clearinghouse_snapshots", "clearinghouse_reviews", "clearinghouse_published_items",
];

interface Policy { table: string; name: string; command: string; using: string }

/** Every policy left standing once all migrations have run, in order. */
function finalPolicies(): Map<string, Policy> {
  const policies = new Map<string, Policy>();
  for (const file of readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort()) {
    const code = strip(readFileSync(join(DIR, file), "utf8"));
    for (const m of code.matchAll(/(create|drop) policy (\w+) on ([\w.]+)([^;]*);/g)) {
      const table = m[3].replace(/^public\./, "");
      const key = `${table}.${m[2]}`;
      if (m[1] === "drop") {
        policies.delete(key);
        continue;
      }
      const command = /\bfor (select|insert|update|delete|all)\b/.exec(m[4])?.[1] ?? "all";
      const using = /\busing\s*\(([\s\S]*?)\)\s*(?:with check|$)/.exec(m[4].trim())?.[1] ?? "";
      policies.set(key, { table, name: m[2], command, using });
    }
  }
  return policies;
}

/** The top-level `or` branches of an expression, each without its outer parentheses. */
function branches(expr: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  const lower = expr.toLowerCase();
  for (let i = 0; i < expr.length; i++) {
    if (expr[i] === "(") depth++;
    else if (expr[i] === ")") depth--;
    else if (depth === 0 && /\sor\s/.test(lower.slice(i - 1, i + 3))) {
      out.push(expr.slice(start, i));
      start = i + 2;
    }
  }
  out.push(expr.slice(start));
  return out.map((b) => b.trim().replace(/^\((.*)\)$/s, "$1").trim());
}

describe("agency roles, step 2 (narrowing)", () => {
  const fns = functions(narrowing);
  const policies = finalPolicies();

  it("sorts after step 1", () => {
    const all = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
    expect(all.indexOf(NARROWING)).toBeGreaterThan(all.indexOf(ADDITIVE));
  });

  it("leaves no read policy on lead data resting on can_see alone", () => {
    const reads = [...policies.values()].filter(
      (p) => LEAD_DATA.includes(p.table) && (p.command === "select" || p.command === "all"),
    );
    expect(reads.length).toBeGreaterThanOrEqual(LEAD_DATA.length);
    for (const p of reads) {
      expect(p.using, `${p.table}.${p.name} has a using clause`).not.toBe("");
      for (const branch of branches(p.using)) {
        expect(branch, `${p.table}.${p.name}`).not.toMatch(/^public\.can_see\([^)]*\)$/);
      }
    }
  });

  it("is a guard that would catch a bare can_see", () => {
    expect(branches("public.can_see(agency_id) or public.is_admin()")[0]).toMatch(/^public\.can_see\([^)]*\)$/);
    expect(branches("(assigned_user_id = auth.uid() and public.can_see(agency_id)) or public.is_admin()")[0])
      .not.toMatch(/^public\.can_see\([^)]*\)$/);
  });

  it("gives every lead-data table a read policy", () => {
    for (const table of LEAD_DATA) {
      expect([...policies.values()].some((p) => p.table === table && (p.command === "select" || p.command === "all")), table)
        .toBe(true);
    }
  });

  it("maps agent and staff to user, then allows only the three roles", () => {
    expect(narrowing).toMatch(/update public\.memberships set role = 'user' where role in \('agent', 'staff'\);/);
    expect(narrowing).toMatch(/check \(role in \('owner', 'admin', 'user'\)\)/);
    expect(narrowing.indexOf("set role = 'user'")).toBeLessThan(narrowing.indexOf("check (role in ('owner', 'admin', 'user'))"));
  });

  it("makes can_see a membership of an active agency", () => {
    expect(fns.get("can_see")).toMatch(/select public\.has_role\(p_agency_id, 'user'\)/);
  });

  it("lets only Admin+ delete leads and read contacts, and only the Owner edit the agency profile", () => {
    expect(policies.get("leads.leads_delete_admin")?.using).toMatch(/^public\.has_role\(agency_id, 'admin'\) or public\.is_admin\(\)$/);
    expect(policies.get("contacts.contacts_read_admin")?.using).toMatch(/has_role\(agency_id, 'admin'\)/);
    expect(narrowing).toMatch(/create policy agency_profiles_update_owner[\s\S]*?has_role\(agency_id, 'owner'\)/);
  });

  it("changes members only through the functions", () => {
    expect(narrowing).toMatch(/drop policy memberships_write_admin on public\.memberships;/);
    expect(narrowing).toMatch(/revoke insert, update, delete on public\.memberships from authenticated;/);
  });

  it("checks the lead, not the agency, when publishing an analysis", () => {
    for (const name of ["clearinghouse_publish", "clearinghouse_unpublish", "clearinghouse_mark_answers_seen"]) {
      expect(fns.get(name), name).toMatch(/public\.can_work_snapshot\(p_snapshot\)/);
      expect(fns.get(name), name).not.toMatch(/can_see\(/);
    }
  });

  it("lets a User write drafts, and only Admin+ publish or delete", () => {
    expect(narrowing).toMatch(/published = false and public\.has_role\(agency_id, 'user'\)/);
    expect(policies.get("blog_posts.blog_posts_delete")?.using).toMatch(/^public\.has_role\(agency_id, 'admin'\) or public\.is_admin\(\)$/);
    expect(policies.get("testimonials.testimonials_write_admin")?.using).toMatch(/has_role\(agency_id, 'admin'\)/);
  });

  it("asks the role per agency, and mails a request's handler plus Admins and Owners", () => {
    expect(narrowing).toMatch(/drop function public\.my_staff_role\(\);/);
    expect(narrowing).toMatch(/drop function public\.staff_role\(uuid\);/);
    expect(fns.get("staff_role")).toMatch(/m\.agency_id = p_agency_id/);
    expect(fns.get("my_agency_role")).toMatch(/public\.agency_role\(p_agency_id\)/);
    expect(fns.get("masleka_staff_emails")).toMatch(/m\.role in \('owner', 'admin'\) or m\.user_id = r\.handler/);
    expect(narrowing).toMatch(/grant execute on function public\.staff_role\(uuid, uuid\)\s+to service_role;/);
    expect(narrowing).toMatch(/grant execute on function public\.masleka_staff_emails\(uuid\)\s+to service_role;/);
  });

  it("binds a row's lead and request to the row's own agency, so nobody files work under another agency", () => {
    expect(fns.get("can_work")).toMatch(/p_lead_id is not null and public\.lead_in_agency\(p_lead_id, p_agency_id\) and public\.can_see_lead\(p_lead_id\)/);
    expect(fns.get("request_in_agency")).toMatch(/r\.agency_id = p_agency_id/);
    expect(narrowing).toMatch(/create policy clearinghouse_snapshots_insert_lead[\s\S]*?request_id is null or public\.request_in_agency\(request_id, agency_id, lead_id\)/);
    expect(narrowing).toMatch(/create policy meetings_update_lead[\s\S]*?with check \(\(public\.can_see_lead\(lead_id\) and public\.lead_in_agency\(lead_id, agency_id\)\)/);
  });

  it("pins search_path on every new function and revokes each by name", () => {
    for (const [name, body] of fns) {
      expect(body, name).toContain("set search_path = ''");
      if (["can_see", "clearinghouse_publish", "clearinghouse_unpublish", "clearinghouse_mark_answers_seen"].includes(name)) continue;
      expect(narrowing, name).toMatch(
        new RegExp(`revoke execute on function public\\.${name}\\([^)]*\\)\\s+from public, anon, authenticated;`),
      );
    }
    for (const grant of narrowing.match(/grant [^;]+;/gi) ?? []) expect(grant, grant).not.toMatch(/\banon\b/);
  });
});
