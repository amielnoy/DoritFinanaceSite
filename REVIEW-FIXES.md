# Review fixes — 2026-10-15

Branch `review-fixes-2026-10-15`, on `origin/main` d64ffba. One commit per item, each with a test, and the STDs in `tests/test-plan/` updated. Nothing pushed or deployed, and no production data touched.

Final gate on 5f133f4: `npm run lint`, `npm run typecheck`, `deno check --no-config supabase/functions/*/index.ts` and `CI=1 npm run build:prerender` all pass. `npm run test:vitest` passes: 240 files, 4,194 tests, 18 skipped. The SQL checks in `supabase/tests/` (`storage_check.sql` changed for item 10) need a database and did not run here; they run in CI.

## Summary

| # | Item | Status | Files | Tests |
|---|---|---|---|---|
| 1 | `invitee_for` must not resolve an unconfirmed account | Done | migration `20261031000000_invitee_confirmed.sql` | SQL check + unit |
| 2 | Sheet cells: formula-like values stored as text | Done | `sheetCell` (shared sheet writer) | unit |
| 3 | submit-lead: per-IP limit and staff-notification cap | Done | `supabase/functions/submit-lead` | integration, STD 12 §4.2a |
| 4 | escalate-to-human: field limits, `escalate-ip` 20/h; urgent reasons never held back | Done | `supabase/functions/escalate-to-human` | integration, STD 12 |
| 5 | log-support-chat: `support-ip` 60/h, `support-log` 300/h | Done | `supabase/functions/log-support-chat` | integration |
| 6 | One `clientIp`: cf-connecting-ip, else the last XFF hop, else one shared key; chat `chat-new-ip` 20/h | Done | `_shared/guard.ts`, every limiter, `chat/handler.ts` | `edge-client-ip.test.ts`, handler cases |
| 7 | Base44 createConsultationEvent: kept for stale clients, capped at 20/h, no provider text in the answer | Done | `base44/functions/createConsultationEvent` | `create-consultation-event.integration.test.ts` |
| 8 | upsertContact: shared secret (`CONTACT_FUNCTION_SECRET`, fails closed), `contact-ip` 30/h, fill-only updates | Done | `base44/functions/upsertContact` | integration |
| 9 | Interview saves meet by `conversation_ref`, never by phone and name | Done | migration `20261101000000_lead_conversation_ref.sql`, submit-lead, chat tools, NeedsWizard, AgentChat | unit, contract `lead-conversation-ref` |
| 10 | Claim documents only under the name the form makes | Done | migration `20261102000000_claim_documents_object_name.sql`, `storage_check.sql` | contract `claim-documents-object-name` |
| 11 | A status request answers only for the turn that timed out | Done | `chat/handler.ts`, `SupabaseAgentService.ts` | UNIT-CHHANDLER-076..078, UNIT-CHADAPTER-022 |
| 12 | The page makes the conversation's id and token; a resend reaches the same row; the dead late-answer branch is gone | Done | `chat/handler.ts`, `chat/store.ts`, `SupabaseAgentService.ts` | UNIT-CHHANDLER-079..083, UNIT-CHADAPTER-001/011/021/023/024 |
| 13 | AgentChat: generation ref + AbortController; reset and unmount abandon the send | Done | `AgentChat.tsx`, `ports.ts`, `RoutedAgentService.ts`, `services/index.ts`, adapter | UNIT-CHADAPTER-026/027, UNIT-CHROUTE-003, CMP-CHATFN-016/017 |
| 14 | Recovery ending while the turn still runs is "still processing", not a failure | Done | adapter, `agent-errors.ts`, `AgentChat.tsx` | UNIT-CHADAPTER-020/025, CMP-CHATFN-015 |
| 15 | listMessages reads the newest 200 | Done | `chat/store.ts` | UNIT-CHSTORE-003 |
| 16 | consentAt clamped to [now − 2 h, now] | Done | `chat/handler.ts` | UNIT-CHHANDLER-072..075 |
| 17 | Leads: escalated counted in "דורשות טיפול" and in a User's menu counter | Done; the chips and the disabled current-status option were already in #244 | `Leads.tsx`, `SupabaseLeadAdminService.ts` | CMP-ATTN-001/002, UNIT-LEADTX-009 |
| 18 | Testimonials: failures in `role="alert"`, confirm before delete | Done | `Testimonials.tsx` | CMP-TESTIM-ADM-001..004 |
| 19 | ClaimForm: drag-and-drop, `sr-only` picker, `role="alert"` | Done. Already there: `accept`, the 10 MB check and the input reset. **Skipped: `isIsraeliMobile`** — the form uses `isContactPhone`, the rule submit-claim applies; mobile-only would refuse a landline the function accepts and Dorit can call | `ClaimForm.tsx` | CMP-CLAIMDOC-001..003 |
| 20 | pension-fee clamps: years 0–60, percentages 0–100 | Done | `src/lib/pension-fee.ts` | UNIT-PFC-016..018 |
| 21 | GA4: no admin URL or query string | Done, as Google's opt-out flag on `/admin`. `send_page_view:false` and a `page_location` override do not stop GA4's own history page views | `index.html`, `vercel.json` (CSP hash), `App.jsx`, `analytics.ts` | UNIT-GAADMIN-001..011 |
| 22 | Lazy AgentChat in StartConversation | Done. Entry chunk 473,997 → 337,775 B (140,328 → 100,007 gzip); all up-front JS 935,093 → 798,907 B (288,942 → 248,641 gzip, −14%) | `StartConversation.tsx` | CMP-LAZYCHAT-001 |
| 23 | Self-hosted favicon, monogram ד | Done, also in the web manifest | `public/favicon.svg`, `index.html`, `public/manifest.json` | CTR-ICON-001/002 |
| — | Role-aware RLS (needs decision) | Decided and shipped as the agency roles (#244) | — | — |

## Manual steps before or at merge

1. **Apply the three migrations to production, in order**: `20261031000000_invitee_confirmed`, `20261101000000_lead_conversation_ref`, `20261102000000_claim_documents_object_name`. Insert each one's row into `supabase_migrations.schema_migrations`, or `check-migrations` fails. Apply 20261101 before the functions deploy, because submit-lead writes `conversation_ref`.
2. **Supabase Auth**: turn "Confirm email" ON (or turn email sign-up off). Item 1 relies on confirmed accounts.
3. **Base44 `CONTACT_FUNCTION_SECRET`**: set it only if some channel still calls upsertContact. Without it the function refuses every call, which is the intended default.
4. **The chat's wire changed (items 11–12)**. The functions deploy before Vercel in the pipeline, so the new server is live before the new page. A page from before still works, through the server-made-token path.
5. **GA4 (item 21, optional)**: a navigation from a public page into `/admin` may still be counted once, as the path alone (menu links carry no query). Turning off "Page changes based on browser history events" in the GA4 data stream would close that too, but SPA page views would then have to be sent by hand.
