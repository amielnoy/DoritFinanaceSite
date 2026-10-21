import { createServer } from "node:http";
import { execFile, spawn } from "node:child_process";
import { mkdir, readFile, readdir, rename, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const RESULTS_DIR = path.join(ROOT, "allure-results");
const DIST_DIR = path.join(ROOT, "dist");
const PAGE = fileURLToPath(new URL("./index.html", import.meta.url));
const PORT = Number(process.env.LOCAL_RUNNER_PORT || 4400);
const SUITES = ["lint", "typecheck", "unit", "component", "contract", "integration", "security", "e2e"];
const TEST_DIRS = ["e2e", "tests"];
const TEST_FILE = /\.(spec|test)\.tsx?$/;
const TRACES = ["on", "off", "retain-on-failure", "on-first-retry", "on-all-retries"];
const PROJECTS = ["web-chromium", "web-webkit", "ios-safari", "android-chrome", "*"];
const REPORTERS = ["list", "line", "dot"];
const SHUTDOWN_GRACE_MS = 10_000;
const ANALYSIS_TIMEOUT_MS = 300_000;
const ANALYSIS_TRACE_CHARS = 20_000;
const CI_DIR = path.join(tmpdir(), "dorit-local-runner-ci");
const CI_WORKFLOW = "ci.yml";
const CI_LOG_LINES = 150;
const CI_FAILED_JOBS = ["failure", "timed_out", "cancelled", "startup_failure"];
const ciLoads = new Map();
const execFileAsync = promisify(execFile);
const HOSTS = [`127.0.0.1:${PORT}`, `localhost:${PORT}`];
const FAILED = ["failed", "broken"];
const HISTORY_DB = path.join(ROOT, ".local-runner", "history.db");
const HISTORY_RUNS = 100;
const HISTORY_OUTPUT_CHARS = 200_000;
const DASHBOARD_UPLOAD = path.join(ROOT, "scripts", "test-dashboard", "upload.mjs");

const run = { busy: false, child: null, onFinish: null, suites: [], single: null, output: "", exitCode: null, startedAt: null, finishedAt: null };

const history = await openHistory();

async function openHistory() {
  try {
    const { DatabaseSync } = await import("node:sqlite");
    await mkdir(path.dirname(HISTORY_DB), { recursive: true });
    const db = new DatabaseSync(HISTORY_DB);
    db.exec(`
      CREATE TABLE IF NOT EXISTS runs (id INTEGER PRIMARY KEY, target TEXT, command TEXT, started_at INTEGER, finished_at INTEGER, exit_code, passed INTEGER, failed INTEGER, skipped INTEGER, output TEXT);
      CREATE TABLE IF NOT EXISTS failures (run_id INTEGER, name TEXT, full_name TEXT, status TEXT, message TEXT, trace TEXT);
      CREATE INDEX IF NOT EXISTS failures_run_id ON failures (run_id);
    `);
    return { db };
  } catch (error) {
    return { error: `Run history is off because node:sqlite is not available (${error.message}). It needs Node 22.13 or newer.` };
  }
}

async function saveRun() {
  if (!history.db) return;
  const results = await readResults();
  const failures = results.filter((result) => FAILED.includes(result.status));
  const passed = results.filter((result) => result.status === "passed").length;
  const { lastInsertRowid } = history.db
    .prepare("INSERT INTO runs (target, command, started_at, finished_at, exit_code, passed, failed, skipped, output) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(
      run.single || run.suites.join(", "),
      run.output.slice(2, run.output.indexOf("\n")),
      run.startedAt,
      run.finishedAt,
      run.exitCode,
      passed,
      failures.length,
      results.length - passed - failures.length,
      run.output.slice(-HISTORY_OUTPUT_CHARS),
    );
  const insert = history.db.prepare("INSERT INTO failures (run_id, name, full_name, status, message, trace) VALUES (?, ?, ?, ?, ?, ?)");
  for (const result of failures) insert.run(lastInsertRowid, result.name || "", result.fullName || "", result.status, result.message, result.trace);
}

async function uploadRun(append) {
  try {
    const { stdout } = await execFileAsync(process.execPath, ["--env-file-if-exists=.env.local", DASHBOARD_UPLOAD, RESULTS_DIR], { cwd: ROOT });
    append(`\n${stdout}`);
  } catch (error) {
    append(`\n${error.stderr || error.message}`);
  }
}

function listHistory() {
  return history.db
    .prepare("SELECT id, target, command, started_at AS startedAt, finished_at AS finishedAt, exit_code AS exitCode, passed, failed, skipped FROM runs ORDER BY id DESC LIMIT ?")
    .all(HISTORY_RUNS);
}

function historyRun(id) {
  const saved = history.db
    .prepare("SELECT id, target, command, started_at AS startedAt, finished_at AS finishedAt, exit_code AS exitCode, passed, failed, skipped, output FROM runs WHERE id = ?")
    .get(id);
  if (!saved) return null;
  const failures = history.db.prepare("SELECT name, full_name AS fullName, status, message, trace FROM failures WHERE run_id = ?").all(id);
  return { ...saved, failures: failures.map((failure) => ({ ...failure, duration: 0, attachments: [] })) };
}

function sendJson(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function readBody(req) {
  let data = "";
  for await (const chunk of req) data += chunk;
  return parseJson(data) || {};
}

// A dist/ written since the run started is the `build:e2e` bundle (fake Supabase host
// inlined). run-tests.sh deletes it after a finished e2e suite; a single e2e file
// (built by playwright.config.ts's webServer) or a stopped run never gets there.
async function removeE2eBuild(since) {
  const builtDuringRun = await stat(DIST_DIR).then((info) => info.mtimeMs >= since, () => false);
  if (builtDuringRun) await rm(DIST_DIR, { recursive: true, force: true });
}

function launch(command, args, { suites = [], single = null, e2e = false } = {}) {
  run.suites = suites;
  run.single = single;
  run.output = `$ ${[command, ...args].join(" ")}\n`;
  run.exitCode = null;
  run.startedAt = Date.now();
  run.finishedAt = null;
  const startedAt = run.startedAt;
  const child = spawn(command, args, {
    cwd: ROOT,
    detached: true,
    env: { ...process.env, NO_REPORT: "1", NO_COLOR: "1", FORCE_COLOR: "0" },
  });
  run.child = child;

  const append = (chunk) => {
    run.output += chunk.toString();
  };
  let finished = false;
  const finish = async (exitCode) => {
    if (finished) return;
    finished = true;
    if (e2e) await removeE2eBuild(startedAt).catch((error) => append(`\nCould not remove dist/: ${error.message}\n`));
    run.exitCode = exitCode;
    run.finishedAt = Date.now();
    await saveRun().catch((error) => append(`\nCould not save the run to history: ${error.message}\n`));
    if (typeof exitCode === "number") await uploadRun(append);
    run.child = null;
    run.busy = false;
    run.onFinish?.();
  };
  // Decoded by the stream, so a multi-byte character (the ┌─/└─ banners) split
  // across two chunks isn't turned into U+FFFD.
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", append);
  child.stderr.on("data", append);
  child.on("error", (error) => {
    append(`\n${error.message}\n`);
    if (child.pid === undefined) finish(1);
  });
  child.on("close", (code, signal) => finish(code ?? signal));
}

// Splits the extra-flags field like a shell would for quotes, so --grep="home page"
// arrives as one argument. A bare word is refused rather than dropped:
// `--project web-chromium` would otherwise run as a bare --project, which
// run-tests.sh doesn't read as a project choice.
function parseFlags(text) {
  const tokens = [];
  let token = null;
  let quote = null;
  for (const char of String(text ?? "")) {
    if (quote) {
      if (char === quote) quote = null;
      else token += char;
    } else if (char === '"' || char === "'") {
      quote = char;
      token ??= "";
    } else if (/\s/.test(char)) {
      if (token !== null) tokens.push(token);
      token = null;
    } else {
      token = (token ?? "") + char;
    }
  }
  if (quote) return { error: `Unclosed ${quote} in the extra flags` };
  if (token !== null) tokens.push(token);
  const bare = tokens.find((arg) => !arg.startsWith("-"));
  if (bare !== undefined) return { error: `"${bare}" isn't a flag; write a flag's value with =, e.g. --project=web-chromium` };
  return { flags: tokens };
}

function startRun({ suites = [] }, flags) {
  const chosen = [].concat(suites).filter((suite) => SUITES.includes(suite));
  const ran = chosen.length ? chosen : SUITES;
  launch("bash", ["scripts/run-tests.sh", ...chosen, ...flags], { suites: ran, e2e: ran.includes("e2e") });
}

async function listTests() {
  const found = await Promise.all(
    TEST_DIRS.map(async (dir) => (await readdir(path.join(ROOT, dir), { recursive: true })).map((file) => `${dir}/${file}`)),
  );
  return found.flat().filter((file) => TEST_FILE.test(file)).sort();
}

function number(value) {
  return /^\d+$/.test(String(value ?? "")) ? String(value) : "";
}

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function playwrightArgs(file, flags) {
  const args = ["playwright", "test", file];
  if (flags.debug) args.push("--debug");
  else if (flags.ui) args.push("--ui");
  else if (flags.headed) args.push("--headed");
  if (TRACES.includes(flags.trace)) args.push(`--trace=${flags.trace}`);
  if (PROJECTS.includes(flags.project)) args.push(`--project=${flags.project}`);
  if (text(flags.grep)) args.push(`--grep=${text(flags.grep)}`);
  if (text(flags.grepInvert)) args.push(`--grep-invert=${text(flags.grepInvert)}`);
  if (number(flags.workers)) args.push(`--workers=${number(flags.workers)}`);
  if (number(flags.retries)) args.push(`--retries=${number(flags.retries)}`);
  if (number(flags.repeatEach)) args.push(`--repeat-each=${number(flags.repeatEach)}`);
  if (number(flags.timeout) && !flags.debug) args.push(`--timeout=${number(flags.timeout)}`);
  if (number(flags.maxFailures)) args.push(`--max-failures=${number(flags.maxFailures)}`);
  if (REPORTERS.includes(flags.reporter)) args.push(`--reporter=${flags.reporter},allure-playwright`);
  if (/^\d+\/\d+$/.test(flags.shard)) args.push(`--shard=${flags.shard}`);
  if (flags.list) args.push("--list");
  return args;
}

function vitestArgs(file, flags) {
  const args = ["vitest", flags.list ? "list" : "run", file];
  if (text(flags.grep)) args.push(`--testNamePattern=${text(flags.grep)}`);
  if (number(flags.retries)) args.push(`--retry=${number(flags.retries)}`);
  if (number(flags.timeout)) args.push(`--testTimeout=${number(flags.timeout)}`);
  if (number(flags.maxFailures)) args.push(`--bail=${number(flags.maxFailures)}`);
  if (/^\d+\/\d+$/.test(flags.shard)) args.push(`--shard=${flags.shard}`);
  return args;
}

async function startSingle({ file, flags }) {
  if (!(await listTests()).includes(file)) return false;
  await rm(RESULTS_DIR, { recursive: true, force: true });
  const e2e = file.startsWith("e2e/");
  const args = e2e ? playwrightArgs(file, flags || {}) : vitestArgs(file, flags || {});
  launch("npx", args, { single: file, e2e });
  return true;
}

// Claimed before any await, so a double-clicked Run can't start two runs.
function claimRun() {
  if (run.busy) return false;
  run.busy = true;
  return true;
}

function signalRun(signal) {
  if (!run.child?.pid) return;
  try {
    process.kill(-run.child.pid, signal);
  } catch (error) {
    // ESRCH: the group has exited and "close" hasn't fired yet.
    if (error.code !== "ESRCH") throw error;
  }
}

function collectAttachments(node, filesUrl) {
  const own = node.attachments || [];
  const nested = (node.steps || []).flatMap((step) => collectAttachments(step, filesUrl));
  return [...own.map(({ name, source, type }) => ({ name, source, type, url: `${filesUrl}/${encodeURIComponent(source)}` })), ...nested];
}

async function readResults(dir = RESULTS_DIR, filesUrl = "/files") {
  const files = await readdir(dir).catch(() => []);
  const results = await Promise.all(
    files
      .filter((file) => file.endsWith("-result.json"))
      .map(async (file) => parseJson(await readFile(path.join(dir, file), "utf8").catch(() => ""))),
  );

  return results.filter(Boolean).map((result) => ({
    name: result.name,
    fullName: result.fullName,
    framework: result.labels?.find((label) => label.name === "framework")?.value,
    status: result.status,
    duration: result.stop - result.start,
    message: result.statusDetails?.message || "",
    trace: result.statusDetails?.trace || "",
    attachments: collectAttachments(result, filesUrl),
  }));
}

async function gh(args) {
  try {
    const { stdout } = await execFileAsync("gh", args, { cwd: ROOT, maxBuffer: 256 * 1024 * 1024 });
    return stdout;
  } catch (error) {
    if (error.code === "ENOENT") throw new Error("Could not start the GitHub CLI. Install it with brew install gh, then run gh auth login.");
    throw new Error(String(error.stderr || error.message).trim());
  }
}

async function listCiRuns() {
  const fields = "databaseId,displayTitle,conclusion,status,headBranch,event,createdAt,url";
  return JSON.parse(await gh(["run", "list", "--workflow", CI_WORKFLOW, "--limit", "50", "--json", fields]));
}

async function downloadCiResults(id, { status, attempt }) {
  const target = path.join(CI_DIR, `${id}-${attempt}`);
  if (await stat(target).then(() => true, () => false)) return target;
  const partial = `${target}.part`;
  await rm(partial, { recursive: true, force: true });
  await gh(["run", "download", id, "--pattern", "allure-results-*", "--dir", partial]);
  if (status !== "completed") return partial;
  await rename(partial, target);
  return target;
}

function cleanLog(log) {
  const lines = log.split("\n");
  const end = lines.findLastIndex((line) => line.includes("##[error]")) + 1 || lines.length;
  return lines
    .slice(Math.max(0, end - CI_LOG_LINES), end)
    .map((line) => line.replace(/^\S+Z /, "").replace(/\u001b\[[\d;]*m/g, ""))
    .join("\n");
}

function failedJobs(jobs) {
  return Promise.all(
    jobs
      .filter((job) => CI_FAILED_JOBS.includes(job.conclusion))
      .map(async (job) => ({
        name: job.name,
        log: await gh(["api", `repos/{owner}/{repo}/actions/jobs/${job.databaseId}/logs`]).then(cleanLog, (error) => error.message),
      })),
  );
}

async function loadCiRun(id) {
  const run = JSON.parse(await gh(["run", "view", id, "--json", "jobs,status,attempt"]));
  const [jobs, download] = await Promise.all([
    failedJobs(run.jobs),
    downloadCiResults(id, run).then((dir) => ({ dir }), (error) => ({ error: error.message })),
  ]);
  const artifacts = download.dir ? await readdir(download.dir) : [];
  const filesUrl = (artifact) => `/ci-files/${path.basename(download.dir)}/${artifact}`;
  const results = await Promise.all(artifacts.map((artifact) => readResults(path.join(download.dir, artifact), filesUrl(artifact))));
  return { results: results.flat(), jobs, note: download.error || "" };
}

function loadCiRunOnce(id) {
  if (!ciLoads.has(id)) ciLoads.set(id, loadCiRun(id).finally(() => ciLoads.delete(id)));
  return ciLoads.get(id);
}

function analysisPrompt({ name, file, message, trace }) {
  return [
    "A test in this repository failed. Find the most likely root cause and how to fix it.",
    "Read the failing test and the application code it exercises before answering. Do not change any files.",
    "Answer in plain text without Markdown, in three short sections titled Cause, Evidence (with file:line references) and Fix. Say whether the bug is in the test or in the application.",
    `Test: ${text(name)}`,
    `File: ${text(file)}`,
    `Error:\n${text(message)}`,
    `Output:\n${text(trace).slice(-ANALYSIS_TRACE_CHARS)}`,
  ].join("\n\n");
}

function analyze(prompt) {
  return new Promise((resolve, reject) => {
    const child = spawn("claude", ["-p", "--tools", "Read,Grep,Glob", "--no-session-persistence", "--output-format", "text"], { cwd: ROOT });
    let output = "";
    let errors = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => (output += chunk));
    child.stderr.setEncoding("utf8").on("data", (chunk) => (errors += chunk));
    const timer = setTimeout(() => child.kill(), ANALYSIS_TIMEOUT_MS);
    child.on("error", () => reject(new Error("Could not start the claude CLI. Install Claude Code and make sure claude is on your PATH.")));
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (code === 0) resolve(output.trim());
      else reject(new Error(errors.trim() || (signal ? "The analysis timed out" : `claude exited with code ${code}`)));
    });
    child.stdin.end(prompt);
  });
}

