/**
 * Which on-site agents run on the `chat` Edge Function instead of Base44.
 *
 * `VITE_CHAT_AGENTS` is a comma-separated list of agent names, empty by
 * default; removing a name and redeploying is the rollback. Only agents the
 * function can serve count, and nothing does without Supabase configured — so
 * the consent notice and the transport can never disagree about who answers.
 * docs/superpowers/specs/2026-10-13-chat-off-base44-design.md, "The switch".
 */
export const CHAT_FUNCTION_AGENTS: readonly string[] = ["needs_interview"];

export function parseChatAgents(raw: string | undefined, supabaseConfigured: boolean): ReadonlySet<string> {
  if (!supabaseConfigured || !raw) return new Set();
  return new Set(
    raw
      .split(",")
      .map((name) => name.trim())
      .filter((name) => CHAT_FUNCTION_AGENTS.includes(name)),
  );
}

export const CHAT_AGENTS: ReadonlySet<string> = parseChatAgents(
  import.meta.env.VITE_CHAT_AGENTS,
  Boolean(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY),
);

export const servedByChatFunction = (agent: string): boolean => CHAT_AGENTS.has(agent);
