/**
 * "תדריך לפני שיחה" (feature 4): an AI draft for the agent before a call —
 * three lines on the interview, the client's main concern, three questions to
 * ask and the service areas worth raising. Shown in the lead's drawer behind
 * VITE_LEAD_BRIEFING.
 *
 * POST { leadId } with the caller's session. Generates a new briefing and
 * returns it; the drawer reads the newest one from lead_briefings itself, so
 * a briefing is made only when someone asks for one.
 *   1. Off unless LEAD_BRIEFING_MONTHLY_BUDGET_USD is above 0 and the model
 *      key is set: the switch on the server, beside the screen's flag.
 *   2. The session, then can_see_lead under it — the lead's assignee, the
 *      agency's Admins and Owners, or the platform operator.
 *   3. A cap per person per hour, and the agency's monthly budget.
 *   4. The model reads the interview alone, scrubbed of phones, emails,
 *      numbers and the name (briefing.ts) — never the contact details.
 *   5. The answer is cut to the table's shape and saved with its token counts.
 *
 * Logged by ids and counts alone: never the interview, nor the briefing.
 */
import { corsHeaders } from '../_shared/cors.ts';
import { createLog, newRequestId } from '../_shared/log.ts';
import type { Refusal, Session } from '../_shared/staff.ts';
import type { ModelClient, ModelUsage } from '../chat/anthropic.ts';
import { monthStartIso, spendUsd, type UsageTotals } from '../chat/budget.ts';
import {
  BRIEFING_SYSTEM,
  BRIEFING_TOOL,
  BRIEFING_TOOL_NAME,
  interviewMaterial,
  parseBriefing,
  type Briefing,
  type BriefingLead,
  type TranscriptTurn,
} from './briefing.ts';

const FN = 'lead-briefing';
const log = createLog(FN);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const PER_USER_PER_HOUR = 30;
export const MODEL_TIMEOUT_MS = 25_000;
export const MAX_BRIEFING_TOKENS = 1_200;

export interface SavedBriefing {
  id: number;
  createdAt: string;
}

export interface BriefingDeps {
  now(): number;
  /** Null without ANTHROPIC_API_KEY. */
  model: ModelClient | null;
  /** LEAD_BRIEFING_MONTHLY_BUDGET_USD; 0 (the default) keeps the function off. */
  monthlyBudgetUsd: number;
  session(req: Request, rid: string): Promise<Session | Refusal>;
  canSee(session: Session, leadId: string, rid: string): Promise<Session | Refusal>;
  allow(rid: string, key: string, windowSeconds: number, max: number): Promise<boolean>;
  loadLead(leadId: string): Promise<BriefingLead | null>;
  loadTranscript(leadId: string): Promise<TranscriptTurn[]>;
  monthUsage(agencyId: string, sinceIso: string): Promise<UsageTotals[]>;
  save(row: {
    leadId: string;
    agencyId: string;
    briefing: Briefing;
    model: string;
    usage: ModelUsage;
    createdBy: string;
  }): Promise<SavedBriefing>;
}

export function createBriefingHandler(deps: BriefingDeps) {
  return async (req: Request): Promise<Response> => {
    const cors = corsHeaders(req.headers.get('origin'));
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    const rid = newRequestId();
    const startedAt = Date.now();
    const json = (body: Record<string, unknown>, status = 200) =>
      Response.json({ ...body, rid }, { status, headers: { ...cors, 'Cache-Control': 'no-store' } });

    log('info', 'request.start', { rid });
    try {
      if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
      if (!deps.model || !(deps.monthlyBudgetUsd > 0)) {
        log('info', 'briefing.off', { rid, model: Boolean(deps.model) });
        return json({ error: 'התדריך אינו פעיל.' }, 503);
      }

      const session = await deps.session(req, rid);
      if (!session.ok) return json({ error: session.error }, session.status);

      const body = (await req.json().catch(() => null)) as { leadId?: unknown } | null;
      const leadId = typeof body?.leadId === 'string' ? body.leadId.toLowerCase() : '';
      if (!UUID.test(leadId)) return json({ error: 'הפנייה אינה מוכרת.' }, 400);

      const allowed = await deps.canSee(session, leadId, rid);
      if (!allowed.ok) return json({ error: allowed.error }, allowed.status);

      if (!(await deps.allow(rid, `lead-briefing:${session.userId}`, 3600, PER_USER_PER_HOUR))) {
        log('warn', 'request.rejected', { rid, reason: 'rate_limited' });
        return json({ error: 'נוצרו תדריכים רבים בשעה האחרונה. אפשר לנסות שוב מאוחר יותר.' }, 429);
      }

      const lead = await deps.loadLead(leadId);
      if (!lead || lead.anonymized) return json({ error: 'הפנייה לא נמצאה.' }, 404);

      const material = interviewMaterial(lead, await deps.loadTranscript(leadId));
      if (!material) {
        log('info', 'briefing.no_material', { rid, leadId });
        return json({ error: 'אין בפנייה הזו תוכן ראיון שאפשר להכין ממנו תדריך.' }, 422);
      }

      const spent = spendUsd(await deps.monthUsage(lead.agencyId, monthStartIso(deps.now())));
      if (spent >= deps.monthlyBudgetUsd) {
        log('warn', 'briefing.budget_reached', { rid, agencyId: lead.agencyId });
        return json({ error: 'הגעתם לתקרת התקציב החודשית לתדריכים. היא תתאפס בתחילת החודש הבא.' }, 429);
      }

      const answer = await deps.model.complete(
        {
          system: [{ type: 'text', text: BRIEFING_SYSTEM }],
          messages: [{ role: 'user', content: material }],
          tools: [BRIEFING_TOOL],
          toolChoice: { name: BRIEFING_TOOL_NAME },
          maxTokens: MAX_BRIEFING_TOKENS,
        },
        AbortSignal.timeout(MODEL_TIMEOUT_MS),
      );
      const call = answer.content.find((b) => b.type === 'tool_use' && b.name === BRIEFING_TOOL_NAME);
      const briefing = parseBriefing(call && call.type === 'tool_use' ? call.input : null);
      if (!briefing) {
        log('warn', 'briefing.unusable', { rid, leadId, stop: answer.stopReason });
        return json({ error: 'התדריך לא נוצר. אפשר לנסות שוב.' }, 502);
      }

      const saved = await deps.save({
        leadId,
        agencyId: lead.agencyId,
        briefing,
        model: answer.model,
        usage: answer.usage,
        createdBy: session.userId,
      });
      log('info', 'request.end', {
        rid,
        ms: Date.now() - startedAt,
        leadId,
        userId: session.userId,
        input: answer.usage.input,
        output: answer.usage.output,
      });
      return json({ ok: true, briefing: { ...briefing, id: saved.id, createdAt: saved.createdAt, createdBy: session.userId } });
    } catch (e) {
      log('error', 'request.failed', { rid, ms: Date.now() - startedAt, err: String((e as Error)?.message ?? e).slice(0, 200) });
      return json({ error: 'התדריך לא נוצר. אפשר לנסות שוב.' }, 500);
    }
  };
}

let live: ((req: Request) => Promise<Response>) | null = null;

export async function handler(req: Request): Promise<Response> {
  if (!live) {
    const { liveDeps } = await import('./deps.ts');
    live = createBriefingHandler(liveDeps());
  }
  return live(req);
}
