import { describe, expect, it } from "vitest";
import { liftRedact, liftScrub, SECRET_JS } from "../helpers/staff-lead-secret";

/*
 * create_staff_lead refuses notes, a topic or a referrer that still hold what
 * redact() cuts out (field_invalid), for a direct call to /rest/v1/rpc. The
 * create-lead function scrubs before it calls — redact() twice — so its own call
 * must never trip that check: whatever scrub() returns, the SQL pattern finds
 * nothing in it. One redact() pass does not guarantee that (a glued IBAN, a
 * number cut at 2000 characters), which is why scrub() is two.
 * The pattern is pinned in the migration by staff-leads-schema.contract.test.ts.
 */
const redact = liftRedact();
const scrub = liftScrub();

const SECRETS = [
  "123456782",
  "ת.ז. 123456782 בשיחה",
  "ת״ז:123456782",
  "4580 1234 5678 9012",
  "4580-1234-5678-9012",
  "כרטיס 4580123456789012 בתוקף",
  "IL620108000000099999999",
  "חשבון il620108000000099999999",
  "חשבון 123456",
  "סניף 12, חשבון 1234567",
  "פוליסה 12345678",
  "050-1234567",
  // Next to a Hebrew letter: Postgres counts it as a word character, so a \y
  // boundary missed these while JavaScript's \b did not.
  "תז123456789",
  "ת.ז 123456789",
  "ת.ז123456789",
  "חשבון12345678",
  "כרטיס4580123456789012",
  "חשבוןIL620108000000099999999",
  // Glued to digits the first pass takes: the IBAN pass runs before the digit
  // passes, so it sees "123456IL62…" as one word and leaves it; the digits go,
  // and the IBAN is bare.
  "123456IL620108000000099999999",
  "123456789IL620108000000099999999",
];
const CLEAN = ["שיחה ראשונה", "פגישה ב-10:30, 05/11", "רו״ח משה", "0501234567", "12345", "1234567890", "פנסיה", "", "AIL620108000000099999999"];

describe("create_staff_lead's field_invalid pattern, against redact()", () => {
  it.each(SECRETS)("finds the raw %j", (sample) => {
    expect(SECRET_JS.test(sample)).toBe(true);
  });

  it.each(SECRETS)("finds nothing in scrub(%j)", (sample) => {
    const out = scrub(sample);
    expect(out).not.toBe(sample);
    expect(SECRET_JS.test(out), out).toBe(false);
  });

  it.each(CLEAN)("leaves %j alone, before and after redact()", (sample) => {
    expect(SECRET_JS.test(sample)).toBe(false);
    expect(SECRET_JS.test(redact(sample))).toBe(false);
  });

  it("one redact() pass is not enough for a glued IBAN: scrub() is two on purpose", () => {
    for (const glued of ["123456IL620108000000099999999", "123456789IL620108000000099999999"]) {
      expect(SECRET_JS.test(redact(glued)), `one pass: ${redact(glued)}`).toBe(true);
      expect(SECRET_JS.test(scrub(glued))).toBe(false);
    }
  });

  it("finds nothing in what create-lead sends, even when redact() cuts a long number at 2000 characters", () => {
    // Ten "123456 " grow to fifteen characters each, so after them and 1843
    // letters the cut at 2000 leaves seven digits of the twelve-digit run at the end.
    const long = "123456 ".repeat(10) + "א".repeat(1843) + "123456789012";
    expect(long.length).toBeLessThanOrEqual(2000);
    expect(redact(long).endsWith("א1234567")).toBe(true);
    const once = redact(long);
    expect(SECRET_JS.test(once), "one pass leaves a piece: the reason for the second").toBe(true);
    expect(SECRET_JS.test(scrub(long))).toBe(false);
  });

  it("finds nothing in scrub() of 5000 random mixes of digits, IBANs, separators and letters", () => {
    // A fixed seed, so a failure repeats.
    let seed = 20261020;
    const rand = (n: number) => ((seed = (seed * 1103515245 + 12345) % 2 ** 31), seed % n);
    const parts = ["0", "1", "4", "9", " ", "-", "IL", "il", "א", "ש", "a", "Z", "_", ".", ":", "12", "1234", "123456", "IL620108000000099999999", "il62010800000009"];
    let raw = 0;
    for (let i = 0; i < 5000; i++) {
      let text = "";
      const len = 1 + rand(60);
      for (let j = 0; j < len; j++) text += parts[rand(parts.length)];
      if (SECRET_JS.test(text)) raw += 1;
      const out = scrub(text);
      expect(SECRET_JS.test(out), `${text} → ${out}`).toBe(false);
    }
    // And long ones, past redact()'s 2000-character cut, the way create-lead sends them.
    for (let i = 0; i < 300; i++) {
      let text = "";
      const len = 400 + rand(500);
      for (let j = 0; j < len; j++) text += parts[rand(parts.length)];
      const out = scrub(text.slice(0, 2000));
      expect(SECRET_JS.test(out), `${text.length} characters → ${out.slice(-40)}`).toBe(false);
    }
    // Not vacuous: many of the inputs held something to cut.
    expect(raw).toBeGreaterThan(500);
  });

  it("leaves no lone surrogate when the cut at 2000 characters falls inside an emoji", () => {
    const out = redact("a".repeat(1999) + "😀");
    expect(out).toBe("a".repeat(1999));
    expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(out)).toBe(false);
    expect(JSON.parse(JSON.stringify({ out })).out).toBe(out);
  });
});
