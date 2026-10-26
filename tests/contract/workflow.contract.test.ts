import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "../helpers/entity-schema";

/**
 * The CI workflow as a contract.
 *
 * This file exists because of a real failure. A merge brought back a step that
 * had been renamed, leaving two `upload-artifact` steps in one job both
 * claiming the name `allure-report`. GitHub rejects the second with a 409 and
 * fails the job — after the whole battery has already run. Nothing in the repo
 * could have caught it, and the branch is merged into often enough that it
 * would have happened again.
 *
 * These are cheap structural checks on a file that is edited by hand, merged
 * frequently, and only validated by running it.
 */

const workflow = parse(
  readFileSync(join(REPO_ROOT, ".github/workflows/ci.yml"), "utf8"),
) as {
  on: Record<string, unknown>;
  env?: Record<string, string>;
  jobs: Record<
    string,
    {
      needs?: string | string[];
      if?: string;
      outputs?: Record<string, string>;
      strategy?: { matrix?: { include?: unknown } };
      steps?: Array<{
        name?: string;
        uses?: string;
        id?: string;
        with?: Record<string, string>;
        env?: Record<string, string>;
        run?: string;
      }>;
    }
  >;
};

const jobs = Object.entries(workflow.jobs);
const stepsOf = (job: (typeof jobs)[number][1]) => job.steps ?? [];
const needsOf = (job: (typeof jobs)[number][1]) => {
  const n = job.needs;
  return n === undefined ? [] : Array.isArray(n) ? n : [n];
};

