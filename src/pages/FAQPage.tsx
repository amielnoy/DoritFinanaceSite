import React, { useState } from "react";
import { Link } from "react-router-dom";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { ChevronLeft, HelpCircle, Phone, MessageCircle } from "lucide-react";
import FloatingHeader from "@/components/dorit/layout/FloatingHeader";
import Footer from "@/components/dorit/layout/Footer";
import { absoluteUrl, breadcrumbLd, useSeo } from "@/lib/seo";
import Reveal from "@/components/dorit/primitives/Reveal";
import CredentialsStrip from "@/components/dorit/primitives/CredentialsStrip";
import { CONTACT } from "@/config/contact";

interface QAItem {
  q: string;
  a: string;
}

interface FAQCategory {
  id: string;
  label: string;
  labelEn: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  items: QAItem[];
}

const CATEGORIES: FAQCategory[] = [
  {
    id: "tax",
    label: "מס הכנסה",
    labelEn: "Income Tax",
    icon: HelpCircle,
    items: [
      {
        q: "כיצד תכנון מס נכון חוסך בחיסכון הפנסיוני?",
        a: "תכנון מס נכון כולל ניצול הטבות מס בהפקדות לפנסיה, גמל והשתלמות, מיצוי זיכויים במס, ובחירת מוצרי חיסכון עם יחס מס נמוך. הפקדה לפנסיה מזכה בהטבת מס משמעותית עד לתקרה שנתית, ומשיכה כקצבה מזכה בהטבת מס נוספת. תכנון נכון יכול לחסוך עשרות אלפי שקלים בשנה.",
      },
      {
        q: "מהו תיקון 190 וכיצד הוא חוסך בדמי ניהול ופרמיה?",
        a: "תיקון 190 לחוק הפיקוח על שירותים פיננסיים מאפשר העברת כספים בין ביטוחי מנהלים ומוצרים פנסיוניים תוך הורדת דמי ניהול ופרמיה. באמצעות משא ומתן מול הגוף המוסדי ניתן להפחית משמעותית את עלויות החיסכון הפנסיוני ולשפר את התשואה לטווח ארוך.",
      },
      {
        q: "מה זה מס שולי ואיך הוא משפיע על החיסכון שלי?",
        a: "מס שולי הוא האחוז שאתם משלמים על כל שקל נוסף שאתם מרוויחים. ככל שההכנסה גבוהה יותר, כך המס השולי גבוה יותר. הפקדה לפנסיה מזכה בזיכוי מס בשיעור המס השולי שלכם — כלומר ככל שהמס השולי גבוה יותר, כך ההטבה גדולה יותר. לשכירים במס שולי גבוה, ההפקדה לפנסיה היא אחד הכלים היעילים ביותר לחיסכון במס.",
      },
      {
        q: "האם כדאי למשוך פיצויים כסכום חד-פעמי או כקצבה?",
        a: "משיכת פיצויים כקצבה (מגיל 60) מזכה בהטבת מס משמעותית — פטור עד 8,880 ₪ לחודש (נכון ל-2026) ויתרה במס מופחת. משיכה כסכום חד-פעמי צמוד למס רגיל. ברוב המקרים, המשיכה כקצבה כדאית יותר מבחינת מס — אך ההחלטה תלויה במצב האישי, בגיל ובצרכי הון מיידיים.",
      },
      {
        q: "איך מקבלים החזר מס על הפקדות לפנסיה?",
        a: "שכירים שמפקידים לפנסיה דרך המעסיק מקבלים את ההטבה באופן אוטומטי בתלוש השכר. עצמאים ושכירים שמפקידים באופן עצמאי צריכים לדרוש את הזיכוי במס בדוח השנתי (שנתי או דו-שנתי). ניתן לקבל החזר מס רטרואקטיבי על הפקדות שלא תואמו בעבר — עד 6 שנים אחורה.",
      },
    ],
  },
  {
    id: "pension",
    label: "פנסיה וחיסכון",
    labelEn: "Pension & Savings",
    icon: HelpCircle,
    items: [
      {
        q: "מה ההבדל בין פנסיה, גמל והשתלמות?",
        a: "פנסיה מיועדת לחיסכון ארוך טווח לגיל פרישה ומשלמת קצבה חודשית. קרן גמל היא חיסכון לטווח בינוני-ארוך עם אפשרות משיכה הונית מגיל 60. קרן השתלמות היא חיסכון לטווח קצר-בינוני (6 שנים לפחות) עם פטור ממס על הרווחים. כל מוצר מתאים למטרות חיסכון שונות.",
      },
      {
        q: "כיצד ניתן להוריד דמי ניהול בפנסיה, גמל והשתלמות?",
        a: "דמי ניהול מצטברים לעשרות אלפי שקלים לאורך שנות החיסכון. ניתן להורידם באמצעות משא ומתן עם הגוף המוסדי — קרנות פנסיה, קרנות גמל וקרנות השתלמות — העברת כספים לגוף עם דמי ניהול נמוכים יותר, או ניצול תיקון 190. גם הפרש של אחוז אחד בלבד מצטבר לסכום משמעותי לאורך השנים.",
      },
      {
        q: "כיצד משפרים תשואות בקרנות פנסיה וגמל?",
        a: "שיפור תשואות מושג באמצעות בחירת מסלולי השקעה המתאימים לגיל ולמצב הכלכלי, הפחתת דמי ניהול, פיזור נכון של הנכסים ומעקב שוטף אחר ביצועי הקרן. התאמה אישית של מסלול ההשקעה יכולה להוסיף אחוזי תשואה משמעותיים לאורך זמן.",
      },
      {
        q: "מתי כדאי לאחד קרנות פנסיה וגמל?",
        a: "איחוד קרנות כדאי כאשר יש מספר קרנות עם דמי ניהול גבוהים, קושי במעקב אחר התיק, או כאשר ניתן לקבל תנאים טובים יותר בקרן אחת. איחוד מפחית עלויות, מקל על ניהול ומעקב, ומאפשר התאמה מדויקת יותר של מסלול ההשקעה. עם זאת, לפעמים פיזור בין קרנות עדיף — ההחלטה תלויה בנסיבות האישיות.",
      },
      {
        q: "חיסכון לילדים — כדאי להתחיל מהלידה?",
        a: "בהחלט. הפקדה חודשית קטנה לחיסכון לילד מגיל חודשיים צומחת לאורך 20+ שנה לסכום משמעותי הודות לריבית דריבית. בחרו במוצר עם דמי ניהול נמוכים ונזילות גבוהה, והגדירו מראש את המטרה (לימודים, דירה, צבירת הון). ככל שמתחילים מוקדם יותר, ההון עובד זמן רב יותר לטובתכם.",
      },
      {
        q: "עצמאים — אל תדחו את ההפרשה הפנסיונית",
        a: "עצמאים שדוחים הפקדות 'עד שיהיה רווחי יותר' מפסידים הטבות מס משמעותיות ושנות צבירת הון שאינן חוזרות. התחילו בהפקדה חודשית קבועה, גם צנועה, והגדילו אותה עם הזמן. בנוסף, ודאו כיסוי אובדן כושר עבודה — ללא מעסיק שמפרנס, הוא קריטי פי כמה.",
      },
    ],
  },
  {
    id: "insurance",
    label: "ביטוח",
    labelEn: "Insurance",
    icon: HelpCircle,
    items: [
      {
        q: "ביטוח בריאות משלים — כדאי, ואיך נמנעים כפילויות?",
        a: "לפני רכישת ביטוח בריאות משלים, בדקו מה כבר מכסה קופת החולים שלכם והפנסיה הקיימת. רבים משלמים על כיסויים חופפים מבלי לדעת. המפתח הוא השלמה מדויקת של פערים — ניתוחים פרטיים, תרופות יקרות, אשפוז במחלקה סגורה — ולא רכישה גורפת של פוליסות נוספות.",
      },
      {
        q: "מה זה קיבוע זכויות ולמה זה חשוב?",
        a: "קיבוע זכויות הוא תהליך שבו מבוטח מקבע את הזכויות הרפואיות שלו בביטוח בריאות וביטוח חיים, כך ששינויים במצב הבריאותי בעתיד לא יפגעו בכיסוי הביטוחי. קיבוע זכויות חשוב כי הוא מבטיח כיסוי מלא גם אם מצב הבריאות משתנה, ומונע דחיית תביעות עקב מצב רפואי קודם.",
      },
      {
        q: "אל תוותרו על כיסוי אובדן כושר עבודה",
        a: "ביטוח אובדן כושר עבודה הוא קו ההגנה הראשון שלכם — לא פחות חשוב מהחיסכון עצמו. ודאו שגובה הכיסוי תואם את ההכנסה הנוכחית, שתקופת ההמתנה מתאימה ליכולת הכלכלית שלכם, ושההגדרה 'עיסוק אובייקטיבי' מופיעה בפוליסה. רבים מגלים רק בעת תביעה שהכיסוי שלהם צר או לא רלוונטי.",
      },
      {
        q: "האם ניתן לעבור אלייך מסוכן קודם?",
        a: "בהחלט. מעבר סוכן הוא תהליך פשוט שאינו כרוך בעלות ואינו פוגע ברצף הכיסויים שלכם. אני מטפלת בכל ההעברה וההסברה מול הגופים המוסדיים.",
      },
      {
        q: "מה קורה כשמשתנה מצב משפחתי או מקצועי?",
        a: "כל שינוי משפיע על הכיסויים הנכונים. בכל שינוי — נישואין, לידה, גירושין, דירה חדשה או מעבר לעצמאות — נשב יחד ונתאים את התיק למציאות החדשה.",
      },
    ],
  },
  {
    id: "general",
    label: "כללי",
    labelEn: "General",
    icon: HelpCircle,
    items: [
      {
        q: "האם פגישת הייעוץ הראשונה כרוכה בעלות?",
        a: "פגישת הייעוץ הראשונה ללא עלות וללא התחייבות. מטרתה להכיר את הצורך שלכם ולהציע כיוון ברור — רק אם תבחרו להמשיך, נתקדם יחד.",
      },
      {
        q: "האם את עצמאית או משויכת לחברת ביטוח מסוימת?",
        a: "אני סוכנת עצמאית העובדת מול כל חברות הביטוח והפנסיה בישראל. ההמלצה נגזרת אך ורק מהצורך שלכם — לא משייכות מסחרית כלשהי.",
      },
      {
        q: "מה כולל הליווי לאורך החיים?",
        a: "ביקורת תיק שנתית, עדכון כיסויים בכל שינוי חיים (נישואין, לידה, דירה, עצמאות), מו\"ב מול החברות על דמי ניהול ותנאים, וליווי צמוד בעת תביעה — הכל תחת קורת גג אחת.",
      },
      {
        q: "כיצד מתנהל הליווי בעת תביעה?",
        a: "אני נוטלת את ניהול התביעה מול החברה על עצמי — השלמת תיעוד, מעקב והופעה בשמכם עד לקבלת הכיסוי המלא. ברוב המקרים לא תצטרכו להרים טלפון.",
      },
      {
        q: "האם ניתן לקיים פגישות גם מרחוק?",
        a: "כן. פגישות ניתן לקיים במשרד בתל אביב, בזום או בטלפון — לפי הנוחות שלכם. הליווי עצמו זהה בכל פורמט.",
      },
      {
        q: "כיצד נשמרת סודיות המידע שלי?",
        a: "כל המידע שאתם מוסרים נשמר בסודיות מלאה, בכפוף לחוק הגנת הפרטיות ולמדיניות הפרטיות של המשרד. אינו מועבר לצד ג' ללא הסכמתכם.",
      },
      {
        q: "באיזו תדירות כדאי לבצע ביקורת תיק מסכמת?",
        a: "מצב משפחתי, מקום עבודה ומצב בריאותי משתנים — ואיתם גם הכיסויים הנכונים. כדאי לקבוע פגישת סיכום שנתית שבה עוברים יחד על כל המוצרים: פנסיה, גמל, השתלמות וביטוחים. עדכון שגרתי מונע פערים יקרים ומאפשר הורדת עלויות ושיפור תשואות.",
      },
    ],
  },
];

