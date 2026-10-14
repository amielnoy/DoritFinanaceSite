import React, { useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { CtaButton } from "@/components/dorit/primitives/Cta";
import { Field, inputClass } from "@/components/dorit/primitives/Field";
import { HUMAN_HANDOFF } from "@/config/compliance";
import { PENSION_CHECK } from "@/config/offers";
import { useSubmission } from "@/hooks/useSubmission";
import { leadEvents } from "@/lib/analytics";
import { getAttribution } from "@/lib/attribution";
import { isIsraeliMobile } from "@/lib/phone";
import { services } from "@/services";
import { useLocale, useT } from "@/i18n/LocaleContext";
import { filledInNote } from "@/i18n/locales";

/**
 * "בדיקת תיק פנסיוני" — name, mobile, and the address the personal
 * clearinghouse link goes to. It is the questionnaire's lead with the
 * clearinghouse opt-in already ticked, so submit-lead opens the request on the
 * board and mails the client their link (no address: Dorit sends it herself).
 * One component wherever the offer sits — /pension-check, after a calculator,
 * the year-end page — told apart by `location`.
 */

type Problem = "form.errorName" | "form.errorPhone" | "form.errorEmail";

const isEmail = (v: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v);

export interface PensionCheckFormProps {
  /** Where the form sits, for GA4: "page", "calculator_check", "year_end" — never another box's location. */
  location: string;
  /** Said in the lead's summary, so Dorit knows what brought them. */
  context: string;
  /** A heading inside the form; omitted where the page already has one. */
  heading?: string;
}

export default function PensionCheckForm({ location, context, heading }: PensionCheckFormProps) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [invalid, setInvalid] = useState<Problem | null>(null);
  const t = useT("pension");
  const locale = useLocale();
  const [sentWithEmail, setSentWithEmail] = useState(false);
  const { sending, sent, error, submit } = useSubmission("request");

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return setInvalid("form.errorName");
    if (!isIsraeliMobile(phone)) return setInvalid("form.errorPhone");
    if (email.trim() && !isEmail(email.trim())) return setInvalid("form.errorEmail");
    setInvalid(null);
    // Read now, not after the await: the thank-you renders the moment the save lands.
    setSentWithEmail(Boolean(email.trim()));
    const attribution = getAttribution();
    const ok = await submit(async () => {
      const receipt = await services.leads.submitInterview({
        name: name.trim(),
        phone: phone.trim(),
        email: email.trim() || undefined,
        track: "pension",
        meetingTopic: PENSION_CHECK.name,
        // Hebrew whatever the page's language — Dorit reads it — with a note when it was not.
        summary: `${PENSION_CHECK.name} — בקשה מהאתר (${[context, filledInNote(locale)].filter(Boolean).join(" · ")}).`,
        profile: { clearinghouse: "מעוניין/ת" },
        stage: "complete",
        channel: attribution?.channel,
        campaign: attribution?.campaign ?? undefined,
        landingPath: window.location.pathname,
      });
      if (!receipt?.ok) throw new Error("rejected");
      return receipt;
    });
    // A lead once it is saved — never on the click.
    if (ok) leadEvents.pensionCheckSubmitted(location);
  };

  if (sent) {
    return (
      <div role="status" className="flex items-start gap-3 rounded-[4px] border border-highlight p-5">
        <Check size={20} className="mt-1 shrink-0 text-highlight" aria-hidden="true" />
        <p className="m-0 text-[17px] leading-relaxed">
          {sentWithEmail
            ? t("form.sentWithEmail")
            : t("form.sentNoEmail")}
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={send} noValidate data-track-location={location} className="rounded-[4px] border border-border p-5 md:p-6">
      {heading ? <h3 className="font-heading text-xl md:text-2xl leading-snug">{heading}</h3> : null}
      <div className={`grid gap-4 sm:grid-cols-2 ${heading ? "mt-4" : ""}`}>
        <Field label={t("form.name")}>
          <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" className={inputClass()} />
        </Field>
        <Field label={t("form.phone")}>
          <input
            type="tel"
            inputMode="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder={HUMAN_HANDOFF.phonePlaceholder}
            autoComplete="tel"
            aria-invalid={invalid === "form.errorPhone"}
            className={inputClass()}
          />
        </Field>
        <Field label={t("form.email")} className="sm:col-span-2">
          <input
            type="email"
            dir="ltr"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            aria-invalid={invalid === "form.errorEmail"}
            className={inputClass("text-left")}
          />
        </Field>
      </div>
      {invalid || error ? (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {invalid ? t(invalid) : error}
        </p>
      ) : null}
      <CtaButton type="submit" disabled={sending} className="mt-5 max-sm:w-full">
        {sending ? <Loader2 size={18} className="animate-spin" aria-hidden="true" /> : null}
        {t("form.submit")}
      </CtaButton>
      <p className="mt-3 text-sm text-muted-foreground">
        {t("form.privacy")}{" "}
        {/* A plain link: the form also sits where there is no router (a calculator rendered alone). */}
        <a href="/privacy" className="underline underline-offset-4">
          {t("form.privacyLink")}
        </a>
      </p>
    </form>
  );
}
