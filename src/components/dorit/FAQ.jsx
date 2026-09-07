import React from "react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

const FAQS = [
  {
    q: "מתי כדאי להתחיל לחסוך לפנסיה?",
    a: "בכל גיל — אבל ככל שמתחילים מוקדם יותר, ההון שצומח עובד לטובתכם זמן רב יותר. גם הפקדה חודשית קטנה בתחילת הדרך יכולה להפוך להון משמעותי לאורך עשרות שנים, בזכות ריבית דריבית. יחד נבחן את המצב הנוכחי שלכם ונקבע את הנקודה הנכונה להתחיל — או להגביר.",
  },
  {
    q: "מה ההבדל בין קרן פנסיה, קרן השתלמות וביטוח מנהלים?",
    a: "אלו שלושה מכשירי חיסכון שונים, כל אחד עם יתרונות מס ותנאי נזילות משלו. קרן פנסיה מיועדת לפנסיה תקנית עם פטור מס משמעותי; קרן השתלמות מאפשרת נזילות כל 6 שנים; ביטוח מנהלים גמיש ומתאים לעצמאים ולחיסכון בלתי-מוסדי. הבחירה תלויה במצב התעסוקתי, במטרות ובאופק. אעזור לכם למפות את התמונה המלאה.",
  },
  {
    q: "האם כדאי לי לעבור מקרן לקרן או להישאר בקרם הנוכחית?",
    a: "לא תמיד. מעבר בין קרנות יכול לחסוך דמי ניהול, אך עלול גם לפגוע ברצף זכויות ובכיסויים שנבנו לאורך זמן. לפני כל החלטה אני מבצעת השוואה מדויקת בין הקרנות — עמלות, תשואות, כיסויים ויציבות — כדי שהמעבר, אם ייעשה, יהיה מבוסס נתונים ולא תחושת בטן.",
  },
  {
    q: "מה קורה לחיסכון שלי אם אני עובר בין מקומות עבודה?",
    a: "הכספים שצברתם נשארים שלכם — הם ניידים. ניתן להמשיך להפקיד באותה קרן, להעביר לקרן אחרת, או לעבור למסלול עצמאי. הדבר החשוב הוא לא להשאיר את הכסף 'נטוש' ללא מעקב. נוודא יחד שהחיסכון שלכם ממשיך לעבוד גם בין מעברים.",
  },
  {
    q: "כמה באמת משלמים בדמי ניהול — והאם אפשר להוריד?",
    a: "דמי ניהול נמוכים באחוז אחד בלבד יכולים להצטבר לעשרות אלפי שקלים לאורך השנים. רבים משלמים יותר מהנדרש מבלי לדעת. במסגרת הייעוץ אני מנתחת את דמי הניהול בכל המוצרים שלכם ובודקת היכן ניתן לייעל — לעיתים במשא ומתן מול הגופים המוסדיים.",
  },
  {
    q: "האם חיסכון פנסיוני מתאים גם לעצמאים?",
    a: "בהחלט — ואף הכרחי. עצמאים שאינם מפרישים באופן סדיר עלולים למצוא את עצמם ללא פנסיה בגיל פרישה, וגם ללא כיסויים בעת אובדן כושר עבודה. קיימים מסלולים ייעודיים לעצמאים עם הטבות מס משמעותיות. נבנה יחד תוכנית חיסכון שמתאימה לאופי ההכנסה שלכם.",
  },
];

export default function FAQ() {
  return (
    <section id="faq" className="relative py-24 md:py-32 border-t border-border/60">
      <div className="max-w-[1400px] mx-auto px-6 md:px-10 grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-16">
        <div className="lg:col-span-4">
          <span className="text-[11px] tracking-[0.35em] uppercase text-accent">
            Clarity, Not Jargon
          </span>
          <h2 className="font-heading text-4xl md:text-5xl mt-5 leading-tight">
            שאלות
            <br />
            שכדאי לשאול
          </h2>
          <p className="mt-8 text-foreground/70 leading-relaxed max-w-sm">
            הנושאים שמעסיקים לקוחות לפני פגישת הייעוץ הראשונה. אם השאלה שלכם לא
            מופיעה כאן — נשמח לענות עליה אישית.
          </p>
        </div>

        <div className="lg:col-span-8">
          <Accordion type="single" collapsible className="border-t border-border/60">
            {FAQS.map((item, i) => (
              <AccordionItem
                key={i}
                value={`faq-${i}`}
                className="border-b border-border/60"
              >
                <AccordionTrigger className="text-right text-lg md:text-xl font-heading py-6 hover:no-underline hover:text-accent transition-colors [&[data-state=open]>svg]:text-[#C4A484]">
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