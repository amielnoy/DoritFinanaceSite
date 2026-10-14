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

export const CLAIM_DOCUMENTS_BUCKET = "claim-documents";

/**
 * What a claim document is known by once uploaded: its path in the private
 * bucket, marked so `submit-claim` and the leads screen can tell it from a
 * Base44 file URL. Never a signed URL — see the class comment.
 */
export const CLAIM_DOCUMENT_REF_PREFIX = `storage:${CLAIM_DOCUMENTS_BUCKET}/`;

/**
 * Dorit has no second agency yet, so this is the same fixed literal Phase 1
 * established rather than something resolved per request — see
 * supabase/migrations/20261010000000_tenant_schema.sql.
 */
const AGENCY_1_ID = "00000000-0000-0000-0000-000000000001";

/** A name safe to put in a storage path: letters, digits, dot, dash, underscore. */
const sanitizeFilename = (name: string): string => name.replace(/[^a-zA-Z0-9.\-_]/g, "_");

/**
 * Where an uploaded file is stored: the fixed agency's folder, a fresh uuid so
 * two uploads never collide, then the sanitized name. Shared with
 * SupabaseImageUploadService so both buckets lay files out the same way.
 */
export const agencyObjectPath = (file: File): string =>
  `${AGENCY_1_ID}/${crypto.randomUUID()}-${sanitizeFilename(file.name)}`;

/**
 * Claim documents into the private bucket, uploaded by an anonymous visitor.
 *
 * Returns the object's path, not a link. The visitor may insert into the
 * bucket and nothing else, so it could not sign one anyway — and a link that
 * outlives the claim, sitting in a mailbox, is the wrong thing to hand out for
 * insurance documents. `submit-claim` signs a week-long link for the
 * notification mail with the service key; after that, the leads screen signs
 * a short one when an admin opens the document (`LeadAdminPort.documentLink`).
 */
export class SupabaseUploadService implements UploadPort {
  constructor(private readonly client: SupabaseStorageClient) {}

  async upload(file: File): Promise<{ url: string }> {
    const path = agencyObjectPath(file);

    const { error } = await this.client.storage.from(CLAIM_DOCUMENTS_BUCKET).upload(path, file);
    if (error) throw new Error(`claim document upload failed: ${error.message}`);

    return { url: `${CLAIM_DOCUMENT_REF_PREFIX}${path}` };
  }
}
