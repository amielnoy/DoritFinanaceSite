import { describe, expect, it } from "vitest";
import { CONTACT } from "@/config/contact";
import { read, rel, sourceFiles } from "../helpers/source-scan";

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

/**
 * The config is only a single source of truth if nothing else in `src/`
 * spells the number or the address out by hand. QuickContact, Accessibility,
 * PrivacyPolicy, the Outlook booking helper, the escalation fallback and the
 * handoff copy all did, so a change to `CONTACT` reached the footer and not
 * the contact form beneath it. This scan fails on the next such literal.
 */
describe("contact literals live only in src/config/contact.js", () => {
  const CONFIG = "src/config/contact.js";
  const localDigits = CONTACT.phoneE164.replace(/^\+972/, "0"); // 0508311776
  const needles = [
    CONTACT.email,
    CONTACT.whatsapp,
    CONTACT.phoneE164,
    localDigits,
    // Any hyphenation of the local number, e.g. 050-831-1776 or 050-8311776.
    new RegExp(localDigits.split("").join("-?")),
  ];

  for (const file of sourceFiles()) {
    if (rel(file) === CONFIG) continue;
    it(`${rel(file)} does not hardcode the phone number or email`, () => {
      const src = read(file);
      for (const needle of needles) {
        const hit = typeof needle === "string" ? src.includes(needle) : needle.test(src);
        expect(hit, `${rel(file)} contains ${String(needle)} — import CONTACT instead`).toBe(false);
      }
    });
  }
});
