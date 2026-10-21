# New agency, step 2 — Dorit as agency 1, read side behind `VITE_AGENCY_CONTENT` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Seed Dorit's own data into the wizard's tables as agency 1. Then let the public pages read agency content from the database through one hook, behind a flag that ships off, so that merging changes nothing a visitor sees.

**Architecture:**
- **Migrations.** One sibling schema migration gives the public read side what it needs, in four parts:
  - column grants on `testimonials`, which fixes review M-2;
  - a consented-testimonials read for other active agencies;
  - two `success_cases` columns that `proof.c1…c7` render;
  - a definer view `public_agency_sites`.

  A separate seed migration then inserts agency 1's agent and success cases, and stamps the profile last.
- **Front end.**
  - A new `AgencyContentPort`, served by a PostgREST adapter that takes no SDK, resolves the agency from the host name.
  - `useAgencyContent()` merges what the port returns over the bundled agency-1 constants. The bundled constants are what the hook returns with the flag off, for a locale other than Hebrew, while loading, and on any error.
  - The components read the hook instead of `CONTACT`, `home.json` keys and literals.
  - The prerender blocks the content requests, so the HTML it writes stays on the constants (ruling R4).

**Tech Stack:** Postgres/Supabase migrations and psql check files (Postgres 16 stand-in), React 18 + TanStack Query, Vitest (unit, component, contract, integration, security), Playwright (`web-chromium`, `android-chrome`).

**Spec:** `docs/superpowers/specs/2026-10-16-new-agency-wizard-design.md`. Binding sections: "Dorit as agency 1", "Frontend → Read side", and Rollout step 2.

**Rulings:** R1–R10 from the step-2 brief (2026-10-21), recorded below. Two more inputs:
- PR 1 is `feat/agency-onboarding`, #285 at `c0ee766`. It is not merged and not applied in production, and this branch is stacked on it.
- PR 1's review notes for step 2 are M-2, ruling 7 and N-1.

## Global Constraints

**The rulings**
- **R1 — the flag.** `VITE_AGENCY_CONTENT` is read like `src/config/staff-leads.ts`: on only when it is exactly `"true"`.
  - Off: no query and no request. The render is byte-for-byte today's.
  - On: content comes from the database. While loading, on any error, and for a locale other than `he`, the page renders the bundled agency-1 constants. No blank, no spinner, no flash.
- **R2 — the seed.**
  - File: `supabase/migrations/20261107000000_seed_agency1_content.sql`. Never edit `20261106000000_agency_onboarding.sql`.
  - Order (review N-1): agent insert, then success cases, then the `agency_profiles` update, which sets `consent_version` and runs **last**.
  - It is idempotent and safe: it applies once in production with `psql -1`, and a second run is a no-op.
  - Its values are the bundled strings, held to them by a contract test.
- **R3 — the portrait.**
  - Agency 1 with a null `photo_path` gets the bundled `/images/dorit-office-portrait-{480,768,1080}.{avif,webp}`. This is a documented special case.
  - Any other agency with a `photo_path` gets a public `agent-photos` URL with the 480/768/1080 `srcset`.
  - A null `photo_path` gets the monogram.
- **R4 — the prerender stays on the bundled constants.** There is no build-time database read in step 2. `index.html`, `public/llms.txt`, `public/poa.html` and the JSON-LD are unchanged. Per-domain build-time reading is deferred to the first outside agency (Rollout 5–6).
- **R5 — the licence comes from `agents`, via `public_agent_cards`**, which shows the verified number. `agency_profiles.licence_*` stay for `supabase/functions/_shared/agency.ts` and `/admin/agency`. No column is dropped.
- **R6 — review M-2.**
  - `anon` cannot read `testimonials.consent_confirmed_by` or `consent_confirmed_at`.
  - `authenticated` can read `consent_confirmed_at` but not `consent_confirmed_by`.
  - The fix is column grants: the table-level `select` is revoked and the public columns are granted.
  - Every anon reader must keep working with the explicit list.
- **R7 — no gendered templates in this step.** These stay exactly as they are:
  - the `compliance.ts` sentences and `CONSENT_VERSION`;
  - `hero.claimLicence`, `about.eyebrow`, `about.titleLine1/2`, `start.*` and `proof.similar*`;
  - the chat greetings in `src/config/agents.ts`, which are feminine sentences ("לא דורית עצמה", "דורית תגיע");
  - `common.json`'s `contact.whatsappDefault`.

  Only data moves.
- **R8 — the agency comes from the host name.**
  - `siteHost(location.hostname)` is `normalizeHost` from `src/lib/legacy-host.ts`, with one leading `www.` removed.
  - No active agency claims the host → agency 1. That covers localhost, Vercel previews, unknown hosts and an empty or hostile host.
  - Anon reads through narrow definer views. Anon gets no table grant on `agency_profiles`, `agencies` or `agents`.
- **R9 — the visual gate.** With the flag on:
  - the seeded content and the refused content give identical screenshots and identical `body` HTML on `/`, `/perspective`, `/privacy` and `/poa.html`, in `web-chromium` and `android-chrome`;
  - unit and component tests cover the hook and the portrait rule.
- **R10 — no production action.** The PR is opened and not merged. Apply order: #285's migration, then `20261106100000`, then `20261107000000`. Only the user turns the flag on, after the diff is green on a preview.

**Exact values**
- **Agency 1:** `00000000-0000-0000-0000-000000000001` (`AGENCY_1` in `src/hooks/useAgency.ts`; `AGENCY1_ID` in the new `src/config/agency1.ts`).
- **Dorit's agent row:** `00000000-0000-0000-0000-0000000000a1`.
- **Success cases:** `00000000-0000-0000-0000-0000000005c1` … `…05c7`, with `sort_order` 1…7.
- **Profile values from the seed:**
  - `domain = 'govari-fin.co.il'`, the hostname of `resolveSiteUrl(undefined, undefined)`;
  - `notify_emails = ['amielnoy@gmail.com', 'amielnoy@outlook.com']`, the default `NOTIFY_EMAILS` of `supabase/functions/_shared/recipients.ts`;
  - `consent_version = '2026-10-agents-v5'`, which is `CONSENT_VERSION`;
  - `disclosures_approved_at = now()`, with `_by` null.
- **The agent row:**
  - `licence_number = 'L-00107009'`, inserted with `licence_verified_at = now()`;
  - `agents_guard` then stamps `verified_licence_number` from it;
  - `user_id` comes from `auth.users` where `email = 'dorit@govari-fin.co.il'`, as the tenant migration did;
  - `grammatical_gender = 'f'` and `has_institutional_affiliation = true`;
  - `licence_types = '{}'` and `affiliations = '{}'`. The repository has no source for either; see the hand-off note.
  - `photo_path` is null, and `booking_url` is null (`VITE_CAL_LINK` is build-time only).
- **Testimonials:** the seed does not touch them (see the hand-off note).
- **Column lists:**
  - anon `testimonials` select: `id, base44_id, agency_id, agent_id, name, role, quote, image_url, rating, source, source_url, sort_order, created_at, updated_at`;
  - `authenticated` gets the same plus `consent_confirmed_at`;
  - `public_agency_sites`: `agency_id, domain, display_name, phone_e164, phone_display, whatsapp, email, default_whatsapp_message, service_area`.
- **New `success_cases` columns:** `tag text check (char_length(tag) <= 60)` and `metric_is_estimate boolean not null default false`. These hold `proof.cN.tag` and the `basis` line of c2 and c6.
- **CSP:** add `img-src https://hjowdyiwjjrqceumkvgt.supabase.co/storage/v1/object/public/agent-photos/` to `vercel.json`. Never add the bare host.
- **Photo naming (step 4 must follow it):** `photo_path` names the 768 file, `<agency>/<agent>/<stem>-768.webp`, with `<stem>-480.webp` and `<stem>-1080.webp` beside it. A path not ending in `-768.webp` gets a single `src` and no `srcset`.

