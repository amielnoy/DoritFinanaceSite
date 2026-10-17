# Current architecture and operations

Checked against repository code on **2026-10-17**, after Base44 cleanup 1 (#262).
This describes implemented behavior and defaults, not a fresh audit of deployed
flags, account ownership, DNS, mail delivery or applied database migrations.

## Hosting and releases

Production is `https://govari-fin.co.il` on Vercel. Vercel prerenders public
routes and published articles. The canonical origin defaults to the production
domain. See [README](../README.md) for local setup and release commands.

[CI](../.github/workflows/ci.yml) deploys Supabase functions after successful build,
Vitest and browser jobs, then promotes Vercel production from a green `main` push.
A successful build with failed tests can still become a Vercel preview. The nightly
scheduled run rebuilds Vercel production after green checks and the Supabase
deployment. Missing deployment credentials must not be confused with a successful
release; production smoke checks publication and waits for the expected served asset.

**Nothing is published to Base44 any more** (2026-10-17). The Base44 host
(`safe-arch-plan.base44.app`) still serves the last version published there, and
the Base44 code and adapters remain in the repository as a rollback path until
cleanup 2, on or after 2026-10-29 ([exit record](base44-exit/README.md)). A
rollback to a Base44 adapter is a build-time flag change; any Base44-side change
would also need a manual deploy and a dashboard Publish, which CI no longer runs.

Allure reports publish separately to Cloudflare Pages. CI probes both report
hostnames for anonymous access, but currently warns rather than fails when the
report is public. Verify Access configuration directly before assuming privacy.

## Backend selection

[Service composition](../src/services/composition.ts) selects adapters. Frontend
flags are build-time settings: changing one requires a rebuild and deployment.
Supabase is configured when both `VITE_SUPABASE_URL` and
`VITE_SUPABASE_PUBLISHABLE_KEY` are present. Never put service-role keys in `VITE_`
variables. The defaults below are the code's; what production sets is checked in
Vercel's environment variables, not here.

| Capability | Selection and fallback |
| --- | --- |
| Identity, personal area, memberships and user administration | Supabase; without it, unconfigured adapters expose no signed-in identity or agency membership |
| Public content and admin reads | Supabase when configured; otherwise Base44 |
| Admin lead writes | Supabase under the caller's session when configured; otherwise the Base44 `adminLead` function |
| Claim submission | Supabase `submit-claim` when configured; otherwise Base44 |
| Leads, interviews, handoffs and support logs | `VITE_LEAD_FUNCTIONS=supabase` plus a configured client selects Edge Functions; default is the Base44 adapter |
| Content writes | `VITE_CONTENT_WRITES=supabase` plus a configured client selects `content-admin`; default is Base44 `contentAdmin` |
| Claim documents | `VITE_UPLOAD_PROVIDER=supabase` plus a configured client; default Base44 |
| Public content images | Independent `VITE_CONTENT_IMAGES=supabase` switch; default Base44. The About and footer photos are files in `public/images/` since #262 |
| Chat | `VITE_CHAT_AGENTS` selects agent names individually; empty by default, or without Supabase, uses Base44. Production serves all four from the chat function |
| Clearinghouse | `VITE_MASLEKA_ENABLED=true` and a configured client; otherwise the unavailable adapter makes no requests |
| Client meetings | `VITE_MEETINGS_STAFF` (the lead drawer's meetings) and `VITE_MEETINGS_CLIENT` ("הפגישות שלי" in `/account`), each off by default ([config](../src/config/meetings.ts)) |

The Base44 adapter does not imply all work executes there: `submitLead` and
`escalateToHuman` are forwarders to Supabase. Inspect the function entry point when
tracing requests. Removing a chat name or reverting a provider flag restores that
adapter on the next build, but does not copy records between stores. Content created
only in Supabase cannot be edited through the Base44 content rollback path.

Content writes were held on Base44 while a Base44 agent still read `BlogPost`.
Production switched to `VITE_CONTENT_WRITES=supabase` on 2026-10-16, and all four
roles now run on the chat function — `needs_interview`, `support_agent`,
`procedures_agent`, `blog_recommender` — so `blog_posts` is the one article store;
`scripts/seed-blog.mjs` writes only there.

## Agency access

[Permissions](../src/config/permissions.ts) distinguish Owner, Admin and User from
the platform operator (`profiles.role = 'admin'`). Agency roles belong to
`memberships.role`; a platform operator is not an agency Admin.

| Role | Scope |
| --- | --- |
| User | Assigned leads and their related work, status changes, visible-data exports and article drafts |
| Admin | Agency-wide leads, assignment, deletion, publication, testimonials and management of Users |
| Owner | Admin capabilities, management of Admins, agency profile and ownership transfer |
| Platform operator | Platform-wide access and shared-library administration |

The frontend table chooses controls; SQL and Edge Functions enforce access.
`can_see_lead` governs lead-related reads; `can_see(agency)` alone is insufficient.
Rows naming a lead or request must bind it to the row's agency. Memberships change
only through `set_member_role` and `remove_member` with the caller's session.
Every agency must retain an Owner.

The role-narrowing migrations were released on 2026-10-16. A lead with no assignee
is visible to the agency's Admins and Owners and to the platform operator, so a
User sees it only once it is assigned — in the admin screen, or in bulk with
`scripts/assign-open-leads.mjs` (review its plan before applying it). The
[roles design](superpowers/specs/2026-10-15-agency-roles-design.md) and
[contract STD](../tests/test-plan/03-std-contract.md) contain the detailed rules.
Repository presence alone does not establish that a later migration has run in production.

## Chat and prompts

Sources live in `supabase/functions/chat/prompts/`. After an intentional prompt
change run `npm run build:chat-prompts`; the change ships with the chat function
in CI's Supabase deployment. Role tools are restricted in `handler.ts`. FAQ and
procedures support records are written by the sweep, not by a model tool call.
Consent and attribution come from the conversation row.

The Base44 agent definitions under `base44/agents/` are no longer published.
Until cleanup 2 removes them, `chat-prompts.contract.test.ts` still holds their
JSONC prompts to the Markdown sources, so keep both in step. The page-side fenced
`lead` handoff for the Base44 interview stays while that rollback transport is in
the code.

## Mail, calendars and personal data

All outbound mail goes through `dorit-mailer/functions/api/send-email.js` on
Cloudflare Pages. It holds the Resend key and verified sender. Backends hold
`MAILER_URL` and their own caller token; use the [README mailer runbook](../README.md)
for configuration. Do not restore direct Resend keys in backend setup instructions.

Supabase's `_shared/recipients.ts` defines `SECONDARY_EMAIL`, notification
recipients (with the `NOTIFY_EMAILS` secret override), and calendar attendees.
Attendees include the secondary address and notification addresses; invitation
handling accounts for the calendar owner. Base44 copies are protected by contracts.
The Edge calendar writer uses a service account to create a Google event without
attendees; Outlook receives an ICS invitation by mail. Retained Base44 calendar
code uses OAuth connectors. Verify ownership and sharing against the external
account, not a repository assumption.
Human-readable dates use Israel time; preserve provider-specific timezone names.

Never return internal exception messages or log personal data. Keep request IDs
through the response and logs. Analytics goes through `src/lib/analytics.ts` and
its restricted parameters; saved leads count only after successful persistence.
GA4 disclosure and consent remain an open compliance item in
[COMPLIANCE.md](../base44/agents/COMPLIANCE.md).

## Verification and document maintenance

For application changes run `npm run lint`, `npm run typecheck`,
`npm run build:prerender`, the five Vitest suites (`test:unit`, `test:component`,
`test:contract`, `test:integration`, `test:security`) and `npm run test:e2e`, or
`./scripts/run-tests.sh`. Contract tests read component and workflow source, so a
change that looks UI-only can still fail them. Live API and model evals are opt-in
and can contact deployed services; consult [the test plan](../tests/test-plan/README.md)
first. Update the relevant STD when tests change. Documentation-only changes need
link, command and source checks; record exactly which checks ran.

Treat dated measurements, design decisions and incident findings as historical
records. Add current status and links rather than rewriting old evidence as if it
were measured today. Blog articles, legal text, consent notices and agent prompts
are product behavior, not routine developer documentation to refresh mechanically.
