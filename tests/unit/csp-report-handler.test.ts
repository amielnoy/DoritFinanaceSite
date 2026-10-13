import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import handler from "../../api/csp-report";

function makeRes() {
  const state: { status?: number; ended: boolean } = { ended: false };
  const res = {
    status(code: number) {
      state.status = code;
      return res;
    },
    end() {
      state.ended = true;
    },
  };
  return { res, state };
}

let logged: string[];
beforeEach(() => {
  logged = [];
  vi.spyOn(console, "warn").mockImplementation((line: string) => {
    logged.push(line);
  });
});
afterEach(() => vi.restoreAllMocks());

describe("api/csp-report", () => {
  it("logs a legacy report-uri violation, without the page's query string", async () => {
    const { res, state } = makeRes();
    await handler(
      {
        method: "POST",
        body: JSON.stringify({
          "csp-report": {
            "document-uri": "https://govari-fin.co.il/claims?name=רונית&phone=0536667788",
            "violated-directive": "script-src-elem",
            "blocked-uri": "https://evil.example/x.js?token=abc",
            "source-file": "https://govari-fin.co.il/assets/index-abc.js",
            "line-number": 12,
          },
        }),
      },
      res,
    );
    expect(state.status).toBe(204);
    expect(logged).toHaveLength(1);
    const entry = JSON.parse(logged[0].replace(/^\[csp\] /, ""));
    expect(entry).toEqual({
      directive: "script-src-elem",
      blocked: "https://evil.example",
      page: "/claims",
      source: "https://govari-fin.co.il/assets/index-abc.js:12",
    });
    expect(logged[0]).not.toContain("0536667788");
    expect(logged[0]).not.toContain("token=abc");
  });

  it("logs Reporting API violations, one line each, ignoring other report types", async () => {
    const { res, state } = makeRes();
    await handler(
      {
        method: "POST",
        body: [
          {
            type: "csp-violation",
            body: { documentURL: "https://govari-fin.co.il/", effectiveDirective: "img-src", blockedURL: "https://cdn.example/a.png" },
          },
          { type: "deprecation", body: { message: "x" } },
        ],
      },
      res,
    );
    expect(state.status).toBe(204);
    expect(logged).toHaveLength(1);
    expect(JSON.parse(logged[0].replace(/^\[csp\] /, ""))).toMatchObject({ directive: "img-src", blocked: "https://cdn.example", page: "/" });
  });

  it("keeps inline and eval violations by their keyword", async () => {
    const { res } = makeRes();
    await handler(
      { method: "POST", body: { "csp-report": { "document-uri": "https://govari-fin.co.il/faq", "violated-directive": "script-src", "blocked-uri": "inline" } } },
      res,
    );
    expect(JSON.parse(logged[0].replace(/^\[csp\] /, ""))).toMatchObject({ blocked: "inline", page: "/faq" });
  });

  it("answers anything else quietly: wrong method, junk, or an oversized body", async () => {
    const get = makeRes();
    await handler({ method: "GET" }, get.res);
    expect(get.state.status).toBe(405);

    const junk = makeRes();
    await handler({ method: "POST", body: "not json" }, junk.res);
    expect(junk.state.status).toBe(204);

    const big = makeRes();
    await handler({ method: "POST", body: "x".repeat(20_001) }, big.res);
    expect(big.state.status).toBe(413);
    expect(logged).toEqual([]);
  });

  it("logs at most twenty violations from one request", async () => {
    const { res } = makeRes();
    const one = { type: "csp-violation", body: { documentURL: "https://govari-fin.co.il/", effectiveDirective: "img-src", blockedURL: "https://a.example/x" } };
    await handler({ method: "POST", body: Array.from({ length: 50 }, () => one) }, res);
    expect(logged).toHaveLength(20);
  });
});
