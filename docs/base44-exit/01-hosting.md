# Step 1 — hosting → Vercel: what is ready, and what is not

Probed 2026-10-05 against both live copies. Nothing was changed. Statuses
re-measured 2026-10-12; the 2026-10-05 measurements are kept below as history.

The runbook is already in `README.md` under *Moving production to the custom
domain*, and the repo side is already written and inert. This records which of
its steps are actually done, measured rather than assumed — and one finding that
was not known when the step was planned.

---

## State of the five steps

| README step | State | Who |
|---|---|---|
| 0 · only CI promotes production | **confirmed** (2026-10-12) — the last six pushes to `main` each made exactly one production deployment, source `cli` | — |
| 1 · point DNS at Vercel | **done** (2026-10-11) — DTNT applied the records; apex `200`, `www` `308` to it, valid certificates | — |
| 2 · production out from behind login | **done** — the Vercel production URL answers `200` anonymously | — |
| 3 · the site answers, including `/api/*` | **verified** on `govari-fin.co.il` (2026-10-12): `submitLead` returns its own `400` guard | — |
| 4 · set `VITE_SITE_URL` in both builders | **Vercel done** (2026-10-11); **Base44 open** — its copy still names itself in JSON-LD and robots.txt | you |

### What was measured on 2026-10-05

```
dorit-finance-site.vercel.app/            200   cache-control: no-cache
govari-fin.co.il                          ENOTFOUND
www.govari-fin.co.il                      ENOTFOUND
vercel /api/apps/<id>/functions/submitLead  400 {"error":"נדרשים שם וטלפון"}
```

That `400` is the good answer: it is `submitLead`'s own guard rejecting a body
with no name and no phone. The rewrite forwarded the request to Base44 and the
backend replied. **Step 3 is proven** — the only thing left for it is the domain.

At the time, `VITE_SITE_URL` being unset was right. The Vercel copy declared
`safe-arch-plan.base44.app` as canonical, which was true while Base44 was
production and kept the two copies from competing. It was set *last*, per the
runbook, because a sitemap advertising a host that does not resolve is worse
than one pointing at the old site. It has been set on Vercel since 2026-10-11.

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

So production on 2026-10-05 was the copy that is bad for search, and the staging
copy was the good one. Since 2026-10-11 the prerendered Vercel copy is production. Moving hosting does not merely fix the cache headers; it is the
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

Applied by DTNT on 2026-10-11, so the `ENOTFOUND` measurement above no longer
holds. Both hosts resolve to Vercel and serve valid Let's Encrypt certificates.
The apex answers `200`, and `www` answers `308` to it.

**The two oddities on the Vercel project were removed on 2026-10-12:**

- `mail.govari-fin.co.il` was meant for Resend sending, not for the website. It
  never resolved, and Resend's records (`resend._domainkey.mail`, `send.mail`)
  live in DTNT's DNS, so detaching it from the project changed nothing for mail.
- `dorit-govari-fin.co.il` was never registered. Dorit had asked DTNT for
  `govari.co.il` and `dorit-govari.co.il`, which are separate domains and still
  open: `dorit-govari.co.il` does not exist, and `govari.co.il` is registered
  but on Cloudflare nameservers, not DTNT's.

---

## What only you can do

1. ~~**Confirm in the Vercel dashboard** that a push to `main` produces exactly one
   deployment, and that it is the workflow's.~~ Confirmed 2026-10-12 from the
   deployment list.
2. ~~**Add `govari-fin.co.il` and `www` to the Vercel project** and set the records
   at the registrar.~~ Done 2026-10-11.
3. **Set `VITE_SITE_URL`** to the canonical origin, in **both** builders: the
   Vercel project's Production scope and Base44's app settings. The Vercel half
   is done. The Base44 half is still open: it is the one that is easy to forget,
   and without it the copy Base44 keeps serving goes on declaring itself canonical
   and competes with the real site. It is set in the Base44 dashboard only, then
   Publish.

Everything in the repo is done; only the Base44 setting remains.

---

## What this step does not move

The backend. `/api/*` still rewrites to `safe-arch-plan.base44.app`, and a
contract case pins that it should — it names where the backend lives, which is
not the canonical host. Functions, entities, agents and connectors all stay
where they are.

That is the point of doing this one first: it is the only step that changes
nothing about how the application works, and it closes two defects that have
each already cost something.
