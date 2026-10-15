# Chat agents off Base44 — the interview first, on our own `chat` function

Phase 3 of [the platform design](2026-10-10-multi-agent-platform-design.md)
("Chat as a backend function"), the piece after
[connectors off Base44](2026-10-12-connectors-off-base44-design.md).

**Status:** design approved in conversation 2026-10-13; this document is for review.

## Why this piece

After the connectors piece, Base44 runs only the four chat agents
(`needs_interview`, `support_agent`, `procedures_agent`, `blog_recommender`),
their three tool forwarders and `contentAdmin`. The agents are what is left of the
lock-in, and they carry the defect that hurts most:

- **A-59.** Base44 does not run an agent's tools in an anonymous conversation, and
  every visitor is anonymous. The interview works around it by ending in a fenced
  `lead` block that `AgentChat` parses and submits (`readHandoff()` in
  `src/lib/interview-handoff.ts`). Of 40 leads recorded, none came from a real
  visitor.
- **No transcripts.** Conversations live only inside Base44's agent runtime. The
  repo has no copy and no way to read one back; Dorit cannot see what a client
  said before the meeting.
- **No control.** The model is `"automatic"`, the 1,000-character and 40-turn
  limits are enforced only in the browser (`Base44AgentService.ts:67-68`), and a
  silent no-reply fault in Base44 is handled by a 20-second watchdog in the page.

Three agents (support, procedures, blog) also read Base44's `BlogPost` through
entity tools, which is why `contentAdmin` still writes Base44 first. Once all four
have moved, nothing reads Base44's blog any more.

## Decisions taken

All taken with the user on 2026-10-13.

- **Anthropic first.** Claude Haiku 5.5, through one provider adapter. The Hebrew
  evaluation below decides whether Haiku is good enough; if it fails, the same run
  tries Sonnet 5.5. Another provider is a new adapter, not a rewrite.
- **The interview first.** It is where the value is (A-59) and the hardest prompt.
  Support, procedures and the blog recommender follow, each in its own PR on the
  same function.
- **The whole reply per request.** One POST returns the full answer while the page
  shows the typing dots. No streaming.
- **Transcripts kept 12 months,** then deleted.
- **Approach: a Supabase Edge Function, `chat`,** calling the Anthropic API.
  - Rejected: a Vercel Function with the AI SDK and AI Gateway. Provider switching
    and request logs would be nicer, but the backend would split across two
    platforms, the tools would be called over HTTP into Supabase, and the rate
    limits and secrets would live in two places. The evaluation, the only real
    gain, runs offline anyway.
  - Rejected: a hosted agent runtime. It would be Base44 again under another name —
    one runtime we cannot see into, traded for another.

## Facts this design rests on (checked 2026-10-13)

- **The seam is `AgentPort`** (`src/services/ports.ts:139-143`): `start`, `send`,
  `subscribe`. `AgentChat.tsx` uses nothing else, so a new adapter leaves the UI
  almost untouched.
- **There is no `consents` table.** The platform design assumed one; today consent
  is stored on the lead (`consent_version`, `consent_at`). This design records it
  on the conversation row instead.
- **`agency_profiles` is revoked from `service_role`** (tenant schema migration).
  The function therefore takes Dorit's profile from a pinned copy,
  `_shared/agency.ts`, not from the database.
- **Today's consent text promises more than the chat does.** The interview's says
  the details "are not passed to any other party" (`src/config/compliance.ts:54`);
  the support one says the conversation is kept, but not for how long (`:79`).
  Base44 already sends every chat to a model provider without saying so. See
  *Compliance*.
- **`base44/agents/COMPLIANCE.md` is stale on one point:** it lists
  `createConsultationEvent` as an interview tool (l.14); the `.jsonc` has only
  `submitLead` and `escalateToHuman`.
- **`supabase/functions/_shared/cors.ts` allows `POST` and `OPTIONS`,** which is
  enough for a non-streaming JSON exchange.
