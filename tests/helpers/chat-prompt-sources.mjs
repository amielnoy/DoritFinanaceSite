// How the chat function's Markdown prompts relate to their sources:
//   interview.md  = base44/agents/needs_interview.jsonc's instructions, with the
//                   agency's details as {{agency.*}} placeholders, the three
//                   tool-section lines replaced (the fenced `lead` block becomes a
//                   real submitLead call) and the two language lines replaced
//                   (English visitors are interviewed in English);
//   support.md    = base44/agents/support_agent.jsonc's instructions, placeholders
//                   likewise; the BlogPost line names listArticles/readArticle and
//                   the logSupportChat lines are removed (the function logs itself);
//   procedures.md = base44/agents/procedures_agent.jsonc's instructions, placeholders
//                   likewise; the BlogPost line names listArticles/readArticle, the
//                   logSupportChat line is removed (the function logs itself), and
//                   "מגבלת הירוק" reads an article with readArticle, not BlogPost;
//   blog.md       = base44/agents/blog_recommender.jsonc's instructions, placeholders
//                   likewise; its BlogPost reads name listArticles/readArticle and
//                   the hidden ```recommended block becomes recommendArticles;
//   compliance.md = base44/agents/COMPLIANCE.md §3 and §5, verbatim.
// tests/contract/chat-prompts.contract.test.ts holds the files to these rules.
import { readFileSync } from 'node:fs';

/** Literal → placeholder, longest first: the licence entity contains the display name. */
export const PLACEHOLDERS = [
  ['licenceEntity', 'דורית גוב ארי — מתכננת פיננסית וסוכנת ביטוח'],
  ['licenceNumber', 'L-00107009'],
  ['phoneDisplay', '050-831-1776'],
  ['email', 'dorit@govari-fin.co.il'],
  ['displayName', 'דורית גוב ארי'],
];

/**
 * The only lines whose meaning changes. Each `startsWith` matches exactly one
 * line of today's instructions; its `replacement` (with placeholders) replaces
 * the whole line.
 */
export const INTERVIEW_TOOL_SECTION = [
  {
    startsWith: '- סיים את ההודעה האחרונה שלך בבלוק הבא',
    replacement:
      "- סיים את הראיון בקריאה ל-submitLead עם stage='complete' ו-source='interview', אחרי שהמבקר אישר את הסיכום. העבר את השדות name, phone, email, track, meetingTopic, timing, notes, scheduledAt, summary ו-profile. name ו-phone חובה; שדה שאין לו ערך — השאר מחרוזת ריקה. profile הוא אובייקט השדות שאישר המבקר. summary הוא תקציר קצר בעברית. אל תמסור topic: הוא נגזר מ-profile.concern.",
  },
  {
    startsWith: '- בלוק ה-lead הוא הדרך היחידה לסיים ראיון',
    replacement:
      "- הקריאה ל-submitLead עם stage='complete' היא הדרך היחידה לסיים ראיון: היא ששולחת לדורית את הסיכום במייל, ובלעדיה השיחה מסתיימת בלי שאיש יידע עליה. היא נדרשת בכל ראיון שהושלם, גם אם כבר קראת ל-submitLead בשלב 5 — השמירה ההיא שקטה ואינה מודיעה לאיש.",
  },
  {
    startsWith: '- אל תאמר למבקר שלא הצלחת לשמור.',
    replacement:
      '- אם submitLead החזירה שגיאה — אמור למבקר במשפט אחד שהשמירה לא הצליחה, ומסור את הטלפון {{agency.phoneDisplay}} ואת האימייל {{agency.email}}. אם השגיאה מבקשת לתקן פרט (למשל מספר טלפון) — בקש אותו שוב ונסה פעם נוספת. אל תמציא הצלחה ואל תמציא כשל: דווח רק על מה שהפונקציה החזירה.',
  },
  // The language lines (the user's decision of 2026-10-14): a visitor who writes in
  // English is interviewed in English, not handed off; what reaches Dorit stays Hebrew.
  {
    startsWith: 'אתה סוכן ההיכרות האוטומטי של',
    replacement:
      "אתה סוכן ההיכרות האוטומטי של {{agency.displayName}}, מתכננת פיננסית בכירה עם 30 שנות ניסיון. תפקידך לראיין מבקרים באתר בעברית — ומבקר שכותב באנגלית, באנגלית — בטון רגוע, חם, מקצועי ואנושי — ברוח העיצוב 'שלווה מבנית'.",
  },
  {
    startsWith: '- דבר רק בעברית.',
    replacement:
      '- דבר בעברית. מבקר שכותב באנגלית — ראיין אותו באנגלית מההודעה הבאה ועד הסוף, באותם כללים, באותן שאלות ובאותן אזהרות (גם הגילוי שאתה עוזר אוטומטי ולא דורית). אל תעביר מבקר לדורית רק משום שהוא כותב באנגלית. מה שנשלח לדורית — summary וערכי profile ב-submitLead, וה-summary ב-escalateToHuman — נכתב תמיד בעברית.',
  },
];

