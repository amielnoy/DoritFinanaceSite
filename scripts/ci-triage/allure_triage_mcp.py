"""
allure_triage MCP server
------------------------
Read-only MCP tools over an Allure run, used by a CI triage agent to decide
whether each failure is a PRODUCT bug, an AUTOMATION bug, or a CONFIGURATION bug.

Run (stdio):  python allure_triage_mcp.py
Requires:     pip install "mcp>=1.2,<2"

Env vars:
  ALLURE_RESULTS_DIR   raw results dir           (default: allure-results)
  ALLURE_REPORT_DIR    generated report dir      (default: allure-report)
  ALLURE_HISTORY_FILE  Allure 3 history JSONL    (default: allure-history/history.jsonl)
  TRIAGE_BASE_REF      git ref to diff against   (default: origin/main)
  TEST_PATH_REGEX      paths that are test code
  CONFIG_PATH_REGEX    paths that are CI / env / dependency config
  TRIAGE_TEXT_CAP      max chars per text field  (default: 6000)
"""
import hashlib
import json
import os
import re
import subprocess
from collections import Counter, defaultdict
from pathlib import Path

from mcp.server.fastmcp import FastMCP, Image

RESULTS = Path(os.getenv("ALLURE_RESULTS_DIR", "allure-results")).resolve()
REPORT = Path(os.getenv("ALLURE_REPORT_DIR", "allure-report")).resolve()
HISTORY_JSONL = Path(os.getenv("ALLURE_HISTORY_FILE", "allure-history/history.jsonl")).resolve()
BASE_REF = os.getenv("TRIAGE_BASE_REF", "origin/main")
TEST_PATHS = re.compile(os.getenv(
    "TEST_PATH_REGEX",
    r"(^|/)(tests?|e2e|specs?|cypress|playwright|pages|page_objects|fixtures|support|features|steps)/"))
CONFIG_PATHS = re.compile(os.getenv(
    "CONFIG_PATH_REGEX",
    r"(^\.github/|docker|compose|\.env|(^|/)config/|\.ya?ml$|package(-lock)?\.json$|"
    r"pnpm-lock|yarn\.lock|requirements.*\.txt$|pyproject\.toml$|pom\.xml$|build\.gradle|playwright\.config|"
    r"cypress\.config|jest\.config|pytest\.ini|conftest\.py$)"))
CAP = int(os.getenv("TRIAGE_TEXT_CAP", "6000"))
SAFE_NAME = re.compile(r"^[\w.-]+$")
TEXT_EXT = {".txt", ".log", ".json", ".xml", ".html", ".csv", ".yaml", ".yml", ".har"}
IMAGE_EXT = {".png", ".jpg", ".jpeg"}

# Regex hints. They are evidence for the model, never the verdict on their own.
SIGNALS = {
    "configuration": [
        r"ECONNREFUSED|Connection refused|ECONNRESET|ENOTFOUND|getaddrinfo|Name or service not known|UnknownHost",
        r"certificate|SSL|CERT_|self[- ]signed",
        r"401 Unauthorized|403 Forbidden|invalid.{0,20}(token|credential|api.?key)|authentication failed",
        r"environment variable|KeyError: '[A-Z0-9_]+'|is not set|undefined env|Missing required",
        r"Executable doesn't exist|browserType\.launch|SessionNotCreated|chromedriver|geckodriver|version mismatch",
        r"No space left|Out of memory|OOMKilled|ENOMEM",
        r"502 Bad Gateway|503 Service Unavailable|504 Gateway",
        r"database.{0,30}(unavailable|refused|does not exist)|relation .* does not exist|migration",
    ],
    "automation": [
        r"NoSuchElement|StaleElement|ElementNotInteractable|ElementClickIntercepted",
        r"waiting for (locator|selector)|locator\.\w+: Timeout|strict mode violation|element is not (visible|attached|stable)",
        r"cy\.(get|find|contains)\(\) .*never found|Timed out retrying|Unable to find (an? )?(element|role|label)",
        r"NullPointerException|TypeError: Cannot read propert|undefined is not|AttributeError|IndexError",
        r"fixture '.*' not found|ReferenceError|SyntaxError|ImportError|ModuleNotFoundError",
    ],
    "product": [
        r"AssertionError|AssertError|expected .{0,80} (to (equal|be|contain|have)|but (was|got))|Expected:|Received:",
        r"500 Internal Server Error|status(Code)? (code )?:?\s*500|\"status\":\s*500",
        r"Unhandled exception|Traceback .* in (app|src|server)/",
    ],
}
SIGNAL_RX = {k: [re.compile(p, re.I) for p in v] for k, v in SIGNALS.items()}

