/**
 * The chat function: one visitor message in, one reply out, for the agents it
 * serves (the interview and the FAQ chat). docs/superpowers/specs/2026-10-13-chat-off-base44-design.md.
 *
 * One more route shares the URL: a POST carrying `x-chat-sweep` is the
 * 15-minute cron's (migration 20261018000000), answered by the sheet-log sweep
 * alone and never read as a chat message.
 *
 * Everything with a side effect comes in through ChatDeps, so the flow below
 * is tested with fakes; deps.ts wires the real ones and is loaded on the first
 * request, not at import.
 */
import { validCampaign, validChannel, validLandingPath } from '../_shared/attribution.ts';
import { AGENCY } from '../_shared/agency.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { clientIp, sha256Hex } from '../_shared/guard.ts';
import { createLog, newRequestId } from '../_shared/log.ts';
import { redactChat } from './redact-chat.ts';
import type { ModelClient } from './anthropic.ts';
import { monthKey, monthStartIso, spendUsd } from './budget.ts';
import { systemBlocks, type ChatRole } from './prompt.ts';
import { toFacts, type ChatStore, type ConversationRow } from './store.ts';
import { BLOG_TOOLS, INTERVIEW_TOOLS, SUPPORT_TOOLS, type ConversationStatus, type ToolCallContext, type ToolDefinition, type ToolOutcome, type ToolRunner } from './tools.ts';
import { runTurn, toModelHistory, TurnFailure, type TurnResult } from './turn.ts';

const FN = 'chat';
const log = createLog(FN);

export const AGENT_ROLES: Readonly<Record<string, ChatRole>> = { needs_interview: 'interview', support_agent: 'support', procedures_agent: 'procedures', blog_recommender: 'blog' };
// The procedures chat answers from published articles and hands off, exactly as the FAQ chat does.
const ROLE_TOOLS: Readonly<Record<ChatRole, ToolDefinition[]>> = { interview: INTERVIEW_TOOLS, support: SUPPORT_TOOLS, procedures: SUPPORT_TOOLS, blog: BLOG_TOOLS };
/**
 * Tool rows never reach the next turn's history, so the recommender lists,
 * reads (often twice) and recommends before it answers, every turn it
 * recommends: more rounds than the other roles' three (turn.ts). Still within
 * TURN_BUDGET_MS, which ends any turn that runs long.
 */
const ROLE_TOOL_ROUNDS: Readonly<Partial<Record<ChatRole, number>>> = { blog: 5 };
export const MAX_MESSAGE_CHARS = 1000;
export const MAX_TURNS = 40;
export const IDLE_MS = 2 * 60 * 60 * 1000;
export const PER_IP_PER_MINUTE = 20;
/** Status requests, apart from messages: the page polls one turn every few seconds. */
export const STATUS_PER_IP_PER_MINUTE = 60;
export const NEW_CONVERSATIONS_PER_HOUR = 300;
/** How long before the first message the consent gate may plausibly have been accepted. */
export const CONSENT_MAX_AGE_MS = 2 * 60 * 60 * 1000;

/**
 * When consent was given, as the record keeps it (review 2026-10-15): the
 * browser's time, but never after the server's now and never further back
 * than CONSENT_MAX_AGE_MS. The time is evidence under Amendment 13; a client
 * could otherwise date its consent to whenever it liked.
 */
export function consentInstant(claimed: string, nowMs: number): string {
  const at = Date.parse(claimed);
  return new Date(Math.min(nowMs, Math.max(nowMs - CONSENT_MAX_AGE_MS, at))).toISOString();
}
/** New conversations per caller, beside the global cap: one address may not open them all. */
export const NEW_CONVERSATIONS_PER_IP_PER_HOUR = 20;
/**
 * How long a turn holds its conversation. The 25 s budget covers only the
 * model calls; tools run outside it, and saving a lead is several sequential
 * upstream calls (the row, the mailer, the calendar, the sheet) of up to 10 s
 * each, over up to MAX_TOOL_ROUNDS rounds. At 60 s a slow provider let the hold
 * lapse mid-turn, and a second message then ran a parallel turn. The cost of
 * the longer hold: a turn that crashes without letting go keeps its
 * conversation answering "busy" for up to three minutes.
 */
