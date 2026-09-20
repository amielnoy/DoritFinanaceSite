/**
 * The site's questions and answers — the one copy.
 *
 * Three components used to carry their own: the home page's six "tips"
 * (FAQ.tsx), its "common questions" accordion (DetailedFAQ.tsx) and the /faq
 * page's four categories (FAQPage.tsx). They had already drifted — the
 * annual-review answer said one thing on the home page and another on /faq —
 * and since /faq builds its FAQPage JSON-LD from its copy, what Google indexed
 * and what a visitor read on the home page could disagree. For a regulated
 * business that is a correctness problem, not a tidiness one.
 *
 * Every surface now selects from this list. Edit an answer here and it
 * changes everywhere at once, structured data included.
 * `tests/unit/faq-content.test.ts` pins the invariants.
 */

export type FaqCategoryId = "tax" | "pension" | "insurance" | "general";

export interface FaqCategory {
  id: FaqCategoryId;
  label: string;
  labelEn: string;
}

export interface FaqEntry {
  /** Stable key — used for React keys, accordion values and cross-references. */
  id: string;
  category: FaqCategoryId;
  q: string;
  a: string;
  /**
   * Set on the entries the home page shows as numbered tips. `title` is the
   * imperative phrasing ("אל תוותרו על…") that the tips list uses instead of
   * the question; the answer is shared.
   */
  tip?: { n: number; title: string };
}

export const FAQ_CATEGORIES: readonly FaqCategory[] = [
  { id: "tax", label: "מס הכנסה", labelEn: "Income Tax" },
  { id: "pension", label: "פנסיה וחיסכון", labelEn: "Pension & Savings" },
  { id: "insurance", label: "ביטוח", labelEn: "Insurance" },
  { id: "general", label: "כללי", labelEn: "General" },
];

