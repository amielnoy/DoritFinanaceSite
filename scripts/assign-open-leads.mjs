#!/usr/bin/env node
/**
 * Assigns the open leads before Users lose sight of unassigned ones
 * (docs/superpowers/specs/2026-10-15-agency-roles-design.md, Rollout 2).
 *
 * Once the narrowing migration ships, a User sees only the leads assigned to
 * them. Every lead today is unassigned, so without this step each User's list
 * would go blank overnight. Owners and Admins keep seeing everything.
 *
 *   node --env-file=.env.local scripts/assign-open-leads.mjs                         # list, per agency
 *   node --env-file=.env.local scripts/assign-open-leads.mjs --plan plan.json        # dry run of a plan
 *   node --env-file=.env.local scripts/assign-open-leads.mjs --plan plan.json --apply
 *
 * The plan is JSON, keyed by lead id, or by `agency:<agency id>` for every
 * open unassigned lead of that agency that has no key of its own:
 *
 *   { "agency:00000000-0000-0000-0000-000000000001": "agent@example.com",
 *     "<lead id>": "other-agent@example.com" }
 *
 * An address is resolved to its account through `invitee_for` (the current
 * Auth owner with a profile). The leads trigger refuses an assignee who is
 * not a member of the lead's agency, so --apply cannot hand a lead outside it;
 * each refusal is reported, and the rest still apply. A lead is only ever
 * written while it is still unassigned (`assigned_user_id=is.null`), so a
 * rerun, or an assignment made meanwhile, is never overwritten.
 *
 * "Open" is every status but `closed`. Output carries ids, dates, statuses,
 * sources and topics — never a name, phone or email of a client. Needs
 * SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.
 */
import { readFileSync } from "node:fs";

const PAGE = 1000;
const LIMIT = 20000;

/** Open leads, grouped by agency, oldest first. Pure. */
export function groupOpenLeads(rows) {
  const byAgency = new Map();
  for (const row of rows) {
    if (row.status === "closed" || row.assigned_user_id) continue;
    if (!byAgency.has(row.agency_id)) byAgency.set(row.agency_id, []);
    byAgency.get(row.agency_id).push(row);
  }
  for (const list of byAgency.values()) list.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  return byAgency;
}

/**
 * Which lead goes to which address. Pure.
 *
 * A lead's own key wins over its agency's; a key naming a lead that is not
 * open and unassigned is reported, never silently dropped.
 */
export function planAssignments(openByAgency, plan) {
  const open = new Map();
  for (const list of openByAgency.values()) for (const lead of list) open.set(lead.id, lead);
  const assignments = [];
  const problems = [];
  const taken = new Set();
  for (const [key, email] of Object.entries(plan ?? {})) {
    if (typeof email !== "string" || !email.includes("@")) {
      problems.push({ key, reason: "not_an_address" });
      continue;
    }
    if (key.startsWith("agency:")) continue;
    if (!open.has(key)) {
      problems.push({ key, reason: "not_open_or_unassigned" });
      continue;
    }
    assignments.push({ leadId: key, agencyId: open.get(key).agency_id, email: email.trim().toLowerCase() });
    taken.add(key);
  }
  for (const [key, email] of Object.entries(plan ?? {})) {
    if (!key.startsWith("agency:") || typeof email !== "string" || !email.includes("@")) continue;
    const agencyId = key.slice("agency:".length);
    const list = openByAgency.get(agencyId);
    if (!list) {
      problems.push({ key, reason: "no_open_leads" });
      continue;
    }
    for (const lead of list) {
      if (taken.has(lead.id)) continue;
      assignments.push({ leadId: lead.id, agencyId, email: email.trim().toLowerCase() });
      taken.add(lead.id);
    }
  }
  return { assignments, problems };
}

