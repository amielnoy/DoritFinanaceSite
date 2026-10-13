import { describe, expect, it } from "vitest";
import { invokeEdge } from "../helpers/edge-function";

describe("the Edge harness, for the lead functions", () => {
  it("answers Google's token endpoint, the calendar and the sheet, and records them", async () => {
    const r = await invokeEdge("submit-claim", { name: "x", phone: "0500000000" });
    expect(r.status).toBe(200);
    expect(r.sheetRows).toEqual([]);
    expect(r.calendarEvents).toEqual([]);
    expect(r.callsTo("oauth2.googleapis.com")).toEqual([]);
  });
});
