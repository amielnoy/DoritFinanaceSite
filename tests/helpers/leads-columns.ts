import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "./entity-schema";

/**
 * The columns `public.leads` has today: the initial table body, then every
 * `alter table public.leads ... add column / drop column` in migration order.
 * A guard that reads only the first migration can never see a column added later.
 */
export function leadsColumns(): string[] {
  const dir = join(REPO_ROOT, "supabase/migrations");
  const cols = new Set<string>();
  for (const f of readdirSync(dir).filter((n) => n.endsWith(".sql")).sort()) {
    const sql = readFileSync(join(dir, f), "utf8").replace(/--[^\n]*/g, "");
    const create = /create table (?:if not exists )?public\.leads \(([\s\S]*?)\n\);/.exec(sql);
    if (create) {
      for (const line of create[1].split("\n")) {
        const m = /^\s*([a-z_][a-z0-9_]*)\s+\S/i.exec(line);
        if (m && !/^(constraint|check|primary|unique|foreign)$/i.test(m[1])) cols.add(m[1]);
      }
    }
    const flat = sql.replace(/\s+/g, " ");
    for (const stmt of flat.matchAll(/alter table (?:if exists )?(?:only )?public\.leads ([^;]*);/gi)) {
      for (const a of stmt[1].matchAll(/add column (?:if not exists )?"?([a-z_][a-z0-9_]*)"?/gi)) cols.add(a[1]);
      for (const d of stmt[1].matchAll(/drop column (?:if exists )?"?([a-z_][a-z0-9_]*)"?/gi)) cols.delete(d[1]);
    }
  }
  return [...cols].sort();
}
