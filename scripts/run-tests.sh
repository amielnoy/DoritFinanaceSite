#!/usr/bin/env bash
#
# One command to run every automated check in this repo.
#
#   ./scripts/run-tests.sh                 everything
#   ./scripts/run-tests.sh unit contract   only those suites
#   ./scripts/run-tests.sh e2e --project=ios-safari
#   ./scripts/run-tests.sh --report        open the Allure report when done
#
# Suites: lint typecheck unit component contract integration security e2e
# Env:
#   SKIP_BUILD=1                 reuse an existing dist/ for the e2e run
#   PLAYWRIGHT_BASE_URL=<url>    run e2e against a deployment instead of a local preview
#   E2E_ENFORCE_CONTRAST=1       fail the a11y suite on WCAG colour-contrast findings
#   KEEP_ALLURE_RESULTS=1        keep allure-results from earlier runs instead of
#                                clearing it first (it is cleared by default: the
#                                reporters only append, and a large one both skews
#                                the report and stalls the vitest reporter)
#   NO_REPORT=1                  skip generating the Allure report entirely
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

BOLD=$'\033[1m'; RED=$'\033[31m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; DIM=$'\033[2m'; OFF=$'\033[0m'
[[ -t 1 ]] || { BOLD=""; RED=""; GREEN=""; YELLOW=""; DIM=""; OFF=""; }

ALL_SUITES=(lint typecheck unit component contract integration security e2e)
SUITES=()
EXTRA_ARGS=()
OPEN_REPORT=0

for arg in "$@"; do
  case "$arg" in
    -h|--help) sed -n '/^# One command/,/^# *NO_REPORT/p' "$0" | sed 's/^#\{1,\} \{0,1\}//'; exit 0 ;;
    --report) OPEN_REPORT=1 ;;
    -*) EXTRA_ARGS+=("$arg") ;;
    *)
      if [[ " ${ALL_SUITES[*]} " == *" $arg "* ]]; then
        SUITES+=("$arg")
      else
        echo "${RED}Unknown suite '$arg'${OFF}. Available: ${ALL_SUITES[*]}" >&2
        exit 2
      fi
      ;;
  esac
