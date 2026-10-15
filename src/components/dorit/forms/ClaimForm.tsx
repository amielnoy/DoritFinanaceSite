import React, { useState } from "react";
import { Upload, X, FileText, Loader2, Check, AlertTriangle } from "lucide-react";
import { services } from "@/services";
import { useSubmission } from "@/hooks/useSubmission";
import { leadEvents } from "@/lib/analytics";
import { getAttribution } from "@/lib/attribution";
import { CtaButton } from "@/components/dorit/primitives/Cta";
import { Field, inputClass } from "@/components/dorit/primitives/Field";
import { isContactPhone } from "@/lib/phone";
import { useLocale, useT } from "@/i18n/LocaleContext";
import { withFilledInNote } from "@/i18n/locales";
import type { KeyOf } from "@/i18n/resources";

const CLAIM_TYPES = [
  "ביטוח בריאות משלים",
  "ביטוח חיים / מקרה מוות",
  "אובדן כושר עבודה",
  "רכוש / דירה / רכב",
  "אחר",
];

interface UploadedDoc {
  name: string;
  url: string;
}

interface ClaimFields {
  name: string;
  phone: string;
  email: string;
  claimType: string;
  eventDate: string;
  policyNumber: string;
  description: string;
}

/** The same words as the questionnaire's claim branch, which checks the same thing. */
const PHONE_ERROR = "נא להזין מספר טלפון ישראלי — מתחיל ב-0, 9–10 ספרות.";

const EMPTY: ClaimFields = {
  name: "",
  phone: "",
  email: "",
  claimType: "",
  eventDate: "",
  policyNumber: "",
  description: "",
};

