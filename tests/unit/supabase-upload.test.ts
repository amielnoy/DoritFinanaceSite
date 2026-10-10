import { describe, expect, it, vi } from "vitest";
import { SupabaseUploadService } from "@/services/supabase/SupabaseUploadService";

const AGENCY_1_ID = "00000000-0000-0000-0000-000000000001";
const TEN_YEARS_SECONDS = 10 * 365 * 24 * 60 * 60;

const file = (name: string) => new File(["content"], name, { type: "application/pdf" });

const clientOf = (overrides: {
  upload?: ReturnType<typeof vi.fn>;
  createSignedUrl?: ReturnType<typeof vi.fn>;
}) => ({
  storage: {
    from: vi.fn(() => ({
      upload: overrides.upload ?? vi.fn().mockResolvedValue({ data: { path: "x" }, error: null }),
      createSignedUrl:
        overrides.createSignedUrl ??
        vi.fn().mockResolvedValue({ data: { signedUrl: "https://example.test/signed" }, error: null }),
    })),
  },
});

describe("SupabaseUploadService", () => {
  it("uploads the file and returns the signed URL", async () => {
    const client = clientOf({});
    const out = await new SupabaseUploadService(client).upload(file("tz.pdf"));
    expect(out).toEqual({ url: "https://example.test/signed" });
    expect(client.storage.from).toHaveBeenCalledWith("claim-documents");
  });

  it("puts the file under the fixed agency's folder", async () => {
    const upload = vi.fn().mockResolvedValue({ data: { path: "x" }, error: null });
    const client = clientOf({ upload });
    await new SupabaseUploadService(client).upload(file("tz.pdf"));
    const [path] = upload.mock.calls[0];
    expect(path.startsWith(`${AGENCY_1_ID}/`)).toBe(true);
    expect(path.endsWith("-tz.pdf")).toBe(true);
  });

  it("sanitizes a filename with characters unsafe in a storage path", async () => {
    const upload = vi.fn().mockResolvedValue({ data: { path: "x" }, error: null });
    const client = clientOf({ upload });
    await new SupabaseUploadService(client).upload(file("תביעה (1)/תאריך 10.10.2026.pdf"));
    const [path] = upload.mock.calls[0];
    // Only the agency-folder separator may be a "/" — none should survive
    // from inside the original filename, which this split isolates.
    const filenamePart = path.slice(path.indexOf("/") + 1);
    expect(filenamePart).not.toMatch(/[()/ ]/);
    expect(filenamePart.endsWith(".pdf")).toBe(true);
  });

  it("signs the URL for ten years, not a short-lived default", async () => {
    const createSignedUrl = vi.fn().mockResolvedValue({ data: { signedUrl: "https://x" }, error: null });
    const client = clientOf({ createSignedUrl });
    await new SupabaseUploadService(client).upload(file("tz.pdf"));
    expect(createSignedUrl).toHaveBeenCalledWith(expect.any(String), TEN_YEARS_SECONDS);
  });

  it("throws when the upload itself fails, without trying to sign anything", async () => {
    const createSignedUrl = vi.fn();
    const upload = vi.fn().mockResolvedValue({ data: null, error: { message: "bucket is full" } });
    const client = clientOf({ upload, createSignedUrl });
    await expect(new SupabaseUploadService(client).upload(file("tz.pdf"))).rejects.toThrow(/bucket is full/);
    expect(createSignedUrl).not.toHaveBeenCalled();
  });

  it("throws when the file uploads but cannot be signed", async () => {
    const createSignedUrl = vi.fn().mockResolvedValue({ data: null, error: { message: "no access" } });
    const client = clientOf({ createSignedUrl });
    await expect(new SupabaseUploadService(client).upload(file("tz.pdf"))).rejects.toThrow(/no access/);
  });
});
