import React from "react";
import { ArrowLeft, Calculator, FileSearch, Layers, LineChart, MessageCircle, Phone, ShieldCheck, Wallet } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import Eyebrow from "@/components/dorit/primitives/Eyebrow";
import { CtaLink } from "@/components/dorit/primitives/Cta";
import { useAgencyContent } from "@/hooks/useAgencyContent";
import { SNAPSHOT_REVIEW_BUSINESS_DAYS, SNAPSHOT_START_HREF } from "@/config/snapshot";
import { TOOL_SECTION, toolHref } from "@/config/tools";

/**
 * The personal financial snapshot (תמונת מצב), introduced on the home page:
 * a lead block, how it works, what the personal area shows, the difference a
 * planner makes, and the tools. Shown only when VITE_SNAPSHOT_HOME is on
 * (src/config/snapshot.ts) — it promises a personal area and two tools that
 * later phases build.
 *
 * The page already has its one h1 (ArchStatement); this block's headline is an
 * h2 set at the same size. No figure is a claim: the preview card's numbers are
 * labelled sample data, and nothing says "free" or counts users or savings.
 */

const SECTION = "border-b border-border";
const WRAP = "max-w-[1400px] mx-auto px-[clamp(20px,4vw,40px)] py-[clamp(72px,9vw,120px)] max-md:py-10";
const H2 = "font-heading font-normal text-[clamp(30px,3.6vw,44px)] leading-[1.15] mt-[18px] [text-wrap:balance]";
// Below md every card is tighter: this block must not undo the mobile programme's height cuts.
const CARD = "rounded-[4px] border border-border p-6 max-md:p-4";

const STEPS: { n: string; title: string; text: string }[] = [
  {
    n: "01",
    title: "מוסרים קוד מהמסלקה",
    text: "מפיקים באתר המסלקה הפנסיונית קוד אימות, ומוסרים אותו בקישור אישי ומאובטח שדורית שולחת.",
  },
  {
    n: "02",
    title: "דורית עוברת על הנתונים",
    text: "כל הקופות, דמי הניהול והכיסויים — אחד אחד, מול מה שמתאים לשלב החיים שלכם.",
  },
  {
    n: "03",
    title: "תמונת מצב והמלצות",
    text: "תמונה אחת של הפנסיה, החיסכון והביטוח, ורשימת המלצות שדורית כתבה וחתמה עליהן.",
  },
];

/** Step 3's timing, once Dorit has confirmed it (SNAPSHOT_REVIEW_BUSINESS_DAYS). */
export function stepTiming(days: number | null): string | null {
  if (days === null || !Number.isInteger(days) || days < 1) return null;
  return days === 1 ? "תוך יום עסקים אחד" : `תוך ${days} ימי עסקים`;
}

const TILES: { icon: LucideIcon; title: string; text: string }[] = [
  { icon: Layers, title: "כל הקופות במקום אחד", text: "פנסיה, גמל, השתלמות וביטוח מנהלים — יתרות והפקדות בטבלה אחת." },
  { icon: Wallet, title: "דמי ניהול מול השוק", text: "כמה נגבה מכם בפועל, ואיך זה נראה לצד מה שמקובל היום." },
  { icon: LineChart, title: "תחזית לפרישה", text: "הערכה של הקצבה הצפויה, לפי הנתונים מהמסלקה." },
  { icon: ShieldCheck, title: "כיסויים, חוסרים וכפלים", text: "איפה יש כיסוי כפול, ואיפה חסר כיסוי שכדאי לבדוק." },
];

const TOOLS: { title: string; text: string; href: string; isNew: boolean }[] = [
  { title: "מחשבון דמי ניהול", text: "כמה דמי הניהול עולים לאורך שנות החיסכון.", href: toolHref(TOOL_SECTION.feeCalculator), isNew: false },
  { title: "בדיקת צורכי ביטוח", text: "אילו ביטוחים כדאי לבחון בשלב החיים שלכם.", href: toolHref(TOOL_SECTION.assessment), isNew: false },
  { title: "מחשבון פרישה", text: "לאן החיסכון יכול להגיע עד הפרישה, ומה משנה את התמונה.", href: toolHref(TOOL_SECTION.retirement), isNew: true },
  { title: "בדיקת כפל ביטוחים", text: "קובץ מהר הביטוח — ובדיקה של כיסויים כפולים, בדפדפן שלכם.", href: toolHref(TOOL_SECTION.harHabituach), isNew: true },
];

