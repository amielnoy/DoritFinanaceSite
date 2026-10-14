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

  it("keeps the access log append-only, even for service_role", () => {
    expect(code).toContain("revoke all on public.masleka_requests, public.masleka_access_log from service_role;");
    expect(code).toContain("grant select, insert on public.masleka_access_log to service_role;");
    expect(code).not.toMatch(/grant [^;]*(update|delete|truncate|all)[^;]*on public\.masleka_access_log to service_role/);
    expect(code).toMatch(/request_id uuid references public\.masleka_requests\(id\) on delete set null/);
    expect(code).not.toMatch(/on delete cascade/);
  });
});

describe("the wipe-notice migration (decision 2026-10-14)", () => {
  const NOTICE = "20261019000000_masleka_wipe_notice.sql";
  const notice = readFileSync(join(DIR, NOTICE), "utf8")
    .split("\n")
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n");

  it("comes after the clearinghouse migration, which is applied and never edited", () => {
    const all = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
    expect(all.indexOf(NOTICE)).toBeGreaterThan(all.indexOf(FILE));
    expect(code).not.toContain("wipe_notified_at");
  });

  it("adds the one marker column and nothing else", () => {
    expect(notice).toMatch(/alter table public\.masleka_requests\s+add column wipe_notified_at timestamptz;/);
    expect(notice).not.toMatch(/\b(drop|grant|revoke|create (or replace )?function|create policy|cron\.schedule)\b/i);
  });

  it("leaves the marker out of the browser's column grant", () => {
    const grant = code.match(/grant select \(([^)]+)\) on public\.masleka_requests to authenticated;/);
    expect(grant![1]).not.toContain("wipe_notified_at");
  });
});
