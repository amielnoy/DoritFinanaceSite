import { describe, expect, it } from "vitest";
import { CLAIM_FIELD_LIMITS } from "@/config/claimDocuments";
// @ts-expect-error — a Deno module, read for its constant only
import { FIELD_LIMITS } from "../../supabase/functions/_shared/guard.ts";

/* The claim form stops typing where submit-claim would refuse (review 2026-10-15): the two lists may not drift. */
describe("the claim form's field limits", () => {
  it("are the server's own", () => {
    for (const [field, limit] of Object.entries(CLAIM_FIELD_LIMITS)) expect(limit, field).toBe(FIELD_LIMITS[field]);
  });
});
