import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CLAIM_DOCUMENT_ACCEPT,
  CLAIM_DOCUMENT_MAX_BYTES,
  CLAIM_DOCUMENT_MAX_FILES,
  CLAIM_DOCUMENT_TYPES,
  claimDocumentProblem,
  claimDocumentType,
} from "@/config/claimDocuments";
import { MAX_DOCUMENTS } from "../../supabase/functions/_shared/guard";

/**
 * The claim form's file checks (D-02): the browser says which file is wrong
 * and why, before anything is uploaded. The bucket and submit-claim enforce the
 * same limits, and these tests fail when the browser's copy drifts from theirs.
 */

const MIGRATION = readFileSync("supabase/migrations/20261012000000_claim_documents_storage.sql", "utf8");

const file = (name: string, type: string, size = 1024) => ({ name, type, size });

describe("the claim form's limits are the bucket's", () => {
  it("has the bucket's size limit", () => {
    const m = MIGRATION.match(/false,\s*(\d+),\s*--\s*10 MB/);
    expect(Number(m?.[1])).toBe(CLAIM_DOCUMENT_MAX_BYTES);
  });

  it("has the bucket's types, no more and no fewer", () => {
    const m = MIGRATION.match(/array\[([^\]]+)\]/);
    const bucket = (m?.[1] ?? "").match(/'([^']+)'/g)!.map((t) => t.slice(1, -1));
    expect([...CLAIM_DOCUMENT_TYPES].sort()).toEqual(bucket.sort());
  });

  it("has submit-claim's document count", () => {
    expect(CLAIM_DOCUMENT_MAX_FILES).toBe(MAX_DOCUMENTS);
  });

  it("offers every type, and the extensions, in the picker", () => {
    for (const t of CLAIM_DOCUMENT_TYPES) expect(CLAIM_DOCUMENT_ACCEPT).toContain(t);
    expect(CLAIM_DOCUMENT_ACCEPT).toContain(".heic");
  });
});

describe("claimDocumentType", () => {
  it.each([
    ["a typed PDF", file("a.pdf", "application/pdf"), "application/pdf"],
    ["a HEIC photo iOS left untyped", file("IMG_0001.HEIC", ""), "image/heic"],
    ["an octet-stream JPEG", file("scan.jpeg", "application/octet-stream"), "image/jpeg"],
  ])("knows %s", (_label, f, type) => {
    expect(claimDocumentType(f)).toBe(type);
  });

  it.each([
    ["a program", file("setup.exe", "application/x-msdownload")],
    ["an archive", file("all.zip", "application/zip")],
    ["a typed file renamed .pdf", file("evil.pdf", "text/html")],
    ["an untyped file with no known extension", file("notes", "")],
  ])("refuses %s", (_label, f) => {
    expect(claimDocumentType(f)).toBeNull();
  });
});

describe("claimDocumentProblem", () => {
  it("names the type, the size and the empty file, in that order", () => {
    expect(claimDocumentProblem(file("setup.exe", "application/x-msdownload"))).toBe("form.fileType");
    expect(claimDocumentProblem(file("scan.pdf", "application/pdf", CLAIM_DOCUMENT_MAX_BYTES + 1))).toBe("form.fileSize");
    expect(claimDocumentProblem(file("blank.pdf", "application/pdf", 0))).toBe("form.fileEmpty");
  });

  it("takes a file at exactly the limit", () => {
    expect(claimDocumentProblem(file("scan.pdf", "application/pdf", CLAIM_DOCUMENT_MAX_BYTES))).toBeNull();
  });
});