/** The listing a person reads: per agency, a count and one line per lead. Pure. */
export function describeOpenLeads(openByAgency) {
  const lines = [];
  for (const [agencyId, list] of openByAgency) {
    lines.push(`agency ${agencyId}: ${list.length} open unassigned`);
    for (const lead of list) {
      const when = new Date(lead.created_at).toLocaleString("sv-SE", { timeZone: "Asia/Jerusalem" }).slice(0, 16);
      lines.push(`  ${lead.id}  ${when}  ${lead.status}  ${lead.source ?? "—"}  ${String(lead.topic ?? "").slice(0, 40)}`);
    }
  }
  return lines.length ? lines : ["no open unassigned leads"];
}

function rest(path, init = {}) {
  const url = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  return fetch(`${url}${path}`, {
    ...init,
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
}

async function readOpenLeads() {
  const rows = [];
  for (let from = 0; from < LIMIT; from += PAGE) {
    const res = await rest(
      `/rest/v1/leads?select=id,agency_id,status,source,topic,created_at,assigned_user_id&status=neq.closed&assigned_user_id=is.null&order=created_at.asc`,
      { headers: { Range: `${from}-${from + PAGE - 1}` } },
    );
    if (!res.ok) throw new Error(`leads_http_${res.status}`);
    const page = await res.json();
    rows.push(...page);
    if (page.length < PAGE) break;
  }
  return rows;
}

async function resolveAccount(email) {
  const res = await rest("/rest/v1/rpc/invitee_for", { method: "POST", body: JSON.stringify({ p_email: email }) });
  if (!res.ok) throw new Error(`invitee_for_http_${res.status}`);
  const id = await res.json();
  return typeof id === "string" && id ? id : null;
}

async function assign(leadId, userId) {
  const res = await rest(`/rest/v1/leads?id=eq.${leadId}&assigned_user_id=is.null`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ assigned_user_id: userId }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    return { ok: false, reason: String(body?.message || `http_${res.status}`).slice(0, 60) };
  }
  const rows = await res.json();
  return rows.length === 1 ? { ok: true } : { ok: false, reason: "no_longer_unassigned" };
}

async function main(argv) {
  const apply = argv.includes("--apply");
  const planAt = argv.indexOf("--plan");
  const planFile = planAt >= 0 ? argv[planAt + 1] : null;
  if (apply && !planFile) throw new Error("--apply needs --plan <file>");

  const open = groupOpenLeads(await readOpenLeads());
  for (const line of describeOpenLeads(open)) console.log(line);
  if (!planFile) return 0;

  const { assignments, problems } = planAssignments(open, JSON.parse(readFileSync(planFile, "utf8")));
  for (const p of problems) console.log(`skip ${p.key}: ${p.reason}`);

  const accounts = new Map();
  for (const email of new Set(assignments.map((a) => a.email))) accounts.set(email, await resolveAccount(email));
  // Addresses are the operator's own staff, not clients; still, the output names
  // each by its position in the plan rather than echoing it.
  const label = new Map([...accounts.keys()].map((email, i) => [email, `assignee#${i + 1}`]));
  for (const [email, id] of accounts) console.log(`${label.get(email)}: ${id ? "account found" : "NO ACCOUNT — sign in once first"}`);

  let done = 0;
  let failed = 0;
  for (const a of assignments) {
    const userId = accounts.get(a.email);
    if (!userId) {
      failed++;
      console.log(`skip ${a.leadId}: ${label.get(a.email)} has no account`);
      continue;
    }
    if (!apply) {
      console.log(`would assign ${a.leadId} → ${label.get(a.email)}`);
      continue;
    }
    const r = await assign(a.leadId, userId);
    if (r.ok) done++;
    else failed++;
    console.log(`${r.ok ? "assigned" : `failed (${r.reason})`} ${a.leadId} → ${label.get(a.email)}`);
  }
  console.log(apply ? `assigned ${done}, failed ${failed}` : `dry run: ${assignments.length} planned — add --apply to write`);
  return failed && apply ? 1 : 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e) => {
      console.error(String(e?.message ?? e));
      process.exit(2);
    },
  );
}
