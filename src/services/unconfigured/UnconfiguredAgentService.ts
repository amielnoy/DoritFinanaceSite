import { AgentUnavailableError } from "../agent-errors";
import type { AgentConversation, AgentPort } from "../ports";

/**
 * The on-site agents for a build with no Supabase credentials: none can
 * answer, so the chat panel shows its unavailable state — Dorit's channels.
 */
export class UnconfiguredAgentService implements AgentPort {
  async start(): Promise<AgentConversation> {
    throw new AgentUnavailableError();
  }

  async send(): Promise<void> {
    throw new AgentUnavailableError();
  }

  subscribe(): () => void {
    // No conversation ever starts, so no message will ever arrive.
    return () => undefined;
  }
}
