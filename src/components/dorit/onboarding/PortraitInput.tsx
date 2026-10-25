import React, { useState } from "react";
import { services } from "@/services";
import { encodePortrait, portraitProblem } from "@/lib/portrait-encode";

/**
 * Step 1's portrait (optional): pick a photo, crop it to 4:5 and re-encode it
 * in the browser, upload the three sizes, and only then point the licensee at
 * them (SupabaseOnboardingService.uploadPortrait). "הסרת התמונה" goes back
 * to the monogram. The licensee's row must exist first.
 */
export default function PortraitInput({
  agencyId,
  agentId,
  photoPath,
  onChanged,
  disabled,
}: {
  agencyId: string;
  agentId: string | null;
  photoPath: string | null;
  /** The licensee's new photo_path, and the row's updated_at the write left. */
  onChanged: (path: string | null, updatedAt: string | null) => void;
  disabled?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const choose = async (file: File | undefined) => {
    if (!file || !agentId) return;
    const issue = portraitProblem(file);
    setProblem(issue);
    if (issue) return;
    setBusy(true);
    try {
      const files = await encodePortrait(file);
      const done = await services.onboarding.uploadPortrait(agencyId, agentId, files, photoPath);
      onChanged(done.photoPath, done.updatedAt);
    } catch (e) {
      setProblem((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!agentId || !photoPath) return;
    setBusy(true);
    try {
      const done = await services.onboarding.removePortrait(agencyId, agentId, photoPath);
      onChanged(null, done.updatedAt);
    } catch (e) {
      setProblem((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!agentId) return <p className="text-xs text-muted-foreground">אפשר להוסיף תמונה אחרי ששומרים את השם.</p>;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <label className="inline-flex min-h-11 cursor-pointer items-center rounded-md border border-border px-3 text-sm hover:border-accent">
          {photoPath ? "החלפת התמונה" : "העלאת תמונה"}
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp,image/heic"
            className="sr-only"
            disabled={disabled || busy}
            onChange={(e) => void choose(e.target.files?.[0])}
          />
        </label>
        {photoPath ? (
          <button type="button" onClick={() => void remove()} disabled={disabled || busy} className="min-h-11 px-2 text-sm text-muted-foreground hover:text-destructive">
            הסרת התמונה
          </button>
        ) : null}
        {busy ? <span role="status" className="text-xs text-muted-foreground">מעבדים ומעלים…</span> : null}
      </div>
      <p className="text-xs text-muted-foreground">JPG, PNG, WebP או HEIC עד 10MB. התמונה נחתכת לפורטרט, ופרטי המיקום שבה נמחקים לפני ההעלאה. בלי תמונה מוצגות ראשי התיבות.</p>
      {problem ? <p role="alert" className="text-xs text-destructive">{problem}</p> : null}
    </div>
  );
}