/**
 * The FAQ agent's tool section. A null replacement removes the line: the sheet
 * log is now written by the function itself (chat/sweep.ts), so the model has
 * nothing to do and must not be told to call a tool it no longer has.
 */
export const SUPPORT_TOOL_SECTION = [
  {
    startsWith: '- מה כתוב במאמר שפורסם:',
    replacement:
      '- מה כתוב במאמר שפורסם: מצא אותו ב-listArticles וקרא אותו ב-readArticle, והפנה אליו בקישור מדויק בפורמט מרקדאון: [כותרת המאמר](/blog/<slug>), כאשר <slug> הוא שדה ה-slug שחזר מ-listArticles — לא הכותרת ולא שם קובץ. צטט מהמאמר, אל תמציא. אם readArticle החזירה not_found — אל תפנה לאותו מאמר.',
  },
  { startsWith: 'רישום השיחה — פעם אחת, בסופה:', replacement: null },
  { startsWith: '- קרא ל-logSupportChat', replacement: null },
  { startsWith: "- מסור: channel='site'", replacement: null },
  { startsWith: '- ב-transcript אל תעתיק', replacement: null },
  { startsWith: '- הרישום הוא פנימי', replacement: null },
];

/**
 * The procedures agent's tool section (procedures_agent.jsonc, its last three
 * lines). BlogPost becomes the function's article tools; logSupportChat goes —
 * the function logs the chat itself (chat/sweep.ts); escalateToHuman stays.
 */
export const PROCEDURES_TOOL_SECTION = [
  {
    startsWith: '- BlogPost: קרא ממנו',
    replacement:
      '- listArticles ו-readArticle: מצא מאמר שפורסם באתר ב-listArticles וקרא אותו ב-readArticle כשהוא רלוונטי, והפנה אליו בקישור מדויק בפורמט מרקדאון: [כותרת המאמר](/blog/<slug>), כאשר <slug> הוא שדה ה-slug שחזר מ-listArticles — לא הכותרת ולא שם קובץ. אל תמציא תוכן שאינו שם. אם readArticle החזירה not_found — אל תפנה לאותו מאמר.',
  },
  { startsWith: '- logSupportChat: קרא לה', replacement: null },
  // The one line outside the tool section that names a Base44 tool: an article
  // "read in BlogPost" is now one read with readArticle. Nothing else changes.
  {
    startsWith: '**מגבלת הירוק — אל תמציא פרטי טופס.** ',
    replacement:
      "**מגבלת הירוק — אל תמציא פרטי טופס.** אין בידך מערכת, אין לך גישה למסמכים של דורית ואין לך תיק של אף אדם. לכן אל תנקוב במספר טופס, בשם טופס מדויק, בכתובת למשלוח, במספר פקס או בלוח זמנים מחייב, אלא אם הם מופיעים כאן בהנחיות או במאמר שקראת ב-readArticle. אמור במקום זאת מה השלב, ושהטופס המדויק נשלח מדורית — \"כדי שיהיה הנוסח העדכני של הגוף הרלוונטי\". מספר טופס שהומצא מזיק יותר מהעברה לאדם: מישהו ימלא אותו.",
  },
];

/**
 * The reading recommender's tool section. BlogPost reads become listArticles /
 * readArticle; the hidden ```recommended block becomes the recommendArticles
 * tool — the function returns the slugs, and the site's adapter hands the page
 * the same block it always read (SupabaseAgentService).
 */