- **The Edge tool handlers exist:** `submit-lead` and `escalate-to-human` export
  `handler(req: Request): Promise<Response>`, and `escalate-to-human` already
  refuses an empty hand-off and caps staff mail at 60 an hour (draft PR #162).

## Architecture and one message, end to end

```
AgentChat (unchanged UI) ──AgentPort──► SupabaseAgentService (new adapter)
                                              │  POST /functions/v1/chat
                                              ▼  {role, conversationId?, token?, message, consent?, attribution?}
                                     chat Edge Function
   1 guard: CORS allow-list · size ≤1000 chars · rate limit per IP + global (allow_submission)
   2 conversation: first message creates it (needs consent_version + consent_at) and returns
     {conversationId, token}; later messages must present the token (sha256 stored, never the token)
   3 limits: ≤40 visitor turns; conversation closed after a lead is saved or after 2 h idle
   4 redact(message) → store as a chat_messages row
   5 prompt = compliance rules + role template (interview.md, from today's .jsonc)
              + agency profile (_shared/agency.ts) — the first two cached
   6 Anthropic Messages API (Haiku 5.5), with the role's tools:
        submit_lead       → submit-lead handler, in-process
        escalate_to_human → escalate-to-human handler, in-process
     at most 3 tool rounds, 25 s total budget
   7 store the assistant reply + token usage; return {reply, closed?, leadSaved?}
```

The adapter keeps `AgentPort`'s shape: `start` returns a local conversation handle
(the server conversation is created by the first `send`), `send` posts and hands the
reply to the listener registered by `subscribe`. No socket, so nothing for Vercel to
proxy.

**What changes:**

- When the interview ends, the model calls `submit_lead` itself. The fenced `lead`
  block, `readHandoff()` and AgentChat's special submit path stay only for agents
  still on Base44, and are deleted once all four have moved and two weeks have
  passed.
- If anything fails — the model, a timeout, a tool — the page shows "Dorit's direct
  channels", as it does today. The function logs the event, never the content.

**What stays:** the consent gate before the first message, the always-visible
hand-off button, the 20-second no-reply watchdog, `CONSENT_VERSION` (until the
compliance change below), and every visible text.

**The switch.** `VITE_CHAT_AGENTS=needs_interview` (comma-separated agent names)
lists the agents served by `chat`. Agents not listed stay on Base44. Rollback is
removing a name and redeploying.

## Data

One new migration. Every row carries `agency_id` (agency 1 for now).

| Table | Columns | Notes |
|---|---|---|
| `chat_conversations` | `id`, `agency_id`, `role` (`interview`, `support`, `procedures`, `blog`), `token_hash`, `consent_version`, `consent_at`, `status` (`open`, `closed`, `lead_saved`, `escalated`), `lead_id` (nullable), `turns`, `attribution` (jsonb: channel, campaign, landingPath), `created_at`, `last_message_at`, `delete_after` (= `created_at` + 12 months) | Consent is recorded here, on the first message. |
| `chat_messages` | `id`, `conversation_id` (on delete cascade), `agency_id`, `role` (`user`, `assistant`, `tool`), `content` (already redacted), `created_at` | A tool row holds only the tool name and the result status (`submit_lead: ok`), never the arguments; the lead itself is in `leads`. |
| `chat_usage` | `conversation_id` (on delete cascade), `agency_id`, `model`, `input_tokens`, `cached_tokens`, `output_tokens`, `created_at` | Cost per agency per month, and the budget cap. |

- **RLS:** `anon` and `authenticated` get nothing on the three tables, except that
  an agency member reads their own agency's rows through `can_see(agency_id)`.
  Only the function's service role writes.
- **Dorit sees the interview.** On `/admin/leads`, a lead that came from a chat gets
  a **"שיחה"** tab with the transcript, read-only — one query on `lead_id` and one
  component. She prepares for the meeting from what the client actually said.
- **Retention:** a nightly job deletes conversations past `delete_after`; messages
  and usage go with them by cascade. A client's deletion request removes theirs at
  once, found through their lead.
- **Budget cap:** when an agency's spend this month in `chat_usage` passes
  `CHAT_MONTHLY_BUDGET_USD` (a function secret, `50` to start), new conversations
  get "Dorit's direct channels" instead of a model call, and staff get one email for
  that month. At about $7 per 1,000 interviews this is a ceiling for a runaway or
  abuse, not a limit on real use.

## Prompts and tools

- **Where prompts live:** the instructions move out of the `.jsonc` files into
  readable Markdown, `supabase/functions/chat/prompts/{compliance,interview}.md`,
  which become the source of truth.
  - `COMPLIANCE.md` moves there, with its stale `createConsultationEvent` line fixed.
  - The `.jsonc` files stay for the agents still on Base44 until each one moves. A
    contract test keeps an agent's Markdown and its `.jsonc` instructions identical
    while both exist.
- **Placeholders:** "דורית גוב ארי", the licence, the phone and the channels become
  `{{agency.name}}`-style placeholders, filled from `_shared/agency.ts`. A contract
  test keeps that file equal to `src/config/agencyProfile.ts` — duplicated is fine,
  drifted is not. Rendered for Dorit, the interview prompt equals today's text byte
  for byte, apart from the tool section.
- **Order:** compliance, then the role, then the profile, then the tool
  instructions. The first two are marked for prompt caching.
- **The interview's tools,** each with a JSON schema:
  - `submit_lead` — today's fenced-block fields: `name`, `phone`, `email`, `track`,
    `meetingTopic`, `timing`, `notes`, `scheduledAt`, `summary`, `profile`. The
    function adds attribution from the conversation row (set from the page's first
    request) — never from the model — and the consent from the same row, then calls
    the `submit-lead` handler in-process. The model gets back `ok` or the handler's
    Hebrew error, so it can ask again (a phone number that did not validate).
  - `escalate_to_human` — the reason (one of the existing ten), a summary, optional
    name and phone; calls the `escalate-to-human` handler in-process.
  - At most one successful `submit_lead` per conversation. A second call answers
    "already saved" without writing. After a lead is saved, the conversation is
    `lead_saved` and the page shows today's confirmation.
- **The one intended prompt change:** the interview's closing instruction "end with
  a ```lead block" becomes "call `submit_lead`". It gets its own contract pin.

## Failures and limits

Enforced in the function, not trusted to the page.

| Case | The visitor sees | Behind |
|---|---|---|
| Model error, 429, or over 25 s | Today's "Dorit's direct channels" | One retry if under 10 s have passed; logs `model.failed` with the conversation id only |
| `submit_lead` fails | The model says it could not save, and gives the channels | The handler's error goes back to the model; the transcript stays, so the lead can be recovered from the "שיחה" tab |
| Message over 1,000 characters, or turn 41 | Today's limit messages (`AgentLimitError`) | `400` before any model call |
| Flood | "Too many messages, try again shortly" | `withinLimit`: 20 messages a minute per IP, 300 new conversations an hour site-wide; fails open, as today |
| Monthly budget reached | The channels | One staff email |
| Bad or missing token | The chat starts over | `403`; no conversation can be read or continued without its token |

## Testing

- **Unit:** the prompt renders byte for byte against today's text; tool schemas;
  one lead per conversation; token checks; the limits; redaction before storage.
- **Function handler,** with a fake Anthropic client: a full interview ending in
  `submit_lead`, an escalation, a model failure, the budget cap.
- **Contract:** the Markdown and `.jsonc` stay equal while both exist;
  `_shared/agency.ts` equals `agencyProfile.ts`; no log line carries content; the
  `submit_lead` fields match `submit-lead`'s input.
- **RLS** (`supabase/tests/`): `anon` and `authenticated` non-members read nothing in
  the three tables; a member of agency 1 reads only agency 1's.
- **e2e:** the interview against a mocked `/functions/v1/chat` — consent, reply,
  lead saved, the confirmation. The socket mocks stay for agents still on Base44.
- **The Hebrew evaluation** — the gate before launch. The platform design asked for
  30–50 real interviews; there are none, because Base44 kept them.
  - 30 scripted visitor personas in Hebrew: cooperative, vague, pushing for a
    product recommendation, asking about tax or returns, giving an ID number,
    abusive, English-speaking.
  - Sonnet plays the visitor against the deployed function; a second Sonnet call
    scores each transcript on the design's four criteria.
  - **Pass:** zero product recommendations and zero missed hand-offs across all 30;
    a complete lead in at least 90% of the cooperative personas; the user and Dorit
    read 10 transcripts and accept the Hebrew.
  - Opt-in (`npm run test:eval:chat`), about $3 a run, rerun whenever the model
    version changes. If Haiku fails, the same run tries Sonnet 5.5 (about $140 per
    1,000 interviews).

## Compliance

Nothing reaches a visitor before the compliance adviser has seen:

- the new consent sentence, naming an AI service provider outside Israel that
  processes the conversation and saying the transcript is kept for 12 months
  (`CONSENT_VERSION` becomes `2026-10-agents-v6`);
- the transcript storage and the "שיחה" tab;
- the evaluation's compliance results.

The provider's business terms must say API data is not used for training.

## Amendments during PR 1

Where the build differs from the text above, the build wins:

- Tool names stay camelCase `submitLead` / `escalateToHuman`, not `submit_lead` / `escalate_to_human`: the interview prompt names them about ten times, and keeping them keeps the rendered prompt byte for byte equal to today's.
- `compliance.md` is the COMPLIANCE.md section 3 and 5 excerpt (the model-facing rules), not the whole 44 KB adviser document, which is not sent to the model.
- One hand-off per conversation, recorded in `escalated_at` apart from `status`, so an escalation after a saved lead cannot let a second lead through.
- One lead per conversation whatever the stage: once `status` is `lead_saved`, `submitLead` answers `already_saved` even for a `partial` stage.
- `lead_id` prefers the interview lead: set by a `submitLead` outcome always, by an `escalateToHuman` outcome only while it is still null, so the "שיחה" tab follows the richer lead.
- The 20 s no-reply watchdog is off for agents served by `chat`; the adapter's 40 s abort and the function's 25 s budget cover it.
- The e2e test for the interview on the function is deferred to the switch-on PR (CI's build has no Supabase); a routing unit test (`VITE_CHAT_AGENTS` names go to the function adapter) ships now.
- The "שיחה" tab shows for any lead with a linked conversation, not only `source=interview`, because hand-off leads link too.
- The 60-an-hour staff-mail cap mentioned above exists only in draft PR #162, not on main; until it lands the hand-off is limited only by one per conversation and the per-IP and per-site rate limits.
- **Phones are kept; IDs, cards and accounts are redacted** (final review, C1). `redact()` took the 7-digit tail of `050-1234567` for an account number and `031234567` for an ID, so the model never saw the visitor's phone and the lead could not be called. The function stores, and reads back to the model, `redactChat()` (`chat/redact-chat.ts`): Israeli phone forms (05X/07X and 0[2-489], with or without `-`/space, and `+972`/`972`) are set aside, `redact()` (unchanged) runs on the rest, and they are put back. A bare nine digits starting 0[2-489] that passes the ID check digit is redacted as an ID. `redactChat()` does not clip; the store clips at the column's 8,000 characters. "Storage holds only redacted text" now reads: redacted of IDs, cards and accounts, with the phone kept.
- **One turn at a time per conversation** (final review, I3). `chat_conversations.busy_until` holds a conversation for a running turn: a filtered PATCH (`turns` still the count read, status `open` or `escalated`, `busy_until` null or past) both claims it for 180 s (60 s in PR 1; raised before switch-on because tools run outside the 25 s budget) and counts the turn, so the 40-turn cap holds under concurrency; no match is `409 busy`, which the page shows as "הודעה קודמת עדיין בטיפול — רגע אחד." A new conversation is created claimed; the claim is released when the turn ends, and a crashed turn's lapses.
- **A tool's effect is written when the tool answers** (final review, I2): status, `lead_id` and `escalated_at` are persisted before the model is called again; tool and usage rows are best-effort. A 503 that carries `leadSaved: true` is shown to the visitor as a saved lead with Dorit's channels (I5), and a `max_tokens` stop inside a tool call fails the turn without running it (I1).

## Amendments during PR 2 (2026-10-14)

PR 2 serves `support_agent` (the FAQ chat). Three decisions taken with the user on 2026-10-14 extend the text above:

- **The split.** PR 2 adds the shared article tools and `support_agent`; PR 3 is `procedures_agent`; PR 4 is `blog_recommender`.
- **The sheet log stays, and the function writes it.** Base44's agent called `logSupportChat` at the end of a chat when it remembered to. On the function it is not a model tool: a pg_cron job (`chat-support-sheet-log`, every 15 minutes, Vault-held URL and token, migration `20261018000000`) posts to the `chat` function's sweep route (`x-chat-sweep`, `CHAT_SWEEP_TOKEN`), which claims idle support conversations and logs each through the `log-support-chat` handler in-process.
- **The blog recommender's hidden block** becomes a `recommend_articles` tool in PR 4, not here.

Where the build differs from the plan, the build wins:

- **The article tools** (`listArticles`, `readArticle`) read only `blog_posts` rows with `published = true` and `agency_id` null or agency 1, and refuse a slug outside `src/lib/articlePath.ts`'s pattern before any query. A store failure is `tool_failed`, never `not_found`.
- **A per-role tool gate.** A tool name outside the conversation's role set answers `unknown_tool` and runs nothing, for every role: the FAQ chat can never save a lead, and the interview never reads articles.
- **The sweep claims a batch.** A read picks at most 10 of the longest-idle due conversations; one PATCH by those ids, repeating every condition (role, not eval, `sheet_logged_at` null, idle past `IDLE_MS` + 5 minutes, no live `busy_until`), claims them. The whole backlog in one claim would have marked logged rows that a request cut off at pg_net's 30 s never reached.
- **A row counts as logged only when `log-support-chat` says so** (it answers 200 with a warning when the append fails). A claimed row is never retried. Without `SHEET_ID` nothing is claimed.
- **The transcript is fitted** to 1,800 characters (opening, `[…]`, close), because `log-support-chat`'s `redact()` keeps only the first 2,000.
- **Logged at the close, not at 30 minutes** (user decision, 2026-10-14). `SHEET_LOG_IDLE_MS` is the handler's `IDLE_MS` (2 hours) plus `SHEET_LOG_MARGIN_MS` (5 minutes), not a number of its own: a conversation that idle is refused as closed on its next message, so every Support-tab row is the whole conversation. The margin covers the window between the handler's idle check and its turn claim, where a sweep cutting at exactly `IDLE_MS` could log a conversation a turn was about to extend. The plan's 30 minutes let a visitor who came back before the close continue a conversation already logged, its later turns (a hand-off among them) never reaching the sheet. The cost: the row appears about 2 hours after the chat, at most about 2 h 20 min. A hand-off does not wait for it — `escalateToHuman` reaches Dorit during the turn that calls it.
- **The FAQ chat's v6 notice is its own** (`CHAT_FUNCTION_SUPPORT_CONSENT_POINTS`): its v5 points 1–3 and a fourth naming the AI provider outside Israel and the 12-month transcript. The interview's v6 points promise a name, a phone and a meeting, which the FAQ chat does not collect. The adviser approves it with the interview's.
- **The evaluation** gains 12 FAQ personas, a rubric of its own with the same JSON answer, and an `answer` expectation that fails on any `submitLead` call.

## Rollout

Each step is reversible on its own.

1. **Ship dark.** One PR adds the function, the tables, the adapter and the prompts,
   with `VITE_CHAT_AGENTS` empty. CI deploys the function; nothing calls it.
2. **The user sets up the provider:** an Anthropic account, `ANTHROPIC_API_KEY` in
   the Supabase function secrets, and a check that the terms exclude training on
   API data.
3. **Run the evaluation** against the deployed function.
4. **Compliance adviser review** (above).
5. **Prerequisite:** Phase 2 rollout step 6 has passed — Dorit's calendar shared and
   a test lead seen end to end — because `submit_lead` books through the same
   `submit-lead` handler.
6. **Switch on:** `VITE_CHAT_AGENTS=needs_interview` on Vercel and a redeploy. One
   real test interview: the lead, the mail, the event, the sheet row, the "שיחה" tab.
7. **Later PRs:** support, procedures, then the blog recommender, each with its own
   prompt PR. After the last, nothing reads Base44's `BlogPost`, and `contentAdmin`
   can drop its Base44 write.

## Rollback

- After step 1: nothing to undo.
- After step 6: remove the agent from `VITE_CHAT_AGENTS` and redeploy; the agent is
  back on Base44 with the fenced block.
- The fenced-block path is deleted only after all four agents have moved and two
  weeks have passed.

## Out of scope

Streaming; other agencies (the profile layer is ready, but there is no host
resolver); WhatsApp (B-8); moving support, procedures and blog (separate PRs); a
provider-switching layer beyond the one adapter interface.

## Open items for the plan

- The exact Haiku 5.5 model id string, verified against the provider's model list
  when the adapter is built.
- `pg_cron` is not used by any migration yet. The plan confirms it is enabled on the
  project before relying on it for the nightly purge (the clearinghouse design
  assumes it too).

## Amendments during PR 3 (2026-10-15)

PR 3 serves `procedures_agent` (the procedures chat on /tools). It needed no new mechanism:

- **No migration.** `chat_conversations.role` already allowed `'procedures'`.
- **The FAQ chat's tools.** `ROLE_TOOLS.procedures = SUPPORT_TOOLS` (`listArticles`, `readArticle`, `escalateToHuman`): the procedures agent read BlogPost, logged the chat and handed off on Base44, and the function covers those three with the same tools and the sweep.
- **Logged like the FAQ chat.** `SHEET_LOGGED_ROLES` is `['support', 'procedures']`; Base44's `logSupportChat` wrote both to the Support tab.
- **The prompt.** `procedures.md` is held to `procedures_agent.jsonc` apart from `PROCEDURES_TOOL_SECTION`: the BlogPost and logSupportChat lines of the tool section, and one line outside it ("מגבלת הירוק") that read an article "ב-BlogPost", now with `readArticle`.
- **The notice.** `CHAT_FUNCTION_PROCEDURES_CONSENT_POINTS`: the procedures notice's own three points and the FAQ chat's v6 fourth.

## Amendments during PR 4 (2026-10-15)

PR 4 serves `blog_recommender` (the reading recommender on /blog):

- **The tool is `recommendArticles`** (camelCase like the others; the PR 2 note's `recommend_articles`). It keeps at most three slugs that `readArticle` would find and names the rest back as `dropped`; with none it is an error.
- **The page keeps one protocol.** The 200 answer carries the turn's `recommended` (the last call's, only when non-empty, never on a 503). `SupabaseAgentService` writes it into the reply as the same ```` ```recommended ```` block Base44's agent writes, unless the reply already has one; `/blog` matches a card by `slug` as well as `id`.
- **The role.** `blog`, with `listArticles`, `readArticle`, `recommendArticles` and `escalateToHuman`; not sheet-logged (Base44's recommender never logged). No migration.
- **The prompt.** `blog.md` is held to `blog_recommender.jsonc` apart from `BLOG_TOOL_SECTION`; `withToolSection` gained `{ equals }` for the block's bare closing fence.
- **The notice.** The two lines the adviser approved on 2026-10-10 and the v6 line.