export default function FAQPage() {
  useSeo({
    title: "שאלות ותשובות — פנסיה, גמל, ביטוח ומיסוי | דורית גוב ארי",
    description:
      "תשובות ברורות לשאלות הנפוצות על פנסיה, קרנות השתלמות, דמי ניהול, קיבוע זכויות, תיקון 190 וביטוחי חיים ובריאות.",
    path: "/faq",
    jsonLd: [
      breadcrumbLd([
        { name: "ראשי", path: "/" },
        { name: "שאלות ותשובות", path: "/faq" },
      ]),
      {
        "@context": "https://schema.org",
        "@type": "CollectionPage",
        name: "שאלות ותשובות",
        url: absoluteUrl("/faq"),
        inLanguage: "he-IL",
      },
    ],
  });

  const [activeCat, setActiveCat] = useState<string>(CATEGORIES[0].id);
  const current = CATEGORIES.find((c) => c.id === activeCat)!;

  return (
    <div className="min-h-screen bg-background">
      <FloatingHeader />

      <main className="pt-32 md:pt-40">
        {/* Hero */}
        <section className="relative max-w-[1400px] mx-auto px-6 md:px-10 pb-12 md:pb-16">
          <Reveal>
            <span className="text-[11px] tracking-[0.12em] text-accent">
              שאלות ותשובות
            </span>
            <h1 className="font-heading text-5xl md:text-6xl mt-5 leading-tight max-w-3xl">
              שאלות
              <br />
              ותשובות
            </h1>
            <p className="mt-8 text-lg text-foreground/70 max-w-2xl leading-relaxed">
              מענה מהיר לנושאים מרכזיים במס הכנסה, פנסיה וביטוח. בחרו את הנושא
              שמעניין אתכם — ואם לא מצאתם את התשובה, אשמח לענות אישית.
            </p>
          </Reveal>
        </section>

        <div className="max-w-[1400px] mx-auto px-6 md:px-10">
          <CredentialsStrip />
        </div>

        {/* Category tabs + accordion */}
        <section className="relative py-16 md:py-24">
          <div className="max-w-[1400px] mx-auto px-6 md:px-10 grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-16">
            {/* Sidebar */}
            <aside className="lg:col-span-4">
              <div className="lg:sticky lg:top-32">
                <p className="text-[11px] tracking-[0.12em] text-muted-foreground mb-5">
                  ניווט לפי נושא
                </p>
                <div className="flex lg:flex-col gap-2 overflow-x-auto lg:overflow-visible pb-2 lg:pb-0">
                  {CATEGORIES.map((cat) => {
                    const active = cat.id === activeCat;
                    return (
                      <button
                        key={cat.id}
                        onClick={() => setActiveCat(cat.id)}
                        className={`flex items-center gap-3 px-5 py-4 border transition-all duration-300 text-right whitespace-nowrap lg:whitespace-normal ${
                          active
                            ? "bg-primary text-primary-foreground border-primary"
                            : "border-border hover:border-accent hover:bg-secondary/40"
                        }`}
                      >
                        <cat.icon size={18} className={active ? "text-highlight" : "text-accent"} />
                        <span className="font-heading text-lg">{cat.label}</span>
                      </button>
                    );
                  })}
                </div>

                <div className="mt-8 p-6 border border-border/60 bg-secondary/30">
                  <p className="font-heading text-xl mb-2">לא מצאתם תשובה?</p>
                  <p className="text-sm text-foreground/70 leading-relaxed mb-5">
                    שאלו אותי ישירות — אחזור אליכם אישית תוך יום עסקים אחד.
                  </p>
                  <a
                    href="/#consultation"
                    className="inline-flex items-center gap-2 px-5 py-3 bg-highlight text-primary font-medium hover:bg-highlight-strong transition-colors w-full justify-center"
                  >
                    יצירת קשר
                  </a>
                </div>
              </div>
            </aside>

            {/* Accordion */}
            <div className="lg:col-span-8">
              <div className="mb-6">
                <h2 className="font-heading text-3xl md:text-4xl">{current.label}</h2>
                <p className="text-sm tracking-[0.2em] uppercase text-accent mt-2">
                  {current.labelEn} · {current.items.length} שאלות
                </p>
              </div>
              <Accordion type="single" collapsible className="border-t border-border/60">
                {current.items.map((item, i) => (
                  <AccordionItem
                    key={`${activeCat}-${i}`}
                    value={`${activeCat}-${i}`}
                    className="border-b border-border/60"
                  >
                    <AccordionTrigger className="text-right text-lg md:text-xl font-heading py-6 hover:no-underline hover:text-accent transition-colors [&[data-state=open]>svg]:text-highlight">
                      {item.q}
                    </AccordionTrigger>
                    <AccordionContent className="text-foreground/70 leading-relaxed text-base pb-6">
                      {item.a}
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="relative py-24 md:py-32 border-t border-border/60 bg-primary text-primary-foreground">
          <div className="max-w-3xl mx-auto px-6 text-center">
            <Reveal>
              <h2 className="font-heading text-4xl md:text-5xl leading-tight">
                עדיין מתלבטים?
              </h2>
              <p className="mt-6 text-primary-foreground/70 leading-relaxed">
                כל שאלה ראויה לתשובה אישי. נשוחח — ונבנה יחד את התכנון הנכון עבורכם.
              </p>
              <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
                <a
                  href="/#consultation"
                  className="inline-flex items-center gap-2 px-7 py-3.5 bg-highlight text-primary font-medium hover:bg-highlight-strong transition-colors"
                >
                  קביעת פגישת ייעוץ
                </a>
                <a
                  href={`tel:${CONTACT.phoneE164}`}
                  className="inline-flex items-center gap-2 px-7 py-3.5 border border-primary-foreground/30 text-primary-foreground font-medium hover:border-highlight hover:text-highlight transition-colors"
                >
                  <Phone size={18} />
                  <span dir="ltr">{CONTACT.phoneDisplay}</span>
                </a>
                <a
                  href={`https://wa.me/${CONTACT.whatsapp}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 px-7 py-3.5 border border-primary-foreground/30 text-primary-foreground font-medium hover:border-highlight hover:text-highlight transition-colors"
                >
                  <MessageCircle size={18} />
                  WhatsApp
                </a>
              </div>
              <Link
                to="/"
                className="mt-10 inline-flex items-center gap-1 text-sm text-primary-foreground/60 hover:text-highlight transition-colors"
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