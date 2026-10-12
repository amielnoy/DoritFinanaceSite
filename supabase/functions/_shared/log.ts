/**
 * One structured line per event, to the function's output: what happened, never
 * who. The rule and its reasons are in tests/contract/logging.contract.test.ts,
 * which reads these files as it reads the Base44 functions.
 */
export type Level = 'info' | 'warn' | 'error';
export type Log = (level: Level, event: string, fields: Record<string, unknown>) => void;

export function createLog(fn: string): Log {
  return function log(level, event, fields) {
    const line = JSON.stringify({ t: new Date().toISOString(), level, fn, event, ...fields });
    if (level === 'error') console.error(line);
    else if (level === 'warn') console.warn(line);
    else console.log(line);
  };
}

/** A short id that ties one request's lines together. */
export const newRequestId = (): string => crypto.randomUUID().slice(0, 8);
