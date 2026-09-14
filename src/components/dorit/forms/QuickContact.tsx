import React, { useState } from "react";
import { services } from "@/services";
import { useSubmission } from "@/hooks/useSubmission";
import { Send, Loader2, Check, Mail, MessageCircle } from "lucide-react";

interface QuickContactForm {
  name: string;
  phone: string;
  email: string;
  message: string;
}

export default function QuickContact() {
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

  return (
    <section id="quick-contact" className="relative py-24 md:py-32 bg-secondary/60 text-foreground border-t border-border">
      <div className="max-w-[1400px] mx-auto px-6 md:px-10 grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-16 items-center">
        <div className="lg:col-span-5">
          <span className="text-[11px] tracking-[0.12em] text-accent">
            קו ישיר
          </span>
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
            <a href="mailto:dorit@govari-fin.co.il" dir="ltr" className="hover:text-accent transition-colors">dorit@govari-fin.co.il</a>
          </div>
          <a
            href="https://wa.me/972508311776"
            target="_blank"
            rel="noopener noreferrer"
            className="mt-4 inline-flex items-center gap-3 text-muted-foreground hover:text-accent transition-colors"
          >
            <MessageCircle size={16} className="text-accent" />
            <span dir="ltr">WhatsApp</span>
          </a>
        </div>

        <div className="lg:col-span-7">
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
                <div>
                  <label htmlFor="qc-name" className="block text-xs tracking-[0.15em] uppercase text-muted-foreground mb-2">שם מלא *</label>
                  <input
                    id="qc-name"
                    value={form.name}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                    className="w-full bg-background border border-border px-4 py-3 text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:border-highlight focus:ring-2 focus:ring-highlight/30 transition-colors"
                  />
                </div>
                <div>
                  <label htmlFor="qc-phone" className="block text-xs tracking-[0.15em] uppercase text-muted-foreground mb-2">טלפון *</label>
                  <input
                    id="qc-phone"
                    type="tel"
                    value={form.phone}
                    onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                    placeholder="050-8311776"
                    className="w-full bg-background border border-border px-4 py-3 text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:border-highlight focus:ring-2 focus:ring-highlight/30 transition-colors"
                  />
                </div>
              </div>
              <div className="mt-5">
                <label htmlFor="qc-email" className="block text-xs tracking-[0.15em] uppercase text-muted-foreground mb-2">אימייל (לא חובה)</label>
                <input
                  id="qc-email"
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                  placeholder="you@example.com"
                  className="w-full bg-background border border-border px-4 py-3 text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:border-highlight focus:ring-2 focus:ring-highlight/30 transition-colors"
                />
              </div>
              <div className="mt-5">
                <label htmlFor="qc-message" className="block text-xs tracking-[0.15em] uppercase text-muted-foreground mb-2">הודעה (לא חובה)</label>
                <textarea
                  id="qc-message"
                  value={form.message}
                  onChange={(e) => setForm((f) => ({ ...f, message: e.target.value }))}
                  rows={3}
                  placeholder="במה מדובר?"
                  className="w-full bg-background border border-border px-4 py-3 text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:border-highlight focus:ring-2 focus:ring-highlight/30 transition-colors resize-none"
                />
              </div>

              {error && <p className="mt-5 text-sm text-destructive">{error}</p>}

              <div className="mt-7 flex justify-end">
                <button
                  onClick={send}
                  disabled={!valid || busy}
                  className="inline-flex items-center gap-2 px-7 py-3.5 bg-highlight text-primary-foreground font-medium hover:bg-highlight-strong disabled:opacity-40 disabled:hover:bg-highlight transition-colors duration-300 shadow-sm"
                >
                  {busy ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                  שליחת הודעה
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}