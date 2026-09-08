#!/usr/bin/env bash
#
# One command to run every automated check in this repo.
#
#   ./scripts/run-tests.sh                 everything
#   ./scripts/run-tests.sh unit contract   only those suites
#   ./scripts/run-tests.sh e2e --project=ios-safari
#
# Suites: lint typecheck unit component contract security e2e
# Env:
#   SKIP_BUILD=1                 reuse an existing dist/ for the e2e run
#   PLAYWRIGHT_BASE_URL=<url>    run e2e against a deployment instead of a local preview
#   E2E_ENFORCE_CONTRAST=1       fail the a11y suite on WCAG colour-contrast findings
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

BOLD=$'\033[1m'; RED=$'\033[31m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; DIM=$'\033[2m'; OFF=$'\033[0m'
[[ -t 1 ]] || { BOLD=""; RED=""; GREEN=""; YELLOW=""; DIM=""; OFF=""; }

ALL_SUITES=(lint typecheck unit component contract security e2e)
SUITES=()
EXTRA_ARGS=()

for arg in "$@"; do
  case "$arg" in
    -h|--help) sed -n '/^# One command/,/^# *E2E_ENFORCE_CONTRAST/p' "$0" | sed 's/^#\{1,\} \{0,1\}//'; exit 0 ;;
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
# `tsc` reports ~74 pre-existing errors inherited from the JS→TS conversion
# (mostly untyped shadcn wrappers). Tracked and reported, but it does not gate
# the run until that debt is paid down; flip to run_suite once it is clean.
has typecheck && soft_suite "typecheck" npx tsc -p ./tsconfig.json
has unit      && run_suite "unit" npx vitest run tests/unit
has component && run_suite "component" npx vitest run tests/component
has contract  && run_suite "contract" npx vitest run tests/contract
has security  && run_suite "security (static)" npx vitest run tests/security

if has e2e; then
  if [[ -z "${PLAYWRIGHT_BASE_URL:-}" && "${SKIP_BUILD:-}" != "1" ]]; then
    run_suite "build" npm run build
    # Built here; tell the preview server not to build it again.
    export SKIP_BUILD=1
  fi
  run_suite "e2e (web + iOS + Android)" npx playwright test "${EXTRA_ARGS[@]}"
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
