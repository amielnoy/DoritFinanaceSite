import { describe, expect, it } from "vitest";
// @ts-expect-error — a plain .mjs maintenance script, no declarations.
import { planReconcile, readExecResult } from "../../scripts/reconcile-leads.mjs";

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
    expect(plan).toEqual({ toDelete: [], toUpdate: [] });
  });

  it("leaves alone a Supabase row with no base44_id and a Base44 lead Supabase never got", () => {
    const plan = planReconcile(base44, [{ base44_id: null, status: "new" }]);
    expect(plan).toEqual({ toDelete: [], toUpdate: [] });
  });

  it("treats a Base44 lead without a status as the default, new", () => {
    expect(planReconcile([{ id: "x" }], [{ base44_id: "x", status: "new" }]).toUpdate).toEqual([]);
  });

  it("carries ids and statuses only", () => {
    const plan = planReconcile(base44, [{ base44_id: "gone", status: "new", name: "N", phone: "050" }]);
    expect(JSON.stringify(plan)).not.toMatch(/050|"N"/);
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
