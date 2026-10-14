import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "../helpers/entity-schema";

/**
 * Claim documents are kept two months (user, 2026-10-14). The behaviour is
 * proved by supabase/tests/claim_documents_retention_check.sql against a local
 * Supabase and by claim-documents-purge.integration.test.ts; this fails in CI
 * the moment the rule, its reach or its grants are edited away.
 */
const sql = readFileSync(join(REPO_ROOT, "supabase/migrations/20261023000000_claim_documents_retention.sql"), "utf8")
  .split("\n")
  .filter((l) => !l.trim().startsWith("--"))
  .join("\n");
const fn = readFileSync(join(REPO_ROOT, "supabase/functions/claim-documents-purge/handler.ts"), "utf8");
const config = readFileSync(join(REPO_ROOT, "supabase/config.toml"), "utf8");

describe("claim documents — two months, then the files go", () => {
  it("lists only the claim-documents bucket, past two months", () => {
    expect(sql).toMatch(/o\.bucket_id = 'claim-documents'/);
    expect(sql).toMatch(/o\.created_at < now\(\) - interval '2 months'/);
  });

  it("never deletes in SQL — the files go through the Storage API", () => {
    expect(sql).not.toMatch(/delete\s+from\s+storage\./i);
    expect(fn).toMatch(/deleteStorageObjects\('claim-documents'/);
  });

  it("lets only the service role list them or start the purge", () => {
    expect(sql).toMatch(/revoke execute on function public\.claim_documents_expired\(integer\) from public, anon, authenticated;/);
    expect(sql).toMatch(/revoke execute on function public\.claim_documents_call_purge\(\)\s+from public, anon, authenticated;/);
    for (const grant of sql.match(/grant execute[^;]+;/g) ?? []) expect(grant).toMatch(/to service_role;$/);
  });

  it("runs nightly, and the function checks the cron secret rather than a JWT", () => {
    expect(sql).toMatch(/cron\.schedule\('claim-documents-purge', '15 3 \* \* \*'/);
    expect(config).toMatch(/\[functions\.claim-documents-purge\]\nverify_jwt = false/);
    expect(fn).toMatch(/req\.headers\.get\('x-site-cron'\)/);
    expect(sql).toMatch(/'x-site-cron', secret/);
  });
});
