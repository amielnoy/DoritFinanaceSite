/**
 * The chat function: one visitor message in, one reply out, for the agents it
 * serves (the interview, so far). docs/superpowers/specs/2026-10-13-chat-off-base44-design.md.
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
import { INTERVIEW_TOOLS, type ConversationStatus, type ToolCallContext, type ToolDefinition, type ToolOutcome, type ToolRunner } from './tools.ts';
import { runTurn, toModelHistory, TurnFailure, type TurnResult } from './turn.ts';

const FN = 'chat';
const log = createLog(FN);

export const AGENT_ROLES: Readonly<Record<string, ChatRole>> = { needs_interview: 'interview' };
const ROLE_TOOLS: Readonly<Record<ChatRole, ToolDefinition[]>> = { interview: INTERVIEW_TOOLS };
export const MAX_MESSAGE_CHARS = 1000;
export const MAX_TURNS = 40;
export const IDLE_MS = 2 * 60 * 60 * 1000;
export const PER_IP_PER_MINUTE = 20;
export const NEW_CONVERSATIONS_PER_HOUR = 300;
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

      const input = ((await req.json().catch(() => null)) ?? {}) as Record<string, unknown>;
      const agent = str(input.agent);
      const role = AGENT_ROLES[agent];
      const text = str(input.message).trim();
      if (!role) return refuse(400, 'unknown_agent');
      if (!text) return refuse(400, 'empty');
      if (text.length > MAX_MESSAGE_CHARS) return refuse(400, 'too_long');

      const evalMode = deps.evalToken !== '' && req.headers.get('x-chat-eval') === deps.evalToken;
      const ip = clientIp(req);
      if (!evalMode && ip && !(await deps.allow(rid, `chat-ip:${await sha256Hex(ip)}`, 60, PER_IP_PER_MINUTE))) {
        return refuse(429, 'rate_limited');
      }
      if (!deps.model) {
        log('warn', 'model.unconfigured', { rid, ms: Date.now() - startedAt });
        return respond(503, { ok: false, code: 'unavailable' });
      }

      let conversation: ConversationRow;
      let issuedToken: string | null = null;
      const conversationId = str(input.conversationId);
      // One turn at a time (I3): a turn claims the row until this time and lets go when done.
      const leaseUntil = new Date(deps.now() + TURN_LEASE_MS).toISOString();

      if (!conversationId) {
        const consentVersion = str(input.consentVersion).trim();
        const consentAt = str(input.consentAt);
        if (!consentVersion || consentVersion.length > MAX_CONSENT_VERSION_CHARS || Number.isNaN(Date.parse(consentAt))) {
          return refuse(400, 'consent_required');
        }
        if (!evalMode && !(await deps.allow(rid, 'chat-new', 3600, NEW_CONVERSATIONS_PER_HOUR))) {
          return refuse(429, 'rate_limited');
        }
        if (await overBudget(deps, rid)) {
          log('warn', 'budget.reached', { rid, ms: Date.now() - startedAt });
          return respond(503, { ok: false, code: 'unavailable' });
        }
        issuedToken = deps.newToken();
        const a = (input.attribution && typeof input.attribution === 'object' ? input.attribution : {}) as Record<string, unknown>;
        conversation = await deps.store.createConversation({
          agency_id: AGENCY.id,
          role,
          token_hash: await sha256Hex(issuedToken),
          consent_version: consentVersion,
          consent_at: new Date(consentAt).toISOString(),
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
        });
        log('info', 'conversation.created', { rid, conversation: conversation.id, role, evalMode });
      } else {
        const token = str(input.token);
        const found = UUID.test(conversationId) && TOKEN.test(token) ? await deps.store.getConversation(conversationId) : null;
        if (!found || found.role !== role || found.token_hash !== (await sha256Hex(token))) return refuse(403, 'gone');
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
          forwardedFor: req.headers.get('x-forwarded-for'),
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
            history,
            runTool: async (name, args) => {
              const outcome = await deps.runTool(name, args, ctx);
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
        const status = ctx.conversation.status;
        if (result) {
          // The store clips to the column's 8,000 characters, past anything MAX_REPLY_TOKENS allows in practice.
          await deps.store.addMessage({ conversation_id: id, agency_id: agencyId, role: 'assistant', content: redactChat(result.reply) });
        }
        const continuation = { conversationId: id, ...(issuedToken ? { token: issuedToken } : {}) };
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
