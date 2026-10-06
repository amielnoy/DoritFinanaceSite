import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "../helpers/entity-schema";

/**
 * A time a person reads is Israel time, whatever clock the server keeps.
 *
 * The Base44 functions run on Deno in UTC. `toLocaleString("he-IL")` picks the
 * format from the locale and the zone from the runtime, so an interview summary
 * sent at 08:57 in Tel Aviv was stamped `6.10.2026, 5:57:36` — three hours
 * early, in a mail דורית reads to decide who to call back first. The Sheets log
 * had the same bug and was fixed on its own; this pins every call, not one.
 *
 * Browser code is exempt: there the runtime zone is the reader's own.
 */

const FUNCTIONS = join(REPO_ROOT, "base44/functions");

const entries = readdirSync(FUNCTIONS, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => join(FUNCTIONS, d.name, "entry.ts"))
  .flatMap((path) => {
    try {
      return [{ path, source: readFileSync(path, "utf8") }];
    } catch {
      return [];
    }
  });

/** Every `toLocale…String(…)` call, with its argument list as written. */
function localeCalls(source: string): string[] {
  const calls: string[] = [];
  const start = /\.toLocale(?:Date|Time)?String\(/g;
  for (let m = start.exec(source); m; m = start.exec(source)) {
    let depth = 1;
    let i = m.index + m[0].length;
    while (i < source.length && depth > 0) {
      if (source[i] === "(") depth++;
      else if (source[i] === ")") depth--;
      i++;
    }
    calls.push(source.slice(m.index, i));
  }
  return calls;
}

describe("the functions stamp times in Israel time", () => {
  it("finds the functions to check", () => {
    // An empty scan would pass every assertion below.
    expect(entries.length).toBeGreaterThan(5);
  });

  it("names the zone on every date it formats", () => {
    const unzoned = entries.flatMap(({ path, source }) =>
      localeCalls(source)
        .filter((call) => !/timeZone\s*:\s*['"]Asia\/Jerusalem['"]/.test(call))
        .map((call) => `${relative(REPO_ROOT, path)}: ${call}`)
    );
    expect(unzoned, "formatted in the server's zone, which is UTC").toEqual([]);
  });
});
