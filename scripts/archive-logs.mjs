// Pull the last day of function logs out of Base44 and write them to `logs/`.
//
// Base44 retains function logs and serves them through `base44 logs`, but its
// retention is finite and reading it needs a workspace key and a terminal. That
// answers "what is happening now" and not "what changed since last Tuesday",
// which is the question that gets asked after someone reports a lead that never
// arrived.
//
// One file per UTC day, JSON Lines, so the archive is greppable with no tooling
// and appendable with no parsing. The date in the name is the date of the
// *window*, not of the run: this fires after midnight nowhere in particular,
// and a file called by its run date would be a file nobody can find later.
//
// The functions decide what is in a line; see the `log()` helper duplicated
// across `base44/functions/*/entry.ts`. The rule there is what happened, not
// what was said — no names, numbers, addresses or free text — which is what
// makes it safe to keep this for ninety days.

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const since = process.env.LOG_WINDOW || '24h';
const env = process.env.LOG_ENV || 'prod';
const dir = process.env.LOG_DIR || 'logs';

/** The day the window covers, which is yesterday for a nightly run. */
function windowDate() {
  const hours = /^(\d+)h$/.exec(since);
  const days = /^(\d+)d$/.exec(since);
  const back = hours ? Number(hours[1]) : days ? Number(days[1]) * 24 : 24;
  return new Date(Date.now() - back * 60 * 60 * 1000).toISOString().slice(0, 10);
}

let raw;
try {
  // `--json` puts the records on stdout and everything else on stderr, which is
  // the only reason this can be parsed at all.
  raw = execFileSync(
    'npx',
    ['base44', 'logs', '--env', env, '--since', since, '--limit', '1000', '--order', 'asc', '--json'],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'inherit'] },
  );
} catch (error) {
  // A failure here must not fail the nightly run. Nothing else in it depends on
  // the archive, and a red CI badge every morning because a log fetch timed out
  // trains everyone to ignore the badge.
  console.log(`::warning::Could not fetch logs: ${error.message}`);
  process.exit(0);
}

const parsed = (() => {
  try {
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : (data.logs ?? data.items ?? data.results ?? []);
  } catch {
    // Not JSON — keep whatever came back rather than discarding the day.
    return null;
  }
})();

mkdirSync(dir, { recursive: true });
const file = join(dir, `${windowDate()}.jsonl`);

if (parsed === null) {
  writeFileSync(file, raw);
  console.log(`::warning::Log output was not JSON; wrote it verbatim to ${file}`);
} else {
  writeFileSync(file, parsed.map((entry) => JSON.stringify(entry)).join('\n') + (parsed.length ? '\n' : ''));
  console.log(`Wrote ${parsed.length} log records to ${file}`);
  if (parsed.length === 1000) {
    // The server caps a page at 500 and the CLI pages up to the limit asked
    // for. Hitting the ceiling exactly means the window was busier than one
    // fetch can carry, and the oldest lines of that day are missing.
    console.log('::warning::Hit the 1000-record ceiling — this day is truncated. Narrow LOG_WINDOW and run twice.');
  }
}
