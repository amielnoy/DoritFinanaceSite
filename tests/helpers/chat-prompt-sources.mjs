// How the chat function's Markdown prompts relate to their sources:
//   interview.md  = base44/agents/needs_interview.jsonc's instructions, with the
//                   agency's details as {{agency.*}} placeholders and the three
//                   tool-section lines replaced (the fenced `lead` block becomes a
//                   real submitLead call);
//   support.md    = base44/agents/support_agent.jsonc's instructions, placeholders
//                   likewise; the BlogPost line names listArticles/readArticle and
//                   the logSupportChat lines are removed (the function logs itself);
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
    const change = section.find((c) => line.startsWith(c.startsWith));
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
