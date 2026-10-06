import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "../helpers/entity-schema";

/**
 * What a visitor may see of their own enquiries, read from the migration.
 *
 * The SQL checks in supabase/tests/account_check.sql prove behaviour against
 * a real database, but CI does not run them. These pin the parts a careless
 * edit would break silently: who may call what, and which columns leave.
 */
const SQL = readFileSync(join(REPO_ROOT, "supabase/migrations/20261006000000_personal_area.sql"), "utf8");

const fnBody = (name: string) => {
  const m = SQL.match(new RegExp(`create (?:or replace )?function public\\.${name}\\([\\s\\S]*?\\$\\$;`, "i"));
  if (!m) throw new Error(`${name} is not defined in the migration`);
  return m[0];
};

const NEVER = [
  "base44_id", "name", "phone", "email", "status", "escalation_reason",
  "handled_by_agent", "consent_version", "consent_at", "notes", "message", "topic", "calendar_status",
];

describe("personal area — the migration", () => {
  it("adds the columns the page shows", () => {
    expect(SQL).toMatch(/add column summary\s+text/i);
    expect(SQL).toMatch(/add column profile\s+jsonb/i);
    expect(SQL).toMatch(/add column track_label\s+text/i);
  });

  it("only service_role may call enquiries_for", () => {
    expect(SQL).toMatch(/revoke all on function public\.enquiries_for\(text\)\s+from public/i);
    expect(SQL).toMatch(/grant execute on function public\.enquiries_for\(text\)\s+to service_role/i);
    expect(SQL).not.toMatch(/grant execute on function public\.enquiries_for\(text\)\s+to (authenticated|anon)/i);
  });

  it("signed-in users may call my_enquiries, anonymous visitors may not", () => {
    expect(SQL).toMatch(/grant execute on function public\.my_enquiries\(\)\s+to authenticated/i);
    expect(SQL).toMatch(/revoke all on function public\.my_enquiries\(\)\s+from public/i);
    expect(SQL).not.toMatch(/my_enquiries\(\)\s+to anon/i);
  });

  it("returns no column outside the visitor's list", () => {
    // The output columns, from `returns table (...)` — an expression may read
    // `status` to compute `completed`; what matters is that `status` never leaves.
    for (const name of ["enquiries_for", "my_enquiries"]) {
      const cols = (fnBody(name).match(/returns table \(([\s\S]*?)\)\s*language/i)?.[1] ?? "")
        .split(",")
        .map((c) => c.trim().split(/\s+/)[0]);
      expect(cols.length, `${name} declares no output columns`).toBe(11);
      for (const col of NEVER) expect(cols, `${name} returns ${col}`).not.toContain(col);
    }
  });

  it("matches only a verified address", () => {
    expect(fnBody("my_email")).toMatch(/email_confirmed_at is not null/i);
  });

  it("opens no table to ordinary users", () => {
    expect(SQL).not.toMatch(/create policy[\s\S]*?on public\.(leads|meetings)/i);
  });
});