**Repository rules**
- New code is TypeScript. `FloatingActions.jsx` stays JS, by per-file convention.
- Comments in the house style: why, not what.
- Shell is zsh: capture `$?` directly and never use `${PIPESTATUS}`. There is no `timeout` command.
- **SQL checks** run on the Postgres 16 stand-in, because Docker is down:

  ```
  S=/private/tmp/claude-501/-Users-amielpeled-CommercialProjects-DoritFinanaceSite/3b9142ec-fdd0-490c-8ce9-0adc14b48c15/scratchpad
  B=$S/pgvenv/lib/python3.12/site-packages/pgserver/pginstall/bin
  W=/Users/amielpeled/CommercialProjects/DoritFinanaceSite-content2
  $B/pg_ctl -D $S/pgdata -o "-p 54329 -c unix_socket_directories='' -c listen_addresses=127.0.0.1" -l $S/pg.log start
  $S/pgstub/run.sh $W $(ls $W/supabase/tests/*_check.sql | grep -v -e lead_retention -e lead_sheet_retention); echo "exit=$?"
  $B/pg_ctl -D $S/pgdata stop
  ```

  Expected output: `migrations: OK (37)`, `check OK:` for every file, and `exit=0`. The two retention checks refuse a migrated database by design. Always stop the server.
- **Before any push,** in this order: `npm run lint`, `npm run typecheck`, `npm run build:prerender`, `npm run test:unit`, `npm run test:component`, `npm run test:contract`, `npm run test:integration`, `npm run test:security`, then `CI=1 npx playwright test --project=web-chromium --project=android-chrome`.

## Review Focus

- **A hostile or odd host name.** Inputs: `WWW.Govari-Fin.co.il.`, `x),agency_id.eq.ffffffff-…`, an IDN `xn--` name, or an empty string.
  - Expected: each resolves to the agency that owns it or to agency 1.
  - The `or=(…)` filter never carries anything outside `[a-z0-9.-]`.
  - Tested in Task 4 (`siteHost` and the service).
