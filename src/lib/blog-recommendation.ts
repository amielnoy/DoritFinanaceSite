/**
 * The reading-recommender's closing signal, carried out of the conversation
 * by the page.
 *
 * The agent's recommendation is prose — title, why it is relevant, a
 * `/blog/<id>` link — written for the visitor to read, and the id inside a
 * path is not something to parse reliably out of free text (a model's own
 * markdown habits vary, and a bare path never autolinks without `remark-gfm`
 * anyway). So, mirroring the interview agent's `lead` block, it also states
 * the chosen ids in a fenced block: the page reads it to highlight and
 * scroll to the matching cards already on the page, and the visitor never
 * sees it.
 */

export interface RecommendationResult {
  visible: string;
  ids: string[];
  malformed: boolean;
}

/**
 * The fence the agent is instructed to use.
 *
 * A named language rather than bare ```json, because a model writing about
 * finance emits JSON for other reasons and this must never match one of
 * those — same reasoning as the interview agent's ```lead fence.
 */
const BLOCK = /```recommended\s*\n([\s\S]*?)```/;

/**
 * Pulls the recommended ids out of one message.
 *
 * Returns the text with the block removed in every case, including when the
 * block is malformed — a visitor must never be shown the machinery, least of
 * all a broken version of it.
 */
export function readRecommendation(content: string): RecommendationResult {
  const match = BLOCK.exec(content);
  if (!match) return { visible: content, ids: [], malformed: false };

  const visible = content.replace(BLOCK, "").replace(/\n{3,}/g, "\n\n").trim();

  let raw: unknown;
  try {
    raw = JSON.parse(match[1]);
  } catch {
    return { visible, ids: [], malformed: true };
  }

  if (!Array.isArray(raw) || !raw.every((v) => typeof v === "string" && v.trim())) {
    return { visible, ids: [], malformed: true };
  }

  return { visible, ids: raw, malformed: false };
}
