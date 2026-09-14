import React from "react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

interface FAQItem {
  q: string;
  a: string;
}

const FAQS: FAQItem[] = [
  {
    q: "טיפ 1 · בדקו את דמי הניהול בכל מוצר — ולא רק בפנסיה",
    a: "הפרש של אחוז אחד בלבד בדמי ניהול מצטבר לעשרות אלפי שקלים לאורך השנים. בקשו מכל גוף מוסדי פירוט מדויק של דמי הניהול בקרן, בביטוח המנהלים ובקרן ההשתלמות, והשוו. במקרים רבים ניתן להוריד את העמלה במשא ומתן פשוט — גם מבלי לעבור קרן.",
  },
  {
    q: "טיפ 2 · אל תוותרו על כיסוי אובדן כושר עבודה",
    a: "ביטוח אובדן כושר עבודה הוא קו ההגנה הראשון שלכם — לא פחות חשוב מהחיסכון עצמו. ודאו שגובה הכיסוי תואם את ההכנסה הנוכחית, שתקופת ההמתנה מתאימה ליכולת הכלכלית שלכם, ושההגדרה 'עיסוק אובייקטיבי' מופיעה בפוליסה. רבים מגלים רק בעת תביעה שהכיסוי שלהם צר או לא רלוונטי.",
  },
  {
    q: "טיפ 3 · מקדישים שעה בשנה לביקורת תיק מסכמת",
    a: "מצב משפחתי, מקום עבודה ומצב בריאותי משתנים — ואיתם גם הכיסויים הנכונים. קבעו פגישת סיכום שנתית שבה עוברים יחד על כל המוצרים: פנסיה, ביטוחי בריאות, חיים ומשכנתא. עדכון שגרתי מונע פערים יקרים ומבטיח שהתיק עובד בשבילכם, לא בניגוד למטרות שלכם.",
  },
  {
    q: "טיפ 4 · חיסכון לילדים — כדאי להתחיל מהלידה",
    a: "הפקדה חודשית קטנה לחיסכון לילד מגיל חודשיים צומחת לאורך 20+ שנה לסכום משמעותי הודות לריבית דריבית. בחרו במוצר עם דמי ניהול נמוכים ונזילות גבוהה, והגדירו מראש את המטרה (לימודים, דירה, צבירת הון). ככל שמתחילים מוקדם יותר, ההון עובד זמן רב יותר לטובתכם.",
  },
  {
    q: "טיפ 5 · כיסוי בריאות משלים — לא כפילות מיותרת",
    a: "לפני רכישת ביטוח בריאות משלים, בדקו מה כבר מכסה קופת החולים שלכם והפנסיה הקיימת. רבים משלמים על כיסויים חופפים מבלי לדעת. המפתח הוא השלמה מדויקת של פערים — ניתוחים פרטיים, תרופות יקרות, אשפוז במחלקה סגורה — ולא רכישה גורפת של פוליסות נוספות.",
  },
  {
    q: "טיפ 6 · עצמאים — אל תדחו את ההפרשה הפנסיונית",
    a: "עצמאים שדוחים הפקדות 'עד שיהיה רווחי יותר' מפסידים הטבות מס משמעותיות ושנות צבירת הון שאינן חוזרות. התחילו בהפקדה חודשית קבועה, גם צנועה, והגדילו אותה עם הזמן. בנוסף, ודאו כיסוי אובדן כושר עבודה — ללא מעסיק שמפרנס, הוא קריטי פי כמה.",
  },
];

export default function FAQ() {
  return (
    <section id="faq" className="relative py-24 md:py-32 border-t border-border/50">
      <div className="max-w-[1400px] mx-auto px-6 md:px-10 grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-16">
        <div className="lg:col-span-4">
          <span className="text-[11px] tracking-[0.12em] text-accent">
            06 · בשפה פשוטה
          </span>
          <h2 className="font-heading text-4xl md:text-5xl mt-5 leading-tight">
            שאלות
            <br />
            שכדאי לשאול
          </h2>
          <div className="mt-6 h-px w-16 bg-highlight-muted/60" />
          <p className="mt-8 text-foreground/70 leading-relaxed max-w-sm">
            שישה טיפים אפקטיביים מהשטח — כדי שתדעו מה כדאי לבדוק, לשאול ולתקן עוד
            השנה. רוצים ליישם אותם על התיק שלכם? נעשה את זה יחד.
          </p>
        </div>

        <div className="lg:col-span-8">
          <Accordion type="single" collapsible className="border-t border-border/50">
            {FAQS.map((item, i) => (
              <AccordionItem
                key={i}
                value={`faq-${i}`}
                className="border-b border-border/50"
              >
                <AccordionTrigger className="text-right text-lg md:text-xl font-heading py-6 hover:no-underline hover:text-accent transition-colors [&[data-state=open]>svg]:text-highlight-muted">
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
  );
}