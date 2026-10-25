import { describe, expect, it } from "vitest";
import { duplicateRows, emailKey, foldMerged, mergeTarget, phoneKey } from "@/lib/lead-duplicates";
import type { LeadRecord } from "@/services/ports";

let seq = 0;
const lead = (over: Partial<LeadRecord> = {}): LeadRecord => {
  seq += 1;
  return {
    id: `l${seq}`,
    name: `פונה ${seq}`,
    phone: "",
    source: "contact_form",
    status: "new",
    created_date: `2026-10-${String(seq).padStart(2, "0")}T10:00:00Z`,
    ...over,
  };
};

describe("phoneKey", () => {
  it("keys every Israeli spelling of one number the same", () => {
    const key = phoneKey("054-123-4567");
    expect(key).toBe("541234567");
    expect(phoneKey("+972 54 123 4567")).toBe(key);
    expect(phoneKey("972541234567")).toBe(key);
    expect(phoneKey("0541234567")).toBe(key);
  });

  it("has no key for an empty or anonymised phone", () => {
    expect(phoneKey("")).toBeNull();
    expect(phoneKey(null)).toBeNull();
    expect(phoneKey(undefined)).toBeNull();
    expect(phoneKey(" - ")).toBeNull();
  });

  it("has no key for a number too short to be anyone's", () => {
    expect(phoneKey("050")).toBeNull();
    expect(phoneKey("0501234")).toBeNull();
    // A landline's national number is 8 digits.
    expect(phoneKey("03-123-4567")).toBe("31234567");
  });
});

describe("emailKey", () => {
  it("ignores case and surrounding spaces", () => {
    expect(emailKey("  Dana.Cohen@Gmail.com ")).toBe("dana.cohen@gmail.com");
  });

  it("has no key for a missing or blank email", () => {
    expect(emailKey(undefined)).toBeNull();
    expect(emailKey("   ")).toBeNull();
  });
});

describe("foldMerged", () => {
  it("folds a merged lead under its main one, and keeps an orphan on top", () => {
    const main = lead();
    const child = lead({ mergedInto: main.id });
    const orphan = lead({ mergedInto: "not-visible" });
    const { top, mergedBy } = foldMerged([main, child, orphan]);
    expect(top.map((l) => l.id)).toEqual([main.id, orphan.id]);
    expect(mergedBy.get(main.id)?.map((l) => l.id)).toEqual([child.id]);
  });
});

describe("mergeTarget", () => {
  it("prefers a client, then a lead others were merged into, then the oldest", () => {
    const oldest = lead({ created_date: "2025-01-01T00:00:00Z" });
    const withChildren = lead({ created_date: "2026-01-01T00:00:00Z" });
    const client = lead({ status: "client", created_date: "2026-05-01T00:00:00Z" });
    const mergedBy = new Map([[withChildren.id, [lead({ mergedInto: withChildren.id })]]]);
    expect(mergeTarget([oldest, withChildren, client], mergedBy).id).toBe(client.id);
    expect(mergeTarget([oldest, withChildren], mergedBy).id).toBe(withChildren.id);
    expect(mergeTarget([withChildren, oldest], new Map()).id).toBe(oldest.id);
  });
});

describe("duplicateRows", () => {
  it("groups leads that share a phone or an email, transitively, under the newest", () => {
    const a = lead({ phone: "054-1234567", created_date: "2026-01-01T00:00:00Z" });
    const b = lead({ phone: "+972541234567", email: "x@y.co", created_date: "2026-02-01T00:00:00Z" });
    const c = lead({ email: "X@Y.co ", created_date: "2026-03-01T00:00:00Z" });
    const other = lead({ phone: "050-0000000" });
    // The list arrives newest first, as the screen reads it.
    const rows = duplicateRows([other, c, b, a], new Map());
    expect(rows.map((r) => r.lead.id)).toEqual([other.id, c.id]);
    const group = rows[1];
    expect(group.duplicates.map((l) => l.id)).toEqual([b.id, a.id]);
    expect(group.mergeTarget?.id).toBe(a.id);
    expect(rows[0].duplicates).toEqual([]);
    expect(rows[0].mergeTarget).toBeNull();
  });

  it("does not group leads with neither a phone nor an email", () => {
    const rows = duplicateRows([lead(), lead()], new Map());
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.duplicates.length === 0)).toBe(true);
  });

  it("carries each member's merged leads, and offers no merge for a single lead with history", () => {
    const main = lead({ phone: "0541234567" });
    const child = lead({ phone: "0541234567", mergedInto: main.id });
    const { top, mergedBy } = foldMerged([child, main]);
    const rows = duplicateRows(top, mergedBy);
    expect(rows).toHaveLength(1);
    expect(rows[0].lead.id).toBe(main.id);
    expect(rows[0].merged.map((l) => l.id)).toEqual([child.id]);
    expect(rows[0].duplicates).toEqual([]);
    expect(rows[0].mergeTarget).toBeNull();
  });

  it("places a group at its newest submission, a merged one included", () => {
    const main = lead({ phone: "0541234567", created_date: "2026-01-01T00:00:00Z" });
    const child = lead({ phone: "0541234567", mergedInto: main.id, created_date: "2026-03-01T00:00:00Z" });
    const between = lead({ phone: "0500000000", created_date: "2026-02-01T00:00:00Z" });
    const { top, mergedBy } = foldMerged([child, between, main]);
    expect(duplicateRows(top, mergedBy).map((r) => r.lead.id)).toEqual([main.id, between.id]);
  });

  it("joins a new submission to a lead that already has merged history, and merges into that one", () => {
    const main = lead({ phone: "0541234567", created_date: "2026-01-01T00:00:00Z" });
    const child = lead({ phone: "0541234567", mergedInto: main.id, created_date: "2026-02-01T00:00:00Z" });
    const fresh = lead({ phone: "054 123 4567", created_date: "2026-03-01T00:00:00Z" });
    const { top, mergedBy } = foldMerged([fresh, child, main]);
    const [row] = duplicateRows(top, mergedBy);
    expect(row.lead.id).toBe(fresh.id);
    expect(row.duplicates.map((l) => l.id)).toEqual([main.id]);
    expect(row.merged.map((l) => l.id)).toEqual([child.id]);
    expect(row.mergeTarget?.id).toBe(main.id);
  });
});
