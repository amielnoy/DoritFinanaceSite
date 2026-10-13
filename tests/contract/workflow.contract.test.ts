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

describe("the workflow tests every branch and deploys from only two", () => {
  it("runs on a push to any branch", () => {
    expect((workflow.on as { push: { branches: string[] } }).push.branches).toEqual(["**"]);
  });

  it("does not also run the whole matrix on every push to an open PR", () => {
    // push already covers new commits; reacting to `synchronize` would double.
    const pr = (workflow.on as { pull_request: { types: string[] } }).pull_request;
    expect(pr.types).not.toContain("synchronize");
  });

  it("gates every deploying job on the ref, so a feature branch ships nothing", () => {
    for (const name of ["deploy", "deploy-vercel"]) {
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

  it("keeps the Base44 publish off the nightly run", () => {
    // Publishing Base44 ships the agents too, and the nightly run has nobody
    // watching it. A push, or a deliberate manual run, only.
    const condition = workflow.jobs.deploy.if ?? "";
    expect(condition).toMatch(/github\.event_name == 'push'/);
    expect(condition).not.toMatch(/schedule/);
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

  it("skips the agent-conversation probes on the nightly smoke (M6)", () => {
    const smoke = stepsOf(workflow.jobs.smoke).find((s) => s.name === "Smoke the deployment");
    expect(smoke?.env?.E2E_SKIP_AGENT_PROBES).toContain("github.event_name != 'schedule'");
    const spec = readFileSync(join(REPO_ROOT, "e2e/api/base44-contract.spec.ts"), "utf8");
    expect(spec).toMatch(/E2E_SKIP_AGENT_PROBES === "1"/);
  });

  it("tells the smoke which lead function the deployment posts to", () => {
    const smoke = stepsOf(workflow.jobs.smoke).find((s) => s.name === "Smoke the deployment");
    expect(smoke?.env?.E2E_LEAD_FUNCTIONS).toBe("${{ vars.LEAD_FUNCTIONS }}");
    const spec = readFileSync(join(REPO_ROOT, "e2e/api/base44-contract.spec.ts"), "utf8");
    expect(spec).toContain("LEAD_VIA_SUPABASE");
    const fixture = readFileSync(join(REPO_ROOT, "e2e/fixtures/app.ts"), "utf8");
    expect(fixture).toContain("process.env.E2E_LEAD_FUNCTIONS");
    expect(fixture).toContain("process.env.VITE_LEAD_FUNCTIONS");
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
    expect(step("build", "Build")?.env?.PRERENDER_ARTICLES_FIXTURE).toBe("e2e/fixtures/prerender-articles.json");
    // Not workflow-wide: a workflow-level env would reach every job, the Vercel build included.
    expect(JSON.stringify(workflow.env ?? {}), "workflow-level env").not.toContain("PRERENDER_ARTICLES_FIXTURE");
    // Within the build job, only the Build step carries it.
    for (const s of stepsOf(workflow.jobs.build) as Step[]) {
      if (s.name === "Build") continue;
      expect(JSON.stringify(s), `build job step "${s.name}"`).not.toContain("PRERENDER_ARTICLES_FIXTURE");
    }
    expect(JSON.stringify({ ...workflow.jobs.build, steps: undefined })).not.toContain("PRERENDER_ARTICLES_FIXTURE");
    for (const [name, job] of jobs) {
      if (name === "build") continue;
      expect(JSON.stringify(job), `${name} must not prebuild the fixture article`).not.toContain(
        "PRERENDER_ARTICLES_FIXTURE",
      );
    }
    expect(JSON.stringify(step("deploy-vercel", "Build for Vercel"))).not.toContain("PRERENDER_ARTICLES_FIXTURE");
    expect(readFileSync(join(REPO_ROOT, "vercel.json"), "utf8")).not.toContain("PRERENDER_ARTICLES_FIXTURE");
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
