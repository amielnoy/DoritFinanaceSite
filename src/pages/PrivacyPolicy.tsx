import React from "react";
import FloatingHeader from "@/components/dorit/layout/FloatingHeader";
import Footer from "@/components/dorit/layout/Footer";
import { breadcrumbLd, useSeo } from "@/lib/seo";
import CredentialsStrip from "@/components/dorit/primitives/CredentialsStrip";
import { useAgencyContent } from "@/hooks/useAgencyContent";
import { MEETINGS_CLIENT } from "@/config/meetings";
import { LEAD_BRIEFING } from "@/config/lead-briefing";
import { STAFF_LEADS } from "@/config/staff-leads";
import { STAFF_CLIENTS } from "@/config/staff-clients";

export default function PrivacyPolicy() {
  const { contact } = useAgencyContent();
  useSeo({
    title: "מדיניות פרטיות | דורית גוב ארי",
    description:
      "כיצד נאספים, נשמרים ומשמשים הפרטים שאתם מוסרים באתר — ומהן זכויותיכם לגבי המידע האישי שלכם.",
    path: "/privacy",
    jsonLd: [
      breadcrumbLd([
        { name: "ראשי", path: "/" },
        { name: "מדיניות פרטיות", path: "/privacy" },
      ]),
    ],
  });

  return (
    <div id="top">
      <FloatingHeader />
      <main id="main" className="max-w-3xl mx-auto px-6 md:px-10 pt-32 md:pt-40 pb-24">
        <span className="text-sm text-accent">Legal</span>
        <h1 className="font-heading text-4xl md:text-5xl mt-4 leading-tight">
          מדיניות פרטיות
        </h1>
        <p className="text-sm text-muted-foreground mt-3">עודכן: אוקטובר 2026</p>

        <CredentialsStrip />

        <div className="mt-12 space-y-10 leading-relaxed text-foreground/80">
          <section>
            <h2 className="font-heading text-2xl mb-3">1. הקדמה</h2>
            <p>
              דורית גוב ארי — מתכננת פיננסית וסוכנת ביטוח (להלן: &quot;דורית&quot; או
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
              <li>תוכן הודעה / הערות (לרבות נושא הפגישה המבוקש ומועד)</li>
            </ul>
            {/* With clients added by hand (VITE_STAFF_LEADS and VITE_STAFF_CLIENTS): shown with the feature and not before it. DRAFT for the compliance adviser, with the staff-client-v1 notice. */}
            {STAFF_LEADS && STAFF_CLIENTS ? (
              <p className="mt-3">
                מי שכבר לקוח/ה של הסוכנות: צוות הסוכנות עשוי לפתוח עבורך רשומה במאגר גם בלי
                טופס באתר, על סמך הסכם ההתקשרות — שם, טלפון, דוא״ל, החודש שבו החלה ההתקשרות
                ותחומי השירות. הרשומה משמשת לאותן מטרות, גלויה לצוות הסוכנות בלבד, ונשמרת
                כמידע הנוגע להתקשרות בפועל (סעיף 7). אם נמסרה כתובת דוא״ל, ייתכן שתישלח
                אליה הזמנה לאזור האישי.
              </p>
            ) : null}
          </section>

          <section>
            <h2 className="font-heading text-2xl mb-3">3. מטרות העיבוד</h2>
            <p>הפרטים נאספים למטרות הבאות בלבד:</p>
            <ul className="list-disc pr-6 mt-3 space-y-1.5">
              <li>יצירת קשר ותיאום פגישה</li>
              <li>מתן שירותי שיווק פנסיוני, ביטוח ותכנון פיננסי</li>
              <li>שליחת אישורים, עדכונים ומסמכים רלוונטיים</li>
              <li>מילוי חובות חוקיות ורגולטוריות, לרבות מול רשות שוק ההון</li>
              <li>
                אזור אישי: משתמש מחובר רואה את הפניות שנשלחו מכתובת המייל המאומתת
                שלו — נושא, מועד הפגישה, ובראיון ההיכרות גם הסיכום והתשובות שנמסרו בו.
                הזיהוי נעשה לפי כתובת המייל שהוזנה בפנייה, ולכן מי שהקליד בטעות כתובת
                של אדם אחר עלול לחשוף לאותו אדם את פנייתו כשיתחבר. לא מוצגים מספר
                טלפון, הערות פנימיות או סטטוס הטיפול.
                {/* With the client's meetings tab (VITE_MEETINGS_CLIENT): the wording from #261, shown with the tab and not before it. */}
                {MEETINGS_CLIENT ? (
                  <>
                    {" "}
                    סיכומי פגישות שדורית בוחרת לפרסם, ומועדי הפגישות שלכם איתה, מוצגים
                    באזור האישי — רק למי שמתחבר עם כתובת המייל המאומתת שמסר בפנייה. סיכום
                    הוא תיעוד של מה שדובר בפגישה ואינו ייעוץ בכתב, ואינו מחליף מסמך שהדין
                    מחייב (כגון מסמך הנמקה). בקשה לשינוי מועד שנשלחת מהאזור האישי נשמרת
                    אצל דורית יחד עם הפנייה, ונמחקת יחד איתה.
                  </>
                ) : null}{" "}
                אפשר לבקש עיון, תיקון או מחיקה בכל עת, וכן לדווח על פנייה שאינה שלכם.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="font-heading text-2xl mb-3">4. עוזרים אוטומטיים (בינה מלאכותית) באתר</h2>
            <p>
              באתר פועלים שלושה עוזרים אוטומטיים מבוססי בינה מלאכותית: ראיון
              היכרות, תיאום פגישה, והמלצות קריאה מהבלוג. אלה אינם דורית ואינם
              בעלי רישיון, והם אינם נותנים ייעוץ, שיווק פנסיוני, המלצה על מוצר
              או חישוב כלשהו.
            </p>
            <ul className="list-disc pr-6 mt-3 space-y-1.5">
              <li>
                השיחה נפתחת רק לאחר שאישרת את הודעת ההסכמה המוצגת בראש הצ׳אט.
                נוסח ההסכמה שהוצג לך נשמר יחד עם הפנייה.
              </li>
              <li>
                נאספים שם וטלפון בלבד; אימייל — לבחירתך. אין למסור בצ׳אט תעודת
                זהות, מספרי חשבון או פוליסה, נתוני שכר, צבירה או מידע רפואי,
                והעוזרים מונחים שלא לבקש פרטים כאלה ולא לשמור אותם.
              </li>
              <li>
                תוכן השיחה מעובד אצל ספק תשתית הבינה המלאכותית של האתר לצורך
                ניהול השיחה בלבד, ואינו משמש לשיווק ולא נמכר לצד שלישי.
              </li>
              {/* With the agent's call briefing (VITE_LEAD_BRIEFING): shown with the feature and not before it — docs/COMPLIANCE.md §12. */}
              {LEAD_BRIEFING ? (
                <li>
                  כדי להתכונן לשיחה איתך, תוכן הראיון או הפנייה — אחרי שהוסרו ממנו שם,
                  טלפון, אימייל ומספרים מזהים — עשוי לעבור עיבוד אצל אותו ספק, לכתיבת
                  תדריך פנימי קצר. התדריך נראה לצוות בלבד, אינו נשלח אליך ואינו מחליף
                  את שיקול הדעת המקצועי, ונמחק יחד עם הפנייה.
                </li>
              ) : null}
              <li>
                לא מתקבלת לגביך שום החלטה באופן אוטומטי. כל החלטה מקצועית מתקבלת
                על ידי דורית באופן אישי.
              </li>
              <li>
                כל נושא שהעוזר אינו רשאי לטפל בו — ייעוץ, מוצרים, מספרים,
                תביעות, תלונות ובקשות פרטיות — מועבר לטיפול אנושי של דורית.
                אפשר לבקש מעבר לאדם בכל שלב, בכפתור שבראש הצ׳אט.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="font-heading text-2xl mb-3">5. בסיס חוקי</h2>
            <p>
              העיבוד נעשה על בסיס הסכמתך למסירת הפרטים, וכן לשם ביצוע הסכם
              או פעולה על-פי בקשתך, טרם כריתת חוזה למתן שירות.
            </p>
          </section>

          <section>
            <h2 className="font-heading text-2xl mb-3">6. שיתוף והעברת מידע</h2>
            <p>
              לא נמסור את פרטיך לצד ג׳ שלישי למטרות שיווק ללא הסכמתך. ייתכן
              שנעביר פרטים לחברות ביטוח לשם הנפקת פוליסות או טיפול בתביעות
              בהתאם לבקשתך, ולרשויות מפקחות ככל שהדבר נדרש על-פי דין.
            </p>
          </section>

          <section>
            <h2 className="font-heading text-2xl mb-3">7. שמירת המידע ואבטחתו</h2>
            <p>
              המידע נשמר במשך התקופה הנדרשת למימוש מטרות האיסוף ולעמידה בחובות
              חוקיות: פנייה שלא הבשילה להתקשרות נשמרת עד 24 חודשים ממועד הקשר
              האחרון, ומידע הנוגע להתקשרות בפועל נשמר לתקופה הנדרשת על-פי דין
              ועל-פי הוראות רשות שוק ההון. בתום התקופה המידע נמחק או עובר
              אנונימיזציה.
            </p>
            <p className="mt-3">
              מלבד המאגר, פנייה נרשמת גם בגיליון מעקב, נשלחת בדוא״ל לדורית,
              ופגישה שנקבעה נרשמת ביומן. בגיליון, פרטי הפונה נמחקים אוטומטית
              כשהפנייה במאגר נמחקת או עוברת אנונימיזציה. העותקים בדוא״ל וביומן
              נמחקים בתום אותה תקופה. הצוות המתפעל את האתר מקבל הודעה על פנייה
              חדשה בלי פרטי הפונה; ביומן שלו נרשמים לפגישה שם, טלפון ונושא בלבד.
            </p>
            <p className="mt-3">
              הגישה למאגר הפניות מוגבלת בהרשאות לדורית ולצוות המתפעל את האתר
              מטעמה, לצורך מתן השירות ותחזוקתו בלבד. אין העברה לגורם נוסף ואין
              שימוש שיווקי במידע. אנו נוקטים אמצעי
              אבטחה בהתאם לתקנות הגנת הפרטיות (אבטחת מידע), התשע״ז–2017. אירוע
              אבטחה חמור ידווח לרשות להגנת הפרטיות ולנפגעים כנדרש בדין.
            </p>
          </section>

          <section>
            <h2 className="font-heading text-2xl mb-3">8. זכויותיך (תיקון 13)</h2>
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
            <h2 className="font-heading text-2xl mb-3">9. אחראי לפרטיות</h2>
            <p>
              האחראי לענייני פרטיות בסוכנות הוא דורית גוב ארי. ניתן לפנות
              בכתובת <a href={`mailto:${contact.email}`} dir="ltr" className="text-accent underline underline-offset-4">{contact.email}</a> או בטלפון המפורסם באתר.
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