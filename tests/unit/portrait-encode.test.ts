import { describe, expect, it } from "vitest";
import { cropRect, portraitProblem } from "@/lib/portrait-encode";
import { isAgencyOnboardingOn } from "@/config/agency-onboarding";

describe("cropRect — a 4:5 portrait from the middle of any photo", () => {
  it("trims the sides of a landscape photo", () => {
    expect(cropRect(2000, 1000)).toEqual({ sx: 600, sy: 0, sw: 800, sh: 1000 });
  });

  it("trims the top and bottom of a tall photo, keeping the upper part where a face usually is", () => {
    // 4:5 of a 1000-wide photo is 1250 tall; of 2000, 750 is left over — a third above, two thirds below.
    expect(cropRect(1000, 2000)).toEqual({ sx: 0, sy: 250, sw: 1000, sh: 1250 });
  });

  it("leaves an exact 4:5 photo whole", () => {
    expect(cropRect(800, 1000)).toEqual({ sx: 0, sy: 0, sw: 800, sh: 1000 });
  });
});

describe("portraitProblem — what the upload refuses before it starts", () => {
  const file = (type: string, size: number) => ({ type, size }) as File;
  it("accepts JPG, PNG, WebP and HEIC up to 10 MB", () => {
    for (const t of ["image/jpeg", "image/png", "image/webp", "image/heic"]) expect(portraitProblem(file(t, 5_000_000))).toBeNull();
  });
  it("refuses anything else, and anything larger", () => {
    expect(portraitProblem(file("image/gif", 1000))).toBe("אפשר להעלות JPG, PNG, WebP או HEIC.");
    expect(portraitProblem(file("image/jpeg", 10 * 1024 * 1024 + 1))).toBe("התמונה גדולה מ-10MB.");
  });
});

describe("the flag", () => {
  it("is on only for exactly true", () => {
    expect(isAgencyOnboardingOn("true")).toBe(true);
    expect(isAgencyOnboardingOn(undefined)).toBe(false);
    expect(isAgencyOnboardingOn("1")).toBe(false);
  });
});
