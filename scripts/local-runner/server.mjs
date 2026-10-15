import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const RESULTS_DIR = path.join(ROOT, "allure-results");
const PAGE = fileURLToPath(new URL("./index.html", import.meta.url));
const PORT = Number(process.env.LOCAL_RUNNER_PORT || 4400);
const SUITES = ["lint", "typecheck", "unit", "component", "contract", "integration", "security", "e2e"];
const TEST_DIRS = ["e2e", "tests"];
const TEST_FILE = /\.(spec|test)\.tsx?$/;
const TRACES = ["on", "off", "retain-on-failure", "on-first-retry", "on-all-retries"];
const PROJECTS = ["web-chromium", "web-webkit", "ios-safari", "android-chrome", "*"];
const REPORTERS = ["list", "line", "dot"];

const run = { child: null, suites: [], single: null, output: "", exitCode: null, startedAt: null, finishedAt: null };

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

function launch(command, args, { suites = [], single = null } = {}) {
  run.suites = suites;
  run.single = single;
  run.output = `$ ${[command, ...args].join(" ")}\n`;
  run.exitCode = null;
  run.startedAt = Date.now();
  run.finishedAt = null;
  run.child = spawn(command, args, {
    cwd: ROOT,
    detached: true,
    env: { ...process.env, NO_REPORT: "1", NO_COLOR: "1", FORCE_COLOR: "0" },
  });

  const append = (chunk) => {
    run.output += chunk.toString();
  };
  run.child.stdout.on("data", append);
  run.child.stderr.on("data", append);
  run.child.on("close", (code, signal) => {
    run.exitCode = code ?? signal;
    run.finishedAt = Date.now();
    run.child = null;
  });
}

function startRun({ suites = [], args = "" }) {
  const chosen = [].concat(suites).filter((suite) => SUITES.includes(suite));
  const flags = String(args).split(/\s+/).filter((arg) => arg.startsWith("-"));
  launch("bash", ["scripts/run-tests.sh", ...chosen, ...flags], { suites: chosen.length ? chosen : SUITES });
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

async function startSingle({ file, flags = {} }) {
  if (!(await listTests()).includes(file)) return false;
  await rm(RESULTS_DIR, { recursive: true, force: true });
  const args = file.startsWith("e2e/") ? playwrightArgs(file, flags) : vitestArgs(file, flags);
  launch("npx", args, { single: file });
  return true;
}

function stopRun() {
  if (run.child) process.kill(-run.child.pid, "SIGTERM");
}

function collectAttachments(node) {
  const own = node.attachments || [];
  const nested = (node.steps || []).flatMap(collectAttachments);
  return [...own, ...nested].map(({ name, source, type }) => ({ name, source, type }));
}

async function readResults() {
  const files = await readdir(RESULTS_DIR).catch(() => []);
  const results = await Promise.all(
    files
      .filter((file) => file.endsWith("-result.json"))
      .map(async (file) => parseJson(await readFile(path.join(RESULTS_DIR, file), "utf8").catch(() => ""))),
  );

  return results.filter(Boolean).map((result) => ({
    name: result.name,
    fullName: result.fullName,
    framework: result.labels?.find((label) => label.name === "framework")?.value,
    status: result.status,
    duration: result.stop - result.start,
    message: result.statusDetails?.message || "",
    trace: result.statusDetails?.trace || "",
    attachments: collectAttachments(result),
  }));
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

const server = createServer(async (req, res) => {
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

  if (isJsonPost && url.pathname === "/api/run") {
    if (run.child) return sendJson(res, 409, { error: "A run is already in progress" });
    startRun(await readBody(req));
    return sendJson(res, 202, { started: true });
  }

  if (req.method === "GET" && url.pathname === "/api/tests") {
    return sendJson(res, 200, await listTests());
  }

  if (isJsonPost && url.pathname === "/api/run-single") {
    if (run.child) return sendJson(res, 409, { error: "A run is already in progress" });
    const started = await startSingle(await readBody(req));
    return started ? sendJson(res, 202, { started: true }) : sendJson(res, 400, { error: "Unknown test file" });
  }

  if (isJsonPost && url.pathname === "/api/stop") {
    stopRun();
    return sendJson(res, 200, { stopped: true });
  }

  sendJson(res, 404, { error: "Not found" });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Local test runner on http://127.0.0.1:${PORT}`);
});
