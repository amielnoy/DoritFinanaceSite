import { generateKeyPairSync } from "node:crypto";
import { join } from "node:path";
import { buildSync } from "esbuild";
import { REPO_ROOT } from "./entity-schema";
import { MAILER_URL, type EmailCall, type FetchCall } from "./base44-function";

/**
 * Runs a Supabase Edge Function in-process, the way tests/helpers/base44-function.ts
 * runs a Base44 one: what executes is the code that deploys.
 *
 * `handler.ts` and the `_shared` modules it imports are bundled with esbuild
 * into one CommonJS chunk and evaluated with `fetch` and `Deno` passed in, so
 * every outbound call is recorded and answered here. Nothing reaches a network.
 */

const AGENCY_1_ID = "00000000-0000-0000-0000-000000000001";

export const SUPABASE_URL = "https://project-ref.supabase.test";
const SERVICE_KEY = "service-role-test";

/** One service-account key per test file: real RS256, signed by google.ts, never sent anywhere. */
const TEST_SA = (() => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  return JSON.stringify({
    client_email: "leads@test-project.iam.gserviceaccount.com",
    private_key: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    token_uri: "https://oauth2.googleapis.com/token",
  });
})();

/** The clearinghouse tables, Supabase Auth and the staff RPCs, for the masleka functions. */
export interface MaslekaFake {
  /** Rows of `masleka_requests` as stored (copied; read the result's `maslekaRequests`). */
  requests?: Record<string, unknown>[];
  /** Bearer token → the user id `GET /auth/v1/user` answers; any other token gets Auth's own refusal (403 bad_jwt). */
  sessions?: Record<string, string>;
  /**
   * User id → their agency role ('owner' | 'admin' | 'user'): what
   * `staff_role(user, agency)` answers, for any agency; absent means null (no
   * membership). It also decides the fakes of `can_see_lead` and
   * `can_work_request` below.
   */
  roles?: Record<string, string | null>;
  /** Users whose profile is the platform operator (`profiles.role = 'admin'`). */
  operators?: string[];
  /** User id → their profile e-mail, as `profiles` answers it. */
  emails?: Record<string, string>;
  /**
   * Lead id → the user it is assigned to. `can_see_lead` (asked under the
   * caller's token) answers true for the operator, an Admin or Owner, and the
   * assignee; `can_work_request` the same through the request's lead, or the
   * request's `created_by` when it has none.
   */
  assigned?: Record<string, string>;
  /** Lead id → its agency, as `lead_in_agency` reads it; a lead not named here is agency 1's. */
  leadAgency?: Record<string, string>;
  /** Who a lead may be assigned to (the leads trigger's check); anyone else is refused `assignee_not_member`. */
  members?: string[];
  /** `set_member_role` and `remove_member` refuse with this reason (as PostgREST relays a function's exception). */
  refuse?: string;
  /** What `masleka_staff_emails` answers. */
  staffEmails?: string[];
  /** `masleka_staff_emails` answers 500. */
  failStaffEmails?: boolean;
  /** Inserts into `masleka_access_log` answer 500. */
  failAccessLog?: boolean;
  /** Inserts into and updates of `masleka_requests` answer 500. */
  failRequestWrite?: boolean;
  /**
   * A concurrent request wins the race: these fields are merged into every
   * stored request just before the first PATCH to `masleka_requests` is
   * matched, as if another submission had landed between this call's read
   * and its conditional update.
   */
  raceBeforePatch?: Record<string, unknown>;
  /** These fields are merged into every stored request each time a mail is accepted (a write landing mid-run). */
  afterMail?: Record<string, unknown>;
  /** PATCHes to `masleka_requests` whose query contains this text answer 500. */
  failPatchMatching?: string;
}

