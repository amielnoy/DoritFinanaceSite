# AGENTS.md

## Project Context

This is a Base44 app repository. Treat it as user-owned application code, keep changes focused on the user's request, and preserve existing project conventions.

Start with `README.md` for local setup, environment variables, and publish workflow.

## Base44 References

- CLI overview: https://docs.base44.com/developers/references/cli/get-started/overview.md
- Agent skills: https://docs.base44.com/developers/backend/overview/skills.md

If your agent supports Agent Skills, install or update Base44 skills before Base44-specific work:

```bash
npx skills add base44/skills
```

## Key Files

- `src/`: frontend application source.
- `src/api/base44Client.js`: frontend Base44 SDK client.
- `base44/functions/*/entry.ts`: backend functions. Isolated entry points with no
  shared module, so some helpers are duplicated by hand — `redact`, `escapeHtml`,
  `buildClientHtml`, `SHEET_COLUMNS`, `appendEventRow`, `NOTIFY_EMAILS`, `wallClock`,
  `upstreamReasons`, and in the two calendar writers `CALENDARS`,
  `CALENDAR_PROVIDERS` and `CALENDAR_ATTENDEES`. Duplicated is fine; drifted is not, and
  `tests/contract/agents.contract.test.ts` fails when copies stop matching.
  Every one of these drifts silently, and two have already cost something:
  `NOTIFY_EMAILS` is the easiest to get wrong, because a mailbox added to one
  function and not another raises no error anywhere — the mail simply reaches
  one fewer person, and escalations are where that costs most. `wallClock` is
  the one that did: the copy that kept `new Date(x).toISOString()` filed every
  agreed meeting three hours late, in the only diary anyone reads.
  `CALENDAR_ATTENDEES` must list every address that receives the enquiry by
  mail — `NOTIFY_EMAILS` plus `SECONDARY_EMAIL` — and not one address more.
  It left Dorit out for eleven days on the theory that she owned the `outlook`
  connector and was therefore the organiser; `amielnoy@outlook.com` owned it,
  the event went to his diary, and hers stayed empty while both logs read
  `calendar.created`. See A-54. Who owns an external account is not a fact this
  repository can assert or test — check it against the account.
- `base44/agents/*.jsonc`: agent definitions — prompts, tools, model, memory,
  and `allow_anonymous_access`. **A publish does not ship these.**
  `npx base44 agents push --yes` does, as a full sync that deletes any remote
  agent absent here. A change under this directory is a two-step release, and
  forgetting the second step looks exactly like nothing being wrong — see A-42
  in `tests/test-plan/10-known-issues.md`. The whole non-prompt surface is
  pinned by `toEqual` against a literal, because a Builder regeneration writes
  the file wholesale and buries behavioural flags in escaped Hebrew.
- `dorit-mailer/functions/api/send-email.js`: the Cloudflare Pages Function every
  outbound message goes through. The Resend key, the sender and the recipient
  list live in the Pages project's environment, not here — that is why the
  service exists. The sender must be on the Resend-verified subdomain; the apex
  `govari-fin.co.il` is Microsoft 365 with an SPF that ends `-all`, so mail from
  it is rejected.
- `src/pages/{Login,Register,ForgotPassword,ResetPassword,OAuthConsent}.jsx` and
  `src/components/{AuthLayout,GoogleIcon}.jsx`: **the platform's, not ours. Do not
  delete them.** Base44 restores these whenever the app environment starts, and
  support have confirmed there is no setting to stop it. They were deleted five
  times; the fifth went unnoticed and left `main` red for two days, which gated
  the publish and stranded every change merged behind it. They are inert because
  `resolve.extensions` in `vite.config.js` puts `.ts`/`.tsx` first, so the real
  pages — `Login.tsx` and the rest — are what load. Lint ignores them and the
  contract suite allows their shadow; `PLATFORM_AUTH_PAGES` in
  `tests/contract/frontend-payloads.contract.test.ts` is the list, and a case
  there fails if it and the eslint ignores drift apart. See A-52.
- `scripts/*.mjs`: maintenance jobs CI runs on a schedule. `prune-vercel-deployments.mjs`
  deletes, so it is a dry run unless given `--apply` — check its output before
  adding the flag. `reconcile-stores.mjs` exits non-zero on drift.
- `vite.config.js`: Vite config and Base44 Vite plugin setup.
- `.env.local`: local-only environment values; never commit secrets.
- `tests/test-plan/`: the test plan and one Software Test Description per suite.
  Update the relevant STD when you add or change tests.

## Working Notes

- Use `base44 dev` as the default local development command when you need the local Base44 backend. It can run the backend and frontend together.
- When docs or code mention the frontend being started automatically, that usually means the Base44 project config includes `site.serveCommand`, for example `"serveCommand": "npm run dev"` in `base44/config.jsonc`.
- Use `npm run dev` only for frontend-only work against the hosted Base44 backend.
- Prefer the existing Base44 CLI workflow over adding new npm scripts for Base44-specific tasks.
- Reuse the existing SDK client and Vite plugin patterns before adding new Base44 integration paths.
- Run the relevant checks from `package.json` before finishing code changes:
  `npm run lint`, `npm run typecheck`, `npm run test:vitest`, and
  `npm run test:e2e` (or `./scripts/run-tests.sh` for everything with a summary).
- Anchors like `#about` name sections that exist **only on the home page**, while
  the header and footer render on every route. Use `useSectionNav` and give the
  anchor a real `/#section` href — a bare `#section` is inert off the home page
  and fails silently.
