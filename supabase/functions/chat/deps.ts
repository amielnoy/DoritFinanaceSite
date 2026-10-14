/**
 * The chat function's real dependencies. Imported lazily by handler.ts, so a
 * unit test of the handler never loads Deno-only modules.
 */
import { NOTIFY_EMAILS } from '../escalate-to-human/escalation.js';
import { handler as escalateToHuman } from '../escalate-to-human/handler.ts';
import { handler as logSupportChat } from '../log-support-chat/handler.ts';
import { withinLimit } from '../_shared/guard.ts';
import { createLog } from '../_shared/log.ts';
import { sendMail } from '../_shared/mail.ts';
import { handler as submitLead } from '../submit-lead/handler.ts';
import { createAnthropicClient, DEFAULT_CHAT_MODEL } from './anthropic.ts';
import { restArticles } from './articles.ts';
import { parseBudget } from './budget.ts';
import type { ChatDeps } from './handler.ts';
import { restStore } from './store.ts';
import { createSheetLogSweep } from './sweep.ts';
import { createToolRunner } from './tools.ts';

const log = createLog('chat');

function newToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function liveDeps(): ChatDeps {
  const apiKey = (Deno.env.get('ANTHROPIC_API_KEY') || '').trim();
  const model = (Deno.env.get('CHAT_MODEL') || '').trim() || DEFAULT_CHAT_MODEL;
  return {
    now: () => Date.now(),
    store: restStore,
    model: apiKey ? createAnthropicClient({ apiKey, model }) : null,
    runTool: createToolRunner({ submitLead, escalateToHuman }, restArticles),
    allow: (rid, key, windowSeconds, max) => withinLimit(log, rid, key, windowSeconds, max),
    monthlyBudgetUsd: parseBudget(Deno.env.get('CHAT_MONTHLY_BUDGET_USD')),
    evalToken: (Deno.env.get('CHAT_EVAL_TOKEN') || '').trim(),
    newToken,
    sweepToken: (Deno.env.get('CHAT_SWEEP_TOKEN') || '').trim(),
    // log-support-chat in-process, as the tools call submit-lead: same redaction, same sheet row.
    sweepSheetLogs: createSheetLogSweep({ store: restStore, logSupportChat, now: () => Date.now(), log }),
    notifyBudgetReached: async (rid) => {
      for (const to of NOTIFY_EMAILS as string[]) {
        await sendMail(log, {
          to,
          subject: 'הצ׳אט באתר הגיע לתקרת התקציב החודשית',
          text:
            'שיחות חדשות בצ׳אט מקבלות עכשיו את פרטי הקשר הישירים של דורית במקום העוזר האוטומטי, ' +
            'עד תחילת החודש הבא או עד שהתקרה (CHAT_MONTHLY_BUDGET_USD) תועלה. שיחות פתוחות ממשיכות כרגיל.',
          rid,
          role: 'staff',
        });
      }
    },
  };
}
