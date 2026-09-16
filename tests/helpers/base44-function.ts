import { readFileSync } from "node:fs";
import { join } from "node:path";
import { transformSync } from "esbuild";
import { REPO_ROOT } from "./entity-schema";

/**
 * Runs a Base44 backend function for real, in-process.
 *
 * These files hold the compliance layer — redaction, the recipient split, the
 * escaping in the confirmation email, the escalation-reason clamp — and until
 * this harness existed **nothing executed them**. They are outside
 * `tsconfig.json` (which covers only `src/**`), they run on Deno inside Base44
 * rather than on the CI runner, and the suites that referred to them did so by
 * matching strings against their source. That catches a deleted call. It does
 * not catch a regex that stopped matching, an argument passed in the wrong
 * order, or a branch that never runs.
 *
 * Loading them is a small amount of surgery because they are Deno modules:
 * the SDK arrives via an `npm:` specifier Node cannot resolve, and the entry
 * point is a default-exported function. So the import is removed, the export
 * is turned into a local binding, and the result is evaluated with the SDK and
 * `fetch` injected as parameters. Nothing else about the source is touched —
 * what runs here is the code that ships.
 */

export interface EmailCall {
  to: string;
  subject: string;
  body?: string;
  html?: string;
  text?: string;
}

export interface FetchCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

export interface HarnessOptions {
  /** Connector name → token, or `null` to simulate an unauthorised connector. */
  connections?: Record<string, string | null>;
  /** Make the entity write fail, as a database outage would. */
  failLeadWrite?: boolean;
  /** Rows the function can find before it writes — see `stored` in the harness. */
  existingLeads?: Record<string, unknown>[];
  /** Make the entity lookup fail, leaving the function to create rather than update. */
  failLeadLookup?: boolean;
  /** Recipients whose delivery should throw. */
  failEmailTo?: string[];
  /** Make every outbound HTTP call fail. */
  failFetch?: boolean;
  /**
   * Fail every outbound call *except* the mailer.
   *
   * Mail and the calendar both travel by `fetch` now that Resend replaced
   * Base44's Core integration, so `failFetch` can no longer express "the
   * calendar refused but the notifications went out" — it breaks both.
   */
  failCalendar?: boolean;
  /** Status returned by the stubbed fetch when it does not fail. */
  fetchStatus?: number;
  env?: Record<string, string>;
  resendStatus?: number;
  resendResponse?: unknown;
}

export interface Invocation {
  status: number;
  json: Record<string, unknown>;
  leads: Record<string, unknown>[];
  /** Updates applied to rows that already existed, in order. */
  leadUpdates: { id: string; fields: Record<string, unknown> }[];
  emails: EmailCall[];
  fetches: FetchCall[];
  /** The single email sent to this address, asserted to exist exactly once. */
  mailTo(address: string): EmailCall;
  /** Outbound calls whose URL contains the fragment. */
  callsTo(fragment: string): FetchCall[];
}

type Handler = (req: Request) => Promise<Response>;

const SDK_IMPORT = /^\s*import\s*\{[^}]*\}\s*from\s*['"]npm:@base44\/sdk[^'"]*['"];?\s*$/m;