_NORM = [
    (re.compile(r"\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b", re.I), "<uuid>"),
    (re.compile(r"0x[0-9a-f]+", re.I), "<hex>"),
    (re.compile(r"(['\"`]).{0,200}?\1"), "<str>"),
    (re.compile(r"\d+(\.\d+)?"), "<n>"),
    (re.compile(r"\s+"), " "),
]

mcp = FastMCP("allure_triage")


# ---------- helpers ----------
def _cap(s, n=CAP):
    s = s or ""
    return s if len(s) <= n else s[:n] + f"\n...[truncated {len(s) - n} chars]"


def _read_json(p: Path):
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError, UnicodeDecodeError):
        return None


_CACHE = {}


def _results():
    """Latest attempt per test (by historyId), with the status of every retry attached.
    Results don't change while the server runs, so they are parsed once."""
    if "results" in _CACHE:
        return _CACHE["results"]
    by_hist = defaultdict(list)
    for f in RESULTS.glob("*-result.json"):
        r = _read_json(f)
        if r:
            by_hist[r.get("historyId") or r.get("uuid")].append(r)
    final = []
    for attempts in by_hist.values():
        attempts.sort(key=lambda r: r.get("stop") or 0)
        last = attempts[-1]
        last["_attempts"] = [a.get("status") for a in attempts]
        final.append(last)
    _CACHE["results"] = final
    _CACHE["by_uuid"] = {r.get("uuid"): r for r in final}
    return final


def _failed(results):
    return [r for r in results if r.get("status") in ("failed", "broken")]


def _msg(r):
    return (r.get("statusDetails") or {}).get("message") or ""


def _trace(r):
    return (r.get("statusDetails") or {}).get("trace") or ""


def _signature(r):
    lines = _msg(r).strip().splitlines()
    head = lines[0] if lines else "<no message>"
    for rx, rep in _NORM:
        head = rx.sub(rep, head)
    return head.strip()[:200]


def _sig_id(sig):
    return hashlib.sha1(sig.encode()).hexdigest()[:10]


def _labels(r):
    out = defaultdict(list)
    for lab in r.get("labels") or []:
        out[lab.get("name")].append(lab.get("value"))
    return {k: v if len(v) > 1 else v[0] for k, v in out.items()}


def _failing_step(steps, path=()):
    for s in steps or []:
        if s.get("status") in ("failed", "broken"):
            here = path + (s.get("name"),)
            return _failing_step(s.get("steps"), here) or here
    return None


def _failed_fixtures(uuid):
    out = []
    for f in RESULTS.glob("*-container.json"):
        c = _read_json(f)
        if not c or uuid not in (c.get("children") or []):
            continue
        for phase in ("befores", "afters"):
            for fx in c.get(phase) or []:
                if fx.get("status") in ("failed", "broken"):
                    out.append({
                        "phase": "setup" if phase == "befores" else "teardown",
                        "name": fx.get("name"),
                        "message": _cap((fx.get("statusDetails") or {}).get("message"), 1500),
                    })
    return out


def _signals(text):
    hits = {}
    for cat, rxs in SIGNAL_RX.items():
        found = sorted({m.group(0)[:80] for rx in rxs for m in [rx.search(text)] if m})
        if found:
            hits[cat] = found
    return hits


def _get(uuid):
    if not SAFE_NAME.match(uuid or ""):
        return None
    _results()
    return _CACHE["by_uuid"].get(uuid) or _read_json(RESULTS / f"{uuid}-result.json")


def _props(p: Path):
    if not p.exists():
        return {}
    out = {}
    for line in p.read_text(encoding="utf-8", errors="replace").splitlines():
        if "=" in line and not line.lstrip().startswith("#"):
            k, v = line.split("=", 1)
            out[k.strip()] = v.strip()
    return out


def _git(*args):
    try:
        return subprocess.run(["git", *args], capture_output=True, text=True, timeout=30).stdout
    except (OSError, subprocess.TimeoutExpired):
        return ""


