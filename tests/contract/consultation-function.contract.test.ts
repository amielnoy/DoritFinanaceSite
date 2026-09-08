import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT, loadEntity } from "../helpers/entity-schema";
import { findObjectLiteralCalls } from "../helpers/source-scan";

/** Calendar holds are issued by the lead adapter, not by a component. */
const LEAD_ADAPTER = [join(REPO_ROOT, "src/services/base44/Base44LeadService.ts")];

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
  const adapterSource = readFileSync(LEAD_ADAPTER[0], "utf8");
  // The adapter builds one payload and sends it to both calendars, so the
  // contract lives in that literal rather than at each call site.
  const payload = findObjectLiteralCalls(/const payload\s*=\s*/, LEAD_ADAPTER);

  it("is issued by the lead adapter, so components never call it directly", () => {
    expect(adapterSource).toContain('invoke("createConsultationEvent"');
    expect(adapterSource).toContain('invoke("createOutlookEvent"');

    const fromComponents = findObjectLiteralCalls(
      /functions\.invoke\(\s*["']createConsultationEvent["']\s*,\s*/
    );
    expect(fromComponents, "a component is calling the calendar function directly").toEqual([]);
  });

  it("both calendars receive the same payload", () => {
    expect(payload).toHaveLength(1);
    expect(adapterSource).toMatch(
      /invoke\("createConsultationEvent", payload\)[\s\S]*invoke\("createOutlookEvent", payload\)/
    );
  });

  it("the payload carries exactly the fields the function reads", () => {
    expect([...payload[0].keys].sort()).toEqual([...destructured].sort());
  });

  it("a calendar failure can never fail the submission", () => {
    // allSettled, not all: the lead is already saved by this point.
    expect(adapterSource).toContain("Promise.allSettled");
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
