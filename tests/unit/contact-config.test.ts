import { describe, expect, it } from "vitest";
import { CONTACT } from "@/config/contact";

// The phone number appears in four different shapes across the site (tel:,
// wa.me, display, schema.org). A drift between them silently breaks a CTA, so
// pin the relationships rather than the individual literals only.
describe("CONTACT config", () => {
  it("exposes an E.164 dial number", () => {
    expect(CONTACT.phoneE164).toMatch(/^\+972\d{9}$/);
  });

  it("exposes a wa.me number with no plus and no leading zero", () => {
    expect(CONTACT.whatsapp).toMatch(/^972\d{9}$/);
    expect(CONTACT.whatsapp).not.toContain("+");
  });

  it("keeps the wa.me number in sync with the dial number", () => {
    expect(CONTACT.whatsapp).toBe(CONTACT.phoneE164.replace("+", ""));
  });

  it("keeps the display number in sync with the dial number", () => {
    const digits = CONTACT.phoneDisplay.replace(/\D/g, "");
    expect(CONTACT.phoneE164).toBe(`+972${digits.replace(/^0/, "")}`);
  });

  it("exposes a valid contact email", () => {
    expect(CONTACT.email).toMatch(/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i);
  });
});
