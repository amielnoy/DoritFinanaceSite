import React from "react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import Reveal from "@/components/dorit/Reveal";

interface QAItem {
  q: string;
  a: string;
}

const QA: QAItem[] = [
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
    q: "האם ניתן לעבור אלייך מסוכן קודם?",
    a: "בהחלט. מעבר סוכן הוא תהליך פשוט שאינו כרוך בעלות ואינו פוגע ברצף הכיסויים שלכם. אני מטפלת בכל ההעברה וההסברה מול הגופים המוסדיים.",
  },
  {
    q: "מה קורה כשמשתנה מצב משפחתי או מקצועי?",
    a: "כל שינוי משפיע על הכיסויים הנכונים. בכל שינוי — נישואין, לידה, גירושין, דירה חדשה או מעבר לעצמאות — נשב יחד ונתאים את התיק למציאות החדשה.",
  },
  {
    q: "האם ניתן לקיים פגישות גם מרחוק?",
    a: "כן. פגישות ניתן לקיים במשרד בתל אביב, בזום או בטלפון — לפי הנוחות שלכם. הליווי עצמו זהה בכל פורמט.",
  },
  {
    q: "כיצד נשמרת סודיות המידע שלי?",
    a: "כל המידע שאתם מוסרים נשמר בסודיות מלאה, בכפוף לחוק הגנת הפרטיות ולמדיניות הפרטיות של המשרד. אינו מועבר לצד ג' ללא הסכמתכם.",
  },
];

export default function DetailedFAQ() {
  return (
    <section
      id="common-questions"
      className="relative py-24 md:py-32 border-t border-border/60 bg-secondary/40"
    >
      <div className="max-w-[1400px] mx-auto px-6 md:px-10 grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-16">
        <div className="lg:col-span-4">
          <Reveal>
            <span className="text-[11px] tracking-[0.35em] uppercase text-accent">
              08 · Your Questions, Answered
            </span>
            <h2 className="font-heading text-4xl md:text-5xl mt-5 leading-tight">
              שאלות
              <br />
              נפוצות
            </h2>
            <p className="mt-8 text-foreground/70 leading-relaxed max-w-sm">
              התשובות לשאלות שלקוחות שואלים אותי לעיתים קרובות — לפני פגישת
              הייעוץ הראשונה. אם לא מצאתם את התשובה שחיפשתם, נשמח לענות אישית.
            </p>
            <a
              href="#consultation"
              className="mt-8 inline-flex items-center px-6 py-3 bg-[#C4A484] text-primary font-medium hover:bg-[#b8916f] transition-colors duration-300"
            >
              שאלה אישית? נשוחח
            </a>
          </Reveal>
        </div>

        <div className="lg:col-span-8">
          <Accordion type="single" collapsible className="border-t border-border/60">
            {QA.map((item, i) => (
              <AccordionItem
                key={i}
                value={`cq-${i}`}
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