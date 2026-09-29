// Delete preview deployments that nobody is going to open again.
//
// Vercel keeps every preview forever. Most of them were a branch that merged
// months ago, and the only cost of keeping them is that the deployments list
// stops being readable — the one you actually want is on page nine. This runs
// on the nightly schedule and removes previews older than a month.
//
// Three things it will not delete, in order of how badly it would hurt:
//
//   1. Anything that is not a preview. `target=preview` is on the API query,
//      so production deployments are never in the candidate set at all — the
//      guarantee is structural rather than a filter someone has to remember.
//      `isEligible` refuses them a second time, so widening that query later
//      cannot quietly turn this into a production reaper.
//   2. Anything still carrying an alias. A preview someone aliased is a
//      preview someone is using; the alias is the evidence. This costs one
//      extra request per candidate and is worth it.
//   3. Anything inside the age window, boundary included.
//
// It deletes nothing without `--apply`. Run bare to see what would go.
//
// The predicate is exported and unit-tested in tests/unit/prune-vercel.test.ts;
// everything else here is paging and HTTP.

const API = "https://api.vercel.com";

const token = process.env.VERCEL_TOKEN?.trim();
const slug = process.env.VERCEL_SCOPE?.trim();
const project = process.env.VERCEL_PROJECT_NAME?.trim();
const maxAgeDays = Number(process.env.MAX_AGE_DAYS || 30);
const apply = process.argv.includes("--apply");

/**
 * Whether a deployment may be deleted, and if not, which rule spared it.
 *
 * Pure on purpose: `aliases` is supplied by the caller rather than fetched
 * here, so the rule can be tested without a network or a clock.
 *
 * @param {{target: string|null, created: number, aliases: unknown[]}} d
 * @param {{now: number, maxAgeDays: number}} opts
 * @returns {{ok: true} | {ok: false, reason: "not-preview"|"aliased"|"too-new"}}
 */
export function isEligible(d, { now, maxAgeDays }) {
  if (d.target !== "preview") return { ok: false, reason: "not-preview" };
  if ((d.aliases?.length ?? 0) > 0) return { ok: false, reason: "aliased" };
  // `<=` keeps the boundary: a deployment aged exactly the limit is not
  // *older* than it, which is what the job name promises.
  if (now - d.created <= maxAgeDays * 24 * 60 * 60 * 1000) {
    return { ok: false, reason: "too-new" };
  }
  return { ok: true };
}

/** One request, with the team slug attached and failures named by status. */
async function api(path, { method = "GET" } = {}) {
  const url = new URL(path, API);
  if (slug) url.searchParams.set("slug", slug);
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    // Never echo the body: it can carry the token back in an error envelope.
    throw new Error(`${method} ${url.pathname} failed: HTTP ${res.status}`);
  }
  return res.json();
}

/** Every preview created before `until`, oldest pages last. */
async function* oldPreviews(projectId, until) {
  let cursor = until;
  while (cursor) {
    const qs = new URLSearchParams({
      projectId,
      target: "preview",
      limit: "100",
      until: String(cursor),
    });
    const page = await api(`/v7/deployments?${qs}`);
    for (const d of page.deployments ?? []) yield d;
    // `pagination.next` is the `until` for the following page, and null at the
    // end. Without advancing it this loop would re-read page one forever.
    cursor = page.pagination?.next ?? null;
  }
}

async function main() {
  if (!token || !slug || !project) {
    console.log(
      "::notice::VERCEL_TOKEN, VERCEL_SCOPE or VERCEL_PROJECT_NAME unset — skipping the Vercel prune.",
    );
    return 0;
  }

  const now = Date.now();
  const cutoff = now - maxAgeDays * 24 * 60 * 60 * 1000;
  const { id: projectId } = await api(`/v9/projects/${encodeURIComponent(project)}`);

  let deleted = 0;
  let kept = 0;
  let failed = 0;

  for await (const d of oldPreviews(projectId, cutoff)) {
    const { aliases = [] } = await api(`/v2/deployments/${d.uid}/aliases`);
    const verdict = isEligible({ ...d, aliases }, { now, maxAgeDays });
    const age = Math.floor((now - d.created) / (24 * 60 * 60 * 1000));

    if (!verdict.ok) {
      kept += 1;
      console.log(`kept    ${d.url} (${age}d, ${verdict.reason})`);
      continue;
    }

    if (!apply) {
      console.log(`would delete ${d.url} (${age}d)`);
      deleted += 1;
      continue;
    }

    try {
      await api(`/v13/deployments/${d.uid}`, { method: "DELETE" });
      deleted += 1;
      console.log(`deleted ${d.url} (${age}d)`);
    } catch (e) {
      // One bad deployment must not decide the fate of the rest, and a
      // cleanup job has no business turning main red. Visible, not fatal.
      failed += 1;
      console.log(`::warning::could not delete ${d.url}: ${e.message}`);
    }
  }

  const verb = apply ? "deleted" : "would delete";
  console.log(`::notice::prune: ${verb} ${deleted}, kept ${kept}, failed ${failed}.`);
  return 0;
}

// Only when run directly, so importing the predicate for tests costs nothing.
if (import.meta.url === `file://${process.argv[1]}`) {
  main()
    .then((code) => process.exit(code))
    .catch((e) => {
      // Reaching here means the run did no work at all — a dead token, a
      // renamed project. That is worth a red job, unlike a single failed
      // delete: nothing was cleaned and nobody would otherwise find out.
      console.log(`::error::prune failed before it could start: ${e.message}`);
      process.exit(1);
    });
}
