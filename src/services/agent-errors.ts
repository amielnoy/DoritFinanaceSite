/**
 * The limits every agent adapter enforces, and the two ways a send fails that
 * the chat panel answers differently. Shared by the Base44 adapter and the
 * chat function's adapter; the function enforces the same numbers
 * (tests/contract/chat-function.contract.test.ts).
 */
export const MAX_MESSAGE_CHARS = 1000;
export const MAX_TURNS_PER_CONVERSATION = 40;

export type AgentLimitReason = "too_long" | "too_many_turns" | "rate_limited" | "conversation_closed" | "busy";

export class AgentLimitError extends Error {
  constructor(public readonly reason: AgentLimitReason) {
    super(reason);
    this.name = "AgentLimitError";
  }
}

/**
 * What the visitor reads when the function saved the interview's lead and then
 * could not write its reply (a 503 carrying `leadSaved`): saved, not failed.
 */
export const LEAD_SAVED_WITHOUT_REPLY = "הפרטים נשמרו ודורית תחזור בהקדם.";

/** The agent cannot answer now (model down, over budget, storage down): show Dorit's channels. */
export class AgentUnavailableError extends Error {
  constructor(public readonly rid?: string) {
    super("agent_unavailable");
    this.name = "AgentUnavailableError";
  }
}
