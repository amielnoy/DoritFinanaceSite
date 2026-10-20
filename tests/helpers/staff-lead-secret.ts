import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "./entity-schema";

/**
 * create_staff_lead's `c_secret`, character for character: the SQL (`~`, a
 * Postgres ARE) behind its field_invalid refusal. It detects what redact() in
 * supabase/functions/submit-lead/lead.js cuts out — a card, a nine-digit ID or
 * a six-to-eight-digit account between non-digits, an IBAN between
 * non-alphanumerics — in notes, topic and referrer.
 */
export const SECRET_SQL =
  "(^|[^0-9])([0-9]{4}[- ]?[0-9]{4}[- ]?[0-9]{4}[- ]?[0-9]{4}|[0-9]{6,9})([^0-9]|$)|(^|[^A-Za-z0-9])[Ii][Ll][0-9]{2}[A-Za-z0-9]{17,}([^A-Za-z0-9]|$)";

/**
 * The same pattern in JavaScript, unchanged: it uses only ASCII classes,
 * `^`, `$` and alternation, which mean the same in both engines (no `\y` or
 * `\b`, whose idea of a word character differs — Postgres counts a Hebrew
 * letter, JavaScript does not).
 */
export const SECRET_JS = new RegExp(SECRET_SQL);

/** redact() itself, lifted out of the Deno module (which reads Deno.env at load). */
export function liftRedact(): (text: string) => string {
  const src = readFileSync(join(REPO_ROOT, "supabase/functions/submit-lead/lead.js"), "utf8");
  const start = src.indexOf("function redact(");
  if (start < 0) throw new Error("redact() not found in lead.js");
  const fn = src.slice(start, src.indexOf("\n}", start) + 2);
  return new Function(`${fn}; return redact;`)() as (text: string) => string;
}

/**
 * create-lead's `scrub`, as the handler defines it: redact() twice. The handler
 * cannot be imported here (it needs Deno), so the definition is read from its
 * source and held to that exact shape, then built from the lifted redact().
 */
export function liftScrub(): (text: string) => string {
  const src = readFileSync(join(REPO_ROOT, "supabase/functions/create-lead/handler.ts"), "utf8");
  if (!src.includes("export const scrub = (v: unknown) => redact(redact(text(v)));")) throw new Error("scrub() in create-lead/handler.ts is not redact(redact(text(v)))");
  const redact = liftRedact();
  return (s) => redact(redact(s.trim()));
}
