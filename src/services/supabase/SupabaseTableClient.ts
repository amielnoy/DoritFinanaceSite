/** What a PostgREST read resolves to. supabase-js never rejects for a failed query. */
export interface SupabaseReadResult {
  data: unknown[] | null;
  error: { message: string; code?: string } | null;
}

/** The chainable part of a select — only the calls the read adapters make. */
export interface SupabaseQuery extends PromiseLike<SupabaseReadResult> {
  eq(column: string, value: unknown): SupabaseQuery;
  /** PostgREST `or=(…)`. `filters` without the brackets, as supabase-js takes it. */
  or(filters: string): SupabaseQuery;
  /** PostgREST `col=not.<op>.<value>`, as supabase-js's `.not("lead_id", "is", null)`. */
  not(column: string, operator: string, value: unknown): SupabaseQuery;
  /** PostgREST `col=is.null` — supabase-js's `.is("assigned_user_id", null)`. */
  is(column: string, value: null): SupabaseQuery;
  order(column: string, options: { ascending: boolean }): SupabaseQuery;
  limit(count: number): SupabaseQuery;
  /** PostgREST `Range` paging, inclusive; supabase-js has it, the narrower fakes may not. */
  range?(from: number, to: number): SupabaseQuery;
}

/** Just the table reads these adapters make — see SupabaseAuthClient for why it is narrowed. */
export interface SupabaseTableClient {
  from(table: string): { select(columns: string): SupabaseQuery };
}

/** An update or delete narrowed to one row, asking for what it changed. */
export interface SupabaseWriteQuery {
  eq(column: string, value: unknown): { select(columns: string): PromiseLike<SupabaseReadResult> };
}

/** The table client with the writes the lead admin makes: update and delete, and a meeting's insert. */
export interface SupabaseLeadTableClient extends SupabaseTableClient {
  from(table: string): {
    select(columns: string): SupabaseQuery;
    update(values: Record<string, unknown>): SupabaseWriteQuery;
    delete(): SupabaseWriteQuery;
    insert(values: Record<string, unknown>): { select(columns: string): PromiseLike<SupabaseReadResult> };
  };
}

/**
 * Await a read and hand back its rows, or throw.
 *
 * supabase-js resolves a failed query with `{ error }` instead of rejecting.
 * A read that skipped this check would turn an outage or an RLS refusal into an
 * empty list, and "no articles" looks like content, not like a failure.
 */
export async function fetchRows(query: SupabaseQuery, table: string): Promise<Record<string, unknown>[]> {
  const { data, error } = await query;
  if (error) throw new Error(`${table} read failed: ${error.message}`);
  return (data ?? []) as Record<string, unknown>[];
}

/**
 * A Supabase row in the shape the ports promise.
 *
 * `id` is the Base44 id, because that is what every URL, bookmark and indexed
 * link already holds (`/blog/:id`); Supabase's own uuid would 404 all of them.
 * A row that never had a Base44 id falls back to the uuid, the same key
 * scripts/reconcile-stores.mjs uses, so it still shows up instead of vanishing.
 *
 * Null columns are dropped: Postgres says null where Base44 left the field out,
 * and the ports declare these fields optional, not nullable.
 */
export function toPortRow(row: Record<string, unknown>): Record<string, unknown> {
  const { id, base44_id, created_at, ...rest } = row;
  const out: Record<string, unknown> = { id: base44_id ?? id, created_date: created_at };
  for (const [key, value] of Object.entries(rest)) if (value !== null) out[key] = value;
  return out;
}
