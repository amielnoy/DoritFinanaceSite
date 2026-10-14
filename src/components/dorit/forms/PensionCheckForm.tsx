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

/**
 * "בדיקת תיק פנסיוני" — name, mobile, and the address the personal
 * clearinghouse link goes to. It is the questionnaire's lead with the
 * clearinghouse opt-in already ticked, so submit-lead opens the request on the
 * board and mails the client their link (no address: Dorit sends it herself).
 * One component wherever the offer sits — /pension-check, after a calculator,
 * the year-end page — told apart by `location`.
 */

const PHONE_ERROR = "מספר נייד צריך להתחיל ב-05 ולהכיל 10 ספרות";
const EMAIL_ERROR = "כתובת המייל לא נראית תקינה";
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
  const [invalid, setInvalid] = useState<string | null>(null);
  const [sentWithEmail, setSentWithEmail] = useState(false);
  const { sending, sent, error, submit } = useSubmission("request");

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return setInvalid("נא למלא שם.");
    if (!isIsraeliMobile(phone)) return setInvalid(PHONE_ERROR);
    if (email.trim() && !isEmail(email.trim())) return setInvalid(EMAIL_ERROR);
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
        summary: `${PENSION_CHECK.name} — בקשה מהאתר (${context}).`,
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
            ? "נשלח. במייל שלך מחכה קישור אישי למסירת קוד המסלקה, עם הסבר צעד אחר צעד. דורית תחזור אליך."
            : "נשלח. דורית תחזור אליך ותשלח את הקישור האישי למסירת קוד המסלקה."}
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={send} noValidate data-track-location={location} className="rounded-[4px] border border-border p-5 md:p-6">
      {heading ? <h3 className="font-heading text-xl md:text-2xl leading-snug">{heading}</h3> : null}
      <div className={`grid gap-4 sm:grid-cols-2 ${heading ? "mt-4" : ""}`}>
        <Field label="שם *">
          <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" className={inputClass()} />
        </Field>
        <Field label="טלפון נייד *">
          <input
            type="tel"
            inputMode="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder={HUMAN_HANDOFF.phonePlaceholder}
            autoComplete="tel"
            aria-invalid={invalid === PHONE_ERROR}
            className={inputClass()}
          />
        </Field>
        <Field label="אימייל — לשם נשלח הקישור האישי (לא חובה)" className="sm:col-span-2">
          <input
            type="email"
            dir="ltr"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            aria-invalid={invalid === EMAIL_ERROR}
            className={inputClass("text-left")}
          />
        </Field>
      </div>
      {invalid || error ? (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {invalid || error}
        </p>
      ) : null}
      <CtaButton type="submit" disabled={sending} className="mt-5 max-sm:w-full">
        {sending ? <Loader2 size={18} className="animate-spin" aria-hidden="true" /> : null}
        ל{PENSION_CHECK.name}
      </CtaButton>
      <p className="mt-3 text-sm text-muted-foreground">
        הפרטים משמשים לחזרה אליך ולבדיקה בלבד.{" "}
        {/* A plain link: the form also sits where there is no router (a calculator rendered alone). */}
        <a href="/privacy" className="underline underline-offset-4">
          מדיניות הפרטיות
        </a>
      </p>
    </form>
  );
}
