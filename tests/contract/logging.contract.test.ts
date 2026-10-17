import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "../helpers/entity-schema";
import { backendFiles, edgeFunctionFiles, edgeSource, read, rel } from "../helpers/source-scan";

/**
 * What the backend is allowed to write down about a request.
 *
 * Until these functions logged, the only diagnosis available was the warnings
 * appendix in the operations email — which means only an enquiry whose mail
 * actually went out could be diagnosed, and the failures worth diagnosing are
 * exactly the ones where it did not. So every function now emits a structured
 * line per step.
 *
 * That creates a new hazard, and it is the reason this file exists rather than
 * a comment. A log is the one store a deletion request never reaches: entities
 * can be deleted, the spreadsheet can be edited, an inbox can be cleared, but a
 * line archived into CI is beyond all of that. The whole schema is built to keep
 * identifiers out of storage — `redact()`, the closed track whitelist, the
 * health flag that is never a description — and a log that recorded "all steps"
 * verbatim would reinstate every one of those, in the least reachable place.
 *
 * So the rule is: **what happened, not what was said.** These tests enforce it
 * mechanically, because it is the kind of rule that holds until the first
 * afternoon somebody is debugging something urgent.
 */

const FUNCTIONS_DIR = join(REPO_ROOT, "base44/functions");
/**
 * The agents' three tools only pass a request to an Edge Function and its answer
 * back (agents.contract.test.ts pins that). The diary is the Edge function's.
 */
const FORWARDERS = ["submitLead", "escalateToHuman", "logSupportChat"];
// Folders only: macOS drops a .DS_Store beside them, and opening
// ".DS_Store/entry.ts" crashed the whole file with ENOTDIR.
const functionNames = readdirSync(FUNCTIONS_DIR, { withFileTypes: true })
  .filter((e) => e.isDirectory() && !FORWARDERS.includes(e.name))
  .map((e) => e.name)
  .sort();
const sources = Object.fromEntries(
  functionNames.map((name) => [name, read(join(FUNCTIONS_DIR, name, "entry.ts"))]),
);

/** Supabase Edge Functions, keyed by directory name, each with the shared modules it imports. */
const edgeNames = edgeFunctionFiles().map((f) => f.split("/").at(-2)!);
for (const f of edgeFunctionFiles()) sources[f.split("/").at(-2)!] = edgeSource(f);
const allNames = [...functionNames, ...edgeNames];

