import { describe, expect, it } from "vitest";
// @ts-expect-error — plain .mjs tooling, imported for its pure comparison.
import { SPECS, compareRows } from "../../scripts/reconcile-stores.mjs";

/**
 * The gate phase 4 rests on.
 *
 * Reconciliation decides whether the flip is safe, so the failure worth testing
 * is not "does it spot a missing row" — it is whether it stays quiet when the
 * stores genuinely agree. A check that cries drift over an empty string spelled
 * two ways gets muted, and a muted gate is no gate.
 */
const lead = (over: Record<string, unknown> = {}) => ({
  id: "b44-1",
  name: "רון",
  phone: "050-111-2222",
  email: "",
  source: "quick",
  topic: "",
  timing: "",
  message: "שלום",
  status: "new",
  ...over,
});

const mirrored = (over: Record<string, unknown> = {}) => ({
  base44_id: "b44-1",
  name: "רון",
  phone: "050-111-2222",
  email: null,
  source: "quick",
  topic: null,
  timing: null,
  message: "שלום",
  status: "new",
  ...over,
});

describe("reconciliation — do the two stores agree", () => {
  it("is silent when they agree, despite blanks spelled differently", () => {
    // Base44 writes "" for an omitted field and the mirror writes NULL. Neither
    // is a disagreement about anything a person typed, and a gate that fires on
    // this gets switched off within a day.
    expect(compareRows([lead()], [mirrored()], SPECS.Lead)).toEqual({
      missing: [],
      orphaned: [],
      mismatched: [],
    });
  });

  it("reports a lead the mirror never copied", () => {
    const { missing, orphaned, mismatched } = compareRows([lead()], [], SPECS.Lead);
    expect(missing).toEqual(["b44-1"]);
    expect(orphaned).toEqual([]);
    expect(mismatched).toEqual([]);
  });

  it("reports a Supabase row with no counterpart", () => {
    // Before the flip this should be impossible: everything arrives through a
    // mirror. One appearing means something wrote to Supabase directly.
    const { orphaned } = compareRows([], [mirrored({ base44_id: "ghost" })], SPECS.Lead);
    expect(orphaned).toEqual(["ghost"]);
  });

  it("reports an update that reached only one store", () => {
    const { mismatched } = compareRows(
      [lead({ status: "contacted" })],
      [mirrored({ status: "new" })],
      SPECS.Lead,
    );
    expect(mismatched).toEqual([{ key: "b44-1", fields: ["status"] }]);
  });

  it("names every field that differs, not just the first", () => {
    const { mismatched } = compareRows(
      [lead({ status: "closed", topic: "פנסיה" })],
      [mirrored()],
      SPECS.Lead,
    );
    expect(mismatched[0].fields).toEqual(["topic", "status"]);
  });

  it("matches contacts on the phone number, however it is punctuated", () => {
    // The two stores have never agreed on how to write a number. Keying on the
    // raw string would report every contact as both missing and orphaned.
    const result = compareRows(
      [{ phone: "050-111-2222", name: "רון" }],
      [{ phone: "0501112222", name: "רון" }],
      SPECS.Contact,
    );
    expect(result).toEqual({ missing: [], orphaned: [], mismatched: [] });
  });

  it("compares a rating by value, since PostgREST returns it as a string", () => {
    const result = compareRows(
      [{ id: "t1", name: "א", quote: "ב", rating: 5 }],
      [{ base44_id: "t1", name: "א", quote: "ב", rating: "5" }],
      SPECS.Testimonial,
    );
    expect(result.mismatched).toEqual([]);
  });

  it("compares published by truth, not by spelling", () => {
    const result = compareRows(
      [{ id: "p1", title: "t", body: "b", published: true }],
      [{ base44_id: "p1", title: "t", body: "b", published: true }],
      SPECS.BlogPost,
    );
    expect(result.mismatched).toEqual([]);

    const drifted = compareRows(
      [{ id: "p1", title: "t", body: "b", published: true }],
      [{ base44_id: "p1", title: "t", body: "b", published: false }],
      SPECS.BlogPost,
    );
    expect(drifted.mismatched).toEqual([{ key: "p1", fields: ["published"] }]);
  });
});
