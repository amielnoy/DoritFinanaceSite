import type { PortraitFiles } from "@/services/ports";
import { PORTRAIT_WIDTHS } from "@/lib/portrait";

/**
 * The licensee's portrait, prepared in the browser (spec, "Photo upload"):
 * cropped to 4:5 and re-encoded to WebP at the three widths Hero's srcset
 * already uses. Re-encoding through a canvas drops every byte of metadata —
 * EXIF, GPS included — before anything leaves the device.
 */

const ACCEPTED = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];
export const PORTRAIT_MAX_BYTES = 10 * 1024 * 1024;

/** Why a file cannot be a portrait, in Hebrew; null when it can. */
export function portraitProblem(file: Pick<File, "type" | "size">): string | null {
  if (!ACCEPTED.includes(file.type)) return "אפשר להעלות JPG, PNG, WebP או HEIC.";
  if (file.size > PORTRAIT_MAX_BYTES) return "התמונה גדולה מ-10MB.";
  return null;
}

/**
 * The 4:5 window of a photo: centred across, and on a tall photo a third of
 * the spare height above and two thirds below — a face sits in the upper half
 * of most portraits, and a dead-centre crop cuts the forehead.
 */
export function cropRect(width: number, height: number): { sx: number; sy: number; sw: number; sh: number } {
  if (width / height > 4 / 5) {
    const sw = Math.round((height * 4) / 5);
    return { sx: Math.round((width - sw) / 2), sy: 0, sw, sh: height };
  }
  const sh = Math.round((width * 5) / 4);
  return { sx: 0, sy: Math.round((height - sh) / 3), sw: width, sh };
}

/** The three WebP files. A browser that cannot decode the file (HEIC outside Safari) says so in Hebrew. */
export async function encodePortrait(file: File): Promise<PortraitFiles> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error("הדפדפן לא הצליח לפתוח את התמונה. נסו JPG או PNG.");
  }
  const { sx, sy, sw, sh } = cropRect(bitmap.width, bitmap.height);
  const out = {} as PortraitFiles;
  for (const width of PORTRAIT_WIDTHS) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = Math.round((width * 5) / 4);
    canvas.getContext("2d")!.drawImage(bitmap, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    out[width] = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("הכנת התמונה נכשלה."))), "image/webp", 0.86),
    );
  }
  bitmap.close();
  return out;
}