/** Every `log(...)` call in a file, as source text. */
function logCalls(src: string): string[] {
  const calls: string[] = [];
  for (const match of src.matchAll(/(?<!function )(?<![.\w])log\(/g)) {
    let depth = 0;
    const start = match.index! + 3;
    for (let i = start; i < src.length; i += 1) {
      if (src[i] === "(") depth += 1;
      else if (src[i] === ")") {
        depth -= 1;
        if (depth === 0) {
          calls.push(src.slice(start, i + 1));
          break;
        }
      }
    }
  }
  return calls;
}

describe("every backend function keeps a diary", () => {
  it.each(allNames)("%s emits a structured line", (name) => {
    expect(sources[name], `${name} never logs`).toMatch(/\blog\('(info|warn|error)'/);
  });

  it.each(allNames)("%s opens and closes the request", (name) => {
    // A start with no end is an invocation that vanished, and the difference
    // between "it was never called" and "it hung" is most of a diagnosis.
    expect(sources[name]).toMatch(/log\('info', 'request\.start'/);
    expect(sources[name], `${name} has no terminal line`).toMatch(
      /log\('(info|error)', '(request\.end|request\.failed|calendar\.created|support\.logged)'/,
    );
  });

  it.each(allNames)("%s correlates its lines with one id", (name) => {
    // Without this a busy minute is an interleaving of several enquiries with
    // no way to tell which line belongs to which.
    expect(sources[name]).toMatch(/const rid = newRequestId\(\)/);
    for (const call of logCalls(sources[name])) {
      expect(call, `${name}: a log line with no rid: ${call.slice(0, 80)}`).toMatch(/\brid\b/);
    }
  });

  it.each(allNames)("%s reports how long it took", (name) => {
    expect(sources[name]).toMatch(/Date\.now\(\) - startedAt|Date\.now\(\) - started/);
  });

  it("writes the same helper in every function", () => {
    // Base44 gives these isolated entries no module to share, so the helper is
    // duplicated. Duplicated is fine; drifted means one function's lines parse
    // differently from the rest and the archive stops being one dataset.
    const norm = (src: string) => {
      const start = src.indexOf("function log(");
      expect(start).toBeGreaterThan(-1);
      return src.slice(start, src.indexOf("\n}", start)).replace(/\s+/g, " ").trim();
    };
    const [first, ...rest] = functionNames.map((n) => norm(sources[n]));
    for (const [i, copy] of rest.entries()) {
      expect(copy, `${functionNames[i + 1]} has drifted`).toBe(first);
    }
  });

  it("names the function it came from, and never the same name twice", () => {
    const declared = allNames.map((n) => sources[n].match(/const FN = '([^']+)'/)?.[1] ?? null);
    expect(declared).toEqual(allNames);
  });
});

describe("what the diary may not contain", () => {
  /**
   * Identifiers, and the free text that carries them.
   *
   * `summary`, `message` and `profile` are here alongside the obvious ones
   * because they are written by a model that just heard a visitor type things
   * it was told not to record — which is why they already pass through
   * `redact()` everywhere else.
   */
  const FORBIDDEN = [
    "name",
    "phone",
    "email",
    "message",
    "summary",
    "profile",
    "notes",
    "transcript",
    "topic",
    "body",
    "consentAt",
  ];

  it.each(allNames)("%s logs no personal field", (name) => {
    for (const call of logCalls(sources[name])) {
      for (const field of FORBIDDEN) {
        // Matches `field:` or a shorthand `field` between delimiters — the two
        // ways a value reaches the object literal.
        const shape = new RegExp(`[{,]\\s*${field}\\s*[:,}]`);
        expect(call, `${name}: '${field}' reaches the log: ${call.slice(0, 100)}`).not.toMatch(
          shape,
        );
      }
    }
  });

  it.each(allNames)("%s logs a recipient's role rather than the address", (name) => {
    // One of the recipients is the visitor. `role` says which copy failed
    // without putting anybody's address in a file that outlives them.
    const calls = logCalls(sources[name]).filter((c) => c.includes("mail."));
    for (const call of calls) {
      expect(call).toMatch(/role/);
      expect(call, `${name}: an address in a mail log line`).not.toMatch(/\bto\b\s*[:,}]/);
    }
  });

  it("passes a role, not an address, into the mail helper", () => {
    for (const name of ["submitClaim"]) {
      const send = sources[name].slice(sources[name].indexOf("async function sendMail("));
      expect(send.slice(0, send.indexOf("\n}")), `${name}`).toMatch(
        /log\('info', 'mail\.sent', \{ rid, role, transport/,
      );
    }
  });

  it("truncates whatever an error message turned out to contain", () => {
    // A provider's error text is not ours and is not bounded: Resend has
    // returned the recipient list, and a stack can carry a URL with a token.
    for (const name of allNames) {
      for (const call of logCalls(sources[name])) {
        if (!call.includes("err:")) continue;
        expect(call, `${name}: an unbounded error in a log line`).toMatch(/\.slice\(0, \d+\)/);
      }
    }
  });
});

/**
 * Every answer carries the number that finds its logs.
 *
 * `rid` was generated at the top of each function, stamped on every log line,
 * and then dropped: no response returned it. A visitor reporting a failure had
 * nothing to quote and we had nothing to search, so diagnosis meant inferring
 * from timestamps and absences. That is how three days went on the one genuine
 * outage this site has had — every instrument could only show what had *not*
 * happened.
 *
 * Eight characters turn that into one search.
 */
describe("a failure you can look up", () => {
  const fns = [...backendFiles().filter((f) => !FORWARDERS.some((n) => f.includes(`/${n}/`))), ...edgeFunctionFiles()];

  it("returns the request id with every answer", () => {
    for (const f of fns) {
      const src = read(f);
      // Each `return Response.json(` with its body, however it is wrapped.
      // A function may answer through a helper instead, which is the better
      // shape — one place that cannot forget. `contentAdmin` does.
      const viaHelper = /Response\.json\(\{ \.\.\.body, rid \}/.test(src);
      if (viaHelper) continue;
      const bodies = [...src.matchAll(/return Response\.json\(\s*(\{[\s\S]*?\n\s*\}|\{[^}]*\})/g)];
      expect(bodies.length, `${rel(f)} answers nothing`).toBeGreaterThan(0);
      for (const [, body] of bodies) {
        expect(body, `${rel(f)} answers without an rid: ${body.slice(0, 60)}`).toMatch(/\brid\b/);
      }
    }
  });

  it("never returns the raw error text to the caller", () => {
    // `error.message` told the visitor nothing they could use and told anyone
    // reading it the shape of our internals. The id is useful to both.
    for (const f of fns) {
      const src = read(f);
      expect(src, `${rel(f)} returns a raw message`).not.toMatch(/error:\s*error\.message/);
      expect(src, `${rel(f)} returns a raw message as details`).not.toMatch(
        /details:\s*e\??\.message/,
      );
    }
  });

  it("puts ok before rid, so a response still reads as one", () => {
    for (const f of fns) {
      const src = read(f);
      expect(src, `${rel(f)} leads with the id rather than the outcome`).not.toMatch(
        /Response\.json\(\{\s*\n\s*rid,\s*\n\s*ok:/,
      );
    }
  });
});
