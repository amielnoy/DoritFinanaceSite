import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { agencyObjectPath } from "../../src/services/supabase/SupabaseUploadService";
import { REPO_ROOT } from "../helpers/entity-schema";

/**
 * The claim-documents bucket takes only the names the claim form makes
 * (review 2026-10-15, item 10). The policy's pattern and agencyObjectPath are
 * written in two languages; this holds them to each other, so a change to the
 * upload path that the policy would refuse fails here, not in production.
 */
const sql = readFileSync(join(REPO_ROOT, "supabase/migrations/20261102000000_claim_documents_object_name.sql"), "utf8");
const pattern = new RegExp(/name ~ '([^']+)'/.exec(sql)![1]);

describe("the claim document's object name", () => {
  it("is limited by the policy to agency 1's folder, a random uuid and a safe file name", () => {
    expect(sql).toMatch(/drop policy claim_documents_insert_public on storage\.objects;/);
    expect(sql).toMatch(/for insert to anon, authenticated\s+with check \(\s*bucket_id = 'claim-documents'\s+and name ~ /);
  });

  it.each(["תעודה רפואית.pdf", "receipt (1).PNG", "a.heic", "ש"])("accepts the name the form makes for %j", (fileName) => {
    const path = agencyObjectPath(new File(["x"], fileName));
    expect(path).toMatch(pattern);
  });

  it.each([
    "00000000-0000-0000-0000-000000000001/anon-upload.pdf",
    "aaaaaaaa-0000-0000-0000-000000000002/1b4e28ba-2fa1-4d3b-a3f5-ef19b5a7633b-x.pdf",
    "00000000-0000-0000-0000-000000000001/1b4e28ba-2fa1-4d3b-a3f5-ef19b5a7633b-../x.pdf",
    "x.pdf",
  ])("refuses %j", (name) => {
    expect(name).not.toMatch(pattern);
  });
});
