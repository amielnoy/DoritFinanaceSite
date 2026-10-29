# Leaving Base44 — the record

**Done, 2026-10-29:** the exit is complete. [B1 (#312)](https://github.com/amielnoy/DoritFinanaceSite/pull/312)
moved the site onto Supabase alone (no SDK, switches or `/api` rewrite), and B2
(branch `chore/base44-exit-b2`) removed the `base44/` folder, its repair scripts,
agent skills and tests. The account actions left are in
[current architecture and operations](../current-state.md#after-the-exit-dashboard-actions).

**Current status, 2026-10-17:** these are dated migration measurements. See
[current architecture and operations](../current-state.md) for implemented adapters,
release gates and rollback switches. Production hosting has moved to Vercel; auth,
the chat agents and the other services have moved to Supabase. Cleanup 1 (#262)
stopped every publish to Base44; cleanup 2, on or after 2026-10-29, removes the
Base44 code. Live flags and applied migrations still require verification in their
accounts.

Not a decision, a measurement. Each document here was written by probing the
live system rather than reasoning about it, and each says plainly what it could
not establish.

| | |
|---|---|
| [`00-inventory.md`](00-inventory.md) | What Base44 actually holds: 47 rows, nine ports, `Deno.env.get` as the whole runtime surface — and §8, which is the one worth reading twice. |
| [`01-hosting.md`](01-hosting.md) | Step 1 measured: two of five runbook steps already done, and a second reason to do it that was not known when it was planned. |

## The shape of the argument

Most of what Base44 has cost is **invisibility rather than breakage**. It does
something unexpected and offers no way to see it, so each one costs a day of
inference from absent logs rather than an hour of reading an error.

A-59 — agent tools not executed for anonymous visitors, with no record of the
refusal anywhere. A-57 — `index.html` served with no cache validators and no way
to set them. A-61 — the agent socket answered with the website. A-50/51/52 — the
Builder re-creating files over ours. A-42 — an agent release that omitted the definitions (CI then shipped them with
`base44 deploy --yes --build`, until it stopped publishing to Base44). And the publish that stores a new function while the old one
goes on answering.

That is the thing being weighed, more than any single outage.

## Order

Steps 1 and 3 carry most of the value for a tenth of the effort. Step 5 is the
expensive one and the only one that addresses what actually hurt, so it is worth
doing and worth doing last.

The original sequencing depended on an A-59 support response. Subsequent work
implemented the page-side handoff and the Supabase chat transport; use the
[current guide](../current-state.md) rather than this historical dependency as
a blocker for work already implemented.
