import type { UploadPort } from "../ports";
import { agencyObjectPath } from "./SupabaseUploadService";

/** Just the calls this adapter makes — see SupabaseAuthClient for why it is narrowed. */
export interface SupabaseImageStorageClient {
  storage: {
    from(bucket: string): {
      upload(
        path: string,
        file: File,
        options?: { contentType?: string; upsert?: boolean },
      ): PromiseLike<{ data: { path: string } | null; error: { message: string } | null }>;
      getPublicUrl(path: string): { data: { publicUrl: string } };
    };
  };
}

export const CONTENT_IMAGES_BUCKET = "content-images";

/**
 * Article and testimonial images, uploaded by the admin, into a public bucket.
 *
 * The opposite of claim documents in the one way that matters: these are shown
 * to every visitor, so the result is a plain public link an <img> can load,
 * stored as-is in `image_url`. Who may upload is the bucket's insert policy
 * (admins only — supabase/migrations/20261017000000_content_images_storage.sql);
 * which types and sizes, its own limits. The vercel.json CSP allows `img-src`
 * from this bucket's public path and nowhere else on the Supabase host.
 */
export class SupabaseImageUploadService implements UploadPort {
  constructor(private readonly client: SupabaseImageStorageClient) {}

  async upload(file: File): Promise<{ url: string }> {
    const path = agencyObjectPath(file);
    const bucket = this.client.storage.from(CONTENT_IMAGES_BUCKET);

    const { error } = await bucket.upload(path, file, { contentType: file.type, upsert: false });
    if (error) throw new Error(`image upload failed: ${error.message}`);

    return { url: bucket.getPublicUrl(path).data.publicUrl };
  }
}
