import React, { useState } from "react";
import { services } from "@/services";
import { useSubmission } from "@/hooks/useSubmission";
import { leadEvents } from "@/lib/analytics";
import { CONTACT } from "@/config/contact";
import { HUMAN_HANDOFF } from "@/config/compliance";
import { CtaButton } from "@/components/dorit/primitives/Cta";
import { Field, inputClass } from "@/components/dorit/primitives/Field";
import { Send, Loader2, Check, Mail, MessageCircle } from "lucide-react";
import Eyebrow from "@/components/dorit/primitives/Eyebrow";

interface QuickContactForm {
  name: string;
  phone: string;
  email: string;
  message: string;
}

/** What's missing, named rather than left to a greyed-out button to imply. */
function missingFieldsMessage(form: QuickContactForm): string | null {
  const missingName = !form.name.trim();
  const missingPhone = !form.phone.trim();
  if (missingName && missingPhone) return "נא למלא שם וטלפון.";
  if (missingName) return "נא למלא שם מלא.";
  if (missingPhone) return "נא למלא מספר טלפון.";
  return null;
}

export default function QuickContact({ embedded = false }: { embedded?: boolean }) {
  const [form, setForm] = useState<QuickContactForm>({ name: "", phone: "", email: "", message: "" });
  const [validationError, setValidationError] = useState<string | null>(null);
  const { sending: busy, sent, error, submit, reset } = useSubmission("message");

  const send = async () => {
    const missing = missingFieldsMessage(form);
    if (missing) {
      setValidationError(missing);
      return;
    }
    setValidationError(null);
    const ok = await submit(() =>
      services.leads.submitLead({
        name: form.name,
        phone: form.phone,
        email: form.email,
        source: "quick",
        message: form.message,
      })
    );
    if (ok) {
      // A lead once it is saved — never on the click.
      leadEvents.formSubmitted();
      setForm({ name: "", phone: "", email: "", message: "" });
    }
  };

  // The form itself, drawn straight onto the page ground — no card around it.
  const formBody = (
    <div className={embedded ? "min-w-0" : "lg:col-span-7"}>
          {sent ? (
            <div className="border-y border-border py-14 px-6 text-center">
              <div className="w-14 h-14 mx-auto rounded-full border border-highlight flex items-center justify-center mb-6">
                <Check size={26} className="text-highlight" />
              </div>
              <p className="font-heading text-2xl">ההודעה נשלחה. תודה.</p>
              <p className="mt-4 text-muted-foreground">
                קיבלתי את פרטיכם ואחזור אליכם בהקדם האפשרי.
              </p>
              <button
                onClick={reset}
                className="mt-8 text-sm tracking-wide underline underline-offset-4 hover:text-accent transition-colors"
              >
                שליחת הודעה נוספת
              </button>
            </div>
          ) : (
            <div>
              <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,220px),1fr))] gap-5">
                <Field label="שם מלא *">
                  <input
                    id="qc-name"
                    value={form.name}
                    onChange={(e) => {
                      setForm((f) => ({ ...f, name: e.target.value }));
                      setValidationError(null);
                    }}
                    autoComplete="name"
                    className={inputClass()}
                  />
                </Field>
                <Field label="טלפון *">
                  <input
                    id="qc-phone"
                    type="tel"
                    inputMode="tel"
                    value={form.phone}
                    onChange={(e) => {
                      setForm((f) => ({ ...f, phone: e.target.value }));
                      setValidationError(null);
                    }}
                    placeholder={HUMAN_HANDOFF.phonePlaceholder}
                    autoComplete="tel"
                    className={inputClass()}
                  />
                </Field>
              </div>
              <Field label="אימייל (לא חובה)" className="mt-5">
                <input
                  id="qc-email"
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                  placeholder="you@example.com"
                  autoComplete="email"
                  className={inputClass()}
                />
              </Field>
              <Field label="הודעה (לא חובה)" className="mt-5">
                <textarea
                  id="qc-message"
                  value={form.message}
                  onChange={(e) => setForm((f) => ({ ...f, message: e.target.value }))}
                  rows={3}
                  placeholder="במה מדובר?"
                  className={inputClass("resize-none")}
                />
              </Field>

              {(validationError || error) && (
                <p role="alert" className="mt-5 text-sm text-destructive">
                  {validationError || error}
                </p>
              )}

              <div className="mt-7 flex justify-end">
                <CtaButton onClick={send} disabled={busy}>
                  {busy ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                  שליחת הודעה
                </CtaButton>
              </div>
            </div>
          )}
        </div>
  );

  // Embedded on the home page the <section> below is not rendered, so the id
  // lives on this wrapper: #quick-contact is what the anchor links, the
  // accessibility scans and the form tests all address. Heading and form sit
  // side by side, the form directly on the ground.
  if (embedded) {
    return (
      <div
        id="quick-contact"
        className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,340px),1fr))] gap-x-16 gap-y-8 border-t border-border pt-14 mt-4"
      >
        <h3 className="font-heading font-normal text-[clamp(28px,3vw,36px)] leading-[1.2]">
          מעדיפים להשאיר פרטים?
        </h3>
        {formBody}
      </div>
    );
  }

  return (
    <section id="quick-contact" className="relative py-24 md:py-32 bg-secondary text-foreground border-t border-border">
      <div className="max-w-[1400px] mx-auto px-6 md:px-10 grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-16 items-center">
        <div className="lg:col-span-5">
          <Eyebrow>
            קו ישיר
          </Eyebrow>
          <h2 className="font-heading text-5xl md:text-6xl mt-5 leading-tight">
            השאירו פרטים,
            <br />
            אחזור אליכם היום
          </h2>
          <p className="mt-8 text-muted-foreground max-w-md leading-relaxed">
            שלוש שדות בלבד — וההודעה מגיעה ישירות לתיבת הדוא״ל שלי. אחזור אליכם
            אישית ובמהירות האפשרית.
          </p>
          <div className="mt-8 flex items-center gap-3 text-muted-foreground">
            <Mail size={16} className="text-accent" />
            <a href={`mailto:${CONTACT.email}`} dir="ltr" className="hover:text-accent transition-colors">{CONTACT.email}</a>
          </div>
          <a
            href={`https://wa.me/${CONTACT.whatsapp}`}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-4 inline-flex items-center gap-3 text-muted-foreground hover:text-accent transition-colors"
          >
            <MessageCircle size={16} className="text-accent" />
            <span dir="ltr">WhatsApp</span>
          </a>
        </div>
        {formBody}
      </div>
    </section>
  );
}