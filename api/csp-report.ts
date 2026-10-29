// Where the browser reports what the Content-Security-Policy would block.
//
// The policy ships as Report-Only on purpose: a wrong directive fails
// silently, as a blocked request rather than a visible error, so real traffic
// is observed before anything is enforced (ef3cac6). Without an endpoint
// nothing was observed — this is it. Each violation becomes one line in the
// Vercel runtime logs, prefixed `[csp]`, and the decision to enforce is made
// from those lines.
//
// What is kept: the directive, the blocked origin (or keyword: inline, eval),
// the page's path and the source position. What is not: query strings, which
// on this site can carry a visitor's name and phone, and the rest of the URL.
//
// A fixed path, like api/og/blog.ts: files are matched before any rewrite.

interface CspRequest {
  method?: string;
  body?: unknown;
}

interface CspResponse {
  status(code: number): CspResponse;
  end(): void;
}

/** More than any real report; a body past this is not a browser's. */
const MAX_BODY = 20_000;
const MAX_LINES = 20;

interface Violation {
  directive: string;
  blocked: string;
  page: string;
  source?: string;
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** An origin for a URL, the keyword itself for `inline`/`eval`/`data`, else ''. */
function blockedOf(raw: string): string {
  try {
    return new URL(raw).origin;
  } catch {
    return /^[a-z-]{1,20}$/.test(raw) ? raw : "";
  }
}

function pathOf(raw: string): string {
  try {
    return new URL(raw).pathname;
  } catch {
    return "";
  }
}

function sourceOf(file: string, line: unknown): string | undefined {
  if (!file) return undefined;
  let base: string;
  try {
    const u = new URL(file);
    base = `${u.origin}${u.pathname}`;
  } catch {
    return undefined;
  }
  return typeof line === "number" ? `${base}:${line}` : base;
}

function parse(body: unknown): unknown {
  if (typeof body !== "string") return body;
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

function violations(payload: unknown): Violation[] {
  const out: Violation[] = [];
  // report-uri: one object under "csp-report".
  const legacy = (payload as { "csp-report"?: Record<string, unknown> } | null)?.["csp-report"];
  if (legacy && typeof legacy === "object") {
    out.push({
      directive: str(legacy["effective-directive"]) || str(legacy["violated-directive"]),
      blocked: blockedOf(str(legacy["blocked-uri"])),
      page: pathOf(str(legacy["document-uri"])),
      source: sourceOf(str(legacy["source-file"]), legacy["line-number"]),
    });
  }
  // report-to (Reporting API): an array of typed reports.
  if (Array.isArray(payload)) {
    for (const r of payload) {
      if ((r as { type?: unknown })?.type !== "csp-violation") continue;
      const b = ((r as { body?: Record<string, unknown> }).body ?? {}) as Record<string, unknown>;
      out.push({
        directive: str(b.effectiveDirective),
        blocked: blockedOf(str(b.blockedURL)),
        page: pathOf(str(b.documentURL)),
        source: sourceOf(str(b.sourceFile), b.lineNumber),
      });
    }
  }
  return out.filter((v) => v.directive);
}

export default async function handler(req: CspRequest, res: CspResponse): Promise<void> {
  if (req.method !== "POST") {
    res.status(405).end();
    return;
  }
  const size = typeof req.body === "string" ? req.body.length : JSON.stringify(req.body ?? null).length;
  if (size > MAX_BODY) {
    res.status(413).end();
    return;
  }
  for (const v of violations(parse(req.body)).slice(0, MAX_LINES)) {
    const entry = v.source ? v : { directive: v.directive, blocked: v.blocked, page: v.page };
    console.warn(`[csp] ${JSON.stringify(entry)}`);
  }
  res.status(204).end();
}
