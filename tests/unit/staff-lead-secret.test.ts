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
];
const CLEAN = ["שיחה ראשונה", "פגישה ב-10:30, 05/11", "רו״ח משה", "0501234567", "12345", "1234567890", "פנסיה", ""];

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
    // Not vacuous: many of the inputs held something to cut.
    expect(raw).toBeGreaterThan(500);
  });
});
