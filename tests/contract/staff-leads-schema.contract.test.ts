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

  it("requires the intake and notice fields on a staff lead, but not brought_by", () => {
    const m = flat.match(/add constraint leads_staff_fields check \((.*?)\) not valid/);
    expect(m).not.toBeNull();
    const body = m?.[1] ?? "";
    expect(body).toContain("source is distinct from 'staff'");
    for (const col of ["intake", "notice_method", "consent_version", "consent_at"]) {
      expect(body).toContain(`${col} is not null`);
    }
    // brought_by goes null with the member's account (on delete set null).
    expect(body).not.toContain("brought_by");
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

  describe("create_staff_lead", () => {
    const body = () => fns.get("create_staff_lead") ?? "";
    const b = () => squash(body());

    it("is security definer with an empty search_path", () => {
      expect(body()).not.toBe("");
      expect(body()).toMatch(/security definer/i);
      expect(body()).toContain("set search_path = ''");
    });

    it("is callable by signed-in people only", () => {
      expect(flat).toMatch(/revoke execute on function public\.create_staff_lead\([^)]*\) from public, anon, authenticated/);
      expect(flat).toMatch(/grant\s+execute on function public\.create_staff_lead\([^)]*\) to authenticated;/);
    });

    it("takes the twelve arguments and returns (lead_id, duplicate)", () => {
      const head = b().slice(0, b().indexOf(" as $$"));
      for (const a of [
        "p_agency_id uuid", "p_name text", "p_phone text", "p_email text", "p_topic text", "p_notes text",
        "p_intake text", "p_referrer text", "p_status text", "p_notice text", "p_assignee uuid",
        "p_duplicate_ok boolean",
      ]) expect(head).toContain(a);
      expect(head).toContain("returns table (lead_id uuid, duplicate text)");
    });

    it("refuses escalated and partial: the status list is exactly new, contacted, client", () => {
      expect(b()).toContain("p_status not in ('new','contacted','client')");
      expect(b()).toContain("bad_status");
    });

    it("sets source, brought_by, consent and agency from the function, not the caller", () => {
      const ins = b().match(/insert into public\.leads \((.*?)\) values \((.*?)\) returning/);
      expect(ins).not.toBeNull();
      const [, cols, vals] = ins ?? [];
      expect(cols).toContain("source");
      expect(vals).toContain("'staff'");
      // brought_by is the session's uid (v_caller := auth.uid()), never an argument.
      expect(b()).toContain("v_caller uuid := auth.uid()");
      expect(vals).toMatch(/\bv_caller, p_intake\b/);
      expect(vals).toContain("'staff-intake-v1'");
      expect(vals).toContain("now()");
      // agency_id is the checked argument; summary and message are never written.
      expect(cols).toContain("agency_id");
      expect(cols).not.toMatch(/\bsummary\b|\bmessage\b/);
      expect(cols).toContain("notes");
      // Nothing in the argument list can name the source, brought_by or consent.
      const head = b().slice(0, b().indexOf(" as $$"));
      expect(head).not.toMatch(/p_(source|brought|consent)/);
    });

    it("gates on membership, checks the assignee, and refuses a long field", () => {
      expect(b()).toContain("public.has_role(p_agency_id, 'user')");
      expect(b()).toContain("public.is_admin()");
      expect(b()).toContain("public.lead_assignee_ok(p_agency_id, p_assignee)");
      expect(b()).toContain("assignee_not_member");
      for (const e of ["forbidden", "bad_intake", "bad_notice", "field_too_long"]) expect(b()).toContain(e);
    });

    it("matches a duplicate on the last nine digits, in this agency, never an anonymised lead", () => {
      expect(b()).toContain("right(regexp_replace(");
      expect(b()).toContain("'\\D', '', 'g'), 9)");
      expect(b()).toContain("anonymized_at is null");
      expect(b()).toContain("order by");
      expect(b()).toContain("limit 1");
    });

    it("answers a hidden duplicate with the new id only", () => {
      expect(b()).toContain("duplicate_of");
      expect(b()).toMatch(/return query select v_id, case when v_dup is not null then 'hidden' end::text/);
      expect(b()).toMatch(/return query select v_dup, 'visible'/);
    });

    it("maps the intake to a channel", () => {
      expect(b()).toContain("case when p_intake in ('referral','existing_client') then 'referral' else 'direct' end");
    });
  });
});
