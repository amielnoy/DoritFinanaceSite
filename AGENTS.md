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
- `supabase/migrations/20261006000000_personal_area.sql`: `enquiries_for` is the
  only door to a visitor's own data (service_role only, exactly 11 columns). Add a
  column to it deliberately, never by opening `leads`. The revokes name `anon` and
  `authenticated` because Supabase's default privileges grant EXECUTE to them by
  name; a bare `from public` leaves the functions open.
- `base44/functions/myAccount`: the same rule on the Base44 side. It requires a
  verified, enabled caller, matches on the verified email (`lower(trim)`), and
  filters the columns again through `VISIBLE`. Answers carry a `rid`, never an
  error message. `src/pages/Account.tsx` reads through `AccountPort`, one adapter
  per sign-in.
- `src/lib/interview-handoff.ts`: **the page sends the interview's close, not
  the agent.** Base44 does not execute an agent's tool calls in an anonymous
  conversation, and every visitor is anonymous — so the agent ends with a fenced
  ```lead``` block and `AgentChat` submits it through `submitInterview`. Same
  backend function, same validation; only the caller differs. A workaround for a
  platform defect, meant to be removed — see A-59, and do not "tidy" it away by
  putting the final `submitLead` back in the agent's instructions.
- `base44/agents/*.jsonc`: agent definitions — prompts, tools, model, memory,
  and `allow_anonymous_access`. **`base44 deploy` ships these; narrower
  commands do not.** CI's publish runs `base44 deploy --yes --build`, and its log
  lists `4 agents` — confirmed 2026-10-06 by pulling the live definitions, which
  matched the repo. A site-only or functions-only deploy, or a Builder publish,
  leaves them as they were; outside CI, `npx base44 agents push --yes` is the
  agent-only step, a full sync that deletes any remote agent absent here. A
  release that skips the agents looks exactly like nothing being wrong — see
  A-42 in `tests/test-plan/10-known-issues.md`. To check what is live, pull into a
  scratch worktree, never this checkout (README, "Which releases ship the
  agents"). The whole non-prompt surface is
  pinned by `toEqual` against a literal, because a Builder regeneration writes
  the file wholesale and buries behavioural flags in escaped Hebrew.
- **The event sheet is 19 columns, and the last six are the interview's.** Its
  answers used to be flattened into one `תקציר` cell, so the sheet could display
  them and nothing else — it could not be asked who wants a clearinghouse pull,
  or which interviews finished. The four asked in every interview have columns;
  track-specific fields stay in the summary, because a column filled in a third
  of rows is worse than prose. New columns go at the **end**, and a writer that
  has nothing for them sends empty strings rather than a shorter row — a short
  row slides every later column under the wrong heading. Two traps live here:
  `valueInputOption=USER_ENTERED` stores `0549988754` as a number unless the
  cell is prefixed, and the timestamp must be Israel wall-clock, not UTC, in a
  sheet read in Israel.
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
- **Every answer carries `rid`, and no answer carries an error message.** The
  id names every log line the request produced, so a visitor can quote it and
  one search finds everything. It was generated, stamped on every log line and
  then dropped — which is why diagnosing meant inferring from timestamps and
  absences, and why the one genuine outage here took three days. `error.message`
  used to be returned as `error` or `details`: it told the visitor nothing they
  could use and told anyone reading it the shape of our internals. Log the
  message, return the id. `contentAdmin` does this through a `json()` helper, so
  it cannot be forgotten; that shape is the one to copy when the others are next
  touched.
- `src/services/base44/invoke.ts`: **call a backend function through
  `invokeFunction`, never by casting `functions.invoke`.** The SDK builds its
  functions client with `interceptResponses: false`, so `invoke` resolves to the
  whole axios response and the body is its `data`. Reading `.ok` off the wrapper
  finds nothing — which is how every interview the page closed, and every
  handoff that reached Dorit, told the visitor it had failed while the logs read
  `warnings: 0`. Fakes that return a bare body hide it; give a new adapter test
  the `{ data, status, headers }` shape. See A-67.
- **A time a person reads is Israel time.** The functions run in UTC, and
  `toLocaleString("he-IL")` takes its zone from the runtime, so every stamp in a
  mail was three hours early. Name `timeZone: 'Asia/Jerusalem'` on every date a
  function formats; `function-clock.contract.test.ts` fails on one that does
  not. See A-63.
- **Who she is: "דורית גוב ארי — מתכננת פיננסית וסוכנת ביטוח".** An individual
  agent — not a company and not an agency, so no "בע״מ", no ח.פ, and visitor
  copy names her rather than "הסוכנות". `LICENCE.entity` in
  `src/config/compliance.ts` is the source the notices interpolate; changing it
  changes what a visitor consents under, so it bumps `CONSENT_VERSION`. The
  same string is spelled out in the legal pages, `index.html` JSON-LD,
  `llms.txt`, every article's disclosure, the agents' instructions (escaped) and
  `public/poa.html`. See A-66.
- `scripts/*.mjs`: maintenance jobs CI runs on a schedule. `prune-vercel-deployments.mjs`
  deletes, so it is a dry run unless given `--apply` — check its output before
  adding the flag. `reconcile-stores.mjs` exits non-zero on drift.
  `seed-blog.mjs --apply` writes `content/blog/` to Base44 through `base44 exec
  --privileged --data-env prod` (the CLI's signed-in owner, no password) and
  mirrors each post to Supabase on `base44_id`; it needs `SUPABASE_URL` and
  `SUPABASE_SERVICE_ROLE_KEY` in `.env.local` and never changes `published` on a
  post that exists. See A-65.
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