# ---------- tools ----------
@mcp.tool()
def get_run_overview() -> dict:
    """Start here. Totals, environment, and whether this looks like a mass failure
    (one error taking down most of the run usually means configuration/infra)."""
    results = _results()
    failed = _failed(results)
    status = Counter(r.get("status") for r in results)
    sigs = Counter(_signature(r) for r in failed)
    top_sig, top_n = (sigs.most_common(1) or [("", 0)])[0]
    return {
        "totals": dict(status),
        "total_tests": len(results),
        "failure_ratio": round(len(failed) / len(results), 3) if results else 0,
        "distinct_error_signatures": len(sigs),
        "mass_failure": bool(results) and (
            len(failed) / len(results) >= 0.5 or (len(failed) >= 5 and top_n / len(failed) >= 0.8)),
        "dominant_signature": {"signature": top_sig, "count": top_n} if top_n else None,
        "passed_on_retry": sum(1 for r in results if r.get("status") == "passed"
                               and any(a in ("failed", "broken") for a in r["_attempts"])),
        "environment": _props(RESULTS / "environment.properties"),
        "executor": _read_json(RESULTS / "executor.json") or {},
    }


@mcp.tool()
def list_failure_clusters(limit: int = 30) -> list[dict]:
    """Failed/broken tests grouped by normalized error signature, biggest cluster first.
    Investigate one representative per cluster instead of every test.
    status 'failed' = assertion failed; 'broken' = unexpected exception."""
    clusters = defaultdict(list)
    for r in _failed(_results()):
        clusters[_signature(r)].append(r)
    out = []
    for sig, rs in sorted(clusters.items(), key=lambda kv: -len(kv[1]))[:limit]:
        out.append({
            "cluster_id": _sig_id(sig),
            "signature": sig,
            "count": len(rs),
            "statuses": dict(Counter(r.get("status") for r in rs)),
            "flaky_in_this_run": sum(1 for r in rs if "passed" in r["_attempts"]),
            "representative_uuid": rs[0].get("uuid"),
            "uuids": [r.get("uuid") for r in rs[:20]],
            "tests": [r.get("fullName") or r.get("name") for r in rs[:10]],
            "suites": sorted({str(_labels(r).get("suite", "")) for r in rs})[:10],
        })
    return out


@mcp.tool()
def get_failure_details(uuid: str) -> dict:
    """Full evidence for one test: message, stack trace, failing step, failed setup/teardown
    fixtures, labels, parameters, retries, attachments and regex signals."""
    r = _get(uuid)
    if not r:
        return {"error": f"no result with uuid {uuid}"}
    fixtures = _failed_fixtures(r.get("uuid"))
    blob = "\n".join([_msg(r), _trace(r)] + [f["message"] for f in fixtures])
    attachments = []

    def walk(node):
        for a in node.get("attachments") or []:
            attachments.append({"name": a.get("name"), "source": a.get("source"), "type": a.get("type")})
        for s in node.get("steps") or []:
            walk(s)
    walk(r)
    return {
        "uuid": r.get("uuid"),
        "name": r.get("name"),
        "full_name": r.get("fullName"),
        "history_id": r.get("historyId"),
        "status": r.get("status"),
        "attempts": r.get("_attempts", [r.get("status")]),
        "duration_ms": (r.get("stop") or 0) - (r.get("start") or 0),
        "message": _cap(_msg(r), 3000),
        "trace": _cap(_trace(r)),
        "failing_step_path": _failing_step(r.get("steps")),
        "failed_fixtures": fixtures,
        "labels": _labels(r),
        "parameters": r.get("parameters") or [],
        "links": r.get("links") or [],
        "attachments": attachments[:30],
        "signals": _signals(blob),
    }


@mcp.tool()
def read_attachment(source: str, max_chars: int = 6000):
    """Read a text attachment (logs, HAR, API responses, page source) or view a screenshot
    by its 'source' file name from get_failure_details."""
    if not SAFE_NAME.match(source or ""):
        return {"error": "invalid attachment name"}
    p = (RESULTS / source).resolve()
    if p.parent != RESULTS or not p.exists():
        return {"error": "attachment not found"}
    ext = p.suffix.lower()
    if ext in IMAGE_EXT:
        if p.stat().st_size > 4_000_000:
            return {"error": "image too large"}
        return Image(path=str(p))
    if ext in TEXT_EXT:
        return {"source": source, "content": _cap(p.read_text(encoding="utf-8", errors="replace"),
                                                  min(max_chars, 20000))}
    return {"source": source, "note": f"binary attachment ({ext}, {p.stat().st_size} bytes) not readable"}


