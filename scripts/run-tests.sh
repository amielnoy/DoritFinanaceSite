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
    # The app id has to be set on the *build*, not on the preview server.
    # Vite inlines `import.meta.env.VITE_BASE44_APP_ID` into the bundle, so a
    # value handed to `vite preview` arrives after the only moment it could
    # have been read. playwright.config.ts sets it on its own webServer — which
    # covers the case where that server runs the build — but this branch builds
    # first and then sets SKIP_BUILD=1, and used to leave the id unset: every
    # form in the bundle under test posted to `/api/apps/undefined/...`. The
    # suite passed anyway, because e2e/fixtures/app.ts stubs `**/api/**` and
    # never looks at the app id, so the run proved nothing about the one path a
    # visitor actually takes.
    export VITE_BASE44_APP_ID="${VITE_BASE44_APP_ID:-e2e-sanity-app}"
    run_suite "build" npm run build
    # Built here; tell the preview server not to build it again.
    export SKIP_BUILD=1
  fi
  run_suite "e2e (web + iOS + Android)" npx playwright test "${EXTRA_ARGS[@]}"
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