done
[[ ${#SUITES[@]} -gt 0 ]] || SUITES=("${ALL_SUITES[@]}")

mkdir -p test-results

# Start each run from an empty allure-results.
#
# Nothing used to clear it, and both reporters only ever append: every vitest
# test and every Playwright test writes a fresh result file (plus attachments)
# on every run, under a new UUID each time. Nothing collides, so nothing is ever
# overwritten — the directory only grows.
#
# Two things break once it is large enough. The report is generated from
# whatever is in here, so it stops describing this run and starts describing
# every run ever made — the same test appearing hundreds of times, old failures
# sitting next to their fixes. And the allure-vitest reporter's end-of-run pass
# over the directory goes pathological: at ~65k+ entries a 30-second suite hung
# for 25 minutes with every worker idle, after the tests themselves had already
# passed. That reads exactly like a hung test suite, which is the expensive part
# — the failure is in the reporter, long after the last assertion.
#
# CI never saw it: a fresh checkout starts empty every time. It is purely a
# local accumulation, so the fix belongs here, at the top of a local run.
# KEEP_ALLURE_RESULTS=1 opts out, for merging a run into an existing set.
if [[ "${KEEP_ALLURE_RESULTS:-}" != "1" ]]; then
  rm -rf allure-results
fi
mkdir -p allure-results

STARTED_AT=$(date +%s)
declare -a RESULTS=()
FAILED=0

# run_suite <name> <cmd...>          — a failure fails the run
# soft_suite <name> <cmd...>         — a failure is reported but does not fail the run
run_suite() {
  local name="$1"; shift
  local start; start=$(date +%s)

  printf '\n%s┌─ %s %s%s\n' "$BOLD" "$name" "$DIM" "$*$OFF"
  if "$@"; then
    local dur=$(( $(date +%s) - start ))
    printf '%s└─ %s passed%s %s(%ss)%s\n' "$GREEN" "$name" "$OFF" "$DIM" "$dur" "$OFF"
    RESULTS+=("${GREEN}PASS${OFF}  ${name} (${dur}s)")
  else
    local code=$? dur=$(( $(date +%s) - start ))
    printf '%s└─ %s FAILED (exit %s)%s %s(%ss)%s\n' "$RED" "$name" "$code" "$OFF" "$DIM" "$dur" "$OFF"
    RESULTS+=("${RED}FAIL${OFF}  ${name} (${dur}s)")
    FAILED=1
  fi
}

has() { [[ " ${SUITES[*]} " == *" $1 "* ]]; }

soft_suite() {
  local name="$1"; shift
  local start; start=$(date +%s)

  printf '\n%s┌─ %s %s%s\n' "$BOLD" "$name" "$DIM" "$*$OFF"
  if "$@"; then
    local dur=$(( $(date +%s) - start ))
    printf '%s└─ %s passed%s\n' "$GREEN" "$name" "$OFF"
    RESULTS+=("${GREEN}PASS${OFF}  ${name} (${dur}s)")
  else
    local dur=$(( $(date +%s) - start ))
    printf '%s└─ %s has known failures (not blocking)%s\n' "$YELLOW" "$name" "$OFF"
    RESULTS+=("${YELLOW}WARN${OFF}  ${name} (${dur}s) — pre-existing, not blocking")
  fi
}

has lint      && run_suite "lint" npx eslint . --quiet
# `tsc` is blocking on zero errors. The ratchet that used to allow for the
# inherited set (tests/typecheck-baseline.json) went with the errors it held.
has typecheck && run_suite "typecheck" npm run typecheck
has unit      && run_suite "unit" npx vitest run tests/unit
has component && run_suite "component" npx vitest run tests/component
has contract  && run_suite "contract" npx vitest run tests/contract
# Runs the Base44 functions for real, against a recording client. Nothing
# else executes them: they sit outside tsconfig and run on Deno in production.
has integration && run_suite "integration" npx vitest run tests/integration
has security  && run_suite "security (static)" npx vitest run tests/security

if has e2e; then
  if [[ -z "${PLAYWRIGHT_BASE_URL:-}" && "${SKIP_BUILD:-}" != "1" ]]; then
    # The environment has to be set on the *build*, not on the preview server:
    # Vite inlines `import.meta.env.*` into the bundle, so a value handed to
    # `vite preview` — or to `playwright test` — arrives after the only moment
    # it could have been read. This branch builds first and then sets
    # SKIP_BUILD=1, and used to export its own copy of the variables here; it
    # once left the app id out, and every form in the bundle under test posted
    # to `/api/apps/undefined/...` while the suite stayed green.
    #
    # `build:e2e` builds with e2e/build-env.ts — production's provider switches,
    # pointed at a Supabase host only e2e/fixtures/app.ts answers — the same
    # file playwright.config.ts and CI's build job use, so there is one copy.
    #
    # `build:prerender` underneath, not `build`. This once built the client
    # shell and then set SKIP_BUILD=1, so playwright.config.ts skipped its own
    # prerender and the suite was pointed at a dist/ with no prerendered routes
    # at all. Every case in e2e/seo/prerender.spec.ts then failed — each route
    # served the shell's title, no route had its own canonical, and the FAQPage
    # markup was absent — reporting a regression in the thing it exists to
    # protect while the actual build pipeline was fine.
    run_suite "build" npm run build:e2e
    # Built here; tell the preview server not to build it again.
    export SKIP_BUILD=1
    # And remember that what is now in dist/ is wired to a backend that does
    # not exist, so it can be thrown away below.
    BUILT_SENTINEL_DIST=1
  fi
  # playwright.config.ts marks every project but web-chromium `default: false`,
  # so a bare `playwright test` would quietly drop to one browser. `*` selects
  # every project, default or not — unless the caller chose with --project=,
  # which must narrow, not add (Playwright unions repeated --project flags).
  E2E_PROJECTS=("--project=*")
  # `${a[@]+"${a[@]}"}`: an empty array under `set -u` is "unbound" to bash 3.2.
  for arg in ${EXTRA_ARGS[@]+"${EXTRA_ARGS[@]}"}; do
    if [[ "$arg" == --project=* ]]; then E2E_PROJECTS=(); fi
  done
  run_suite "e2e (web + iOS + Android)" npx playwright test \
    ${E2E_PROJECTS[@]+"${E2E_PROJECTS[@]}"} ${EXTRA_ARGS[@]+"${EXTRA_ARGS[@]}"}
  # The bundle just tested has the fake Supabase host inlined — Vite
  # seals it in at build time. dist/ is also what `vite
  # preview` serves, so leaving it here hands the next person a site whose every
  # backend call fails,
  # reported on screen as the same "try again" line a real outage produces.
  # Keeping it saves one rebuild and costs an afternoon.
  if [[ "${BUILT_SENTINEL_DIST:-}" == "1" ]]; then
    rm -rf dist
  fi
fi

# ── Allure report ───────────────────────────────────────────────────────────
# Generated whenever the e2e suite ran, because a run you cannot read is a run
# you will re-run.
#
# Allure 3 inlines the whole report into one self-contained index.html, so —
# unlike Allure 2, which fetched thousands of JSON files over XHR and showed an
# empty shell when opened from disk — you can just open the file. `--report`
# still serves it on localhost, which is the nicer way to click through a
# failure rather than file it away.
#
# Skipped in CI, where the workflow attaches the same file to the run as an
# artifact instead of publishing it anywhere.
if has e2e && [[ "${NO_REPORT:-}" != "1" && -z "${CI:-}" ]]; then
  if [[ -d allure-results && -n "$(ls -A allure-results 2>/dev/null)" ]]; then
    if npm run --silent allure:generate >/dev/null 2>&1; then
      printf '\n%sAllure report%s generated at %sallure-report/index.html%s\n' "$BOLD" "$OFF" "$DIM" "$OFF"
      if [[ $OPEN_REPORT -eq 1 ]]; then
        printf '  serving on localhost — %sCtrl-C to stop the server%s\n' "$DIM" "$OFF"
        npx allure open allure-report
      else
        printf '  open the file, or serve it: %snpm run allure:open%s   (or re-run with %s--report%s)\n' \
          "$YELLOW" "$OFF" "$YELLOW" "$OFF"
      fi
    else
      printf '\n%sAllure report could not be generated%s\n' "$YELLOW" "$OFF"
    fi
  fi
fi

printf '\n%s%s%s\n' "$BOLD" "── summary ─────────────────────────────" "$OFF"
for line in "${RESULTS[@]}"; do printf '  %b\n' "$line"; done
printf '  %stotal %ss%s\n' "$DIM" "$(( $(date +%s) - STARTED_AT ))" "$OFF"

if [[ $FAILED -eq 0 ]]; then
  printf '\n%sAll suites passed.%s\n' "$GREEN" "$OFF"
else
  printf '\n%sSome suites failed.%s Playwright report: %snpx playwright show-report%s\n' "$RED" "$OFF" "$YELLOW" "$OFF"
fi
exit $FAILED