def _history_runs():
    """Allure 3 history: one JSON object per run, each with testResults keyed by history id.
    Falls back to Allure 2's history/history.json shape."""
    if "history" in _CACHE:
        return _CACHE["history"]
    runs = []
    if HISTORY_JSONL.exists():
        for line in HISTORY_JSONL.read_text(encoding="utf-8", errors="replace").splitlines():
            try:
                run = json.loads(line)
            except json.JSONDecodeError:
                continue
            runs.append({"timestamp": run.get("timestamp") or 0, "results": run.get("testResults") or {}})
        runs.sort(key=lambda r: r["timestamp"], reverse=True)   # newest first
        # In CI the history is restored after this run's report was generated, so it
        # already holds this run. Keep only runs that finished before it started.
        starts = [r.get("start") for r in _results() if r.get("start")]
        if starts:
            runs = [r for r in runs if r["timestamp"] < min(starts)]
    _CACHE["history"] = runs
    return runs


def _match_history(entry_map, r):
    """Allure 3 recomputes history keys, so try the raw historyId in both separators,
    then the testCaseId prefix, then fullName + project."""
    hid = r.get("historyId") or ""
    for k in (hid, hid.replace(":", "."), hid.replace(".", ":")):
        if k in entry_map:
            return entry_map[k]
    tcid = r.get("testCaseId")
    project = _labels(r).get("parentSuite")
    for k, v in entry_map.items():
        if tcid and k.split(".")[0] == tcid:
            return v
    for v in entry_map.values():
        if v.get("fullName") == r.get("fullName"):
            vp = next((lab.get("value") for lab in v.get("labels") or [] if lab.get("name") == "parentSuite"), None)
            if vp == project:
                return v
    return None


@mcp.tool()
def get_test_history(uuid: str) -> dict:
    """Pass/fail history of this test across previous runs (Allure history carried between
    runs). Flip-flopping = flaky (automation); green until now = regression."""
    r = _get(uuid)
    if not r:
        return {"error": f"no result with uuid {uuid}"}
    runs = _history_runs()
    if not runs:
        legacy = _read_json(REPORT / "history" / "history.json") or {}
        entry = legacy.get(r.get("historyId"))
        if not entry:
            return {"available": False, "note": "no Allure history for this run"}
        runs = [{"timestamp": 0, "results": {r.get("historyId"): i}} for i in entry.get("items") or []]
    items = [h for h in (_match_history(run["results"], r) for run in runs[:20]) if h]
    if not items:
        return {"available": True, "known_test": False, "runs_checked": len(runs[:20]),
                "note": "not in earlier runs: a new or renamed test"}
    statuses = [i.get("status") for i in items]
    flips = sum(1 for a, b in zip(statuses, statuses[1:]) if (a == "passed") != (b == "passed"))
    return {
        "available": True,
        "known_test": True,
        "runs_checked": len(runs[:20]),
        "recent_statuses_newest_first": statuses,
        "status_flips": flips,
        "recent_messages": sorted({_cap(i.get("message"), 200) for i in items[:5] if i.get("message")}),
    }


@mcp.tool()
def get_changed_files() -> dict:
    """Files and commits changed vs the base ref, split into test code, config/CI, and app code.
    A failure right after an app-code change points to a product bug; after a test-code change,
    to automation; after a config/dependency change, to configuration."""
    names = [n for n in _git("diff", "--name-only", f"{BASE_REF}...HEAD").splitlines() if n]
    buckets = {"test_code": [], "config": [], "app_code": []}
    for n in names:
        if TEST_PATHS.search(n):
            buckets["test_code"].append(n)
        elif CONFIG_PATHS.search(n):
            buckets["config"].append(n)
        else:
            buckets["app_code"].append(n)
    return {
        "base_ref": BASE_REF,
        **{k: v[:100] for k, v in buckets.items()},
        "commits": _cap(_git("log", "--oneline", "--no-decorate", f"{BASE_REF}..HEAD"), 3000),
    }


@mcp.tool()
def get_file_diff(path: str, max_chars: int = 5000) -> dict:
    """Unified diff of one changed file vs the base ref (e.g. a page object or endpoint the trace points at)."""
    if not path or ".." in Path(path).parts or path.startswith("-"):
        return {"error": "invalid path"}
    return {"path": path, "diff": _cap(_git("diff", f"{BASE_REF}...HEAD", "--", path), min(max_chars, 15000))}


if __name__ == "__main__":
    mcp.run()
