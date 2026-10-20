import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "../helpers/entity-schema";

/**
 * Staff-created leads (docs/superpowers/specs/2026-10-20-staff-lead-design.md),
 * read as source. supabase/tests/staff_leads_check.sql proves the behaviour
 * against a local Supabase; this fails in CI the moment a rule is loosened.
 */
const FILE = "20261105000000_staff_leads.sql";
const strip = (sql: string) =>
  sql
    .split("\n")
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n");
const sql = strip(readFileSync(join(REPO_ROOT, "supabase/migrations", FILE), "utf8"));
const squash = (s: string) => s.replace(/\s+/g, " ");

/** Each `create [or replace] function public.<name>(` block, up to its closing `$$;`. */
function functions(code: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const m of code.matchAll(/create (?:or replace )?function public\.(\w+)\(/g)) {
    const start = m.index ?? 0;
    found.set(m[1], code.slice(start, code.indexOf("$$;", start)));
  }
  return found;
}

describe("staff leads, schema", () => {
  const flat = squash(sql);
  const fns = functions(sql);

  it("adds 'staff' to leads_source_check and keeps the other six", () => {
    expect(flat).toContain(
      "check (source in ('consultation','detailed','quick','claim','escalation','interview','staff'))",
    );
  });

  it("adds the five columns with their checks", () => {
    expect(flat).toContain("brought_by uuid references auth.users(id) on delete set null");
    expect(flat).toMatch(
      /intake text check \(intake in \('phone','in_person','referral','event','existing_client','other'\)\)/,
    );
    expect(flat).toContain("referrer_note text check (char_length(referrer_note) <= 120)");
    expect(flat).toMatch(/notice_method text check \(notice_method in \('verbal','email','whatsapp'\)\)/);
    expect(flat).toContain("duplicate_of uuid references public.leads(id) on delete set null");
  });

  it("requires the notice fields on a staff lead", () => {
    const m = flat.match(/add constraint leads_staff_fields check \((.*?)\) not valid/);
    expect(m).not.toBeNull();
    const body = m?.[1] ?? "";
    expect(body).toContain("source is distinct from 'staff'");
    for (const col of ["brought_by", "intake", "notice_method", "consent_version", "consent_at"]) {
      expect(body).toContain(`${col} is not null`);
    }
    expect(flat).toContain("validate constraint leads_staff_fields");
  });

  it("indexes the member's own leads", () => {
    expect(flat).toContain(
      "create index leads_agency_brought_by on public.leads (agency_id, brought_by) where brought_by is not null",
    );
  });

  it("guards the staff fields with a trigger that runs as the caller", () => {
    const guard = fns.get("leads_guard_staff_fields") ?? "";
    expect(guard).not.toBe("");
    expect(guard).not.toMatch(/security definer/i);
    expect(guard).toContain("set search_path = ''");
    expect(guard).toContain("current_user in ('authenticated', 'anon')");
    expect(guard).toContain("staff_fields_fixed");
    for (const col of [
      "brought_by", "source", "intake", "consent_version", "consent_at", "notice_method", "duplicate_of",
    ]) {
      expect(guard).toContain(col);
    }
    expect(flat).toMatch(
      /create trigger leads_guard_staff_fields before update on public\.leads for each row execute function public\.leads_guard_staff_fields\(\)/,
    );
  });

  it("anonymises the referrer note with the rest of the lead", () => {
    const job = fns.get("anonymize_stale_leads") ?? "";
    expect(job).toMatch(/update public\.leads l\s+set[\s\S]*referrer_note = null/);
    expect(flat).toContain("revoke execute on function public.anonymize_stale_leads(timestamptz) from public, anon, authenticated");
  });

  it("grants no insert on leads to a person", () => {
    expect(flat).not.toMatch(/grant insert[^;]*on (table )?public\.leads[^;]*to[^;]*(authenticated|anon)/i);
  });
});