export interface EdgeOptions {
  /** The clearinghouse fakes — see MaslekaFake. */
  masleka?: MaslekaFake;
  /** PostgREST refuses the insert: `true` for a 500, or a status and body of your own. */
  failLeadWrite?: boolean | { status: number; body: string };
  /** The insert answers a row with no `id`. */
  leadWithoutId?: boolean;
  /** Recipients whose delivery the mailer refuses. */
  failEmailTo?: string[];
  env?: Record<string, string>;
  method?: string;
  headers?: Record<string, string>;
  /** Sent as-is instead of JSON.stringify(body). */
  rawBody?: string;
  /** `allow_submission` answers false for keys starting with any of these ('claim-ip:', 'confirm-to:'). */
  overLimit?: string[];
  /** `allow_submission` fails with this HTTP status instead of answering. */
  failLimiter?: number;
  /** Storage refuses to sign links with this HTTP status. */
  failSign?: number;
  /** Rows `selectRows('leads', …)` answers, filtered by id=in.(…), phone=eq., source=eq., status=eq. (and created_at=gte.). */
  existingLeads?: Record<string, unknown>[];
  /** That Google call answers 500. */
  failGoogle?: "token" | "calendar" | "sheets";
  /** The calendar answers this status. */
  calendarStatus?: number;
  /** Every meetings write (insert or update) answers 404. */
  failMeetings?: boolean;
  /** Meetings already stored, which the first-booking lookup and updates by id see. */
  existingMeetings?: Record<string, unknown>[];
  /**
   * Signed-in callers: a bearer token → the verified address `my_email()`
   * answers for it. Any other token (the anon key) is refused, as PostgREST
   * refuses my_email() to anon.
   */
  clientSessions?: Record<string, string>;
  /** The env has no GOOGLE_SERVICE_ACCOUNT_JSON. */
  noGoogle?: boolean;
  /** Changes to the default env: a value sets the key, `null` removes it. Ignored with `env`. */
  envPatch?: Record<string, string | null>;
  /** The leads lookup (`GET /rest/v1/leads?…`) answers 500. */
  failLeadLookup?: boolean;
  /** Every mailer call answers this status — the same knob as base44-function.ts. */
  resendStatus?: number;
  /** …with this body instead of the default. */
  resendResponse?: unknown;
  /**
   * Answers any upstream call before the built-in stubs, for a function whose
   * upstreams this harness does not model (content-admin's auth and tables).
   * Return undefined to fall through to them.
   */
  upstream?: (call: FetchCall) => Response | undefined;
}

export interface EdgeInvocation {
  status: number;
  json: Record<string, unknown>;
  headers: Headers;
  /** Rows PostgREST accepted, as stored (with their generated `id`). */
  leads: Record<string, unknown>[];
  emails: EmailCall[];
  fetches: FetchCall[];
  mailTo(address: string): EmailCall;
  leadUpdates: { id: string; fields: Record<string, unknown> }[];
  meetings: Record<string, unknown>[];
  calendarEvents: Record<string, unknown>[];
  sheetRows: { tab: string; row: unknown[] }[];
  /** `masleka_requests` after the call, every write applied. */
  maslekaRequests: Record<string, unknown>[];
  /** Rows written to `masleka_access_log`. */
  accessLog: Record<string, unknown>[];
  /** Each PATCH to `masleka_requests`: its query string and the fields it set. */
  requestPatches: { query: string; fields: Record<string, unknown> }[];
  /** Each call to `set_member_role` / `remove_member`: the function, its arguments, and whose session made it. */
  memberCalls: { fn: string; args: Record<string, unknown>; as: string | null }[];
  callsTo(fragment: string): FetchCall[];
}

type Handler = (req: Request) => Promise<Response>;
type Factory = (
  module: { exports: Record<string, unknown> },
  exports: unknown,
  fetch: unknown,
  deno: unknown,
) => Handler;

const compiled = new Map<string, Factory>();

function compile(name: string): Factory {
  const out = buildSync({
    entryPoints: [join(REPO_ROOT, "supabase/functions", name, "handler.ts")],
    bundle: true,
    write: false,
    format: "cjs",
    platform: "neutral",
    target: "es2022",
    logLevel: "silent",
  });
  // eslint-disable-next-line no-new-func -- the point of this harness
  return new Function(
    "module",
    "exports",
    "fetch",
    "Deno",
    `${out.outputFiles[0].text}\n;return module.exports.handler;`,
  ) as Factory;
}

/**
 * Whether a row satisfies a PostgREST filter string — the operators the
 * masleka functions use, and nothing else: an unknown one throws, so a
 * function that starts filtering differently fails its tests instead of
 * matching everything.
 */
