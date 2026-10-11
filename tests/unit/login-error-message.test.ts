import { describe, expect, it } from "vitest";
import { signInErrorMessage } from "@/lib/signInError";

/**
 * Supabase refuses in English; the login page speaks Hebrew. The refusals a
 * person can act on get their own sentence, and nothing raw from the provider
 * reaches the screen.
 */
describe("signInErrorMessage", () => {
  it("names a wrong address or password", () => {
    expect(signInErrorMessage(new Error("Invalid login credentials"))).toBe("כתובת הדוא״ל או הסיסמה שגויים.");
  });

  it("says when the address is not yet confirmed", () => {
    expect(signInErrorMessage(new Error("Email not confirmed"))).toMatch(/עוד לא אומתה/);
  });

  it("never shows a provider's English to the visitor", () => {
    const shown = signInErrorMessage(new Error("Database error querying schema"));
    expect(shown).toBe("לא הצלחנו להתחבר כרגע. נסו שוב בעוד רגע.");
    expect(shown).not.toMatch(/[A-Za-z]/);
  });

  it("copes with something that is not an Error at all", () => {
    expect(signInErrorMessage("boom")).toBe("לא הצלחנו להתחבר כרגע. נסו שוב בעוד רגע.");
  });
});
