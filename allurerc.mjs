import { defineConfig } from "allure";

/**
 * Allure 3 report configuration.
 *
 * The report is produced in two shapes from the same results, because the two
 * places it goes have opposite constraints:
 *
 *   singleFile (default) — one self-contained index.html, attached to each CI
 *     run as an artifact and generated locally. Allure 2 could not do this: it
 *     emitted thousands of small JSON files fetched over XHR, so the report had
 *     to be *served* and opening it from disk showed an empty shell.
 *
 *   ALLURE_SINGLE_FILE=0 — the ordinary multi-file report, for Cloudflare
 *     Pages. Cloudflare refuses any single asset over 25 MiB and a full run's
 *     single-file report is around 46 MB, so the hosted copy has to be the
 *     split one: roughly 4,000 files against a 20,000-file ceiling.
 *
 * History lives outside the report, as a JSONL file CI carries between runs in
 * a cache — without it every report claims to be the first one and the trend
 * graphs say nothing.
 */
const singleFile = process.env.ALLURE_SINGLE_FILE !== "0";

export default defineConfig({
  name: "Dorit Gov-Ari — test report",
  output: "./allure-report",
  historyPath: "./allure-history/history.jsonl",
  plugins: {
    awesome: {
      options: { singleFile },
    },
  },
});
