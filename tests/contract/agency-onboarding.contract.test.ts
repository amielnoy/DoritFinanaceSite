import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ACTIVATION_GATES, OPERATOR_ONLY_COLUMNS, submitRequiredKeys } from "../../src/config/onboarding";
import { REPO_ROOT } from "../helpers/entity-schema";

/**
 * The new-agency wizard's schema (docs/superpowers/specs/2026-10-16-new-agency-wizard-design.md,
 * Rollout step 1), read as source. supabase/tests/onboarding_check.sql proves
 * the behaviour against a local Supabase; this fails in CI the moment a rule
 * is loosened, or src/config/onboarding.ts and the RPCs stop agreeing.
 */
const DIR = join(REPO_ROOT, "supabase/migrations");
const FILE = "20261106000000_agency_onboarding.sql";
const strip = (sql: string) =>
  sql
    .split("\n")
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n");
const raw = readFileSync(join(DIR, FILE), "utf8");
const sql = strip(raw);
const flat = sql.replace(/\s+/g, " ");

/** Each `create [or replace] function public.<name>(` block, up to its closing `$$;`. */
function functions(code: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const m of code.matchAll(/create (?:or replace )?function public\.(\w+)\(/g)) {
    const start = m.index ?? 0;
    found.set(m[1], code.slice(start, code.indexOf("$$;", start)));
  }
  return found;
}
const fns = functions(sql);
/** The single-quoted `table.column[.path]` keys a body names. */
const keysIn = (body: string) =>
  [...body.matchAll(/'((?:agencies|agency_profiles|agents)\.[a-z0-9_.]+)'/g)].map((m) => m[1]);

/** Triggers that must see their caller, so they are not definer. */
const INVOKER_TRIGGERS = ["agencies_guard_status", "agency_profiles_guard", "agents_guard", "testimonials_stamp_consent"];
const RPCS = ["create_agency", "submit_agency_for_review", "return_agency", "activate_agency"];

describe("agency onboarding, schema", () => {
  it("sorts after every migration already applied", () => {
    const all = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
    expect(all.indexOf(FILE)).toBeGreaterThan(all.indexOf("20261105000000_staff_leads.sql"));
  });

  it("adds draft and pending_review, and keeps 'active' the default", () => {
    expect(flat).toContain("check (status in ('draft', 'pending_review', 'active', 'suspended'))");
    expect(flat).not.toMatch(/alter column status/);
  });

  it("leaves agency_role() alone: a draft's members get no lead data", () => {
    expect(fns.has("agency_role")).toBe(false);
    expect(fns.has("has_role")).toBe(false);
    expect(fns.has("can_see")).toBe(false);
    // The latest definition anywhere is still the active-only one.
    let latest = "";
    for (const file of readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort()) {
      const body = functions(strip(readFileSync(join(DIR, file), "utf8"))).get("agency_role");
      if (body) latest = body;
    }
    expect(latest).toMatch(/a\.status = 'active'/);
  });

  it("opens onboarding to draft, pending_review and active members — never suspended", () => {
    const body = fns.get("onboarding_role") ?? "";
    expect(body).toMatch(/a\.status in \('draft', 'pending_review', 'active'\)/);
    expect(body).toMatch(/m\.user_id = auth\.uid\(\)/);
  });

  it("pins search_path on every function and revokes each from public, anon and authenticated by name", () => {
    expect(fns.size).toBeGreaterThanOrEqual(14);
    for (const [name, body] of fns) {
      expect(body, name).toContain("set search_path = ''");
      expect(sql, name).toMatch(
        new RegExp(`revoke execute on function public\\.${name}\\([^)]*\\)\\s+from public, anon, authenticated;`),
      );
    }
  });

  it("runs every function as its definer, except the guards that must see their caller and one pure helper", () => {
    for (const [name, body] of fns) {
      if (INVOKER_TRIGGERS.includes(name)) {
        expect(body, name).not.toMatch(/security definer/);
        expect(body, name).toContain("current_user in ('authenticated', 'anon')");
      } else if (name === "next_consent_version") {
        expect(body).not.toMatch(/security definer/);
        expect(body).toMatch(/\bimmutable\b/);
      } else {
        expect(body, name).toMatch(/security definer/);
      }
    }
  });

  it("grants the four RPCs to authenticated only, and anon only the is-it-live question", () => {
    for (const name of RPCS) {
      expect(fns.has(name), name).toBe(true);
      expect(sql, name).toMatch(new RegExp(`grant execute on function public\\.${name}\\([^)]*\\)\\s+to authenticated;`));
    }
    for (const grant of sql.match(/grant execute[^;]+;/gi) ?? []) {
      if (/\banon\b/.test(grant)) expect(grant).toMatch(/public\.agency_is_active\(uuid\)/);
    }
    // The completeness helper is the RPCs' alone.
    expect(sql).not.toMatch(/grant execute on function public\.onboarding_missing/);
  });

  it("checks the caller in every RPC: signed in, and the operator — or, to submit, the owner", () => {
    for (const name of RPCS) {
      const body = fns.get(name)!;
      expect(body, name).toMatch(/if auth\.uid\(\) is null then\s+raise exception 'not_signed_in'/);
      expect(body, name).toContain("public.is_admin()");
    }
    for (const name of ["create_agency", "return_agency", "activate_agency"]) {
      expect(fns.get(name), name).toMatch(/if not public\.is_admin\(\) then\s+raise exception 'forbidden'/);
    }
    // `= 'owner'` is null for a non-member, and `not (false or null)` lets them through.
    expect(fns.get("submit_agency_for_review")).toMatch(
      /if not \(public\.is_admin\(\) or public\.onboarding_role\(p_agency_id\) is not distinct from 'owner'\) then\s+raise exception 'forbidden'/,
    );
  });

  it("moves status one step at a time: draft → pending_review → draft or active", () => {
    expect(fns.get("submit_agency_for_review")).toMatch(/v_status <> 'draft'/);
    expect(fns.get("submit_agency_for_review")).toMatch(/set status = 'pending_review'/);
    expect(fns.get("return_agency")).toMatch(/v_status <> 'pending_review'/);
    expect(fns.get("return_agency")).toMatch(/set status = 'draft'/);
    expect(fns.get("activate_agency")).toMatch(/v_agency\.status <> 'pending_review'/);
    expect(fns.get("activate_agency")).toMatch(/set status = 'active'/);
    // A person's direct write may not cross into or out of the onboarding states.
    expect(fns.get("agencies_guard_status")).toMatch(
      /old\.status in \('draft', 'pending_review'\) or new\.status in \('draft', 'pending_review'\)/,
    );
  });

  it("opens a draft without a membership: the invitation and the membership are invite-user's", () => {
    const body = fns.get("create_agency")!;
    expect(body).toMatch(/values \(v_name, 'draft', p_dpa_date\)/);
    expect(body).toContain("'owner_email', v_email");
    expect(body).not.toMatch(/memberships|invitee_for|auth\.users|set_member_role/);
  });
});

