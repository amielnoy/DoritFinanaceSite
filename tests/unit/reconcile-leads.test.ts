import { describe, expect, it } from "vitest";
// @ts-expect-error — a plain .mjs maintenance script, no declarations.
import { planReconcile, readExecResult, toSupabaseRow } from "../../scripts/reconcile-leads.mjs";

describe("reconcile-leads — planReconcile", () => {
  const base44 = [
    { id: "a", status: "contacted" },
    { id: "b", status: "new" },
    { id: "c", status: "closed" },
  ];

  it("deletes the Supabase rows whose lead is gone from Base44", () => {
    const plan = planReconcile(base44, [{ base44_id: "a", status: "contacted" }, { base44_id: "gone", status: "new" }]);
    expect(plan.toDelete).toEqual(["gone"]);
    expect(plan.toUpdate).toEqual([]);
  });

  it("updates a row whose status differs, to Base44's value", () => {
    const plan = planReconcile(base44, [{ base44_id: "a", status: "new" }, { base44_id: "b", status: "new" }]);
    expect(plan.toUpdate).toEqual([{ id: "a", from: "new", to: "contacted" }]);
    expect(plan.toDelete).toEqual([]);
  });

  it("plans nothing when the stores agree", () => {
    const plan = planReconcile(base44, base44.map((l) => ({ base44_id: l.id, status: l.status })));
    expect(plan).toEqual({ toDelete: [], toUpdate: [], toCreate: [] });
  });

  it("leaves alone a Supabase row with no base44_id", () => {
    const plan = planReconcile(base44, [...base44.map((l) => ({ base44_id: l.id, status: l.status })), { base44_id: null, status: "new" }]);
    expect(plan).toEqual({ toDelete: [], toUpdate: [], toCreate: [] });
  });

  it("lists the Base44 leads Supabase never got, as ids only", () => {
    const withPii = [{ id: "a", status: "new", name: "רונית", phone: "0501234567" }, { id: "b", status: "new" }];
    const plan = planReconcile(withPii, [{ base44_id: "b", status: "new" }]);
    expect(plan.toCreate).toEqual(["a"]);
    expect(JSON.stringify(plan)).not.toMatch(/0501234567|רונית/);
  });

  it("treats a Base44 lead without a status as the default, new", () => {
    expect(planReconcile([{ id: "x" }], [{ base44_id: "x", status: "new" }]).toUpdate).toEqual([]);
  });

  it("carries ids and statuses only", () => {
    const plan = planReconcile(base44, [{ base44_id: "gone", status: "new", name: "N", phone: "050" }]);
    expect(JSON.stringify(plan)).not.toMatch(/050|"N"/);
  });
});

describe("reconcile-leads — toSupabaseRow", () => {
  const lead = {
    id: "6ab4",
    created_date: "2026-10-05T18:01:41.000Z",
    name: "רונית לוי",
    phone: "0501234567",
    email: "r@example.com",
    source: "interview",
    topic: "פנסיה",
    timing: "מחר בבוקר",
    message: "פרופיל",
    status: "contacted",
    escalation_reason: "",
    handled_by_agent: "",
    consent_version: "2026-10-agents-v4",
    consent_at: "2026-10-05T18:00:00.000Z",
    created_by: "someone@example.com",
    is_sample: false,
  };

  it("maps the Base44 lead onto the Supabase columns, keyed by base44_id", () => {
    expect(toSupabaseRow(lead)).toEqual({
      base44_id: "6ab4",
      created_at: "2026-10-05T18:01:41.000Z",
      name: "רונית לוי",
      phone: "0501234567",
      email: "r@example.com",
      source: "interview",
      topic: "פנסיה",
      timing: "מחר בבוקר",
      message: "פרופיל",
      status: "contacted",
      escalation_reason: null,
      handled_by_agent: null,
      consent_version: "2026-10-agents-v4",
      consent_at: "2026-10-05T18:00:00.000Z",
    });
  });

  it("keeps the original date, so ordering and the 24-month retention stay right", () => {
    expect(toSupabaseRow(lead).created_at).toBe(lead.created_date);
  });

  it("defaults a missing status to new and an empty constrained value to null", () => {
    const row = toSupabaseRow({ ...lead, status: undefined, source: "" });
    expect(row.status).toBe("new");
    expect(row.source).toBeNull();
  });

  it("drops a value the Supabase check constraint would refuse, rather than failing the row", () => {
    expect(toSupabaseRow({ ...lead, source: "whatsapp" }).source).toBeNull();
    expect(toSupabaseRow({ ...lead, status: "archived" }).status).toBe("new");
  });

  it("refuses a lead without the two columns Supabase requires", () => {
    expect(toSupabaseRow({ ...lead, name: "" })).toBeNull();
    expect(toSupabaseRow({ ...lead, phone: undefined })).toBeNull();
  });
});

describe("reconcile-leads — readExecResult", () => {
  it("finds the marked line among the CLI's other output", () => {
    const out = `npm notice x\n@@reconcile-leads@@[{"id":"a","status":"new"}]\nupdate banner`;
    expect(readExecResult(out)).toEqual([{ id: "a", status: "new" }]);
  });
  it("says so when the CLI printed no result", () => {
    expect(() => readExecResult("nothing")).toThrow(/base44 login/);
  });
});
