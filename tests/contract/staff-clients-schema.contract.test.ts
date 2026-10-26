import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "../helpers/entity-schema";

/**
 * Staff-added clients (docs/superpowers/specs/2026-10-22-staff-client-design.md),
 * read as source. supabase/tests/staff_clients_check.sql proves the behaviour
 * against a local Postgres; this fails in CI the moment a rule is loosened.
 */
const FILE = "20261113000000_staff_clients.sql";
const strip = (sql: string) =>
  sql
    .split("\n")
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n");
const sql = strip(readFileSync(join(REPO_ROOT, "supabase/migrations", FILE), "utf8"));
const squash = (s: string) => s.replace(/\s+/g, " ");

function functions(code: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const m of code.matchAll(/create (?:or replace )?function public\.(\w+)\(/g)) {
    const start = m.index ?? 0;
    found.set(m[1], code.slice(start, code.indexOf("$$;", start)));
  }
  return found;
}

describe("staff clients, schema", () => {
  const flat = squash(sql);
  const fns = functions(sql);

  it("adds opened_as, client_since and products with their checks", () => {
    expect(flat).toContain(
      "add column opened_as text not null default 'lead' check (opened_as in ('lead','client'))",
    );
    expect(flat).toContain("add column client_since date check (client_since >= date '1990-01-01'");
    expect(flat).toContain("client_since = date_trunc('month', client_since)");
    expect(flat).toContain(
      "products text[] check (products <@ array['pension','provident','life','health', 'savings','planning','claims','other']::text[])",
    );
  });

  it("widens notice_method to four values", () => {
    expect(flat).toContain("drop constraint leads_notice_method_check");
    expect(flat).toContain(
      "add constraint leads_notice_method_check check (notice_method in ('verbal','email','whatsapp','agreement'))",
    );
  });

  it("ties a client-opened row to a staff row with its client fields and notice", () => {
    const m = flat.match(/add constraint leads_opened_as_client check \((.*?)\) not valid/);
    expect(m).not.toBeNull();
    const body = m?.[1] ?? "";
    expect(body).toContain("opened_as = 'lead'");
    expect(body).toContain("source = 'staff'");
    expect(body).toContain("client_since is not null");
    expect(body).toContain("products is not null and cardinality(products) >= 1");
    expect(body).toContain("consent_version = 'staff-client-v1'");
    expect(flat).toContain("validate constraint leads_opened_as_client");
  });

  it("allows 'agreement' only on a client-opened row", () => {
    expect(flat).toMatch(
      /add constraint leads_agreement_notice check \( ?notice_method is distinct from 'agreement' or opened_as = 'client' ?\)/,
    );
  });

  it("fixes opened_as in the guard, which still runs as the caller", () => {
    const guard = fns.get("leads_guard_staff_fields") ?? "";
    expect(guard).toMatch(/^create or replace function/);
    expect(guard).not.toMatch(/security definer/i);
    expect(guard).toContain("set search_path = ''");
    for (const col of ["brought_by", "source", "intake", "consent_version", "consent_at", "notice_method", "opened_as"]) {
      expect(guard).toContain(`new.${col} is distinct from old.${col}`);
    }
    // client_since and products follow the update policies, but a person sets
    // them on a client only, and through the same check as the RPCs: retention
    // skips a row with client_since.
    expect(squash(guard)).toContain("if new.status <> 'client' and new.opened_as <> 'client' then raise exception 'field_invalid'");
    expect(guard).toContain("public.client_fields_ok(new.client_since, new.products)");
  });

  it("keeps client-opened rows out of the 24-month anonymisation", () => {
    const job = squash(fns.get("anonymize_stale_leads") ?? "");
    expect(job).toMatch(/^create or replace function/);
    expect(job).toContain("referrer_note = null");
    // stale rows
    expect(job).toMatch(/where l\.status <> 'client' and l\.opened_as = 'lead' and l\.client_since is null/);
    // the contacts not-exists
    expect(job).toContain("k.status = 'client' or k.opened_as = 'client' or k.client_since is not null or greatest(");
    // 20261108000000's merged groups are still kept together, with the same test of "a client"
    expect(job).toContain("where p.id = l.merged_into and (p.status = 'client' or p.opened_as = 'client' or p.client_since is not null or greatest(");
    expect(job).toContain("where c.merged_into = l.id and (c.status = 'client' or c.opened_as = 'client' or c.client_since is not null or greatest(");
    expect(flat).toContain("revoke execute on function public.anonymize_stale_leads(timestamptz) from public, anon, authenticated");
    expect(flat).toContain("revoke execute on function public.leads_guard_staff_fields() from public, anon, authenticated");
  });

  it("grants no insert on leads to a person", () => {
    expect(flat).not.toMatch(/grant insert[^;]*on (table )?public\.leads[^;]*to[^;]*(authenticated|anon)/i);
  });
});

