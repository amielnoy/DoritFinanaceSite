import type { SupabaseQuery, SupabaseReadResult, SupabaseTableClient } from "./SupabaseTableClient.js";

/**
 * Public table reads over plain `fetch`, without `@supabase/supabase-js`.
 *
 * The home page lists testimonials and articles, and those reads are the only
 * reason an anonymous visitor's first load needed the SDK (~55 KB gzipped,
 * modulepreloaded ahead of everything else). PostgREST answers the same query
 * over a GET, so this speaks it directly.
 *
 * It sends exactly what supabase-js sends for a visitor with no session — the
 * publishable key as `apikey` and as the bearer — so row-level security sees
 * the same `anon` role and returns the same rows. It is for public reads only:
 * anything that needs the signed-in user's token (the admin list, the personal
 * area) stays on the SDK in `composition.ts`.
 */
export class RestTableClient implements SupabaseTableClient {
  constructor(
    private readonly url: string,
    private readonly key: string,
    private readonly fetchImpl: typeof fetch = (...args) => fetch(...args),
  ) {}

  from(table: string): { select(columns: string): SupabaseQuery } {
    return {
      select: (columns: string) =>
        new RestQuery(this.url, this.key, this.fetchImpl, table, [["select", columns]]),
    };
  }
}

class RestQuery implements SupabaseQuery {
  constructor(
    private readonly url: string,
    private readonly key: string,
    private readonly fetchImpl: typeof fetch,
    private readonly table: string,
    private readonly params: ReadonlyArray<readonly [string, string]>,
  ) {}

  private with(name: string, value: string): RestQuery {
    return new RestQuery(this.url, this.key, this.fetchImpl, this.table, [...this.params, [name, value]]);
  }

  eq(column: string, value: unknown): SupabaseQuery {
    return this.with(column, `eq.${String(value)}`);
  }

  or(filters: string): SupabaseQuery {
    return this.with("or", `(${filters})`);
  }

  not(column: string, operator: string, value: unknown): SupabaseQuery {
    return this.with(column, `not.${operator}.${value === null ? "null" : String(value)}`);
  }

  order(column: string, options: { ascending: boolean }): SupabaseQuery {
    return this.with("order", `${column}.${options.ascending ? "asc" : "desc"}`);
  }

  limit(count: number): SupabaseQuery {
    return this.with("limit", String(count));
  }

  /** The request URL — exposed for tests. */
  toUrl(): string {
    const query = new URLSearchParams(this.params as [string, string][]).toString();
    return `${this.url.replace(/\/+$/, "")}/rest/v1/${encodeURIComponent(this.table)}?${query}`;
  }

  private async run(): Promise<SupabaseReadResult> {
    try {
      const res = await this.fetchImpl(this.toUrl(), {
        headers: { apikey: this.key, Authorization: `Bearer ${this.key}`, Accept: "application/json" },
      });
      const body: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        const err = (body ?? {}) as { message?: string; code?: string };
        return { data: null, error: { message: err.message ?? `HTTP ${res.status}`, code: err.code } };
      }
      // PostgREST answers a collection read with an array. Anything else is an
      // answer this client cannot read, and must not pass for "no rows".
      if (!Array.isArray(body)) return { data: null, error: { message: `unexpected response from ${this.table}` } };
      return { data: body, error: null };
    } catch (e) {
      return { data: null, error: { message: e instanceof Error ? e.message : String(e) } };
    }
  }

  then<R1 = SupabaseReadResult, R2 = never>(
    onfulfilled?: ((value: SupabaseReadResult) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): PromiseLike<R1 | R2> {
    return this.run().then(onfulfilled, onrejected);
  }
}
