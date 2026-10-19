# CI failure triage (AI)

When a test job fails, the `triage` job in `.github/workflows/ci.yml` gathers the evidence from
the merged Allure results and sends it, in one call, to a model on Groq's free plan
(`openai/gpt-oss-120b` by default). It labels each group of failures as one of:

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

- `groq_triage.py` collects the evidence (run overview, failure clusters, one representative per
  cluster with its history, changed files, and the diffs of changed files a trace names), cuts it
  to `TRIAGE_EVIDENCE_CHARS` (14,000 by default), and makes the one call. Whatever does not fit is
  named in the evidence as left out, and those clusters come back as `NEEDS_HUMAN`.
- `allure_triage_mcp.py` holds the read-only helpers over `allure-results/`, the Allure 3 history
  (`allure-history/history.jsonl`) and `git diff`. Its tools are `get_run_overview`,
  `list_failure_clusters`, `get_failure_details`, `read_attachment`, `get_test_history`,
  `get_changed_files` and `get_file_diff`.
  `groq_triage.py` imports them as plain functions. It still runs as an MCP server too, for an
  agent that can use one.
- `triage-prompt.md` is the model's instructions and output format. Edit this file to change how
  failures are judged.

### Why one call and not an agent loop

Groq's free plan allows a few thousand tokens per minute. An agent loop re-sends its whole
conversation on every tool call, so 20 to 40 turns over test output run into `429` within a
minute. Collecting the evidence first keeps a run to one request, and the model gets no tools at
all. A `429` or `5xx` is retried up to four times, waiting as long as `retry-after` says (at most
60 seconds).

## Turning it on

Create a free key at https://console.groq.com/keys and add it as the `GROQ_API_KEY` repository
secret (`gh secret set GROQ_API_KEY`). Without the secret, the job posts a notice and stays green.
Fork PRs get no secrets, so they get no triage. To try another model, set the `GROQ_MODEL`
repository variable (for example `llama-3.3-70b-versatile`).

## Running it locally

Run this after a failing `npm run test:e2e`, which leaves `allure-results/` behind:

```bash
pip install "mcp>=1.2,<2"
# See what would be sent, with no API call:
python3 scripts/ci-triage/groq_triage.py --evidence
# The real thing:
GROQ_API_KEY=gsk_... python3 scripts/ci-triage/groq_triage.py
```

`allure-results/` accumulates across local runs unless you clear it. Clear it first, or the
triage reads old failures.

## Safety

The model gets the evidence as text and has no tools: no shell, no file edits, no web access.
Test output is untrusted, and a failing test could print text written to look like instructions,
so the evidence is fenced and marked as data. The evidence leaves GitHub for Groq: test names,
error messages, stack traces and diffs, but no attachments (screenshots, logs or page dumps).
