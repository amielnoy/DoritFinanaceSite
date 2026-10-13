/**
 * The interview's two tools, run by the function itself — the fix for A-59,
 * where Base44 never ran them in an anonymous conversation.
 *
 * Each calls the existing Edge handler in-process, so the lead and hand-off
 * logic exists once. What the model may decide is the content of the lead;
 * consent and attribution come from the conversation row, never from the model.
 */

export const ESCALATION_REASONS = [
  'regulated_advice',
  'product_recommendation',
  'numbers_or_returns',
  'claim_or_policy',
  'complaint',
  'privacy_request',
  'sensitive_data',
  'out_of_scope',
  'user_request',
  'uncertain',
] as const;

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

const text = { type: 'string' };

export const INTERVIEW_TOOLS: ToolDefinition[] = [
  {
    name: 'submitLead',
    description:
      "שמירת הראיון. stage='partial' בשלב 5 — שמירה שקטה. stage='complete' בסיום, אחרי שהמבקר אישר את הסיכום — שולחת את הסיכום לדורית.",
    input_schema: {
      type: 'object',
      properties: {
        stage: { type: 'string', enum: ['partial', 'complete'] },
        source: { type: 'string', enum: ['interview'] },
        name: text,
        phone: text,
        email: text,
        track: text,
        meetingTopic: text,
        timing: text,
        notes: text,
        scheduledAt: text,
        summary: text,
        profile: { type: 'object', additionalProperties: { type: 'string' } },
      },
      required: ['stage', 'name', 'phone'],
    },
  },
  {
    name: 'escalateToHuman',
    description:
      'העברת הפנייה לטיפול אנושי של דורית: תיעוד הסיבה, התראה מיידית אליה, והחזרת ערוצי הקשר הישירים למבקר.',
    input_schema: {
      type: 'object',
      properties: {
        reason: { type: 'string', enum: [...ESCALATION_REASONS] },
        summary: text,
        name: text,
        phone: text,
        email: text,
      },
      required: ['reason', 'summary'],
    },
  },
];

export type EdgeHandler = (req: Request) => Promise<Response>;
export type ConversationStatus = 'open' | 'closed' | 'lead_saved' | 'escalated';

export interface ConversationFacts {
  id: string;
  status: ConversationStatus;
  /** A hand-off has been made. Kept apart from status, which holds one value: a lead and a hand-off can both be told. Persisted as `escalated_at is not null`. */
  escalated: boolean;
  consentVersion: string;
  consentAt: string;
  attribution: { channel: string; campaign: string; landingPath: string };
}

export interface ToolCallContext {
  conversation: ConversationFacts;
  agent: string;
  origin: string | null;
  userAgent: string | null;
  forwardedFor: string | null;
  evalMode: boolean;
}

export interface ToolOutcome {
  name: string;
  status: 'ok' | 'error' | 'already_saved' | 'already_escalated' | 'simulated';
  forModel: string;
  isError: boolean;
  /** submitLead: the lead it wrote. escalateToHuman: the lead its handler recorded, when the hand-off had contact details. */
  leadId?: string;
  leadSaved?: boolean;
  escalated?: boolean;
}

export type ToolRunner = (name: string, input: Record<string, unknown>, ctx: ToolCallContext) => Promise<ToolOutcome>;

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const plainObject = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

function edgeRequest(fn: string, body: Record<string, unknown>, ctx: ToolCallContext): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (ctx.origin) headers.origin = ctx.origin;
  if (ctx.userAgent) headers['user-agent'] = ctx.userAgent;
  if (ctx.forwardedFor) headers['x-forwarded-for'] = ctx.forwardedFor;
  return new Request(`https://chat.internal/functions/v1/${fn}`, { method: 'POST', headers, body: JSON.stringify(body) });
}

async function answerOf(res: Response): Promise<Record<string, unknown>> {
  return plainObject(await res.json().catch(() => null));
}

export function createToolRunner(handlers: { submitLead: EdgeHandler; escalateToHuman: EdgeHandler }): ToolRunner {
  return async (name, input, ctx) => {
    if (name === 'submitLead') return submitLead(handlers.submitLead, input, ctx);
    if (name === 'escalateToHuman') return escalateToHuman(handlers.escalateToHuman, input, ctx);
    return { name, status: 'error', isError: true, forModel: JSON.stringify({ ok: false, error: 'unknown_tool' }) };
  };
}

