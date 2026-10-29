import { describe, expect, it } from "vitest";
import { interviewBody } from "../../src/services/lead-bodies";

/* The interview's body names its conversation (review 2026-10-15). */

describe("interviewBody", () => {
  it("carries the conversation reference, so submit-lead joins saves by it and never by phone and name", () => {
    expect(interviewBody({ name: "דנה", phone: "0501234567", conversationRef: "wizard:run-0001-abcd" }).conversationRef).toBe("wizard:run-0001-abcd");
  });

  it("sends an empty reference when there is none — a save that stands alone", () => {
    expect(interviewBody({ name: "דנה", phone: "0501234567" }).conversationRef).toBe("");
  });

  it("names the interview as its source and defaults the stage to complete — submit-lead routes on both", () => {
    const body = interviewBody({ name: "דנה", phone: "0501234567" });
    expect(body.source).toBe("interview");
    expect(body.stage).toBe("complete");
  });
});
