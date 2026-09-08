import { readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { REPO_ROOT } from "./entity-schema";

const SOURCE_EXT = new Set([".ts", ".tsx", ".js", ".jsx"]);

/** All first-party source files, excluding the untouched shadcn/ui primitives. */
export function sourceFiles(
  dir = join(REPO_ROOT, "src"),
  opts: { includeUiPrimitives?: boolean } = {}
): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (!opts.includeUiPrimitives && relative(REPO_ROOT, full) === "src/components/ui") continue;
      out.push(...sourceFiles(full, opts));
    } else if (SOURCE_EXT.has(extname(name))) {
      out.push(full);
    }
  }
  return out.sort();
}

export const read = (file: string): string => readFileSync(file, "utf8");
export const rel = (file: string): string => relative(REPO_ROOT, file);

export interface ObjectLiteralCall {
  file: string;
  /** Raw text of the object literal argument. */
  raw: string;
  /** Top-level keys of the object literal. */
  keys: string[];
  /** Top-level keys whose value is a plain string literal. */
  stringLiterals: Record<string, string>;
}

/** Balanced-brace scan from the `{` at `start`; returns the index just past `}`. */
function matchBrace(src: string, start: number): number {
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return i + 1;
    } else if (c === '"' || c === "'" || c === "`") {
      // Skip string bodies so braces inside them do not confuse the depth count.
      const quote = c;
      i++;
      while (i < src.length && src[i] !== quote) {
        if (src[i] === "\\") i++;
        i++;
      }
    }
  }
  return -1;
}

/** Top-level `key:` names inside an object literal (nested objects ignored). */
function topLevelKeys(objectSrc: string): { keys: string[]; stringLiterals: Record<string, string> } {
  const body = objectSrc.slice(1, -1);
  const keys: string[] = [];
  const stringLiterals: Record<string, string> = {};
  let depth = 0;

  const lines = body.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (depth === 0) {
      const m = trimmed.match(/^([A-Za-z_$][\w$]*)\s*:\s*(.*)$/);
      if (m) {
        keys.push(m[1]);
        const lit = m[2].match(/^"([^"]*)"|^'([^']*)'/);
        if (lit) stringLiterals[m[1]] = lit[1] ?? lit[2] ?? "";
      } else {
        // Shorthand property (`name,`)
        const short = trimmed.match(/^([A-Za-z_$][\w$]*)\s*,\s*$/);
        if (short) keys.push(short[1]);
      }
    }
    for (const c of line) {
      if (c === "{" || c === "[" || c === "(") depth++;
      else if (c === "}" || c === "]" || c === ")") depth--;
    }
  }
  return { keys, stringLiterals };
}

/**
 * Finds every `<pattern>({ ... })` call across the source tree and returns the
 * shape of the object literal passed in. Used to assert that what the frontend
 * sends still matches the backend contract.
 */
export function findObjectLiteralCalls(pattern: RegExp, files = sourceFiles()): ObjectLiteralCall[] {
  const out: ObjectLiteralCall[] = [];
  for (const file of files) {
    const src = read(file);
    const re = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : pattern.flags + "g");
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) {
      const brace = src.indexOf("{", m.index + m[0].length - 1);
      if (brace === -1) continue;
      const end = matchBrace(src, brace);
      if (end === -1) continue;
      const raw = src.slice(brace, end);
      out.push({ file: rel(file), raw, ...topLevelKeys(raw) });
    }
  }
  return out;
}
