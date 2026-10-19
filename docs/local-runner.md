# The local test runner

A page on your own machine for running the test suites, watching them live and
reading failures, including failures from GitHub Actions, a history of past runs
and an analysis of a failure by Claude. It runs the same commands as
`npm run test:all`, so a result here matches a result in the terminal.

The code is in [`scripts/local-runner/`](../scripts/local-runner/): `server.mjs`
(a Node server with no dependencies) and `index.html` (the page). See the
[documentation index](README.md) for the rest of the test guidance.

---

## Starting it

```bash
npm run test:runner
```

Open <http://127.0.0.1:4400>. Stop it with Ctrl+C; a run in progress is stopped
first, together with its browsers and the `vite preview` server.

| Setting | Default | Purpose |
| --- | --- | --- |
| `LOCAL_RUNNER_PORT` | `4400` | The port the page is served on |

Requirements:

- Node **22.6 or newer** for the e2e suite. The e2e build imports `.ts` files
  directly, which older Node versions cannot do.
- Node **22.13 or newer** for the run history, which uses Node's built-in SQLite.
  On an older Node the runner works and the History card says history is off.
- `npm ci` and `npx playwright install` already run, as for any test run.
- The [Claude Code](https://claude.com/claude-code) CLI on your `PATH`, signed in,
  only for failure analysis.
- The [GitHub CLI](https://cli.github.com) (`gh`), signed in with `gh auth login`,
  only for CI runs.

---

## Running suites

The **Suites** card runs `scripts/run-tests.sh` with the suites you select: lint,
typecheck, unit, component, contract, integration, security and e2e. With none
selected, every suite runs.

**Extra flags** are passed through to the script, for example
`--project=ios-safari` or `--grep="home page"`. Write a flag's value with `=`;
`--project ios-safari` is refused, because the script would not read it as a
project.

**Stop** ends the whole run, including Playwright's browsers. If the run had built
the e2e bundle, `dist/` is removed.

## Running a single test

The **Single test** card lists every test file under `e2e/` and `tests/`, grouped
by folder. Filter the list, pick a file, set the options and click
**Run Single Test**. **Refresh test list** picks up files added since the page
loaded.

Files under `e2e/` run with Playwright, and every option applies. Files under
`tests/` run with Vitest; the options Vitest has no equivalent for are disabled.

| Option | Playwright | Vitest |
| --- | --- | --- |
| Debug (Inspector), Headed, UI mode | `--debug`, `--headed`, `--ui` | not available |
| List only | `--list` | `vitest list` |
| Trace | `--trace` | not available |
| Reporter | `--reporter=<choice>,allure-playwright` | not available |
| Project | `--project` | not available |
| Workers, Repeat each | `--workers`, `--repeat-each` | not available |
| Retries | `--retries` | `--retry` |
| Timeout (ms) | `--timeout` | `--testTimeout` |
| Max failures | `--max-failures` | `--bail` |
| Shard (n/m) | `--shard` | `--shard` |
| Grep | `--grep` | `--testNamePattern` |
| Grep invert | `--grep-invert` | not available |

The exact command is printed at the top of the output. A single e2e run builds the
e2e bundle itself, and `dist/` is removed when the run ends.

## Reading the results

Results come from `allure-results/`, which both Vitest and Playwright write to.
Each run starts with it emptied.

- **Summary**: pass rate, status, elapsed time and counts. A suite that failed
  before writing any test result, such as a type error or a failed build, is still
  counted, with its error lines taken from the output.
- **Suite cards**: the status and duration of each suite.
- **Live output**: everything the run prints.
- **Failures**: one card per failed test, with screenshots when there are any.
- **All results**: every test, filterable by status, searchable, slowest first.

Click a failure or a result to see the error, the stack trace and the evidence:
screenshots, video, and the Playwright trace to download. Open a trace with
`npx playwright show-trace <file>`.

## CI runs

The **CI runs** card lists the last 50 runs of the `ci.yml` workflow on GitHub
Actions, with their result, time, title and trigger (PR or push). Click a run to
see its failures.

- Test failures come from the run's `allure-results-*` artifacts, which the
  Vitest job and every e2e shard upload. They open in the same window as a local
  failure, with screenshots, video and the trace when the test recorded them.
- A failed job gets a card of its own, with the end of its log up to the error.
  This is how a failure that wrote no test results shows up, such as a lint
  error, a failed build or the Allure job running out of memory.
- Artifacts are kept for seven days, so an older run shows its failed jobs but
  not its test results.
- A completed run's results are downloaded once and kept in the system temp
  folder (`dorit-local-runner-ci`), separately for each attempt, so a re-run is
  downloaded again. A run still in progress is downloaded again each time it is
  opened, so new results appear as its jobs finish.

**Analyze with Claude** works on CI failures too. Claude reads the code as it is
in your checkout, which may differ from the commit the run tested.

## History

Every run is saved when it finishes, whether it passed, failed or was stopped.
The **History** card lists the last 100, newest first, with their result, start
time, target (the suites or the file) and failed tests out of those that ran.
Click a run to see its command, counts, duration and failures.

- The database is `.local-runner/history.db` in the repository, a SQLite file
  that git ignores. Delete the folder to clear the history.
- A run keeps its failed tests (name, error and stack trace) and the last
  200,000 characters of its output. A run that failed before reporting any test,
  such as a type error, shows the error lines from that output instead.
- Screenshots, video and traces are not kept: the next run empties
  `allure-results/`, where they live.
- **Analyze with Claude** works on saved failures too.

## Failure analysis with Claude

In the window of a failed test, **Analyze with Claude** asks Claude for the likely
cause and a fix. The answer has three parts: Cause (including whether the bug is
in the test or in the application), Evidence (with file and line references) and
Fix.

- The server runs the `claude` CLI in the repository with the test's name, file,
  error and the end of its output. Claude reads the test and the code it covers
  before answering.
- It can only read files (`Read`, `Grep` and `Glob`). It cannot change anything or
  run commands.
- An analysis usually takes under a minute, and is stopped after five.
- It runs under your own Claude account and counts towards your usage. No API key
  is needed.

---

## Safety

The server is meant for one person on their own machine.

- It listens on `127.0.0.1` only, and refuses requests whose `Host` is not
  `127.0.0.1` or `localhost` on its port, which blocks DNS rebinding.
- Requests that start or stop a run must be JSON, which a form on another site
  cannot send.
- Commands are started without a shell, and every option is checked against a list
  or a pattern before it is passed on. A single test must be one of the listed
  files.
- Only one run at a time; a second Run gets "A run is already in progress".

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| The page says "Server offline" | The server is not running. Start it with `npm run test:runner`. |
| The e2e build fails on `.ts` imports | Node is older than 22.6. Run `nvm install 22 && nvm use 22`. |
| e2e fails with the port already in use | A `vite preview` from an earlier run is still alive. Find it with `lsof -i :4173` and stop it. |
| "Could not start the GitHub CLI" | Install it with `brew install gh` and run `gh auth login`. |
| "Could not start the claude CLI" | Install Claude Code, sign in, and make sure `claude` is on the `PATH` of the terminal that started the runner. |
| "Run history is off" | Node is older than 22.13. Run `nvm install 22 && nvm use 22`. |
| The analysis times out | Run it again; a very long output can make it slow. |
