import React, { useState } from "react";
import { Upload, X, FileText, Loader2, Check, AlertTriangle } from "lucide-react";
import { services } from "@/services";
import { useSubmission } from "@/hooks/useSubmission";
import { leadEvents } from "@/lib/analytics";
import { getAttribution } from "@/lib/attribution";
import { CtaButton } from "@/components/dorit/primitives/Cta";
import { Field, inputClass } from "@/components/dorit/primitives/Field";
import { isContactPhone } from "@/lib/phone";
import {
  CLAIM_DOCUMENT_ACCEPT,
  CLAIM_DOCUMENT_MAX_FILES,
  claimDocumentProblem,
} from "@/config/claimDocuments";
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

/**
 * A document the visitor picked. It stays in the browser until they send the
 * report: picking used to upload at once, so insurance documents sat in the
 * bucket for anyone who picked a file and walked away (D-02, manual test
 * 2026-10-14). `ref` is set once it is uploaded, so a send that fails after
 * the uploads does not upload them again on the retry.
 */
interface PickedDoc {
  file: File;
  ref?: string;
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
  const [docs, setDocs] = useState<PickedDoc[]>([]);
  const { sending, sent: done, error: submitError, submit: submitReport, reset } = useSubmission("report");
  /** While the send uploads the documents: how many of how many. */
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  /**
   * File problems — one refused when picked, or an upload that failed on send —
   * named in their own words rather than as the generic "could not send".
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
  /** A file is being dragged over the drop zone. */
  const [dragging, setDragging] = useState(false);

  const set = (key: keyof ClaimFields) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    if (key === "phone") setPhoneError("");
    setForm((f) => ({ ...f, [key]: e.target.value }));
  };

  const { name, phone, email, claimType, eventDate, policyNumber, description } = form;
  const t = useT("claims");
  const locale = useLocale();

  /** Checks each file against the bucket's limits and keeps it; nothing leaves the browser here. */
  const handleFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const problems: string[] = [];
    const accepted: PickedDoc[] = [];
    for (const file of Array.from(files)) {
      const problem = claimDocumentProblem(file);
      if (problem) problems.push(t(problem, { name: file.name }));
      else accepted.push({ file });
    }
    const room = CLAIM_DOCUMENT_MAX_FILES - docs.length;
    if (accepted.length > room) problems.push(t("form.fileCount", { max: CLAIM_DOCUMENT_MAX_FILES }));
    setDocs((d) => [...d, ...accepted.slice(0, Math.max(room, 0))]);
    setUploadError(problems.join(" "));
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
      setPhoneError(t("form.phoneInvalid"));
      return;
    }
    setUploadError("");
    // The uploads run inside the submission, so its double-click guard and
    // its "sending" state cover them too.
    const ok = await submitReport(async () => {
      const refs: string[] = [];
      try {
        for (const [i, doc] of docs.entries()) {
          setProgress({ done: i, total: docs.length });
          const ref = doc.ref ?? (await services.claimDocuments.upload(doc.file)).url;
          refs.push(ref);
          if (!doc.ref) setDocs((d) => d.map((x) => (x.file === doc.file ? { ...x, ref } : x)));
        }
      } catch (e) {
        setUploadError(t("form.uploadError"));
        throw e;
      } finally {
        setProgress(null);
      }
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
        documents: refs,
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
          {/* Dropped files take the same checks as picked ones; the input stays reachable by keyboard (review 2026-10-15). */}
          <label
            className={`flex flex-col items-center justify-center gap-2 p-8 border border-dashed hover:border-accent transition-colors cursor-pointer text-center focus-within:ring-2 focus-within:ring-ring ${dragging ? "border-accent bg-accent/5" : "border-border"}`}
            onDragOver={(e) => {
              e.preventDefault();
              if (!sending) setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              if (!sending) handleFiles(e.dataTransfer.files);
            }}
          >
            <Upload size={22} className="text-accent" />
            <span className="text-sm text-foreground/70">
              {t("form.pick")}
            </span>
            <input
              type="file"
              multiple
              accept={CLAIM_DOCUMENT_ACCEPT}
              className="sr-only"
              onChange={(e) => {
                handleFiles(e.target.files);
                // The same file can be picked again after it is removed.
                e.target.value = "";
              }}
              disabled={sending}
            />
          </label>

          {docs.length > 0 && (
            <ul className="mt-4 space-y-2">
              {docs.map((d, i) => (
                <li key={i} className="flex items-center justify-between gap-3 p-3 bg-secondary/40 border border-border/60">
                  <span className="flex items-center gap-2 text-sm min-w-0">
                    <FileText size={16} className="text-accent shrink-0" />
                    <span className="truncate">{d.file.name}</span>
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
          <CtaButton onClick={submit} disabled={sending || !valid}>
            {sending && <Loader2 size={16} className="animate-spin" />}
            {progress
              ? t("form.uploadingCount", { done: progress.done + 1, total: progress.total })
              : sending
                ? t("form.sending")
                : t("form.send")}
          </CtaButton>
        </div>
        {/* Inserted with its message: an alert is announced as it appears. */}
        {error ? <p role="alert" className="text-sm text-destructive text-start">{error}</p> : null}
      </div>
    </div>
  );
}
