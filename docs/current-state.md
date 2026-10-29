# Current architecture and operations

Checked against repository code on **2026-10-29**, after the Base44 exit (B1
#312 and B2). This describes implemented behavior and defaults, not a fresh audit
of deployed flags, account ownership, DNS, mail delivery or applied database
migrations.

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
The build, e2e and smoke jobs install the browser and its OS packages through
[`.github/actions/playwright-browser`](../.github/actions/playwright-browser/action.yml):
the `.deb` files are cached per runner image and installed with `dpkg`, so only the
first run after a runner-image update reaches the Ubuntu mirror, with a time limit
and a retry that avoids the Azure mirror (#304, after it stalled deploys on 2026-10-26).

**Base44: none.** The site, its backend and all four chat agents run on Vercel
and Supabase; the repository holds no Base44 code, SDK, adapter or switch
([exit record](base44-exit/README.md)). What remains of Base44 is `base44_id` on
rows that came from it and the `/blog/<24 hex>` old-link redirect. Two things in
code still name it: the `safe-arch-plan.base44.app` origin in
`supabase/functions/_shared/cors.ts` (pinned by `tests/unit/edge-cors.test.ts`)
and the mailer (`dorit-mailer` `send-email.js`), which still accepts `MAILER_TOKEN`.

### After the exit: dashboard actions

These are the account owner's, not the repository's:

- [ ] Delete the Vercel variables `VITE_BASE44_APP_ID`, `VITE_BASE44_SERVER_URL`,
  `VITE_BASE44_APP_BASE_URL`, `VITE_LEAD_FUNCTIONS`, `VITE_CONTENT_WRITES`,
  `VITE_UPLOAD_PROVIDER`, `VITE_CONTENT_IMAGES` and `VITE_CHAT_AGENTS`. Nothing
  reads them.
- [ ] Delete the GitHub secrets `BASE44_API_KEY`, `BASE44_ACCESS_TOKEN` and
  `BASE44_REFRESH_TOKEN`, and the variables `BASE44_APP_ID` and `BASE44_URL`.
- [ ] Revoke the Base44 connectors.
- [ ] Uninstall the Base44 GitHub App. The Builder restores five `.jsx` auth
  pages whenever its environment starts, and a `.jsx` beside a `.tsx` now turns
  `main` red (the frontend-payloads contract).
- [ ] Confirm whether the Base44 support agent still answers on WhatsApp, before
  deleting the app.
- [ ] Then delete the Base44 app.
- [ ] Follow-up PR: drop the `safe-arch-plan.base44.app` CORS origin (and its
  test) and the mailer's `MAILER_TOKEN`, then empty the token.

Allure reports publish separately to Cloudflare Pages. CI probes both report
hostnames for anonymous access, but currently warns rather than fails when the
report is public. Verify Access configuration directly before assuming privacy.

## Backend

[Service composition](../src/services/composition.ts) wires every port to Supabase
when both `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` are present;
without them each port is an `Unconfigured*` stand-in that reads empty and refuses
writes ("אין חיבור למאגר."), so a build without credentials still starts. Never put
service-role keys in `VITE_` variables. Frontend flags are build-time settings:
changing one requires a rebuild and deployment. The defaults below are the code's;
what production sets is checked in Vercel's environment variables, not here.

| Capability | Where it runs |
| --- | --- |
| Identity, personal area, memberships and user administration | Supabase Auth and tables |
| Public content and admin reads | Supabase tables |
| Admin lead writes | `leads` under the caller's session |
| Claim submission | the `submit-claim` Edge Function; documents in the private `claim-documents` bucket |
| Leads, interviews, handoffs and support logs | the `submit-lead`, `escalate-to-human` and `log-support-chat` Edge Functions |
| Content writes | the `content-admin` Edge Function; images in Supabase Storage |
| Chat | the `chat` Edge Function, for all four agents |

Feature switches:

| Switch | Behaviour |
| --- | --- |
| Clearinghouse | `VITE_MASLEKA_ENABLED=true` and a configured client; otherwise the unavailable adapter makes no requests |
| Call briefing | `VITE_LEAD_BRIEFING=true` shows "תדריך" in the lead drawer; the `lead-briefing` function also needs `LEAD_BRIEFING_MONTHLY_BUDGET_USD` above 0 (default 0, off). Both off until the privacy line and the adviser's sign-off (`docs/COMPLIANCE.md` §12) ([config](../src/config/lead-briefing.ts)) |
| Staff-entered leads | `VITE_STAFF_LEADS=true` shows "פנייה חדשה" on the leads screen for a member of agency 1, through `create-lead` and the `staff-intake-v1` notice ([config](../src/config/staff-leads.ts)). On in production since 2026-10-26; the adviser's approval of `staff-intake-v1` was still open then |
| Clients added by hand | `VITE_STAFF_CLIENTS=true` (with `VITE_STAFF_LEADS`) turns "פנייה חדשה" into "הוספה" with a client mode, product tags, "נפתחו כלקוחות" and the drawer's client fields; `create-lead` (kind `client`) and `invite-client` also need the Supabase secret `STAFF_CLIENTS=true` (exactly lowercase `true`). The privacy policy shows its line on these clients (section 2) with the same two build switches. All three on in production since 2026-10-26; the adviser's approval of the `staff-client-v1` notice and that line was still open then ([config](../src/config/staff-clients.ts)) |
| Analytics consent | `VITE_GA_CONSENT=true` loads GA4 only after the visitor's "אישור" in a consent card (bottom-right on desktop, above the phone's contact bar), with "הגדרות עוגיות" in the footer and a line in the privacy policy (section 6). Off: GA4 loads on every page as before. The flag reaches `index.html` through `<meta name="ga-consent">`, so the inline script's CSP hash is the same either way. Off until Dorit's adviser decides ([consent](../src/lib/consent.ts), [COMPLIANCE §8](COMPLIANCE.md)) |
| Client meetings | `VITE_MEETINGS_STAFF` (the lead drawer's meetings) and `VITE_MEETINGS_CLIENT` ("הפגישות שלי" in `/account`), each off by default ([config](../src/config/meetings.ts)) |
| Public agency content | `VITE_AGENCY_CONTENT=true` plus a configured client reads `public_agency_sites`, `public_agent_cards` and `success_cases` for the agency that claims the host name. Otherwise, while loading, on any error and for a non-Hebrew locale, the bundled agency-1 constants are used. The prerender always uses the constants ([config](../src/config/agency-content.ts)) |

`blog_posts` is the one article store; `scripts/seed-blog.mjs` writes only there.

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

Anonymous visitors read agency data only through the two definer views, `public_agency_sites` and `public_agent_cards`; they have no grant on `agency_profiles`, `agencies` or `agents`. `testimonials` is read by column grant: `anon` cannot read `consent_confirmed_by` or `consent_confirmed_at`, and `authenticated` can read the date but not the name (review M-2).

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
Consent and attribution come from the conversation row. The function runs the
interview's `submitLead` itself; the page only counts the `lead_saved` signal.

## Mail, calendars and personal data

All outbound mail goes through `dorit-mailer/functions/api/send-email.js` on
Cloudflare Pages. It holds the Resend key and verified sender. The Edge Functions
hold `MAILER_URL` and their caller token; use the [README mailer runbook](../README.md)
for configuration. Do not restore direct Resend keys in backend setup instructions.

Supabase's `_shared/recipients.ts` defines `SECONDARY_EMAIL`, notification
recipients (with the `NOTIFY_EMAILS` secret override), and calendar attendees.
Attendees include the secondary address and notification addresses; invitation
handling accounts for the calendar owner.
The Edge calendar writer uses a service account to create a Google event without
attendees; Outlook receives an ICS invitation by mail. Verify ownership and
sharing against the external account, not a repository assumption.
Human-readable dates use Israel time; preserve provider-specific timezone names.

A new account gets one welcome mail (`welcome-user`, #306): the app asks after a
sign-in whose address was confirmed in the last 30 minutes, and the function
checks that again and sends once per account. Accounts made earlier get nothing
unless the operator runs the service-key resend (#308; see the function's header).

Rate limits go through `allow_submission`, which keeps each row until its own
window ends (windows up to 366 days since migration 20261114000000; before it,
anything over a day was refused and so never held). `withinLimit` fails open, for
request volume and mail to the agency's own staff; a limit on mail to an address
someone typed uses `limitCheck` and sends only on `'ok'`, so a limiter outage
holds that mail instead of making it unlimited (#309).

Edge Functions call PostgREST through `_shared/rest.ts`. A `void` function answers
204 with no body, which `callRpc` reads as `null` (#305); test stubs must answer
the same way, or a failure after a successful write goes unseen.

Never return internal exception messages or log personal data. Keep request IDs
through the response and logs. Analytics goes through `src/lib/analytics.ts` and
its restricted parameters; saved leads count only after successful persistence.
GA4 disclosure and consent remain an open compliance item in
[COMPLIANCE.md](COMPLIANCE.md); the banner and policy line wait behind `VITE_GA_CONSENT`.

## Verification and document maintenance

For application changes run `npm run lint`, `npm run typecheck`,
`npm run build:prerender`, the five Vitest suites (`test:unit`, `test:component`,
`test:contract`, `test:integration`, `test:security`) and `npm run test:e2e`, or
`./scripts/run-tests.sh`. Contract tests read component and workflow source, so a
change that looks UI-only can still fail them. Since 2026-10-18 the e2e bundle is
built with production's switches (`e2e/build-env.ts`, `npm run build:e2e`) against
a fake Supabase host the e2e fixture answers, so the suite exercises the Supabase
adapters. Live API and model evals are opt-in
and can contact deployed services; consult [the test plan](../tests/test-plan/README.md)
first. Update the relevant STD when tests change. Documentation-only changes need
link, command and source checks; record exactly which checks ran.

Treat dated measurements, design decisions and incident findings as historical
records. Add current status and links rather than rewriting old evidence as if it
were measured today. Blog articles, legal text, consent notices and agent prompts
are product behavior, not routine developer documentation to refresh mechanically.
