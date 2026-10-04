/**
 * The interview's closing payload, carried out of the conversation by the page.
 *
 * The agent cannot save it. Its tool calls are not executed in an anonymous
 * conversation — proven by running the same scripted interview twice, one
 * minute apart, against the same build: signed in, `submitLead` fires twice and
 * everything lands; anonymous, it is never invoked and the agent tells the
 * visitor it could not save. Every visitor to the site is anonymous, so no real
 * enquiry has ever reached Dorit. See A-59.
 *
 * The same function, called directly, answers an anonymous caller perfectly
 * well — that is how the quick-contact form has always worked. So the agent
 * states the summary in a fenced block, and the page submits it.
 *
 * This is a workaround for a platform defect and is meant to be removed. What
 * keeps it honest in the meantime is that the page validates what it is given
 * and never shows the block to anybody.
 */

export interface InterviewSummary {
  name: string;
  phone: string;
  email?: string;
  track?: string;
  meetingTopic?: string;
  timing?: string;
  notes?: string;
  /** ISO-ish wall-clock the agent agreed, or empty when none was. */
  scheduledAt?: string;
  summary?: string;
  profile?: Record<string, string>;
}

/**
 * The fence the agent is instructed to use.
 *
 * A named language rather than bare ```json, because a model writing about
 * pensions emits JSON for other reasons and this must never match one of those.
 */
const BLOCK = /```lead\s*\n([\s\S]*?)```/;

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/**
 * Pulls the payload out of one message.
 *
 * Returns the text with the block removed in every case, including when the
 * block is malformed — a visitor must never be shown the machinery, least of
 * all a broken version of it.
 */
export function readHandoff(content: string): {
  visible: string;
  summary: InterviewSummary | null;
  malformed: boolean;
} {
  const match = BLOCK.exec(content);
  if (!match) return { visible: content, summary: null, malformed: false };

  const visible = content.replace(BLOCK, "").replace(/\n{3,}/g, "\n\n").trim();

  let raw: unknown;
  try {
    raw = JSON.parse(match[1]);
  } catch {
    return { visible, summary: null, malformed: true };
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { visible, summary: null, malformed: true };
  }

  const d = raw as Record<string, unknown>;
  const name = str(d.name);
  const phone = str(d.phone);
  // Without these two the backend refuses the submission anyway, and a handoff
  // that cannot be reached is worse than none: the visitor would be told they
  // were passed on while nobody can call them back.
  if (!name || !phone) return { visible, summary: null, malformed: true };

  const profile: Record<string, string> = {};
  if (d.profile && typeof d.profile === "object" && !Array.isArray(d.profile)) {
    for (const [k, v] of Object.entries(d.profile as Record<string, unknown>)) {
      const value = str(v);
      if (value) profile[k] = value;
    }
  }

  return {
    visible,
    malformed: false,
    summary: {
      name,
      phone,
      email: str(d.email) || undefined,
      track: str(d.track) || undefined,
      meetingTopic: str(d.meetingTopic) || undefined,
      timing: str(d.timing) || undefined,
      notes: str(d.notes) || undefined,
      scheduledAt: str(d.scheduledAt) || undefined,
      summary: str(d.summary) || undefined,
      profile: Object.keys(profile).length ? profile : undefined,
    },
  };
}