describe("agency onboarding, required fields agree with src/config/onboarding.ts", () => {
  const missing = fns.get("onboarding_missing") ?? "";

  it("checks exactly the fields the config marks required to submit", () => {
    expect(new Set(keysIn(missing))).toEqual(new Set(submitRequiredKeys()));
    expect(keysIn(missing)).toHaveLength(new Set(keysIn(missing)).size);
  });

  it("asks for the institutional bodies only when an affiliation is declared", () => {
    expect(missing).toMatch(
      /if g\.has_institutional_affiliation and coalesce\(cardinality\(g\.affiliations\), 0\) = 0 then\s+v := array_append\(v, 'agents\.affiliations'\)/,
    );
  });

  it("is what submit and activate both refuse on, naming the keys in the error's detail", () => {
    for (const name of ["submit_agency_for_review", "activate_agency"]) {
      const body = fns.get(name)!;
      expect(body, name).toContain("v_missing := public.onboarding_missing(p_agency_id);");
      expect(body, name).toMatch(/raise exception 'incomplete' using errcode = '23514', detail = array_to_string\(v_missing, ','\)/);
    }
  });

  it("gates activation on exactly the config's three gates", () => {
    const body = fns.get("activate_agency")!;
    const gates = body.slice(body.indexOf("v_missing := public.onboarding_missing"));
    expect(new Set(keysIn(gates))).toEqual(new Set(ACTIVATION_GATES.map((g) => g.key)));
    expect(body).toMatch(/raise exception 'gates_closed' using errcode = '23514', detail = array_to_string\(v_gates, ','\)/);
    expect(body).toMatch(/licence_verified_at is null/);
    expect(body).toMatch(/data_processing_agreement_date is null/);
    expect(body).toMatch(/disclosures_approved_at is not null/);
  });

  it("refuses everyone but the operator the operator's columns", () => {
    const profile = fns.get("agency_profiles_guard")!;
    for (const col of OPERATOR_ONLY_COLUMNS.agency_profiles) {
      expect(profile, col).toContain(`new.${col} is distinct from old.${col}`);
    }
    const agent = fns.get("agents_guard")!;
    for (const col of OPERATOR_ONLY_COLUMNS.agents) {
      expect(agent, col).toContain(`new.${col} is distinct from old.${col}`);
    }
    for (const body of [profile, agent]) {
      expect(body).toMatch(/if v_person and not v_operator then/);
      expect(body).toContain("raise exception 'operator_only'");
    }
  });
});