async function submitLead(handler: EdgeHandler, input: Record<string, unknown>, ctx: ToolCallContext): Promise<ToolOutcome> {
  const stage = input.stage === 'partial' ? 'partial' : 'complete';
  if (stage === 'complete' && ctx.conversation.status === 'lead_saved') {
    return { name: 'submitLead', status: 'already_saved', isError: false, forModel: JSON.stringify({ ok: true, alreadySaved: true }) };
  }
  if (ctx.evalMode) {
    if (stage === 'complete') ctx.conversation.status = 'lead_saved';
    return { name: 'submitLead', status: 'simulated', isError: false, leadSaved: stage === 'complete', forModel: JSON.stringify({ ok: true, stage }) };
  }
  const { attribution } = ctx.conversation;
  const res = await handler(
    edgeRequest(
      'submit-lead',
      {
        source: 'interview',
        stage,
        name: str(input.name),
        phone: str(input.phone),
        email: str(input.email),
        track: str(input.track),
        meetingTopic: str(input.meetingTopic),
        timing: str(input.timing),
        notes: str(input.notes),
        scheduledAt: str(input.scheduledAt),
        summary: str(input.summary),
        profile: plainObject(input.profile),
        consent_version: ctx.conversation.consentVersion,
        consent_at: ctx.conversation.consentAt,
        channel: attribution.channel,
        campaign: attribution.campaign,
        landingPath: attribution.landingPath,
      },
      ctx,
    ),
  );
  const answer = await answerOf(res);
  if (!res.ok || answer.ok !== true) {
    const error = typeof answer.error === 'string' ? answer.error : 'השמירה נכשלה';
    return { name: 'submitLead', status: 'error', isError: true, leadSaved: false, forModel: JSON.stringify({ ok: false, error }) };
  }
  const leadId = typeof answer.leadId === 'string' ? answer.leadId : undefined;
  if (stage === 'complete') ctx.conversation.status = 'lead_saved';
  return { name: 'submitLead', status: 'ok', isError: false, leadId, leadSaved: stage === 'complete', forModel: JSON.stringify({ ok: true, stage }) };
}

/** The hand-off is a fact of its own; status becomes 'escalated' only from 'open', never over 'lead_saved' or 'closed'. */
function markEscalated(c: ConversationFacts): void {
  c.escalated = true;
  if (c.status === 'open') c.status = 'escalated';
}

async function escalateToHuman(handler: EdgeHandler, input: Record<string, unknown>, ctx: ToolCallContext): Promise<ToolOutcome> {
  // One successful hand-off per conversation: a second call mails no one.
  if (ctx.conversation.escalated) {
    return { name: 'escalateToHuman', status: 'already_escalated', isError: false, forModel: JSON.stringify({ ok: true, alreadyEscalated: true }) };
  }
  const reason = (ESCALATION_REASONS as readonly string[]).includes(str(input.reason)) ? str(input.reason) : 'uncertain';
  if (ctx.evalMode) {
    markEscalated(ctx.conversation);
    return { name: 'escalateToHuman', status: 'simulated', isError: false, escalated: true, forModel: JSON.stringify({ ok: true }) };
  }
  const { attribution } = ctx.conversation;
  const res = await handler(
    edgeRequest(
      'escalate-to-human',
      {
        reason,
        summary: str(input.summary),
        agent: ctx.agent,
        name: str(input.name),
        phone: str(input.phone),
        email: str(input.email),
        consentVersion: ctx.conversation.consentVersion,
        consentAt: ctx.conversation.consentAt,
        channel: attribution.channel,
        campaign: attribution.campaign,
        landingPath: attribution.landingPath,
      },
      ctx,
    ),
  );
  const answer = await answerOf(res);
  const ok = res.ok && answer.ok === true;
  if (ok) markEscalated(ctx.conversation);
  const leadId = ok && typeof answer.leadId === 'string' ? answer.leadId : undefined;
  return {
    name: 'escalateToHuman',
    status: ok ? 'ok' : 'error',
    isError: !ok,
    escalated: ok,
    leadId,
    forModel: JSON.stringify({ ok, contact: answer.contact ?? null, acknowledgement: answer.acknowledgement ?? '', error: answer.error ?? undefined }),
  };
}
