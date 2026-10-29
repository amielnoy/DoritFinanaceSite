/**
 * The chat tools, run by the function itself — the fix for A-59, where the
 * old agent host never ran them in an anonymous conversation. The interview has submitLead and
 * escalateToHuman; the support agent has escalateToHuman and two article tools
 * that only read (listArticles, readArticle).
 *
 * submitLead and escalateToHuman each call the existing Edge handler in-process,
 * so the lead and hand-off logic exists once. What the model may decide is the content of the lead;
 * consent and attribution come from the conversation row, never from the model.
 */

import type { ArticleSource } from './articles.ts';

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

const NO_ARTICLES: ArticleSource = { list: async () => [], read: async () => null };

export const SUBMIT_LEAD_TOOL: ToolDefinition = {
  name: 'submitLead',
  description:
    "שמירת הראיון. stage='partial' בשלב 5 — שמירה שקטה: אל תזכיר אותה למבקר, אבל המשך באותה הודעה לשאלה הבאה בראיון. stage='complete' בסיום, אחרי שהמבקר אישר את הסיכום — שולחת את הסיכום לדורית.",
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
};

export const ESCALATE_TOOL: ToolDefinition = {
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
};

export const LIST_ARTICLES_TOOL: ToolDefinition = {
  name: 'listArticles',
  description: 'רשימת המאמרים שפורסמו באתר: slug, כותרת, תקציר ותגיות. קרא אותה לפני שאתה מפנה למאמר.',
  input_schema: { type: 'object', properties: {} },
};

export const READ_ARTICLE_TOOL: ToolDefinition = {
  name: 'readArticle',
  description: 'הטקסט המלא של מאמר אחד, לפי ה-slug שחזר מ-listArticles. truncated=true כשהמאמר ארוך ונחתך.',
  input_schema: { type: 'object', properties: { slug: { type: 'string' } }, required: ['slug'] },
};

/** At most this many articles highlighted per turn — the prompt's "עד 3". */
export const RECOMMEND_LIMIT = 3;

/** The blog recommender's hidden ```recommended block, as a tool: the page highlights what it names (SupabaseAgentService re-encodes it). */
export const RECOMMEND_ARTICLES_TOOL: ToolDefinition = {
  name: 'recommendArticles',
  description: 'מסמן לדף את המאמרים שהמלצת עליהם בהודעה הזו, כדי שיבליט אותם: עד 3 slug שחזרו מ-listArticles, בסדר הרלוונטיות.',
  input_schema: { type: 'object', properties: { slugs: { type: 'array', items: { type: 'string' }, maxItems: RECOMMEND_LIMIT } }, required: ['slugs'] },
};

export const INTERVIEW_TOOLS: ToolDefinition[] = [SUBMIT_LEAD_TOOL, ESCALATE_TOOL];
export const SUPPORT_TOOLS: ToolDefinition[] = [LIST_ARTICLES_TOOL, READ_ARTICLE_TOOL, ESCALATE_TOOL];
export const BLOG_TOOLS: ToolDefinition[] = [LIST_ARTICLES_TOOL, READ_ARTICLE_TOOL, RECOMMEND_ARTICLES_TOOL, ESCALATE_TOOL];

export type EdgeHandler = (req: Request) => Promise<Response>;
export type ConversationStatus = 'open' | 'closed' | 'lead_saved' | 'escalated';

