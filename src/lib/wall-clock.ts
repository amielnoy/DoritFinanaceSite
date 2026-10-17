/**
 * Dates as a person in Israel reads them.
 *
 * A meeting the visitor asked for "tomorrow, morning" is a day on the Israeli
 * calendar and an hour on an Israeli clock. `new Date(x).toISOString()` gives
 * neither: it is UTC, so near midnight it names the wrong day, and as a
 * `scheduledAt` it lands the meeting three hours early — the exact bug that
 * once filed every agreed meeting late in the only diary anyone reads (see
 * `wallClock` in AGENTS.md). So this file never calls it: the calendar day comes
 * from `Asia/Jerusalem` components, and the arithmetic below is on calendar
 * days, where UTC is only a counter with no zone in it.
 */

const TZ = "Asia/Jerusalem";

/** A calendar day, "YYYY-MM-DD". */
export type Ymd = string;

const pad = (n: number) => String(n).padStart(2, "0");

/** Today's date in Israel, at the instant `now`. */
export function israelToday(now: Date): Ymd {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

const toUtcDay = (ymd: Ymd) => {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};

const fromUtcDay = (date: Date): Ymd =>
  `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;

/** The day `n` calendar days after `ymd`. */
export function addDays(ymd: Ymd, n: number): Ymd {
  const date = toUtcDay(ymd);
  date.setUTCDate(date.getUTCDate() + n);
  return fromUtcDay(date);
}

/** 0 = Sunday … 6 = Saturday, for the calendar day itself. */
export function weekday(ymd: Ymd): number {
  return toUtcDay(ymd).getUTCDay();
}

/** Sunday to Thursday. Dorit does not meet on Friday or Saturday. */
export const isWorkingDay = (ymd: Ymd): boolean => weekday(ymd) <= 4;

/**
 * The days behind the wizard's chips, from Israel's "today".
 *
 * - tomorrow — only when it is a working day.
 * - thisWeek — the next working day after today within this week (Sunday to
 *   Thursday); absent from Thursday on, when this week has none left.
 * - nextWeek — Sunday of next week.
 * - earliest — the first date the picker may offer: tomorrow.
 */
export function dayChoices(now: Date): { tomorrow?: Ymd; thisWeek?: Ymd; nextWeek: Ymd; earliest: Ymd } {
  const today = israelToday(now);
  const tomorrow = addDays(today, 1);
  const todayWeekday = weekday(today);
  return {
    tomorrow: isWorkingDay(tomorrow) ? tomorrow : undefined,
    // The next working day is tomorrow whenever today is Sunday to Wednesday;
    // from Thursday the week has no working day left (Saturday's tomorrow is
    // next week's Sunday).
    thisWeek: todayWeekday <= 3 ? tomorrow : undefined,
    nextWeek: addDays(today, 7 - todayWeekday),
    earliest: tomorrow,
  };
}

/** "YYYY-MM-DDTHH:MM:SS" on Israel's wall clock — what `submitLead` books. */
export function wallClockStamp(ymd: Ymd, hhmm: string): string {
  return `${ymd}T${hhmm}:00`;
}

/** "יום שני, 13.10" — how the summary names a chosen date. */
export function hebrewDay(ymd: Ymd): string {
  const days = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];
  const [, m, d] = ymd.split("-");
  return `יום ${days[weekday(ymd)]}, ${Number(d)}.${m}`;
}

/** Israel's offset from UTC, in minutes, at the instant `at` (+120 or +180). */
function israelOffsetMinutes(at: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ, hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  }).formatToParts(at);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const wall = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"));
  return Math.round((wall - Math.floor(at.getTime() / 60_000) * 60_000) / 60_000);
}

/**
 * The instant at which Israel's wall clock reads `ymd` `hhmm` — what a
 * staff member means by "14.12 at 17:30", as an ISO string for a timestamptz.
 *
 * The offset is read at the guess and again at the corrected instant, so a
 * time on either side of a daylight-saving change lands on the right hour.
 * Null for a day or time that does not parse.
 */
export function israelInstant(ymd: Ymd, hhmm: string): string | null {
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  const time = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!day || !time) return null;
  const naive = Date.UTC(Number(day[1]), Number(day[2]) - 1, Number(day[3]), Number(time[1]), Number(time[2]));
  if (Number.isNaN(naive)) return null;
  let at = new Date(naive - israelOffsetMinutes(new Date(naive)) * 60_000);
  at = new Date(naive - israelOffsetMinutes(at) * 60_000);
  return at.toISOString();
}

/** An instant as Israel's wall clock shows it: the day and "HH:MM". */
export function israelWallClock(iso: string): { ymd: Ymd; hhmm: string } | null {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ, hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  }).formatToParts(at);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return { ymd: `${get("year")}-${get("month")}-${get("day")}`, hhmm: `${get("hour")}:${get("minute")}` };
}