export default function ClaimForm() {
  const [form, setForm] = useState<ClaimFields>(EMPTY);
  const [docs, setDocs] = useState<UploadedDoc[]>([]);
  const { sending, sent: done, error: submitError, submit: submitReport, reset } = useSubmission("report");
  const [uploading, setUploading] = useState(false);
  /**
   * Upload failures are the form's own state, separate from the submission
   * state machine: a document that failed to upload must not put the whole
   * form into "error", because the visitor can simply try the file again.
   *
   * This used to call a `setError` that did not exist — `error` comes from
   * `useSubmission`, which exposes no setter — so a failed upload threw a
   * ReferenceError instead of showing a message. (Baselined as TS2304.)
   */
  const [uploadError, setUploadError] = useState("");
  /**
   * A phone Dorit could not call back. Checked on send, as `submit-claim`
   * checks it: "abc" or "123" used to file a claim nobody could answer (D-01,
   * manual test 2026-10-14).
   */
  const [phoneError, setPhoneError] = useState("");
  const error = uploadError || submitError;

  const set = (key: keyof ClaimFields) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    if (key === "phone") setPhoneError("");
    setForm((f) => ({ ...f, [key]: e.target.value }));
  };

  const { name, phone, email, claimType, eventDate, policyNumber, description } = form;
  const t = useT("claims");
  const locale = useLocale();

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    setUploadError("");
    try {
      for (const file of Array.from(files)) {
        const { url: file_url } = await services.claimDocuments.upload(file);
        setDocs((d) => [...d, { name: file.name, url: file_url }]);
      }
    } catch {
      setUploadError(t("form.uploadError"));
    } finally {
      setUploading(false);
    }
  };

  const startAnother = () => {
    reset();
    setForm(EMPTY);
    setDocs([]);
    setUploadError("");
    setPhoneError("");
  };

  const removeDoc = (idx: number) => {
    setDocs((d) => d.filter((_, i) => i !== idx));
  };

  const valid = !!name.trim() && !!phone.trim();

  const submit = async () => {
    if (!valid) return;
    if (!isContactPhone(phone)) {
      setPhoneError(PHONE_ERROR);
      return;
    }
    const ok = await submitReport(() => {
      const attribution = getAttribution();
      return services.leads.submitClaim({
        name,
        phone,
        email,
        claimType,
        eventDate,
        policyNumber,
        // The visitor's words as written, and — from the English or French
        // site — a Hebrew note for Dorit saying so.
        description: withFilledInNote(description, locale),
        documents: docs.map((d) => d.url),
        channel: attribution?.channel,
        campaign: attribution?.campaign ?? undefined,
        landingPath: window.location.pathname,
      });
    });
    if (ok) leadEvents.claimSubmitted();
  };

  if (done) {
    return (
      <div className="bg-card border border-border/60 p-10 md:p-14 text-center">
        <div className="w-16 h-16 mx-auto rounded-full border border-highlight flex items-center justify-center mb-8">
          <Check size={28} className="text-highlight" />
        </div>
        <h3 className="font-heading text-3xl md:text-4xl">{t("form.sentTitle")}</h3>
        <p className="mt-6 text-foreground/70 leading-relaxed max-w-md mx-auto">
          {t("form.sentText")}
        </p>
        <button
          onClick={startAnother}
          className="mt-8 text-sm tracking-wide underline underline-offset-4 hover:text-accent transition-colors"
        >
          {t("form.again")}
        </button>
      </div>
    );
  }

  return (
    <div className="bg-card border border-border/60 p-8 md:p-12">
      <div className="flex items-start gap-4 mb-8 p-5 bg-secondary/50 border border-border/60">
        <AlertTriangle size={22} className="text-highlight mt-0.5 shrink-0" />
        <p className="text-sm text-foreground/75 leading-relaxed">
          {t("form.emergency")}
        </p>
      </div>

      <div className="space-y-5">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label={t("form.name")}>
            <input value={name} onChange={set("name")} className={inputClass()} autoComplete="name" aria-required="true" />
          </Field>
          <Field label={t("form.phone")}>
            <input
              value={phone}
              onChange={set("phone")}
              className={inputClass()}
              dir="ltr"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              aria-required="true"
              aria-invalid={phoneError ? true : undefined}
              aria-describedby={phoneError ? "claim-phone-error" : undefined}
            />
          </Field>
        </div>
        {phoneError && (
          <p id="claim-phone-error" role="alert" className="text-sm text-destructive text-right -mt-2">
            {phoneError}
          </p>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label={t("form.email")}>
            <input
              value={email}
              onChange={set("email")}
              className={inputClass()}
              dir="ltr"
              type="email"
              autoComplete="email"
            />
          </Field>
          <Field label={t("form.policy")}>
            <input value={policyNumber} onChange={set("policyNumber")} className={inputClass()} />
          </Field>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label={t("form.type")}>
            <select value={claimType} onChange={set("claimType")} className={inputClass()}>
              <option value="">{t("form.choose")}</option>
              {/* The value Dorit and the backend read stays Hebrew; the label is the page's language. */}
              {CLAIM_TYPES.map((type, i) => (
                <option key={type} value={type}>{t(`form.type${i + 1}` as KeyOf<"claims">)}</option>
              ))}
            </select>
          </Field>
          <Field label={t("form.date")}>
            <input type="date" value={eventDate} onChange={set("eventDate")} className={inputClass()} dir="ltr" />
          </Field>
        </div>

        <Field label={t("form.description")}>
          <textarea
            value={description}
            onChange={set("description")}
            rows={4}
            placeholder={t("form.descriptionPlaceholder")}
            className={inputClass("resize-none")}
          />
        </Field>

        <div>
          <span className="block text-xs tracking-[0.15em] uppercase text-muted-foreground mb-2">
            {t("form.attach")}
          </span>
          <label className="flex flex-col items-center justify-center gap-2 p-8 border border-dashed border-border hover:border-accent transition-colors cursor-pointer text-center">
            <Upload size={22} className="text-accent" />
            <span className="text-sm text-foreground/70">
              {uploading ? t("form.uploading") : t("form.pick")}
            </span>
            <input
              type="file"
              multiple
              className="hidden"
              onChange={(e) => handleFiles(e.target.files)}
              disabled={uploading || sending}
            />
          </label>

          {docs.length > 0 && (
            <ul className="mt-4 space-y-2">
              {docs.map((d, i) => (
                <li key={i} className="flex items-center justify-between gap-3 p-3 bg-secondary/40 border border-border/60">
                  <span className="flex items-center gap-2 text-sm min-w-0">
                    <FileText size={16} className="text-accent shrink-0" />
                    <span className="truncate">{d.name}</span>
                  </span>
                  <button
                    onClick={() => removeDoc(i)}
                    disabled={sending}
                    className="text-muted-foreground hover:text-destructive transition-colors shrink-0"
                    aria-label={t("form.remove")}
                  >
                    <X size={16} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex items-center justify-between pt-4 border-t border-border/60">
          <p className="text-xs text-muted-foreground">{t("form.secure")}</p>
          <CtaButton onClick={submit} disabled={sending || uploading || !valid}>
            {sending && <Loader2 size={16} className="animate-spin" />}
            {sending ? t("form.sending") : t("form.send")}
          </CtaButton>
        </div>
        {error && <p className="text-sm text-destructive text-start">{error}</p>}
      </div>
    </div>
  );
}
