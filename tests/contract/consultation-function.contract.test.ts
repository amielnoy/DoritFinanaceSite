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
  // One payload, one call, and the function fans it out to every calendar.
  const payload = findObjectLiteralCalls(/const payload\s*=\s*/, LEAD_ADAPTER);

  it("is issued by the lead adapter, so components never call it directly", () => {
    expect(adapterSource).toContain('invoke("createConsultationEvent"');

    const fromComponents = findObjectLiteralCalls(
      /functions\.invoke\(\s*["']createConsultationEvent["']\s*,\s*/
    );
    expect(fromComponents, "a component is calling the calendar function directly").toEqual([]);
  });

  it("both calendars are reached through one function, not two", () => {
    /**
     * There were two: `createConsultationEvent` posting to Google and
     * `createOutlookEvent` posting to Graph, invoked side by side, each holding
     * its own copy of the event-building code. They had already drifted — the
     * timezone fix that stopped 10:00 landing at 13:00 went into the Google
     * copy and not the Outlook one, so one diary held the agreed hour and the
     * other did not, and nothing anywhere said so.
     *
     * Asserted as an absence as well as a presence, because the failure mode is
     * a second call reappearing beside the first rather than the first changing.
     */
    expect(payload).toHaveLength(1);
    expect(adapterSource).toMatch(/invoke\("createConsultationEvent", payload\)/);
    // On the call, not the name: the comment above it explains why the second
    // function went away, and that explanation is worth keeping.
    expect(adapterSource, "the second calendar call is back").not.toMatch(
      /invoke\(\s*["']createOutlookEvent["']/
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
  it("takes every calendar token from a connector, never from a literal", () => {
    // Named through the provider table rather than inline, so adding a third
    // calendar cannot quietly introduce a hardcoded credential beside it.
    expect(fnSource).toContain("connector: 'outlook'");
    expect(fnSource).toContain("connector: 'googlecalendar'");
    expect(fnSource).toContain("connectors.getConnection(cal.connector)");
    expect(fnSource).not.toMatch(/(api[_-]?key|client[_-]?secret|refresh[_-]?token)\s*[:=]\s*["'][^"']{8,}/i);
  });

  it("does not echo the access token back to the caller", () => {
    const returned = fnSource.match(/Response\.json\([\s\S]*?\)/g) ?? [];
    for (const r of returned) expect(r).not.toContain("accessToken");
  });

  it("uses declared connectors that exist in the repo", () => {
    for (const name of ["outlook", "googlecalendar"]) {
      const connector = readFileSync(
        join(REPO_ROOT, `base44/connectors/${name}.jsonc`),
        "utf8"
      );
      expect(connector.length, `${name}.jsonc is empty`).toBeGreaterThan(0);
    }
  });

  it("asks Outlook for the scope it actually needs", () => {
    // `Calendars.ReadWrite`, not `Calendars.Read`. The connector was declared
    // and never used, so nothing had ever checked that the scope on it matches
    // what writing an event requires.
    const outlook = JSON.parse(
      readFileSync(join(REPO_ROOT, "base44/connectors/outlook.jsonc"), "utf8")
    );
    expect(outlook.scopes).toContain("Calendars.ReadWrite");
  });
});

/**
 * The two calendars differ in four small, trap-shaped ways, and every one of
 * them fails silently when it is wrong: the event is accepted, and it is wrong.
 */
describe("createConsultationEvent — both calendars", () => {
  it("writes to Outlook and Google, Outlook first", () => {
    // Dorit's diary is Outlook — `govari-fin.co.il` is Microsoft 365 — so when
    // only one provider is configured it is the one that gets the meeting.
    expect(fnSource).toMatch(/'outlook,google'/);
  });

  it("gives each calendar the timezone name it understands", () => {
    // Graph wants the Windows name, Google the IANA one, and each is silent
    // when handed the other's.
    expect(fnSource).toMatch(/graph\.microsoft\.com[\s\S]*?Israel Standard Time|Israel Standard Time[\s\S]*?graph\.microsoft\.com/);
    expect(fnSource).toContain("'Asia/Jerusalem'");
  });

  it("reads the event link under each calendar's own name", () => {
    expect(fnSource).toContain("data.webLink");
    expect(fnSource).toContain("data.htmlLink");
  });

  it("one calendar failing does not lose the other", () => {
    // The loop continues rather than returning, and the 502 is conditioned on
    // nothing having been created at all.
    expect(fnSource).toMatch(/continue;/);
    expect(fnSource).toMatch(/created\.length === 0/);
  });

  it("refuses rather than reporting success when no calendar is configured", () => {
    expect(fnSource).toMatch(/PROVIDERS\.length === 0/);
  });
});