function postgrestMatch(row: Record<string, unknown>, q: URLSearchParams): boolean {
  for (const [column, raw] of q.entries()) {
    if (["select", "order", "limit", "on_conflict"].includes(column)) continue;
    const value = row[column];
    if (raw === "is.null") {
      if (value !== null && value !== undefined) return false;
      continue;
    }
    if (raw === "not.is.null") {
      if (value === null || value === undefined) return false;
      continue;
    }
    const dot = raw.indexOf(".");
    const op = raw.slice(0, dot);
    const operand = raw.slice(dot + 1);
    const compare = () => {
      const a = Date.parse(String(value));
      const b = Date.parse(operand);
      return Number.isNaN(a) || Number.isNaN(b) ? String(value ?? "").localeCompare(operand) : a - b;
    };
    if (op === "eq") {
      if (String(value) !== operand) return false;
    } else if (op === "in") {
      if (!operand.replace(/^\(|\)$/g, "").split(",").includes(String(value))) return false;
    } else if (op === "gt" || op === "gte" || op === "lt" || op === "lte") {
      if (value === null || value === undefined) return false;
      const c = compare();
      const ok = op === "gt" ? c > 0 : op === "gte" ? c >= 0 : op === "lt" ? c < 0 : c <= 0;
      if (!ok) return false;
    } else {
      throw new Error(`unsupported PostgREST filter in an Edge Function test: ${column}=${raw}`);
    }
  }
  return true;
}

/** A row cut down to `select=a,b,c`, as PostgREST answers it. */
function postgrestProject(row: Record<string, unknown>, select: string | null): Record<string, unknown> {
  if (!select || select === "*") return { ...row };
  return Object.fromEntries(select.split(",").map((c) => [c, row[c] ?? null]));
}

