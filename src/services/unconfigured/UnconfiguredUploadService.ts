import type { UploadPort } from "../ports";

/** Uploads for a build with no Supabase credentials: there is no bucket, so each is refused. */
export class UnconfiguredUploadService implements UploadPort {
  async upload(): Promise<{ url: string }> {
    throw new Error("אין חיבור למאגר.");
  }
}
