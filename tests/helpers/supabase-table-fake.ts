import type {
  SupabaseLeadTableClient,
  SupabaseQuery,
  SupabaseReadResult,
  SupabaseWriteQuery,
} from "@/services/supabase/SupabaseTableClient";

export type Call = [method: string, ...args: unknown[]];

/**
 * A PostgREST query builder that records every call and resolves to `result`.
 *
 * Recording the chain, not just the answer, is the point: the one mistake the
 * spec singles out — filtering `getArticle` on `id` instead of `base44_id` —
 * returns the right *shape* either way, and only the recorded `eq` tells them
 * apart.
 */
export function tableFake(
  result: SupabaseReadResult,
  writeResult: SupabaseReadResult = result,
): { client: SupabaseLeadTableClient; calls: Call[] } {
  const calls: Call[] = [];
  // A `range` answers that slice of `result.data`, as PostgREST pages it; reset by each select.
  let window: [number, number] | null = null;
  const query: SupabaseQuery = {
    eq(column, value) {
      calls.push(["eq", column, value]);
      return query;
    },
    or(filters) {
      calls.push(["or", filters]);
      return query;
    },
    not(column, operator, value) {
      calls.push(["not", column, operator, value]);
      return query;
    },
    is(column, value) {
      calls.push(["is", column, value]);
      return query;
    },
    order(column, options) {
      calls.push(["order", column, options]);
      return query;
    },
    limit(count) {
      calls.push(["limit", count]);
      return query;
    },
    range(from, to) {
      calls.push(["range", from, to]);
      window = [from, to];
      return query;
    },
    then(onFulfilled, onRejected) {
      const answer = window && result.data ? { ...result, data: result.data.slice(window[0], window[1] + 1) } : result;
      return Promise.resolve(answer).then(onFulfilled, onRejected);
    },
  };
  const write: SupabaseWriteQuery = {
    eq(column, value) {
      calls.push(["eq", column, value]);
      return {
        select(columns) {
          calls.push(["select", columns]);
          return { then: (onFulfilled, onRejected) => Promise.resolve(writeResult).then(onFulfilled, onRejected) };
        },
      };
    },
  };
  const client: SupabaseLeadTableClient = {
    from(table) {
      calls.push(["from", table]);
      return {
        select(columns) {
          calls.push(["select", columns]);
          window = null;
          return query;
        },
        update(values) {
          calls.push(["update", values]);
          return write;
        },
        delete() {
          calls.push(["delete"]);
          return write;
        },
      };
    },
  };
  return { client, calls };
}
