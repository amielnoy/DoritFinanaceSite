import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "../helpers/entity-schema";

/**
 * invite-client mails a person on a member's word. These keep it narrow; the
 * behaviour is in invite-client.integration.test.ts.
 */
const read = (path: string) => readFileSync(join(REPO_ROOT, path), "utf8");
const fn = read("supabase/functions/invite-client/handler.ts");
const config = read("supabase/config.toml");

describe("invite-client", () => {
  it("is off unless the server's switch is on, before the session", () => {
    expect(fn).toContain("!staffClientsEnabled()");
    expect(fn.indexOf("staffClientsEnabled()")).toBeLessThan(fn.indexOf("requireAgencyRole("));
  });

  it("reads the lead under the caller's own token, after the role check", () => {
    expect(fn).toMatch(/selectRows\('leads', `id=eq\.\$\{leadId\}&select=id,name,email,status,agency_id`, gate\.token\)/);
    expect(fn.indexOf("requireAgencyRole(")).toBeLessThan(fn.indexOf("selectRows('leads'"));
  });

  it("makes no account for anyone", () => {
    expect(fn).not.toMatch(/auth\/v1\/admin|inviteUserByEmail|generateLink|createUser/);
  });

  it("logs no name or address", () => {
    for (const call of fn.match(/log\([^)]*\)/g) ?? []) expect(call).not.toMatch(/\b(name|to|email|lead\.)\b(?!:)/);
  });

  it("checks the session in the function, like the other staff functions", () => {
    expect(config).toMatch(/\[functions\.invite-client\]\s*\nverify_jwt = false/);
  });
});
