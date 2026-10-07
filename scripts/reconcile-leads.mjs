#!/usr/bin/env node
/**
 * Brings Supabase's `leads` back in line with Base44's Lead entity.
 *
 * Until `adminLead` existed, an admin's status change and delete wrote to
 * Base44 only. So Supabase kept every status at "new", and kept leads Dorit had
 * deleted — which the visitor's personal area still showed. This finds both and,
 * only with --apply, fixes them:
 *
 *   to delete   a Supabase row whose base44_id no longer exists in Base44
 *               (its `meetings` row goes with it, on delete cascade)
 *   to update   a row whose status differs from Base44's
 *
 *   node --env-file=.env.local scripts/reconcile-leads.mjs            # dry run, counts and ids only
 *   node --env-file=.env.local scripts/reconcile-leads.mjs --apply    # writes
 *
 * Base44 is read through `base44 exec --privileged --data-env prod`, as in
 * seed-blog.mjs. Supabase needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.
 * Output carries base44 ids and counts, never a name, phone or email.
 *
 * Base44 is the authority here, so an empty or truncated Base44 list refuses to
 * apply: reading it wrong would otherwise plan the deletion of every lead.
 */
import { execFileSync } from "node:child_process";

const LIMIT = 5000;
const PAGE = 1000;
const RESULT = "@@reconcile-leads@@";

/**
 * What differs between the two stores.
 *
 * Pure. `base44` is `[{ id, status }]`, `supabase` is `[{ base44_id, status }]`.
 * A Supabase row with no base44_id cannot be matched to anything and is left
 * alone; a Base44 lead absent from Supabase is a failed create-time mirror, not
 * this script's to repair.
 */
export function planReconcile(base44, supabase) {
  const status = new Map(base44.map((l) => [l.id, l.status ?? "new"]));
  const toDelete = [];
  const toUpdate = [];
  for (const row of supabase) {
    if (!row.base44_id) continue;
    if (!status.has(row.base44_id)) toDelete.push(row.base44_id);
    else if (status.get(row.base44_id) !== row.status) {
      toUpdate.push({ id: row.base44_id, from: row.status, to: status.get(row.base44_id) });
    }
  }
  return { toDelete, toUpdate };
}

/** The JSON an exec script printed, out of the CLI's own output. */
export function readExecResult(stdout) {
  const line = stdout.split("\n").find((l) => l.startsWith(RESULT));
  if (!line) throw new Error("base44 exec printed no result — is the CLI signed in? (`base44 login`)");
  return JSON.parse(line.slice(RESULT.length));
}

function readBase44() {
  const code = `const rows = await base44.entities.Lead.list("-created_date", ${LIMIT});
    console.log(${JSON.stringify(RESULT)} + JSON.stringify(rows.map((r) => ({ id: r.id, status: r.status }))));`;
  const stdout = execFileSync("npx", ["base44", "exec", "--privileged", "--data-env", "prod"], {
    input: code,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    stdio: ["pipe", "pipe", "inherit"],
  });
  return readExecResult(stdout);
}

const headers = (key) => ({ apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" });

async function readSupabase(url, key) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const res = await fetch(`${url}/rest/v1/leads?select=base44_id,status&order=base44_id`, {
      headers: { ...headers(key), Range: `${from}-${from + PAGE - 1}` },
    });
    if (!res.ok) throw new Error(`Supabase read failed: ${res.status}`);
    const page = await res.json();
    rows.push(...page);
    if (page.length < PAGE) return rows;
  }
}

async function write(url, key, method, id, body) {
  const res = await fetch(`${url}/rest/v1/leads?base44_id=eq.${encodeURIComponent(id)}`, {
    method,
    headers: { ...headers(key), Prefer: "return=minimal" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${id}: ${res.status}`);
}

async function main() {
  const apply = process.argv.includes("--apply");
  const { SUPABASE_SERVICE_ROLE_KEY: key } = process.env;
  const url = process.env.SUPABASE_URL?.replace(/\/+$/, "");
  if (!url || !key) {
    console.error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (run with --env-file=.env.local).");
    process.exit(1);
  }

  const base44 = readBase44();
  const supabase = await readSupabase(url, key);
  const { toDelete, toUpdate } = planReconcile(base44, supabase);

  console.log(`Base44 leads: ${base44.length}`);
  console.log(`Supabase leads: ${supabase.length}`);
  console.log(`To delete (gone from Base44): ${toDelete.length}`);
  for (const id of toDelete) console.log(`  delete ${id}`);
  console.log(`To update (status differs): ${toUpdate.length}`);
  for (const u of toUpdate) console.log(`  update ${u.id}: ${u.from} -> ${u.to}`);

  if (!apply) {
    console.log("\nDry run. Nothing was written. Add --apply to perform the above.");
    return;
  }
  if (base44.length === 0 || base44.length >= LIMIT) {
    console.error(`Refusing to apply: Base44 returned ${base44.length} leads (empty or at the ${LIMIT} cap).`);
    process.exit(1);
  }

  let failed = 0;
  for (const id of toDelete) {
    try { await write(url, key, "DELETE", id); } catch (e) { failed++; console.error(e.message); }
  }
  for (const u of toUpdate) {
    try { await write(url, key, "PATCH", u.id, { status: u.to }); } catch (e) { failed++; console.error(e.message); }
  }
  console.log(`Applied ${toDelete.length + toUpdate.length - failed}, failed ${failed}.`);
  if (failed) process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
