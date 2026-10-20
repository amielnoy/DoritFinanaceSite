import { describe, expect, it } from "vitest";
import { liftRedact, SECRET_JS } from "../helpers/staff-lead-secret";

/*
 * create_staff_lead refuses notes, a topic or a referrer that still hold what
 * redact() cuts out (field_invalid), for a direct call to /rest/v1/rpc. The
 * create-lead function redacts before it calls, so its own call must never
 * trip that check: whatever redact() returns, the SQL pattern finds nothing in it.
 * The pattern is pinned in the migration by staff-leads-schema.contract.test.ts.
 */
const redact = liftRedact();
/** What create-lead sends: redact() twice (its `scrub`), so a number cut in two at 2000 characters is taken too. */
const scrub = (s: string) => redact(redact(s));

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
];
const CLEAN = ["שיחה ראשונה", "פגישה ב-10:30, 05/11", "רו״ח משה", "0501234567", "12345", "1234567890", "פנסיה", "", "AIL620108000000099999999"];

describe("create_staff_lead's field_invalid pattern, against redact()", () => {
  it.each(SECRETS)("finds the raw %j", (sample) => {
    expect(SECRET_JS.test(sample)).toBe(true);
  });

  it.each(SECRETS)("finds nothing in redact(%j)", (sample) => {
    const out = redact(sample);
    expect(out).not.toBe(sample);
    expect(SECRET_JS.test(out), out).toBe(false);
  });

  it.each(CLEAN)("leaves %j alone, before and after redact()", (sample) => {
    expect(SECRET_JS.test(sample)).toBe(false);
    expect(SECRET_JS.test(redact(sample))).toBe(false);
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

  it("finds nothing in redact() of 5000 random mixes of digits, separators, letters and IL", () => {
    // A fixed seed, so a failure repeats.
    let seed = 20261020;
    const rand = (n: number) => ((seed = (seed * 1103515245 + 12345) % 2 ** 31), seed % n);
    const parts = ["0", "1", "4", "9", " ", "-", "IL", "il", "א", "ש", "a", "Z", "_", ".", ":", "12", "1234"];
    let raw = 0;
    for (let i = 0; i < 5000; i++) {
      let text = "";
      const len = 1 + rand(60);
      for (let j = 0; j < len; j++) text += parts[rand(parts.length)];
      if (SECRET_JS.test(text)) raw += 1;
      const out = redact(text);
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
});
