# Step 1 — hosting → Vercel: what is ready, and what is not

Probed 2026-10-05 against both live copies. Nothing was changed.

The runbook is already in `README.md` under *Moving production to the custom
domain*, and the repo side is already written and inert. This records which of
its steps are actually done, measured rather than assumed — and one finding that
was not known when the step was planned.

---

## State of the five steps

| README step | State | Who |
|---|---|---|
| 0 · only CI promotes production | `vercel.json` sets `git.deploymentEnabled.main: false`; needs one dashboard confirmation | you |
| 1 · point DNS at Vercel | **half done** (2026-10-06) — both domains are added and verified in Vercel; the DNS records are requested from DTNT and not yet applied, so the names still do not resolve | DTNT |
| 2 · production out from behind login | **done** — the Vercel production URL answers `200` anonymously | — |
| 3 · the site answers, including `/api/*` | **verified** on `dorit-finance-site.vercel.app` | — |
| 4 · set `VITE_SITE_URL` in both builders | **not done**, correctly — see below | you |

### What was measured

```
dorit-finance-site.vercel.app/            200   cache-control: no-cache
govari-fin.co.il                          ENOTFOUND
www.govari-fin.co.il                      ENOTFOUND
vercel /api/apps/<id>/functions/submitLead  400 {"error":"נדרשים שם וטלפון"}
```

That `400` is the good answer: it is `submitLead`'s own guard rejecting a body
with no name and no phone. The rewrite forwarded the request to Base44 and the
backend replied. **Step 3 is proven** — the only thing left for it is the domain.

`VITE_SITE_URL` being unset is right for today. The Vercel copy declares
`safe-arch-plan.base44.app` as canonical, which is true while Base44 is
production and keeps the two copies from competing. It is set *last*, per the
runbook, because a sitemap advertising a host that does not resolve is worse
than one pointing at the old site.

---

## The finding that was not known when this step was planned

Step 1 was justified by A-57: Base44 serves `index.html` with no
`Cache-Control`, no `ETag` and no `Last-Modified`, offers no way to configure
them, and a device can therefore pin itself to an old build indefinitely. That
cost a day.

There is a second reason, and it is worse. **The host serving production is the
one that does not prerender.**

| | Base44 (production) | Vercel |
|---|---|---|
| HTML served | 25,708 bytes | 109,870 bytes |
| `rel="canonical"` | `rel="canonical"/` — **no href** | `href="https://safe-arch-plan.base44.app/"` |
| `og:url` | `property="og:url"/` — **no content** | filled |
| `<h1>` in the HTML | absent | present |
| JSON-LD `url` | correct | correct |

Base44 runs `npm run build`; Vercel runs `npm run build:prerender`. `applySeo`
fills the canonical tag and `og:url` in the browser — for the audience that did
not need them. A crawler that does not run JavaScript is served an **empty
canonical element and no content at all**.

The two JSON-LD blocks are correct in both, because the build plugin rewrites
static files. It is exactly the two tags that are patched at runtime which are
empty in the document.

So production today is the copy that is bad for search, and the staging copy is
the good one. Moving hosting does not merely fix the cache headers; it is the
difference between a crawler seeing a page and seeing a shell.

### Why not simply prerender on Base44

`base44/config.jsonc` sets `buildCommand: "npm run build"`. Changing it to
`build:prerender` would need Chromium in Base44's build environment —
`scripts/prerender.mjs` launches Playwright and fails loudly without it.

That puts a browser install in front of the production publish, which is the
gate the whole pipeline depends on, for a host we intend to leave. Not worth it.
The fix is step 1.

---

## Step 1, as of 2026-10-06

The Vercel side is done: `govari-fin.co.il` and `www.govari-fin.co.il` are added
to the project and verified. The apex is canonical and `www` answers `308` to it.

The registrar side is not. DTNT (the registrar, ticket 84851895) was asked on
2026-10-06 to add:

```
A      @    216.198.79.1
A      @    64.29.17.1
CNAME  www  30fa16059da418c7.vercel-dns-017.com.
```

Not yet applied, so the measurement above (`ENOTFOUND`) still stands. Re-run it
once DTNT confirms, and only then move to step 2's check and step 4.

**Two oddities on the Vercel project to resolve:**

- `mail.govari-fin.co.il` is attached to it. It was meant for Resend sending, not
  for the website; a web project should not answer on a mail subdomain, and the
  Resend records belong at the registrar, not here.
- `dorit-govari-fin.co.il` is attached to it. Dorit asked DTNT for `govari.co.il`
  and `dorit-govari.co.il`, and neither is registered, so this is not a domain
  she asked for. Find out where it came from before keeping it.

---

## What only you can do

1. **Confirm in the Vercel dashboard** that a push to `main` produces exactly one
   deployment, and that it is the workflow's. `vercel.json` already disables the
   Git integration for `main` and `builder`; this is confirming it took effect.
2. **Add `govari-fin.co.il` and `www` to the Vercel project** and set the records
   at the registrar. (Added and verified on 2026-10-06; the records are with DTNT,
   see above.) The domain exists — it has MX records pointing at Microsoft
   365 — so this is adding web records beside mail, not registering anything.
   Wait for both to resolve.
3. **Set `VITE_SITE_URL`** to the canonical origin, in **both** builders: the
   Vercel project's Production scope and Base44's app settings. The second half
   is the one that is easy to forget, and without it the copy Base44 keeps
   serving goes on declaring itself canonical and competes with the real site.

Everything in the repo is done and waits for those.

---

## What this step does not move

The backend. `/api/*` still rewrites to `safe-arch-plan.base44.app`, and a
contract case pins that it should — it names where the backend lives, which is
not the canonical host. Functions, entities, agents and connectors all stay
where they are.

That is the point of doing this one first: it is the only step that changes
nothing about how the application works, and it closes two defects that have
each already cost something.
