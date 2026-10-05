# Leaving Base44 — the record

Not a decision, a measurement. Each document here was written by probing the
live system rather than reasoning about it, and each says plainly what it could
not establish.

| | |
|---|---|
| [`00-inventory.md`](00-inventory.md) | What Base44 actually holds: 47 rows, eight ports, `Deno.env.get` as the whole runtime surface — and §8, which is the one worth reading twice. |
| [`01-hosting.md`](01-hosting.md) | Step 1 measured: two of five runbook steps already done, and a second reason to do it that was not known when it was planned. |

## The shape of the argument

Most of what Base44 has cost is **invisibility rather than breakage**. It does
something unexpected and offers no way to see it, so each one costs a day of
inference from absent logs rather than an hour of reading an error.

A-59 — agent tools not executed for anonymous visitors, with no record of the
refusal anywhere. A-57 — `index.html` served with no cache validators and no way
to set them. A-61 — the agent socket answered with the website. A-50/51/52 — the
Builder re-creating files over ours. A-42 — agents needing a second release step
CI cannot perform. And the publish that stores a new function while the old one
goes on answering.

That is the thing being weighed, more than any single outage.

## Order

Steps 1 and 3 carry most of the value for a tenth of the effort. Step 5 is the
expensive one and the only one that addresses what actually hurt, so it is worth
doing and worth doing last.

**Nothing should start before the A-59 report is sent and answered.** If Base44
fix tool execution for anonymous conversations, the month-long step may not be
needed at all.
