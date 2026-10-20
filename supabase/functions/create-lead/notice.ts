import { buildClientHtml } from '../_shared/html.ts';

// The client copy imports these two; the notice below must stay byte-identical to it.
const CONTACT = { email: 'dorit@govari-fin.co.il' };
const SITE_URL = 'https://govari-fin.co.il';

/** Stored as consent_version on a staff-created lead. */
export const STAFF_INTAKE_VERSION = 'staff-intake-v1';

// DRAFT for the compliance adviser: wording not yet approved (staff-leads spec D6).
// Same text as src/config/staff-leads.ts; tests/contract/staff-intake-notice.contract.test.ts keeps the two identical.
export const STAFF_INTAKE_NOTICE = `סוכנות דורית גוב ארי (רישיון סוכן L-00107009) שומרת את הפרטים שמסרת: שם, טלפון, דוא״ל, נושא הפנייה והערות מהשיחה.
הפרטים משמשים כדי לחזור אליך ולתת את השירות שביקשת.
פנייה שלא הבשילה להתקשרות נשמרת 24 חודשים מהקשר האחרון; מידע על התקשרות בפועל נשמר כנדרש על-פי דין ועל-פי הוראות רשות שוק ההון.
הפרטים גלויים לצוות הסוכנות בלבד.
זכותך לראות את הפרטים, לתקן אותם ולבקש למחוק אותם: ${CONTACT.email}
המדיניות המלאה: ${SITE_URL}/privacy`;

/** The notice as a letter, for a lead the member chose to notify by email. */
export function noticeMail(): { subject: string; html: string; text: string } {
  const lines = STAFF_INTAKE_NOTICE.split('\n');
  const html = buildClientHtml({
    firstName: '',
    eyebrow: 'הודעת פרטיות',
    heading: 'איך נשמרים הפרטים שלך',
    intro: lines.slice(0, 4).join(' '),
    panelTitle: 'זכויותיך',
    details: [
      ['זכויות', 'לראות, לתקן ולבקש למחוק'],
      ['פנייה', CONTACT.email],
    ],
    action: { label: 'מדיניות הפרטיות', href: `${SITE_URL}/privacy` },
  });
  return { subject: 'הודעת פרטיות — דורית גוב ארי', html, text: ['שלום,', '', ...lines].join('\n') };
}
