import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "../helpers/entity-schema";
import { SECRET_SQL } from "../helpers/staff-lead-secret";
import { STATUS } from "@/lib/lead-pipeline";

/**
 * The lead pipeline and its activity log, read as source.
 * supabase/tests/lead_pipeline_check.sql proves the behaviour against a database.
 */
const FILE = "20261109000000_lead_pipeline.sql";
const sql = readFileSync(join(REPO_ROOT, "supabase/migrations", FILE), "utf8")
  .split("\n")
  .filter((l) => !l.trim().startsWith("--"))
  .join("\n");
const flat = sql.replace(/\s+/g, " ");

describe("lead pipeline, schema", () => {
  it("sorts after the duplicate-leads migration, and has its version to itself", () => {
    const names = readdirSync(join(REPO_ROOT, "supabase/migrations")).filter((f) => f.endsWith(".sql")).sort();
    expect(names.indexOf(FILE)).toBeGreaterThan(names.indexOf("20261108000000_lead_duplicates.sql"));
    expect(names.filter((n) => n.startsWith(FILE.slice(0, 14)))).toEqual([FILE]);
  });

  it("accepts every status the screen offers, and keeps the backend's two", () => {
    const allowed = /check \(status in \(([^)]*)\)\)/.exec(flat)![1].split(",").map((s) => s.trim().replace(/'/g, ""));
    for (const s of STATUS) expect(allowed).toContain(s);
    expect(allowed).toEqual(expect.arrayContaining(["escalated", "partial"]));
  });

  it("lets people read the log only where they may see the lead, and write it never", () => {
    expect(flat).toContain("alter table public.lead_events enable row level security;");
    expect(flat).toContain("revoke all on public.lead_events from public, anon, authenticated;");
    expect(flat).toContain("grant select on public.lead_events to authenticated;");
    expect(flat).not.toMatch(/grant (insert|update|delete|all)[^;]*on public\.lead_events to authenticated/);
    expect(flat).toContain("for select to authenticated using (public.can_see_lead(lead_id))");
  });

  it("logs status, assignment, follow-up and merge changes from a trigger on every write", () => {
    expect(flat).toContain("create trigger leads_log_events after insert or update on public.leads");
    for (const kind of ["'created'", "'status'", "'assigned'", "'follow_up'", "'merged'", "'unmerged'"]) {
      expect(flat).toContain(kind);
    }
  });

  it("clears a lead's notes when retention anonymises it", () => {
    expect(flat).toContain("if new.anonymized_at is not null and old.anonymized_at is null then update public.lead_events set note = null");
  });

  it("checks a note with the same secret pattern as create_staff_lead", () => {
    expect(sql).toContain(`'${SECRET_SQL}'`);
    expect(flat).toContain("if v_note ~ c_secret then raise exception 'field_invalid'");
  });

  it("lets only signed-in people add a note, and only to a lead they may see", () => {
    expect(flat).toContain("if not public.can_see_lead(p_lead_id)");
    expect(flat).toContain("revoke execute on function public.add_lead_note(uuid, text) from public, anon, authenticated;");
    expect(flat).toContain("grant execute on function public.add_lead_note(uuid, text) to authenticated;");
  });
});
