import React from "react";
import { agentPhotoBase, portraitFor } from "@/lib/portrait";
import { getField, firstName, type OnboardingDraft } from "@/lib/onboarding-draft";

const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/**
 * The live preview beside the wizard: the hero and the about block as the
 * agency's site will show them, from what has been typed so far. Without a
 * photo it shows the monogram — the designed state, not a broken image.
 */
export default function OnboardingPreview({ draft, large = false }: { draft: OnboardingDraft; large?: boolean }) {
  const name = text(getField(draft, "agents.full_name")) || text(getField(draft, "agency_profiles.display_name")) || "השם שלך";
  const portrait = portraitFor(
    {
      agencyId: String(draft.agencies.id ?? ""),
      photoPath: text(getField(draft, "agents.photo_path")) || null,
      photoAlt: text(getField(draft, "agents.photo_alt")) || null,
      fullName: name,
    },
    agentPhotoBase(import.meta.env.VITE_SUPABASE_URL),
  );
  const stats = (getField(draft, "agents.stats") as { num?: string; label?: string }[] | undefined) ?? [];
  const about: [string, string][] = [
    ["רקע מקצועי", text(getField(draft, "agents.bio.career"))],
    ["השכלה ותעודות", text(getField(draft, "agents.bio.credentials"))],
    ["מה מייחד אותי", text(getField(draft, "agents.bio.unique"))],
    ["קצת עליי", text(getField(draft, "agents.bio.family"))],
  ];
  const signature = text(getField(draft, "agents.bio.signature")) || firstName(name);

  return (
    <section aria-label="תצוגה מקדימה" className={`rounded-2xl border border-border bg-background p-5 ${large ? "" : "text-sm"}`}>
      <p className="mb-3 text-xs font-semibold text-muted-foreground">תצוגה מקדימה</p>
      <div className="flex items-center gap-4">
        {portrait.kind === "photo" ? (
          <img src={portrait.src} srcSet={portrait.srcSet ?? undefined} sizes="88px" alt={portrait.alt} className="h-[88px] w-[88px] rounded-full object-cover" />
        ) : (
          <span aria-label={portrait.alt} role="img" className="flex h-[88px] w-[88px] items-center justify-center rounded-full bg-accent text-2xl font-bold text-accent-foreground">
            {portrait.kind === "monogram" ? portrait.initials : ""}
          </span>
        )}
        <div>
          <p className="font-bold">{name}</p>
          <p className="text-muted-foreground">{text(getField(draft, "agents.professional_title")) || "התואר המקצועי"}</p>
          <p dir="ltr" className="text-left text-xs text-muted-foreground">{text(getField(draft, "agents.licence_number"))}</p>
        </div>
      </div>
      <p className={`mt-4 font-heading font-bold leading-snug ${large ? "text-3xl" : "text-xl"}`}>
        {text(getField(draft, "agents.bio.headline")) || "משפט הפתיחה שלך יופיע כאן"}
      </p>
      {stats.length ? (
        <ul className="mt-4 flex flex-wrap gap-4">
          {stats.map((s, i) => (
            <li key={i}>
              <span className="block text-lg font-bold">{s.num}</span>
              <span className="text-xs text-muted-foreground">{s.label}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="mt-4 space-y-2">
        {about.filter(([, v]) => v).map(([title, v]) => (
          <div key={title}>
            <p className="text-xs font-semibold">{title}</p>
            <p className="whitespace-pre-wrap text-muted-foreground">{v}</p>
          </div>
        ))}
      </div>
      <p className="mt-3 text-end font-medium">— {signature}</p>
    </section>
  );
}