async function serveFile(res, file, contentType) {
  try {
    const body = await readFile(file);
    res.writeHead(200, contentType ? { "Content-Type": contentType } : {});
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end();
  }
}

async function handle(req, res) {
  // Binding to 127.0.0.1 doesn't stop DNS rebinding: a page whose hostname now
  // resolves here is same-origin to the browser, but still sends its own Host.
  if (!HOSTS.includes(req.headers.host)) return sendJson(res, 403, { error: "Unexpected Host header" });

  const url = new URL(req.url, `http://${req.headers.host}`);
  const isJsonPost = req.method === "POST" && req.headers["content-type"] === "application/json";

  if (req.method === "GET" && url.pathname === "/") {
    return serveFile(res, PAGE, "text/html; charset=utf-8");
  }

  if (req.method === "GET" && url.pathname === "/api/state") {
    const since = Number(url.searchParams.get("since") || 0);
    return sendJson(res, 200, {
      running: Boolean(run.child),
      suites: run.suites,
      single: run.single,
      exitCode: run.exitCode,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      output: run.output.slice(since),
      length: run.output.length,
    });
  }

  if (req.method === "GET" && url.pathname === "/api/results") {
    return sendJson(res, 200, await readResults());
  }

  if (req.method === "GET" && url.pathname.startsWith("/files/")) {
    const name = path.basename(decodeURIComponent(url.pathname.slice("/files/".length)));
    return serveFile(res, path.join(RESULTS_DIR, name));
  }

  if (req.method === "GET" && url.pathname.startsWith("/api/history") && history.error) {
    return sendJson(res, 503, { error: history.error });
  }

  if (req.method === "GET" && url.pathname === "/api/history") {
    return sendJson(res, 200, listHistory());
  }

  const historyId = url.pathname.match(/^\/api\/history\/(\d+)$/);
  if (req.method === "GET" && historyId) {
    const saved = historyRun(Number(historyId[1]));
    return saved ? sendJson(res, 200, saved) : sendJson(res, 404, { error: "Run not found" });
  }

  if (req.method === "GET" && url.pathname === "/api/ci/runs") {
    return sendJson(res, 200, await listCiRuns());
  }

  const ciRun = url.pathname.match(/^\/api\/ci\/runs\/(\d+)$/);
  if (req.method === "GET" && ciRun) {
    return sendJson(res, 200, await loadCiRunOnce(ciRun[1]));
  }

  const ciFile = url.pathname.match(/^\/ci-files\/(\d+-\d+(?:\.part)?)\/(allure-results-[\w-]+)\/([^/]+)$/);
  if (req.method === "GET" && ciFile) {
    const [, id, artifact, file] = ciFile.map((part) => path.basename(decodeURIComponent(part)));
    return serveFile(res, path.join(CI_DIR, id, artifact, file));
  }

  if (isJsonPost && url.pathname === "/api/run") {
    const body = await readBody(req);
    const { flags, error } = parseFlags(body.args);
    if (error) return sendJson(res, 400, { error });
    if (!claimRun()) return sendJson(res, 409, { error: "A run is already in progress" });
    try {
      startRun(body, flags);
    } catch (error) {
      run.busy = false;
      throw error;
    }
    return sendJson(res, 202, { started: true });
  }

  if (req.method === "GET" && url.pathname === "/api/tests") {
    return sendJson(res, 200, await listTests());
  }

  if (isJsonPost && url.pathname === "/api/run-single") {
    const body = await readBody(req);
    if (!claimRun()) return sendJson(res, 409, { error: "A run is already in progress" });
    let started = false;
    try {
      started = await startSingle(body);
    } finally {
      if (!started) run.busy = false;
    }
    return started ? sendJson(res, 202, { started: true }) : sendJson(res, 400, { error: "Unknown test file" });
  }

  if (isJsonPost && url.pathname === "/api/analyze") {
    return sendJson(res, 200, { analysis: await analyze(analysisPrompt(await readBody(req))) });
  }

  if (isJsonPost && url.pathname === "/api/stop") {
    signalRun("SIGTERM");
    return sendJson(res, 200, { stopped: true });
  }

  sendJson(res, 404, { error: "Not found" });
}

const server = createServer(async (req, res) => {
  try {
    await handle(req, res);
  } catch (error) {
    if (res.headersSent) res.end();
    else sendJson(res, 500, { error: error.message });
  }
});

// The run has its own process group (so Stop reaches all of it), which also puts it out
// of reach of Ctrl+C here. Stop it and wait for its cleanup; a second signal, or a run
// still alive after the grace period, gets SIGKILL.
let shuttingDown = false;
function shutdown() {
  if (shuttingDown || !run.child) {
    signalRun("SIGKILL");
    process.exit(shuttingDown ? 1 : 0);
  }
  shuttingDown = true;
  console.log("\nStopping the current run…");
  server.close();
  run.onFinish = () => process.exit(0);
  signalRun("SIGTERM");
  setTimeout(() => {
    signalRun("SIGKILL");
    process.exit(1);
  }, SHUTDOWN_GRACE_MS).unref();
}
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(signal, shutdown);

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Local test runner on http://127.0.0.1:${PORT}`);
});