export const TURN_LEASE_MS = 180_000;
/** submit-lead's `LEAD_FIELD_LIMITS.consent_version`: a longer version would open a chat whose every save fails. */
export const MAX_CONSENT_VERSION_CHARS = 40;
const EVAL_RETENTION_MS = 24 * 60 * 60 * 1000;
const CLOSED: ReadonlySet<string> = new Set(['closed', 'lead_saved']);
const TOKEN = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ChatDeps {
  now(): number;
  store: ChatStore;
  model: ModelClient | null;
  runTool: ToolRunner;
  allow(rid: string, key: string, windowSeconds: number, max: number): Promise<boolean>;
  monthlyBudgetUsd: number;
  evalToken: string;
  newToken(): string;
  notifyBudgetReached(rid: string): Promise<void>;
  /** CHAT_SWEEP_TOKEN: the Vault-held header the 15-minute cron sends. Empty refuses every sweep. */
  sweepToken: string;
  /** One sheet-log tick (sweep.ts); resolves to how many conversations reached the sheet. */
  sweepSheetLogs(rid: string): Promise<number>;
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

export function createChatHandler(deps: ChatDeps): (req: Request) => Promise<Response> {
  return async function chat(req: Request): Promise<Response> {
    const cors = corsHeaders(req.headers.get('origin'));
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    const rid = newRequestId();
    const startedAt = Date.now();
    // Every answer names its fields: never a stored row, which carries token_hash.
    const respond = (status: number, body: Record<string, unknown>) =>
      Response.json({ ...body, rid }, { status, headers: cors });
    const refuse = (status: number, code: string) => {
      log('warn', 'request.rejected', { rid, reason: code, ms: Date.now() - startedAt });
      return respond(status, { ok: false, code });
    };

    try {
      log('info', 'request.start', { rid });
      if (req.method !== 'POST') return refuse(405, 'method');

      // The cron's route, decided by the header alone, before the body is read:
      // a request carrying it never reaches the chat, whatever else it holds.
      const sweepHeader = req.headers.get('x-chat-sweep');
      if (sweepHeader !== null) {
        if (!deps.sweepToken || sweepHeader !== deps.sweepToken) return refuse(401, 'unauthorized');
        try {
          const logged = await deps.sweepSheetLogs(rid);
          log('info', 'request.end', { rid, ms: Date.now() - startedAt, sweep: true, logged });
          return respond(200, { ok: true, logged });
        } catch (e) {
          log('error', 'sweep.failed', { rid, ms: Date.now() - startedAt, err: String((e as Error)?.message ?? e).slice(0, 200) });
          return respond(500, { ok: false, code: 'unavailable' });
        }
      }

      const input = ((await req.json().catch(() => null)) ?? {}) as Record<string, unknown>;
      const agent = str(input.agent);
      const role = AGENT_ROLES[agent];
      const text = str(input.message).trim();
      if (!role) return refuse(400, 'unknown_agent');

      // How the conversation's last turn ended. The page stops waiting at 40 s, and a
      // turn whose tools run long may still finish — saving the lead — after that
      // (review 2026-10-15). Asked with the conversation's own token; runs no turn,
      // claims nothing, and is limited apart from messages.
      if (input.status === true) {
        const statusIp = clientIp(req);
        if (!(await deps.allow(rid, `chat-status-ip:${await sha256Hex(statusIp)}`, 60, STATUS_PER_IP_PER_MINUTE))) {
          return refuse(429, 'rate_limited');
        }
        const id = str(input.conversationId);
        const token = str(input.token);
        const found = UUID.test(id) && TOKEN.test(token) ? await deps.store.getConversation(id) : null;
        if (!found || found.role !== role || found.token_hash !== (await sha256Hex(token))) return refuse(403, 'gone');
        const busy = found.busy_until !== null && Date.parse(found.busy_until) > deps.now();
        // The page names the turn it waits for (review 2026-10-15). The newest message
        // is that turn's only while the count is still that turn and the turn is over:
        // a turn that never started, or one still running, has no reply to give, and an
        // older one's must never pass for it.
        const turn = typeof input.turn === 'number' && Number.isInteger(input.turn) && input.turn > 0 ? input.turn : 0;
        const last = !busy && found.turns === turn
          ? [...(await deps.store.listMessages(found.id))].reverse().find((m) => m.role !== 'tool')
          : undefined;
        log('info', 'request.end', { rid, ms: Date.now() - startedAt, conversation: found.id, statusRequest: true, busy });
        return respond(200, {
          ok: true,
          busy,
          status: found.status,
          leadSaved: found.status === 'lead_saved',
          turns: found.turns,
          last: last ? { role: last.role, content: last.content } : null,
        });
      }

      if (!text) return refuse(400, 'empty');
      if (text.length > MAX_MESSAGE_CHARS) return refuse(400, 'too_long');

      const evalMode = deps.evalToken !== '' && req.headers.get('x-chat-eval') === deps.evalToken;
      const ip = clientIp(req);
      if (!evalMode && !(await deps.allow(rid, `chat-ip:${await sha256Hex(ip)}`, 60, PER_IP_PER_MINUTE))) {
        return refuse(429, 'rate_limited');
      }
      if (!deps.model) {
        log('warn', 'model.unconfigured', { rid, ms: Date.now() - startedAt });
        return respond(503, { ok: false, code: 'unavailable' });
      }

      let conversation: ConversationRow;
      let issuedToken: string | null = null;
      const conversationId = str(input.conversationId);
      const token = str(input.token);
      // One turn at a time (I3): a turn claims the row until this time and lets go when done.
      const leaseUntil = new Date(deps.now() + TURN_LEASE_MS).toISOString();

      // The page makes the conversation's id and token itself and sends them with every
      // message, the first included (review 2026-10-15). A first message whose answer was
      // lost can then be asked about, and a resend reaches the same row: one lead, one
      // hand-off. A request with no id is a page from before that, given a token made here.
      let found: ConversationRow | null = null;
      if (conversationId) {
        if (!UUID.test(conversationId) || !TOKEN.test(token)) return refuse(403, 'gone');
        found = await deps.store.getConversation(conversationId);
        if (found && (found.role !== role || found.token_hash !== (await sha256Hex(token)))) return refuse(403, 'gone');
        // An id never seen opens a conversation only on a message carrying the consent; otherwise its row is gone.
        if (!found && !str(input.consentVersion)) return refuse(403, 'gone');
      }

      if (!found) {
        const consentVersion = str(input.consentVersion).trim();
        const consentAt = str(input.consentAt);
        if (!consentVersion || consentVersion.length > MAX_CONSENT_VERSION_CHARS || Number.isNaN(Date.parse(consentAt))) {
          return refuse(400, 'consent_required');
        }
        if (!evalMode && !(await deps.allow(rid, `chat-new-ip:${await sha256Hex(ip)}`, 3600, NEW_CONVERSATIONS_PER_IP_PER_HOUR))) {
          return refuse(429, 'rate_limited');
        }
        if (!evalMode && !(await deps.allow(rid, 'chat-new', 3600, NEW_CONVERSATIONS_PER_HOUR))) {
          return refuse(429, 'rate_limited');
        }
        if (await overBudget(deps, rid)) {
          log('warn', 'budget.reached', { rid, ms: Date.now() - startedAt });
          return respond(503, { ok: false, code: 'unavailable' });
        }
        const ownToken = conversationId ? token : (issuedToken = deps.newToken());
        const a = (input.attribution && typeof input.attribution === 'object' ? input.attribution : {}) as Record<string, unknown>;
        const opening = {
          ...(conversationId ? { id: conversationId } : {}),
          agency_id: AGENCY.id,
          role,
          token_hash: await sha256Hex(ownToken),
          consent_version: consentVersion,
          consent_at: consentInstant(consentAt, deps.now()),
          attribution: {
            channel: validChannel(a.channel) ?? '',
            campaign: validCampaign(a.campaign) ?? '',
            landingPath: validLandingPath(a.landingPath) ?? '',
          },
          is_eval: evalMode,
          // Created already claimed for its first turn.
          turns: 1,
          busy_until: leaseUntil,
          ...(evalMode ? { delete_after: new Date(deps.now() + EVAL_RETENTION_MS).toISOString() } : {}),
        };
        try {
          conversation = await deps.store.createConversation(opening);
        } catch (e) {
          // The same first message sent twice at once: the other request's row holds the turn.
          if (conversationId && String((e as Error)?.message ?? e).startsWith('insert_http_409')) return refuse(409, 'busy');
          throw e;
        }
        log('info', 'conversation.created', { rid, conversation: conversation.id, role, evalMode });
      } else {
        conversation = found;
        if (CLOSED.has(conversation.status)) return refuse(409, 'closed');
        if (deps.now() - Date.parse(conversation.last_message_at) > IDLE_MS) {
          await deps.store.updateConversation(conversation.id, { status: 'closed' });
          return refuse(409, 'closed');
        }
        if (conversation.turns >= MAX_TURNS) return refuse(400, 'too_many_turns');
        // The claim counts the turn in the same write, only while the count is still the one
        // read here: a second message sent at once, or the forty-first, matches no row.
        const claimed = await deps.store.claimTurn(conversation.id, conversation.turns, new Date(deps.now()).toISOString(), leaseUntil);
        if (!claimed) return refuse(409, 'busy');
        conversation = claimed;
      }

      const id = conversation.id;
      try {
        // Every write below carries the stored row's agency, never anything the request said.
        const agencyId = conversation.agency_id;
        await deps.store.addMessage({ conversation_id: id, agency_id: agencyId, role: 'user', content: redactChat(text) });
        const history = toModelHistory(await deps.store.listMessages(id));

        // The runners mutate ctx.conversation (one lead, one hand-off); persistOutcome writes it.
        const facts = toFacts(conversation);
        const attribution = conversation.attribution ?? { channel: '', campaign: '', landingPath: '' };
        const ctx: ToolCallContext = {
          conversation: {
            ...facts,
            attribution: { channel: attribution.channel ?? '', campaign: attribution.campaign ?? '', landingPath: attribution.landingPath ?? '' },
          },
          agent,
          origin: req.headers.get('origin'),
          userAgent: req.headers.get('user-agent'),
          // The address the chat already resolved (clientIp), so the lead and
          // hand-off functions count this visitor, not a header they could forge.
          forwardedFor: ip,
          evalMode,
        };

        /**
         * A tool's effect on the row, written the moment the tool answers, before
         * the model is called again: a later failure in this turn (the model, a
         * usage row) can then never leave a saved lead's row 'open' for a retry to
         * save twice. Status first — it is what refuses a second lead. Ruling 11:
         * the interview lead always takes lead_id; a hand-off's only fills an
         * empty one. A failure here is storage down, and fails the request.
         */
        const written = { status: facts.status, escalated: facts.escalated };
        const persistOutcome = async (o: ToolOutcome) => {
          const fields: { status?: ConversationStatus; lead_id?: string } = {};
          if (ctx.conversation.status !== written.status) fields.status = ctx.conversation.status;
          if (o.name === 'submitLead' && o.leadId) fields.lead_id = o.leadId;
          if (fields.status || fields.lead_id) await deps.store.updateConversation(id, fields);
          written.status = ctx.conversation.status;
          if (o.name === 'escalateToHuman' && o.leadId) await deps.store.updateConversation(id, { lead_id: o.leadId }, { onlyIfLeadIdNull: true });
          if (ctx.conversation.escalated && !written.escalated) {
            await deps.store.recordEscalation(id);
            written.escalated = true;
          }
        };

        let result: TurnResult | null = null;
        let failure: TurnFailure | null = null;
        try {
          result = await runTurn({
            model: deps.model,
            system: systemBlocks(role, deps.now()),
            tools: ROLE_TOOLS[role],
            maxToolRounds: ROLE_TOOL_ROUNDS[role],
            history,
            runTool: async (name, args) => {
              // A tool outside this conversation's role is never run, whatever the model names.
              const offered = ROLE_TOOLS[role].some((t) => t.name === name);
              if (!offered) log('warn', 'tool.not_offered', { rid, conversation: id, tool: String(name).slice(0, 40) });
              // A name the model made up is stored as the tool row's label: as short as the log keeps it.
              const outcome: ToolOutcome = offered
                ? await deps.runTool(name, args, ctx)
                : { name: String(name).slice(0, 40), status: 'error', isError: true, forModel: JSON.stringify({ ok: false, error: 'unknown_tool' }) };
              await persistOutcome(outcome);
              return outcome;
            },
            now: deps.now,
          });
        } catch (e) {
          if (!(e instanceof TurnFailure)) throw e;
          failure = e;
        }

        // The record of the turn, not its state: a row that cannot be written is logged, never a failed answer.
        const bestEffort = async (event: string, write: () => Promise<void>) => {
          try {
            await write();
          } catch (e) {
            log('warn', event, { rid, conversation: id, err: String((e as Error)?.message ?? e).slice(0, 200) });
          }
        };
        const outcomes = result?.tools ?? failure?.tools ?? [];
        for (const o of outcomes) {
          await bestEffort('store.tool_row_failed', () =>
            deps.store.addMessage({ conversation_id: id, agency_id: agencyId, role: 'tool', content: `${o.name}: ${o.status}` }),
          );
        }
        for (const u of result?.usage ?? failure?.usage ?? []) {
          await bestEffort('store.usage_failed', () =>
            deps.store.recordUsage({ conversation_id: id, agency_id: agencyId, model: u.model, input_tokens: u.input, cached_tokens: u.cached, output_tokens: u.output }),
          );
        }
        const leadSaved = outcomes.some((o) => o.leadSaved);
        // The articles this turn highlighted, the last call's — the adapter hands them to the page.
        const recommended = [...outcomes].reverse().find((o) => o.recommended?.length)?.recommended ?? [];
        const status = ctx.conversation.status;
        if (result) {
          // The store clips to the column's 8,000 characters, past anything MAX_REPLY_TOKENS allows in practice.
          await deps.store.addMessage({ conversation_id: id, agency_id: agencyId, role: 'assistant', content: redactChat(result.reply) });
        }
        // `turn` is this turn's number, which a status request names (review 2026-10-15).
        const continuation = { conversationId: id, turn: conversation.turns, ...(issuedToken ? { token: issuedToken } : {}) };
        if (!result) {
          log('warn', 'model.failed', { rid, conversation: id, reason: failure?.reason ?? 'unknown', ms: Date.now() - startedAt });
          return respond(503, { ok: false, code: 'unavailable', leadSaved, ...continuation });
        }
        log('info', 'request.end', { rid, ms: Date.now() - startedAt, conversation: id, tools: outcomes.length, leadSaved, status });
        return respond(200, {
          ok: true,
          ...continuation,
          reply: result.reply,
          leadSaved,
          status,
          ...(recommended.length ? { recommended } : {}),
          // Model arguments, for the evaluation's holder only; never stored or logged.
          ...(evalMode ? { eval: { toolCalls: result.toolCalls } } : {}),
        });
      } finally {
        // Let go, stamping the time; a failure here only means the hold lapses on its own.
        try {
          await deps.store.releaseTurn(id, leaseUntil, new Date(deps.now()).toISOString());
        } catch (e) {
          log('warn', 'store.release_failed', { rid, conversation: id, err: String((e as Error)?.message ?? e).slice(0, 200) });
        }
      }
    } catch (error) {
      log('error', 'request.failed', { rid, ms: Date.now() - startedAt, err: String((error as Error)?.message ?? error).slice(0, 200) });
      return respond(500, { ok: false, code: 'failed' });
    }
  };
}

/**
 * Whether a new conversation must be refused for this month's spend: refused
 * once spend reaches the budget. A zero budget is the kill switch, refused
 * before spend is read, so an unreadable spend (which fails open, like the
 * limiter) cannot reopen it, and a deliberate switch-off mails no one.
 */
async function overBudget(deps: ChatDeps, rid: string): Promise<boolean> {
  if (deps.monthlyBudgetUsd <= 0) return true;
  let spend: number;
  try {
    spend = spendUsd(await deps.store.monthUsage(AGENCY.id, monthStartIso(deps.now())));
  } catch (e) {
    log('warn', 'budget.unavailable', { rid, err: String((e as Error)?.message ?? e).slice(0, 200) });
    return false;
  }
  if (spend < deps.monthlyBudgetUsd) return false;
  let claimed = false;
  try {
    claimed = await deps.store.claimBudgetAlert(AGENCY.id, monthKey(deps.now()));
  } catch (e) {
    // The store's errors carry a status and PostgREST code only. Unclaimed means unmailed: one missing email beats one per conversation.
    log('warn', 'budget.alert_failed', { rid, err: String((e as Error)?.message ?? e).slice(0, 200) });
  }
  if (claimed) {
    await deps.notifyBudgetReached(rid).catch((e) =>
      log('warn', 'budget.notify_failed', { rid, err: String((e as Error)?.message ?? e).slice(0, 200) }),
    );
  }
  return true;
}

let live: ((req: Request) => Promise<Response>) | null = null;

/** The deployed entry point: the real dependencies, built on the first request. */
export async function handler(req: Request): Promise<Response> {
  if (!live) {
    const { liveDeps } = await import('./deps.ts');
    live = createChatHandler(liveDeps());
  }
  return live(req);
}
