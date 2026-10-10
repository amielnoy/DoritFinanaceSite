import type { UploadPort } from "../ports";

/** Just the calls this adapter makes — see SupabaseAuthClient for why it is narrowed. */
export interface SupabaseStorageClient {
  storage: {
    from(bucket: string): {
      upload(
        path: string,
        file: File,
      ): PromiseLike<{ data: { path: string } | null; error: { message: string } | null }>;
      createSignedUrl(
        path: string,
        expiresIn: number,
      ): PromiseLike<{ data: { signedUrl: string } | null; error: { message: string } | null }>;
    };
  };
}

const BUCKET = "claim-documents";

/**
 * Dorit has no second agency yet, so this is the same fixed literal Phase 1
 * established rather than something resolved per request — see
 * supabase/migrations/20261010000000_tenant_schema.sql.
 */
const AGENCY_1_ID = "00000000-0000-0000-0000-000000000001";

/** Ten years, in seconds. The URL this returns is embedded in a Lead record
 *  and in the email sent at submission time, both reviewed long after the
 *  claim, so a short expiry would quietly break an old claim's attachment —
 *  unlike a one-time view, this has to outlive the moment it was created in. */
const SIGNED_URL_EXPIRY_SECONDS = 10 * 365 * 24 * 60 * 60;

/** A name safe to put in a storage path: letters, digits, dot, dash, underscore. */
const sanitizeFilename = (name: string): string => name.replace(/[^a-zA-Z0-9.\-_]/g, "_");

export class SupabaseUploadService implements UploadPort {
  constructor(private readonly client: SupabaseStorageClient) {}

  async upload(file: File): Promise<{ url: string }> {
    const path = `${AGENCY_1_ID}/${crypto.randomUUID()}-${sanitizeFilename(file.name)}`;

    const { error: uploadError } = await this.client.storage.from(BUCKET).upload(path, file);
    if (uploadError) throw new Error(`claim document upload failed: ${uploadError.message}`);

    const { data, error: signError } = await this.client.storage
      .from(BUCKET)
      .createSignedUrl(path, SIGNED_URL_EXPIRY_SECONDS);
    if (signError || !data) {
      throw new Error(`claim document uploaded but could not be signed: ${signError?.message ?? "no data"}`);
    }
    return { url: data.signedUrl };
  }
}
