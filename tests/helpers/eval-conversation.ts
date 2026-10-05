import { createClient } from "@base44/sdk";

/**
 * One conversation with a deployed agent, driven turn by turn.
 *
 * Shared by every eval because the interesting part of an eval is the dialogue,
 * not the plumbing — and because two copies of the polling loop would drift on
 * the timeout and then disagree about what "the agent did not answer" means.
 *
 * The evals are opt-in. Without both variables they skip, which is why
 * `evalEnabled` is exported beside the harness rather than recomputed per file:
 *
 *   EVAL_BASE44_APP_ID=<id> EVAL_BASE44_TOKEN=<token> npm run test:eval
 */

const APP_ID = process.env.EVAL_BASE44_APP_ID;
const TOKEN = process.env.EVAL_BASE44_TOKEN;

/** Whether the live-agent evals can run at all. */
export const evalEnabled = Boolean(APP_ID && TOKEN);

/** How long to let the agent think before giving up on a turn. */
export const REPLY_TIMEOUT_MS = 60_000;

interface Message {
  role: string;
  content?: string;
}

export async function openConversation(agentName: string) {
  const client = createClient({ appId: APP_ID!, requiresAuth: true });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- SDK auth shape
  (client as any).auth?.setToken?.(TOKEN);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- SDK surface
  const agents = (client as any).agents;
  const conv = await agents.createConversation({
    agent_name: agentName,
    metadata: { name: "eval", description: "automated prompt-adherence run" },
  });

  let messages: Message[] = [];
  agents.subscribeToConversation(conv.id, (data: { messages?: Message[] }) => {
    if (data.messages) messages = data.messages;
  });

  const assistantCount = () => messages.filter((m) => m.role === "assistant").length;

  const waitForReply = async (before: number) => {
    const deadline = Date.now() + REPLY_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (assistantCount() > before) {
        const last = [...messages].reverse().find((m) => m.role === "assistant");
        return last?.content ?? "";
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error(`agent did not reply within ${REPLY_TIMEOUT_MS}ms`);
  };

  return {
    /** The greeting, before anything is sent. */
    opening: () => waitForReply(0),
    async send(text: string) {
      const before = assistantCount();
      const full = await agents.getConversation(conv.id);
      await agents.addMessage(full, { role: "user", content: text });
      return waitForReply(before);
    },
    transcript: () => messages.map((m) => `${m.role}: ${m.content ?? ""}`).join("\n"),
  };
}

/** Roughly: did it ask one thing, rather than hand over a form? */
export function questionCount(reply: string): number {
  return (reply.match(/\?/g) ?? []).length;
}
