# Base44 exit, cleanup 2 part B — the deletion — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove every Base44 path from the site and the repo — the SDK, its adapters and switches, its Vite plugins, the `base44/` folder and the tooling around it — so the site runs on Supabase and Vercel alone, with nothing a visitor sees changing.

**Architecture:** Two PRs, both on or after **2026-10-29** (the end of the rollback window: until then the `VITE_*` switches can still send a path back to Base44). **B1** is the runtime: the composition root wires the Supabase adapters only, the switches and the Base44 branches in the chat shell go, the SDK and its plugins leave the bundle, the `/api` rewrite and the Base44 CSP origins leave `vercel.json`. **B2** is the repo: the `base44/` folder, the in-process Base44 function harness and its tests, the repair scripts, the Base44 agent skills, and the docs. B2 needs B1 merged (several contracts read both `src/` and `base44/`).

**Tech Stack:** React 18 + Vite 8 (rolldown), Vitest 3, Playwright 1.64, Supabase Edge Functions (Deno), Vercel.

**Spec:** the cleanup-2 scope in memory `base44-cleanup-status` and `docs/base44-exit/README.md`; part A is #266 (5abc639), #267 (94ebac2), #268 (component tests on a port mock). Production switches, checked in Vercel 2026-10-17: `VITE_LEAD_FUNCTIONS`, `VITE_CONTENT_WRITES`, `VITE_UPLOAD_PROVIDER`, `VITE_CONTENT_IMAGES` = `supabase`; `VITE_CHAT_AGENTS` = all four agents. Production data holds no Base44 URLs (checked 2026-10-17, all 21 public tables and storage).

## Decisions

The three open ones, each with a recommendation. The plan below is written for the recommendation; the alternative is noted where it changes a task.

| # | Question | Finding (2026-10-18) | Recommendation |
|---|---|---|---|
| D1 | Password-reset page | `src/pages/{Login,Register,ForgotPassword,ResetPassword,OAuthConsent}.jsx` are Base44 templates **no route serves** — `/login` resolves to `Login.tsx` (`.tsx` first in `resolve.extensions`). The live sign-in has no reset link today; accounts are provisioned in the Supabase dashboard, which can send a recovery mail. | **Delete the five dead pages in B1.** A Supabase reset flow (`resetPasswordForEmail` + a `/reset-password` page on `PASSWORD_RECOVERY`) is a separate, small feature PR if wanted — not part of a deletion. |
| D2 | CI eval step | `tests/eval/{interview,procedures}-agent.eval.test.ts` drive the **Base44** agents through `@base44/sdk` (`tests/helpers/eval-conversation.ts`) and skip without `EVAL_BASE44_*`, which CI never sets — the step has never run a case. The chat function's real gate is `npm run test:eval:chat` (`scripts/eval-chat.mjs`), run by hand against the deployed function. | **Delete** the two eval files, the helper, `test:eval` and the CI step. Keep `test:eval:chat` and `tests/eval/chat/`. |
| D3 | Legacy-host code | `safe-arch-plan.base44.app` still answers 200 — but with Base44's **last published** build, frozen since publishing stopped (2026-10-17). Our repo's `legacy-host.ts` only runs in a build served on that host, and no build of ours will be again; the frozen copy carries its own. | **Delete** `src/lib/legacy-host.ts`, `legacy-host-boot.ts`, the `isLegacyHost`/`applyLegacyHostHead` parts of `seo.ts`, the boot call in `main.jsx`, and their tests. The old host stops serving when the Base44 app is deleted (your action, after part B). *Alternative: keep them; then Task 5 skips the legacy-host step.* |

Implied decisions, no input needed: the four switch modules are deleted rather than pinned to one value; `base44_id` columns, the `/blog/<24 hex>` 301s (`api/og/blog.ts`, `BlogPost.tsx`) and `BASE44_ID_PATTERN` stay — old links and indexed URLs still use them; `supabase/migrations/` is history and is not edited; `docs/base44-exit/` and dated specs/plans are history: they get a "done" note, not a rewrite.

## Global Constraints

