import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Send, Loader2, Check, Mail, MessageCircle } from "lucide-react";

// הכתובת שאליה יגיעו הפניות. לשליחה מובטחת — ודא/י שזו כתובת משתמש רשום באפליקציה.
const NOTIFY_EMAIL = "dorit@gov-ari.co.il";

export default function QuickContact() {
  const [form, setForm] = useState({ name: "", phone: "", email: "", message: "" });
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  const valid = form.name.trim() && form.phone.trim();

  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true);
    setError("");
    try {
      const body =
        `פנייה חדשה מהאתר — ${new Date().toLocaleString("he-IL")}\n\n` +
        `שם: ${form.name}\n` +
        `טלפון: ${form.phone}\n` +
        `אימייל: ${form.email || "—"}\n\n` +
        `הודעה:\n${form.message || "—"}`;
      await base44.integrations.Core.SendEmail({
        to: NOTIFY_EMAIL,
        subject: `פנייה חדשה מהאתר — ${form.name}`,
        body,
      });
      setSent(true);
      setForm({ name: "", phone: "", email: "", message: "" });
    } catch (e) {
      setError("לא הצלחנו לשלוח כרגע. נסו/י שוב או חייגו/י ישירות.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section id="quick-contact" className="relative py-24 md:py-32 bg-primary text-primary-foreground border-t border-primary-foreground/10">
      <div className="max-w-[1400px] mx-auto px-6 md:px-10 grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-16 items-center">
        <div className="lg:col-span-5">
          <span className="text-[11px] tracking-[0.35em] uppercase text-[#C4A484]">
            Direct Line
          </span>
          <h2 className="font-heading text-5xl md:text-6xl mt-5 leading-tight">
            השאר/י פרטים,
            <br />
            אחזור אלייך היום
          </h2>
          <p className="mt-8 text-primary-foreground/70 max-w-md leading-relaxed">
            שלוש שדות בלבד — וההודעה מגיעה ישירות לתיבת הדוא״ל שלי. אחזור אליך
            אישית ובמהירות האפשרית.
          </p>
          <div className="mt-8 flex items-center gap-3 text-primary-foreground/60">
            <Mail size={16} className="text-[#C4A484]" />
            <a href="mailto:dorit@gov-ari.co.il" dir="ltr" className="hover:text-[#C4A484] transition-colors">dorit@gov-ari.co.il</a>
          </div>
          <a
            href="https://wa.me/972508311776"
            target="_blank"
            rel="noopener noreferrer"
            className="mt-4 inline-flex items-center gap-3 text-primary-foreground/60 hover:text-[#C4A484] transition-colors"
          >
            <MessageCircle size={16} className="text-[#C4A484]" />
            <span dir="ltr">WhatsApp</span>
          </a>
        </div>

        <div className="lg:col-span-7">
          {sent ? (
            <div className="bg-primary-foreground/5 border border-primary-foreground/15 p-10 text-center">
              <div className="w-14 h-14 mx-auto rounded-full border border-[#C4A484] flex items-center justify-center mb-6">
                <Check size={26} className="text-[#C4A484]" />
              </div>
              <p className="font-heading text-2xl">ההודעה נשלחה. תודה.</p>
              <p className="mt-4 text-primary-foreground/70">
                קיבלתי את פרטייך ואחזור אלייך בהקדם האפשרי.
              </p>
              <button
                onClick={() => setSent(false)}
                className="mt-8 text-sm tracking-wide underline underline-offset-4 hover:text-[#C4A484] transition-colors"
              >
                שליחת הודעה נוספת
              </button>
            </div>
          ) : (
            <div className="bg-primary-foreground/5 border border-primary-foreground/15 p-8 md:p-10">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <div>
                  <label htmlFor="qc-name" className="block text-xs tracking-[0.15em] uppercase text-primary-foreground/50 mb-2">שם מלא *</label>
                  <input
                    id="qc-name"
                    value={form.name}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                    className="w-full bg-primary border border-primary-foreground/15 px-4 py-3 text-primary-foreground placeholder:text-primary-foreground/30 focus:outline-none focus:border-[#C4A484] focus:ring-2 focus:ring-[#C4A484]/40 transition-colors"
                  />
                </div>
                <div>
                  <label htmlFor="qc-phone" className="block text-xs tracking-[0.15em] uppercase text-primary-foreground/50 mb-2">טלפון *</label>
                  <input
                    id="qc-phone"
                    type="tel"
                    value={form.phone}
                    onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                    placeholder="050-8311776"
                    className="w-full bg-primary border border-primary-foreground/15 px-4 py-3 text-primary-foreground placeholder:text-primary-foreground/30 focus:outline-none focus:border-[#C4A484] focus:ring-2 focus:ring-[#C4A484]/40 transition-colors"
                  />
                </div>
              </div>
              <div className="mt-5">
                <label htmlFor="qc-email" className="block text-xs tracking-[0.15em] uppercase text-primary-foreground/50 mb-2">אימייל (לא חובה)</label>
                <input
                  id="qc-email"
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                  placeholder="you@example.com"
                  className="w-full bg-primary border border-primary-foreground/15 px-4 py-3 text-primary-foreground placeholder:text-primary-foreground/30 focus:outline-none focus:border-[#C4A484] focus:ring-2 focus:ring-[#C4A484]/40 transition-colors"
                />
              </div>
              <div className="mt-5">
                <label htmlFor="qc-message" className="block text-xs tracking-[0.15em] uppercase text-primary-foreground/50 mb-2">הודעה (לא חובה)</label>
                <textarea
                  id="qc-message"
                  value={form.message}
                  onChange={(e) => setForm((f) => ({ ...f, message: e.target.value }))}
                  rows={3}
                  placeholder="במה מדובר?"
                  className="w-full bg-primary border border-primary-foreground/15 px-4 py-3 text-primary-foreground placeholder:text-primary-foreground/30 focus:outline-none focus:border-[#C4A484] focus:ring-2 focus:ring-[#C4A484]/40 transition-colors resize-none"
                />
              </div>

              {error && <p className="mt-5 text-sm text-[#e8b4a0]">{error}</p>}

              <div className="mt-7 flex justify-end">
                <button
                  onClick={submit}
                  disabled={!valid || busy}
                  className="inline-flex items-center gap-2 px-7 py-3.5 bg-[#C4A484] text-primary font-medium hover:bg-[#b8916f] disabled:opacity-40 disabled:hover:bg-[#C4A484] transition-colors"
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