export const FAQ_ENTRIES: readonly FaqEntry[] = [
  {
    id: "tax-planning",
    category: "tax",
    q: "כיצד תכנון מס נכון חוסך בחיסכון הפנסיוני?",
    a: "תכנון מס נכון כולל ניצול הטבות מס בהפקדות לפנסיה, גמל והשתלמות, מיצוי זיכויים במס, ובחירת מוצרי חיסכון עם יחס מס נמוך. הפקדה לפנסיה מזכה בהטבת מס משמעותית עד לתקרה שנתית, ומשיכה כקצבה מזכה בהטבת מס נוספת. תכנון נכון יכול לחסוך עשרות אלפי שקלים בשנה.",
  },
  {
    id: "amendment-190",
    category: "tax",
    q: "מהו תיקון 190 וכיצד הוא חוסך בדמי ניהול ופרמיה?",
    a: "תיקון 190 לחוק הפיקוח על שירותים פיננסיים מאפשר העברת כספים בין ביטוחי מנהלים ומוצרים פנסיוניים תוך הורדת דמי ניהול ופרמיה. באמצעות משא ומתן מול הגוף המוסדי ניתן להפחית משמעותית את עלויות החיסכון הפנסיוני ולשפר את התשואה לטווח ארוך.",
  },
  {
    id: "marginal-tax",
    category: "tax",
    q: "מה זה מס שולי ואיך הוא משפיע על החיסכון שלי?",
    a: "מס שולי הוא האחוז שאתם משלמים על כל שקל נוסף שאתם מרוויחים. ככל שההכנסה גבוהה יותר, כך המס השולי גבוה יותר. הפקדה לפנסיה מזכה בזיכוי מס בשיעור המס השולי שלכם — כלומר ככל שהמס השולי גבוה יותר, כך ההטבה גדולה יותר. לשכירים במס שולי גבוה, ההפקדה לפנסיה היא אחד הכלים היעילים ביותר לחיסכון במס.",
  },
  {
    id: "severance-lump-or-annuity",
    category: "tax",
    q: "האם כדאי למשוך פיצויים כסכום חד-פעמי או כקצבה?",
    a: "משיכת פיצויים כקצבה (מגיל 60) מזכה בהטבת מס משמעותית — פטור עד 8,880 ₪ לחודש (נכון ל-2026) ויתרה במס מופחת. משיכה כסכום חד-פעמי צמוד למס רגיל. ברוב המקרים, המשיכה כקצבה כדאית יותר מבחינת מס — אך ההחלטה תלויה במצב האישי, בגיל ובצרכי הון מיידיים.",
  },
  {
    id: "pension-tax-refund",
    category: "tax",
    q: "איך מקבלים החזר מס על הפקדות לפנסיה?",
    a: "שכירים שמפקידים לפנסיה דרך המעסיק מקבלים את ההטבה באופן אוטומטי בתלוש השכר. עצמאים ושכירים שמפקידים באופן עצמאי צריכים לדרוש את הזיכוי במס בדוח השנתי (שנתי או דו-שנתי). ניתן לקבל החזר מס רטרואקטיבי על הפקדות שלא תואמו בעבר — עד 6 שנים אחורה.",
  },
  {
    id: "pension-vs-gemel-vs-hishtalmut",
    category: "pension",
    q: "מה ההבדל בין פנסיה, גמל והשתלמות?",
    a: "פנסיה מיועדת לחיסכון ארוך טווח לגיל פרישה ומשלמת קצבה חודשית. קרן גמל היא חיסכון לטווח בינוני-ארוך עם אפשרות משיכה הונית מגיל 60. קרן השתלמות היא חיסכון לטווח קצר-בינוני (6 שנים לפחות) עם פטור ממס על הרווחים. כל מוצר מתאים למטרות חיסכון שונות.",
  },
  {
    id: "lower-management-fees",
    category: "pension",
    q: "כיצד ניתן להוריד דמי ניהול בפנסיה, גמל והשתלמות?",
    a: "דמי ניהול מצטברים לעשרות אלפי שקלים לאורך שנות החיסכון. ניתן להורידם באמצעות משא ומתן עם הגוף המוסדי — קרנות פנסיה, קרנות גמל וקרנות השתלמות — העברת כספים לגוף עם דמי ניהול נמוכים יותר, או ניצול תיקון 190. גם הפרש של אחוז אחד בלבד מצטבר לסכום משמעותי לאורך השנים.",
  },
  {
    id: "fees-in-every-product",
    category: "pension",
    q: "האם צריך לבדוק דמי ניהול גם מחוץ לפנסיה?",
    a: "הפרש של אחוז אחד בלבד בדמי ניהול מצטבר לעשרות אלפי שקלים לאורך השנים. בקשו מכל גוף מוסדי פירוט מדויק של דמי הניהול בקרן, בביטוח המנהלים ובקרן ההשתלמות, והשוו. במקרים רבים ניתן להוריד את העמלה במשא ומתן פשוט — גם מבלי לעבור קרן.",
    tip: { n: 1, title: "בדקו את דמי הניהול בכל מוצר — ולא רק בפנסיה" },
  },
  {
    id: "improve-returns",
    category: "pension",
    q: "כיצד משפרים תשואות בקרנות פנסיה וגמל?",
    a: "שיפור תשואות מושג באמצעות בחירת מסלולי השקעה המתאימים לגיל ולמצב הכלכלי, הפחתת דמי ניהול, פיזור נכון של הנכסים ומעקב שוטף אחר ביצועי הקרן. התאמה אישית של מסלול ההשקעה יכולה להוסיף אחוזי תשואה משמעותיים לאורך זמן.",
  },
  {
    id: "merge-funds",
    category: "pension",
    q: "מתי כדאי לאחד קרנות פנסיה וגמל?",
    a: "איחוד קרנות כדאי כאשר יש מספר קרנות עם דמי ניהול גבוהים, קושי במעקב אחר התיק, או כאשר ניתן לקבל תנאים טובים יותר בקרן אחת. איחוד מפחית עלויות, מקל על ניהול ומעקב, ומאפשר התאמה מדויקת יותר של מסלול ההשקעה. עם זאת, לפעמים פיזור בין קרנות עדיף — ההחלטה תלויה בנסיבות האישיות.",
  },
  {
    id: "child-savings",
    category: "pension",
    q: "חיסכון לילדים — כדאי להתחיל מהלידה?",
    a: "בהחלט. הפקדה חודשית קטנה לחיסכון לילד מגיל חודשיים צומחת לאורך 20+ שנה לסכום משמעותי הודות לריבית דריבית. בחרו במוצר עם דמי ניהול נמוכים ונזילות גבוהה, והגדירו מראש את המטרה (לימודים, דירה, צבירת הון). ככל שמתחילים מוקדם יותר, ההון עובד זמן רב יותר לטובתכם.",
    tip: { n: 4, title: "חיסכון לילדים — כדאי להתחיל מהלידה" },
  },
  {
    id: "self-employed-pension",
    category: "pension",
    q: "עצמאים — אל תדחו את ההפרשה הפנסיונית",
    a: "עצמאים שדוחים הפקדות 'עד שיהיה רווחי יותר' מפסידים הטבות מס משמעותיות ושנות צבירת הון שאינן חוזרות. התחילו בהפקדה חודשית קבועה, גם צנועה, והגדילו אותה עם הזמן. בנוסף, ודאו כיסוי אובדן כושר עבודה — ללא מעסיק שמפרנס, הוא קריטי פי כמה.",
    tip: { n: 6, title: "עצמאים — אל תדחו את ההפרשה הפנסיונית" },
  },
  {
    id: "supplementary-health",
    category: "insurance",
    q: "ביטוח בריאות משלים — כדאי, ואיך נמנעים כפילויות?",
    a: "לפני רכישת ביטוח בריאות משלים, בדקו מה כבר מכסה קופת החולים שלכם והפנסיה הקיימת. רבים משלמים על כיסויים חופפים מבלי לדעת. המפתח הוא השלמה מדויקת של פערים — ניתוחים פרטיים, תרופות יקרות, אשפוז במחלקה סגורה — ולא רכישה גורפת של פוליסות נוספות.",
    tip: { n: 5, title: "כיסוי בריאות משלים — לא כפילות מיותרת" },
  },
  {
    id: "rights-fixing",
    category: "insurance",
    q: "מה זה קיבוע זכויות ולמה זה חשוב?",
    a: "קיבוע זכויות הוא תהליך שבו מבוטח מקבע את הזכויות הרפואיות שלו בביטוח בריאות וביטוח חיים, כך ששינויים במצב הבריאותי בעתיד לא יפגעו בכיסוי הביטוחי. קיבוע זכויות חשוב כי הוא מבטיח כיסוי מלא גם אם מצב הבריאות משתנה, ומונע דחיית תביעות עקב מצב רפואי קודם.",
  },
  {
    id: "disability-cover",
    category: "insurance",
    q: "אל תוותרו על כיסוי אובדן כושר עבודה",
    a: "ביטוח אובדן כושר עבודה הוא קו ההגנה הראשון שלכם — לא פחות חשוב מהחיסכון עצמו. ודאו שגובה הכיסוי תואם את ההכנסה הנוכחית, שתקופת ההמתנה מתאימה ליכולת הכלכלית שלכם, ושההגדרה 'עיסוק אובייקטיבי' מופיעה בפוליסה. רבים מגלים רק בעת תביעה שהכיסוי שלהם צר או לא רלוונטי.",
    tip: { n: 2, title: "אל תוותרו על כיסוי אובדן כושר עבודה" },
  },
  {
    id: "switch-agent",
    category: "insurance",
    q: "האם ניתן לעבור אלייך מסוכן קודם?",
    a: "בהחלט. מעבר סוכן הוא תהליך פשוט שאינו כרוך בעלות ואינו פוגע ברצף הכיסויים שלכם. אני מטפלת בכל ההעברה וההסברה מול הגופים המוסדיים.",
  },
  {
    id: "life-changes",
    category: "insurance",
    q: "מה קורה כשמשתנה מצב משפחתי או מקצועי?",
    a: "כל שינוי משפיע על הכיסויים הנכונים. בכל שינוי — נישואין, לידה, גירושין, דירה חדשה או מעבר לעצמאות — נשב יחד ונתאים את התיק למציאות החדשה.",
  },
  {
    id: "first-meeting-cost",
    category: "general",
    q: "האם פגישת ההיכרות הראשונה כרוכה בעלות?",
    a: "פגישת ההיכרות הראשונה ללא עלות וללא התחייבות. מטרתה להכיר את הצורך שלכם ולהציע כיוון ברור — רק אם תבחרו להמשיך, נתקדם יחד.",
  },
  {
    id: "independent-agent",
    category: "general",
    q: "האם את עצמאית או משויכת לחברת ביטוח מסוימת?",
    a: "אני סוכנת עצמאית העובדת מול כל חברות הביטוח והפנסיה בישראל. ההמלצה נגזרת אך ורק מהצורך שלכם — לא משייכות מסחרית כלשהי.",
  },
  {
    id: "lifelong-service",
    category: "general",
    q: "מה כולל הליווי לאורך החיים?",
    a: "ביקורת תיק שנתית, עדכון כיסויים בכל שינוי חיים (נישואין, לידה, דירה, עצמאות), מו\\\"ב מול החברות על דמי ניהול ותנאים, וליווי צמוד בעת תביעה — הכל תחת קורת גג אחת.",
  },
  {
    id: "claims-support",
    category: "general",
    q: "כיצד מתנהל הליווי בעת תביעה?",
    a: "אני נוטלת את ניהול התביעה מול החברה על עצמי — השלמת תיעוד, מעקב והופעה בשמכם עד לקבלת הכיסוי המלא. ברוב המקרים לא תצטרכו להרים טלפון.",
  },
  {
    id: "remote-meetings",
    category: "general",
    q: "האם ניתן לקיים פגישות גם מרחוק?",
    a: "כן. פגישות ניתן לקיים במשרד בתל אביב, בזום או בטלפון — לפי הנוחות שלכם. הליווי עצמו זהה בכל פורמט.",
  },
  {
    id: "confidentiality",
    category: "general",
    q: "כיצד נשמרת סודיות המידע שלי?",
    a: "כל המידע שאתם מוסרים נשמר בסודיות מלאה, בכפוף לחוק הגנת הפרטיות ולמדיניות הפרטיות של המשרד. אינו מועבר לצד ג' ללא הסכמתכם.",
  },
  {
    id: "annual-review",
    category: "general",
    q: "באיזו תדירות כדאי לבצע ביקורת תיק מסכמת?",
    a: "מצב משפחתי, מקום עבודה ומצב בריאותי משתנים — ואיתם גם הכיסויים הנכונים. כדאי לקבוע פגישת סיכום שנתית שבה עוברים יחד על כל המוצרים: פנסיה, גמל, השתלמות וביטוחים. עדכון שגרתי מונע פערים יקרים ומאפשר הורדת עלויות ושיפור תשואות.",
    tip: { n: 3, title: "מקדישים שעה בשנה לביקורת תיק מסכמת" },
  },
];

/**
 * The home page's "common questions" — a hand-picked subset in a deliberate
 * order (what a first-time visitor asks before booking), not a category.
 */
export const HOME_COMMON_QUESTION_IDS: readonly string[] = [
  "first-meeting-cost",
  "independent-agent",
  "lifelong-service",
  "claims-support",
  "switch-agent",
  "life-changes",
  "remote-meetings",
  "confidentiality",
];

export const faqByCategory = (category: FaqCategoryId): FaqEntry[] =>
  FAQ_ENTRIES.filter((e) => e.category === category);

/** The numbered tips, in tip order. */
export const faqTips = (): (FaqEntry & { tip: NonNullable<FaqEntry["tip"]> })[] =>
  FAQ_ENTRIES.filter((e): e is FaqEntry & { tip: NonNullable<FaqEntry["tip"]> } => !!e.tip).sort(
    (x, y) => x.tip.n - y.tip.n
  );

export const faqByIds = (ids: readonly string[]): FaqEntry[] =>
  ids.map((id) => {
    const entry = FAQ_ENTRIES.find((e) => e.id === id);
    if (!entry) throw new Error(`Unknown FAQ entry: ${id}`);
    return entry;
  });