describe("staff clients, the RPCs", () => {
  const flat = squash(sql);
  const fns = functions(sql);
  const OLD = "uuid, text, text, text, text, text, text, text, text, text, uuid, boolean";
  const NEW = `${OLD}, boolean, date, text[]`;

  it("replaces create_staff_lead with three trailing, defaulted arguments", () => {
    const drop = flat.indexOf(`drop function public.create_staff_lead(${OLD});`);
    expect(drop).toBeGreaterThan(-1);
    expect(drop).toBeLessThan(flat.indexOf("create function public.create_staff_lead("));
    const fn = squash(fns.get("create_staff_lead") ?? "");
    expect(fn).toContain(
      "p_duplicate_ok boolean, p_as_client boolean default false, p_client_since date default null, p_products text[] default null ) returns table (lead_id uuid, duplicate text)",
    );
    expect(fn).toMatch(/security definer/);
    expect(fn).toContain("set search_path = ''");
  });

  it("writes a client's status, opened_as and consent itself, never from an argument", () => {
    const fn = squash(fns.get("create_staff_lead") ?? "");
    expect(fn).toContain("v_status := 'client'");
    expect(fn).toContain("case when v_client then 'staff-client-v1' else 'staff-intake-v1' end");
    expect(fn).toContain("case when v_client then 'client' else 'lead' end");
    expect(fn).toContain("(p_notice = 'agreement' and not v_client)");
    expect(fn).toContain("public.client_fields_ok(p_client_since, p_products)");
    // the rules 20261105000000 holds are all still here
    for (const rule of ["agency_not_enabled", "rate_limited", "pg_advisory_xact_lock", "bad_phone", "c_secret", "lead_assignee_ok", "'visible'::text"]) {
      expect(fn).toContain(rule);
    }
  });

  it("checks the month in Israel time and the product list in one stable function", () => {
    const fn = squash(fns.get("client_fields_ok") ?? "");
    expect(fn).toMatch(/language sql stable set search_path = ''/);
    expect(fn).not.toMatch(/security definer/);
    expect(fn).toContain("date_trunc('month', (now() at time zone 'Asia/Jerusalem'))::date");
    expect(fn).toContain("'bad_since'");
    expect(fn).toContain("'bad_products'");
  });

  it("converts under the caller's own rights and never touches the fixed fields", () => {
    const fn = squash(fns.get("convert_lead_to_client") ?? "");
    expect(fn).toContain("(p_lead_id uuid, p_client_since date, p_products text[]) returns uuid");
    expect(fn).not.toMatch(/security definer/);
    expect(fn).toContain("set search_path = ''");
    expect(fn).toContain("set status = 'client', client_since = p_client_since, products = p_products");
    expect(fn).toContain("raise exception 'not_found'");
    for (const col of ["opened_as =", "consent_", "source =", "brought_by"]) expect(fn).not.toContain(col);
  });

  it("grants the new signatures to signed-in people only", () => {
    expect(flat).toContain(`revoke execute on function public.create_staff_lead(${NEW}) from public, anon, authenticated;`);
    expect(flat).toContain(`grant execute on function public.create_staff_lead(${NEW}) to authenticated;`);
    expect(flat).toContain("grant execute on function public.convert_lead_to_client(uuid, date, text[]) to authenticated;");
    for (const grant of flat.match(/grant execute[^;]+;/g) ?? []) expect(grant).toMatch(/to authenticated;$/);
  });
});
