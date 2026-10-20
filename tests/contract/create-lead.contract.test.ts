import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "../helpers/entity-schema";

/**
 * create-lead acts for any member of an agency, and writes a lead with
 * consent attached. These are the properties that keep it that narrow; the
 * behaviour is in create-lead.integration.test.ts.
 */
const read = (path: string) => readFileSync(join(REPO_ROOT, path), "utf8");
const fn = read("supabase/functions/create-lead/handler.ts");
const config = read("supabase/config.toml");

describe("create-lead — a member's act, written by the database", () => {
  it("checks the session and a User role in that agency before reading the input", () => {
    expect(fn).toMatch(/requireAgencyRole\(req, agencyId, 'user', rid, log\)/);
    expect(fn.indexOf("requireAgencyRole(")).toBeLessThan(fn.indexOf("oversizedField("));
  });

  it("checks the session itself, as invite-user does", () => {
    expect(config).toMatch(/\[functions\.create-lead\]\nverify_jwt = false/);
  });

  it("writes through create_staff_lead under the caller's token, never a direct insert", () => {
    expect(fn).toMatch(/callRpc\(\s*'create_staff_lead',[\s\S]*?\bgate\.token,?\s*\)/);
    expect(fn).not.toMatch(/insertRow\('leads'|upsertRow\('leads'|updateRows?\('leads'/);
  });

  it("keeps staff text out of summary and message", () => {
    expect(fn).not.toMatch(/\b(summary|message)\s*:/);
    // redact() twice: a number cut in two at redact()'s 2000 characters, or a glued IBAN, is taken too.
    expect(fn).toContain("export const scrub = (v: unknown) => redact(redact(text(v)));");
    // Each capped field is scrubbed, then fitted under the RPC's cap (redaction lengthens text).
    for (const f of ["topic", "notes", "referrer"]) expect(fn).toContain(`const ${f} = fit(body.${f}, LIMITS.${f});`);
    expect(fn).toMatch(/if \(topic === null \|\| notes === null \|\| referrer === null\) return json\(\{ error: REFUSALS\.field_too_long \}, 400\);/);
  });

  it("limits a member to 60 creates an hour", () => {
    expect(fn).toMatch(/withinLimit\(log, rid, `staff-lead:\$\{gate\.userId\}`, 3600, 60\)/);
  });

  it("logs ids, never the client's name, phone or address", () => {
    for (const call of fn.match(/log\('[a-z]+', '[^']+', \{[^}]*\}/g) ?? []) {
      expect(call, call).not.toMatch(/\b(name|phone|email|notes|topic)\b/);
    }
  });

  it("never reads another lead's id out of the answer", () => {
    expect(fn).not.toMatch(/duplicate_of/);
  });

  it("refuses every agency but agency 1 before the session, the RPC or any side effect", () => {
    expect(fn).toMatch(/if \(agencyId !== AGENCY_1\) \{[\s\S]*?return json\(\{ error: REFUSALS\.agency_not_enabled \}, 403\);/);
    const gate = fn.indexOf("agencyId !== AGENCY_1");
    for (const later of ["requireAgencyRole(", "callRpc(", "appendSheetRow(", "sendMail("]) {
      expect(gate, later).toBeLessThan(fn.indexOf(later));
    }
  });

  it("maps the RPC's own controls: rate_limited 429, bad_phone and field_invalid 422, agency_not_enabled 403", () => {
    expect(fn).toContain(
      "const REFUSAL_STATUS: Record<string, number> = { rate_limited: 429, bad_phone: 422, field_invalid: 422, agency_not_enabled: 403 };",
    );
    for (const why of ["rate_limited", "bad_phone", "field_invalid", "agency_not_enabled"]) expect(fn).toMatch(new RegExp(`\\b${why}: '[^']*[א-ת]`));
  });

  it("labels its sheet row with a code, like every other event", () => {
    expect(fn).toMatch(/appendSheetRow\(SHEET_TAB, SHEET_COLUMNS\.length, \[[^\]]*?'staff_lead',\s*'staff',/);
  });
});
