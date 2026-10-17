import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "../helpers/entity-schema";

/**
 * A field whose label ends in "*" is required, and a screen reader has to
 * hear that too: the "*" alone is read as "star", or not at all (D-16, manual
 * test 2026-10-14 — the claim form's name and phone). Every form that labels a
 * field from a Hebrew resource ending in " *" must give that field's input
 * `aria-required="true"` (or `required`).
 */
const FORMS = "src/components/dorit/forms";
const he = Object.fromEntries(
  readdirSync(join(REPO_ROOT, "src/i18n/locales/he"))
    .filter((f) => f.endsWith(".json"))
    .flatMap((f) => Object.entries(JSON.parse(readFileSync(join(REPO_ROOT, "src/i18n/locales/he", f), "utf8")) as Record<string, string>)),
);
const starred = new Set(Object.keys(he).filter((k) => typeof he[k] === "string" && he[k].trimEnd().endsWith("*")));

/** Each `<Field label={t("key")}>` with a starred key, and the first `<input …>` inside it. */
function starredFields(src: string): { key: string; input: string }[] {
  const out: { key: string; input: string }[] = [];
  for (const m of src.matchAll(/<Field label=\{t\("([^"]+)"\)\}[^>]*>([\s\S]*?)<\/Field>/g)) {
    if (!starred.has(m[1])) continue;
    const input = m[2].match(/<(?:input|textarea)\b[\s\S]*?\/>/)?.[0] ?? "";
    out.push({ key: m[1], input });
  }
  return out;
}

const files = readdirSync(join(REPO_ROOT, FORMS))
  .filter((f) => f.endsWith(".tsx"))
  .map((f) => `${FORMS}/${f}`)
  .filter((f) => starredFields(readFileSync(join(REPO_ROOT, f), "utf8")).length > 0);

describe("fields marked * are required for screen readers too", () => {
  it("finds the starred fields of the claim, quick-contact and pension-check forms", () => {
    expect(files).toEqual(expect.arrayContaining([`${FORMS}/ClaimForm.tsx`, `${FORMS}/QuickContact.tsx`, `${FORMS}/PensionCheckForm.tsx`]));
  });

  it.each(files)("%s", (file) => {
    for (const { key, input } of starredFields(readFileSync(join(REPO_ROOT, file), "utf8"))) {
      expect(input, `${file}: ${key}`).not.toBe("");
      expect(input, `${file}: ${key}`).toMatch(/aria-required="true"|\brequired\b/);
    }
  });
});
