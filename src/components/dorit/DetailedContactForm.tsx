import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Send, Loader2, Check, AlertCircle } from "lucide-react";

const NOTIFY_EMAIL = "amielnoy@gmail.com";
const SECONDARY_EMAIL = "doritg@fsfp-fin.co.il";

const SERVICES: string[] = [
  "גמל השתלמות ופנסיה",
  "מיסוי וקבוע זכויות",
  "אחר / לא בטוח/ה",
];

const CONTACT_TIMES: string[] = ["בוקר", "צהריים", "ערב", "לפי תיאום"];

interface DetailedForm {
  name: string;
  phone: string;
  email: string;
  service: string;
  contactTime: string;
  message: string;
  consent: boolean;
}

export default function DetailedContactForm() {
  const [form, setForm] = useState<DetailedForm>({
    name: "",
    phone: "",
    email: "",
    service: "",
    contactTime: "",
    message: "",
    consent: false,
  });
  const [busy, setBusy] = useState<boolean>(false);
  const [sent, setSent] = useState<boolean>(false);
  const [error, setError] = useState<string>("");

  const valid =
    form.name.trim() &&
    form.phone.trim() &&
    form.service &&
    form.message.trim() &&
    form.consent;

  const set = (key: keyof DetailedForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const value =
      e.target.type === "checkbox" ? (e.target as HTMLInputElement).checked : e.target.value;
    setForm((f) => ({ ...f, [key]: value }));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    setError("");
    try {
      const body =
        `פנייה מפורטת מהאתר — ${new Date().toLocaleString("he-IL")}\n\n` +
        `שם: ${form.name}\n` +
        `טלפון: ${form.phone}\n` +
        `אימייל: ${form.email || "—"}\n` +
        `שירות מבוקש: ${form.service}\n` +
        `מועד מועדף ליצירת קשר: ${form.contactTime || "—"}\n\n` +
        `הודעה אישית:\n${form.message}`;
      await base44.integrations.Core.SendEmail({
        to: NOTIFY_EMAIL,
        subject: `פנייה מפורטת — ${form.name} (${form.service})`,
        body,
      });
      try {
        await base44.integrations.Core.SendEmail({
          to: SECONDARY_EMAIL,
          subject: `פנייה מפורטת — ${form.name} (${form.service})`,
          body,
        });
      } catch (e) {
        /* עותק מיטבי לדורית */
      }
      try {
        await base44.entities.Lead.create({
          name: form.name,
          phone: form.phone,
          email: form.email || "",
          source: "detailed",
          topic: form.service || "",
          timing: form.contactTime || "",
          message: form.message || "",
          status: "new",
        });
      } catch (e) {
        /* תיעוד הפנייה במאגר — מיטבי */
      }
      setSent(true);
      setForm({
        name: "",
        phone: "",
        email: "",
        service: "",
        contactTime: "",
        message: "",
        consent: false,
      });
    } catch (err) {
      setError("לא הצלחנו לשלוח את הטופס כרגע. ניתן לשלוח מייל ישירות ל-doritg@fsfp-fin.co.il או לנסות שוב.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      id="detailed-contact"
      className="relative py-20 md:py-32 border-t border-border/60"
    >
      <div className="max-w-[1400px] mx-auto px-5 sm:px-6 md:px-10 grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-16">
        <div className="lg:col-span-5 flex flex-col justify-center">
          <span className="text-[11px] tracking-[0.35em] uppercase text-accent">
            Personal Message
          </span>
          <h2 className="font-heading text-4xl sm:text-5xl md:text-6xl mt-5 leading-tight">
            ספרו לי
            <br />
            עליכם
          </h2>
          <p className="mt-6 md:mt-8 text-foreground/70 max-w-md leading-relaxed text-base sm:text-lg">
            ככל שאדע יותר על הצורך שלכם, כך אוכל להגיע מוכנה יותר לפגישה הראשונה.
            מלאו את הפרטים והשאירו הודעה אישית — אחזור אליכם באופן שמתאים לכם.
          </p>
        </div>

        <div className="lg:col-span-7 bg-card border border-border/60 p-6 sm:p-8 md:p-12">
          {sent ? (
            <div className="text-center py-10">
              <div className="w-14 h-14 mx-auto rounded-full border border-[#C4A484] flex items-center justify-center mb-6">
                <Check size={26} className="text-[#C4A484]" />
              </div>
              <p className="font-heading text-2xl">תודה, הטופס נשלח.</p>
              <p className="mt-4 text-foreground/70 max-w-md mx-auto">
                קיבלתי את פנייתכם ואחזור אליכם אישית במועד שבחרתם.
              </p>
              <button
                onClick={() => setSent(false)}
                className="mt-8 text-sm tracking-wide underline underline-offset-4 hover:text-accent transition-colors"
              >
                שליחת פנייה נוספת
              </button>
            </div>
          ) : (
            <form onSubmit={submit} noValidate className="space-y-5 sm:space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <div>
                  <label htmlFor="dc-name" className="block text-xs tracking-[0.15em] uppercase text-muted-foreground mb-2">
                    שם מלא *
                  </label>
                  <input
                    id="dc-name"
                    name="name"
                    type="text"
                    required
                    autoComplete="name"
                    value={form.name}
                    onChange={set("name")}
                    aria-required="true"
                    className="w-full bg-background border border-border px-4 py-3 text-base focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/40 transition-colors"
                  />
                </div>
                <div>
                  <label htmlFor="dc-phone" className="block text-xs tracking-[0.15em] uppercase text-muted-foreground mb-2">
                    טלפון *
                  </label>
                  <input
                    id="dc-phone"
                    name="phone"
                    type="tel"
                    required
                    autoComplete="tel"
                    value={form.phone}
                    onChange={set("phone")}
                    aria-required="true"
                    className="w-full bg-background border border-border px-4 py-3 text-base focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/40 transition-colors"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="dc-email" className="block text-xs tracking-[0.15em] uppercase text-muted-foreground mb-2">
                  אימייל (לא חובה)
                </label>
                <input
                  id="dc-email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  value={form.email}
                  onChange={set("email")}
                  className="w-full bg-background border border-border px-4 py-3 text-base focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/40 transition-colors"
                />
              </div>

              <div>
                <span id="dc-service-label" className="block text-xs tracking-[0.15em] uppercase text-muted-foreground mb-3">
                  בחר/י שירות *
                </span>
                <div className="flex flex-wrap gap-2" role="group" aria-labelledby="dc-service-label">
                  {SERVICES.map((s) => {
                    const selected = form.service === s;
                    return (
                      <button
                        key={s}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => setForm((f) => ({ ...f, service: s }))}
                        className={`px-4 py-2 border text-sm transition-colors ${
                          selected
                            ? "bg-primary text-primary-foreground border-primary"
                            : "border-border hover:border-accent hover:bg-background"
                        }`}
                      >
                        {s}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <label htmlFor="dc-contact-time" className="block text-xs tracking-[0.15em] uppercase text-muted-foreground mb-2">
                  מועד מועדף ליצירת קשר
                </label>
                <select
                  id="dc-contact-time"
                  name="contactTime"
                  value={form.contactTime}
                  onChange={set("contactTime")}
                  className="w-full bg-background border border-border px-4 py-3 text-base focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/40 transition-colors"
                >
                  <option value="">בחר/י מועד (לא חובה)</option>
                  {CONTACT_TIMES.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="dc-message" className="block text-xs tracking-[0.15em] uppercase text-muted-foreground mb-2">
                  הודעה אישית *
                </label>
                <textarea
                  id="dc-message"
                  name="message"
                  required
                  rows={5}
                  value={form.message}
                  onChange={set("message")}
                  aria-required="true"
                  placeholder="ספר/י בקצרה על הצורך, המטרות או שאלות שיש לך"
                  className="w-full bg-background border border-border px-4 py-3 text-base focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/40 transition-colors resize-none"
                />
              </div>

              <div className="flex items-start gap-3">
                <input
                  id="dc-consent"
                  type="checkbox"
                  checked={form.consent}
                  onChange={set("consent")}
                  required
                  aria-required="true"
                  className="mt-1 w-4 h-4 accent-[#7D6B5D]"
                />
                <label htmlFor="dc-consent" className="text-sm text-foreground/70 leading-relaxed">
                  אני מאשר/ת את שליחת הפרטים שלי לצורך יצירת קשר וייעוץ. הפרטים יישמרו בכפוף למדיניות הפרטיות.
                </label>
              </div>

              {error && (
                <p className="flex items-center gap-2 text-sm text-destructive">
                  <AlertCircle size={16} /> {error}
                </p>
              )}

              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={!valid || busy}
                  className="inline-flex items-center gap-2 px-7 py-3.5 bg-[#C4A484] text-primary font-medium hover:bg-[#b8916f] disabled:opacity-40 disabled:hover:bg-[#C4A484] transition-colors"
                >
                  {busy ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                  שליחת פנייה
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </section>
  );
}