- Nothing a visitor sees changes. Production already runs every path this plan keeps; the e2e bundle runs with production's switches (#267), so a green e2e on B1 is the proof.
- No new migration, no RLS change, no Supabase function behaviour change. Comments in `supabase/functions/` that describe Base44 history may be shortened; code there is untouched except where a task says so.
- Without Supabase credentials (a fresh checkout, vitest's pinned `VITE_SUPABASE_URL=""`) the app must still start: every port gets a stand-in that reads as empty and refuses writes with a Hebrew error, the pattern `UnconfiguredAuthService` and the inline `usersAdminPort` already use.
- Keep: `base44_id` handling, `BASE44_ID_PATTERN`, `/blog/<24 hex>` redirects, `src/lib/freshness.ts`, the `.ts`-first `resolve.extensions` (its comment loses the Builder story, the setting stays), the `@` alias, `scripts/check-production-publish.mjs` and `scripts/wait-for-deployment.mjs` (both serve the Vercel deploy; only their Base44 comments change).
- Each case ID retired from an STD is marked the way that STD already marks retirements; nothing is renumbered.
- Before each push: `npm run lint`, `npm run typecheck`, `npm run build:prerender`, the five vitest suites, and (B1) the e2e suite or CI's — capture `$?` directly in zsh.
- Commits end with the session's `Co-Authored-By` / `Claude-Session` lines; PRs are squash-merged on the user's go-ahead.

## Review Focus

1. **A build with no Supabase credentials** (fresh checkout, unit tests). Expected: the app boots, reads come back empty, a submit shows the Hebrew "no connection" error and the direct contact channels — no `TypeError` on a null client. Test in Task 1 (`services-wiring`: every port is a stand-in without a client).
2. **A lead or interview whose `submit-lead` call fails.** Before, the Base44 fallback existed only behind the switch, never as a retry; after, the visitor gets the same failure they get today. Expected: the error surfaces with the fallback contact, unchanged. Test in Task 1 (`supabase-lead`: a function error rejects with `functionFailure`'s message, no second call).
3. **An old article link `/blog/<24 hex>`** from a bookmark or search result. Expected: still a 301 to the slug. The existing `og-blog-handler` and `blog-post-redirect` cases must stay green unchanged — Task 5 lists them in its verification.
4. **A chat opened in a tab loaded before the deploy** (old chunk, Base44 branch). Expected: the stale-chunk screen and reload, as for any deploy. No new test; `freshness` covers it — do not delete `freshness.ts` with the Base44 comment in it.
5. **Something still calling `/api/<anything but og, csp-report>`** once the rewrite is gone. Expected: a 404 from Vercel, never a Base44 answer. Test in Task 4 (`vercel-functions.contract`: no rewrite targets a `base44.app` host; the e2e `/api` tripwire loses its telemetry exception and so fails any such call).

---

## PR B1 — the site runs on Supabase alone

### Task 1: The composition root wires Supabase only

**Files:**
- Modify: `src/services/composition.ts` (remove every Base44 adapter, `client`, `base44Leads`, `base44Support`, `RoutedAgentService`)
- Modify: `src/services/supabase/SupabaseLeadService.ts` (drop `rest` and `useEdge`; `submitLead`/`submitInterview` always go to `submit-lead`; `updatesInterviews` is `true`)
- Modify: `src/services/ports.ts` (remove `LeadPort.requestConsultationEvent` — no caller outside `src/services`, it reached Base44's `createConsultationEvent`; calendar holds are `submit-lead`'s since Phase 2)
- Modify: `src/services/index.ts` (drop `requestConsultationEvent`; the comment no longer names `@base44/sdk`)
- Create: `src/services/unconfigured/UnconfiguredContentService.ts`, `UnconfiguredLeadService.ts`, `UnconfiguredUploadService.ts`, `UnconfiguredSupportService.ts`, `UnconfiguredContentAdminService.ts`, `UnconfiguredLeadAdminService.ts`, `UnconfiguredAgentService.ts`
- Delete: `src/config/lead-functions.ts`, `src/config/content-writes.ts`, `src/config/upload-provider.ts`, `src/services/RoutedAgentService.ts`; in `src/config/chat-agents.ts` delete `CHAT_AGENTS`, `parseChatAgents`, `servedByChatFunction` (keep `CHAT_FUNCTION_AGENTS` only if Task 2 still reads it)
- Modify: `src/vite-env.d.ts` (remove `VITE_LEAD_FUNCTIONS`, `VITE_CONTENT_WRITES`, `VITE_UPLOAD_PROVIDER`, `VITE_CONTENT_IMAGES`, `VITE_CHAT_AGENTS`)
- Modify: `e2e/build-env.ts` (remove those five), `tests/contract/e2e-build-env.contract.test.ts` (CTR-E2E-002 pins the remaining switches only)
- Test: `tests/unit/services-wiring.test.ts` (rewrite), `tests/unit/supabase-lead.test.ts`, `tests/unit/supabase-image-upload.test.ts`
- Delete tests: `tests/unit/routed-agent.test.ts`

**Interfaces:**
- Produces: each `Unconfigured*Service` implements its port; reads resolve to `[]` / `null`, writes reject with `new Error("אין חיבור למאגר.")`, `agents.start` rejects with an `AgentUnavailableError` from `src/services/agent-errors.ts` (so the chat panel shows its existing unavailable state).
- Produces: `new SupabaseLeadService(client: SupabaseFunctionsClient)`.

- [ ] **Step 1: Rewrite `services-wiring.test.ts`** — two describes. "with a Supabase client": `services.content` is a `SupabaseContentService`, `leads` a `SupabaseLeadService`, `support` a `SupabaseSupportService`, `uploads` a `SupabaseImageUploadService`, `claimDocuments` a `SupabaseUploadService`, `contentAdmin` an `EdgeContentAdminService`, `leadsAdmin` a `SupabaseLeadAdminService`, `agents` a `SupabaseAgentService`. "without one": each is its `Unconfigured*` stand-in; `await expect(services.leads.submitLead(LEAD)).rejects.toThrow("אין חיבור למאגר.")`; `await expect(services.content.listArticles()).resolves.toEqual([])`. No `vi.doMock("@/api/base44Client")` anywhere in the file.
- [ ] **Step 2: In `supabase-lead.test.ts`** replace the `useEdge`/`rest` cases with: `submitLead` invokes `"submit-lead"` with `leadBody(lead)`; `submitInterview` invokes `"submit-lead"` with `interviewBody(summary)`; a function error rejects and `invoke` was called once; `updatesInterviews === true`.
- [ ] **Step 3: Run** `npx vitest run tests/unit/services-wiring.test.ts tests/unit/supabase-lead.test.ts` — expected FAIL (stand-ins don't exist, constructor arity).
- [ ] **Step 4: Implement** the stand-ins, the composition root and `SupabaseLeadService(client)`; delete the switch modules and `RoutedAgentService`. The composition root picks per port: `supabase ? <Supabase adapter> : <stand-in>`, nothing else.
- [ ] **Step 5: Run** the two files — PASS; then `npm run typecheck` — 0 (it finds every remaining import of a deleted module).
- [ ] **Step 6: Commit** — "Base44 exit B1, 1: the composition root wires Supabase alone; the switches go".

### Task 2: The chat shell has one backend

**Files:**
- Modify: `src/components/dorit/chat/AgentChat.tsx` — every agent is on the `chat` function: remove the Base44-only branches (the reply watchdog and its timeout copy, the fenced-block handling the function never sends, `conversationRef: base44:<id>`, the "not on the function" consent notice), and the `servedByChatFunction` checks around them.
- Modify: `src/config/compliance.ts` (the consent text for Base44-served agents and the comment at :198), `src/config/agents.ts` (comments pointing at `base44/agents/*.jsonc` → `supabase/functions/chat/prompts/*.md`), `src/pages/Blog.tsx:130` and `src/lib/blog-recommendation.ts` (a recommendation names a post by slug only — the id form came from Base44's recommender)
- Test: `tests/component/agent-no-reply-timeout.test.tsx` (retire the Base44-watchdog cases or delete the file if all are), `chat-function-*.test.tsx`, `agent-handoff-analytics.test.tsx`, `agent-mobile-sheet.test.tsx`, `blog-recommendation-chat.test.tsx`, `chat-article-links.test.tsx`, `interview-close.test.tsx`; `tests/contract/agents.contract.test.ts` describe "the chat shell enforces what a prompt cannot" (:551)
- STD: `tests/test-plan/02-std-component.md`, `03-std-contract.md`

- [ ] **Step 1:** In each listed test, delete the cases whose setup makes an agent *not* served by the function (they mock `servedByChatFunction`/`CHAT_AGENTS` to exclude it); keep every chat-function case unchanged. Record each retired case ID in STD-02.
- [ ] **Step 2: Run** `npm run test:component` — PASS before the source change (only deletions so far).
- [ ] **Step 3:** Remove the branches from `AgentChat.tsx` and the files above. A recommendation block with a 24-hex id no longer matches a card — add one case to `blog-recommendation-chat.test.tsx`: `"a recommended id that is not a slug matches nothing"`, expecting the unfiltered list.
- [ ] **Step 4: Run** `npm run test:component && npm run test:contract` — PASS.
- [ ] **Step 5: Commit** — "Base44 exit B1, 2: every agent is on the chat function; the shell's Base44 branches go".

### Task 3: The SDK and its plugins leave the bundle

**Files:**
- Delete: `src/api/base44Client.js`, `src/lib/app-params.js`, `src/lib/clear-access-token.ts` (+ its call in `src/main.jsx`), `src/services/base44/` (all nine files), `src/pages/{Login,Register,ForgotPassword,ResetPassword,OAuthConsent}.jsx` (D1), `scripts/vite-base44-backend-plugin.mjs`
- Modify: `vite.config.js` — remove `@base44/vite-plugin`, `base44Backend()`, the `vendor-base44` chunk group; the `resolve.extensions` comment keeps the A-46 reason, drops the Builder story
- Modify: `package.json` — remove `@base44/sdk`, `@base44/vite-plugin`, the `logs` script; `npm install` to update the lockfile
- Modify: `src/vite-env.d.ts` (remove `VITE_BASE44_*`), `e2e/build-env.ts` (remove `VITE_BASE44_APP_ID` / `VITE_BASE44_APP_BASE_URL`), `e2e/fixtures/app.ts` (remove the SDK-telemetry exception from the `/api` tripwire), `.github/workflows/ci.yml` (remove `VITE_BASE44_APP_ID` from `env`, the "Build the way the Base44 Builder does" step and its comment)
- Modify: the ~20 component tests that `vi.mock("@/lib/app-params", …)` — delete that line (`git grep -l 'lib/app-params' -- tests`)
- Delete tests: `tests/unit/admin-services.test.ts`, `agent-service.test.ts`, `function-content-admin.test.ts`, `function-receipts.test.ts` (Base44 adapters only — check each `describe` names a `Base44*`/`Function*` class; move any Supabase-adapter case to that adapter's own test file), `clear-access-token.dom.test.ts`, `tests/contract/base44-backend.contract.test.ts`, `sdk-version.contract.test.ts`
- Modify tests: `tests/contract/frontend-payloads.contract.test.ts` (drop the Base44 adapter sections; the "no file imports `@/api/base44Client`" scan becomes "no file imports `@base44/`"), `tests/contract/consultation-function.contract.test.ts` (retire: it pins the Base44 `createConsultationEvent` call), `tests/component/login-google.test.tsx` and `tests/security/static-security.test.ts` (references to the deleted `.jsx` pages), `tests/contract/workflow.contract.test.ts` (the Builder-build step and env cases), `tests/contract/e2e-build-env.contract.test.ts`

- [ ] **Step 1:** Add to `frontend-payloads.contract`: `it("nothing imports a Base44 package", …)` — `git ls-files src api scripts e2e` contents match no `from ["']@base44/`; and `package.json` has no `@base44/` dependency.
- [ ] **Step 2: Run** it — FAIL (the SDK is still imported).
- [ ] **Step 3:** Delete and edit the files above.
- [ ] **Step 4: Run** `npm run lint && npm run typecheck && npm run build:prerender` — 0; then `git grep -n -i -E "@base44|base44Client|app-params" -- src api scripts e2e tests vite.config.js package.json` — no output.
- [ ] **Step 5: Run** the five suites — PASS; `npm run test:e2e` (or CI) — PASS. The telemetry exception being gone means any SDK traffic now fails a test.
- [ ] **Step 6: Commit** — "Base44 exit B1, 3: the SDK, its plugins and the pages nobody routes to are gone".

### Task 4: Vercel stops pointing at Base44

**Files:**
- Modify: `vercel.json` — delete the `/api/:path*` → `https://safe-arch-plan.base44.app/api/:path*` rewrite; remove `https://safe-arch-plan.base44.app wss://safe-arch-plan.base44.app` from `connect-src` (both the enforced and report-only policies, if both list it)
- Modify: `src/components/ui/image-helpers.js` (drop the `media.base44.com` mapping), `src/components/ui/image.jsx:112` comment, `src/services/supabase/SupabaseLeadAdminService.ts:95-101` (`documentLink`: a ref without the claim-documents prefix now rejects with `"לא ניתן לפתוח את המסמך"` — no Base44 URL exists in production data), `api/csp-report.ts:15` comment
- Test: `tests/contract/vercel-functions.contract.test.ts`, `tests/contract/canonical-host.contract.test.ts`, CSP checks in `tests/security/static-security.test.ts`, `tests/unit/supabase-lead-admin.test.ts`, image-helper unit test
- STD: `03-std-contract.md`, `04-std-security.md`, `01-std-unit.md`

- [ ] **Step 1: Write the tests:** `vercel-functions.contract` — `"no rewrite or header names a base44.app host"` (`JSON.stringify(vercelJson)` does not match `/base44\.app/`); `supabase-lead-admin` — `"a document ref outside claim-documents is refused"` (`rejects.toThrow("לא ניתן לפתוח את המסמך")`, `invoke` not called).
- [ ] **Step 2: Run** them — FAIL.
- [ ] **Step 3:** Edit `vercel.json` and the files above; run `node scripts/check-csp-hashes.mjs` — 0 (no script hash changes).
- [ ] **Step 4: Run** the five suites — PASS.
- [ ] **Step 5: Commit** — "Base44 exit B1, 4: no rewrite or CSP origin points at Base44".

### Task 5: The legacy host and the Base44 evals (D3, D2)

**Files:**
- Delete (D3): `src/lib/legacy-host.ts`, `src/lib/legacy-host-boot.ts`, `tests/unit/legacy-host.test.ts`, `tests/unit/legacy-host.dom.test.ts`; modify `src/lib/seo.ts` (remove `isLegacyHost`, `applyLegacyHostHead` and the Base44-history comments; keep `SITE_URL`/`resolveSiteUrl`), `src/main.jsx` (remove `leaveLegacyHost()`), `src/vite-env.d.ts` (its env var), `tests/unit/seo-site-url.test.ts` (legacy-host cases)
- Delete (D2): `tests/eval/interview-agent.eval.test.ts`, `tests/eval/procedures-agent.eval.test.ts`, `tests/helpers/eval-conversation.ts`; `package.json` `test:eval`; the CI step "Agent evals (skipped without credentials)"; `tests/contract/agents.contract.test.ts:511` (reads the procedures eval file — repoint to `tests/eval/chat/personas.json` if the zone coverage it checks is there, else retire the case)
- STD: `00-master-test-plan.md` (the eval row), `01-std-unit.md`, `03-std-contract.md`, `14-procedures-zones.md`

- [ ] **Step 1:** Delete and edit.
- [ ] **Step 2: Verify** the article redirects are untouched: `npx vitest run tests/unit/og-blog-handler.test.ts tests/component/blog-post-redirect.test.tsx tests/unit/article-path.test.ts` — PASS, no edits to those files.
- [ ] **Step 3: Run** lint, typecheck, `build:prerender`, the five suites, e2e — all PASS.
- [ ] **Step 4: Commit** — "Base44 exit B1, 5: the legacy-host redirect and the Base44 agent evals go". Open PR B1; squash-merge on the user's go-ahead; confirm the production deploy and smoke are green.

---

## PR B2 — the `base44/` folder and its tooling

### Task 6: Contracts stop reading `base44/`

**Files (each: drop the Base44 side, keep the Supabase/`src` side):**
- `tests/contract/agents.contract.test.ts` — retire the "on-site agent definitions" describe (it parses `base44/agents/*.jsonc`: model, tools, `allow_anonymous_access`); the support/procedures/interview describes read `supabase/functions/chat/prompts/*.md` instead of the `.jsonc` instructions; "escalation reasons agree across prompt, entity and UI config" compares the prompts, `supabase/functions/escalate-to-human/escalation.js`'s reason list and `src/config/compliance.ts` (the `base44/entities` side goes)
- `article-slug.contract.test.ts` — the `it.each` keeps `supabase/functions/content-admin/handler.ts` only
- `edge-functions.contract`, `function-clock.contract`, `lead-retention.contract`, `logging.contract`, `needs-wizard.contract`, `slogan.contract`, `client-meetings-many.contract`, `tests/security/agent-surface.security.test.ts` — remove the cases or `it.each` rows that name a `base44/` path
- `tests/helpers/entity-schema.ts`, `tests/helpers/source-scan.ts` — drop the `base44/` readers (keep `REPO_ROOT`)
- STD: `03-std-contract.md`, `04-std-security.md`

- [ ] **Step 1:** `git grep -n -E "base44/(functions|agents|entities|connectors|mcp|config)" -- tests` lists every reference; edit each file above.
- [ ] **Step 2: Run** `npm run test:contract && npm run test:security` — PASS.
- [ ] **Step 3: Commit** — "Base44 exit B2, 1: the contracts read the Supabase side only".

### Task 7: The in-process Base44 harness goes

**Files:**
- Move: `MAILER_URL`, `EmailCall`, `FetchCall` from `tests/helpers/base44-function.ts` into `tests/helpers/edge-function.ts`; update its importers
- Delete: `tests/helpers/base44-function.ts`; the Base44-only integration tests `admin-lead`, `content-admin`, `create-consultation-event`, `forwarders`, `mailer`, `upsert-contact` (`.integration.test.ts`) — confirm each calls `invokeFunction` only
- Modify: the mixed files `content-admin-edge`, `escalate-to-human`, `invite-user`, `log-support-chat`, `meeting-request`, `submit-claim`, `submit-claim-edge`, `submit-lead` — delete the `invokeFunction` (Base44) cases, keep every `invokeEdge` case; `.github/workflows/ci.yml:237` comment ("Runs the Base44 functions in-process") describes the Edge harness
- STD: `12-std-integration.md`

- [ ] **Step 1:** Move the shared types; `npm run typecheck` — 0.
- [ ] **Step 2:** Delete and trim the files; `git grep -n "invokeFunction\|base44-function" -- tests` — no output.
- [ ] **Step 3: Run** `npm run test:integration` — PASS; the count drops by exactly the cases recorded as retired in STD-12.
- [ ] **Step 4: Commit** — "Base44 exit B2, 2: the integration suite runs the Edge Functions only".

### Task 8: The folder, the scripts, the skills, the docs

**Files:**
- Delete: `base44/` (agents, config.jsonc, connectors, entities, functions); `scripts/backfill-from-base44.mjs`, `scripts/reconcile-leads.mjs`, `scripts/reconcile-stores.mjs` with `tests/unit/base44-repair-scripts.test.ts`, `reconcile-leads.test.ts`, `reconcile.test.ts` (and the reference in `submit-lead.integration.test.ts`); `.agents/skills/base44-*` and their entries in `skills-lock.json`
- Modify: `AGENTS.md` — the opening line ("This is a Base44 app repository"), "Base44 References", the `base44Client.js`/`base44/functions` structure rows, the `adminLead` rollback note, the `.jsonc` agent-definition rule, the `base44-function.ts` mention; `README.md`; `docs/current-state.md` (Base44: none); `docs/base44-exit/README.md` (a dated "done" line linking B1/B2); comments in `scripts/{check-production-publish,wait-for-deployment,vite-site-url-plugin,check-csp-hashes,build-seo-files,seed-blog,publish-blog,published-articles,prerender}.mjs` and `supabase/functions/**` that describe a Base44 present tense
- STD: `00-master-test-plan.md`, `01-std-unit.md`, `10-known-issues.md`, `tests/test-plan/README.md`

- [ ] **Step 1:** Delete and edit.
- [ ] **Step 2: Verify** `git grep -l -i base44 -- . ':!supabase/migrations' ':!docs/superpowers' ':!docs/base44-exit'` lists only files that keep `base44_id` / `BASE44_ID_PATTERN` / old-link handling, and each such hit is about the id or the history.
- [ ] **Step 3: Run** lint, typecheck, `build:prerender`, the five suites — PASS.
- [ ] **Step 4: Commit** — "Base44 exit B2, 3: the base44/ folder, its scripts and skills go; the docs say so". Open PR B2; squash-merge on the user's go-ahead.

### Task 9: After both merge (the user's, in dashboards)

- [ ] Vercel: delete `VITE_BASE44_APP_ID`, `VITE_BASE44_SERVER_URL`, `VITE_BASE44_APP_BASE_URL`, `VITE_LEAD_FUNCTIONS`, `VITE_CONTENT_WRITES`, `VITE_UPLOAD_PROVIDER`, `VITE_CONTENT_IMAGES`, `VITE_CHAT_AGENTS` — none is read after B1. Redeploy is not needed (build-time only, and the next build simply doesn't see them).
- [ ] GitHub: delete secrets `BASE44_API_KEY`, `BASE44_ACCESS_TOKEN`, `BASE44_REFRESH_TOKEN` and variables `BASE44_APP_ID`, `BASE44_URL` (read by no workflow since #262).
- [ ] Base44 dashboard: connectors revoked (~2026-10-27, before B1); then delete or unpublish the app, which takes `safe-arch-plan.base44.app` down.
