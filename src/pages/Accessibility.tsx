import React from "react";
import FloatingHeader from "@/components/dorit/FloatingHeader";
import Footer from "@/components/dorit/Footer";
import { breadcrumbLd, useSeo } from "@/lib/seo";
import CredentialsStrip from "@/components/dorit/CredentialsStrip";

export default function Accessibility() {
  useSeo({
    title: "הצהרת נגישות | דורית גוב ארי",
    description:
      "הצהרת הנגישות של האתר לפי חוק שוויון זכויות לאנשים עם מוגבלות — רמת ההנגשה, ההתאמות שבוצעו ודרכי פנייה לרכז הנגישות.",
    path: "/accessibility",
    jsonLd: [
      breadcrumbLd([
        { name: "ראשי", path: "/" },
        { name: "הצהרת נגישות", path: "/accessibility" },
      ]),
    ],
  });

  return (
    <div id="top">
      <FloatingHeader />
      <main className="max-w-3xl mx-auto px-6 md:px-10 pt-32 md:pt-40 pb-24">
        <span className="text-[11px] tracking-[0.35em] uppercase text-accent">Legal</span>
        <h1 className="font-heading text-4xl md:text-5xl mt-4 leading-tight">
          הצהרת נגישות
        </h1>
        <p className="text-sm text-muted-foreground mt-3">עודכן: ספטמבר 2026</p>

        <CredentialsStrip />

        <div className="mt-12 space-y-10 leading-relaxed text-foreground/80">
          <section>
            <p>
              דורית גוב ארי — סוכנות ביטוח בע״מ מחויבת להנגשת האתר לאנשים
              עם מוגבלות, בהתאם לחוק שוויון זכויות לאנשים עם מוגבלות, התשנ״ח–1998,
              ולתקנות שוויון זכויות לאנשים עם מוגבלות (התאמות נגישות לשירותי
              אינטרנט), התשע״ד–2014.
            </p>
          </section>

          <section>
            <h2 className="font-heading text-2xl mb-3">רמת הנגישות</h2>
            <p>
              האתר נבנה בהתאם להמלצות תקן WCAG 2.1 ברמת AA. האתר תומך בניווט
              באמצעות מקלדת, כולל סדר מיקוד הגיוני, ובשימוש בתוכנות קוראות
              מסך. שדות הטפסים מקושרים לתוויות טקסט וניתנים למילוי במקלדת.
            </p>
          </section>

          <section>
            <h2 className="font-heading text-2xl mb-3">התאמות שבוצעו</h2>
            <ul className="list-disc pr-6 space-y-1.5">
              <li>ניווט מלא באמצעות מקלדת</li>
              <li>תוויות טקסט מקושרות לשדות טופס</li>
              <li>ניגודיות צבעים בהתאם להמלצות</li>
              <li>מבנה סמנטי וכותרות היררכיות</li>
            </ul>
          </section>

          <section>
            <h2 className="font-heading text-2xl mb-3">ידוע על קשיי נגישות</h2>
            <p>
              מצאתם בעיה בנגישות האתר? נשמח לדעת. ניתן לפנות אלינו ונטפל
              בבקשה בהקדם האפשרי.
            </p>
          </section>

          <section>
            <h2 className="font-heading text-2xl mb-3">פרטי קשר לנגישות</h2>
            <ul className="space-y-1.5">
              <li>דוא״ל: <a href="mailto:dorit@govari-fin.co.il" dir="ltr" className="text-accent hover:underline">dorit@govari-fin.co.il</a></li>
              <li>טלפון: <a href="https://wa.me/972508311776" target="_blank" rel="noopener noreferrer" dir="ltr" className="text-accent hover:underline">050-831-1776</a></li>
            </ul>
          </section>

          <section>
            <h2 className="font-heading text-2xl mb-3">מינוי אחראי נגישות</h2>
            <p>האחראי לענייני נגישות בסוכנות הוא דורית גוב ארי.</p>
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