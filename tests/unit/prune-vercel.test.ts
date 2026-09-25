import { describe, expect, it } from "vitest";
// @ts-expect-error — plain .mjs tooling, imported for its pure predicate.
import { isEligible } from "../../scripts/prune-vercel-deployments.mjs";

/**
 * The rule that decides what gets deleted.
 *
 * Everything else in the script is paging and HTTP; this is the only place
 * where a wrong answer destroys something. The failure worth testing is not
 * "does it delete an old preview" — it is whether it refuses in the three
 * cases where deleting is wrong: still aliased, not yet old, not a preview.
 *
 * `created` is epoch milliseconds, matching what `/v7/deployments` returns.
 * `aliases` is attached by the caller from `/v2/deployments/{id}/aliases`, so
 * the predicate stays pure and the network stays out of these tests.
 */
const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 8, 25);

const deployment = (over: Record<string, unknown> = {}) => ({
  uid: "dpl_1",
  url: "site-abc123.vercel.app",
  target: "preview",
  created: NOW - 40 * DAY,
  aliases: [],
  ...over,
});

const verdict = (over: Record<string, unknown> = {}) =>
  isEligible(deployment(over), { now: NOW, maxAgeDays: 30 });

describe("prune-vercel — which deployments may be deleted", () => {
  it("deletes an unaliased preview past the age limit", () => {
    expect(verdict()).toEqual({ ok: true });
  });

  it("keeps a preview that is not yet old enough", () => {
    expect(verdict({ created: NOW - 29 * DAY })).toEqual({
      ok: false,
      reason: "too-new",
    });
  });

  /**
   * Exactly at the limit is kept, not deleted. The boundary has to fall one
   * way on purpose: "older than 30 days" is the promise made to whoever reads
   * the job name, and a deployment aged exactly 30 days is not older than it.
   */
  it("keeps a preview aged exactly the age limit", () => {
    expect(verdict({ created: NOW - 30 * DAY })).toEqual({
      ok: false,
      reason: "too-new",
    });
  });

  it("keeps an old preview that still has an alias", () => {
    expect(verdict({ aliases: ["staging.example.com"] })).toEqual({
      ok: false,
      reason: "aliased",
    });
  });

  /**
   * Production is filtered out at the API call as well, via `target=preview`.
   * Pinning it here too means the guarantee survives someone widening that
   * query later — the predicate would still refuse.
   */
  it("keeps a production deployment however old", () => {
    expect(verdict({ target: "production", created: NOW - 400 * DAY })).toEqual({
      ok: false,
      reason: "not-preview",
    });
  });

  it("keeps a deployment with no target rather than guessing", () => {
    expect(verdict({ target: null })).toEqual({
      ok: false,
      reason: "not-preview",
    });
  });
});