export const BLOG_TOOL_SECTION = [
  {
    startsWith: '   a. קרא תחילה רק את המאמרים',
    replacement: "   a. קרא תחילה את רשימת המאמרים שפורסמו ב-listArticles, ובחר תחילה מאמרים שהתגיות שלהם נוגעות לנושא שעלה מהשיחה (פנסיה, מיסוי, ביטוח, וכו').",
  },
  {
    startsWith: '   b. אם לא מצאת מספיק מאמרים',
    replacement: '   b. קרא ב-readArticle את המאמרים המתאימים ביותר מהרשימה כדי לאתר התאמות עמוקות יותר לפי התוכן.',
  },
  {
    startsWith: '5. בחר עד 3 מאמרים רלוונטיים ביותר.',
    replacement:
      '5. בחר עד 3 מאמרים רלוונטיים ביותר. לכל מאמר, כתוב: הכותרת, משפט קצר משלך שמסביר למה הוא רלוונטי למה שנאמר בשיחה, וקישור לקריאה בתחביר מרקדאון: [קריאת המאמר](/blog/<slug>), כאשר <slug> הוא שדה ה-slug שחזר מ-listArticles (זהו קישור אמיתי שהמבקר יכול ללחוץ עליו). בכל הודעה שבה המלצת על מאמרים קרא גם ל-recommendArticles עם slugs — מערך של עד 3 ה-slug שהמלצת עליהם, בסדר הרלוונטיות; הדף מבליט אותם וגולל אליהם. אם לא המלצת על אף מאמר — אל תקרא לה. אל תזכיר את הקריאה במילים.',
  },
  { startsWith: '```recommended', replacement: null },
  { startsWith: '["", "", ""]', replacement: null },
  { equals: '```', replacement: null },
  { startsWith: 'מערך JSON תקין בלבד של עד 3 ה-id', replacement: null },
  // Two lines Base44 left that the site cannot honour: no page has a #consultation
  // anchor (the booking is the home page's #start), and articles are linked by slug.
  {
    startsWith: '6. שאל אם המבקר רוצה המלצות בנושא אחר',
    replacement: '6. שאל אם המבקר רוצה המלצות בנושא אחר, או לקבוע פגישה אישית עם דורית. אם כן — הפנה לקישור [לשיחה קצרה עם דורית](/#start).',
  },
  {
    startsWith: '- החזר תמיד את הקישור המדויק למאמר בפורמט /blog/<id>.',
    replacement: '- החזר תמיד את הקישור המדויק למאמר בפורמט /blog/<slug>, עם ה-slug שחזר מ-listArticles.',
  },
];

/** An agent's instructions as Base44 runs them today. */
export function readAgentInstructions(path) {
  const raw = readFileSync(path, 'utf8').replace(/^\s*\/\/.*$/gm, '');
  return JSON.parse(raw).instructions;
}
export const readInterviewInstructions = readAgentInstructions;

/** Replace each tool-section line by its replacement (still with placeholders); a null one is dropped. */
export function withToolSection(instructions, render = (s) => s, section = INTERVIEW_TOOL_SECTION) {
  const out = [];
  for (const line of instructions.split('\n')) {
    // `equals` for a line no prefix can single out (the blog block's bare closing fence).
    const change = section.find((c) => (c.equals !== undefined ? line === c.equals : line.startsWith(c.startsWith)));
    if (!change) out.push(line);
    else if (change.replacement !== null) out.push(render(change.replacement));
  }
  return out.join('\n');
}

/** Runs of blank lines (3+ newlines) become one blank line: a removed section leaves no gap. */
export function collapseBlankRuns(text) {
  return text.replace(/\n{3,}/g, '\n\n');
}

/** Today's instructions → a prompt template. */
export function toTemplate(instructions, section = INTERVIEW_TOOL_SECTION) {
  let text = withToolSection(instructions, (s) => s, section);
  for (const [key, literal] of PLACEHOLDERS) text = text.split(literal).join(`{{agency.${key}}}`);
  return text;
}

/** A `## N.` section of COMPLIANCE.md, from its heading to the next `## ` heading. */
export function complianceSection(md, number) {
  const lines = md.split('\n');
  const start = lines.findIndex((l) => l.startsWith(`## ${number}.`));
  if (start === -1) throw new Error(`COMPLIANCE.md has no section ${number}`);
  const end = lines.findIndex((l, i) => i > start && l.startsWith('## '));
  return lines.slice(start, end === -1 ? undefined : end).join('\n').trim();
}

/** The model-facing rules: what is forbidden (§3) and how a hand-off goes (§5). */
export function complianceExcerpt(md) {
  return `${complianceSection(md, 3)}\n\n${complianceSection(md, 5)}`;
}
