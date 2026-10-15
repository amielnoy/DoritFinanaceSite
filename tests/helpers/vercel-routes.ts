import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "./entity-schema";

export interface VercelRewrite {
  source: string;
  destination: string;
  has?: unknown;
}

export interface VercelHeaderRule {
  source: string;
  headers: { key: string; value: string }[];
}

export function readVercelConfig(): { rewrites: VercelRewrite[]; headers: VercelHeaderRule[] } {
  return JSON.parse(readFileSync(join(REPO_ROOT, "vercel.json"), "utf8"));
}

/**
 * A vercel.json `source` as a RegExp, for the subset of path-to-regexp this
 * repo writes: `:name(a|b)`, `:name`, `/:name*`, and a raw `(...)` group.
 * Vercel matches with path-to-regexp 6; this is just enough to ask "does this
 * rule take that path" without depending on a transitive package.
 */
export function sourcePattern(source: string): RegExp {
  let re = "";
  for (let i = 0; i < source.length; ) {
    const rest = source.slice(i);
    const star = rest.match(/^\/:([A-Za-z_]\w*)\*/);
    if (star) {
      re += "(?:/[^/]+)*";
      i += star[0].length;
      continue;
    }
    const named = rest.match(/^:([A-Za-z_]\w*)(\([^)]*\))?/);
    if (named) {
      re += named[2] ? `(?:${named[2].slice(1, -1)})` : "[^/]+";
      i += named[0].length;
      continue;
    }
    if (rest[0] === "(") {
      // A raw group, copied as written (nested parentheses included).
      let depth = 0;
      let j = i;
      for (; j < source.length; j++) {
        if (source[j] === "(") depth++;
        if (source[j] === ")" && --depth === 0) break;
      }
      re += source.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    re += rest[0].replace(/[.+?^${}|[\]\\]/g, "\\$&");
    i += 1;
  }
  return new RegExp(`^${re}$`);
}

/** The rules that serve the SPA shell (`dist/app.html`, at `/app`). */
export const shellRules = (rewrites: VercelRewrite[]) => rewrites.filter((r) => r.destination === "/app");

/** Whether an address with no file of its own is served the app, rather than the 404 page. */
export const servesShell = (rewrites: VercelRewrite[], path: string) =>
  shellRules(rewrites).some((r) => sourcePattern(r.source).test(path));
