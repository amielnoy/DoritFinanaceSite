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

export const HOME_FAQ_LD: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "mainEntity": [
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
        "name": "האם חשוב להקפיד על כיסוי אובדן כושר עבודה?",
        "acceptedAnswer": {
          "@type": "Answer",
          "text": "ביטוח אובדן כושר עבודה הוא קו ההגנה הראשון — לא פחות חשוב מהחיסכון עצמו. כדאי לוודא שגובה הכיסוי תואם את ההכנסה הנוכחית, שתקופת ההמתנה מתאימה ליכולת הכלכלית, ושההגדרה 'עיסוק אובייקטיבי' מופיעה בפוליסה."
        }
      },
      {
        "@type": "Question",
        "name": "באיזו תדירות כדאי לבצע ביקורת תיק מסכמת?",
        "acceptedAnswer": {
          "@type": "Answer",
          "text": "מצב משפחתי, מקום עבודה ומצב בריאותי משתנים — ואיתם גם הכיסויים הנכונים. כדאי לקבוע פגישת סיכום שנתית שבה עוברים יחד על כל המוצרים: פנסיה, ביטוחי בריאות, חיים ומשכנתא. עדכון שגרתי מונע פערים יקרים."
        }
      },
      {
        "@type": "Question",
        "name": "מתי כדאי להתחיל לחסוך לילדים?",
        "acceptedAnswer": {
          "@type": "Answer",
          "text": "הפקדה חודשית קטנה לחיסכון לילד מגיל חודשיים צומחת לאורך 20+ שנה לסכום משמעותי הודות לריבית דריבית. כדאי לבחור במוצר עם דמי ניהול נמוכים ונזילות גבוהה, ולהגדיר מראש את המטרה (לימודים, דירה, צבירת הון)."
        }
      },
      {
        "@type": "Question",
        "name": "האם ביטוח בריאות משלים הכרחי?",
        "acceptedAnswer": {
          "@type": "Answer",
          "text": "לפני רכישת ביטוח בריאות משלים, כדאי לבדוק מה כבר מכסה קופת החולים והפנסיה הקיימת. המפתח הוא השלמה מדויקת של פערים — ניתוחים פרטיים, תרופות יקרות, אשפוז במחלקה סגורה — ולא רכישה גורפת של פוליסות נוספות."
        }
      },
      {
        "@type": "Question",
        "name": "כיצד עצמאים יכולים למקסם הטבות מס פנסיוניות?",
        "acceptedAnswer": {
          "@type": "Answer",
          "text": "עצמאים שדוחים הפקדות 'עד שיהיה רווחי יותר' מפסידים הטבות מס משמעותיות ושנות צבירת הון שאינן חוזרות. כדאי להתחיל בהפקדה חודשית קבועה, גם צנועה, ולהגדיל אותה עם הזמן. בנוסף, כדאי לוודא כיסוי אובדן כושר עבודה — ללא מעסיק שמפרנס, הוא קריטי פי כמה."
        }
      }
    ]
  };
