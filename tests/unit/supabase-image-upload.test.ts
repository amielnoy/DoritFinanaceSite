import { describe, expect, it, vi } from "vitest";
import { CONTENT_IMAGES_BUCKET, SupabaseImageUploadService } from "@/services/supabase/SupabaseImageUploadService";

const AGENCY_1_ID = "00000000-0000-0000-0000-000000000001";
const PUBLIC_BASE = "https://example.supabase.co/storage/v1/object/public/content-images/";

const image = (name: string) => new File(["pixels"], name, { type: "image/jpeg" });

const clientOf = (upload = vi.fn().mockResolvedValue({ data: { path: "x" }, error: null })) => {
  const getPublicUrl = vi.fn((path: string) => ({ data: { publicUrl: `${PUBLIC_BASE}${path}` } }));
  const client = { storage: { from: vi.fn(() => ({ upload, getPublicUrl })) } };
  return { client, upload, getPublicUrl };
};

describe("SupabaseImageUploadService", () => {
  it("uploads into the public content-images bucket and returns the public link", async () => {
    const { client, upload } = clientOf();
    const out = await new SupabaseImageUploadService(client).upload(image("hero.jpg"));
    const [path] = upload.mock.calls[0];
    expect(client.storage.from).toHaveBeenCalledWith(CONTENT_IMAGES_BUCKET);
    expect(CONTENT_IMAGES_BUCKET).toBe("content-images");
    // A real link, not a `storage:` reference: an article image is shown to
    // every visitor, so it must be something an <img> can load as-is.
    expect(out).toEqual({ url: `${PUBLIC_BASE}${path}` });
  });

  it("puts the file under the fixed agency's folder with a unique, path-safe name", async () => {
    const { client, upload } = clientOf();
    await new SupabaseImageUploadService(client).upload(image("תמונה (1)/דורית.jpg"));
    await new SupabaseImageUploadService(client).upload(image("תמונה (1)/דורית.jpg"));
    const [first] = upload.mock.calls[0];
    const [second] = upload.mock.calls[1];
    expect(first.startsWith(`${AGENCY_1_ID}/`)).toBe(true);
    expect(first.slice(first.indexOf("/") + 1)).not.toMatch(/[()/ ]/);
    expect(first.endsWith(".jpg")).toBe(true);
    // Two uploads of the same file never overwrite each other.
    expect(first).not.toBe(second);
  });

  it("passes the file's own content type, so the bucket's type check sees it", async () => {
    const { client, upload } = clientOf();
    const file = new File(["pixels"], "a.webp", { type: "image/webp" });
    await new SupabaseImageUploadService(client).upload(file);
    expect(upload.mock.calls[0][1]).toBe(file);
    expect(upload.mock.calls[0][2]).toMatchObject({ contentType: "image/webp", upsert: false });
  });

  it("throws when the upload fails, and builds no link", async () => {
    const upload = vi.fn().mockResolvedValue({ data: null, error: { message: "new row violates row-level security policy" } });
    const { client, getPublicUrl } = clientOf(upload);
    await expect(new SupabaseImageUploadService(client).upload(image("a.jpg"))).rejects.toThrow(
      /image upload failed: new row violates row-level security policy/,
    );
    expect(getPublicUrl).not.toHaveBeenCalled();
  });
});
