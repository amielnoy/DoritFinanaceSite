/**
 * What a claim report may attach: the claim-documents bucket's own limits,
 * checked in the browser first so a visitor hears which file is wrong and why
 * instead of "the upload failed".
 *
 * The bucket enforces the size and the types itself
 * (supabase/migrations/20261012000000_claim_documents_storage.sql), and
 * submit-claim refuses more than MAX_DOCUMENTS (`_shared/guard.ts`).
 * `tests/unit/claim-documents.test.ts` fails when these drift from either.
 */

/** 10 MB — the bucket's `file_size_limit`. */
export const CLAIM_DOCUMENT_MAX_BYTES = 10 * 1024 * 1024;

/** The bucket's `allowed_mime_types`. */
export const CLAIM_DOCUMENT_TYPES = ["image/jpeg", "image/png", "image/heic", "image/webp", "application/pdf"] as const;

/** submit-claim's MAX_DOCUMENTS. */
export const CLAIM_DOCUMENT_MAX_FILES = 10;

/**
 * The type a file is known by from its name. iOS hands over a HEIC photo, and
 * some browsers any file, with an empty `type`; without a type the upload would
 * go as a generic one the bucket refuses.
 */
const BY_EXTENSION: Record<string, (typeof CLAIM_DOCUMENT_TYPES)[number]> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  heic: "image/heic",
  webp: "image/webp",
  pdf: "application/pdf",
};

/** The file input's `accept`: the types, and the extensions for a file the browser cannot type. */
export const CLAIM_DOCUMENT_ACCEPT = [...CLAIM_DOCUMENT_TYPES, ...Object.keys(BY_EXTENSION).map((e) => `.${e}`)].join(",");

/** The allowed type a file is, or null when it is none of them. */
export function claimDocumentType(file: { name: string; type: string }): string | null {
  if ((CLAIM_DOCUMENT_TYPES as readonly string[]).includes(file.type)) return file.type;
  if (file.type && file.type !== "application/octet-stream") return null;
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  return BY_EXTENSION[ext] ?? null;
}

/**
 * Why a file cannot be attached, as the claims page's message key (each takes
 * `{name}`), or null when it can.
 */
export function claimDocumentProblem(file: {
  name: string;
  type: string;
  size: number;
}): "form.fileType" | "form.fileSize" | "form.fileEmpty" | null {
  if (!claimDocumentType(file)) return "form.fileType";
  if (file.size > CLAIM_DOCUMENT_MAX_BYTES) return "form.fileSize";
  if (file.size === 0) return "form.fileEmpty";
  return null;
}
