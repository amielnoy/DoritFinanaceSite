/**
 * The clearinghouse pipeline's mails: notices to the staff, and the
 * invitation (or its one reminder) to a client.
 *
 * None of these builders takes the code or the ID number, so no mail can
 * carry them whatever a caller passes. Names are escaped at the binding site,
 * as html.ts does for every visitor-facing letter; the only link a notice
 * carries is the board's, and the only link an invitation carries is the
 * client's own page on the agency's domain.
 */
import { greetingName } from './guard.ts';
import { buildClientHtml, escapeHtml } from './html.ts';
import { MASLEKA_BOARD } from './masleka.ts';

export type StaffNoticeKind = 'code_received' | 'ready' | 'deadline';

export interface BuiltMail {
  subject: string;
  html: string;
  text: string;
}

const NOTICE: Record<StaffNoticeKind, { subject: string; intro: string }> = {
  code_received: {
    subject: 'קוד מסלקה חדש לטיפול',
    intro: 'לקוח מסר קוד ייפוי כוח ומספר זהות. אפשר להגיש את הבקשה בפורטל המסלקה ולסמן "הגשתי" בלוח.',
  },
  ready: {
    subject: 'יש קבצים להורדה מהמסלקה',
    intro: 'עברו 4 שעות מההגשה, והקבצים אמורים להיות מוכנים להורדה בפורטל המסלקה.',
  },
  deadline: {
    subject: 'נמחק במסלקה בעוד יומיים',
    intro: 'הקבצים של הלקוחות האלה יימחקו במסלקה בעוד כיומיים עסקים, ועדיין לא סומנו כמטופלים. יש להוריד אותם לפני כן.',
  },
};

/** One line of plain text: no line break reaches a subject or a list. */
const oneLine = (value: string): string => value.replace(/\s+/g, ' ').trim();

export function buildStaffNotice(kind: StaffNoticeKind, clientNames: string[]): BuiltMail {
  const notice = NOTICE[kind];
  const names = clientNames.map(oneLine).filter(Boolean);
  const subject =
    names.length === 1
      ? `${notice.subject} — ${names[0]}`
      : names.length > 1
        ? `${notice.subject} — ${names.length} לקוחות`
        : notice.subject;
  const list = names.length
    ? `<ul style="margin:0 0 16px; padding-right:20px;">${names
        .map((n) => `<li style="margin:0 0 6px;">${escapeHtml(n)}</li>`)
        .join('')}</ul>`
    : '';
  const html = `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head><meta charset="utf-8"></head>
<body style="margin:0; padding:24px; background:#F9F7F2; font-family:Arial,Helvetica,sans-serif; color:#1A1A1B; direction:rtl; text-align:right;">
  <h1 style="margin:0 0 16px; font-family:Georgia,serif; font-size:22px;">${escapeHtml(notice.subject)}</h1>
  <p style="margin:0 0 16px; font-size:15px; line-height:1.7;">${escapeHtml(notice.intro)}</p>
  ${list}
  <p style="margin:0;"><a href="${MASLEKA_BOARD}" style="color:#7D6B5D;">למסך המסלקה</a></p>
</body>
</html>`;
  const text = [notice.intro, ...names.map((n) => `• ${n}`), `למסך המסלקה: ${MASLEKA_BOARD}`].join('\n');
  return { subject, html, text };
}

export function buildClientInvite(clientName: string, link: string, reminder = false): BuiltMail {
  const firstName = greetingName(clientName);
  const intro = reminder
    ? 'עדיין לא התקבל ממך קוד המסלקה. הקישור כאן מחליף את הקישור הקודם — ההסבר המלא, צעד אחר צעד, מחכה בו.'
    : 'כדי שאוכל לשלוף עבורך תמונת מצב פנסיונית מלאה מהמסלקה הפנסיונית לפני הפגישה, יש להפיק באתר המסלקה קוד ייפוי כוח ולמסור אותו בקישור האישי שלמטה, יחד עם מספר הזהות. ההסבר המלא, צעד אחר צעד, מחכה שם.';
  const html = buildClientHtml({
    firstName,
    eyebrow: reminder ? 'תזכורת' : 'שליפת נתוני מסלקה',
    heading: 'מסירת קוד המסלקה',
    intro,
    panelTitle: 'הקישור האישי שלך',
    details: [
      ['קישור', link],
      ['תוקף', '30 יום מיום ההזמנה'],
    ],
    action: { label: reminder ? 'להמשך — מסירת הקוד' : 'למסירת הקוד', href: link },
  });
  const hello = firstName ? `שלום ${firstName}, ` : 'שלום, ';
  const text = [
    `${hello}${intro}`,
    `הקישור האישי שלך: ${link}`,
    'לכל שאלה — ניתן להשיב ישירות למייל זה.',
    'בברכה, דורית גוב ארי · dorit@govari-fin.co.il',
  ].join('\n');
  return {
    subject: reminder ? 'תזכורת: מסירת קוד המסלקה · דורית גוב ארי' : 'שליפת נתוני מסלקה — מסירת קוד · דורית גוב ארי',
    html,
    text,
  };
}
