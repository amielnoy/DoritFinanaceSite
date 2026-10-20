import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "./entity-schema";

/**
 * create_staff_lead's `c_secret`, character for character: the SQL (`~`, a
 * Postgres ARE) behind its field_invalid refusal. It detects what redact() in
 * supabase/functions/submit-lead/lead.js cuts out — a card, an IBAN, a
 * nine-digit ID, a six-to-eight-digit account — in notes, topic and referrer.
 */
export const SECRET_SQL =
  "\\y([0-9]{4}[- ]?[0-9]{4}[- ]?[0-9]{4}[- ]?[0-9]{4}|[Ii][Ll][0-9]{2}[A-Za-z0-9]{17,}|[0-9]{6,9})\\y";

/**
 * The same pattern for JavaScript. Postgres's `\y` (a word boundary) becomes
 * `\b`. JavaScript counts only [A-Za-z0-9_] as word characters and Postgres
 * counts those and more (any letter of the locale), so JavaScript finds a
 * boundary wherever Postgres does: no match here means no match there.
 */
export const SECRET_JS = new RegExp(SECRET_SQL.replaceAll("\\y", "\\b"));

/** redact() itself, lifted out of the Deno module (which reads Deno.env at load). */
export function liftRedact(): (text: string) => string {
  const src = readFileSync(join(REPO_ROOT, "supabase/functions/submit-lead/lead.js"), "utf8");
  const start = src.indexOf("function redact(");
  if (start < 0) throw new Error("redact() not found in lead.js");
  const fn = src.slice(start, src.indexOf("\n}", start) + 2);
  return new Function(`${fn}; return redact;`)() as (text: string) => string;
}
