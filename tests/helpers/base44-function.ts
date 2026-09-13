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
  /** Recipients whose delivery should throw. */
  failEmailTo?: string[];
  /** Make every outbound HTTP call fail. */
  failFetch?: boolean;
  /** Status returned by the stubbed fetch when it does not fail. */
  fetchStatus?: number;
}

export interface Invocation {
  status: number;
  json: Record<string, unknown>;
  leads: Record<string, unknown>[];
  emails: EmailCall[];
  fetches: FetchCall[];
  /** The single email sent to this address, asserted to exist exactly once. */
  mailTo(address: string): EmailCall;
  /** Outbound calls whose URL contains the fragment. */
  callsTo(fragment: string): FetchCall[];
}

type Handler = (req: Request) => Promise<Response>;

const SDK_IMPORT = /^\s*import\s*\{[^}]*\}\s*from\s*['"]npm:@base44\/sdk[^'"]*['"];?\s*$/m;

function compile(name: string): (sdk: unknown, fetchImpl: unknown) => Handler {
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
    `${code}\n;return __entry;`,
  ) as (sdk: unknown, fetchImpl: unknown) => Handler;
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
  const emails: EmailCall[] = [];
  const fetches: FetchCall[] = [];

  const createLead = async (fields: Record<string, unknown>) => {
    if (options.failLeadWrite) throw new Error("simulated database outage");
    leads.push(fields);
    return { id: `LEAD-${leads.length}` };
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
    { get: () => ({ create: createLead }) },
  ) as Record<string, { create: typeof createLead }>;

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
    if (options.failFetch) throw new Error("simulated network failure");
    const status = options.fetchStatus ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => ({ id: "remote-1" }),
      text: async () => "",
    };
  };

  const handler = factory(() => client, fetchImpl);
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
