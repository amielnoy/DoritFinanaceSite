/**
 * Compliance copy and constants for the on-site agents.
 *
 * Every regulated sentence the chat surfaces to a visitor is declared here
 * rather than inline in a component: the wording is the deliverable a compliance
 * review reads, and a review that has to chase it across three components is a
 * review that misses one. `tests/contract/agents.contract.test.ts` asserts the
 * agent definitions and this file still agree.
 */

/**
 * Bumped whenever the consent wording below changes materially.
 *
 * It is stored on every Lead the agents create, so a record can always be tied
 * to the exact text the visitor was shown — the evidentiary half of the duty to
 * inform under חוק הגנת הפרטיות (as amended by תיקון 13).
 */
export const CONSENT_VERSION = "2026-09-agents-v2";

/** Licence details the agency must disclose. */
export const LICENCE = {
  entity: "דורית גוב ארי — סוכנות ביטוח בע״מ",
  number: "L-00107009",
  regulator: "רשות שוק ההון, ביטוח וחיסכון",
} as const;

/** Shown before a conversation may start. */
export const BOT_DISCLOSURE =
  "זהו עוזר אוטומטי (בינה מלאכותית) של הסוכנות — לא דורית ולא בעל רישיון.";

/** The consent gate. The visitor cannot send a message before accepting it. */
export const CONSENT = {
  heading: "לפני שמתחילים",
  points: [
    "השיחה מתנהלת מול עוזר אוטומטי. הוא אוסף הקשר ומתאם פגישה — הוא אינו נותן ייעוץ, המלצה על מוצר או חישוב.",
    `${LICENCE.entity} בעלת רישיון סוכן מ${LICENCE.regulator} מס' ${LICENCE.number}, ולה זיקה לגופים מוסדיים. הפעילות היא שיווק פנסיוני ולא ייעוץ פנסיוני אובייקטיבי.`,
    "נאספים שם וטלפון בלבד (אימייל — לבחירתך), לצורך חזרה אליך. אין למסור בצ׳אט תעודת זהות, מספרי חשבון או פוליסה, נתוני שכר או מידע רפואי.",
    "הפרטים נשמרים אצל דורית ואצל הצוות שמתפעל את האתר מטעמה, ולא מועברים לאף גורם אחר ואינם משמשים לשיווק. אפשר לבקש עיון, תיקון או מחיקה בכל עת.",
  ],
  checkboxLabel: "קראתי ואני מאשר/ת את איסוף הפרטים כמפורט למעלה",
  privacyLinkLabel: "מדיניות הפרטיות המלאה",
  privacyHref: "/privacy",
  startLabel: "התחלת השיחה",
} as const;

/**
 * The same gate, worded for the support chat.
 *
 * The default points describe the interview: they promise that a name and a
 * phone number are collected and that a meeting will be arranged. The support
 * chat does neither — it answers general questions and asks for nothing — so
 * showing that text here would be a consent notice for something that is not
 * happening, which is worse than none: it is a specific, wrong description of
 * what the visitor is agreeing to.
 *
 * What it does do, and what the default text has no reason to mention, is keep
 * a record of the conversation. That is the sentence this version exists for.
 */
export const SUPPORT_CONSENT_POINTS = [
  "השיחה מתנהלת מול עוזר אוטומטי שעונה על שאלות כלליות מתוך התוכן שפורסם באתר. הוא אינו נותן ייעוץ, אינו ממליץ על מוצר ואינו מבצע חישוב.",
  `${LICENCE.entity} בעלת רישיון סוכן מ${LICENCE.regulator} מס' ${LICENCE.number}, ולה זיקה לגופים מוסדיים. הפעילות היא שיווק פנסיוני ולא ייעוץ פנסיוני אובייקטיבי.`,
  "אין צורך למסור פרטים אישיים כדי לשוחח כאן, ואינך מתבקש/ת למסור אותם. אין למסור בצ׳אט תעודת זהות, מספרי חשבון או פוליסה, נתוני שכר או מידע רפואי.",
  "תוכן השיחה נשמר אצל דורית ואצל הצוות שמתפעל את האתר מטעמה, כדי לדעת מה נשאל ולשפר את המענה. מזהים שנמסרו בטעות מושמטים לפני השמירה. אפשר לבקש עיון, תיקון או מחיקה בכל עת.",
] as const;

/** Persistent line under the message box, visible for the whole conversation. */
export const CHAT_DISCLAIMER =
  "המידע בצ׳אט הוא כללי בלבד ואינו ייעוץ, שיווק פנסיוני או המלצה אישית. אפשר לעבור לדורית בכל שלב.";

/** Why an automated conversation stopped and went to a person. */
export const ESCALATION_REASONS = [
  "regulated_advice",
  "product_recommendation",
  "numbers_or_returns",
  "claim_or_policy",
  "complaint",
  "privacy_request",
  "sensitive_data",
  "out_of_scope",
  "user_request",
  "uncertain",
] as const;

export type EscalationReason = (typeof ESCALATION_REASONS)[number];

/** Copy for the always-available "talk to a person" control. */
export const HUMAN_HANDOFF = {
  buttonLabel: "מעבר לדורית",
  buttonTitle: "מעבר לטיפול אנושי",
  confirmation:
    "העברתי את הפנייה לדורית. אפשר גם לפנות אליה ישירות — היא חוזרת תוך יום עסקים אחד.",
  failure:
    "אפשר לפנות לדורית ישירות בטלפון 050-831-1776, בוואטסאפ, או במייל dorit@govari-fin.co.il.",
} as const;
