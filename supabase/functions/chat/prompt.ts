/**
 * The system prompt, in the platform design's order: the compliance rules (an
 * agency cannot edit them), the role, then the agency's profile. The first two
 * are identical for every conversation of a role, so the cache breakpoint sits
 * on the role block and both are read from cache after the first call.
 */
import { AGENCY } from '../_shared/agency.ts';
import { PROMPTS } from './prompts.generated.ts';

export type ChatRole = 'interview' | 'support' | 'procedures';

export interface SystemBlock {
  type: 'text';
  text: string;
  cache_control?: { type: 'ephemeral' };
}

const PLACEHOLDER = /\{\{agency\.([A-Za-z]+)\}\}/g;

export function fillPlaceholders(template: string, agency: Readonly<Record<string, string>> = AGENCY): string {
  return template.replace(PLACEHOLDER, (whole, key: string) => {
    if (!Object.prototype.hasOwnProperty.call(agency, key)) throw new Error(`unknown prompt placeholder ${whole}`);
    return agency[key];
  });
}

const WEEKDAYS = ['יום ראשון', 'יום שני', 'יום שלישי', 'יום רביעי', 'יום חמישי', 'יום שישי', 'יום שבת'];
const DAY_MS = 24 * 60 * 60 * 1000;
const ISRAEL = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Jerusalem',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** The wall clock in Israel at `ms`: its calendar date and time, whatever the server's zone. */
function israelClock(ms: number) {
  const part = Object.fromEntries(ISRAEL.formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
  const iso = `${part.year}-${part.month}-${part.day}`;
  return { iso, year: part.year, month: part.month, day: part.day, time: `${part.hour}:${part.minute}` };
}

/** The weekday of a calendar date, independent of any time zone. */
const weekday = (iso: string) => WEEKDAYS[new Date(`${iso}T12:00:00Z`).getUTCDay()];

/**
 * Today in Israel, and the next two weeks by weekday. The interview turns
 * "Thursday" or "tomorrow" into a calendar date for scheduledAt
 * (prompts/interview.md), and the model has no clock: without this block it
 * asked the visitor for the date, and the evaluation of 2026-10-14 ran three
 * interviews out of turns on that question. The list leaves the model no date
 * arithmetic to get wrong. Not cached: it changes every minute.
 */
export function todayBlock(nowMs: number): SystemBlock {
  const now = israelClock(nowMs);
  const days: string[] = [];
  for (let i = 0; i < 14; i++) {
    // Noon UTC on each calendar day: never near midnight, so no DST edge moves it.
    const iso = new Date(Date.parse(`${now.iso}T12:00:00Z`) + i * DAY_MS).toISOString().slice(0, 10);
    const [, m, d] = iso.split('-');
    const note = i === 0 ? ' (היום)' : i === 1 ? ' (מחר)' : '';
    days.push(`- ${weekday(iso)} ${d}.${m}${note} — ${iso}`);
  }
  const text = [
    `התאריך והשעה עכשיו: ${weekday(now.iso)}, ${now.day}.${now.month}.${now.year}, ${now.time} (שעון ישראל). היום הוא ${now.iso}.`,
    'הימים הקרובים, לתרגום "חמישי השבוע" או "מחר" לתאריך לוח (לשדה scheduledAt):',
    ...days,
  ].join('\n');
  return { type: 'text', text };
}

export function systemBlocks(role: ChatRole, nowMs: number = Date.now()): SystemBlock[] {
  return [
    { type: 'text', text: PROMPTS.compliance },
    { type: 'text', text: fillPlaceholders(PROMPTS[role]), cache_control: { type: 'ephemeral' } },
    { type: 'text', text: fillPlaceholders(PROMPTS.profile) },
    todayBlock(nowMs),
  ];
}
