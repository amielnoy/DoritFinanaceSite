import { describe, expect, it } from "vitest";
import { describeOpenLeads, groupOpenLeads, planAssignments } from "../../scripts/assign-open-leads.mjs";

const A = "00000000-0000-0000-0000-000000000001";
const B = "0abcfa0b-cc26-40f0-8971-54bd4d845139";
const lead = (id: string, agency_id: string, extra: Record<string, unknown> = {}) => ({
  id, agency_id, status: "new", source: "quick", topic: "פנסיה", created_at: "2026-10-01T09:00:00Z", assigned_user_id: null, ...extra,
});

describe("assign-open-leads — groupOpenLeads", () => {
  it("keeps open, unassigned leads per agency, oldest first", () => {
    const grouped = groupOpenLeads([
      lead("l2", A, { created_at: "2026-10-02T09:00:00Z" }),
      lead("l1", A),
      lead("closed", A, { status: "closed" }),
      lead("taken", A, { assigned_user_id: "u1" }),
      lead("b1", B, { status: "partial" }),
    ]);
    expect([...grouped.keys()]).toEqual([A, B]);
    expect(grouped.get(A)!.map((l: { id: string }) => l.id)).toEqual(["l1", "l2"]);
    expect(grouped.get(B)!.map((l: { id: string }) => l.id)).toEqual(["b1"]);
  });
});

describe("assign-open-leads — planAssignments", () => {
  const open = groupOpenLeads([lead("l1", A), lead("l2", A), lead("b1", B)]);

  it("gives a lead's own key priority over its agency's", () => {
    const { assignments, problems } = planAssignments(open, {
      [`agency:${A}`]: "Agent@Example.com ",
      l2: "other@example.com",
    });
    expect(problems).toEqual([]);
    expect(assignments).toEqual([
      { leadId: "l2", agencyId: A, email: "other@example.com" },
      { leadId: "l1", agencyId: A, email: "agent@example.com" },
    ]);
  });

  it("reports what it cannot do instead of dropping it", () => {
    const { assignments, problems } = planAssignments(open, {
      gone: "agent@example.com",
      b1: "not an address",
      "agency:ffffffff-0000-0000-0000-000000000000": "agent@example.com",
    });
    expect(assignments).toEqual([]);
    expect(problems).toEqual([
      { key: "gone", reason: "not_open_or_unassigned" },
      { key: "b1", reason: "not_an_address" },
      { key: "agency:ffffffff-0000-0000-0000-000000000000", reason: "no_open_leads" },
    ]);
  });

  it("plans nothing without a plan", () => {
    expect(planAssignments(open, {})).toEqual({ assignments: [], problems: [] });
  });
});

describe("assign-open-leads — describeOpenLeads", () => {
  it("lists ids, Israel-time dates, statuses, sources and topics — never a name, phone or email", () => {
    const lines = describeOpenLeads(
      groupOpenLeads([lead("l1", A, { name: "דנה כהן", phone: "0501234567", email: "dana@example.com" })]),
    );
    expect(lines).toEqual([`agency ${A}: 1 open unassigned`, "  l1  2026-10-01 12:00  new  quick  פנסיה"]);
    expect(lines.join("\n")).not.toMatch(/דנה|0501234567|dana@/);
  });

  it("says when there is nothing to assign", () => {
    expect(describeOpenLeads(new Map())).toEqual(["no open unassigned leads"]);
  });
});
