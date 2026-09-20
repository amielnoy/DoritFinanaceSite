import React, { useState } from "react";
import { services } from "@/services";
import { useSubmission } from "@/hooks/useSubmission";
import { CONTACT } from "@/config/contact";
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

export default function QuickContact({ embedded = false }: { embedded?: boolean }) {
  const [form, setForm] = useState<QuickContactForm>({ name: "", phone: "", email: "", message: "" });
  const { sending: busy, sent, error, submit, reset } = useSubmission("message");

  const valid = form.name.trim() && form.phone.trim();

  const send = async () => {
    if (!valid) return;
    const ok = await submit(() =>
      services.leads.submitLead({
        name: form.name,
        phone: form.phone,
        email: form.email,
        source: "quick",
        message: form.message,
      })
    );
    if (ok) setForm({ name: "", phone: "", email: "", message: "" });
  };

  // The form itself. On the home page it sits inside "נתחיל בשיחה קצרה" as
  // the secondary card, so it renders alone and at full width.
  const formCard = (
    // The id travels with the form. Embedded on the home page the <section>
    // below is not rendered, and #quick-contact is what the anchor links, the
    // accessibility scans and the form tests all address.
    <div id={embedded ? "quick-contact" : undefined} className={embedded ? "w-full" : "lg:col-span-7"}>
          {sent ? (
            <div className="bg-card border border-border p-10 text-center">
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
            <div className="bg-card border border-border p-8 md:p-10">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <Field label="שם מלא *">
                  <input
                    id="qc-name"
                    value={form.name}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                    className={inputClass()}
                  />
                </Field>
                <Field label="טלפון *">
                  <input
                    id="qc-phone"
                    type="tel"
                    value={form.phone}
                    onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                    placeholder={CONTACT.phoneDisplay}
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

              {error && <p className="mt-5 text-sm text-destructive">{error}</p>}

              <div className="mt-7 flex justify-end">
                <CtaButton onClick={send} disabled={!valid || busy}>
                  {busy ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                  שליחת הודעה
                </CtaButton>
              </div>
            </div>
          )}
        </div>
  );

  if (embedded) return formCard;

  return (
    <section id="quick-contact" className="relative py-24 md:py-32 bg-secondary/60 text-foreground border-t border-border">
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
        {formCard}
      </div>
    </section>
  );
}