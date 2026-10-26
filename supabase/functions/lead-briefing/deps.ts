/**
 * lead-briefing's real dependencies. Imported lazily by handler.ts, so a unit
 * test of the handler never loads Deno-only modules.
 */
import { withinLimit } from '../_shared/guard.ts';
import { createLog } from '../_shared/log.ts';
import { callRpc, insertRow, selectRows } from '../_shared/rest.ts';
import { allowLead, sessionCaller } from '../_shared/staff.ts';
import { createAnthropicClient, DEFAULT_CHAT_MODEL } from '../chat/anthropic.ts';
import { parseBriefingBudget } from './briefing.ts';
import type { BriefingDeps } from './handler.ts';

const log = createLog('lead-briefing');

const text = (v: unknown) => (typeof v === 'string' ? v : '');

export function liveDeps(): BriefingDeps {
  const apiKey = (Deno.env.get('ANTHROPIC_API_KEY') || '').trim();
  // The chat's model unless the briefing names its own.
  const model = (Deno.env.get('LEAD_BRIEFING_MODEL') || Deno.env.get('CHAT_MODEL') || '').trim() || DEFAULT_CHAT_MODEL;
  return {
    now: () => Date.now(),
    model: apiKey ? createAnthropicClient({ apiKey, model }) : null,
    monthlyBudgetUsd: parseBriefingBudget(Deno.env.get('LEAD_BRIEFING_MONTHLY_BUDGET_USD')),
    session: (req, rid) => sessionCaller(req, rid, log),
    canSee: (session, leadId, rid) => allowLead(session, leadId, rid, log),
    allow: (rid, key, windowSeconds, max) => withinLimit(log, rid, key, windowSeconds, max),
    async loadLead(leadId) {
      const rows = await selectRows(
        'leads',
        `id=eq.${leadId}&select=agency_id,name,phone,email,source,topic,timing,message,anonymized_at`,
      );
      const r = rows[0];
      if (!r) return null;
      return {
        agencyId: text(r.agency_id),
        name: text(r.name),
        phone: text(r.phone),
        email: text(r.email),
        source: text(r.source),
        topic: text(r.topic),
        timing: text(r.timing),
        message: text(r.message),
        anonymized: r.anonymized_at != null,
      };
    },
    async loadTranscript(leadId) {
      const conversations = await selectRows(
        'chat_conversations',
        `lead_id=eq.${leadId}&select=id&order=created_at.desc&limit=1`,
      );
      const id = text(conversations[0]?.id);
      if (!id) return [];
      const rows = await selectRows(
        'chat_messages',
        `conversation_id=eq.${id}&role=in.(user,assistant)&select=role,content&order=id.asc&limit=500`,
      );
      return rows.map((r) => ({ role: r.role === 'user' ? ('user' as const) : ('assistant' as const), content: text(r.content) }));
    },
    async monthUsage(agencyId, sinceIso) {
      const rows = await callRpc('lead_briefing_month_usage', { p_agency_id: agencyId, p_since: sinceIso });
      return (Array.isArray(rows) ? rows : []).map((r: Record<string, unknown>) => ({
        model: String(r.model ?? ''),
        input_tokens: Number(r.input_tokens ?? 0),
        cached_tokens: Number(r.cached_tokens ?? 0),
        output_tokens: Number(r.output_tokens ?? 0),
      }));
    },
    async save({ leadId, agencyId, briefing, model, usage, createdBy }) {
      const row = await insertRow('lead_briefings', {
        lead_id: leadId,
        agency_id: agencyId,
        summary: briefing.summary,
        concern: briefing.concern,
        questions: briefing.questions,
        talking_points: briefing.talkingPoints,
        model,
        input_tokens: usage.input,
        cached_tokens: usage.cached,
        output_tokens: usage.output,
        created_by: createdBy,
      });
      return { id: Number(row.id), createdAt: text(row.created_at) };
    },
  };
}
