import React, { useEffect, useId, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Eyebrow from "@/components/dorit/primitives/Eyebrow";
import { useAgencyRole, useCurrentAgency } from "@/hooks/useAgency";
import { useSeo } from "@/lib/seo";
import { services, type AgencyProfile as Profile } from "@/services";

type Fields = Omit<Profile, "agencyId">;

/** The fields, in the order a person fills them, with what each is for. */
const FIELDS: { key: keyof Fields; label: string; dir?: "ltr"; hint?: string }[] = [
  { key: "displayName", label: "שם לתצוגה" },
  { key: "phoneDisplay", label: "טלפון לתצוגה", dir: "ltr" },
  { key: "phoneE164", label: "טלפון בפורמט בינלאומי", dir: "ltr", hint: "למשל ‎+972501234567" },
  { key: "whatsapp", label: "מספר וואטסאפ", dir: "ltr", hint: "ספרות בלבד, עם 972" },
  { key: "email", label: "דוא״ל", dir: "ltr" },
  { key: "defaultWhatsappMessage", label: "הודעת פתיחה בוואטסאפ" },
  { key: "licenceEntity", label: "שם בעל הרישיון", hint: "זה השם שבו המבקרים נותנים הסכמה" },
  { key: "licenceNumber", label: "מספר רישיון", dir: "ltr" },
  { key: "licenceRegulator", label: "הגוף המפקח" },
  {
    key: "leadWhatsappTemplate",
    label: "הודעת וואטסאפ לפונה",
    hint: "נשלחת מכפתור הוואטסאפ ברשימת הפניות. {name} — שם הפונה, {agent} — שמך, {topic} — נושא הפנייה.",
  },
];

const EMPTY: Fields = {
  displayName: "", phoneE164: "", phoneDisplay: "", whatsapp: "", email: "",
  defaultWhatsappMessage: "", licenceEntity: "", licenceNumber: "", licenceRegulator: "", leadWhatsappTemplate: "",
};

/**
 * /admin/agency — the agency's details, the Owner's alone
 * (docs/superpowers/specs/2026-10-15-agency-roles-design.md, decision 3).
 * AgencyRoute admits only the Owner (and the platform operator), and
 * agency_profiles_update_owner refuses anyone else's write; a refused save
 * says so rather than looking saved.
 */
export default function AgencyProfile() {
  useSeo({ title: "פרטי הסוכנות", description: "פרטי הסוכנות", path: "/admin/agency", noIndex: true });
  const { agencyId, agencies } = useCurrentAgency();
  const { can } = useAgencyRole(agencyId);
  const editable = can("agencyProfile.edit");
  const client = useQueryClient();
  const ids = useId();
  const profile = useQuery({ queryKey: ["agency", "profile", agencyId], queryFn: () => services.agency.profile(agencyId) });
  const [draft, setDraft] = useState<Fields>(EMPTY);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (profile.data) {
      const { agencyId: _id, ...fields } = profile.data;
      setDraft(fields);
    }
  }, [profile.data]);

  const save = useMutation({
    mutationFn: (fields: Fields) => services.agency.updateProfile(agencyId, fields),
    onMutate: () => setDone(false),
    onSuccess: () => {
      setDone(true);
      void client.invalidateQueries({ queryKey: ["agency", "profile", agencyId] });
    },
  });

  const name = agencies.find((a) => a.id === agencyId)?.name ?? "";
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border/60 bg-card">
        <div className="max-w-[900px] mx-auto px-6 py-5">
          <Eyebrow>תוכן והגדרות</Eyebrow>
          <h1 className="font-heading text-2xl md:text-3xl mt-1">פרטי הסוכנות{name ? ` — ${name}` : ""}</h1>
        </div>
      </header>
      <main id="main" className="max-w-[900px] mx-auto px-6 py-8">
        {profile.isLoading ? <p className="text-muted-foreground">טוען…</p> : null}
        {profile.isError ? (
          <p role="alert" className="text-destructive">
            לא הצלחנו לטעון את פרטי הסוכנות. נסו לרענן.
          </p>
        ) : null}
        {profile.isSuccess && !profile.data ? (
          <p className="text-muted-foreground">לסוכנות הזו עדיין אין פרטים. מפעיל הפלטפורמה יוצר אותם.</p>
        ) : null}
        {profile.data ? (
          <form
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate(draft);
            }}
            className="flex flex-col gap-4"
          >
            {FIELDS.map((f) => (
              <div key={f.key} className="flex flex-col gap-1.5">
                <label htmlFor={`${ids}-${f.key}`} className="text-sm">
                  {f.label}
                </label>
                <input
                  id={`${ids}-${f.key}`}
                  dir={f.dir}
                  value={draft[f.key]}
                  readOnly={!editable}
                  onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
                  className="w-full min-h-11 px-3 border border-input rounded-sm bg-background text-[15px]"
                />
                {f.hint ? <span className="text-xs text-muted-foreground">{f.hint}</span> : null}
              </div>
            ))}
            {save.isError ? (
              <p role="alert" className="text-sm text-destructive">
                {save.error instanceof Error ? save.error.message : "השמירה נכשלה."}
              </p>
            ) : null}
            {done ? (
              <p role="status" className="text-sm">
                הפרטים נשמרו.
              </p>
            ) : null}
            {editable ? (
              <button
                type="submit"
                disabled={save.isPending}
                className="self-start min-h-11 px-5 bg-accent text-accent-foreground rounded-sm disabled:opacity-40"
              >
                שמירה
              </button>
            ) : null}
          </form>
        ) : null}
      </main>
    </div>
  );
}