/** Invoke an Edge Function with recording upstreams, and report what it did. */
export async function invokeEdge(name: string, body: unknown, options: EdgeOptions = {}): Promise<EdgeInvocation> {
  if (!compiled.has(name)) compiled.set(name, compile(name));
  const leads: Record<string, unknown>[] = [];
  const emails: EmailCall[] = [];
  const fetches: FetchCall[] = [];
  const leadUpdates: { id: string; fields: Record<string, unknown> }[] = [];
  const meetings: Record<string, unknown>[] = (options.existingMeetings ?? []).map((m) => ({ ...m }));
  const calendarEvents: Record<string, unknown>[] = [];
  const sheetRows: { tab: string; row: unknown[] }[] = [];
  // Copies: a PATCH writes into the stored row, and a suite that runs the same
  // fixture against Base44 and then Edge must not see the first run's update.
  const stored: Record<string, unknown>[] = (options.existingLeads ?? []).map((l) => ({ ...l }));
  const masleka = options.masleka ?? {};
  const maslekaRequests: Record<string, unknown>[] = (masleka.requests ?? []).map((r) => ({ ...r }));
  const accessLog: Record<string, unknown>[] = [];
  const requestPatches: { query: string; fields: Record<string, unknown> }[] = [];
  const memberCalls: { fn: string; args: Record<string, unknown>; as: string | null }[] = [];
  let raced = false;
  /** Whose session a call carries: the user its bearer token names, or null for the service key. */
  const sessionOf = (headers: unknown): string | null => {
    const auth = String((headers as Record<string, string> | undefined)?.Authorization ?? "").replace(/^Bearer /, "");
    return masleka.sessions?.[auth] ?? null;
  };
  /** The operator, or an agency's Admin or Owner: sees every lead (the fakes' one agency). */
  const seesAll = (user: string | null) =>
    !!user && ((masleka.operators ?? []).includes(user) || ["admin", "owner"].includes(String(masleka.roles?.[user])));
  const canSeeLead = (user: string | null, leadId: unknown) =>
    seesAll(user) || (!!user && masleka.roles?.[user] === "user" && masleka.assigned?.[String(leadId)] === user);

  const fetchImpl = async (url: string, init: RequestInit = {}) => {
    const u = String(url);
    const method = String(init.method ?? "GET");
    // JSON, except Google's token exchange, which is a form (grant_type=…&assertion=…).
    const form = /x-www-form-urlencoded/.test(JSON.stringify(init.headers ?? {}));
    const parsed =
      typeof init.body !== "string"
        ? init.body
        : form
          ? Object.fromEntries(new URLSearchParams(init.body))
          : JSON.parse(init.body);
    const call = { url: u, method, headers: (init.headers ?? {}) as Record<string, string>, body: parsed };
    fetches.push(call);
    const custom = options.upstream?.(call);
    if (custom) return custom;

    // The mailer, not the provider — the same boundary base44-function.ts records.
    if (u === MAILER_URL) {
      const refused = options.failEmailTo?.includes(parsed.to);
      const status = options.resendStatus ?? (refused ? 422 : 200);
      const ok = status >= 200 && status < 300;
      if (ok) {
        emails.push({ to: parsed.to, subject: parsed.subject, html: parsed.html, text: parsed.text, body: parsed.text, ics: parsed.ics });
        if (masleka.afterMail) for (const r of maslekaRequests) Object.assign(r, masleka.afterMail);
      }
      const answer = options.resendResponse ?? (ok ? { ok: true, ids: ["mailer-test-id"] } : { ok: false, failed: ["http_422"] });
      return new Response(JSON.stringify(answer), { status });
    }
    if (u === `${SUPABASE_URL}/rest/v1/leads` && method === "POST") {
      if (options.failLeadWrite) {
        const f =
          options.failLeadWrite === true ? { status: 500, body: '{"message":"simulated outage"}' } : options.failLeadWrite;
        return new Response(f.body, { status: f.status });
      }
      const row = { id: `00000000-0000-4000-8000-${String(leads.length + 1).padStart(12, "0")}`, ...parsed };
      leads.push(row);
      stored.push(row);
      if (options.leadWithoutId) {
        const { id: _id, ...bare } = row;
        return new Response(JSON.stringify([bare]), { status: 201 });
      }
      return new Response(JSON.stringify([row]), { status: 201 });
    }
    if (u === `${SUPABASE_URL}/rest/v1/rpc/allow_submission` && method === "POST") {
      if (options.failLimiter) return new Response('{"message":"simulated"}', { status: options.failLimiter });
      const over = (options.overLimit ?? []).some((prefix) => String(parsed.p_key).startsWith(prefix));
      return new Response(JSON.stringify(!over), { status: 200 });
    }
    const signPrefix = `${SUPABASE_URL}/storage/v1/object/sign/`;
    if (u.startsWith(signPrefix) && method === "POST") {
      if (options.failSign) return new Response('{"message":"simulated"}', { status: options.failSign });
      return new Response(JSON.stringify({ signedURL: `/object/sign/${u.slice(signPrefix.length)}?token=test` }), {
        status: 200,
      });
    }
    if (u === "https://oauth2.googleapis.com/token" && method === "POST") {
      if (options.failGoogle === "token") return new Response('{"error":"simulated"}', { status: 500 });
      return new Response(JSON.stringify({ access_token: "google-test-token", expires_in: 3600 }), { status: 200 });
    }
    if (u.startsWith("https://www.googleapis.com/calendar/v3/calendars/") && method === "POST") {
      if (options.failGoogle === "calendar") return new Response("{}", { status: 500 });
      if (options.calendarStatus && options.calendarStatus >= 400) return new Response("{}", { status: options.calendarStatus });
      const n = calendarEvents.push(parsed);
      return new Response(
        JSON.stringify({
          id: `ev${n}`,
          iCalUID: `ev${n}@google.com`,
          htmlLink: `https://calendar.google.com/event?eid=ev${n}`,
          start: { dateTime: `${parsed.start.dateTime}+03:00` },
          end: { dateTime: `${parsed.end.dateTime}+03:00` },
        }),
        { status: 200 },
      );
    }
    if (u.startsWith("https://sheets.googleapis.com/v4/spreadsheets/") && method === "POST") {
      if (options.failGoogle === "sheets") return new Response("{}", { status: 500 });
      const tab = decodeURIComponent(u.split("/values/")[1]).split("!")[0];
      sheetRows.push({ tab, row: parsed.values[0] });
      return new Response("{}", { status: 200 });
    }
    if (u.startsWith(`${SUPABASE_URL}/rest/v1/leads?id=eq.`) && method === "PATCH") {
      const q = new URLSearchParams(u.split("?")[1]);
      const id = decodeURIComponent(q.get("id")!.replace(/^eq\./, ""));
      // The leads trigger: an assignee outside the agency is refused.
      const assignee = parsed?.assigned_user_id;
      if (masleka.members && typeof assignee === "string" && !masleka.members.includes(assignee)) {
        return new Response(JSON.stringify({ code: "23503", message: "assignee_not_member", details: null, hint: null }), { status: 409 });
      }
      leadUpdates.push({ id, fields: parsed });
      const row = stored.find((l) => l.id === id);
      if (row) Object.assign(row, parsed);
      if (q.get("select")) return new Response(JSON.stringify(row ? [postgrestProject(row, q.get("select"))] : []), { status: 200 });
      return new Response(null, { status: 204 });
    }
    if (u.startsWith(`${SUPABASE_URL}/rest/v1/leads?`) && method === "GET") {
      if (options.failLeadLookup) return new Response('{"message":"simulated"}', { status: 500 });
      const q = new URLSearchParams(u.split("?")[1]);
      const eq = (k: string) => q.get(k)?.replace(/^eq\./, "");
      const since = q.get("created_at")?.replace(/^gte\./, ""); // rows older than this bound are not returned; undated rows are kept
      // `id=in.(a,b)`: the clearinghouse's same-contact check reads leads by id.
      const ids = q.get("id")?.match(/^in\.\((.*)\)$/)?.[1].split(",") ?? (eq("id") ? [eq("id")!] : undefined);
      const rows = stored.filter((l) => {
        const at = (l.created_at ?? l.created_date) as string | undefined;
        return (
          (!ids || ids.includes(String(l.id))) &&
          (!eq("phone") || l.phone === eq("phone")) &&
          (!eq("conversation_ref") || l.conversation_ref === eq("conversation_ref")) &&
          (!eq("source") || l.source === eq("source")) &&
          (!eq("status") || l.status === eq("status")) &&
          (!since || !at || new Date(at).getTime() >= new Date(since).getTime())
        );
      });
      // `order=created_at.desc`, newest first, as PostgREST would answer it.
      if (q.get("order") === "created_at.desc") {
        const time = (l: Record<string, unknown>) => new Date(String(l.created_at ?? l.created_date ?? 0)).getTime();
        rows.sort((a, b) => time(b) - time(a));
      }
      return new Response(JSON.stringify(rows), { status: 200 });
    }
    // The booking by id (migration 20261103000000): an insert that hands its
    // id back, an update by that id, and the first booking of a lead.
    if (u === `${SUPABASE_URL}/rest/v1/meetings` && method === "POST") {
      if (options.failMeetings) return new Response("{}", { status: 404 });
      const row = { id: `00000000-0000-4000-9000-${String(meetings.length + 1).padStart(12, "0")}`, ...parsed };
      meetings.push(row);
      return new Response(JSON.stringify([row]), { status: 201 });
    }
    if (u.startsWith(`${SUPABASE_URL}/rest/v1/meetings?`) && method === "PATCH") {
      if (options.failMeetings) return new Response("{}", { status: 404 });
      const id = decodeURIComponent(new URLSearchParams(u.split("?")[1]).get("id")!.replace(/^eq\./, ""));
      const row = meetings.find((m) => m.id === id);
      if (row) Object.assign(row, parsed);
      return new Response(null, { status: 204 });
    }
    if (u.startsWith(`${SUPABASE_URL}/rest/v1/meetings?`) && method === "GET") {
      const q = new URLSearchParams(u.split("?")[1]);
      const lead = q.get("lead_id")?.replace(/^eq\./, "");
      const kind = q.get("kind")?.replace(/^eq\./, "");
      const rows = meetings.filter((m) => (!lead || m.lead_id === lead) && (!kind || (m.kind ?? "first") === kind));
      return new Response(JSON.stringify(rows.slice(0, 1).map((m) => ({ id: m.id }))), { status: 200 });
    }
    if (u === `${SUPABASE_URL}/rest/v1/rpc/my_email` && method === "POST") {
      const token = String((init.headers as Record<string, string> | undefined)?.Authorization ?? "").replace(/^Bearer /, "");
      const email = options.clientSessions?.[token];
      return email
        ? new Response(JSON.stringify(email), { status: 200 })
        : new Response('{"code":"42501","message":"permission denied for function my_email"}', { status: 401 });
    }
    if (u === `${SUPABASE_URL}/rest/v1/rpc/lead_for_email` && method === "POST") {
      // The exact, normalised match, in one agency, newest whole lead first.
      const norm = (v: unknown) => String(v ?? "").trim().toLowerCase();
      const match = [...stored]
        .filter((l) => norm(l.email) === norm(parsed.p_email) && (l.agency_id ?? AGENCY_1_ID) === parsed.p_agency_id && !l.anonymized_at)
        .sort((a, b) => new Date(String(b.created_at ?? 0)).getTime() - new Date(String(a.created_at ?? 0)).getTime())[0];
      return new Response(JSON.stringify(match?.id ?? null), { status: 200 });
    }
    if (u === `${SUPABASE_URL}/auth/v1/user` && method === "GET") {
      const header = String((init.headers as Record<string, string> | undefined)?.Authorization ?? "");
      const userId = masleka.sessions?.[header.replace(/^Bearer /, "")];
      return userId
        ? new Response(JSON.stringify({ id: userId, aud: "authenticated" }), { status: 200 })
        // As Supabase Auth refuses a bad token: with an error_code. authUser
        // (_shared/rest.ts) reads a 401/403 without one as a broken service key.
        : new Response('{"code":403,"error_code":"bad_jwt","msg":"invalid JWT"}', { status: 403 });
    }
    if (u === `${SUPABASE_URL}/rest/v1/rpc/staff_role` && method === "POST") {
      return new Response(JSON.stringify(masleka.roles?.[parsed.p_user_id] ?? null), { status: 200 });
    }
    if (u === `${SUPABASE_URL}/rest/v1/rpc/can_see_lead` && method === "POST") {
      return new Response(JSON.stringify(canSeeLead(sessionOf(init.headers), parsed.p_lead_id)), { status: 200 });
    }
    if (u === `${SUPABASE_URL}/rest/v1/rpc/lead_in_agency` && method === "POST") {
      const agency = masleka.leadAgency?.[parsed.p_lead_id] ?? "00000000-0000-0000-0000-000000000001";
      return new Response(JSON.stringify(agency === parsed.p_agency_id), { status: 200 });
    }
    if (u === `${SUPABASE_URL}/rest/v1/rpc/can_work_request` && method === "POST") {
      const user = sessionOf(init.headers);
      const r = maslekaRequests.find((x) => x.id === parsed.p_request_id);
      const ok = !!r && (seesAll(user) || (r.lead_id ? canSeeLead(user, r.lead_id) : !!user && masleka.roles?.[user] === "user" && r.created_by === user));
      return new Response(JSON.stringify(ok), { status: 200 });
    }
    if ((u === `${SUPABASE_URL}/rest/v1/rpc/set_member_role` || u === `${SUPABASE_URL}/rest/v1/rpc/remove_member`) && method === "POST") {
      memberCalls.push({ fn: u.split("/rpc/")[1], args: parsed, as: sessionOf(init.headers) });
      if (masleka.refuse) return new Response(JSON.stringify({ code: "P0001", message: masleka.refuse, details: null, hint: null }), { status: 400 });
      // Both return void, and PostgREST answers a void function with 204 and no
      // body. A "null" 200 here hid a production failure (the change was made,
      // then reading the empty answer as JSON threw).
      return new Response(null, { status: 204 });
    }
    if (u.startsWith(`${SUPABASE_URL}/rest/v1/profiles?`) && method === "GET") {
      const q = new URLSearchParams(u.split("?")[1]);
      const id = q.get("id")?.replace(/^eq\./, "") ?? "";
      const row = { id, role: (masleka.operators ?? []).includes(id) ? "admin" : "user", email: masleka.emails?.[id] ?? null };
      return new Response(JSON.stringify([postgrestProject(row, q.get("select"))]), { status: 200 });
    }
    if (u === `${SUPABASE_URL}/rest/v1/rpc/masleka_staff_emails` && method === "POST") {
      if (masleka.failStaffEmails) return new Response('{"message":"simulated"}', { status: 500 });
      return new Response(JSON.stringify(masleka.staffEmails ?? []), { status: 200 });
    }
    const requestsUrl = `${SUPABASE_URL}/rest/v1/masleka_requests`;
    if (u === requestsUrl && method === "POST") {
      if (masleka.failRequestWrite) return new Response('{"message":"simulated"}', { status: 500 });
      const row: Record<string, unknown> = {
        id: `22222222-2222-4222-8222-${String(maslekaRequests.length + 1).padStart(12, "0")}`,
        status: "invited",
        created_at: new Date().toISOString(),
        code_ciphertext: null,
        id_ciphertext: null,
        client_invited_at: null,
        client_reminded_at: null,
        ...parsed,
      };
      maslekaRequests.push(row);
      return new Response(JSON.stringify([row]), { status: 201 });
    }
    if (u.startsWith(`${requestsUrl}?`)) {
      const query = u.split("?")[1];
      const q = new URLSearchParams(query);
      if (method === "GET") {
        const rows = maslekaRequests.filter((r) => postgrestMatch(r, q)).map((r) => postgrestProject(r, q.get("select")));
        return new Response(JSON.stringify(rows), { status: 200 });
      }
      if (method === "PATCH") {
        if (masleka.failRequestWrite) return new Response('{"message":"simulated"}', { status: 500 });
        if (masleka.failPatchMatching && query.includes(masleka.failPatchMatching)) return new Response('{"message":"simulated"}', { status: 500 });
        if (masleka.raceBeforePatch && !raced) {
          raced = true;
          for (const r of maslekaRequests) Object.assign(r, masleka.raceBeforePatch);
        }
        requestPatches.push({ query, fields: parsed });
        const hit = maslekaRequests.filter((r) => postgrestMatch(r, q));
        for (const r of hit) Object.assign(r, parsed);
        const representation = /return=representation/.test(JSON.stringify(init.headers ?? {}));
        return representation
          ? new Response(JSON.stringify(hit.map((r) => postgrestProject(r, q.get("select")))), { status: 200 })
          : new Response(null, { status: 204 });
      }
    }
    if (u === `${SUPABASE_URL}/rest/v1/masleka_access_log` && method === "POST") {
      if (masleka.failAccessLog) return new Response('{"message":"simulated"}', { status: 500 });
      const row = { id: accessLog.length + 1, at: new Date().toISOString(), ...parsed };
      accessLog.push(row);
      return new Response(JSON.stringify([row]), { status: 201 });
    }
    throw new Error(`unexpected fetch in an Edge Function test: ${method} ${u}`);
  };

  const env: Record<string, string> = options.env ?? {
    MAILER_URL,
    MAILER_TOKEN: "test-only-token",
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY,
    ...(options.noGoogle ? {} : { GOOGLE_SERVICE_ACCOUNT_JSON: TEST_SA }),
    GOOGLE_CALENDAR_ID: "govaridorit@gmail.com",
    SHEET_ID: "sheet-test",
  };
  if (!options.env) {
    for (const [key, value] of Object.entries(options.envPatch ?? {})) {
      if (value === null) delete env[key];
      else env[key] = value;
    }
  }
  const module = { exports: {} as Record<string, unknown> };
  const handler = compiled.get(name)!(module, module.exports, fetchImpl, { env: { get: (k: string) => env[k] } });

  const method = options.method ?? "POST";
  const response = await handler(
    new Request(`https://edge.test/functions/v1/${name}`, {
      method,
      headers: { "content-type": "application/json", origin: "https://govari-fin.co.il", ...(options.headers ?? {}) },
      body: method === "OPTIONS" ? undefined : (options.rawBody ?? JSON.stringify(body ?? {})),
    }),
  );
  const text = await response.text();

  return {
    status: response.status,
    json: text ? (JSON.parse(text) as Record<string, unknown>) : {},
    headers: response.headers,
    leads,
    emails,
    fetches,
    leadUpdates,
    meetings,
    calendarEvents,
    sheetRows,
    maslekaRequests,
    accessLog,
    requestPatches,
    memberCalls,
    callsTo: (fragment) => fetches.filter((f) => f.url.includes(fragment)),
    mailTo(address) {
      const found = emails.filter((e) => e.to === address);
      if (found.length !== 1) {
        throw new Error(
          `expected exactly one email to ${address}, saw ${found.length} ` +
            `(recipients: ${emails.map((e) => e.to).join(", ") || "none"})`,
        );
      }
      return found[0];
    },
  };
}
