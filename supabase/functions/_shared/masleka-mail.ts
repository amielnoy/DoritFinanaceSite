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
import { greetingName, isEmail } from './guard.ts';
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

/** A staff letter: a heading, paragraphs, and the board's link — every value escaped here. */
function staffLetter(heading: string, paragraphs: string[]): string {
  return `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head><meta charset="utf-8"></head>
<body style="margin:0; padding:24px; background:#F9F7F2; font-family:Arial,Helvetica,sans-serif; color:#1A1A1B; direction:rtl; text-align:right;">
  <h1 style="margin:0 0 16px; font-family:Georgia,serif; font-size:22px;">${escapeHtml(heading)}</h1>
  ${paragraphs.map((p) => `<p style="margin:0 0 16px; font-size:15px; line-height:1.7;">${escapeHtml(p)}</p>`).join('\n  ')}
  <p style="margin:0;"><a href="${MASLEKA_BOARD}" style="color:#7D6B5D;">למסך המסלקה</a></p>
</body>
</html>`;
}

/**
 * Why `masleka-code` could not take a client's code: nothing was stored
 * (`not_saved`), the sealing key is missing (`unavailable`), or the store
 * was cut off and the code may or may not have landed (`uncertain`).
 */
export type CodeFailure = 'not_saved' | 'unavailable' | 'uncertain';

const FAILURE_INTRO: Record<CodeFailure, string> = {
  not_saved:
    'לקוח ניסה למסור קוד ייפוי כוח ומספר זהות, והשליחה נכשלה אצלנו לפני שנשמר דבר. הלקוח קיבל הודעה שהשליחה לא עברה והתבקש לנסות שוב.',
  unavailable:
    'לקוח ניסה למסור קוד ייפוי כוח ומספר זהות, אבל מפתח ההצפנה (MASLEKA_KEY) חסר או שגוי, ולכן לא נשמר דבר. הלקוח התבקש לנסות שוב מאוחר יותר. יש לתקן את ההגדרה.',
  uncertain:
    'לקוח ניסה למסור קוד ייפוי כוח ומספר זהות, והשמירה נקטעה באמצע — לא ברור אם הקוד נשמר. הלקוח קיבל הודעה שאין צורך לשלוח שוב ושדורית תיצור קשר.',
};

/**
 * The alert to staff when a client's code did not go through. It carries the
 * client's name when the link was read (it is on the board anyway) and the
 * rid, which finds every log line of the attempt — never the code, the ID
 * or the link.
 */
export function buildCodeFailureAlert(input: { clientName: string | null; failure: CodeFailure; rid: string }): BuiltMail {
  const name = oneLine(input.clientName ?? '');
  const heading = 'מסירת קוד מסלקה נכשלה';
  const subject = name ? `${heading} — ${name}` : heading;
  const paragraphs = [
    ...(name ? [`לקוח: ${name}`] : []),
    FAILURE_INTRO[input.failure],
    'אם הלקוח מופיע בלוח בעמודה "ממתין להגשה", הקוד נשמר ואין צורך בדבר. אם לא — כדאי ליצור איתו קשר, ואם צריך לשלוח לו קישור חדש מהלוח.',
    'ההתראה נשלחת פעם אחת בשעה לכל קישור, גם אם הלקוח ניסה כמה פעמים.',
    `מזהה לבדיקה ביומנים: ${oneLine(input.rid)}`,
  ];
  return { subject, html: staffLetter(heading, paragraphs), text: [...paragraphs, `למסך המסלקה: ${MASLEKA_BOARD}`].join('\n') };
}

/** A date as a person in Israel reads it: d.m.yyyy, or '' for none. */
function israelDate(iso: string | null): string {
  const at = iso ? new Date(iso) : null;
  if (!at || Number.isNaN(at.getTime())) return '';
  return at.toLocaleDateString('he-IL', { timeZone: 'Asia/Jerusalem', day: 'numeric', month: 'numeric', year: 'numeric' });
}

/**
 * One request's notice that the nine-day wipe took a code nobody submitted.
 * The request has left the board (it is `expired`), so the mail names the
 * client by what the board showed — name and address — and says what to do.
 */
export function buildWipeNotice(input: { clientName: string; contactEmail: string | null; codeReceivedAt: string | null }): BuiltMail {
  const name = oneLine(input.clientName);
  const heading = 'קוד מסלקה נמחק לפני הגשה';
  const received = israelDate(input.codeReceivedAt);
  const paragraphs = [
    `לקוח: ${name}`,
    ...(isEmail(input.contactEmail) ? [`מייל: ${input.contactEmail}`] : []),
    ...(received ? [`הקוד התקבל: ${received}`] : []),
    'הקוד ומספר הזהות שהלקוח מסר נמחקו אוטומטית: עברו 9 ימים מאז שנמסרו, והבקשה לא סומנה "הגשתי". אי אפשר להגיש אותה עוד, והיא ירדה מהלוח.',
    'כדי לשלוף את נתוני המסלקה יש לבקש מהלקוח קוד חדש: ליצור בלוח בקשה חדשה ולשלוח לו את הקישור.',
  ];
  return {
    subject: name ? `${heading} — ${name}` : heading,
    html: staffLetter(heading, paragraphs),
    text: [...paragraphs, `למסך המסלקה: ${MASLEKA_BOARD}`].join('\n'),
  };
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
