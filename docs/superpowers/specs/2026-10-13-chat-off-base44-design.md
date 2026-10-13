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
