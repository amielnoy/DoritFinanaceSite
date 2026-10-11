import { describe, expect, it } from "vitest";
import { supabase } from "@/api/supabaseClient";

// vitest.config.ts pins VITE_SUPABASE_* empty so no test run reaches the live project;
// removing that pin makes this fail on any machine whose .env.local has credentials.
describe("supabase client under Vitest", () => {
  it("is unconfigured (null)", () => {
    expect(supabase).toBeNull();
  });
});