/** The lead block's preview: sample data, and it says so. */
function PreviewCard() {
  const rows: [string, string][] = [
    ["סך החיסכון", "₪ 1,240,000"],
    ["דמי ניהול השנה", "₪ 6,850"],
    ["קופות", "5"],
    ["המלצות לבדיקה", "3"],
  ];
  return (
    <figure aria-label="תצוגה מקדימה — נתוני דוגמה" className="m-0 rounded-[4px] border border-highlight p-6 bg-background">
      <figcaption className="flex items-center justify-between gap-3 text-sm">
        <span className="font-heading text-lg">תמונת מצב</span>
        <span className="rounded-[4px] border border-border px-2 py-0.5 text-xs text-muted-foreground">נתוני דוגמה</span>
      </figcaption>
      <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-4">
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="m-0 mt-1 font-heading text-2xl text-accent lining-nums tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
    </figure>
  );
}

export default function SnapshotHome() {
  const { contact } = useAgencyContent();
  const timing = stepTiming(SNAPSHOT_REVIEW_BUSINESS_DAYS);
  return (
    <>
      {/* 1 — the lead block */}
      <section id="snapshot" aria-labelledby="snapshot-title" className={SECTION}>
        <div className={`${WRAP} grid grid-cols-1 lg:grid-cols-[1.2fr_1fr] gap-[clamp(32px,4vw,56px)] items-center`}>
          <div>
            <Eyebrow>חדש באתר · תמונת מצב אישית</Eyebrow>
            <h2 id="snapshot-title" className="font-heading font-normal text-[clamp(34px,4.4vw,60px)] leading-[1.08] mt-[18px] [text-wrap:balance]">
              כל הפנסיה, החיסכון והביטוח שלכם — בתמונה אחת. ומתכננת שבודקת אותה.
            </h2>
            <div className="mt-8 max-md:mt-6 flex flex-wrap gap-3">
              <CtaLink href={SNAPSHOT_START_HREF} size="lg" className="max-sm:w-full">
                להתחיל — מסירת קוד המסלקה
              </CtaLink>
              <CtaLink href="#how-it-works" muted size="lg" className="max-sm:w-full">
                איך זה עובד
              </CtaLink>
            </div>
          </div>
          <PreviewCard />
        </div>
      </section>

      {/* 2 — how it works */}
      <section id="how-it-works" aria-labelledby="how-it-works-title" className={SECTION}>
        <div className={WRAP}>
          <Eyebrow>איך זה עובד</Eyebrow>
          <h2 id="how-it-works-title" className={H2}>שלושה צעדים, ודורית עושה את רובם</h2>
          <ol className="mt-10 max-md:mt-6 grid gap-5 max-md:gap-3 md:grid-cols-3 list-none p-0">
            {STEPS.map((step, i) => (
              <li key={step.n} className={CARD}>
                <div className="max-md:flex max-md:items-baseline max-md:gap-3">
                  <span className="font-heading text-3xl text-accent lining-nums tabular-nums max-md:text-2xl">{step.n}</span>
                  <h3 className="font-heading text-xl mt-3 max-md:mt-0">{step.title}</h3>
                </div>
                <p className="mt-2 text-[17px] leading-[1.6] text-foreground/80 max-md:text-[15px]">{step.text}</p>
                {i === STEPS.length - 1 && timing ? <p className="mt-3 text-sm text-accent">{timing}</p> : null}
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* 3 — what the personal area shows */}
      <section aria-labelledby="snapshot-area-title" className={SECTION}>
        <div className={WRAP}>
          <Eyebrow>האזור האישי</Eyebrow>
          <h2 id="snapshot-area-title" className={H2}>מה תראו באזור האישי</h2>
          <ul className="mt-10 max-md:mt-6 grid grid-cols-2 gap-5 max-md:gap-3 lg:grid-cols-4 list-none p-0">
            {TILES.map(({ icon: Icon, title, text }) => (
              <li key={title} className={CARD}>
                <Icon size={24} strokeWidth={1.5} className="text-highlight max-md:w-5 max-md:h-5" aria-hidden="true" />
                <h3 className="font-heading text-xl mt-4 max-md:mt-2 max-md:text-lg max-md:leading-snug">{title}</h3>
                <p className="mt-2 text-[17px] leading-[1.6] text-foreground/80 max-md:text-sm max-md:leading-[1.5]">{text}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* 4 — the difference, on the colophon's dark band */}
      <section aria-labelledby="difference-title" className="bg-primary text-primary-foreground">
        <div className={WRAP}>
          <Eyebrow className="text-highlight-on-dark">ההבדל</Eyebrow>
          <h2 id="difference-title" className={H2}>
            אפליקציה מראה מספרים. מתכננת אומרת מה לעשות איתם.
          </h2>
          <ul className="mt-10 max-md:mt-6 grid gap-8 max-md:gap-5 md:grid-cols-3 list-none p-0">
            <li>
              <h3 className="font-heading text-xl">המלצות בחתימה אישית</h3>
              <p className="mt-2 text-[17px] leading-[1.6] text-primary-foreground/80">
                כל המלצה נכתבת ונבדקת על ידי דורית, בעלת רישיון סוכן — ואף אחת לא מתפרסמת בלי שאישרה אותה.
              </p>
            </li>
            <li>
              <h3 className="font-heading text-xl">קשר ישיר</h3>
              <p className="mt-2 text-[17px] leading-[1.6] text-primary-foreground/80">
                שאלה על ההמלצות? מדברים עם דורית עצמה, בטלפון או בוואטסאפ.
              </p>
              <div className="mt-4 flex flex-wrap gap-3">
                <a
                  href={`tel:${contact.phoneE164}`}
                  className="inline-flex items-center gap-2 min-h-11 text-highlight-on-dark underline underline-offset-4"
                >
                  <Phone size={16} aria-hidden="true" /> חיוג
                </a>
                <a
                  href={`https://wa.me/${contact.whatsapp}?text=${encodeURIComponent(contact.defaultWhatsappMessage)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 min-h-11 text-highlight-on-dark underline underline-offset-4"
                >
                  <MessageCircle size={16} aria-hidden="true" /> וואטסאפ
                </a>
              </div>
            </li>
            <li>
              <h3 className="font-heading text-xl">ליווי בתביעות</h3>
              <p className="mt-2 text-[17px] leading-[1.6] text-primary-foreground/80">
                כשמגיע הרגע להפעיל את הביטוח, דורית מנהלת את התביעה מול החברה בשמכם.
              </p>
            </li>
          </ul>
        </div>
      </section>

      {/* 5 — the tools */}
      <section aria-labelledby="tools-strip-title" className={SECTION}>
        <div className={WRAP}>
          <Eyebrow>כלים</Eyebrow>
          <h2 id="tools-strip-title" className={H2}>לבדוק לבד, לפני שמדברים</h2>
          <ul className="mt-10 max-md:mt-6 grid grid-cols-2 gap-5 max-md:gap-3 lg:grid-cols-4 list-none p-0">
            {TOOLS.map((tool) => (
              <li key={tool.title}>
                <a
                  href={tool.href}
                  className={`${CARD} group flex h-full min-h-11 flex-col hover:border-highlight transition-colors duration-200 ${
                    tool.isNew ? "border-highlight" : ""
                  }`}
                >
                  <span className="flex items-center justify-between gap-3">
                    {tool.isNew ? <FileSearch size={22} strokeWidth={1.5} className="text-highlight" aria-hidden="true" /> : <Calculator size={22} strokeWidth={1.5} className="text-highlight" aria-hidden="true" />}
                    {tool.isNew ? (
                      <span className="rounded-[4px] border border-highlight px-2 py-0.5 text-xs text-accent">חדש</span>
                    ) : null}
                  </span>
                  <span className="font-heading text-xl mt-4 max-md:mt-2 max-md:text-lg max-md:leading-snug">{tool.title}</span>
                  {/* The description is for the wider screens; on a phone the title says it. */}
                  <span className="mt-2 text-[17px] leading-[1.6] text-foreground/80 max-md:hidden">{tool.text}</span>
                  <span className="mt-auto pt-4 max-md:pt-2 inline-flex items-center gap-1 text-sm text-accent">
                    לכלי <ArrowLeft size={14} aria-hidden="true" className="transition-transform group-hover:-translate-x-0.5" />
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </>
  );
}