describe("agency onboarding, what the owner and the public may touch", () => {
  it("lets the owner — not an Admin or User — write the draft's profile, agent, testimonials and cases", () => {
    expect(flat).toMatch(
      /create policy agency_profiles_update_onboarding_owner on public\.agency_profiles for update to authenticated using \(public\.onboarding_role\(agency_id\) = 'owner'\)/,
    );
    expect(flat).toMatch(/create policy agents_update_owner on public\.agents for update to authenticated using \(public\.onboarding_role\(agency_id\) = 'owner' or public\.is_admin\(\)\)/);
    expect(flat).toMatch(/create policy agents_delete_operator on public\.agents for delete to authenticated using \(public\.is_admin\(\)\)/);
    expect(flat).toMatch(
      /create policy testimonials_write_onboarding_owner on public\.testimonials for all to authenticated using \(public\.onboarding_role\(agency_id\) = 'owner'\) with check \(public\.onboarding_role\(agency_id\) = 'owner' and agent_id is not null\)/,
    );
    expect(flat).toMatch(/create policy success_cases_write_owner on public\.success_cases/);
    // Every onboarding policy is for signed-in people; anon cannot execute onboarding_role.
    for (const p of flat.match(/create policy [^;]*onboarding_role[^;]*;/g) ?? []) {
      expect(p).not.toMatch(/\banon\b/);
    }
  });

  it("will not save a licensee's testimonial without the reviewer's consent, and keeps today's public read", () => {
    expect(flat).toContain("check (agent_id is null or consent_confirmed_at is not null)");
    expect(flat).toContain("foreign key (agent_id, agency_id) references public.agents (id, agency_id)");
    expect(flat).toContain("check (source in ('google', 'midrag', 'direct'))");
    expect(flat).not.toMatch(/drop policy testimonials_read_member_or_fixed_agency/);
    expect(flat).not.toMatch(/drop policy testimonials_write_admin/);
    expect(fns.get("testimonials_stamp_consent")).toMatch(/new\.consent_confirmed_by := auth\.uid\(\)/);
  });

  it("shows visitors a licensee only through the view, only for live agencies, never the verification columns", () => {
    const view = /create view public\.public_agent_cards with \(security_invoker = false\) as([\s\S]*?);/.exec(sql)?.[1] ?? "";
    expect(view).not.toBe("");
    expect(view).toMatch(/where a\.status = 'active'\s*$/);
    expect(view).toMatch(/g\.verified_licence_number as licence_number/);
    for (const col of ["user_id", "licence_verified_at", "licence_verified_by", "g.licence_number"]) {
      expect(view, col).not.toContain(col);
    }
    expect(flat).toContain("revoke all on public.public_agent_cards from anon, authenticated, service_role;");
    expect(flat).toContain("grant select on public.public_agent_cards to anon, authenticated;");
    // The table itself: nothing for anon, no TRUNCATE for anyone.
    expect(flat).toContain("revoke all on public.agents, public.success_cases from anon, authenticated, service_role;");
    for (const grant of sql.match(/grant [^;]+ on public\.agents\b[^;]*;/g) ?? []) {
      expect(grant).not.toMatch(/\banon\b|truncate|\ball\b/);
    }
  });

  it("publishes a success case only when it is published and its agency is live", () => {
    expect(flat).toMatch(
      /create policy success_cases_read_public on public\.success_cases for select to anon, authenticated using \(published and public\.agency_is_active\(agency_id\)\)/,
    );
  });

  it("voids a licence check when the number changes, and moves the consent version of a live agency", () => {
    expect(fns.get("agents_guard")).toMatch(
      /if new\.licence_number is distinct from old\.licence_number then\s+new\.licence_verified_at := null;\s+new\.licence_verified_by := null;/,
    );
    const after = fns.get("agents_after_change")!;
    expect(after).toMatch(/public\.agency_is_active\(new\.agency_id\)/);
    expect(after).toMatch(/\(new\.licence_number, new\.full_name, new\.grammatical_gender\)/);
    expect(after).toMatch(/consent_version = public\.next_consent_version\(consent_version\)/);
    expect(after).toMatch(/set disclosures_approved_at = null, disclosures_approved_by = null/);
    expect(flat).toMatch(/after update on public\.agents/);
  });
});

describe("agency onboarding, the agent-photos bucket", () => {
  it("is public, WebP only, 10 MB", () => {
    // Trailing comments too ("10485760, -- 10 MB").
    const bare = raw.replace(/--[^\n]*/g, "").replace(/\s+/g, " ");
    expect(bare).toMatch(/insert into storage\.buckets[^;]*'agent-photos', 'agent-photos', true, 10485760, array\['image\/webp'\] \);/);
  });

  it("lets only the agency's owner or the operator write, under <agency_id>/<agent_id>/", () => {
    const policies = flat.match(/create policy agent_photos_\w+ on storage\.objects[^;]*;/g) ?? [];
    expect(policies.map((p) => /for (\w+)/.exec(p)?.[1]).sort()).toEqual(["delete", "insert", "select", "update"]);
    for (const p of policies) {
      expect(p).toMatch(/to authenticated/);
      expect(p).not.toMatch(/\banon\b/);
      expect(p).toContain("bucket_id = 'agent-photos' and public.can_write_agent_photo(name)");
    }
    const check = fns.get("can_write_agent_photo")!;
    expect(check).toMatch(/public\.onboarding_role\(v_agency\) is not distinct from 'owner' or public\.is_admin\(\)/);
    expect(check).toMatch(/g\.id = v_agent and g\.agency_id = v_agency/);
    // The shape is matched before either part is cast.
    expect(check.indexOf("p_name !~")).toBeLessThan(check.indexOf("::uuid"));
  });
});
