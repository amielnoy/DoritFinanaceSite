import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "../helpers/entity-schema";

/**
 * The clearinghouse schema, read as source. `supabase/tests/masleka_check.sql`
 * proves the behaviour against a local Supabase; this runs in CI and fails
 * the moment a grant, a revoke or a guard is edited away.
 */
const DIR = join(REPO_ROOT, "supabase/migrations");
const FILE = "20261015000000_masleka_requests.sql";
const SQL = readFileSync(join(DIR, FILE), "utf8");
const code = SQL.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");

describe("the clearinghouse migration", () => {
  it("sorts after every migration that came before it", () => {
    const all = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
    expect(all.indexOf(FILE)).toBeGreaterThan(all.indexOf("20261014000000_blog_slug.sql"));
  });

  it("turns row-level security on for both tables", () => {
    expect(code).toMatch(/alter table public\.masleka_requests\s+enable row level security;/);
    expect(code).toMatch(/alter table public\.masleka_access_log\s+enable row level security;/);
  });

  it("grants anon nothing at all", () => {
    for (const grant of code.match(/grant [^;]+;/gi) ?? []) {
      expect(grant, grant).not.toMatch(/\banon\b/);
    }
  });

  it("lets the browser read neither the ciphertext nor the token hash", () => {
    const grant = code.match(/grant select \(([^)]+)\) on public\.masleka_requests to authenticated;/);
    expect(grant, "no column grant to authenticated").not.toBeNull();
    const columns = grant![1].split(",").map((c) => c.trim());
    expect(columns).toEqual(expect.arrayContaining(["id", "client_name", "status", "id_last4", "submitted_at"]));
    for (const secret of ["code_ciphertext", "id_ciphertext", "token_hash"]) expect(columns).not.toContain(secret);
    expect(code).not.toMatch(/grant select on public\.masleka_requests to authenticated/);
    expect(code).not.toMatch(/grant (insert|update|delete)[^;]*on public\.masleka_(requests|access_log) to authenticated/);
  });

  it("keeps the service-only functions away from anon and authenticated, by name", () => {
    for (const signature of [
      "staff_role(uuid)",
      "masleka_staff_emails()",
      "masleka_expire()",
      "masleka_wipe_stale()",
      "masleka_call_remind()",
    ]) {
      expect(code).toContain(`revoke execute on function public.${signature} from public, anon, authenticated;`);
    }
    expect(code).toContain("revoke execute on function public.my_staff_role() from public, anon;");
    expect(code).toContain("grant execute on function public.my_staff_role() to authenticated;");
  });

  it("refuses ciphertext outside code_received, in the table itself", () => {
    expect(code).toMatch(/constraint masleka_ciphertext_only_while_waiting check/);
    expect(code).toMatch(/status = 'code_received' and code_received_at is not null/);
  });

  it("wipes at nine days and expires links at thirty", () => {
    expect(code).toContain("interval '9 days'");
    expect(code).toContain("interval '30 days'");
  });

  it("schedules its jobs only where pg_cron and pg_net exist", () => {
    const guard = code.indexOf("pg_available_extensions");
    expect(guard).toBeGreaterThan(-1);
    for (const job of ["'masleka-housekeeping'", "'masleka-remind'"]) {
      const at = code.indexOf(`cron.schedule(${job}`);
      expect(at, `${job} not scheduled`).toBeGreaterThan(guard);
    }
  });

  it("keeps the remind call's address and secret in Vault, not in the migration", () => {
    expect(code).toContain("'masleka_functions_url'");
    expect(code).toContain("'masleka_cron_secret'");
    expect(code).not.toMatch(/supabase\.co|https?:\/\//);
  });

  it("creates no storage bucket — no clearinghouse file is ever uploaded", () => {
    expect(code).not.toMatch(/storage\.buckets/);
  });

  it("hands the two staff lookups to service_role alone", () => {
    for (const signature of ["staff_role(uuid)", "masleka_staff_emails()"]) {
      expect(code).toContain(`grant execute on function public.${signature} to service_role;`);
      expect(code).not.toMatch(new RegExp(`grant execute on function public\\.${signature.replace(/[()]/g, "\\$&")} to [^;]*(anon|authenticated|public)`));
    }
  });

  it("pins an empty search_path on every security definer function", () => {
    const functions = code.match(/create function [\s\S]*?\$\$;/g) ?? [];
    expect(functions.length).toBeGreaterThanOrEqual(6);
    for (const fn of functions) {
      if (/security definer/.test(fn)) expect(fn, fn.slice(0, 60)).toMatch(/set search_path = ''/);
    }
  });
});
