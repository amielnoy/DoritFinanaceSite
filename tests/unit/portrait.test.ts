import { describe, expect, it } from "vitest";
import { AGENCY1_ID } from "@/config/agency1";
import { agentPhotoBase, initialsOf, portraitFor } from "@/lib/portrait";

const BASE = "https://p.supabase.co/storage/v1/object/public/agent-photos/";
const dorit = { agencyId: AGENCY1_ID, photoPath: null, photoAlt: null, fullName: "דורית גוב ארי" };
const OTHER = "00000000-0000-0000-0000-0000000000b2";

describe("portraitFor", () => {
  it("UNIT-POR-001: agency 1 without a photo gets the bundled set", () => {
    expect(portraitFor(dorit, BASE)).toEqual({ kind: "bundled", alt: "דורית גוב ארי — דיוקן מקצועי" });
    expect(portraitFor({ ...dorit, photoAlt: "x" }, BASE)).toEqual({ kind: "bundled", alt: "x" });
  });

  it("UNIT-POR-002: agency 1 with her own upload shows the upload", () => {
    const p = portraitFor({ ...dorit, photoPath: "a/b/new-768.webp" }, BASE);
    expect(p.kind).toBe("photo");
  });

  it("UNIT-POR-003: another agency's -768.webp path gets the 480/768/1080 srcset", () => {
    const path = "f1/g1/portrait-768.webp";
    const p = portraitFor({ agencyId: OTHER, photoPath: path, photoAlt: null, fullName: "יעל כהן" }, BASE);
    expect(p).toEqual({
      kind: "photo",
      src: `${BASE}${path}`,
      srcSet: `${BASE}f1/g1/portrait-480.webp 480w, ${BASE}f1/g1/portrait-768.webp 768w, ${BASE}f1/g1/portrait-1080.webp 1080w`,
      alt: "יעל כהן — דיוקן מקצועי",
    });
  });

  it("UNIT-POR-004: a path not ending -768.webp gets a single src", () => {
    const p = portraitFor({ agencyId: OTHER, photoPath: "f1/g1/me.jpg", photoAlt: "אני", fullName: "יעל כהן" }, BASE);
    expect(p).toEqual({ kind: "photo", src: `${BASE}f1/g1/me.jpg`, srcSet: null, alt: "אני" });
  });

  it("UNIT-POR-005: another agency without a photo gets a monogram", () => {
    expect(portraitFor({ agencyId: OTHER, photoPath: null, photoAlt: null, fullName: "יעל כהן" }, BASE)).toEqual({
      kind: "monogram",
      initials: "יכ",
      alt: "יעל כהן — דיוקן מקצועי",
    });
  });

  it("UNIT-POR-006: a photo path with no storage base falls back to the monogram", () => {
    const p = portraitFor({ agencyId: OTHER, photoPath: "f1/g1/p-768.webp", photoAlt: null, fullName: "יעל כהן" }, null);
    expect(p.kind).toBe("monogram");
  });
});

describe("initialsOf and agentPhotoBase", () => {
  it("UNIT-POR-007: initials are the first letters of the first two words; the base needs a URL", () => {
    expect(initialsOf("  דנה  ")).toBe("ד");
    expect(initialsOf("דורית גוב ארי")).toBe("דג");
    expect(agentPhotoBase(undefined)).toBeNull();
    expect(agentPhotoBase("https://p.supabase.co/")).toBe(BASE);
    expect(agentPhotoBase("https://p.supabase.co")).toBe(BASE);
  });
});
