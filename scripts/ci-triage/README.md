# CI failure triage (AI)

When a test job fails, the `triage` job in `.github/workflows/ci.yml` runs Claude Code headless
against the merged Allure results. It labels each group of failures as one of:

| Category | Meaning | Owner |
|---|---|---|
| `PRODUCT_BUG` | The site or production code is wrong, and the test is right | app code |
| `AUTOMATION_BUG` | The test is wrong: locators, timing, outdated assertions | test code |
| `CONFIGURATION_BUG` | CI, environment, dependencies or setup are wrong | CI / config |
| `NEEDS_HUMAN` | The evidence conflicts, or confidence is below 0.6 | — |

The write-up lands in the run summary and in the "Safe to merge?" PR comment. It is also kept as
the `failure-triage` artifact (`triage.md` and `triage.json`). It is advisory only: it never
changes the colour of a run.

## Files

- `allure_triage_mcp.py` is a read-only MCP server over `allure-results/`, the Allure 3 history
  (`allure-history/history.jsonl`) and `git diff`. Its tools are `get_run_overview`,
  `list_failure_clusters`, `get_failure_details`, `read_attachment`, `get_test_history`,
  `get_changed_files` and `get_file_diff`.
- `triage-prompt.md` is the agent's instructions and output format. Edit this file to change how
  failures are judged.

## Turning it on

Add an `ANTHROPIC_API_KEY` repository secret. Without the secret, the job posts a notice and
stays green. Fork PRs get no secrets, so they get no triage.

## Running it locally

Run this after a failing `npm run test:e2e`, which leaves `allure-results/` behind:

```bash
pip install "mcp>=1.2,<2"
cat > /tmp/mcp.json <<JSON
{"mcpServers":{"allure_triage":{"command":"python3","args":["$PWD/scripts/ci-triage/allure_triage_mcp.py"],
 "env":{"ALLURE_RESULTS_DIR":"$PWD/allure-results","ALLURE_HISTORY_FILE":"$PWD/allure-history/history.jsonl","TRIAGE_BASE_REF":"origin/main"}}}}
JSON
claude -p "$(cat scripts/ci-triage/triage-prompt.md)" --mcp-config /tmp/mcp.json --strict-mcp-config \
  --allowedTools mcp__allure_triage
```

`allure-results/` accumulates across local runs unless you clear it. Clear it first, or the
triage reads old failures.

## Safety

The agent may call the MCP tools and nothing else: no shell, no file edits, no web access. Test
output is untrusted, and a failing test could print text written to look like instructions.
Attachment reads are restricted to `allure-results/`.