function compile(name: string): (sdk: unknown, fetchImpl: unknown, deno: unknown) => Handler {
  const entry = join(REPO_ROOT, "base44/functions", name, "entry.ts");
  const source = readFileSync(entry, "utf8");

  if (!SDK_IMPORT.test(source)) {
    throw new Error(`${name}/entry.ts no longer imports the SDK the way this harness expects`);
  }
  const withoutImport = source.replace(SDK_IMPORT, "");

  const asLocal = withoutImport.replace(
    /export\s+default\s+async\s+function\s*\(/,
    "const __entry = async function (",
  );
  if (asLocal === withoutImport) {
    throw new Error(`${name}/entry.ts no longer default-exports an async function`);
  }

  const { code } = transformSync(asLocal, { loader: "ts", format: "esm" });
  // eslint-disable-next-line no-new-func -- the point of this harness
  return new Function(
    "createClientFromRequest",
    "fetch",
    "Deno",
    `${code}\n;return __entry;`,
  ) as (sdk: unknown, fetchImpl: unknown, deno: unknown) => Handler;
}

const compiled = new Map<string, ReturnType<typeof compile>>();

/** Invoke a backend function with a recording client, and report what it did. */
export async function invokeFunction(
  name: string,
  body: unknown,
  options: HarnessOptions = {},
): Promise<Invocation> {
  if (!compiled.has(name)) compiled.set(name, compile(name));
  const factory = compiled.get(name)!;

  const leads: Record<string, unknown>[] = [];
  const leadUpdates: { id: string; fields: Record<string, unknown> }[] = [];
  const emails: EmailCall[] = [];
  const fetches: FetchCall[] = [];

  const createLead = async (fields: Record<string, unknown>) => {
    if (options.failLeadWrite) throw new Error("simulated database outage");
    leads.push({ id: `LEAD-${leads.length + 1}`, ...fields });
    return { id: `LEAD-${leads.length}` };
  };

  /**
   * Rows the function can find before it writes.
   *
   * `submitLead` looks for an interview already open on this phone number so a
   * second call updates it rather than creating a duplicate. Without a readable
   * store the lookup always misses, every test takes the create path, and the
   * upsert is exercised by nothing — so seeded rows go in here and are matched
   * on the same fields the function filters by.
   */
  const stored: Record<string, unknown>[] = [...(options.existingLeads ?? [])];

  const filterLeads = async (where: Record<string, unknown>) => {
    if (options.failLeadLookup) throw new Error("simulated lookup outage");
    return stored.filter((row) =>
      Object.entries(where).every(([field, value]) => row[field] === value),
    );
  };

  const updateLead = async (id: string, fields: Record<string, unknown>) => {
    if (options.failLeadWrite) throw new Error("simulated database outage");
    const row = stored.find((r) => r.id === id);
    if (row) Object.assign(row, fields);
    leadUpdates.push({ id, fields });
    return { id, ...fields };
  };

  const sendEmail = async (call: EmailCall) => {
    if (options.failEmailTo?.includes(call.to)) throw new Error(`simulated bounce: ${call.to}`);
    emails.push(call);
    return { ok: true };
  };

  const getConnection = async (connector: string) => {
    const token = options.connections?.[connector];
    if (token === null) return {};
    return { accessToken: token ?? `token-for-${connector}` };
  };

  const entities = new Proxy(
    {},
    { get: () => ({ create: createLead, filter: filterLeads, update: updateLead }) },
  ) as Record<string, unknown>;

  const client = {
    entities,
    asServiceRole: {
      entities,
      integrations: { Core: { SendEmail: sendEmail } },
      connectors: { getConnection },
    },
  };

  const fetchImpl = async (url: string, init: Record<string, unknown> = {}) => {
    fetches.push({
      url: String(url),
      method: String(init.method ?? "GET"),
      headers: (init.headers ?? {}) as Record<string, string>,
      body: typeof init.body === "string" ? JSON.parse(init.body) : init.body,
    });
    if (String(url) === "https://api.resend.com/emails") {
      if (options.failFetch) throw new Error("simulated network failure");
      const payload = JSON.parse(String(init.body));
      const status = options.resendStatus ?? (options.failEmailTo?.includes(payload.to[0]) ? 422 : 200);
      if (status >= 200 && status < 300) {
        emails.push({ to: payload.to[0], subject: payload.subject, html: payload.html, text: payload.text, body: payload.text });
      }
      return { ok: status >= 200 && status < 300, status,
        json: async () => options.resendResponse ?? { id: "resend-test-id" } };
    }
    if (options.failFetch || options.failCalendar) throw new Error("simulated network failure");
    const status = options.fetchStatus ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => ({ id: "remote-1" }),
      text: async () => "",
    };
  };

  const env = options.env ?? { RESEND_API_KEY: "test-only-key", RESEND_FROM_EMAIL: "Notifications <notifications@mail.example.com>" };
  const handler = factory(() => client, fetchImpl, { env: { get: (key: string) => env[key] } });
  const response = await handler(
    new Request("https://example.test/fn", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body ?? {}),
    }),
  );

  const json = (await response.json()) as Record<string, unknown>;

  return {
    status: response.status,
    json,
    leads,
    leadUpdates,
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
    callsTo(fragment) {
      return fetches.filter((f) => f.url.includes(fragment));
    },
  };
}
