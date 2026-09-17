import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { REPO_ROOT } from "../helpers/entity-schema";
import { read } from "../helpers/source-scan";

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
const functionNames = readdirSync(FUNCTIONS_DIR).sort();
const sources = Object.fromEntries(
  functionNames.map((name) => [name, read(join(FUNCTIONS_DIR, name, "entry.ts"))]),
);

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
  it.each(functionNames)("%s emits a structured line", (name) => {
    expect(sources[name], `${name} never logs`).toMatch(/\blog\('(info|warn|error)'/);
  });

  it.each(functionNames)("%s opens and closes the request", (name) => {
    // A start with no end is an invocation that vanished, and the difference
    // between "it was never called" and "it hung" is most of a diagnosis.
    expect(sources[name]).toMatch(/log\('info', 'request\.start'/);
    expect(sources[name], `${name} has no terminal line`).toMatch(
      /log\('(info|error)', '(request\.end|request\.failed|calendar\.created|support\.logged)'/,
    );
  });

  it.each(functionNames)("%s correlates its lines with one id", (name) => {
    // Without this a busy minute is an interleaving of several enquiries with
    // no way to tell which line belongs to which.
    expect(sources[name]).toMatch(/const rid = newRequestId\(\)/);
    for (const call of logCalls(sources[name])) {
      expect(call, `${name}: a log line with no rid: ${call.slice(0, 80)}`).toMatch(/\brid\b/);
    }
  });

  it.each(functionNames)("%s reports how long it took", (name) => {
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
    const declared = functionNames.map(
      (n) => sources[n].match(/const FN = '([^']+)'/)?.[1] ?? null,
    );
    expect(declared).toEqual(functionNames);
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

  it.each(functionNames)("%s logs no personal field", (name) => {
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

  it.each(functionNames)("%s logs a recipient's role rather than the address", (name) => {
    // One of the recipients is the visitor. `role` says which copy failed
    // without putting anybody's address in a file that outlives them.
    const calls = logCalls(sources[name]).filter((c) => c.includes("mail."));
    for (const call of calls) {
      expect(call).toMatch(/role/);
      expect(call, `${name}: an address in a mail log line`).not.toMatch(/\bto\b\s*[:,}]/);
    }
  });

  it("passes a role, not an address, into the mail helper", () => {
    for (const name of ["submitLead", "submitClaim", "escalateToHuman"]) {
      const send = sources[name].slice(sources[name].indexOf("async function sendMail("));
      expect(send.slice(0, send.indexOf("\n}")), `${name}`).toMatch(
        /log\('info', 'mail\.sent', \{ rid, role, transport/,
      );
    }
  });

  it("truncates whatever an error message turned out to contain", () => {
    // A provider's error text is not ours and is not bounded: Resend has
    // returned the recipient list, and a stack can carry a URL with a token.
    for (const name of functionNames) {
      for (const call of logCalls(sources[name])) {
        if (!call.includes("err:")) continue;
        expect(call, `${name}: an unbounded error in a log line`).toMatch(/\.slice\(0, \d+\)/);
      }
    }
  });
});

/**
 * Where the lines go once they exist.
 *
 * Base44's own retention answers "what is happening now". The archive answers
 * "what changed since last Tuesday", which is the question actually asked after
 * someone reports an enquiry that never arrived.
 */
describe("the daily archive", () => {
  const workflow = read(join(REPO_ROOT, ".github/workflows/ci.yml"));
  const script = read(join(REPO_ROOT, "scripts/archive-logs.mjs"));
  const gitignore = read(join(REPO_ROOT, ".gitignore"));

  it("runs on the nightly schedule and not on every push", () => {
    // Archiving per push would spend the run on duplicates of a window that
    // has not moved.
    const job = workflow.slice(workflow.indexOf("  logs:\n"));
    expect(job).toMatch(/github\.event_name == 'schedule'/);
    expect(job).toMatch(/workflow_dispatch/);
  });

  it("keeps the archive out of git", () => {
    // The repository is public. The lines carry no personal data by design,
    // but timings, volumes and escalation reasons for a real agency are not
    // something to publish — and a commit cannot be taken back.
    expect(gitignore).toMatch(/^logs\/$/m);
    const job = workflow.slice(workflow.indexOf("  logs:\n"));
    expect(job).toMatch(/upload-artifact/);
    expect(job, "the archive job must not push to the repository").not.toMatch(
      /git (commit|push)|contents: write/,
    );
  });

  it("names each file for the window it covers, not the day it ran", () => {
    // A nightly run crosses midnight; a file named for the run date is a file
    // nobody can find later.
    expect(script).toMatch(/function windowDate\(/);
    expect(script).toMatch(/Date\.now\(\) - back \* 60 \* 60 \* 1000/);
  });

  it("never fails the nightly run over a log fetch", () => {
    // Nothing else in that run depends on the archive, and a red badge every
    // morning teaches everyone to ignore the badge.
    expect(script).toMatch(/::warning::Could not fetch logs/);
    expect(script).toMatch(/process\.exit\(0\)/);
  });

  it("says so when a day is truncated rather than silently losing it", () => {
    expect(script).toMatch(/ceiling/);
  });

  it("demands the same credential shape as the publish job", () => {
    const job = workflow.slice(workflow.indexOf("  logs:\n"));
    expect(job).toMatch(/b44k_/);
  });
});

/**
 * Which credential the publish gate picks, executed rather than read.
 *
 * Base44 offers two ways to authenticate a runner, and only one of them exists
 * on every plan: a workspace API key (`b44k_…`, Business plan and above), or
 * the access/refresh pair a local `base44 login` leaves behind, which the CLI
 * seeds from the environment.
 *
 * The first version of this gate failed the run whenever `BASE44_API_KEY` was
 * set to anything that was not a workspace key — sound when it is the only
 * credential, because the CLI would fall back to a device login and hang, and
 * wrong when a working session sits beside it. That is precisely what happened
 * on the merge of #48: three secrets present, and the stale one decided the
 * outcome for the other two.
 *
 * Shell embedded in YAML is not covered by anything else in this repository, so
 * these extract the script and run it against each combination.
 */
describe("the publish gate chooses a credential", () => {
  const workflow = read(join(REPO_ROOT, ".github/workflows/ci.yml"));

  /** The `run:` body of a named step, de-indented and with `${{ }}` filled in. */
  function gateScript(step: string, appId = "app-123"): string {
    const at = workflow.indexOf(`      - name: ${step}`);
    expect(at, `${step} is missing`).toBeGreaterThan(-1);
    const body = workflow.slice(workflow.indexOf("run: |", at) + "run: |".length);
    const lines: string[] = [];
    for (const line of body.split("\n").slice(1)) {
      if (line.trim() && !line.startsWith("          ")) break;
      lines.push(line.replace(/^ {10}/, ""));
    }
    return lines.join("\n").replace(/\$\{\{ vars\.BASE44_APP_ID \}\}/g, appId);
  }

  /** Run it the way Actions does — `bash -e` — and report what it decided. */
  function run(script: string, env: Record<string, string>) {
    const out = mkdtempSync(join(tmpdir(), "gate-"));
    const output = join(out, "gh-output");
    writeFileSync(output, "");
    const result = spawnSync("bash", ["-e", "-c", script], {
      env: { PATH: process.env.PATH ?? "", GITHUB_OUTPUT: output, ...env },
      encoding: "utf8",
    });
    const written = readFileSync(output, "utf8");
    rmSync(out, { recursive: true, force: true });
    return {
      status: result.status,
      ready: /ready=true/.test(written),
      stdout: result.stdout ?? "",
    };
  }

  const KEY = "b44k_workspace_key";
  const JUNK = "b44u_a_personal_token";
  const PAIR = { BASE44_ACCESS_TOKEN: "access", BASE44_REFRESH_TOKEN: "refresh" };

  it("publishes with the workspace key when there is one", () => {
    const r = run(gateScript("Check publish credentials"), { BASE44_API_KEY: KEY });
    expect(r.status).toBe(0);
    expect(r.ready).toBe(true);
  });

  it("publishes with the seeded session when there is no workspace key", () => {
    const r = run(gateScript("Check publish credentials"), PAIR);
    expect(r.status).toBe(0);
    expect(r.ready).toBe(true);
  });

  it("publishes anyway when a stale key sits beside a usable session", () => {
    // The regression this file exists for. A credential nobody can use must not
    // outvote one that works.
    const r = run(gateScript("Check publish credentials"), { ...PAIR, BASE44_API_KEY: JUNK });
    expect(r.status, "a stale key failed a runnable publish").toBe(0);
    expect(r.ready).toBe(true);
    expect(r.stdout, "the stale secret should still be called out").toMatch(/::warning::/);
  });

  it("still fails on an unusable key with nothing to fall back on", () => {
    // Unchanged, and deliberately so: the CLI would fall back to a device
    // login and hang until the job timed out.
    const r = run(gateScript("Check publish credentials"), { BASE44_API_KEY: JUNK });
    expect(r.status).not.toBe(0);
    expect(r.ready).toBe(false);
  });

  it("fails on half a session rather than hanging on one", () => {
    const r = run(gateScript("Check publish credentials"), { BASE44_ACCESS_TOKEN: "access" });
    expect(r.status).not.toBe(0);
  });

  it("skips quietly when nothing is configured", () => {
    const r = run(gateScript("Check publish credentials"), {});
    expect(r.status).toBe(0);
    expect(r.ready).toBe(false);
  });

  it("skips when the app id is missing, whatever the credentials", () => {
    const r = run(gateScript("Check publish credentials", ""), { BASE44_API_KEY: KEY });
    expect(r.status).toBe(0);
    expect(r.ready).toBe(false);
  });

  it("never fails the nightly archive over credentials", () => {
    // An unarchived day is a gap in an operational record, not a broken build.
    for (const env of [{}, { BASE44_API_KEY: JUNK }, { BASE44_ACCESS_TOKEN: "access" }]) {
      const r = run(gateScript("Check credentials"), env);
      expect(r.status, JSON.stringify(env)).toBe(0);
      expect(r.ready).toBe(false);
    }
  });

  it("drops an unusable key before the CLI ever sees it", () => {
    // Belt and braces. The CLI currently ignores a non-`b44k_` value, but the
    // gate above has already chosen the credential and that choice should not
    // rest on an implementation detail of a package installed at `@latest`.
    for (const step of ["Publish", "Fetch the last 24 hours"]) {
      expect(gateScript(step), step).toMatch(/unset BASE44_API_KEY/);
    }
  });
});
