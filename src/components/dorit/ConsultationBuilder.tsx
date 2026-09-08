import React, { useState } from "react";
import { Check, ChevronLeft, Loader2 } from "lucide-react";
import { base44 } from "@/api/base44Client";
import GoogleCalendarBooking from "@/components/dorit/GoogleCalendarBooking";

const NOTIFY_EMAIL = "amielnoy@gmail.com";
const SECONDARY_EMAIL = "doritg@fsfp-fin.co.il";

interface ConsultationData {
  topic: string;
  timing: string;
  name: string;
  phone: string;
  email: string;
  notes: string;
}

interface StepDef {
  key: keyof ConsultationData | "contact";
  label: string;
  options?: string[];
}

const STEPS: StepDef[] = [
  {
    key: "topic",
    label: "תחום הייעוץ",
    options: [
      "פיננסים מיסוי וקיבוע זכויות",
      "מיסוי וקבוע זכויות",
    ],
  },
  {
    key: "timing",
    label: "מתעניינים",
    options: ["השבוע", "החודש", "בעוד מספר חודשים", "רק מתלבט/ת"],
  },
  {
    key: "contact",
    label: "פרטים ליצירת קשר",
  },
];

interface FieldProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}

export default function ConsultationBuilder() {
  const [step, setStep] = useState<number>(0);
  const [data, setData] = useState<ConsultationData>({ topic: "", timing: "", name: "", phone: "", email: "", notes: "" });
  const [done, setDone] = useState<boolean>(false);
  const [sending, setSending] = useState<boolean>(false);
  const [error, setError] = useState<string>("");

  const isLast = step === STEPS.length - 1;
  const canNext =
    step === 0
      ? !!data.topic
      : step === 1
      ? !!data.timing
      : !!data.name && !!data.phone;

  const submitRequest = async () => {
    setSending(true);
    setError("");
    const when = data.timing || "לפי תיאום";
    const firstName = data.name.split(" ")[0];
    const agentBody =
      `בקשת ייעוץ חדשה — ${new Date().toLocaleString("he-IL")}\n\n` +
      `שם: ${data.name}\n` +
      `טלפון: ${data.phone}\n` +
      `אימייל: ${data.email || "—"}\n` +
      `תחום ייעוץ: ${data.topic || "—"}\n` +
      `מועד מבוקש: ${when}\n` +
      `הערות: ${data.notes || "—"}`;
    const clientBody =
      `שלום ${firstName},\n\n` +
      `קיבלתי את בקשת הייעוץ שלכם והפרטים תועדו במערכת בהצלחה.\n` +
      `כל פרט שמסרתם נשמר בסודיות מלאה ובכבוד.\n\n` +
      `נושא הפגישה: ${data.topic || "ייעוץ כללי"}\n` +
      `מועד מבוקש: ${when}\n\n` +
      `אחזור אליכם אישית תוך יום עסקים אחד לתיאום מועד מדויק לפגישה.\n` +
      `עד אז — נשמו רגועים. הכל מתוכנן.\n\n` +
      `לכל שאלה או עדכון, ניתן להשיב ישירות למייל זה.\n\n` +
      `בברכה חמה,\n` +
      `דורית גוב ארי\n` +
      `מתכננת פיננסית בכירה\n` +
      `doritg@fsfp-fin.co.il`;
    try {
      await base44.integrations.Core.SendEmail({
        to: NOTIFY_EMAIL,
        subject: `בקשת ייעוץ חדשה — ${data.name}`,
        body: agentBody,
      });
    } catch (e) {
      setError("לא הצלחנו לשלוח את הבקשה כרגע. ניתן לשלוח מייל ישירות ל-doritg@fsfp-fin.co.il או לנסות שוב.");
      setSending(false);
      return;
    }
    try {
      await base44.integrations.Core.SendEmail({
        to: SECONDARY_EMAIL,
        subject: `בקשת ייעוץ חדשה — ${data.name}`,
        body: agentBody,
      });
    } catch (e) {
      /* עותק מיטבי לדורית — מתעלם אם הכתובת עדיין אינה רשומה/דומיין לא מאומת */
    }
    if (data.email) {
      try {
        await base44.integrations.Core.SendEmail({
          to: data.email,
          subject: `אישור — קיבלנו את בקשת הייעוץ שלכם · דורית גוב ארי`,
          body: clientBody,
        });
      } catch (e) {
        /* מייל תיעוד ללקוח — מיטבי מאמץ */
      }
    }
    try {
      await base44.entities.Lead.create({
        name: data.name,
        phone: data.phone,
        email: data.email || "",
        source: "consultation",
        topic: data.topic || "",
        timing: data.timing || "",
        message: data.notes || "",
        status: "new",
      });
    } catch (e) {
      /* תיעוד הפנייה במאגר — מיטבי */
    }
    try {
      await base44.functions.invoke("createConsultationEvent", {
        name: data.name,
        phone: data.phone,
        email: data.email || "",
        topic: data.topic || "",
        timing: data.timing || "",
        notes: data.notes || "",
      });
    } catch (e) {
      /* יצירת אירוע ביומן Google — מיטבי, לא חוסם את התהליך */
    }
    setSending(false);
    setDone(true);
  };

  const next = () => {
    if (!canNext || sending) return;
    if (isLast) {
      submitRequest();
    } else {
      setStep((s) => s + 1);
    }
  };
  const back = () => setStep((s) => Math.max(0, s - 1));

  if (done) {
    return (
      <section
        id="consultation"
        className="relative py-24 md:py-32 bg-primary text-primary-foreground"
      >
        <div className="max-w-2xl mx-auto px-6 text-center">
          <div className="w-16 h-16 mx-auto rounded-full border border-[#C4A484] flex items-center justify-center mb-8">
            <Check size={28} className="text-[#C4A484]" />
          </div>
          <h2 className="font-heading text-4xl md:text-5xl">
            תודה, {data.name.split(" ")[0]}.
          </h2>
          <p className="mt-6 text-primary-foreground/80 leading-relaxed">
            קיבלתי את הבקשה. אחזור אישית תוך יום עסקים אחד לתיאום פגישת
            הייעוץ הראשונה. עד אז — לשמור על רוגע. הכל מתוכנן.
          </p>
          <button
            onClick={() => {
              setDone(false);
              setStep(0);
              setData({ topic: "", timing: "", name: "", phone: "", email: "", notes: "" });
            }}
            className="mt-10 text-sm tracking-wide underline underline-offset-4 hover:text-[#C4A484] transition-colors"
          >
            שליחת בקשה נוספת
          </button>
        </div>
      </section>
    );
  }

  return (
    <section
      id="consultation"
      className="relative py-24 md:py-32 border-t border-border/60"
    >
      <div className="max-w-[1400px] mx-auto px-6 md:px-10 grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-16">
        <div className="lg:col-span-5 flex flex-col justify-center">
          <span className="text-[11px] tracking-[0.35em] uppercase text-accent">
            07 · The Direct Path
          </span>
          <h2 className="font-heading text-5xl md:text-6xl mt-5 leading-tight">
            בונים יחד
            <br />
            את הייעוץ
          </h2>
          <p className="mt-8 text-foreground/70 max-w-md leading-relaxed">
            שלושה צעדים קצרים, כמו שיחה. ללא טפסים מיותרים — רק המידע שדרוש לי
            כדי להגיע מוכנה לפגישה הראשונה שלנו.
          </p>
          <div className="mt-10">
            <p className="text-xs tracking-[0.2em] uppercase text-muted-foreground mb-4">
              או לקביעה ישירה ביומן
            </p>
            <GoogleCalendarBooking data={data} />
          </div>
        </div>

        <div className="lg:col-span-7 bg-card border border-border/60 p-8 md:p-12">
          {/* progress */}
          <div className="flex items-center gap-3 mb-10">
            {STEPS.map((s, i) => (
              <React.Fragment key={s.key}>
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center text-xs border transition-colors ${
                    i <= step
                      ? "bg-primary text-primary-foreground border-primary"
                      : "border-border text-muted-foreground"
                  }`}
                >
                  {i + 1}
                </div>
                {i < STEPS.length - 1 && (
                  <div
                    className={`flex-1 h-px transition-colors ${
                      i < step ? "bg-primary" : "bg-border"
                    }`}
                  />
                )}
              </React.Fragment>
            ))}
          </div>

          <div className="min-h-[260px]">
            {step < 2 ? (
              <>
                <p className="text-sm tracking-[0.2em] uppercase text-accent mb-6">
                  {STEPS[step].label}
                </p>
                <div className="flex flex-col gap-3" role="group" aria-label={STEPS[step].label}>
                  {STEPS[step].options?.map((opt) => {
                    const selected = data[STEPS[step].key as keyof ConsultationData] === opt;
                    return (
                      <button
                        key={opt}
                        type="button"
                        aria-pressed={selected}
                        onClick={() =>
                          setData((d) => ({ ...d, [STEPS[step].key as keyof ConsultationData]: opt }))
                        }
                        className={`text-right px-6 py-4 border transition-all duration-300 flex items-center justify-between ${
                          selected
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-border hover:border-accent hover:bg-background"
                        }`}
                      >
                        <span className="text-lg">{opt}</span>
                        {selected && <Check size={18} />}
                      </button>
                    );
                  })}
                </div>
              </>
            ) : (
              <div className="space-y-5">
                <p className="text-sm tracking-[0.2em] uppercase text-accent mb-2">
                  {STEPS[step].label}
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <Field
                    label="שם מלא"
                    value={data.name}
                    onChange={(v) => setData((d) => ({ ...d, name: v }))}
                    placeholder="ישראל ישראלי"
                  />
                  <Field
                    label="טלפון"
                    value={data.phone}
                    onChange={(v) => setData((d) => ({ ...d, phone: v }))}
                    placeholder="052-7077776"
                  />
                </div>
                <Field
                  label="אימייל (לא חובה)"
                  value={data.email}
                  onChange={(v) => setData((d) => ({ ...d, email: v }))}
                  placeholder="you@example.com"
                />
                <div>
                  <label htmlFor="cb-notes" className="block text-xs tracking-[0.15em] uppercase text-muted-foreground mb-2">
                    הערות (לא חובה)
                  </label>
                  <textarea
                    id="cb-notes"
                    value={data.notes}
                    onChange={(e) => setData((d) => ({ ...d, notes: e.target.value }))}
                    rows={3}
                    placeholder="ספר/י בקצרה על הצורך"
                    className="w-full bg-background border border-border px-4 py-3 text-base focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/40 transition-colors resize-none"
                  />
                </div>
              </div>
            )}
          </div>

          <div className="flex items-center justify-between mt-10 pt-6 border-t border-border/60">
            <button
              onClick={back}
              disabled={step === 0 || sending}
              className="inline-flex items-center gap-2 text-sm text-foreground/60 hover:text-accent disabled:opacity-30 transition-colors"
            >
              <ChevronLeft size={16} /> חזור
            </button>
            <button
              onClick={next}
              disabled={!canNext || sending}
              className="inline-flex items-center gap-2 px-7 py-3.5 bg-[#C4A484] text-primary font-medium hover:bg-[#b8916f] disabled:opacity-40 disabled:hover:bg-[#C4A484] transition-colors"
            >
              {sending && <Loader2 size={16} className="animate-spin" />}
              {isLast ? "שליחת בקשה" : "המשך"}
            </button>
          </div>
          {error && (
            <p className="mt-4 text-sm text-destructive text-right">{error}</p>
          )}
        </div>
      </div>
    </section>
  );
}

function Field({ label, value, onChange, placeholder }: FieldProps) {
  const id = React.useId();
  return (
    <div>
      <label htmlFor={id} className="block text-xs tracking-[0.15em] uppercase text-muted-foreground mb-2">
        {label}
      </label>
      <input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-background border border-border px-4 py-3 text-base focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/40 transition-colors"
      />
    </div>
  );
}