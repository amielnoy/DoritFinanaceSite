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

export const SUPABASE_URL = "https://project-ref.supabase.test";
const SERVICE_KEY = "service-role-test";

export interface EdgeOptions {
  /** PostgREST refuses the insert: `true` for a 500, or a status and body of your own. */
  failLeadWrite?: boolean | { status: number; body: string };
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

/** Invoke an Edge Function with recording upstreams, and report what it did. */
export async function invokeEdge(name: string, body: unknown, options: EdgeOptions = {}): Promise<EdgeInvocation> {
  if (!compiled.has(name)) compiled.set(name, compile(name));
  const leads: Record<string, unknown>[] = [];
  const emails: EmailCall[] = [];
  const fetches: FetchCall[] = [];

  const fetchImpl = async (url: string, init: RequestInit = {}) => {
    const u = String(url);
    const method = String(init.method ?? "GET");
    const parsed = typeof init.body === "string" ? JSON.parse(init.body) : init.body;
    fetches.push({ url: u, method, headers: (init.headers ?? {}) as Record<string, string>, body: parsed });

    // The mailer, not the provider — the same boundary base44-function.ts records.
    if (u === MAILER_URL) {
      const ok = !options.failEmailTo?.includes(parsed.to);
      if (ok) emails.push({ to: parsed.to, subject: parsed.subject, html: parsed.html, text: parsed.text, body: parsed.text });
      return new Response(JSON.stringify(ok ? { ok: true, ids: ["mailer-test-id"] } : { ok: false, failed: ["http_422"] }), {
        status: ok ? 200 : 422,
      });
    }
    if (u === `${SUPABASE_URL}/rest/v1/leads` && method === "POST") {
      if (options.failLeadWrite) {
        const f =
          options.failLeadWrite === true ? { status: 500, body: '{"message":"simulated outage"}' } : options.failLeadWrite;
        return new Response(f.body, { status: f.status });
      }
      const row = { id: `00000000-0000-4000-8000-${String(leads.length + 1).padStart(12, "0")}`, ...parsed };
      leads.push(row);
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
    throw new Error(`unexpected fetch in an Edge Function test: ${method} ${u}`);
  };

  const env = options.env ?? {
    MAILER_URL,
    MAILER_TOKEN: "test-only-token",
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY,
  };
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
