# Claims and the admin's lead writes → Supabase

**Date:** 2026-10-12 · **Status:** design, not yet implemented.

**Parent:** [docs/base44-exit/00-inventory.md](../../base44-exit/00-inventory.md) ("Step 4 · functions → Vercel", carried out on Supabase Edge Functions per Phase 2)
and [2026-10-10-multi-agent-platform-design.md](2026-10-10-multi-agent-platform-design.md) (Phase 2, "Off Base44").
This is the sixth piece of that phase. Storage (#134), the mail cutover (#137),
the auth cutover (#139) and the reads (#142) are done.

## Why this piece

Nine Base44 functions remain. Four of them hold the connector OAuth tokens
(`submitLead`, `escalateToHuman`, `createConsultationEvent`, `logSupportChat`)
and wait for the connector piece. `contentAdmin` writes `BlogPost`, which three
agents still read from Base44, so it waits for the agents. That leaves three
that can leave now:

| Function | Base44 dependency today | After this piece |
|---|---|---|
| `submitClaim` | `entities.Lead.create`, then a copy to Supabase | Edge Function `submit-claim`, writes Supabase only |
| `adminLead` | `entities.Lead.update/delete`, plus Supabase | no function: the browser writes `leads` under Dorit's session |
| `myAccount` | none, and no caller | deleted |

This is also the piece that builds what every later function needs: the first
Edge Function, its shared modules, its test harness and its CI deploy.

## Decisions taken

- **Base44's `Lead` copy goes stale.** Claims, status changes and deletions stop
  reaching it. Supabase is the record and every screen already reads it. The
  only Base44 reader of `Lead` is `submitLead`'s six-hour "open interview"
  lookup, which only matches `source='interview'` rows, so it is unaffected.
- **Supabase-native, not a one-to-one port.** Admin writes need no function,
  because the access rules already allow them.
- **CI deploys the function on green `main`.** It uses the GitHub secret
  `SUPABASE_ACCESS_TOKEN`: a scoped token with only Edge Functions read-write
  on DoritFinanaceSite, checked on 2026-10-12. It can list functions and is
  authorised to write them. It is refused API keys, function secrets and SQL.

## Scope

**In:**

- **`supabase/functions/submit-claim/`:**
  - `handler.ts` exports `handler(req: Request): Promise<Response>`.
  - `index.ts` is only `Deno.serve(handler)`.
- **`supabase/functions/_shared/`:** only the helpers `submit-claim` uses,
  moved from `base44/functions/submitClaim/entry.ts` unchanged in behaviour:
  - `log` and the request id
  - `sendMail` with `upstreamReasons` and `deliveryWarning`
  - `escapeHtml` and `buildClientHtml`
  - `validChannel`, `validCampaign`, `validLandingPath` and `channelLine`
  - `deviceLabel`
  - `cors.ts`, which is new
- **`supabase/config.toml`:** `[functions.submit-claim]` with `verify_jwt = false`.
- **`src/services/supabase/SupabaseLeadService.ts`:** implements `LeadPort`.
  - `submitClaim` calls `functions.invoke("submit-claim", …)`.
  - `submitLead`, `submitInterview` and `requestConsultationEvent` delegate to
    the `Base44LeadService` it is given.
- **`src/services/supabase/SupabaseLeadAdminService.ts`:**
  - `setStatus` and `remove` write `leads` directly; the `writes` delegate is removed.
  - `list` hands out the Supabase `id`.
- **`src/services/index.ts`:** `leads` is a `SupabaseLeadService` when `tables`
  exists. `leadsAdmin` is a `SupabaseLeadAdminService` with no Base44 writer.
- **CI:** a `deploy-supabase` job, and "Publish to Base44" waits for it.
- **Smoke:** one new case against `submit-claim`.
- **Removed:**
  - `base44/functions/myAccount/` and `tests/integration/my-account.integration.test.ts`
  - its line in `AGENTS.md`
  - its entries in `tests/test-plan/00-master-test-plan.md`, `01-std-unit.md` and `12-std-integration.md`
  - its row in `docs/base44-exit/00-inventory.md`, recounted

**Out:**

- `base44/functions/submitClaim` and `adminLead` stay deployed and untouched
  until Base44 is switched off. They are the rollback.
- No migration. `leads.agency_id` defaults to agency 1. The policies
  `leads_update_admin` and `leads_delete_admin` already allow
  `can_see(agency_id) or is_admin()`, and `channel` and `campaign` exist.
  `base44_id` is nullable and unique.
- Uploads are unchanged: `SupabaseUploadService` and the private
  `claim-documents` bucket already serve claims.
- Mail is unchanged: `dorit-mailer`, with the same recipients and the same
  templates.

## The claim, end to end

1. `ClaimForm` uploads documents through `services.uploads` (unchanged), then
   calls `services.leads.submitClaim(report)`.
2. `SupabaseLeadService.submitClaim`:
   - Sends the same body `Base44LeadService.submitClaim` sends: the same keys,
     with empty strings and `[]` for missing values.
   - Calls it through `supabase.functions.invoke("submit-claim", { body })`.
   - On success, returns the response as the `SubmissionReceipt`.
   - On an error, throws an `Error` carrying the function's `error` and `rid`
     when present. `ClaimForm`'s `useSubmission` already turns any thrown
     error into its own failure message with Dorit's contact details, so the
     visitor sees exactly what they see today.
3. `submit-claim`:
   1. An `OPTIONS` request gets a CORS preflight answer (below) and nothing else.
   2. A missing name or phone gives **400**
      `{ error: 'נדרשים שם וטלפון', rid }`, with no row and no mail.
   3. It builds `agentBody`, `subject` and `messageBody` exactly as today.
   4. It inserts into `leads` with `POST ${SUPABASE_URL}/rest/v1/leads`, using
      the service key, `Prefer: return=representation`, and the columns
      `name, phone, email, source:'claim', topic, timing, message, status:'new', channel, campaign`.
      `agency_id` takes its default; `base44_id` is omitted.
   5. **If the insert fails** (any non-2xx or a network error), it logs
      `lead.create_failed` and returns **500**
      `{ error: 'לא הצלחנו לשמור את הדיווח. נסו שוב או צרו קשר ישירות.', rid }`.
      **No mail is sent.** An unsaved claim is never announced.
   6. It sends the ops mail to each of `NOTIFY_EMAILS`, the agency copy to
      `SECONDARY_EMAIL`, and the visitor confirmation when an email was given.
      Each failure is logged as `mail.failed` with its role and added to
      `warnings`, and never fails the request.
   7. It returns **200** `{ ok: true, rid, leadId, warnings }`, where `leadId`
      is the Supabase `id`.
   8. Anything thrown outside these steps gives **500** with today's generic
      Hebrew message, logged as `request.failed`.

The plain `fetch` is deliberate. The Base44 functions already write Supabase
this way (`mirrorLeadToSupabase`). It keeps the function free of imports, so
the in-process harness can run it with only `fetch` and `Deno.env` stubbed.

**Logging** keeps today's event names and the rule in
`tests/contract/logging.contract.test.ts`: what happened, never who. The
contract test's scan is extended to `supabase/functions/**`.

**Secrets:**

| Secret | Who provides it |
|---|---|
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Supabase, automatically |
| `MAILER_URL`, `MAILER_TOKEN` | set once by hand in the dashboard (see Rollout) |

If either mailer secret is missing, `sendMail` throws as today: the claim is
saved and each mail becomes a warning.

### CORS

`supabase-js` sends `authorization`, `apikey`, `content-type` and
`x-client-info` headers, so the browser always preflights. `_shared/cors.ts`:

- Allows these origins:
  - `https://govari-fin.co.il` and `https://www.govari-fin.co.il`
  - `https://safe-arch-plan.base44.app`
  - any `https://*.vercel.app` whose host starts with `dorit-finance-site`
    (the project's production and preview hosts — spelled "finance", unlike
    the repository)
  - `http://localhost:<port>` and `http://127.0.0.1:<port>`
- An allowed origin gets `Access-Control-Allow-Origin: <that origin>` and
  `Vary: Origin`. Any other origin gets no allow header, so the browser blocks
  the response.
- `Access-Control-Allow-Headers` allows `authorization, apikey, content-type, x-client-info`.
- `Access-Control-Allow-Methods` allows `POST, OPTIONS`.

CORS is browser hygiene, not access control. The function is public, as the
claim form is today, and its protection is the same as today's: validation and
the bucket's limits.

## The admin's lead writes

`SupabaseLeadAdminService`, under Dorit's session:

- **Status:** `setStatus(id, status)` runs
  `from("leads").update({ status }).eq("id", id).select("id")`.
- **Delete:** `remove(id)` runs `from("leads").delete().eq("id", id).select("id")`.
- **Silent refusals:** an error from PostgREST is thrown. An empty result is
  thrown too, as `Error("הפעולה לא בוצעה — אין הרשאה או שהפנייה כבר לא קיימת")`,
  because a write the access rules refuse changes 0 rows and returns no error.
  The admin screen already shows a thrown error.
- **Ids:** `list()` maps each row with `id` set to the **Supabase `id`**, not
  `base44_id ?? id`. The fix stays inside this adapter: `toPortRow` is shared
  with content admin, whose writes still go to `contentAdmin` and need Base44
  ids, so `toPortRow` is unchanged.
- **Meetings:** deleting a lead deletes its `meetings` row through the existing
  `on delete cascade` on `lead_base44_id`, the same as `adminLead` does today.

## Deployment

**CI job `deploy-supabase`** in `.github/workflows/ci.yml`:

- **When:** only on a push to `main`, after the same green test jobs "Publish
  to Base44" waits for. It never runs on red, and never on pull requests or
  other branches.
- **Without the token:** if `SUPABASE_ACCESS_TOKEN` is empty, it prints a
  notice and succeeds, the same opt-in shape as the Base44 publish.
- **Command:** `supabase functions deploy --project-ref hjowdyiwjjrqceumkvgt --use-api`,
  naming no function: every directory under `supabase/functions` except
  `_shared`, so the next function needs no CI edit. `--use-api` bundles on
  Supabase's side, so the runner needs no Docker.
- **Order:** production has been served by **Vercel** since 2026-10-11
  (`govari-fin.co.il` → Vercel), so both productions wait:
  - "Publish to Base44" adds `deploy-supabase` to its `needs`.
  - Vercel's "Choose production or preview" step passes `--prod` only when
    `needs.deploy-supabase.result == 'success'`. A red run still deploys a
    preview.
- **Type-check:** `deno check` on `supabase/functions/*/index.ts` runs in the
  test job, because `tsc` covers `src/**` only.

**Production smoke test:** a new case posts `{}` to
`${VITE_SUPABASE_URL}/functions/v1/submit-claim` with the publishable key and
`Origin: https://govari-fin.co.il`. It expects:

- **400**, with a `rid` in the body
- an `Access-Control-Allow-Origin` header echoing the origin

This proves the function is deployed, reachable and answering for the site,
and it creates no lead. It covers the one failure the deploy gate cannot: a
skipped deploy.

## Rollout

1. **Before merging** (one-time, by hand): in the Supabase dashboard, open
   Edge Functions, then Secrets, and set `MAILER_URL` and `MAILER_TOKEN` to the
   values the Base44 functions use.
2. Merge. On green, CI deploys `submit-claim`, then publishes the site.
3. The smoke test checks the deployed function.
4. **After deploy:** one real claim with the note "בדיקה". Check three things:
   - the row in Supabase `leads`
   - Dorit's and the ops mail
   - the function's log in the dashboard

   Then change that lead's status and delete it from `/admin/leads`, checking
   the table after each step.

**Rollback:** revert the composition-root change. Claims and admin writes go
back to the Base44 functions, which are still deployed. Nothing on the data
side needs undoing.

## Testing

**The Edge Function, executed** (vitest, in-process):

- **Harness:** `tests/helpers/edge-function.ts` loads
  `supabase/functions/<name>/handler.ts` with esbuild, the way
  `tests/helpers/base44-function.ts` loads Base44 functions. It:
  - stubs `Deno.env`
  - records every `fetch`
  - answers PostgREST and the mailer
  - can fail the insert or a single mail
- **Parity:** `tests/integration/submit-claim.integration.test.ts` runs its
  existing cases against **both** implementations through a small adapter that
  normalises "rows written" and "mail sent":
  - stored and notified
  - 400 without name or phone, with no row and no mail
  - 500 on a failed save, with no mail
  - a bounced mail becomes a warning
  - the visitor confirmation only with an email
  - escaped HTML
- **Edge-only cases:**
  - the inserted row has `source='claim'`, `status='new'`, no `base44_id`, and
    today's `message` text
  - `leadId` is the inserted row's `id`
  - an allowed origin gets the allow header; any other origin does not
  - an `OPTIONS` request writes nothing and sends nothing
- **Logging contract:** the forbidden-field scan includes `supabase/functions/**`.

**Frontend** (unit):

- **`SupabaseLeadService`:**
  - `submitClaim` invokes `submit-claim` with today's body
  - a function error becomes a thrown `Error` carrying its Hebrew message
  - the other three methods reach the Base44 delegate untouched
- **`SupabaseLeadAdminService`:**
  - `setStatus` and `remove` hit `leads` by `id`
  - a PostgREST error is thrown
  - **an empty result is thrown**
  - `list()` returns Supabase ids
- **Composition root:** with Supabase configured, `services.leads` and
  `services.leadsAdmin` are the Supabase adapters; without it, the Base44 ones.

**Contract:**

- **Workflow** (`workflow.contract.test.ts` / `deploy-gate.contract.test.ts`):
  - `deploy-supabase` runs only on a `main` push after the test jobs
  - it skips without the token
  - it deploys with `--project-ref hjowdyiwjjrqceumkvgt`
  - "Publish to Base44" needs it
- **`supabase/config.toml`:** `submit-claim` has `verify_jwt = false`.

**Before the PR:** the full vitest suite, eslint, tsc, and e2e (`ui`, `a11y`,
`security`, `api` on web-chromium and android-chrome). e2e runs with Supabase
switched off (`playwright.config.ts` pins `VITE_SUPABASE_*` empty), so it covers
the Base44 path. The Supabase path is covered by the tests above and the smoke
test.

## Known risk

- **The first deploy is the first use of the token for a write.** The check on
  2026-10-12 got 404, not 403, on a function write, so the permission is in
  place. A CLI call needing a permission nobody anticipated would fail the
  `deploy-supabase` job by name, and the site would not publish.
- **Origins not on the CORS list.** Any host serving the site that is not on
  the list cannot submit a claim. A Vercel host named differently would be one;
  the smoke test checks only production. The list is one constant in
  `_shared/cors.ts`.
- **Base44's `Lead` table stops being complete.** Nothing reads it for claims
  or statuses, and this was agreed. Comparing the two stores
  (`scripts/reconcile-stores.mjs`) will report claims and admin changes as
  Supabase-only from here on. That is expected, the same as piece 5's newer
  rows.