- **Production's agency 1 profile differs from the bundled constants.** It could have been edited on `/admin/agency` since 2026-10-10.
  - Expected: turning the flag on would change the phone or email visitors see, so this must be found before the flag goes on.
  - Tested in Task 2 (the tenant seed's literals equal `AGENCY_PROFILE`). Task 8 also hands the user a read-only production query to run first.
- **Partial content.** An agency whose bio lacks paragraphs, with 0–2 stats, a null review link or a null booking link.
  - Expected: no `undefined`, no empty `<p>`, no empty grid cell, no dead link.
  - Tested in Task 5.
- **A visitor on `/en` or `/fr` with the flag on.**
  - Expected: the bundled translations, no Hebrew database text, and no content request.
  - Tested in Task 4 (hook).
- **A signed-in member of another agency, or the operator, on the public home page with the flag on.**
  - Expected: only the site agency's testimonials. Admin controls depend only on their role in the site's agency.
  - Tested in Task 5.

---

### Task 1: Read-side schema — M-2 column grants, the public views, the success-case columns

**Files:**
- Create: `supabase/migrations/20261106100000_agency_content_read_side.sql`
- Create: `supabase/tests/agency_content_check.sql`
- Create: `tests/contract/agency-content-schema.contract.test.ts`
- Create: `tests/security/agency-content.security.test.ts`
- Modify: `supabase/tests/onboarding_check.sql`, the two reads of `consent_confirmed_by` at about :417 and :950

**Interfaces:**
- Consumes:
  - PR 1's `testimonials.agent_id`, `consent_confirmed_by` and `consent_confirmed_at`;
  - `public.agency_is_active(uuid)`, already granted to anon;
  - `public.agency_profiles`, `public.agencies` and `public.success_cases`.
- Produces:
  - view `public.public_agency_sites`, with the column list from Global Constraints;
  - policy `testimonials_read_public_active`;
  - columns `success_cases.tag` and `success_cases.metric_is_estimate`;
  - the testimonials column grants.

- [ ] **Step 1: Write the failing contract test** `tests/contract/agency-content-schema.contract.test.ts` (CTR-AGC-001…009). Read the migration as source and strip `--` lines, as `agency-onboarding.contract.test.ts` does. Assert:
  - The file sorts after `20261106000000_agency_onboarding.sql` and before `20261107000000_seed_agency1_content.sql`.
  - It contains `revoke select on public.testimonials from anon, authenticated;`.
  - The parsed `grant select (…) on public.testimonials to anon, authenticated;` list equals the anon list exactly, as a set. Neither `consent_confirmed_by` nor `consent_confirmed_at` is in it.
  - The only other testimonials grant is `grant select (consent_confirmed_at) on public.testimonials to authenticated;`.
  - Every column of `TESTIMONIAL_COLUMNS` (from `src/services/supabase/SupabaseContentService.ts`) is in the anon list, and so is `base44_id`, which `e2e/api/supabase-live.spec.ts` selects.
  - `create policy testimonials_read_public_active on public.testimonials for select to anon, authenticated using (agency_id <> '00000000-0000-0000-0000-000000000001' and consent_confirmed_at is not null and public.agency_is_active(agency_id))`, whitespace-flattened.
  - `create view public.public_agency_sites with (security_invoker = false) as`:
    - its select list is exactly the nine columns;
    - its `where` has `a.status = 'active'`;
    - it has no `notify_emails`, `mail_from`, `onboarding`, `consent_version`, `ga4_measurement_id`, `disclosures_`, `licence_` or `*`.
  - It contains `revoke all on public.public_agency_sites from anon, authenticated, service_role;` and `grant select on public.public_agency_sites to anon, authenticated;`.
  - No `grant` in the file names `agency_profiles`, `agencies` or `agents` with `anon`.
  - `success_cases` gains exactly the two columns, with the checks in Global Constraints.
- [ ] **Step 2: Write the failing security test** `tests/security/agency-content.security.test.ts` (SEC-AGC-001…002). It reads every file in `supabase/migrations/` in order.
  - After the last `revoke select on public.testimonials from anon`, no later statement grants anon or authenticated a table-level select on `testimonials`.
  - No column grant anywhere names `consent_confirmed_by`.
  - No source under `src/`, `api/`, `scripts/`, `supabase/functions/` or `e2e/` reads `testimonials` with `select("*")`, `select=*`, or a `from("testimonials")` chain with no `.select(`.
- [ ] **Step 3: Run** `npx vitest run tests/contract/agency-content-schema.contract.test.ts tests/security/agency-content.security.test.ts; echo "exit=$?"`.
  - Expected: FAIL, because the migration file is missing.
- [ ] **Step 4: Write the migration.** Header comment: Rollout step 2, the read side; it fixes review M-2; the reason for each part.

  ```sql
  revoke select on public.testimonials from anon, authenticated;
  grant select (id, base44_id, agency_id, agent_id, name, role, quote, image_url, rating, source,
                source_url, sort_order, created_at, updated_at) on public.testimonials to anon, authenticated;
  grant select (consent_confirmed_at) on public.testimonials to authenticated;
  ```

  - Add the policy as in Step 1. Its comment says that RLS does not need a column grant to read `consent_confirmed_at`; Step 5 proves it.
  - Add the `success_cases` columns.
  - Add the view, built like `public_agent_cards`:
    - `select p.agency_id, p.domain, p.display_name, p.phone_e164, p.phone_display, p.whatsapp, p.email, p.default_whatsapp_message, p.service_area`;
    - `from public.agency_profiles p join public.agencies a on a.id = p.agency_id where a.status = 'active'`;
    - the revoke and grant lines.

  The view's comment copies the PR 1 warning: do not drop the filter or add a column without asking whether a visitor may see it.
- [ ] **Step 5: Write `supabase/tests/agency_content_check.sql`**, schema blocks, in the style of `onboarding_check.sql`: `begin` … `rollback`, and every block raises on a wrong answer. It needs these fixtures:
  - an active agency F (`ffffffff-0000-0000-0000-00000000000f`) and a draft agency G (`ffffffff-0000-0000-0000-0000000000a9`);
  - a profile for each, with domains `f.example` and `g.example`;
  - an agent in each, inserted as postgres;
  - a consented testimonial in each, plus an unconsented agency-1 row.

  Assertions:
  - `has_table_privilege('anon','public.testimonials','select')` and the same for `authenticated` are both false.
  - `has_column_privilege` for `consent_confirmed_by` is false for anon and authenticated. For `consent_confirmed_at` it is false for anon and true for authenticated.
  - As `anon` (`set local role anon`):
    - `select id, base44_id, name, role, quote, image_url, rating, source, created_at from public.testimonials` returns agency 1's row and F's row, but not G's;
    - `select consent_confirmed_by from public.testimonials` raises `insufficient_privilege`, and so does `select * …`;
    - `select count(*)` works.
  - As anon, `public_agency_sites` shows agency 1 and F, but not G.
  - `has_table_privilege('anon','public.agency_profiles','select')` is false.
  - The view's columns, from `information_schema.columns`, are exactly the nine.
  - A `tag` of 61 characters raises `check_violation`.
- [ ] **Step 6: Adapt `onboarding_check.sql` to M-2.** Its two reads of `consent_confirmed_by` run as `authenticated` and now raise `42501`.
  - Move each assertion into a block after `reset role`. Keep the expected values: `…0a1` at :417, `…0a2` at :950.
  - Keep the `consent_confirmed_at` read where it is, because authenticated may read it.
  - No assertion is weakened.
- [ ] **Step 7: Run** the contract and security tests (expected: PASS, `exit=0`). Then run the stand-in command from Global Constraints. Expected: `migrations: OK (36)` before Task 2, each `check OK:`, and `exit=0`.
- [ ] **Step 8: Commit.**

  ```bash
  git add supabase/migrations/20261106100000_agency_content_read_side.sql supabase/tests/agency_content_check.sql supabase/tests/onboarding_check.sql tests/contract/agency-content-schema.contract.test.ts tests/security/agency-content.security.test.ts
  git commit -m "Agency content: public read side, testimonials column grants (review M-2)"
  ```

### Task 2: Seed agency 1 — agent, success cases, profile last

**Files:**
- Create: `supabase/migrations/20261107000000_seed_agency1_content.sql`
- Create: `src/config/agency1.ts`
- Create: `e2e/fixtures/agency1-seed.ts`
- Create: `tests/contract/agency-content-seed.contract.test.ts`
- Modify: `src/components/dorit/sections/ReviewsWidget.tsx`, `src/components/dorit/sections/ProofCarousel.tsx` (imports only; no render change)
- Modify: `supabase/tests/agency_content_check.sql` (append the seed blocks)

**Interfaces:**
- Consumes: Task 1's columns. Also `agents_guard`, which stamps `verified_licence_number` on a non-person insert with `licence_verified_at`, and `agents_after_change`, which bumps `consent_version` on insert. That bump is why the profile update runs last.
- Produces:
  - **`src/config/agency1.ts`:**
    - `AGENCY1_ID = "00000000-0000-0000-0000-000000000001"`;
    - `AGENCY1_AGENT_ID = "00000000-0000-0000-0000-0000000000a1"`;
    - `AGENCY1_PORTRAIT_BASE = "/images/dorit-office-portrait"`;
    - `AGENCY1_REVIEW_LINKS = { google: <ReviewsWidget's GOOGLE_URL>, midrag: <its MIDRAG_URL> } as const`;
    - `AGENCY1_CASES: readonly { key: "c1" | … | "c7"; estimate: boolean }[]`, which is ProofCarousel's `BRIEFS` with `basis` renamed to `estimate`: true for c2 and c6.
  - **`e2e/fixtures/agency1-seed.ts`** (erasable TypeScript only; Node and Vitest both load it):
    - `SEED_FILE` (path);
    - `interface Agency1Seed`;
    - `readAgency1Seed(sql?: string): Agency1Seed`, which parses the text between the two `$json$` markers;
    - `agency1ContentRows(): Map<string, Row[]>`. Its rows for `public_agency_sites`, `public_agent_cards` and `success_cases` have the views' and the table's column names. The site row is built from `AGENCY_PROFILE` and the seed's domain. The card row's `licence_number` is the seed's `licence_number`.
  - **The seed JSON** (keys are column names):

    ```
    { "agency_id": "…01",
      "agent": { "id", "full_name", "grammatical_gender", "professional_title", "photo_alt", "licence_number",
                 "licence_regulator", "has_institutional_affiliation", "bio": { "headline", "family", "credentials",
                 "career", "insight", "unique", "signature" }, "stats": [{ "num", "label" } ×3],
                 "review_links": { "google", "midrag" }, "meeting_minutes": 15 },
      "success_cases": [{ "id", "sort_order", "tag", "title", "body", "metric", "metric_is_estimate" } ×7],
      "profile": { "notify_emails", "domain", "consent_version" } }
    ```

- [ ] **Step 1: Move the constants into `src/config/agency1.ts`.**
  - `ReviewsWidget.tsx` uses `AGENCY1_REVIEW_LINKS.google` and `.midrag` in place of its two constants.
  - `ProofCarousel.tsx` maps `AGENCY1_CASES` (`c.key`, `c.estimate`) in place of `BRIEFS`.
  - Keep the comments that explain why.
  - Run `npx vitest run tests/component/proof-carousel.test.tsx tests/component/sanity.test.tsx; echo "exit=$?"`. Expected: PASS, unchanged.
- [ ] **Step 2: Write the failing contract test** `tests/contract/agency-content-seed.contract.test.ts` (CTR-AGC-010…017). `seed = readAgency1Seed()`, `he = src/i18n/locales/he/home.json`. Assert:
  - **Agent identity:**
    - `seed.agency_id === AGENCY1_ID`, which is also the id in the tenant migration's `insert into public.agencies`;
    - `seed.agent.id === AGENCY1_AGENT_ID`;
    - `full_name === AGENCY_PROFILE.displayName`;
    - `` `${full_name} · ${professional_title}` === he["hero.byline"] ``;
    - `` `${full_name} — ${professional_title}` === AGENCY_PROFILE.licenceEntity ``;
    - `photo_alt === he["hero.portraitAlt"]`;
    - `licence_number === AGENCY_PROFILE.licenceNumber`;
    - `licence_regulator === AGENCY_PROFILE.licenceRegulator`;
    - `grammatical_gender === "f"`;
    - `has_institutional_affiliation === true`, and `CONSENT.points[1]` contains `"ולה זיקה לגופים מוסדיים"`.
  - **Bio and stats:**
    - `bio` equals `{ headline: he["hero.lead"], family: he["about.family"], credentials, career, insight, unique, signature: he["about.signature"] }`, each from `about.*`;
    - `stats` equals `[1,2,3].map(n => ({ num: he[`about.stat${n}Num`], label: he[`about.stat${n}`] }))`;
    - `review_links` equals `AGENCY1_REVIEW_LINKS`.
  - **Success cases:** `success_cases[i]` equals `{ id: "…05c" + (i+1), sort_order: i+1, tag, title, body, metric }` from `he["proof.c" + (i+1) + ".*"]`, with `metric_is_estimate: AGENCY1_CASES[i].estimate`, for all 7.
  - **Profile:**
    - `profile.notify_emails` equals `[...NOTIFY_EMAILS]`, imported from `supabase/functions/_shared/recipients.ts`. With no `Deno`, that is the default.
    - `profile.domain === new URL(resolveSiteUrl(undefined, undefined)).hostname`.
    - `profile.consent_version === CONSENT_VERSION`.
  - **Review N-1, read on the SQL with comments stripped:**
    - the guard `if exists (select 1 from public.agents where id =` comes before every `insert`;
    - `insert into public.agents` comes before `insert into public.success_cases`, which comes before `update public.agency_profiles`;
    - the update is the last DML statement, and it sets `consent_version`, `disclosures_approved_at`, `notify_emails` and `domain`.
  - **Review Focus 2:** the tenant migration's `insert into public.agency_profiles` literals (`20261010000000_tenant_schema.sql`) equal `AGENCY_PROFILE`'s `displayName`, `phoneE164`, `phoneDisplay`, `whatsapp`, `email` and `defaultWhatsappMessage`.
- [ ] **Step 3: Run** `npx vitest run tests/contract/agency-content-seed.contract.test.ts; echo "exit=$?"`. Expected: FAIL, because the seed file is missing.
- [ ] **Step 4: Write the seed migration.**
  - Header comment: Rollout step 2; the values are the bundled strings and the contract test holds them; why the order is what it is (N-1); why testimonials are untouched; why `photo_path` and `booking_url` are null.
  - One `do $seed$ … $seed$` block, as below. Fill the JSON verbatim from the sources Step 2 names; the test is the arbiter.

  ```sql
  do $seed$
  declare
    c jsonb := $json$ { …exact JSON… } $json$::jsonb;
    a jsonb := c -> 'agent';
  begin
    if exists (select 1 from public.agents where id = (a ->> 'id')::uuid) then
      raise notice 'agency 1 is already seeded — nothing done';
      return;
    end if;
    -- 1. the agent (agents_after_change moves consent_version and clears the approval — both fixed in 3)
    insert into public.agents (id, agency_id, user_id, full_name, …, licence_verified_at)
    select …, (select id from auth.users where email = 'dorit@govari-fin.co.il'), …, now();
    -- 2. the success cases, published, bound to the agent
    insert into public.success_cases (id, agency_id, agent_id, sort_order, tag, title, body, metric, metric_is_estimate, published)
    select … from jsonb_to_recordset(c -> 'success_cases') as s(…);
    -- 3. LAST: the profile, so nothing after it moves consent_version
    update public.agency_profiles
       set notify_emails = …, domain = …, disclosures_approved_at = now(), disclosures_approved_by = null,
           consent_version = c #>> '{profile,consent_version}'
     where agency_id = (c ->> 'agency_id')::uuid;
    -- 4. refuse a half-seed
    if (select consent_version from public.agency_profiles where agency_id = …) is distinct from c #>> '{profile,consent_version}'
       or not exists (select 1 from public.public_agent_cards where id = (a ->> 'id')::uuid) then
      raise exception 'agency 1 seed did not land as written';
    end if;
  end
  $seed$;
  ```

- [ ] **Step 5: Write `e2e/fixtures/agency1-seed.ts`** to the Interfaces above. Card rows carry every column of `public_agent_cards`. `licence_types` and `affiliations` are `[]`. `photo_path` and `booking_url` are null.
- [ ] **Step 6: Append the seed blocks to `agency_content_check.sql`.**
  - The agent row `…0a1` exists. `licence_verified_at` is not null and `verified_licence_number = 'L-00107009'`.
  - As anon, `public_agent_cards` for agency 1 returns 1 row, with `licence_number = 'L-00107009'` and `full_name = 'דורית גוב ארי'`.
  - The profile has `consent_version = '2026-10-agents-v5'`, `disclosures_approved_at` not null, `domain = 'govari-fin.co.il'` and `notify_emails = array['amielnoy@gmail.com','amielnoy@outlook.com']`.
  - As anon, `success_cases` for agency 1 returns 7 rows. `sort_order` is 1…7, and `metric_is_estimate` is true exactly for `sort_order` 2 and 6.
  - **Idempotency:** `\ir ../migrations/20261107000000_seed_agency1_content.sql` runs a second time. Afterwards there is still 1 agent and 7 cases, and `consent_version` and `disclosures_approved_at` are unchanged (keep the values from before in a temp table).
- [ ] **Step 7: Run** the contract test (expected: PASS). Then run the stand-in command. Expected: `migrations: OK (37)`, every `check OK:`, and `exit=0`.
- [ ] **Step 8: Commit.**

  ```bash
  git add supabase/migrations/20261107000000_seed_agency1_content.sql src/config/agency1.ts e2e/fixtures/agency1-seed.ts tests/contract/agency-content-seed.contract.test.ts supabase/tests/agency_content_check.sql src/components/dorit/sections/ReviewsWidget.tsx src/components/dorit/sections/ProofCarousel.tsx
  git commit -m "Agency content: seed Dorit as agency 1 (agent, success cases, profile last)"
  ```

### Task 3: The portrait rule — bundled, photo or monogram

**Files:**
- Create: `src/lib/portrait.ts`, `src/components/dorit/primitives/AgentPortrait.tsx`
- Create: `tests/unit/portrait.test.ts`, `tests/component/agent-portrait.test.tsx`
- Modify: `vercel.json` (CSP `img-src`), `tests/contract/content-images-storage.contract.test.ts`

**Interfaces:**
- Consumes: `AGENCY1_ID` and `AGENCY1_PORTRAIT_BASE` (Task 2).
- Produces:
  - **The `Portrait` type:**

    ```ts
    export type Portrait =
      | { kind: "bundled"; alt: string }
      | { kind: "photo"; src: string; srcSet: string | null; alt: string }
      | { kind: "monogram"; initials: string; alt: string };
    ```

  - `PORTRAIT_WIDTHS = [480, 768, 1080] as const`.
  - `agentPhotoBase(supabaseUrl: string | undefined): string | null` → `${url}/storage/v1/object/public/agent-photos/`, or null when there is no URL.
  - `initialsOf(fullName: string): string`.
  - `portraitFor(input: { agencyId: string; photoPath: string | null; photoAlt: string | null; fullName: string }, photoBase: string | null): Portrait`.
  - `export default function AgentPortrait({ portrait, sizes }: { portrait: Portrait; sizes: string })`.

- [ ] **Step 1: Write the failing unit test** `tests/unit/portrait.test.ts` (UNIT-POR-001…007):
  - **Agency 1, no photo:** `portraitFor({ agencyId: AGENCY1_ID, photoPath: null, photoAlt: null, fullName: "דורית גוב ארי" }, base)` → `{ kind: "bundled", alt: "דורית גוב ארי — דיוקן מקצועי" }`. With `photoAlt: "x"` → alt `"x"`.
  - **Agency 1 with a photo:** the result is `kind: "photo"`. Her own upload wins.
  - **Other agency, a `-768.webp` path:** path `"f…/g…/portrait-768.webp"` with base `"https://p.supabase.co/storage/v1/object/public/agent-photos/"` gives:
    - `src` = base + path;
    - `srcSet` = `"<base>f…/g…/portrait-480.webp 480w, <base>f…/g…/portrait-768.webp 768w, <base>f…/g…/portrait-1080.webp 1080w"`.
  - **A path not ending `-768.webp`:** `srcSet: null`.
  - **Other agency, null path:** `{ kind: "monogram", initials: "יכ", alt: "יעל כהן — דיוקן מקצועי" }` for `"יעל כהן"`.
  - **No storage base:** a photo path with `photoBase` null gives a monogram.
  - **Initials:** `initialsOf("  דנה  ")` → `"ד"`, and `initialsOf("דורית גוב ארי")` → `"דג"`.
  - **The base:** `agentPhotoBase(undefined)` → null, and `agentPhotoBase("https://p.supabase.co/")` → `"https://p.supabase.co/storage/v1/object/public/agent-photos/"`.
- [ ] **Step 2: Write the failing component test** `tests/component/agent-portrait.test.tsx` (CMP-POR-001…003):
  - **Bundled:** a `<picture>` with an AVIF and a WebP `<source>`. Their `srcset` contains `/images/dorit-office-portrait-480.avif 480w` and `/images/dorit-office-portrait-1080.webp 1080w`. The `<img>` has `src` `/images/dorit-office-portrait-768.webp`, width 1122, height 1402, `fetchpriority="high"`, and the given `sizes`.
  - **Photo:** one `<img>` with `src`, `srcset` and `sizes`, and no `<picture>`.
  - **Monogram:** `getByRole("img", { name: alt })` has the text of the initials, and there is no `<img>` element.
- [ ] **Step 3: Run** `npx vitest run tests/unit/portrait.test.ts tests/component/agent-portrait.test.tsx; echo "exit=$?"`. Expected: FAIL (modules missing).
- [ ] **Step 4: Implement `src/lib/portrait.ts` and `AgentPortrait.tsx`.**
  - The bundled branch is Hero's present `<picture>` markup, moved verbatim with its comments: `WIDTHS`, the `srcset` helper, the `object-[center_20%]` class and the lowercase `fetchpriority` spread.
  - The photo branch is the same `<img>` attributes, with WebP only.
  - The monogram is a `div` with `role="img"`, `aria-label={alt}` and classes `w-full h-full flex items-center justify-center bg-primary text-primary-foreground font-heading text-[clamp(40px,6vw,96px)] max-md:text-2xl`. Its comment explains why it is a first-class state.
- [ ] **Step 5: Allow the bucket in the CSP.**
  - Append the `agent-photos/` URL to `img-src` in `vercel.json`, after `content-images/`.
  - In `content-images-storage.contract.test.ts`, add CTR-CIS case "allows img-src from agent-photos' public path only": `imgSrc` contains it, and the bare host is still absent.
- [ ] **Step 6: Run** the three test files. Expected: PASS, `exit=0`.
- [ ] **Step 7: Commit.**

  ```bash
  git add src/lib/portrait.ts src/components/dorit/primitives/AgentPortrait.tsx tests/unit/portrait.test.ts tests/component/agent-portrait.test.tsx vercel.json tests/contract/content-images-storage.contract.test.ts
  git commit -m "Agency content: the portrait rule — Dorit's bundled set, an agency's photo, or a monogram"
  ```

### Task 4: The read path — port, adapter, flag, `useAgencyContent()`, prerender

**Files:**
- Create:
  - `src/config/agency-content.ts`
  - `src/lib/agency-content.ts`
  - `src/services/supabase/agency-content-tables.ts`
  - `src/services/supabase/SupabaseAgencyContentService.ts`
  - `src/hooks/useAgencyContent.ts`
- Create:
  - `tests/unit/agency-content.test.ts`
  - `tests/unit/supabase-agency-content.test.ts`
  - `tests/component/use-agency-content.test.tsx`
  - `tests/contract/agency-content-read.contract.test.ts`
- Modify:
  - `src/services/ports.ts`, `src/services/index.ts`, `src/services/composition.ts`
  - `src/services/supabase/SupabaseContentService.ts`, `src/services/base44/Base44ContentService.ts`
  - `src/hooks/useContent.ts`
  - `tests/component/services-mock.ts`, `tests/unit/supabase-content.test.ts`
  - `src/vite-env.d.ts`, `vitest.config.ts`
  - `scripts/prerender.mjs`

**Interfaces:**
- Consumes: `Portrait`, `portraitFor` and `agentPhotoBase` (Task 3); `AGENCY1_*` (Task 2); `normalizeHost` (`src/lib/legacy-host.ts`); `CAL_LINK` (`src/config/offers.ts`); `CONTACT` (`src/config/contact.ts`).
- Produces:
  - **The flag (`src/config/agency-content.ts`):** `isAgencyContentOn(v: string | undefined): boolean` and `AGENCY_CONTENT: boolean`.
  - **`src/services/ports.ts`:**
    - `AgencyContact { phoneE164; phoneDisplay; whatsapp; email; defaultWhatsappMessage }`, all strings;
    - `AgentCardRecord { fullName: string; professionalTitle: string | null; photoPath: string | null; photoAlt: string | null; licenceNumber: string; bio: Partial<Record<BioKey, string>>; stats: { num: string; label: string }[]; bookingUrl: string | null; reviewLinks: { google?: string; midrag?: string } }`, where `BioKey = "headline" | "family" | "credentials" | "career" | "insight" | "unique" | "signature"`;
    - `AgencySiteRecord { agencyId: string; contact: AgencyContact; agent: AgentCardRecord }`;
    - `SuccessCase { tag: string | null; title: string; body: string; metric: string | null; estimate: boolean }`;
    - `AgencyContentPort { siteContent(host: string): Promise<AgencySiteRecord>; successCases(agencyId: string): Promise<SuccessCase[]> }`;
    - `Services.agencyContent: AgencyContentPort`;
    - `ContentPort.listTestimonials(limit?: number, agencyId?: string)`.
  - **`src/lib/agency-content.ts`:**
    - `type Translate = (key: string) => string`;
    - `AgentBio`: `headline: string`, plus the other six keys as `string | null`;
    - `AgencyContent { agencyId: string; source: "bundled" | "database"; contact: AgencyContact; agent: { fullName: string; byline: string; licenceNumber: string; portrait: Portrait; bio: AgentBio; stats: readonly { num: string; label: string }[]; bookingUrl: string | null; reviewLinks: { google: string | null; midrag: string | null } } }`;
    - `siteHost(hostname: string): string`;
    - `bundledAgencyContent(t: Translate): AgencyContent`;
    - `bundledSuccessCases(t: Translate): SuccessCase[]`;
    - `resolveAgencyContent(record: AgencySiteRecord, bundled: AgencyContent, photoBase: string | null): AgencyContent`.
  - **`agency-content-tables.ts`** (erasable TypeScript, no aliases; the prerender imports it):
    - `AGENCY_CONTENT_TABLES = ["public_agency_sites", "public_agent_cards", "success_cases"] as const`;
    - `SITE_COLUMNS = "agency_id,domain,display_name,phone_e164,phone_display,whatsapp,email,default_whatsapp_message"`;
    - `CARD_COLUMNS = "id,agency_id,full_name,professional_title,photo_path,photo_alt,licence_number,bio,stats,booking_url,review_links"`;
    - `SUCCESS_CASE_COLUMNS = "id,tag,title,body,metric,metric_is_estimate,sort_order"`.
  - **The adapter:** `class SupabaseAgencyContentService implements AgencyContentPort` (constructor `(client: SupabaseTableClient)`), `class AgencyContentError extends Error { code: "no_site" | "no_agent" | "incomplete" }` and `HOST_PATTERN = /^[a-z0-9.-]{1,253}$/`.
  - **`src/hooks/useAgencyContent.ts`:**
    - `useAgencyContent(): AgencyContent`;
    - `useSuccessCases(): SuccessCase[]`;
    - `useSiteTestimonials(limit?: number)`, which returns `useTestimonials`'s result;
    - `agencyContentKeys = { site: (host: string) => ["agency-content", "site", host] as const, cases: (agencyId: string) => ["agency-content", "cases", agencyId] as const }`.

- [ ] **Step 1: Write the failing unit test** `tests/unit/agency-content.test.ts` (UNIT-AGC-001…008). `heT = (k) => he[k]` from `he/home.json`.
  - **`isAgencyContentOn`:** `"true"` → true; `""`, `undefined`, `"1"` and `"TRUE "` → false. Match `isStaffLeadsOn`'s trim semantics exactly.
  - **`siteHost`:**
    - `"WWW.Govari-Fin.co.il."` → `"govari-fin.co.il"`;
    - `"localhost"` → `"localhost"`;
    - `"www.www.x.co"` → `"www.x.co"` (one `www.` removed);
    - `""` → `""`.
  - **`bundledAgencyContent(heT)`:**
    - `agencyId: AGENCY1_ID` and `source: "bundled"`;
    - `contact` deep-equals `CONTACT`;
    - `agent.byline === he["hero.byline"]` and `agent.licenceNumber === "L-00107009"`;
    - `agent.portrait` deep-equals `{ kind: "bundled", alt: he["hero.portraitAlt"] }`;
    - `bio.headline === he["hero.lead"]` and `bio.insight === he["about.insight"]`;
    - `stats` has 3 entries, the first `{ num: "30", label: "שנות ניסיון" }`;
    - `bookingUrl === CAL_LINK` and `reviewLinks` deep-equals `AGENCY1_REVIEW_LINKS`.
  - **`bundledSuccessCases(heT)`:** 7 cases, `[1].estimate === true`, `[0].tag === he["proof.c1.tag"]`.
  - **The identity:** build the record from `agency1ContentRows()` with the adapter's mapper (Step 5). Then `{ ...resolveAgencyContent(record, bundled, base), source: "bundled" }` deep-equals `bundledAgencyContent(heT)`. This is the object-level form of R9.
  - **Another agency's resolution:**
    - `agencyId` `"f…"` with `bookingUrl` null → `bookingUrl: null`; agency 1's `CAL_LINK` is not borrowed;
    - a missing `professionalTitle` → `byline === fullName`;
    - a missing `review_links.midrag` → `null`.
- [ ] **Step 2: Write the failing adapter test** `tests/unit/supabase-agency-content.test.ts` (UNIT-AGC-009…015). Use a `from(table)` wrapper that dispatches to one `tableFake` (`tests/helpers/supabase-table-fake.ts`) per table.
  - **A known host:** `siteContent("govari-fin.co.il")` sends `public_agency_sites` `select(SITE_COLUMNS)`, `or("domain.eq.govari-fin.co.il,agency_id.eq.00000000-0000-0000-0000-000000000001")` and `limit(2)`. Then it sends `public_agent_cards` `select(CARD_COLUMNS)`, `eq("agency_id", …)`, `order("id", asc)` and `limit(1)`.
  - **Two site rows** (agency F has the host, agency 1 is the fallback) → F is returned.
  - **An unknown host** (only agency 1's row comes back) → agency 1. This is the R9 "unknown host → agency 1" case.
  - **Hostile hosts:** `siteContent("x),agency_id.eq.ffffffff-0000-0000-0000-00000000000f")` and `siteContent("")` send exactly `or("agency_id.eq.00000000-0000-0000-0000-000000000001")`.
  - **Errors:**
    - no site row → `AgencyContentError` with code `no_site`;
    - no card → `no_agent`;
    - a site with a null `phone_e164`, `email` or `whatsapp`, or a card with no `bio.headline` → `incomplete`;
    - a table error is rethrown.
  - **Mapping:** `stats` that are not an array of `{num,label}` strings → `incomplete`. A `review_links.google` that does not start with `https://` is dropped.
  - **Success cases:** `successCases(id)` sends `select(SUCCESS_CASE_COLUMNS)`, `eq("agency_id", id)`, `eq("published", true)`, `order("sort_order", asc)` and `limit(20)`, and maps `metric_is_estimate` to `estimate`.
- [ ] **Step 3: Write the failing hook test** `tests/component/use-agency-content.test.tsx` (CMP-AGC-001…007). Use `renderHook` with a fresh `QueryClient` (`retry: false`) and `LocaleProvider`. The flag is mocked with `vi.resetModules()` + `vi.doMock("@/config/agency-content", …)` and the hook is imported dynamically per case. `services` uses `servicesModule` from `services-mock.ts`.
  - **Flag off:**
    - the result deep-equals `bundledAgencyContent(heT)`;
    - `servicesMock.agencyContent.siteContent` is never called;
    - it renders with no `QueryClientProvider` at all, which proves no `useQuery` runs.
  - **Flag on, pending:** the port never resolves → bundled.
  - **Flag on, rejects:** → bundled (`source: "bundled"`).
  - **Flag on, resolves** with a record whose `contact.phoneDisplay` is `"050-000-0000"` → `source: "database"` and that phone.
  - **Flag on, on `localhost`:** the port is asked for `"localhost"`.
  - **Flag on, locale `en` (Review Focus 4):** bundled English (`agent.byline === en["hero.byline"]`), and the port is not called.
  - **`useSuccessCases()`:** off → `bundledSuccessCases`. On → the port's cases once resolved, asked for `AGENCY1_ID` while the site is loading.
- [ ] **Step 4: Run** `npx vitest run tests/unit/agency-content.test.ts tests/unit/supabase-agency-content.test.ts tests/component/use-agency-content.test.tsx; echo "exit=$?"`. Expected: FAIL (modules missing).
- [ ] **Step 5: Implement.**
  - **The flag.** `src/config/agency-content.ts` follows `staff-leads.ts`. Add `readonly VITE_AGENCY_CONTENT?: string;` to `vite-env.d.ts`. Add `VITE_AGENCY_CONTENT: ""` to `vitest.config.ts`'s `env`, so a developer's `.env.local` cannot switch it on; extend the comment there.
  - **The adapter.**
    - The domain clause is sent only when `HOST_PATTERN.test(host)`.
    - Pick the domain match first, else agency 1.
    - Map the rows with an exported `toSiteRecord(site, card)` and `toSuccessCase(row)`. These validate as the test requires and throw `AgencyContentError` as specified.
    - The `published` filter stays in the query even though RLS hides drafts from anon, for the same reason as `SupabaseContentService`: a signed-in owner passes the onboarding policy.
  - **`ContentPort.listTestimonials(limit, agencyId?)`.** Supabase adds `.eq("agency_id", agencyId)` only when it is given, so without it the URL is unchanged. Base44 ignores it (rollback path, one agency). `services/index.ts`'s lazy wrapper passes it through. `contentKeys.testimonials(limit, agencyId?)` is `["testimonials", limit, agencyId ?? null]`; prefix invalidation in `useAdmin.ts` still matches.
  - **Wiring.**
    - `services/index.ts`: `agencyContent` is `new SupabaseAgencyContentService(new RestTableClient(url, key))` when Supabase is configured. Otherwise it is a port whose methods reject `new AgencyContentError("no_site")`, with no SDK load.
    - `composition.ts`: the same over `tables`, else the rejecting port.
    - `services-mock.ts`: `agencyContent` rejects by default, as a build without Supabase does.
  - **`useAgencyContent.ts`.** The implementation is chosen once at module load, with a comment saying why:

    ```ts
    export const useAgencyContent: () => AgencyContent = AGENCY_CONTENT ? useFromDatabase : useBundledOnly;
    ```

    The flag is a build constant, so the hook order never changes at run time. With the flag off there is no `useQuery`, which keeps every existing test that renders without a `QueryClientProvider` working.
    - **`useBundledOnly`:** `useMemo(() => bundledAgencyContent(t), [t])` with `t = useT("home")`.
    - **`useFromDatabase`:**
      - `useQuery({ queryKey: agencyContentKeys.site(host), queryFn, enabled: locale === "he", staleTime: 30 * 60_000, retry: false })`, where `host = siteHost(window.location.hostname)`;
      - it returns `resolveAgencyContent(data, bundled, agentPhotoBase(import.meta.env.VITE_SUPABASE_URL))` when there is data and the locale is `he`, otherwise `bundled`.
    - **`useSuccessCases`:** the same shape, keyed on `useAgencyContent().agencyId`.
    - **`useSiteTestimonials(limit = 50)`:** calls `useAgencyContent()` unconditionally (it runs no query when the flag is off), then `useTestimonials(limit, AGENCY_CONTENT ? content.agencyId : undefined)`. Flag off → today's request exactly. Both implementations are named `use…` so `react-hooks/rules-of-hooks` accepts them.
  - **The prerender (R4).** In `scripts/prerender.mjs`, import `AGENCY_CONTENT_TABLES` from `../src/services/supabase/agency-content-tables.ts`. After the `serveFixtureSupabase` call, register `page.route((url) => AGENCY_CONTENT_TABLES.some((t) => url.pathname === `/rest/v1/${t}`), (r) => r.abort("blockedbyclient"))`. Playwright runs the handler registered last first. The comment says why: no build-time database read in step 2, so the HTML a crawler reads stays the bundled agency 1 for every domain until Rollout 5.
- [ ] **Step 6: Add CTR-AGC-020 to `tests/contract/agency-content-read.contract.test.ts`.** Read `scripts/prerender.mjs` and assert three things:
  - it imports `AGENCY_CONTENT_TABLES` from that path;
  - it aborts requests for those tables;
  - the abort is registered after `serveFixtureSupabase`.

  Also extend `tests/unit/supabase-content.test.ts`:
  - `listTestimonials(50, AGENCY1_ID)` records `eq("agency_id", AGENCY1_ID)`;
  - `listTestimonials()` records no `eq`.
- [ ] **Step 7: Run** the four new test files and `tests/unit/supabase-content.test.ts` (expected: PASS). Then run `npm run typecheck; echo "exit=$?"` and `npm run test:component; echo "exit=$?"`. Expected: `exit=0`. Existing tests are unchanged, because the flag is off.
- [ ] **Step 8: Commit.**

  ```bash
  git add src/config/agency-content.ts src/lib/agency-content.ts src/services src/hooks/useAgencyContent.ts src/hooks/useContent.ts src/vite-env.d.ts vitest.config.ts scripts/prerender.mjs tests/unit/agency-content.test.ts tests/unit/supabase-agency-content.test.ts tests/unit/supabase-content.test.ts tests/component/use-agency-content.test.tsx tests/component/services-mock.ts tests/contract/agency-content-read.contract.test.ts
  git commit -m "Agency content: the read path behind VITE_AGENCY_CONTENT (off), prerender kept on the constants"
  ```

### Task 5: The home and about sections read the hook

**Files:**
- Modify: `src/components/dorit/sections/{Hero,About,Testimonials,ReviewsWidget,ProofCarousel,StartConversation}.tsx`
- Create: `tests/component/agency-content-sections.test.tsx`

**Interfaces:**
- Consumes: `useAgencyContent`, `useSuccessCases` and `useSiteTestimonials` (Task 4); `AgentPortrait` (Task 3).
- Produces: nothing new. The components keep their exports.

- [ ] **Step 1: Write the failing component test** `tests/component/agency-content-sections.test.tsx` (CMP-AGC-010…018). The flag is mocked on, and the services mock resolves a record. The flag-off tests already exist and must stay green unchanged.
  - **Sentinel record:** `fullName "יעל כהן"`, `professionalTitle "מתכננת פיננסית"`, `licenceNumber "L-0001"`, `photoPath null`, agency F, and `bio.headline "שורת פתיחה"`.
  - **Hero:**
    - the byline `"יעל כהן · מתכננת פיננסית"` appears twice;
    - `L-0001` and `שורת פתיחה` are shown;
    - the portrait is the monogram `role="img"` named `"יעל כהן — דיוקן מקצועי"`, and no `/images/dorit-office-portrait` source is in the DOM;
    - `tel:` and `wa.me/` use the record's contact.
  - **Hero with agency 1** and `photoPath` null → the bundled `<picture>`.
  - **About:**
    - the paragraphs render the record's bio;
    - with `family` null, the first paragraph is `credentials` alone, with no leading space or `"null"`;
    - with 2 stats there are 2 cells and the class `grid-cols-2`;
    - with 0 stats the strip is absent;
    - with `signature` null the signature line is absent (Review Focus 3).
  - **ReviewsWidget:** the Google link `href` is the record's link. With `midrag` absent there is no Midrag link.
  - **ProofCarousel:**
    - the cases come from `useSuccessCases`;
    - `proof.basis` shows only under the cases where `estimate` is true;
    - `wa.me/<whatsapp>` uses the record's number.
  - **StartConversation:**
    - `bookingUrl` set → the booking block links to it;
    - null for agency F → no booking block;
    - the chips use the record's contact.
  - **Testimonials (Review Focus 5):**
    - with the site agency F, `services.content.listTestimonials` is called with `(50, "f…")`;
    - a signed-in Admin of agency 1 does not see the add control. Mock `@/hooks/useAgency` as `agencyHookMock` does in `tests/helpers/agency-role-mock.ts`, but with `useAgencyRole: vi.fn((id) => id === AGENCY_1 ? adminState : noRoleState)`. Assert that it was called with F's id and that no button named "הוספת המלצה" is present.
- [ ] **Step 2: Run** `npx vitest run tests/component/agency-content-sections.test.tsx; echo "exit=$?"`. Expected: FAIL.
- [ ] **Step 3: Switch the six components.** `const content = useAgencyContent()` in each; no new copy.
  - **Hero:**
    - `<AgentPortrait portrait={content.agent.portrait} sizes={HERO_SIZES} />`. `HERO_SIZES` stays in Hero, and its comment about `index.html`'s preload stays.
    - `content.agent.byline` in both places, and `content.agent.licenceNumber` in place of the `L-00107009` literal. Update the comment that quotes the number.
    - `content.agent.bio.headline` for `hero.lead`.
    - `content.contact` for `tel:` and `wa.me`. The WhatsApp text stays `tc("contact.whatsappDefault")` (R7).
  - **About:**
    - the bio keys replace `t("about.family" | "credentials" | "career" | "insight" | "unique" | "signature")`;
    - join `family` and `credentials` with a space only when both are present, so today's string is identical;
    - render each other paragraph only when its text is present;
    - stats come from `content.agent.stats`, with a literal class map `{1: "grid-cols-1", 2: "grid-cols-2", 3: "grid-cols-3"}` and no strip at 0. Rewrite the `STATS` comment: it is now the data's length.
    - The eyebrow, the titles, the images and "עוד עליי" stay i18n (R7).
  - **Testimonials:** `useSiteTestimonials()`, and `useAgencyRole(content.agencyId, …)` in place of `AGENCY_1`.
  - **ReviewsWidget:** `useSiteTestimonials()`; each link renders only when it is non-null. Delete the TODO, which is now data.
  - **ProofCarousel:** `useSuccessCases()`. The fields are `c.tag`, `c.title`, `c.body`, `c.metric` and `c.estimate`. Keep the index-based keys and ids. Delete the `AGENCY1_CASES` import; it lives in the bundled builder now.
  - **StartConversation:** `content.agent.bookingUrl` replaces `CAL_LINK`, and `content.contact` replaces `CONTACT`.
- [ ] **Step 4: Run** the new test, then `npm run test:component; echo "exit=$?"` and `npm run test:contract; echo "exit=$?"`.
  - Expected: `exit=0`.
  - `proof-carousel`, `testimonials`, `sanity`, `i18n-home`, `home-phone-trims` and `start-conversation-lazy-chat` pass unchanged.
  - The `agents.contract` scan of `Hero.tsx` still finds no outcome promise.
- [ ] **Step 5: Commit.**

  ```bash
  git add src/components/dorit/sections tests/component/agency-content-sections.test.tsx
  git commit -m "Agency content: hero, about, testimonials, reviews, cases and the start section read the hook"
  ```

### Task 6: Contact and licence everywhere else on the public pages

**Files:**
- Modify:
  - `src/components/dorit/layout/{Footer.tsx,FloatingHeader.tsx,MobileStickyBar.tsx,FloatingActions.jsx}`
  - `src/components/dorit/primitives/CredentialsStrip.tsx`
  - `src/components/dorit/blog/{BlogContactBand.tsx,ArticleContactBox.tsx}`
  - `src/components/dorit/sections/SnapshotHome.tsx`
  - `src/pages/{PrivacyPolicy,Accessibility,Claims,FAQPage}.tsx`
- Create: `tests/component/agency-content-chrome.test.tsx`
- Modify: `tests/contract/agency-content-read.contract.test.ts`

**Interfaces:**
- Consumes: `useAgencyContent` (Task 4).
- Produces: `CONTACT_READERS`, the allow-list in the contract test.
  - **These files still import `@/config/contact`, by design:**
    - `src/components/ErrorBoundary.tsx`: it renders after the tree has failed and must not wait on a query;
    - `src/components/dorit/chat/AgentChat.tsx`, `src/components/dorit/forms/{NeedsWizard,QuickContact}.tsx`, `src/components/dorit/booking/OutlookCalendarBooking.tsx` and `src/components/dorit/account/SnapshotView.tsx`: the fallback contact of flows whose mail still goes to `_shared/recipients.ts`'s fixed addresses until Rollout 5;
    - `src/hooks/useSubmission.ts`, `src/lib/calculator-lead.ts` and `src/services/fallback-contact.ts`: not React.

- [ ] **Step 1: Write the failing contract cases** CTR-AGC-021…022 in `agency-content-read.contract.test.ts`:
  - the set of files under `src/` that import `@/config/contact` equals `CONTACT_READERS` exactly;
  - no code line (comments stripped) under `src/components/` or `src/pages/` contains `L-00107009`.

  Then write `tests/component/agency-content-chrome.test.tsx` (CMP-AGC-020…022), with the flag on and the sentinel record:
  - Footer shows `050-000-0000`, `mailto:` the sentinel email, and `L-0001`;
  - MobileStickyBar and FloatingHeader have `tel:` with the sentinel number;
  - PrivacyPolicy's `mailto:` is the sentinel email.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Switch each file.**
  - `const { contact, agent } = useAgencyContent()`, and `contact.*` / `agent.licenceNumber` in place of `CONTACT.*` and the literal.
  - `FloatingActions.jsx` keeps `contact.defaultWhatsappMessage`.
  - Where a module-level constant held the number (`CredentialsStrip`'s `LICENSE`), move it into the component.
- [ ] **Step 4: Run** the new tests, then `npm run test:component; echo "exit=$?"`, `npm run test:contract; echo "exit=$?"` and `npm run lint; echo "exit=$?"`. Expected: `exit=0` for each.
- [ ] **Step 5: Commit.**

  ```bash
  git add src/components src/pages tests/component/agency-content-chrome.test.tsx tests/contract/agency-content-read.contract.test.ts
  git commit -m "Agency content: header, footer, sticky bar and public pages take contact and licence from the hook"
  ```

### Task 7: The visual gate (R9) — e2e with the flag on

**Files:**
- Modify: `e2e/build-env.ts`, `tests/contract/e2e-build-env.contract.test.ts`, `e2e/fixtures/app.ts`, `e2e/api/backend-contract.spec.ts`
- Create: `e2e/ui/agency-content.spec.ts`

**Interfaces:**
- Consumes: `agency1ContentRows()` (Task 2); the fixture's `setTable`, `failOn` and `requestsTo`; `gotoApp`; `AGAINST_A_DEPLOYMENT` and `STUBS_UNREACHABLE`.
- Produces: E2E-AGC-001…005.

**Why one build:**
- The e2e bundle is sealed at build time, so one run has one value of the flag.
- The gate compares the flag on with the seeded content against the flag on with the content requests refused.
- The refused case falls back to the same `bundledAgencyContent` object the flag-off build renders. Task 4's tests prove that the flag-off hook is exactly that object, with no query.
- With the flag on, every other spec in the suite also runs against the seeded content.
- Production smoke keeps exercising the flag off.

- [ ] **Step 1: Switch the e2e build on and seed the fake.**
  - **`e2e/build-env.ts`:** add `VITE_AGENCY_CONTENT: "true"` with a comment: off in production, on here so the read side and its visual gate run in every spec. This is the reverse of `VITE_MASLEKA_ENABLED`.
  - **CTR-E2E-002:** add `VITE_AGENCY_CONTENT: "true"` to `toMatchObject`, with the same reason.
  - **`e2e/fixtures/app.ts`:** `stubBackend`'s default tables gain `...agency1ContentRows()`.
  - **`backend-contract.spec.ts`'s testimonials case:** also expect `params.get("agency_id") === "eq.00000000-0000-0000-0000-000000000001"`, and `params.get("select")` without `consent_confirmed`.
- [ ] **Step 2: Write `e2e/ui/agency-content.spec.ts`.**
  - `test.skip(AGAINST_A_DEPLOYMENT, STUBS_UNREACHABLE)`.
  - Before each test: `page.emulateMedia({ reducedMotion: "reduce" })`.
  - **The helper `capture(page)`:**
    - `await page.waitForLoadState("networkidle")`;
    - `await page.evaluate(() => document.fonts.ready)`;
    - it returns `{ png: await page.screenshot({ fullPage: true, animations: "disabled", caret: "hide" }), html: await page.locator("body").innerHTML() }`.
  - **E2E-AGC-001…003**, one test per route of `"/"`, `"/perspective"` and `"/privacy"`:
    - `gotoApp(page, route)`, then wait for `/rest/v1/public_agent_cards`, then capture A;
    - then `mockApi.failOn("/rest/v1/public_agency_sites", 503)`, `page.reload()`, `waitForAppLive`, and capture B;
    - assert `mockApi.requestsTo("/rest/v1/public_agent_cards").length >= 1` (the data path ran), `expect(B.html).toBe(A.html)`, and `expect(Buffer.compare(A.png, B.png), "the database render differs from the bundled one").toBe(0)`;
    - attach both PNGs with `testInfo.attach` before asserting.
  - **E2E-AGC-004:** `"/poa.html"` with `page.goto`, captured twice the same way. It is a static file (R4), included because R9 names it.
  - **E2E-AGC-005 (not vacuous):** `mockApi.setTable("public_agency_sites", [{ …row, phone_display: "050-000-0000" }])`, then `gotoApp("/")`, and the footer shows `050-000-0000`.
- [ ] **Step 3: Run** `CI=1 npx playwright test --project=web-chromium --project=android-chrome e2e/ui/agency-content.spec.ts; echo "exit=$?"`. It builds with the flag on. Expected: 10 passed (5 × 2), `exit=0`.
  - If a screenshot differs, open the attachments and find the cause. Never loosen the comparison.
- [ ] **Step 4: Run the whole e2e suite:** `CI=1 npx playwright test --project=web-chromium --project=android-chrome; echo "exit=$?"`.
  - Expected: `exit=0`. No unmodelled request, because the three tables are seeded.
  - The prerender spec passes on the bundled HTML.
- [ ] **Step 5: Commit.**

  ```bash
  git add e2e/build-env.ts e2e/fixtures/app.ts e2e/api/backend-contract.spec.ts e2e/ui/agency-content.spec.ts tests/contract/e2e-build-env.contract.test.ts
  git commit -m "Agency content: visual gate — flag on, seeded vs bundled, screenshot-identical"
  ```

### Task 8: Documents, full verification, the PR (not merged)

**Files:**
- Modify: `docs/current-state.md`, `README.md` (the `VITE_*` list near `VITE_CAL_LINK`), `AGENTS.md`
- Modify: `tests/test-plan/{01-std-unit,02-std-component,03-std-contract,04-std-security,06-std-ui-e2e,09-traceability-matrix}.md`

**Interfaces:**
- Consumes: every task above. Produces nothing in code.

- [ ] **Step 1: Write the documents.**
  - **`docs/current-state.md`:**
    - Add a row to "Backend selection": public agency content, with `VITE_AGENCY_CONTENT=true` plus a configured client reading `public_agency_sites`, `public_agent_cards` and `success_cases`. Otherwise, and on any error or a non-Hebrew locale, the bundled agency-1 constants are used. The prerender always uses the constants.
    - A line under "Agency access": anon reads agency data only through the two definer views, and `testimonials` by column grant (M-2).
  - **`README.md`:** a `VITE_AGENCY_CONTENT` entry.
  - **`AGENTS.md`:** one Key Files bullet covering four points:
    - the seed equals the bundled strings (`agency-content-seed.contract.test.ts`), so change both or neither;
    - the prerender stays on the constants until Rollout 5;
    - `CONTACT_READERS` is the deliberate list;
    - Dorit's portrait is the agency-1 special case.
  - **The STDs:**
    - add the new IDs: UNIT-POR, UNIT-AGC, CMP-POR, CMP-AGC, CTR-AGC, CTR-CIS, SEC-AGC and E2E-AGC;
    - note the CTR-E2E-002 change;
    - recount each header's declared cases and Vitest runs from an actual run, as #283's STD fix did;
    - add the traceability rows R1–R9 → test IDs.
- [ ] **Step 2: Full verification.** Run each command from Global Constraints and record its `exit=` line, then the stand-in command. Every one must be `0`. The PR records exactly which ran.
- [ ] **Step 3: Commit and open the PR.**
  - Commit: `git add docs README.md AGENTS.md tests/test-plan && git commit -m "Agency content: documents and test plan"`.
  - `git push -u origin feat/agency-content`.
  - `gh pr create --base feat/agency-onboarding`, with the title "New agency, step 2: Dorit as agency 1, read side behind VITE_AGENCY_CONTENT (off)".
  - The body states:
    - what ships dark, and that merging changes nothing a visitor sees;
    - **the apply order**: #285's `20261106000000`, then `20261106100000`, then `20261107000000`, each with `psql -1` and recorded in the migration history. The deploy job's migration check fails on a repository migration that production lacks, so they must be applied before this merges, like #285.
    - **a read-only query for the user to run in production before applying** (Review Focus 2):

      ```sql
      select display_name, phone_e164, phone_display, whatsapp, email, default_whatsapp_message
        from public.agency_profiles
       where agency_id = '00000000-0000-0000-0000-000000000001';
      ```

      Compare it with `AGENCY_PROFILE`. Any difference becomes visible the moment the flag goes on.
    - **flag on only by the user**, after `e2e/ui/agency-content.spec.ts` is green on a preview built with `VITE_AGENCY_CONTENT=true`;
    - **deferred:**
      - per-domain prerender, JSON-LD, `llms.txt` and `poa.html` (Rollout 5–6);
      - gendered templates (step 3);
      - Edge Functions reading `notify_emails`;
      - a loading state for an outside agency, which would briefly see agency 1's constants;
      - multi-licensee display;
      - testimonials `sort_order`.
  - **Do not merge.**
