import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "../helpers/entity-schema";
import { phoneKey } from "@/lib/lead-duplicates";

/**
 * Duplicate leads and merging, read as source. supabase/tests/lead_duplicates_check.sql
 * proves the behaviour against a database; this fails in CI the moment a rule is loosened.
 */
const FILE = "20261108000000_lead_duplicates.sql";
const strip = (sql: string) =>
  sql
    .split("\n")
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n");
const sql = strip(readFileSync(join(REPO_ROOT, "supabase/migrations", FILE), "utf8"));
const flat = sql.replace(/\s+/g, " ");

function functions(code: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const m of code.matchAll(/create (?:or replace )?function public\.(\w+)\(/g)) {
    const start = m.index ?? 0;
    found.set(m[1], code.slice(start, code.indexOf("$$;", start)).replace(/\s+/g, " "));
  }
  return found;
}
const fns = functions(sql);

describe("duplicate leads, schema", () => {
  it("sorts after every migration before it", () => {
    const names = readdirSync(join(REPO_ROOT, "supabase/migrations")).filter((f) => f.endsWith(".sql")).sort();
    expect(names[names.length - 1] >= FILE).toBe(true);
    expect(names.filter((n) => n.slice(0, 14) === FILE.slice(0, 14))).toEqual([FILE]);
  });

  it("computes the phone key the way the screen does", () => {
    expect(flat).toContain(
      "substring(regexp_replace(regexp_replace(coalesce(phone, ''), '\\D', '', 'g'), '^(972|0)', '') from '^[0-9]{8,}$')",
    );
    // The same regexes, in the screen's helper.
    expect(phoneKey("+972-54-123-4567")).toBe("541234567");
    expect(phoneKey("050")).toBeNull();
  });

  it("computes the email key from the trimmed, lower-cased address", () => {
    expect(flat).toContain("email_key text generated always as (nullif(lower(btrim(coalesce(email, ''))), '')) stored");
  });

  it("never deletes a merged lead: the main one's delete only unlinks it", () => {
    expect(flat).toContain("merged_into uuid references public.leads(id) on delete set null");
    expect(flat).not.toMatch(/delete from public\.leads/);
  });

  it("guards the merge columns against a direct write by a person", () => {
    const guard = fns.get("leads_guard_merge")!;
    expect(guard).toContain("current_user in ('authenticated', 'anon') and not public.is_admin()");
    expect(guard).toContain("raise exception 'merge_via_rpc'");
    expect(flat).toContain("create trigger leads_guard_merge before update on public.leads");
  });

  it("lets only Admin+ of the agency, or the operator, merge and unmerge", () => {
    for (const name of ["merge_leads", "unmerge_lead"]) {
      const body = fns.get(name)!;
      expect(body).toContain("security definer set search_path = ''");
      expect(body).toContain("if not (public.has_role(v_agency, 'admin') or public.is_admin()) then raise exception 'forbidden'");
    }
    expect(fns.get("merge_leads")).toContain("l.agency_id is not distinct from v_agency and l.anonymized_at is null");
  });

  it("grants merge and unmerge to signed-in people only, and the clean-up to nobody", () => {
    expect(flat).toContain("revoke execute on function public.merge_leads(uuid, uuid[]) from public, anon, authenticated;");
    expect(flat).toContain("grant execute on function public.merge_leads(uuid, uuid[]) to authenticated;");
    expect(flat).toContain("grant execute on function public.unmerge_lead(uuid) to authenticated;");
    expect(flat).toContain("revoke execute on function public.merge_duplicate_leads(uuid, boolean) from public, anon, authenticated;");
    expect(flat).not.toMatch(/grant execute on function public\.merge_duplicate_leads/);
  });

  it("runs the clean-up dry by default", () => {
    expect(fns.get("merge_duplicate_leads")).toContain("p_dry_run boolean default true");
    expect(fns.get("merge_duplicate_leads")).toContain("if not p_dry_run then");
  });

  it("keeps retention's rules and adds the merged-history ones", () => {
    const retention = fns.get("anonymize_stale_leads")!;
    expect(retention).toContain("where l.status <> 'client'");
    expect(retention).toContain("p_now - interval '24 months'");
    expect(retention).toContain("where p.id = l.merged_into and (p.status = 'client' or greatest(p.created_at, p.updated_at) >= cutoff)");
    expect(retention).toContain("where c.merged_into = l.id and (c.status = 'client' or greatest(c.created_at, c.updated_at) >= cutoff)");
    expect(retention).toContain("referrer_note = null");
  });
});
