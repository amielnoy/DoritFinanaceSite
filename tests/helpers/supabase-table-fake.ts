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
  const query: SupabaseQuery = {
    eq(column, value) {
      calls.push(["eq", column, value]);
      return query;
    },
    or(filters) {
      calls.push(["or", filters]);
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
    then(onFulfilled, onRejected) {
      return Promise.resolve(result).then(onFulfilled, onRejected);
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