export interface ConversationFacts {
  id: string;
  status: ConversationStatus;
  /** A hand-off has been made. Kept apart from status, which holds one value: a lead and a hand-off can both be told. Persisted as `escalated_at is not null`. */
  escalated: boolean;
  /** The conversation has a lead — a saved interview, or a hand-off that carried a name and phone. Persisted as `lead_id is not null`. */
  hasLead: boolean;
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
  /** recommendArticles: the slugs the page should highlight — each one readArticle would find. */
  recommended?: string[];
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

export function createToolRunner(handlers: { submitLead: EdgeHandler; escalateToHuman: EdgeHandler }, articles: ArticleSource = NO_ARTICLES): ToolRunner {
  return async (name, input, ctx) => {
    try {
      if (name === 'listArticles') {
        return { name, status: 'ok', isError: false, forModel: JSON.stringify({ ok: true, articles: await articles.list() }) };
      }
      if (name === 'readArticle') {
        const found = await articles.read(str(input.slug));
        return found
          ? { name, status: 'ok', isError: false, forModel: JSON.stringify({ ok: true, ...found }) }
          : { name, status: 'error', isError: true, forModel: JSON.stringify({ ok: false, error: 'not_found' }) };
      }
      if (name === 'recommendArticles') {
        // Only what the visitor can open: a slug the store does not hold (a model slip,
        // or an article unpublished since) is dropped and named back to the model.
        const asked = Array.isArray(input.slugs) ? input.slugs.filter((v): v is string => typeof v === 'string') : [];
        const kept: string[] = [];
        const dropped: string[] = [];
        for (const slug of [...new Set(asked)]) {
          if (kept.length >= RECOMMEND_LIMIT) break;
          if (await articles.read(slug)) kept.push(slug);
          else dropped.push(slug);
        }
        return kept.length
          ? { name, status: 'ok', isError: false, recommended: kept, forModel: JSON.stringify({ ok: true, recommended: kept, dropped, next: RECOMMENDED_NEXT }) }
          : { name, status: 'error', isError: true, forModel: JSON.stringify({ ok: false, error: 'no_known_article', dropped }) };
      }
      if (name === 'submitLead') return await submitLead(handlers.submitLead, input, ctx);
      if (name === 'escalateToHuman') return await escalateToHuman(handlers.escalateToHuman, input, ctx);
    } catch {
      // A handler that throws (both catch their own errors today) is a failed tool the
      // model can tell the visitor about, never a crashed turn. The conversation is
      // marked only after a handler answers ok, so it is left as it was.
      return { name, status: 'error', isError: true, forModel: JSON.stringify({ ok: false, error: 'tool_failed' }) };
    }
    return { name, status: 'error', isError: true, forModel: JSON.stringify({ ok: false, error: 'unknown_tool' }) };
  };
}

async function submitLead(handler: EdgeHandler, input: Record<string, unknown>, ctx: ToolCallContext): Promise<ToolOutcome> {
  // The model has called this with no input at all (the evaluation of 2026-10-14).
  // A missing stage must not read as "complete": that would end the interview —
  // and in an evaluation run mark the lead saved with no name or phone.
  if (input.stage !== 'partial' && input.stage !== 'complete') {
    return refusedSave('חסר stage. שלח שוב עם stage ("partial" או "complete"), name ו-phone.');
  }
  const stage = input.stage;
  // Any stage: submit-lead's dedupe matches only partial leads, so a save after a complete one would insert a second row.
  if (ctx.conversation.status === 'lead_saved') {
    return { name: 'submitLead', status: 'already_saved', isError: false, forModel: JSON.stringify({ ok: true, alreadySaved: true, next: ALREADY_DONE_NEXT }) };
  }
  if (ctx.evalMode) {
    // The simulation answers as submit-lead would: it refuses a lead with no contact.
    if (!str(input.name).trim() || !str(input.phone).trim()) return refusedSave('נדרשים שם וטלפון');
    if (stage === 'complete') ctx.conversation.status = 'lead_saved';
    return { name: 'submitLead', status: 'simulated', isError: false, leadSaved: stage === 'complete', forModel: savedForModel(stage) };
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
        // This conversation: its complete save finds its partial one by this,
        // never by the phone and name the model wrote (review 2026-10-15).
        conversationRef: `chat:${ctx.conversation.id}`,
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
  return { name: 'submitLead', status: 'ok', isError: false, leadId, leadSaved: stage === 'complete', forModel: savedForModel(stage) };
}

/** A save refused before it reached submit-lead: the conversation is left as it was. */
function refusedSave(error: string): ToolOutcome {
  return { name: 'submitLead', status: 'error', isError: true, leadSaved: false, forModel: JSON.stringify({ ok: false, error }) };
}

/**
 * What a successful save tells the model — always what to write next. A bare
 * answer was read as "say nothing": "a silent save" ended turns in an empty
 * reply (#181), and so did a bare { ok, stage: 'complete' } in the evaluation
 * of 2026-10-14, at the very end of an interview.
 */
function savedForModel(stage: 'partial' | 'complete'): string {
  return stage === 'partial'
    ? JSON.stringify({ ok: true, stage, next: 'נשמר בשקט. אל תזכיר את השמירה; המשך באותה הודעה לשאלה הבאה בראיון.' })
    : JSON.stringify({
        ok: true,
        stage,
        next: 'נשמר, והסיכום נשלח לדורית. כתוב עכשיו למבקר הודעת סיום קצרה: הפרטים אצל דורית, והיא תחזור אליו בעצמה. בלי שאלות נוספות.',
      });
}

/** A second save or hand-off changes nothing; the model still owes the visitor a reply. */
/**
 * What the model does after recommending. Told nothing, it took the cards as the
 * whole answer and replied with one empty token, twice — a 503 on the first
 * blog question of the evaluation of 2026-10-16.
 */
export const RECOMMENDED_NEXT =
  'ההמלצות יוצגו למבקר ככרטיסים מתחת לתשובה. כתוב עכשיו תשובה קצרה בעברית — משפט או שניים שמסבירים למה המאמרים האלה עונים על מה ששאל. אל תעתיק את רשימת המאמרים.';

const ALREADY_DONE_NEXT = 'זה כבר נעשה קודם בשיחה, ולא נשלח שוב. ענה למבקר על מה שכתב עכשיו, בקצרה.';

/** The hand-off is a fact of its own; status becomes 'escalated' only from 'open', never over 'lead_saved' or 'closed'. */
function markEscalated(c: ConversationFacts): void {
  c.escalated = true;
  if (c.status === 'open') c.status = 'escalated';
}

/** An Israeli phone as escalate-to-human accepts it for a lead (escalation.js validPhone). */
const contactPhone = (raw: string): boolean => /^0\d{8,9}$/.test(raw.replace(/[-\s]/g, ''));

async function escalateToHuman(handler: EdgeHandler, input: Record<string, unknown>, ctx: ToolCallContext): Promise<ToolOutcome> {
  // One successful hand-off per conversation: a second call mails no one —
  // except one follow-up. The hand-off (§5) asks for a name and phone only
  // after the call, so the details a visitor gives then would otherwise never
  // reach Dorit (A-55). The follow-up carries them while the conversation has
  // no lead yet; the lead it makes ends it.
  const followUp = ctx.conversation.escalated && !ctx.conversation.hasLead && str(input.name) !== '' && contactPhone(str(input.phone));
  if (ctx.conversation.escalated && !followUp) {
    return { name: 'escalateToHuman', status: 'already_escalated', isError: false, forModel: JSON.stringify({ ok: true, alreadyEscalated: true, next: ALREADY_DONE_NEXT }) };
  }
  const reason = (ESCALATION_REASONS as readonly string[]).includes(str(input.reason)) ? str(input.reason) : 'uncertain';
  if (ctx.evalMode) {
    markEscalated(ctx.conversation);
    if (followUp) ctx.conversation.hasLead = true;
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
  // A follow-up is spent once it went through, lead or not: the next call mails no one.
  if (leadId || (ok && followUp)) ctx.conversation.hasLead = true;
  return {
    name: 'escalateToHuman',
    status: ok ? 'ok' : 'error',
    isError: !ok,
    escalated: ok,
    leadId,
    forModel: JSON.stringify({ ok, contact: answer.contact ?? null, acknowledgement: answer.acknowledgement ?? '', error: answer.error ?? undefined }),
  };
}
