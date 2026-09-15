// נתונים מובנים משותפים. Structured data shared across routes.
//
// FAQPage markup may only appear on a page that actually renders those
// questions. It used to sit in index.html, which meant every route — /privacy,
// /blog, each post — claimed an FAQ it did not display. It now belongs to the
// home page alone, injected by its useSeo() call.
//
// The organisation-level FinancialService and Person blocks stay in index.html:
// they describe the business itself and are valid site-wide, and keeping them
// static means crawlers that do not execute JavaScript still see them.

/**
 * FAQPage markup, built from the questions the page actually renders.
 *
 * The previous block was a hand-written copy of six questions that lived on
 * /faq and was emitted on the home page, which rendered a list of tips instead.
 * Google's policy is that the answer must be visible on the URL claiming it, so
 * that markup described content that was not there — and duplicated an FAQ that
 * a second URL was also entitled to claim.
 *
 * Deriving it from the same array the page maps over makes the two incapable of
 * disagreeing: a question removed from the page leaves the markup with it.
 */
export function faqLd(items: Array<{ q: string; a: string }>): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map(({ q, a }) => ({
      "@type": "Question",
      name: q,
      acceptedAnswer: { "@type": "Answer", text: a },
    })),
  };
}

/** @deprecated Superseded by `faqLd`, which cannot drift from the page. */
export const HOME_FAQ_LD: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "mainEntity": [
      {
        "@type": "Question",
        "name": "כיצד ניתן להוריד דמי ניהול בפנסיה, גמל והשתלמות?",
        "acceptedAnswer": {
          "@type": "Answer",
          "text": "דמי ניהול מצטברים לעשרות אלפי שקלים לאורך שנות החיסכון. ניתן להורידם באמצעות משא ומתן עם הגוף המוסדי — קרנות פנסיה, קרנות גמל וקרנות השתלמות — העברת כספים לגוף עם דמי ניהול נמוכים יותר, או ניצול תיקון 190. גם הפרש של אחוז אחד בלבד מצטבר לסכום משמעותי לאורך השנים."
        }
      },
      {
        "@type": "Question",
        "name": "מהו תיקון 190 וכיצד הוא חוסך בדמי ניהול ופרמיה?",
        "acceptedAnswer": {
          "@type": "Answer",
          "text": "תיקון 190 לחוק הפיקוח על שירותים פיננסיים מאפשר העברת כספים בין ביטוחי מנהלים ומוצרים פנסיוניים תוך הורדת דמי ניהול ופרמיה. באמצעות משא ומתן מול הגוף המוסדי ניתן להפחית משמעותית את עלויות החיסכון הפנסיוני ולשפר את התשואה לטווח ארוך."
        }
      },
      {
        "@type": "Question",
        "name": "מה זה קיבוע זכויות ולמה זה חשוב?",
        "acceptedAnswer": {
          "@type": "Answer",
          "text": "קיבוע זכויות הוא תהליך שבו מבוטח מקבע את הזכויות הרפואיות שלו בביטוח בריאות וביטוח חיים, כך ששינויים במצב הבריאותי בעתיד לא יפגעו בכיסוי הביטוחי. קיבוע זכויות חשוב כי הוא מבטיח כיסוי מלא גם אם מצב הבריאות משתנה, ומונע דחיית תביעות עקב מצב רפואי קודם."
        }
      },
      {
        "@type": "Question",
        "name": "כיצד משפרים תשואות בקרנות פנסיה וגמל?",
        "acceptedAnswer": {
          "@type": "Answer",
          "text": "שיפור תשואות מושג באמצעות בחירת מסלולי השקעה המתאימים לגיל ולמצב הכלכלי, הפחתת דמי ניהול, פיזור נכון של הנכסים ומעקב שוטף אחר ביצועי הקרן. התאמה אישית של מסלול ההשקעה יכולה להוסיף אחוזי תשואה משמעותיים לאורך זמן."
        }
      },
      {
        "@type": "Question",
        "name": "מה ההבדל בין פנסיה, גמל והשתלמות?",
        "acceptedAnswer": {
          "@type": "Answer",
          "text": "פנסיה מיועדת לחיסכון ארוך טווח לגיל פרישה ומשלמת קצבה חודשית. קרן גמל היא חיסכון לטווח בינוני-ארוך עם אפשרות משיכה הונית מגיל 60. קרן השתלמות היא חיסכון לטווח קצר-בינוני (6 שנים לפחות) עם פטור ממס על הרווחים. כל מוצר מתאים למטרות חיסכון שונות."
        }
      },
      {
        "@type": "Question",
        "name": "כיצד תכנון מס נכון חוסך בחיסכון הפנסיוני?",
        "acceptedAnswer": {
          "@type": "Answer",
          "text": "תכנון מס נכון כולל ניצול הטבות מס בהפקדות לפנסיה, גמל והשתלמות, מיצוי זיכויים במס, ובחירת מוצרי חיסכון עם יחס מס נמוך. הפקדה לפנסיה מזכה בהטבת מס משמעותית עד לתקרה שנתית, ומשיכה כקצבה מזכה בהטבת מס נוספת."
        }
      },
      {
        "@type": "Question",
        "name": "כדאי לבדוק את דמי הניהול בכל מוצר — ולא רק בפנסיה?",
        "acceptedAnswer": {
          "@type": "Answer",
          "text": "הפרש של אחוז אחד בלבד בדמי ניהול מצטבר לעשרות אלפי שקלים לאורך השנים. כדאי לבקש מכל גוף מוסדי פירוט מדויק של דמי הניהול בקרן, בביטוח המנהלים ובקרן ההשתלמות, ולהשוות. במקרים רבים ניתן להוריד את העמלה במשא ומתן פשוט — גם מבלי לעבור קרן."
        }
      },
      {
        "@type": "Question",
        "name": "באיזו תדירות כדאי לבצע ביקורת תיק מסכמת?",
        "acceptedAnswer": {
          "@type": "Answer",
          "text": "מצב משפחתי, מקום עבודה ומצב בריאותי משתנים — ואיתם גם הכיסויים הנכונים. כדאי לקבוע פגישת סיכום שנתית שבה עוברים יחד על כל המוצרים: פנסיה, גמל, השתלמות וביטוחים. עדכון שגרתי מונע פערים יקרים ומאפשר הורדת עלויות ושיפור תשואות."
        }
      }
    ]
  };