describe("the CI workflow is internally consistent", () => {
  it("never uploads two artifacts under the same name in one job", () => {
    // The 409 that started this file.
    for (const [name, job] of jobs) {
      const uploaded = stepsOf(job)
        .filter((s) => (s.uses ?? "").includes("upload-artifact"))
        .map((s) => s.with?.name)
        .filter(Boolean) as string[];
      const seen = new Set<string>();
      for (const artifact of uploaded) {
        expect(seen.has(artifact), `${name} uploads "${artifact}" more than once`).toBe(false);
        seen.add(artifact);
      }
    }
  });

  it("never lets a build that strips the environment write the tested artifact", () => {
    // The build job runs `npm run build` twice: once properly, and once with
    // `env -u VITE_BASE44_APP_ID …` to prove the build still works in the
    // Builder's bare environment. The guard used to write over `dist/`, and the
    // upload below it then shipped *that* bundle as the `dist` artifact — the
    // one every e2e shard downloads. Vite inlines the app id at build time, so
    // the whole suite ran against a bundle posting to `/api/apps/undefined/…`,
    // and stayed green because e2e/fixtures/app.ts stubs `**/api/**`.
    //
    // A guard for a build must not be able to become the build.
    for (const [name, job] of jobs) {
      const uploadsDist = stepsOf(job).some(
        (s) => (s.uses ?? "").includes("upload-artifact") && s.with?.path === "dist",
      );
      if (!uploadsDist) continue;

      for (const step of stepsOf(job)) {
        const run = (step as { run?: string }).run ?? "";
        if (!/env -u [A-Z_ -]*VITE_BASE44_APP_ID/.test(run)) continue;
        expect(
          run,
          `${name} → "${step.name}" strips the environment into the default outDir, ` +
            "which is the artifact the e2e shards test — give it its own --outDir",
        ).toMatch(/--outDir\s+\S+/);
      }
    }
  });

  it("runs every Vitest suite that exists on disk", () => {
    // A new directory under tests/ is easy to add and easy to forget to wire
    // in, and a suite CI never runs is worse than no suite: it reads as
    // coverage. Compared against the directory listing rather than a list
    // maintained here, so adding one is enough to be caught.
    // A suite is a directory that actually holds test files — which leaves
    // helpers/, setup/ and test-plan/ out without naming them, so the check
    // keeps working as those grow.
    const testsDir = join(REPO_ROOT, "tests");
    const suites = readdirSync(testsDir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .filter((e) => readdirSync(join(testsDir, e.name)).some((f) => f.includes(".test.")))
      .map((e) => e.name);
    expect(suites.length, "no test suites found at all").toBeGreaterThan(0);

    const ciCommands = stepsOf(workflow.jobs["test-node"])
      .map((s) => String((s as { run?: string }).run ?? ""))
      .join("\n");

    for (const suite of suites) {
      expect(ciCommands, `tests/${suite} exists but no CI step runs it`).toContain(
        `npm run test:${suite}`,
      );
    }
  });

  it("depends only on jobs that exist", () => {
    const known = new Set(jobs.map(([n]) => n));
    for (const [name, job] of jobs) {
      for (const dep of needsOf(job)) {
        expect(known.has(dep), `${name} needs "${dep}", which is not a job`).toBe(true);
      }
    }
  });

  it("reads no output from a job it does not depend on", () => {
    // `needs.x.outputs.y` silently evaluates to empty when x is not in needs,
    // which shows up as a blank link in a summary rather than as an error.
    for (const [name, job] of jobs) {
      const declared = new Set(needsOf(job));
      const body = JSON.stringify(job);
      for (const match of body.matchAll(/needs\.([a-z0-9_-]+)\./g)) {
        expect(
          declared.has(match[1]),
          `${name} reads needs.${match[1]} without listing it in needs`,
        ).toBe(true);
      }
    }
  });

  it("reads only outputs the producing job actually declares", () => {
    const body = JSON.stringify(workflow.jobs);
    for (const match of body.matchAll(/needs\.([a-z0-9_-]+)\.outputs\.([a-z0-9_-]+)/g)) {
      const [, producer, key] = match;
      expect(workflow.jobs[producer], `unknown job ${producer}`).toBeTruthy();
      expect(
        Object.keys(workflow.jobs[producer].outputs ?? {}),
        `${producer} does not declare output "${key}"`,
      ).toContain(key);
    }
  });
});

describe("the workflow tests every PR commit once and deploys from only two branches", () => {
  it("runs on a push only to the branches that deploy", () => {
    // A feature branch is tested through its PR. Pushing it ran CI twice for
    // the PR's first commit, and the cancelled twin showed as failed checks.
    expect((workflow.on as { push: { branches: string[] } }).push.branches).toEqual(["main", "builder"]);
  });

  it("runs on every commit of an open PR, which is where 'Safe to merge?' comes from", () => {
    const pr = (workflow.on as { pull_request: { branches: string[]; types: string[] } }).pull_request;
    expect(pr.branches).toEqual(["main"]);
    expect(pr.types).toEqual(expect.arrayContaining(["opened", "reopened", "synchronize"]));
    expect(workflow.jobs["merge-readiness"].name).toBe("Safe to merge?");
  });

  it("names Vercel as production in the PR verdict, not Base44", () => {
    const verdict = JSON.stringify(workflow.jobs["merge-readiness"]);
    expect(verdict).not.toContain("**Base44** (production");
    expect(verdict).toContain("**Production** (Vercel");
  });

  it("gates every deploying job on the ref, so a feature branch ships nothing", () => {
    for (const name of ["deploy-supabase", "deploy-vercel"]) {
      const condition = workflow.jobs[name].if ?? "";
      expect(condition, `${name} must check the branch`).toMatch(/github\.ref == 'refs\/heads\//);
    }
  });

  it("runs the heavy platforms nightly", () => {
    const schedule = (workflow.on as { schedule?: Array<{ cron: string }> }).schedule;
    expect(schedule, "the nightly run is gone").toBeTruthy();
    // 19:00 UTC is 22:00 in Israel while IDT is in force. GitHub cron has no
    // timezone, so this drifts by an hour in winter, knowingly.
    expect(schedule![0].cron).toBe("0 19 * * *");
  });

  it("publishes nothing to Base44", () => {
    // The site, its content and all four agents left Base44 (2026-10-16/17):
    // no publish job, no CLI, no credential for one.
    expect(workflow.jobs.deploy, "the Publish to Base44 job is back").toBeUndefined();
    const text = readFileSync(join(REPO_ROOT, ".github/workflows/ci.yml"), "utf8");
    expect(text).not.toMatch(/base44 deploy|secrets\.BASE44_/);
  });

  it("rebuilds the Vercel site nightly, with the functions deployed first (CTR-REB-001)", () => {
    // Articles are prebuilt at deploy time, so an edit made from /admin/blog
    // reaches its page only on the next production build. The functions job
    // must run too: --prod waits for it, so the site is never ahead of them.
    for (const name of ["deploy-vercel", "deploy-supabase"]) {
      expect(workflow.jobs[name].if ?? "", name).toMatch(/github\.event_name == 'schedule'/);
    }
  });

  it("queues the nightly run behind a push instead of cancelling it (M1)", () => {
    const concurrency = (workflow as unknown as { concurrency: { "cancel-in-progress": string } })
      .concurrency;
    expect(concurrency["cancel-in-progress"]).toContain("github.event_name != 'schedule'");
  });

  it("smokes the live Supabase backend, not Base44's", () => {
    // The live Base44 block left with base44-contract.spec.ts (2026-10-18), so
    // only the live Supabase probes (supabase-live.spec.ts) run against
    // production, and nothing asks for a Base44 app id.
    const smoke = stepsOf(workflow.jobs.smoke).find((s) => s.name === "Smoke the deployment");
    expect(smoke?.env?.E2E_LIVE_API_URL).toBe("${{ vars.PRODUCTION_URL }}");
    expect(smoke?.env).not.toHaveProperty("E2E_LIVE_APP_ID");
    const e2e = readdirSync(join(REPO_ROOT, "e2e/api")).map((f) => readFileSync(join(REPO_ROOT, "e2e/api", f), "utf8"));
    for (const spec of e2e) expect(spec).not.toContain("E2E_LIVE_APP_ID");
  });

  it("observes the lead the smoke's form posts on submit-lead, the one function both builds use", () => {
    // It used to ask, through E2E_LEAD_FUNCTIONS, whether the deployment posted
    // to Base44's submitLead or Supabase's submit-lead. Both the e2e build and
    // production post to submit-lead now, so nothing asks.
    const smoke = stepsOf(workflow.jobs.smoke).find((s) => s.name === "Smoke the deployment");
    expect(smoke?.env).not.toHaveProperty("E2E_LEAD_FUNCTIONS");
    const spec = readFileSync(join(REPO_ROOT, "e2e/api/backend-contract.spec.ts"), "utf8");
    expect(spec).toContain('mockApi.waitForRequest("/functions/v1/submit-lead")');
    const fixture = readFileSync(join(REPO_ROOT, "e2e/fixtures/app.ts"), "utf8");
    expect(fixture).not.toContain("E2E_LEAD_FUNCTIONS");
    // Stubbed against a deployment too: the smoke files no real lead.
    expect(fixture).toMatch(/url\.pathname\.startsWith\("\/functions\/v1\/"\)/);
  });

  it("builds the e2e matrix from the plan job rather than hard-coding it", () => {
    const matrix = workflow.jobs["test-e2e"].strategy?.matrix;
    expect(String(matrix?.include)).toContain("needs.plan.outputs.matrix");
    expect(needsOf(workflow.jobs["test-e2e"])).toContain("plan");
  });

  it("covers every Playwright project in the full matrix", () => {
    // A project added to playwright.config.ts that nobody lists here would
    // simply never run in CI, and nothing else would say so.
    const config = readFileSync(join(REPO_ROOT, "playwright.config.ts"), "utf8");
    const declared = [...config.matchAll(/^\s{6}name:\s*"([a-z-]+)"/gm)].map((m) => m[1]);
    expect(declared.length, "found no Playwright projects to compare against").toBeGreaterThan(1);

    const planStep = stepsOf(workflow.jobs.plan)
      .map((s) => String((s as { run?: string }).run ?? ""))
      .join("\n");
    for (const project of declared) {
      expect(planStep, `playwright project "${project}" is in no CI matrix`).toContain(project);
    }
  });

  it("selects projects explicitly in every e2e entry point", () => {
    // Only web-chromium is `default`; the rest run only when selected. A bare
    // `playwright test` behind an npm script or run-tests.sh would quietly
    // drop WebKit, iOS and Android from a run that promises all four.
    const config = readFileSync(join(REPO_ROOT, "playwright.config.ts"), "utf8");
    const declared = [...config.matchAll(/^\s{6}name:\s*"([a-z-]+)"/gm)].map((m) => m[1]);
    expect(declared.length, "found no Playwright projects to compare against").toBeGreaterThan(1);

    const scripts: Record<string, string> = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")).scripts;
    const e2e = Object.entries(scripts).filter(([, cmd]) => /^playwright test\b/.test(cmd));
    expect(e2e.length, "found no `playwright test` npm scripts").toBeGreaterThan(1);
    for (const [name, cmd] of e2e) {
      const picked = [...cmd.matchAll(/--project=(?:'([^']+)'|(\S+))/g)].map((m) => m[1] ?? m[2]);
      expect(picked.length, `npm script "${name}" selects no project`).toBeGreaterThan(0);
      for (const p of picked) {
        if (p !== "*") expect(declared, `npm script "${name}" names unknown project "${p}"`).toContain(p);
      }
    }

    // Code, not comments: the usage block at the top mentions --project= too.
    const sh = readFileSync(join(REPO_ROOT, "scripts/run-tests.sh"), "utf8")
      .split("\n")
      .filter((l) => !/^\s*#/.test(l))
      .join("\n");
    expect(sh).toMatch(/^\s*E2E_PROJECTS=\("--project=\*"\)/m);
    expect(sh).toMatch(/npx playwright test \\\n\s*\$\{E2E_PROJECTS\[@\]/);
  });

  it("shuffles the e2e order on the nightly run only", () => {
    // PRs keep the fixed order, so a red PR is about the change, not the dice.
    const run = stepsOf(workflow.jobs["test-e2e"]).find((s) => s.name === "Run e2e suite");
    const cmd = String((run as { run?: string } | undefined)?.run ?? "");
    expect(cmd).toMatch(/github\.event_name == 'schedule' && format\('--shuffle=\{0\}', github\.run_id\)/);
    expect(cmd.replace(/\$\{\{[\s\S]*?\}\}/g, "")).not.toContain("--shuffle");
  });

  it("keeps the report deploy off feature branches while still building it", () => {
    // The job runs everywhere — a red feature-branch run is worth reading —
    // but a repository has one Pages site, so only main/builder may publish.
    expect(workflow.jobs.allure.if?.trim()).toBe("always()");
    const cf = stepsOf(workflow.jobs.allure).find((s) => s.id === "cf");
    expect(cf, "the Cloudflare credential gate is missing").toBeTruthy();
    expect(cf!.if ?? "").toMatch(/refs\/heads\/main/);
  });
});

describe("articles are prebuilt from the right list", () => {
  type Step = { name?: string; env?: Record<string, string>; run?: string };
  const step = (job: string, name: string) =>
    (stepsOf(workflow.jobs[job]) as Step[]).find((s) => s.name === name);

  it("requires the article list in a production build, and only there (CTR-REB-003)", () => {
    // A production build that cannot list the articles must fail rather than
    // ship a blog without pages; a preview may warn and go on.
    expect(step("deploy-vercel", "Build for Vercel")?.env?.PRERENDER_REQUIRED).toBe(
      "${{ steps.target.outputs.env == 'production' && '1' || '0' }}",
    );
  });

  it("prebuilds the e2e fixture article in the tested build and nowhere else (CTR-REB-004)", () => {
    // The fixture lives in e2e/build-env.ts, which only `npm run build:e2e` applies.
    const buildEnv = readFileSync(join(REPO_ROOT, "e2e/build-env.ts"), "utf8");
    expect(buildEnv).toMatch(/PRERENDER_ARTICLES_FIXTURE: E2E_ARTICLES_FIXTURE/);
    expect(buildEnv).toContain('E2E_ARTICLES_FIXTURE = "e2e/fixtures/prerender-articles.json"');
    const scripts: Record<string, string> = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")).scripts;
    expect(scripts["build:e2e"]).toBe("node scripts/build-e2e.mjs");
    expect(readFileSync(join(REPO_ROOT, "scripts/build-e2e.mjs"), "utf8")).toMatch(/process\.env\.VERCEL === '1' \|\| process\.env\.VERCEL_ENV/);

    expect(step("build", "Build")?.run).toBe("npm run build:e2e");
    // Not workflow-wide, and in no step but the build job's Build: the e2e
    // bundle is the artifact the shards test and nothing else.
    for (const marker of ["PRERENDER_ARTICLES_FIXTURE", "build:e2e"]) {
      expect(JSON.stringify(workflow.env ?? {}), "workflow-level env").not.toContain(marker);
      for (const s of stepsOf(workflow.jobs.build) as Step[]) {
        if (s.name === "Build") continue;
        expect(JSON.stringify(s), `build job step "${s.name}"`).not.toContain(marker);
      }
      for (const [name, job] of jobs) {
        if (name === "build") continue;
        expect(JSON.stringify(job), `${name} must not build the e2e bundle`).not.toContain(marker);
      }
      expect(JSON.stringify(step("deploy-vercel", "Build for Vercel"))).not.toContain(marker);
      expect(readFileSync(join(REPO_ROOT, "vercel.json"), "utf8")).not.toContain(marker);
    }
  });

  it("checks that a production deployment still serves /blog its own page (CTR-REB-005)", () => {
    // `blog.html` and the `blog/` directory of articles sit side by side.
    expect(step("deploy-vercel", "Verify the deployment serves the app")?.run ?? "").toContain(
      'vercel curl "$URL/blog"',
    );
  });
});

describe("publishing an article rebuilds the site (CTR-REB-002)", () => {
  const publish = parse(readFileSync(join(REPO_ROOT, ".github/workflows/publish-blog.yml"), "utf8")) as {
    jobs: {
      publish: {
        permissions?: Record<string, string>;
        steps: Array<{ name?: string; if?: string; env?: Record<string, string>; run?: string }>;
      };
    };
  };
  const job = publish.jobs.publish;
  const last = job.steps[job.steps.length - 1];

  it("ends by dispatching a production deploy of main with the workflow's own token", () => {
    expect(last.run).toMatch(/gh workflow run ci\.yml --ref main -f deploy=true/);
    expect(last.env?.GH_TOKEN).toBe("${{ github.token }}");
  });

  it("may dispatch workflows, and still only read the code", () => {
    expect(job.permissions).toEqual({ contents: "read", actions: "write" });
  });

  it("dispatches only after a real publish", () => {
    expect(last.if).toContain("inputs.apply");
    expect(last.if).toContain("steps.supabase-creds.outputs.ready == 'true'");
  });

  it("sends an input the CI workflow declares", () => {
    const dispatch = (workflow.on as { workflow_dispatch: { inputs: Record<string, { type: string }> } })
      .workflow_dispatch;
    expect(dispatch.inputs.deploy.type).toBe("boolean");
  });
});

describe("Playwright's OS packages come from a cache, not the Ubuntu mirror each time", () => {
  // 2026-10-26: a slow mirror cancelled e2e shards mid `install-deps` twice,
  // and main deployed as a preview both times. .github/actions/playwright-browser
  // caches the .deb files per runner image.
  const action = parse(
    readFileSync(join(REPO_ROOT, ".github/actions/playwright-browser/action.yml"), "utf8"),
  ) as { runs: { using: string; steps: Array<{ name?: string; id?: string; uses?: string; run?: string; with?: Record<string, string> }> } };
  const installer = action.runs.steps.find((s) => s.name === "Install the browser's OS packages");

  it("leaves no job installing them straight from the mirror", () => {
    for (const [name, job] of jobs) {
      for (const step of stepsOf(job)) {
        expect(step.run ?? "", `${name}: ${step.name ?? step.run}`).not.toMatch(/--with-deps|install-deps/);
      }
    }
  });

  it("runs the action in every job that drives a browser", () => {
    for (const name of ["build", "test-e2e", "smoke"]) {
      const uses = stepsOf(workflow.jobs[name]).map((s) => s.uses);
      expect(uses, name).toContain("./.github/actions/playwright-browser");
    }
  });

  it("keys the package cache on the runner image and installs it with --no-download", () => {
    expect(action.runs.using).toBe("composite");
    const debs = action.runs.steps.find((s) => s.id === "deb-cache");
    expect(debs?.with?.key).toContain("${{ steps.image.outputs.id }}");
    expect(installer?.run).toContain("apt-get install -y --no-install-recommends --no-download");
  });

  it("bounds the mirror fallback and never caches a half-fetched set", () => {
    expect(installer?.run).toContain('timeout --kill-after=10 "$limit" npx playwright install-deps');
    expect(installer?.run).toContain('for attempt in 1 2; do');
    expect(installer?.run).toContain("echo 120 || echo 180");
    // the retry leaves the Azure mirror that stalled
    expect(installer?.run).toContain("s#http://azure\\.archive\\.ubuntu\\.com#http://archive.ubuntu.com#g");
    expect(installer?.run).toMatch(/rm -rf "\$debs"\n\s+echo "::error::/);
    expect(installer?.run).toContain('touch "$debs/.complete"');
  });
});
