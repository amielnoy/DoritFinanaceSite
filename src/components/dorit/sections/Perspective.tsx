import React from "react";
import { Quote } from "lucide-react";
import Eyebrow from "@/components/dorit/primitives/Eyebrow";

interface Guideline {
  n: string;
  title: string;
  body: string;
}

const GUIDELINES: Guideline[] = [
  {
    n: "01",
    title: "היעזרו באנשי מקצוע מנוסים",
    body: "אנשי מקצוע שחיים את השוק ביומיום ויודעים להתאים בזמן אמת את הפעולות לצרכים האישיים שלכם — לא תבניות גנריות, אלא החלטות מדויקות.",
  },
  {
    n: "02",
    title: "אל תפעלו בחיפזון",
    body: "ברוב המקרים אין צורך לשנות באופן קיצוני את רמת הסיכון. קיצוץ עמדות בעיצומם של מבצעים עלול לפגוע ברווחיות לשנים ארוכות.",
  },
  {
    n: "03",
    title: "אמצו פיזור ואיזון",
    body: "חלקו את הכספים בין אפיקים שונים — בארץ ובחו״ל, חשיפה למט״ח ולמטבע המקומי, חלוקה נכונה בין מניות ואג״ח. פיזור הופך את ההשקעה למאזנת את עצמה.",
  },
  {
    n: "04",
    title: "שמרו על נזילות",
    body: "נזילות של חלק מהכספים היא יצירת ביטחון כלכלי. וכדאי לזכור — משבר יוצר גם הזדמנויות שנוכל לנצל במקרה הצורך.",
  },
  {
    n: "05",
    title: "אופטימיות וראייה ארוכת טווח",
    body: "ממלחמות העבר למדנו שלאחריהן (למעט יום כיפור) היתה עלייה מהירה של השוק, אפילו מעבר לרמה שלפניהן. גם המלחמה הזו, בסופו של דבר, תהיה מאחורינו.",
  },
];

export default function Perspective() {
  return (
    <section id="perspective" className="relative py-24 md:py-32 border-y border-border/50 bg-secondary/30">
      <div className="max-w-[1400px] mx-auto px-6 md:px-10">
        {/* Header */}
        <div className="max-w-3xl mb-16">
          <Eyebrow>
            נקודת מבט · מתוך השטח
          </Eyebrow>
          <h2 className="font-heading text-4xl md:text-6xl mt-5 leading-tight">
            בזמנים לא ודאיים,
            <br />
            הקול השקול הוא הנכס
          </h2>
          <div className="mt-6 h-px w-16 bg-highlight-muted/60" />
        </div>

        {/* Anecdote in her voice */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-16 mb-20">
          <div className="lg:col-span-7 space-y-6 text-foreground/80 leading-relaxed">
            <p>
              מיד אחרי ה-7 באוקטובר התחילו לפנות אליי לקוחות רבים. כמעט כל שיחה
              נפתחה בהתנצלות: <span className="text-foreground">״הכל בסדר אצלך?״, ״אפשר לדבר עכשיו?״, ״אני מצטער שאני פונה, אבל...״</span> —
              כאילו הרגישו נבוכים להטריד אותי ב״שטויות שלהם״ בזמן מלחמה.
            </p>
            <p>
              אבל אין דבר רחוק יותר מ״שטויות״. משבר כלכלי מביא חוסר יציבות ומצבי
              קיצון, אך לפני ההיבטים הכלכליים נדרשת הכרה בעובדה שמשבר כזה שזור
              בהתמודדויות נפשיות לא פשוטות — חוסר ודאות, חרדות, דאגה לקרובים
              ולמקום מגורים בטוח. ולכן, גם כשמתנהלת מלחמה, נדרש לפעול באופן שקול
              ואחראי — מתוך שיקולים כלכליים ולא מתוך אמוציות.
            </p>
          </div>

          <aside className="lg:col-span-5 lg:border-r lg:border-border/50 lg:pr-12 flex flex-col justify-center">
            <Quote size={32} className="text-highlight-muted mb-5" strokeWidth={1.25} />
            <p className="font-heading text-2xl md:text-3xl leading-snug">
              ״הלקוחות שלי לא צריכים להתנצל. החיים הכלכליים שלהם הם בדיוק
              המקום שבו האנושיות והמקצועיות נפגשות.״
            </p>
            <p className="mt-5 text-sm tracking-[0.2em] uppercase text-muted-foreground">
              — דורית גוב ארי
            </p>
          </aside>
        </div>

        {/* Guidelines */}
        <div className="border-t border-border/50">
          <p className="text-sm tracking-[0.2em] uppercase text-accent mt-10 mb-8">
            חמישה עקרונות לניהול כלכלי בזמן משבר
          </p>
          <div className="divide-y divide-border/50">
            {GUIDELINES.map((g) => (
              <div
                key={g.n}
                className="group grid grid-cols-1 md:grid-cols-12 gap-4 md:gap-8 py-7 transition-colors duration-300 hover:bg-secondary/40 -mx-4 md:-mx-6 px-4 md:px-6"
              >
                <div className="md:col-span-2 font-heading text-3xl md:text-4xl text-highlight-ink transition-transform duration-300 group-hover:scale-110">
                  {g.n}
                </div>
                <h3 className="md:col-span-4 font-heading text-xl md:text-2xl self-center">
                  {g.title}
                </h3>
                <p className="md:col-span-6 text-foreground/70 leading-relaxed self-center">
                  {g.body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}