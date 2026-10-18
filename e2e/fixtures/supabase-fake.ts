/**
 * The PostgREST reads the site makes, answered from in-memory tables.
 *
 * Shared by the e2e fixture (e2e/fixtures/app.ts), which answers the browser,
 * and the prerender (scripts/prerender.mjs), which answers the build's own
 * browser in the e2e build. Pure: a URL and the tables in, a status and a body
 * out. Loaded by Node directly from the prerender, so it imports nothing and
 * uses only erasable TypeScript.
 *
 * The subset is what src/services/supabase/RestTableClient.ts sends —
 * `select`, `col=eq.x`, `col=is.null`, `col=not.is.null`, `or=(a.eq.x,b.eq.y)`,
 * `order=col.asc|desc`, `limit` — and nothing else. Anything outside it is an
 * error, as is a table nobody seeded, so a page that starts reading something
 * new fails loudly here instead of rendering an empty list.
 */

export type Row = Record<string, unknown>;

export interface FakeAnswer {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
}

/** PostgREST's own error shape, so the client reads it the way it reads a real one. */
const pgrstError = (status: number, code: string, message: string): FakeAnswer => ({
  status,
  body: { code, details: null, hint: null, message },
});

type Predicate = (row: Row) => boolean;

/** `eq.x`, `is.null`, `not.is.null` … for one column; null when the operator is outside the subset. */
function condition(column: string, expression: string): Predicate | null {
  const negated = expression.startsWith("not.");
  const rest = negated ? expression.slice(4) : expression;
  const dot = rest.indexOf(".");
  if (dot < 0) return null;
  const op = rest.slice(0, dot);
  const value = rest.slice(dot + 1);
  let test: Predicate;
  if (op === "eq") test = (row) => row[column] !== null && row[column] !== undefined && String(row[column]) === value;
  else if (op === "is" && value === "null") test = (row) => row[column] === null || row[column] === undefined;
  else if (op === "is" && (value === "true" || value === "false")) test = (row) => row[column] === (value === "true");
  else return null;
  return negated ? (row) => !test(row) : test;
}

/** `(a.eq.x,b.eq.y)` — any of them. Values never hold a comma: the client sends only slug-shaped keys. */
function anyOf(expression: string): Predicate | null {
  const inner = /^\((.*)\)$/.exec(expression)?.[1];
  if (inner === undefined) return null;
  const clauses: Predicate[] = [];
  for (const clause of inner.split(",")) {
    const dot = clause.indexOf(".");
    const each = dot > 0 ? condition(clause.slice(0, dot), clause.slice(dot + 1)) : null;
    if (!each) return null;
    clauses.push(each);
  }
  return (row) => clauses.some((c) => c(row));
}

function compare(a: unknown, b: unknown): number {
  if (a === b) return 0;
  if (a === null || a === undefined) return 1; // nulls last, PostgREST's default for asc
  if (b === null || b === undefined) return -1;
  return String(a) < String(b) ? -1 : 1;
}

/** Answers `GET <host>/rest/v1/<table>?…` from `tables`. */
export function answerRestRead(url: URL, tables: ReadonlyMap<string, readonly Row[]>): FakeAnswer {
  const match = /^\/rest\/v1\/([^/]+)$/.exec(url.pathname);
  if (!match) return pgrstError(404, "PGRST125", `invalid path in the e2e fake: ${url.pathname}`);
  const table = decodeURIComponent(match[1]);
  const source = tables.get(table);
  if (!source) {
    return pgrstError(404, "PGRST205", `Could not find the table 'public.${table}' in the schema cache (e2e fake: seed it)`);
  }

  const filters: Predicate[] = [];
  let order: Array<{ column: string; descending: boolean }> = [];
  let limit = Number.POSITIVE_INFINITY;
  for (const [name, value] of url.searchParams) {
    if (name === "select") continue; // whole rows: the adapters name their columns, the rows hold no more
    if (name === "limit") {
      limit = Number(value);
      if (!Number.isInteger(limit) || limit < 0) return pgrstError(400, "PGRST103", `bad limit: ${value}`);
      continue;
    }
    if (name === "order") {
      order = value.split(",").map((term) => {
        const [column, direction] = term.split(".");
        return { column, descending: direction === "desc" };
      });
      continue;
    }
    const predicate = name === "or" ? anyOf(value) : condition(name, value);
    if (!predicate) return pgrstError(400, "PGRST100", `outside the e2e fake's PostgREST subset: ${name}=${value}`);
    filters.push(predicate);
  }

  let rows = source.filter((row) => filters.every((f) => f(row)));
  if (order.length) {
    rows = [...rows].sort((a, b) => {
      for (const { column, descending } of order) {
        const c = compare(a[column], b[column]);
        if (c !== 0) return descending ? -c : c;
      }
      return 0;
    });
  }
  rows = rows.slice(0, limit);
  return {
    status: 200,
    body: rows,
    headers: { "content-range": rows.length ? `0-${rows.length - 1}/*` : "*/*" },
  };
}
