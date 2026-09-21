#!/usr/bin/env node
/**
 * Does Supabase agree with Base44?
 *
 *   node scripts/backfill-from-base44.mjs --export > export.json   (see below)
 *   node scripts/reconcile-stores.mjs export.json
 *
 * This is the evidence phase 4 rests on. The flip is safe when the two stores
 * have agreed for a sustained stretch, and "agreed" has to mean something
 * checkable rather than remembered — so this exits non-zero on any drift and
 * can gate the cutover rather than merely describe it.
 *
 * Three kinds of disagreement, and they do not mean the same thing:
 *
 *   missing     in Base44, absent from Supabase. A mirror that failed. The
 *               visitor is fine — Base44 is authoritative — but the copy is
 *               incomplete, and re-running the backfill repairs it.
 *   orphaned    in Supabase with no Base44 counterpart. Before the flip this
 *               should be impossible and means something wrote directly.
 *   mismatched  both hold the row and disagree about a field. The most
 *               interesting case: an update that reached one store only.
 *
 * The export holds customer personal data. It is never committed; the path is
 * an argument and only counts and ids are printed, never a name or a phone.
 */
import { readFileSync } from "node:fs";

/** Which entity maps to which table, how rows are keyed, and what must agree. */
export const SPECS = {
  Lead: {
    table: "leads",
    key: (row) => row.base44_id ?? row.id,
    compare: ["name", "phone", "email", "source", "topic", "timing", "message", "status"],
  },
  Contact: {
    table: "contacts",
    // Keyed on phone, as the mirror is: the Contact entity is one record per
    // person, and phone is what both sides agree identifies them.
    key: (row) => normalisePhone(row.phone),
    compare: ["name", "email", "channel", "notes"],
  },
  BlogPost: {
    table: "blog_posts",
    key: (row) => row.base44_id ?? row.id,
    compare: ["title", "excerpt", "body", "image_url", "tags", "published"],
  },
  Testimonial: {
    table: "testimonials",
    key: (row) => row.base44_id ?? row.id,
    compare: ["name", "role", "quote", "image_url", "rating", "source"],
  },
};

/** Digits only: the two stores have never agreed on how to punctuate a number. */
const normalisePhone = (v) => String(v ?? "").replace(/\D/g, "");

/**
 * Compare one entity's rows. Pure, so the interesting cases are testable
 * without standing up two databases to manufacture them.
 */
export function compareRows(base44Rows, supabaseRows, spec) {
  const left = new Map(base44Rows.map((r) => [spec.key(r), r]));
  const right = new Map(supabaseRows.map((r) => [spec.key(r), r]));

  const missing = [...left.keys()].filter((k) => k && !right.has(k));
  const orphaned = [...right.keys()].filter((k) => k && !left.has(k));

  const mismatched = [];
  for (const [k, a] of left) {
    const b = right.get(k);
    if (!k || !b) continue;
    const fields = spec.compare.filter((f) => !same(a[f], b[f]));
    if (fields.length) mismatched.push({ key: k, fields });
  }

  return { missing, orphaned, mismatched };
}

/**
 * Blank is blank however it is spelled.
 *
 * Base44 stores an omitted field as "", the mirror writes NULL, and neither is
 * a disagreement about anything a person typed. Numbers are compared by value
 * because PostgREST returns `rating` as a string.
 */
function same(a, b) {
  const blank = (v) => v === undefined || v === null || v === "";
  if (blank(a) && blank(b)) return true;
  if (typeof a === "number" || typeof b === "number") return Number(a) === Number(b);
  if (typeof a === "boolean" || typeof b === "boolean") return Boolean(a) === Boolean(b);
  return String(a) === String(b);
}

async function fetchTable(url, key, table) {
  const res = await fetch(`${url}/rest/v1/${table}?select=*`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (!res.ok) throw new Error(`${table}: ${res.status} ${(await res.text()).slice(0, 120)}`);
  return res.json();
}

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error("usage: reconcile-stores.mjs <base44-export.json>");
    process.exit(2);
  }
  const url = process.env.SUPABASE_URL?.replace(/\/+$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
    process.exit(2);
  }

  const exported = JSON.parse(readFileSync(file, "utf8"));
  let drift = 0;

  console.log("entity        base44  supabase  missing  orphaned  mismatched");
  console.log("─".repeat(64));

  for (const [entity, spec] of Object.entries(SPECS)) {
    const a = exported[entity] ?? [];
    const b = await fetchTable(url, key, spec.table);
    const { missing, orphaned, mismatched } = compareRows(a, b, spec);
    drift += missing.length + orphaned.length + mismatched.length;

    console.log(
      `${entity.padEnd(13)} ${String(a.length).padStart(6)} ${String(b.length).padStart(9)} ` +
        `${String(missing.length).padStart(8)} ${String(orphaned.length).padStart(9)} ` +
        `${String(mismatched.length).padStart(11)}`,
    );

    // Ids and field names only. A drift report that leaks the row defeats the
    // reason the export is kept out of the repo in the first place.
    for (const k of missing.slice(0, 5)) console.log(`    missing:    ${k}`);
    for (const k of orphaned.slice(0, 5)) console.log(`    orphaned:   ${k}`);
    for (const m of mismatched.slice(0, 5)) {
      console.log(`    mismatched: ${m.key} → ${m.fields.join(", ")}`);
    }
  }

  console.log("─".repeat(64));
  if (drift === 0) {
    console.log("the two stores agree");
    return;
  }
  console.log(`${drift} disagreement(s) — re-run the backfill, then reconcile again`);
  process.exitCode = 1;
}

// Importable for tests; only reconciles when run directly.
if (import.meta.url === `file://${process.argv[1]}`) await main();
