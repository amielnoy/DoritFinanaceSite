import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT, loadEntity } from "../helpers/entity-schema";
import { findObjectLiteralCalls } from "../helpers/source-scan";

const FN_PATH = join(REPO_ROOT, "base44/functions/createConsultationEvent/entry.ts");
const fnSource = readFileSync(FN_PATH, "utf8");

/** Fields the Deno function destructures off the request body. */
const destructured = (() => {
  const m = fnSource.match(/const\s*\{([^}]*)\}\s*=\s*body\s*\|\|\s*\{\}/);
  if (!m) throw new Error("createConsultationEvent no longer destructures its request body");
  return m[1]
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
})();

describe("createConsultationEvent — request contract", () => {
  const invocations = findObjectLiteralCalls(
    /base44\.functions\.invoke\(\s*["']createConsultationEvent["']\s*,\s*/
  );

  it("is invoked from the consultation builder", () => {
    expect(invocations.length).toBe(1);
    expect(invocations[0].file).toBe("src/components/dorit/ConsultationBuilder.tsx");
  });

  it("the client sends exactly the fields the function reads", () => {
    expect([...invocations[0].keys].sort()).toEqual([...destructured].sort());
  });

  it("the function's mandatory fields are the same as the Lead entity's", () => {
    const guard = fnSource.match(/if\s*\(!(\w+)\s*\|\|\s*!(\w+)\)/);
    expect(guard, "the name/phone guard is gone").not.toBeNull();
    const guarded = [guard![1], guard![2]].sort();
    expect(guarded).toEqual([...(loadEntity("Lead").required ?? [])].sort());
    for (const field of guarded) expect(destructured).toContain(field);
  });
});

describe("createConsultationEvent — response contract", () => {
  it("returns 400 with an error message when name or phone is missing", () => {
    expect(fnSource).toMatch(/Response\.json\(\s*\{\s*error:[^}]*\}\s*,\s*\{\s*status:\s*400/);
  });

  it("surfaces an upstream Google Calendar failure as 502, not as a success", () => {
    expect(fnSource).toMatch(/status:\s*502/);
    expect(fnSource).toMatch(/if\s*\(!res\.ok\)/);
  });

  it("catches unexpected errors as 500", () => {
    expect(fnSource).toMatch(/status:\s*500/);
    expect(fnSource).toMatch(/catch\s*\(\s*error\s*\)/);
  });

  it("returns { ok, eventId, htmlLink } on success", () => {
    const success = fnSource.match(/Response\.json\(\s*\{\s*ok:\s*true[^}]*\}/);
    expect(success, "success response shape changed").not.toBeNull();
    for (const key of ["ok", "eventId", "htmlLink"]) {
      expect(success![0]).toContain(key);
    }
  });

  it("every error response carries an `error` key so the client can display it", () => {
    const errorResponses = fnSource.match(/Response\.json\(\s*\{[^}]*\}\s*,\s*\{\s*status:\s*[45]\d\d/g) ?? [];
    expect(errorResponses.length).toBeGreaterThanOrEqual(3);
    for (const r of errorResponses) expect(r).toContain("error");
  });
});

describe("createConsultationEvent — secrets handling", () => {
  it("takes the Google token from the connector, never from a literal", () => {
    expect(fnSource).toContain("connectors.getConnection('googlecalendar')");
    expect(fnSource).not.toMatch(/(api[_-]?key|client[_-]?secret|refresh[_-]?token)\s*[:=]\s*["'][^"']{8,}/i);
  });

  it("does not echo the access token back to the caller", () => {
    const returned = fnSource.match(/Response\.json\([\s\S]*?\)/g) ?? [];
    for (const r of returned) expect(r).not.toContain("accessToken");
  });

  it("uses a declared connector that exists in the repo", () => {
    const connectors = readFileSync(
      join(REPO_ROOT, "base44/connectors/googlecalendar.jsonc"),
      "utf8"
    );
    expect(connectors.length).toBeGreaterThan(0);
  });
});
