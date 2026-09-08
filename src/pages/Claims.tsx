import React from "react";
import { Link } from "react-router-dom";
import {
  Phone,
  MessageCircle,
  Mail,
  Camera,
  FileText,
  ShieldCheck,
  Clock,
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
} from "lucide-react";
import FloatingHeader from "@/components/dorit/FloatingHeader";
import Footer from "@/components/dorit/Footer";
import { SITE_NAME, absoluteUrl, breadcrumbLd, useSeo } from "@/lib/seo";
import Reveal from "@/components/dorit/Reveal";
import { CONTACT } from "@/config/contact";

interface ClaimStep {
  n: string;
  title: string;
  body: string;
}

interface ClaimType {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  title: string;
  points: string[];
}

const STEPS: ClaimStep[] = [
  {
    n: "01",
    title: "דווחו לי מיד",
    body: "ברגע שאירוע ביטוחי מתרחש — חייגו או שלחו הודעת WhatsApp. ככל שהדיווח מהיר יותר, כך הטיפול מדויק וקצר יותר. אני זמינה לכם גם בשעות הערב ובמקרים דחופים.",
  },
  {
    n: "02",
    title: "תעדו את האירוע",
    body: "צלמו, אספו מסמכים ורשמו פרטים — תאריך, שעה, מיקום, עדים, מספרי טלפון. תיעוד מדויק בזמן אמת הוא הבסיס לתביעה חלקה.",
  },
  {
    n: "03",
    title: "פנו לגורם הרלוונטי",
    body: "במקרה רפואי — פנו לרופא/בית חולים ושמרו מסמכים. במקרה פלילי/תאונה — הגישו תלונה במשטרה. במקרה רכושי — אל תיגעו בשטח לפני תיעוד.",
  },
  {
    n: "04",
    title: "אני מגישה את התביעה",
    body: "מרגע זה אני נוטלת את ניהול התביעה על עצמי — השלמת טפסים, הגשת מסמכים לחברה ומעקב צמוד עד לקבלת הכיסוי המלא. ברוב המקרים לא תצטרכו להרים טלפון.",
  },
];

const CLAIM_TYPES: ClaimType[] = [
  {
    icon: ShieldCheck,
    title: "ביטוח בריאות משלים",
    points: [
      "שמרו מסמכים רפואיים: הפניות, דוחות, אישפוז, חשבוניות וקבלות",
      "דווחו על כל טיפול/ניתוח טרם ההפנייה, אם אפשר",
      "במקרה תרופות יקרות — צרפו מרשם ואישור רופא",
    ],
  },
  {
    icon: AlertTriangle,
    title: "ביטוח חיים / מקרה מוות",
    points: [
      "הודיעו לי מיד — אני מתאמת את הגשת התביעה מול החברה",
      "הכינו תעודת פטירה ומסמכי ירושה/צו קיום צוואה",
      "במקרה אובדן כושר — דוח מחלה מהרופא המטפל ואישור מעסיק",
    ],
  },
  {
    icon: Clock,
    title: "אובדן כושר עבודה",
    points: [
      "דווחו מיד עם תחילת ההיעדרות מעבודה",
      "השגישו דוח מחלה, אישור מעסיק ותיעוד הכנסה",
      "שמרו על רצף טיפולי — פערים בתיעוד עלולים לעכב תשלום",
    ],
  },
  {
    icon: Camera,
    title: "רכוש / דירה / רכב",
    points: [
      "צלמו את הנזק מכל זווית לפני כל תיקון",
      "אל תיגעו בשטח הנזק עד לתיעוד מלא ואישור סוקר",
      "במקרה פריצה/תאונה — הגישו תלונה במשטרה ושמרו את המספר",
    ],
  },
];

const DOCS: string[] = [
  "תעודת זהות של המבוטח והתובע",
  "פוליסה פעילה (מספר וסוג הכיסוי)",
  "תיעוד האירוע: תאריך, שעה, מיקום, עדים",
  "מסמכים רפואיים / דוחות / חשבוניות / קבלות",
  "אישורי גורמים רשמיים (משטרה, בית חולים, מעסיק)",
  "פרטי חשבון להעברת תגמולי הביטוח",
];

