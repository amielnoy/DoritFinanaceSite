import { execFileSync } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const BATCH_SIZE = 500;
const RETENTION_DAYS = 30;

function git(...args) {
  try {
    return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

function buildInfo() {
  const env = process.env;
  if (env.GITHUB_RUN_ID) {
    return {
      environment: "ci",
      build_id: `${env.GITHUB_RUN_ID}-${env.GITHUB_RUN_ATTEMPT || 1}`,
      build_number: Number(env.GITHUB_RUN_NUMBER) || null,
      git_commit: env.GITHUB_SHA || null,
      git_branch: env.GITHUB_HEAD_REF || env.GITHUB_REF_NAME || null,
      run_type: env.GITHUB_EVENT_NAME === "schedule" ? "nightly" : "e2e",
    };
  }
  return {
    environment: "local",
    build_id: `local-${Date.now()}`,
    build_number: null,
    git_commit: git("rev-parse", "HEAD"),
    git_branch: git("rev-parse", "--abbrev-ref", "HEAD"),
    run_type: "local",
  };
}

async function readResults(dir) {
  const files = (await readdir(dir)).filter((file) => file.endsWith("-result.json"));
  return Promise.all(files.map(async (file) => JSON.parse(await readFile(path.join(dir, file), "utf8"))));
}

function toRow(result, build, timestamp) {
  const labels = result.labels ?? [];
  const label = (name) => labels.find((item) => item.name === name)?.value ?? null;
  const start = result.start ?? result.stop;
  const durationMs = Math.max(0, (result.stop ?? start) - start) || 0;
  const suite = label("suite") ?? result.fullName?.split("#")[0].replace(/^[^:]*:/, "") ?? null;
  return {
    ...build,
    timestamp,
    project: result.parameters?.find((item) => item.name === "Project")?.value ?? label("framework") ?? "unknown",
    test_id: result.historyId || result.uuid,
    test_name: result.name,
    full_name: result.fullName ?? null,
    status: result.status ?? "unknown",
    start_time: start ? new Date(start).toISOString() : null,
    end_time: result.stop ? new Date(result.stop).toISOString() : null,
    duration_ms: durationMs,
    duration_seconds: Math.round(durationMs / 1000),
    suite,
    feature: label("feature") ?? suite?.replace(/^(tests|e2e)\//, "").split("/").slice(0, -1)[0] ?? null,
    story: label("story"),
    severity: label("severity"),
    owner: label("owner"),
    tags: labels.filter((item) => item.name === "tag").map((item) => item.value),
    host: label("host"),
    worker: label("thread"),
    error_message: result.statusDetails?.message ?? null,
    error_trace: result.statusDetails?.trace ?? null,
    steps_count: result.steps?.length ?? 0,
    attachments_count: result.attachments?.length ?? 0,
  };
}

async function rest(url, key, query, init) {
  const res = await fetch(`${url}/rest/v1/test_results${query}`, {
    ...init,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
  });
  if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 300)}`);
}

async function main() {
  const url = process.env.TEST_DASHBOARD_SUPABASE_URL?.replace(/\/+$/, "");
  const key = process.env.TEST_DASHBOARD_SUPABASE_KEY;
  if (!url || !key) {
    console.log("Test dashboard upload skipped: TEST_DASHBOARD_SUPABASE_URL and TEST_DASHBOARD_SUPABASE_KEY are not set.");
    return;
  }
  const results = await readResults(path.resolve(process.argv[2] ?? "allure-results")).catch(() => []);
  if (results.length === 0) {
    console.log("Test dashboard upload skipped: no test results.");
    return;
  }
  const build = buildInfo();
  const timestamp = new Date(Math.min(...results.map((result) => result.start ?? Date.now()))).toISOString();
  // Only the nightly run uploads the vitest suites; run_type is the one place that decides "nightly".
  const allTests = build.run_type === "nightly";
  const rows = results.map((result) => toRow(result, build, timestamp)).filter((row) => allTests || row.project !== "vitest");
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    await rest(url, key, "", { method: "POST", body: JSON.stringify(rows.slice(i, i + BATCH_SIZE)) });
  }
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 86_400_000).toISOString();
  await rest(url, key, `?timestamp=lt.${cutoff}`, { method: "DELETE" });
  console.log(`Uploaded ${rows.length} test results to the test dashboard (${build.environment}, ${build.build_id}).`);
}

main().catch((error) => {
  console.error(`Test dashboard upload failed: ${error.message}`);
  process.exit(1);
});
