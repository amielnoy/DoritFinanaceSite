#!/usr/bin/env node
/**
 * Strips the Google Analytics beacon Allure 3 injects into every report.
 *
 * `@allurereport/plugin-awesome` renders the report from a template guarded by
 * `{{#if analyticsEnable}}` — and passes `analyticsEnable: true` as a literal.
 * There is no config option and no environment variable for it:
 * `ALLURE_NO_ANALYTICS` is read only by the legacy `plugin-allure2`, so setting
 * it leaves this untouched. Verified on 3.16.0.
 *
 * What it would send, to Qameta's property rather than ours, every time anyone
 * opens the report: report type, Allure version and a per-report UUID. This
 * report carries a client's copy and screenshots of her site; it has no
 * business calling a third party when opened.
 *
 * If Allure changes the markup this exits non-zero rather than shrugging. A
 * beacon we failed to remove is worth a red step, because the alternative is
 * shipping one silently.
 */
import { readFileSync, writeFileSync } from "node:fs";

const file = process.argv[2] ?? "allure-report/index.html";
const html = readFileSync(file, "utf8");

const OPEN = '<script async src="https://www.googletagmanager.com';
const CLOSE = "</script>";

const start = html.indexOf(OPEN);
if (start === -1) {
  console.log(`no analytics beacon in ${file} — nothing to strip`);
  process.exit(0);
}

// The tag is followed by an inline gtag() config block; drop both.
const gtag = html.indexOf("gtag(", start);
const end = gtag === -1 ? -1 : html.indexOf(CLOSE, gtag);
if (end === -1) {
  console.error(
    `${file}: found a Google Analytics tag but not the gtag() block that follows it. ` +
      `The report template changed — re-check scripts/strip-allure-analytics.mjs.`,
  );
  process.exit(1);
}

writeFileSync(file, html.slice(0, start) + html.slice(end + CLOSE.length));

const left = readFileSync(file, "utf8").includes("googletagmanager");
if (left) {
  console.error(`${file}: a googletagmanager reference survived the strip.`);
  process.exit(1);
}
console.log(`stripped the analytics beacon from ${file}`);
