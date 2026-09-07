import React from "react";
import FloatingHeader from "@/components/dorit/FloatingHeader";
import Footer from "@/components/dorit/Footer";

export default function PrivacyPolicy() {
  return (
    <div id="top">
      <FloatingHeader />
      <main className="max-w-3xl mx-auto px-6 md:px-10 pt-32 md:pt-40 pb-24">
        <span className="text-[11px] tracking-[0.35em] uppercase text-accent">Legal</span>
        <h1 className="font-heading text-4xl md:text-5xl mt-4 leading-tight">
          מדיניות פרטיות
        </h1>
        <p className="text-sm text-muted-foreground mt-3">עודכן: ספטמבר 2026</p>

        <div className="mt-12 space-y-10 leading-relaxed text-foreground/80">
          <section>
            <h2 className="font-heading text-2xl mb-3">1. הקדמה</h2>
            <p>
              דורית גוב ארי — סוכנות ביטוח בע״מ (להלן: &quot;הסוכנות&quot; או
              &quot;אנחנו&quot;) מכבדת את פרטיותך. מדיניות זו מפרטת אילו פרטים
              אנו אוספים באתר, לשם מה, כיצד אנו משתמשים בהם, עם מי הם משותפים
              ומה זכויותיך על-פי חוק הגנת הפרטיות, התשמ״א–1981, ותיקון מס׳ 13
              לחוק (הוראות מידע ומאגרי מידע).
            </p>
          </section>

          <section>
            <h2 className="font-heading text-2xl mb-3">2. הפרטים שאנו אוספים</h2>
            <p>דרך טפסי האתר אנו אוספים את הפרטים הבאים שאת/ה מוסר/ת מרצון:</p>
            <ul className="list-disc pr-6 mt-3 space-y-1.5">
              <li>שם מלא</li>
              <li>מספר טלפון</li>
              <li>כתובת דוא״ל</li>
              <li>תוכן הודעה / הערות (לרבות תחום הייעוץ המבוקש ומועד)</li>
            </ul>
          </section>

          <section>
            <h2 className="font-heading text-2xl mb-3">3. מטרות העיבוד</h2>
            <p>הפרטים נאספים למטרות הבאות בלבד:</p>
            <ul className="list-disc pr-6 mt-3 space-y-1.5">
              <li>יצירת קשר ותיאום פגישת ייעוץ</li>
              <li>מתן שירותי ייעוץ ביטוחי ופיננסי</li>
              <li>שליחת אישורים, עדכונים ומסמכים רלוונטיים</li>
              <li>מילוי חובות חוקיות ורגולטוריות, לרבות מול רשות שוק ההון</li>
            </ul>
          </section>

          <section>
            <h2 className="font-heading text-2xl mb-3">4. בסיס חוקי</h2>
            <p>
              העיבוד נעשה על בסיס הסכמתך למסירת הפרטים, וכן לשם ביצוע הסכם
              או פעולה על-פי בקשתך, טרם כריתת חוזה למתן שירות.
            </p>
          </section>

          <section>
            <h2 className="font-heading text-2xl mb-3">5. שיתוף והעברת מידע</h2>
            <p>
              לא נמסור את פרטיך לצד ג׳ שלישי למטרות שיווק ללא הסכמתך. ייתכן
              שנעביר פרטים לחברות ביטוח לשם הנפקת פוליסות או טיפול בתביעות
              בהתאם לבקשתך, ולרשויות מפקחות ככל שהדבר נדרש על-פי דין.
            </p>
          </section>

          <section>
            <h2 className="font-heading text-2xl mb-3">6. שמירת המידע ואבטחתו</h2>
            <p>
              המידע נשמר במשך התקופה הנדרשת למימוש מטרות האיסוף ולעמידה בחובות
              חוקיות. אנו נוקטים אמצעי אבטחה סבירים להגנה על המידע מפני גישה
              בלתי מורשית, אובדן או שינוי.
            </p>
          </section>

          <section>
            <h2 className="font-heading text-2xl mb-3">7. זכויותיך (תיקון 13)</h2>
            <p>על-פי חוק הגנת הפרטיות, זכאי/ת את/ה ל:</p>
            <ul className="list-disc pr-6 mt-3 space-y-1.5">
              <li>לדעת אילו פרטים אודותיך מוחזקים אצלנו ולקבל עותק מהם</li>
              <li>לתקן פרט שגוי או למחוק פרטים שאינם נדרשים עוד</li>
              <li>להתנגד לעיבוד ולמחוק הסכמה שניתנה</li>
              <li>להגיש תלונה לרשם מאגרי המידע במשרד המשפטים</li>
            </ul>
            <p className="mt-3">
              למימוש הזכויות, ניתן לפנות אלינו בכתובת הדוא״ל או בטלפון המפורסמים
              באתר.
            </p>
          </section>

          <section>
            <h2 className="font-heading text-2xl mb-3">8. אחראי לפרטיות</h2>
            <p>
              האחראי לענייני פרטיות בסוכנות הוא דורית גוב ארי. ניתן לפנות
              בכתובת dorit@gov-ari.co.il או בטלפון המפורסם באתר.
            </p>
          </section>
        </div>

        <div className="mt-14 pt-6 border-t border-border/60">
          <a href="/" className="text-sm text-accent hover:underline underline-offset-4">
            חזרה לדף הבית
          </a>
        </div>
      </main>
      <Footer />
    </div>
  );
}