#!/usr/bin/env node
/**
 * Blocking typecheck, on a ratchet.
 *
 * `tsc` reports 93 errors inherited from the JS→TS conversion. Every one of
 * them is in a `.tsx` file that imports an untyped `.jsx` shadcn primitive:
 * TypeScript sees `IntrinsicAttributes & RefAttributes<any>` and rejects every
 * prop passed to it. None are in the JavaScript files themselves, and none are
 * bugs — which is why the step was `continue-on-error` and why simply flipping
 * that to blocking would only paint CI red.
 *
 * The cost of leaving it advisory is that a *genuinely new* type error lands
 * silently among the 93 and nobody has to fix it. So this gate blocks on what
 * is new rather than on what is inherited:
 *
 *   - a new (file, error-code) pair            → fail
 *   - more errors of a known kind in a file    → fail
 *   - fewer errors than the baseline           → pass, and say so
 *
 * Errors are keyed by file and code, never by line number, so unrelated edits
 * that shift lines do not trip it.
 *
 *   npm run typecheck           the raw tsc output, all 93
 *   npm run typecheck:gate      this gate — what CI runs
 *   npm run typecheck:baseline  re-lock after fixing some
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BASELINE = join(ROOT, "tests/typecheck-baseline.json");
const WRITE = process.argv.includes("--write");

/** `path/to/file.tsx(12,5): error TS2322: message` → { file, code } */
const LINE = /^(.+?)\((\d+),(\d+)\): error (TS\d+):/;

function collect() {
  let out = "";
  try {
    out = execFileSync("npx", ["tsc", "-p", "tsconfig.json", "--noEmit", "--pretty", "false"], {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (e) {
    // tsc exits non-zero whenever it reports anything; the output is the point.
    out = `${e.stdout ?? ""}${e.stderr ?? ""}`;
  }

  const counts = {};
  for (const line of out.split("\n")) {
    const m = LINE.exec(line.trim());
    if (!m) continue;
    const key = `${m[1].replace(/\\/g, "/")}|${m[4]}`;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

const current = collect();
const total = Object.values(current).reduce((a, b) => a + b, 0);

if (WRITE) {
  writeFileSync(BASELINE, `${JSON.stringify(current, null, 2)}\n`, "utf8");
  console.log(`Baseline written: ${total} errors across ${Object.keys(current).length} file/code pairs.`);
  process.exit(0);
}

if (!existsSync(BASELINE)) {
  console.error(`No baseline at ${BASELINE}. Run: npm run typecheck:baseline`);
  process.exit(1);
}

const baseline = JSON.parse(readFileSync(BASELINE, "utf8"));
const baseTotal = Object.values(baseline).reduce((a, b) => a + b, 0);

const regressions = [];
for (const [key, count] of Object.entries(current)) {
  const allowed = baseline[key] ?? 0;
  if (count > allowed) {
    const [file, code] = key.split("|");
    regressions.push({ file, code, count, allowed });
  }
}

if (regressions.length > 0) {
  console.error(`\nTypecheck regressed — ${regressions.length} new problem(s):\n`);
  for (const r of regressions) {
    const what = r.allowed === 0 ? "new error kind here" : `was ${r.allowed}, now ${r.count}`;
    console.error(`  ${r.file}  ${r.code}  (${what})`);
  }
  console.error(
    `\nThese are yours — the ${baseTotal} inherited errors are allowed for, this is on top.\n` +
      `Run \`npm run typecheck\` for the full message, fix it, and re-run.\n`,
  );
  process.exit(1);
}

const fixed = baseTotal - total;
if (fixed > 0) {
  console.log(
    `Typecheck: ${total} errors, down ${fixed} from the baseline of ${baseTotal}.\n` +
      `Lock the improvement in with: npm run typecheck:baseline`,
  );
} else {
  console.log(`Typecheck: ${total} inherited errors, no new ones.`);
}
