import React, { useState } from "react";
import { Upload, X, FileText, Loader2, Check, AlertTriangle } from "lucide-react";
import { services } from "@/services";
import { useSubmission } from "@/hooks/useSubmission";
import { CtaButton } from "@/components/dorit/primitives/Cta";
import { Field, inputClass } from "@/components/dorit/primitives/Field";

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
  const error = uploadError || submitError;

  const set = (key: keyof ClaimFields) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const { name, phone, email, claimType, eventDate, policyNumber, description } = form;

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    setUploadError("");
    try {
      for (const file of Array.from(files)) {
        const { url: file_url } = await services.uploads.upload(file);
        setDocs((d) => [...d, { name: file.name, url: file_url }]);
      }
    } catch {
      setUploadError("העלאת מסמך נכשלה. ניתן לנסות שוב.");
    } finally {
      setUploading(false);
    }
  };

  const startAnother = () => {
    reset();
    setForm(EMPTY);
    setDocs([]);
    setUploadError("");
  };

  const removeDoc = (idx: number) => {
    setDocs((d) => d.filter((_, i) => i !== idx));
  };

  const valid = !!name.trim() && !!phone.trim();

  const submit = async () => {
    if (!valid) return;
    await submitReport(() =>
      services.leads.submitClaim({
        name,
        phone,
        email,
        claimType,
        eventDate,
        policyNumber,
        description,
        documents: docs.map((d) => d.url),
      })
    );
  };

  if (done) {
    return (
      <div className="bg-card border border-border/60 p-10 md:p-14 text-center">
        <div className="w-16 h-16 mx-auto rounded-full border border-highlight flex items-center justify-center mb-8">
          <Check size={28} className="text-highlight" />
        </div>
        <h3 className="font-heading text-3xl md:text-4xl">הדיווח התקבל</h3>
        <p className="mt-6 text-foreground/70 leading-relaxed max-w-md mx-auto">
          קיבלתי את דיווח האירוע והמסמכים. אחזור אליכם אישית בהקדם האפשרי
          להמשך טיפול התביעה. במקרה דחוף — ניתן לחייג גם עכשיו.
        </p>
        <button
          onClick={startAnother}
          className="mt-8 text-sm tracking-wide underline underline-offset-4 hover:text-accent transition-colors"
        >
          שליחת דיווח נוסף
        </button>
      </div>
    );
  }

  return (
    <div className="bg-card border border-border/60 p-8 md:p-12">
      <div className="flex items-start gap-4 mb-8 p-5 bg-secondary/50 border border-border/60">
        <AlertTriangle size={22} className="text-highlight mt-0.5 shrink-0" />
        <p className="text-sm text-foreground/75 leading-relaxed">
          במקרה חירום רפואי או מיידי — חייגו עכשיו. טופס זה מיועד לדיווח מתועד
          ומסודר של אירוע ביטוחי, עם צירוף מסמכים.
        </p>
      </div>

      <div className="space-y-5">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="שם מלא *">
            <input value={name} onChange={set("name")} className={inputClass()} />
          </Field>
          <Field label="טלפון *">
            <input value={phone} onChange={set("phone")} className={inputClass()} dir="ltr" />
          </Field>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="אימייל (לא חובה)">
            <input value={email} onChange={set("email")} className={inputClass()} dir="ltr" />
          </Field>
          <Field label="מספר פוליסה (לא חובה)">
            <input value={policyNumber} onChange={set("policyNumber")} className={inputClass()} />
          </Field>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="סוג אירוע">
            <select value={claimType} onChange={set("claimType")} className={inputClass()}>
              <option value="">בחירת סוג…</option>
              {CLAIM_TYPES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </Field>
          <Field label="תאריך האירוע">
            <input type="date" value={eventDate} onChange={set("eventDate")} className={inputClass()} dir="ltr" />
          </Field>
        </div>

        <Field label="תיאור האירוע">
          <textarea
            value={description}
            onChange={set("description")}
            rows={4}
            placeholder="תארו את האירוע: מה, מתי, איפה, מי מעורב, וכל פרט רלוונטי."
            className={inputClass("resize-none")}
          />
        </Field>

        <div>
          <span className="block text-xs tracking-[0.15em] uppercase text-muted-foreground mb-2">
            צירוף מסמכים (תעודות, דוחות, קבלות, תמונות)
          </span>
          <label className="flex flex-col items-center justify-center gap-2 p-8 border border-dashed border-border hover:border-accent transition-colors cursor-pointer text-center">
            <Upload size={22} className="text-accent" />
            <span className="text-sm text-foreground/70">
              {uploading ? "מעלה מסמכים…" : "לחצו לבחירת קבצים, או גררו לכאן"}
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
                    aria-label="הסרה"
                  >
                    <X size={16} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex items-center justify-between pt-4 border-t border-border/60">
          <p className="text-xs text-muted-foreground">המסמכים מועלים בצורה מאובטחת וזמינים לדורית בלבד.</p>
          <CtaButton onClick={submit} disabled={sending || uploading || !valid}>
            {sending && <Loader2 size={16} className="animate-spin" />}
            {sending ? "שולח…" : "שליחת דיווח"}
          </CtaButton>
        </div>
        {error && <p className="text-sm text-destructive text-right">{error}</p>}
      </div>
    </div>
  );
}