export default function Claims() {
  useSeo({
    title: "ליווי תביעות ביטוח — מה לעשות בעת אירוע | דורית גוב ארי",
    description:
      "מדריך מעשי להגשת תביעת ביטוח: מה לתעד, אילו מסמכים נדרשים, ואיך מתנהלים מול חברת הביטוח. ליווי אישי לאורך כל התהליך, 97% תביעות שאושרו.",
    path: "/claims",
    jsonLd: [
      breadcrumbLd([
        { name: "ראשי", path: "/" },
        { name: "ליווי תביעות", path: "/claims" },
      ]),
      {
        "@context": "https://schema.org",
        "@type": "Service",
        name: "ליווי תביעות ביטוח",
        serviceType: "ליווי והגשת תביעות מול חברות ביטוח",
        areaServed: { "@type": "Country", name: "IL" },
        inLanguage: "he-IL",
        url: absoluteUrl("/claims"),
        provider: { "@type": "FinancialService", name: SITE_NAME, url: absoluteUrl("/") },
      },
    ],
  });
  return (
    <div className="min-h-screen bg-background">
      <FloatingHeader />

      <main className="pt-32 md:pt-40">
        {/* Hero */}
        <section className="relative max-w-[1400px] mx-auto px-6 md:px-10 pb-16 md:pb-20">
          <Reveal>
            <span className="text-[11px] tracking-[0.35em] uppercase text-accent">
              Claims Guidance · ליווי תביעות
            </span>
            <h1 className="font-heading text-5xl md:text-6xl mt-5 leading-tight max-w-3xl">
              מה לעשות
              <br />
              בעת אירוע ביטוחי
            </h1>
            <p className="mt-8 text-lg text-foreground/70 max-w-2xl leading-relaxed">
              אירוע ביטוחי יכול להיות מלחיץ — אבל אתם לא לבד. מרגע הדיווח אני
              נוטלת את ניהול התביעה על עצמי, עד לקבלת הכיסוי המלא. להלן הצעדים
              הברורים שיבטיחו טיפול מהיר ומדויק.
            </p>
          </Reveal>

          {/* Urgent contact bar */}
          <Reveal delay={0.1}>
            <div className="mt-12 grid grid-cols-1 md:grid-cols-3 gap-4">
              <a
                href={`tel:${CONTACT.phoneE164}`}
                className="flex items-center gap-4 p-5 bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                <Phone size={22} className="text-[#C4A484]" />
                <span className="flex flex-col">
                  <span className="text-xs tracking-[0.2em] uppercase text-primary-foreground/60">דיווח מיידי</span>
                  <span dir="ltr" className="font-medium">{CONTACT.phoneDisplay}</span>
                </span>
              </a>
              <a
                href={`https://wa.me/${CONTACT.whatsapp}?text=${encodeURIComponent("שלום דורית, אני מדווח/ת על אירוע ביטוחי וזקוק/ה לליווי תביעה.")}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-4 p-5 border border-border hover:border-accent hover:text-accent transition-colors"
              >
                <MessageCircle size={22} className="text-[#25D366]" />
                <span className="flex flex-col">
                  <span className="text-xs tracking-[0.2em] uppercase text-muted-foreground">הודעה מהירה</span>
                  <span className="font-medium">WhatsApp</span>
                </span>
              </a>
              <a
                href={`mailto:${CONTACT.email}`}
                className="flex items-center gap-4 p-5 border border-border hover:border-accent hover:text-accent transition-colors"
              >
                <Mail size={22} className="text-accent" />
                <span className="flex flex-col">
                  <span className="text-xs tracking-[0.2em] uppercase text-muted-foreground">מסמכים ופרטים</span>
                  <span dir="ltr" className="font-medium">{CONTACT.email}</span>
                </span>
              </a>
            </div>
          </Reveal>
        </section>

        {/* Steps */}
        <section className="relative py-20 md:py-24 border-t border-border/60 bg-secondary/40">
          <div className="max-w-[1400px] mx-auto px-6 md:px-10">
            <Reveal>
              <div className="max-w-2xl mb-14">
                <span className="text-[11px] tracking-[0.35em] uppercase text-accent">
                  01 · The Process
                </span>
                <h2 className="font-heading text-4xl md:text-5xl mt-4">
                  ארבעה צעדים עד לכיסוי
                </h2>
              </div>
            </Reveal>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-px bg-border/60 border border-border/60">
              {STEPS.map((s, i) => (
                <Reveal key={s.n} delay={i * 0.08}>
                  <div className="h-full bg-background p-8 flex flex-col">
                    <span className="font-heading text-5xl text-highlight/70 leading-none">{s.n}</span>
                    <h3 className="font-heading text-xl mt-6 mb-3">{s.title}</h3>
                    <p className="text-foreground/70 leading-relaxed text-sm">{s.body}</p>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* Claim types */}
        <section className="relative py-20 md:py-24">
          <div className="max-w-[1400px] mx-auto px-6 md:px-10">
            <Reveal>
              <div className="max-w-2xl mb-14">
                <span className="text-[11px] tracking-[0.35em] uppercase text-accent">
                  02 · By Claim Type
                </span>
                <h2 className="font-heading text-4xl md:text-5xl mt-4">
                  הנחיות לפי סוג אירוע
                </h2>
                <p className="mt-5 text-foreground/70 leading-relaxed">
                  כל סוג תביעה דורש תיעוד שונה. בחרו את הקטגוריה הרלוונטית ופעלו
                  לפי ההנחיות — ובכל שלב, אני כאן ליווי וסיוע.
                </p>
              </div>
            </Reveal>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {CLAIM_TYPES.map((c, i) => (
                <Reveal key={c.title} delay={i * 0.06}>
                  <div className="h-full border border-border/60 p-8 hover:border-accent/50 transition-colors">
                    <div className="flex items-center gap-4 mb-6">
                      <span className="w-12 h-12 flex items-center justify-center border border-accent/40 text-accent">
                        <c.icon size={22} />
                      </span>
                      <h3 className="font-heading text-2xl">{c.title}</h3>
                    </div>
                    <ul className="space-y-3">
                      {c.points.map((p) => (
                        <li key={p} className="flex items-start gap-3 text-foreground/75 leading-relaxed">
                          <CheckCircle2 size={18} className="text-[#C4A484] mt-1 shrink-0" />
                          <span>{p}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* Documents checklist */}
        <section className="relative py-20 md:py-24 border-t border-border/60 bg-primary text-primary-foreground">
          <div className="max-w-[1400px] mx-auto px-6 md:px-10 grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-16">
            <div className="lg:col-span-5">
              <Reveal>
                <span className="text-[11px] tracking-[0.35em] uppercase text-[#C4A484]">
                  03 · Checklist
                </span>
                <h2 className="font-heading text-4xl md:text-5xl mt-4 leading-tight">
                  מסמכים
                  <br />
                  שכדאי להכין
                </h2>
                <p className="mt-6 text-primary-foreground/70 leading-relaxed max-w-md">
                  רשימה כללית של מסמכים שמזרזים את הגשת התביעה. לא כל מסמך רלוונטי
                  לכל מקרה — אני אתאם אתכם אישית את המסמכים המדויקים הדרושים.
                </p>
                <div className="mt-8 flex items-center gap-3 text-[#C4A484]">
                  <FileText size={20} />
                  <span className="text-sm tracking-wide">שמרו מסמכים במקום אחד, מסודר ונגיש</span>
                </div>
              </Reveal>
            </div>
            <div className="lg:col-span-7">
              <Reveal delay={0.1}>
                <ul className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {DOCS.map((d) => (
                    <li
                      key={d}
                      className="flex items-start gap-3 p-4 border border-primary-foreground/15 hover:border-[#C4A484]/50 transition-colors"
                    >
                      <CheckCircle2 size={20} className="text-[#C4A484] mt-0.5 shrink-0" />
                      <span className="text-primary-foreground/85 leading-relaxed">{d}</span>
                    </li>
                  ))}
                </ul>
              </Reveal>
            </div>
          </div>
        </section>

        {/* Reassurance / CTA */}
        <section className="relative py-24 md:py-32">
          <div className="max-w-3xl mx-auto px-6 text-center">
            <Reveal>
              <ShieldCheck size={40} className="mx-auto text-accent" />
              <h2 className="font-heading text-4xl md:text-5xl mt-8 leading-tight">
                אתם לא לבד ברגע האמת
              </h2>
              <p className="mt-6 text-foreground/70 leading-relaxed">
                ניסיון של 30 שנה בליווי תביעות מלמד אותי דבר אחד: הלקוח לא צריך
                להתמודד לבד מול חברות הביטוח. דווחו לי, ומכאן אני מובילה — עד
                לקבלת הכיסוי המלא.
              </p>
              <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
                <a
                  href={`tel:${CONTACT.phoneE164}`}
                  className="inline-flex items-center gap-2 px-7 py-3.5 bg-primary text-primary-foreground font-medium hover:bg-primary/90 transition-colors"
                >
                  <Phone size={18} />
                  דיווח מיידי
                </a>
                <a
                  href="#consultation"
                  className="inline-flex items-center gap-2 px-7 py-3.5 bg-[#C4A484] text-primary font-medium hover:bg-[#b8916f] transition-colors"
                >
                  ייעוץ מקדים
                </a>
              </div>
              <Link
                to="/"
                className="mt-10 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-accent transition-colors"
              >
                <ChevronLeft size={16} />
                חזרה לדף הבית
              </Link>
            </Reveal>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}