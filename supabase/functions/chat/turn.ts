/**
 * One visitor message, answered: the model, its tool calls (at most three
 * rounds, then one last call with tools switched off), and the final reply,
 * within a 25-second budget. One retry when the first failure comes within ten
 * seconds; a second failure ends the turn.
 */
import { ModelError, type ContentBlock, type ModelClient, type ModelMessage, type ModelUsage } from './anthropic.ts';
import type { SystemBlock } from './prompt.ts';
import type { ToolDefinition, ToolOutcome } from './tools.ts';

export const MAX_TOOL_ROUNDS = 3;
export const TURN_BUDGET_MS = 25_000;
export const RETRY_WINDOW_MS = 10_000;
/** Room for a closing reply and a full submitLead (a Hebrew profile summary) in one response. */
export const MAX_REPLY_TOKENS = 2048;

export interface StoredMessage {
  role: 'user' | 'assistant' | 'tool';
  content: string;
}

export interface UsageRecord extends ModelUsage {
  model: string;
}

export interface TurnResult {
  reply: string;
  usage: UsageRecord[];
  tools: ToolOutcome[];
  toolCalls: {
    name: string;
    /** model arguments — never store or log */
    input: Record<string, unknown>;
  }[];
}

export class TurnFailure extends Error {
  constructor(
    public readonly reason: string,
    public readonly tools: ToolOutcome[],
    public readonly usage: UsageRecord[],
  ) {
    super(reason);
    this.name = 'TurnFailure';
  }
}

/**
 * Stored rows → the alternating history the API requires: tool rows dropped
 * (their effect is in the conversation's status), consecutive rows of one side
 * merged (a visitor message whose reply failed), leading assistant rows dropped.
 */
export function toModelHistory(rows: StoredMessage[]): ModelMessage[] {
  const out: { role: 'user' | 'assistant'; content: string }[] = [];
  for (const row of rows) {
    if (row.role === 'tool') continue;
    if (out.length === 0 && row.role === 'assistant') continue;
    const last = out[out.length - 1];
    if (last && last.role === row.role) last.content = `${last.content}\n\n${row.content}`;
    else out.push({ role: row.role, content: row.content });
  }
  return out;
}

export async function runTurn(args: {
  model: ModelClient;
  system: SystemBlock[];
  tools: ToolDefinition[];
  history: ModelMessage[];
  runTool: (name: string, input: Record<string, unknown>) => Promise<ToolOutcome>;
  now?: () => number;
}): Promise<TurnResult> {
  const now = args.now ?? Date.now;
  const started = now();
  const deadline = started + TURN_BUDGET_MS;
  const messages: ModelMessage[] = [...args.history];
  const usage: UsageRecord[] = [];
  const tools: ToolOutcome[] = [];
  const toolCalls: TurnResult['toolCalls'] = [];
  let retried = false;
  // Asked again once after an empty reply that followed a tool (see below).
  let askedAgain = false;

  const call = async (toolChoice?: 'none') => {
    for (;;) {
      const remaining = deadline - now();
      if (remaining <= 0) throw new TurnFailure('timeout', tools, usage);
      try {
        return await args.model.complete(
          { system: args.system, messages, tools: args.tools, maxTokens: MAX_REPLY_TOKENS, ...(toolChoice ? { toolChoice } : {}) },
          AbortSignal.timeout(remaining),
        );
      } catch (e) {
        if (!retried && now() - started < RETRY_WINDOW_MS) {
          retried = true;
          continue;
        }
        throw new TurnFailure(e instanceof ModelError ? e.message : 'model_failed', tools, usage);
      }
    }
  };

  for (let round = 0; ; round++) {
    // After MAX_TOOL_ROUNDS the model must answer in words: in the evaluation of
    // 2026-10-14 it chained a hand-off and two saves, asked for a fourth tool, and
    // the turn failed with 503 although the lead was saved.
    const response = await call(round >= MAX_TOOL_ROUNDS ? 'none' : undefined);
    usage.push({ model: response.model, ...response.usage });
    const reply = response.content
      .filter((b): b is Extract<ContentBlock, { type: 'text' }> => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim();
    const uses = response.content.filter((b): b is Extract<ContentBlock, { type: 'tool_use' }> => b.type === 'tool_use');

    // Cut off inside a tool call: its arguments are partial. Neither run it (half a
    // lead) nor answer with the text before it (the visitor would think it was saved).
    if (response.stopReason === 'max_tokens' && uses.length > 0) throw new TurnFailure('truncated_tool_call', tools, usage);
    if (response.stopReason !== 'tool_use' || uses.length === 0) {
      if (!reply) {
        // After a tool the model sometimes answers with nothing (one output
        // token): twice in the evaluation of 2026-10-14, right after a quiet
        // partial save, each a 503 in the middle of an interview. Ask once more
        // with the same conversation — nothing is added on the visitor's behalf
        // — and fail only if that is empty too.
        if (tools.length > 0 && !askedAgain) {
          askedAgain = true;
          round--;
          continue;
        }
        throw new TurnFailure('empty_reply', tools, usage);
      }
      return { reply, usage, tools, toolCalls };
    }
    if (round >= MAX_TOOL_ROUNDS) throw new TurnFailure('too_many_tool_rounds', tools, usage);

    messages.push({ role: 'assistant', content: response.content });
    const results: ContentBlock[] = [];
    // Sequential on purpose: the runners mutate the shared conversation after an await
    // (one lead, one hand-off), so these calls must never run under Promise.all.
    for (const use of uses) {
      const input = use.input && typeof use.input === 'object' ? use.input : {};
      toolCalls.push({ name: use.name, input });
      const outcome = await args.runTool(use.name, input);
      tools.push(outcome);
      results.push({ type: 'tool_result', tool_use_id: use.id, content: outcome.forModel, ...(outcome.isError ? { is_error: true } : {}) });
    }
    messages.push({ role: 'user', content: results });
  }
}
