/**
 * Israeli business days: Sunday to Thursday, read in Asia/Jerusalem.
 *
 * The clearinghouse deletes a download "after 7 business days", and the site
 * warns on day 5. The functions run in UTC, where late Thursday evening is
 * already Friday in Israel, so the calendar day is always read in Israel's zone.
 * Days are stepped on that calendar, keeping the Israeli wall-clock time, so a
 * daylight-saving change (late March, late October) never shifts the result by
 * an hour or onto the wrong day. Holidays are not modelled: on a holiday week
 * the warning comes a day or two early, never late — the side to err on when a
 * missed file costs ₪14.
 */
const ZONE = 'Asia/Jerusalem';
const WALL = new Intl.DateTimeFormat('en-US', {
  timeZone: ZONE,
  hourCycle: 'h23',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: 'numeric',
  second: 'numeric',
});

/** Israel's wall clock at `at`, expressed as if it were UTC. */
function wallAsUtc(at: number): number {
  const p: Record<string, number> = {};
  for (const part of WALL.formatToParts(new Date(at))) {
    if (part.type !== 'literal') p[part.type] = Number(part.value);
  }
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) + (((at % 1000) + 1000) % 1000);
}

/** The instant whose Israeli wall clock reads `wall` (given as if UTC). */
function instantAtWall(wall: number, near: number): number {
  let at = wall - (wallAsUtc(near) - near);
  at = wall - (wallAsUtc(at) - at);
  return at;
}

export function addBusinessDays(from: Date, days: number): Date {
  const start = from.getTime();
  let wall = wallAsUtc(start);
  let at = start;
  let left = days;
  while (left > 0) {
    wall += 86_400_000;
    at = instantAtWall(wall, at);
    // The wall clock is treated as UTC here, so getUTCDay is Israel's weekday.
    const weekday = new Date(wall).getUTCDay();
    if (weekday <= 4) left -= 1;
  }
  return new Date(at);
}
