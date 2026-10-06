/** The SDK surface the function adapters need — not the whole client. */
export interface FunctionInvoker {
  functions: { invoke(name: string, payload: unknown): Promise<unknown> };
}

/**
 * The response body, out of whatever `invoke` resolved to.
 *
 * `@base44/sdk` builds its functions client with `interceptResponses: false`,
 * so `invoke` resolves to the whole axios response and the body is its `data`.
 * Reading `.ok` off the wrapper finds nothing, so every interview the page
 * closed told the visitor it had not saved, while it had (see
 * tests/unit/function-receipts.test.ts).
 *
 * A bare body passes through unchanged, which is what the in-memory fakes
 * return — and what the SDK would return if it ever turned the interceptor on.
 */
export function responseBody(res: unknown): unknown {
  if (res && typeof res === "object" && "data" in res && "status" in res && "headers" in res) {
    return (res as { data: unknown }).data;
  }
  return res;
}

/** Call a backend function and return its body as the given receipt type. */
export async function invokeFunction<T>(
  client: FunctionInvoker,
  name: string,
  payload: unknown
): Promise<T | undefined> {
  return responseBody(await client.functions.invoke(name, payload)) as T | undefined;
}
