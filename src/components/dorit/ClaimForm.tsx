import React, { useState } from "react";
import { Upload, X, FileText, Loader2, Check, AlertTriangle } from "lucide-react";
import { base44 } from "@/api/base44Client";

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

export default function ClaimForm() {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [claimType, setClaimType] = useState("");
  const [eventDate, setEventDate] = useState("");
  const [policyNumber, setPolicyNumber] = useState("");
  const [description, setDescription] = useState("");
  const [docs, setDocs] = useState<UploadedDoc[]>([]);
  const [uploading, setUploading] = useState(false);
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const { file_url } = await base44.integrations.Core.UploadFile({ file });
        setDocs((d) => [...d, { name: file.name, url: file_url }]);
      }
    } catch (e) {
      setError("העלאת מסמך נכשלה. ניתן לנסות שוב.");
    } finally {
      setUploading(false);
    }
  };

  const removeDoc = (idx: number) => {
    setDocs((d) => d.filter((_, i) => i !== idx));
  };

  const submit = async () => {
    if (!name || !phone) {
      setError("נדרשים שם וטלפון.");
      return;
    }
    setSending(true);
    setError("");
    try {
      await base44.functions.invoke("submitClaim", {
        name,
        phone,
        email,
        claimType,
        eventDate,
        policyNumber,
        description,
        documents: docs.map((d) => d.url),
      });
      setDone(true);
    } catch (e) {
      setError("שליחת הדיווח נכשלה. ניתן לשלוח מייל ישירות ל-dorit@govari-fin.co.il או לנסות שוב.");
    } finally {
      setSending(false);
    }
  };

  if (done) {
    return (
      <div className="bg-card border border-border/60 p-10 md:p-14 text-center">
        <div className="w-16 h-16 mx-auto rounded-full border border-[#C4A484] flex items-center justify-center mb-8">
          <Check size={28} className="text-[#C4A484]" />
        </div>
        <h3 className="font-heading text-3xl md:text-4xl">הדיווח התקבל</h3>
        <p className="mt-6 text-foreground/70 leading-relaxed max-w-md mx-auto">
          קיבלתי את דיווח האירוע והמסמכים. אחזור אליכם אישית בהקדם האפשרי
          להמשך טיפול התביעה. במקרה דחוף — ניתן לחייג גם עכשיו.
        </p>
        <button
          onClick={() => {
            setDone(false);
            setName(""); setPhone(""); setEmail(""); setClaimType("");
            setEventDate(""); setPolicyNumber(""); setDescription(""); setDocs([]);
          }}
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
        <AlertTriangle size={22} className="text-[#C4A484] mt-0.5 shrink-0" />
        <p className="text-sm text-foreground/75 leading-relaxed">
          במקרה חירום רפואי או מיידי — חייגו עכשיו. טופס זה מיועד לדיווח מתועד
          ומסודר של אירוע ביטוחי, עם צירוף מסמכים.
        </p>
      </div>

      <div className="space-y-5">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="שם מלא *">
            <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
          </Field>
          <Field label="טלפון *">
            <input value={phone} onChange={(e) => setPhone(e.target.value)} className={inputCls} dir="ltr" />
          </Field>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="אימייל (לא חובה)">
            <input value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} dir="ltr" />
          </Field>
          <Field label="מספר פוליסה (לא חובה)">
            <input value={policyNumber} onChange={(e) => setPolicyNumber(e.target.value)} className={inputCls} />
          </Field>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="סוג אירוע">
            <select value={claimType} onChange={(e) => setClaimType(e.target.value)} className={inputCls}>
              <option value="">בחירת סוג…</option>
              {CLAIM_TYPES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </Field>
          <Field label="תאריך האירוע">
            <input type="date" value={eventDate} onChange={(e) => setEventDate(e.target.value)} className={inputCls} dir="ltr" />
          </Field>
        </div>

        <Field label="תיאור האירוע">
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
            placeholder="תארו את האירוע: מה, מתי, איפה, מי מעורב, וכל פרט רלוונטי."
            className={`${inputCls} resize-none`}
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
          <button
            onClick={submit}
            disabled={sending || uploading || !name || !phone}
            className="inline-flex items-center gap-2 px-7 py-3.5 bg-[#C4A484] text-primary font-medium hover:bg-[#b8916f] disabled:opacity-40 disabled:hover:bg-[#C4A484] transition-colors"
          >
            {sending && <Loader2 size={16} className="animate-spin" />}
            {sending ? "שולח…" : "שליחת דיווח"}
          </button>
        </div>
        {error && <p className="text-sm text-destructive text-right">{error}</p>}
      </div>
    </div>
  );
}

const inputCls =
  "w-full bg-background border border-border px-4 py-3 text-base focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/40 transition-colors";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  // The control is passed in as a child, so generate an id here and clone it on.
  // Without it the <label> is associated with nothing and screen readers
  // announce the field as unlabelled (axe: label / select-name, critical).
  const id = React.useId();
  const control = React.isValidElement(children)
    ? React.cloneElement(children as React.ReactElement<{ id?: string }>, { id })
    : children;

  return (
    <div>
      <label
        htmlFor={id}
        className="block text-xs tracking-[0.15em] uppercase text-muted-foreground mb-2"
      >
        {label}
      </label>
      {control}
    </div>
  );
}