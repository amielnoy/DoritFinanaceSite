/**
 * The FAQ chat's Support-tab row, written by the function. Base44's agent
 * called logSupportChat itself at the end of a chat, when it remembered; this
 * logs every support conversation once, after the function has closed it —
 * IDLE_MS (2 hours) without a message, plus SHEET_LOG_MARGIN_MS — through the existing log-support-chat
 * handler (in-process), which redacts the text and knows the sheet. A
 * conversation that idle is refused as closed on its next message, so the row
 * is the whole conversation. A hand-off does not wait for this: escalateToHuman
 * reaches Dorit during the turn that calls it.
 *
 * A claimed row stays claimed even if its log fails: the transcript is still
 * in the database, and a retry loop on a broken sheet would mail nobody and
 * cost every 15 minutes forever. The failure is logged.
 *
 * At most SHEET_LOG_BATCH conversations a tick, the longest idle first: every
 * claimed row is logged inside this one request, which pg_net gives up on
 * after 30 s, and a row claimed by a request cut off mid-way is never logged.
 * A backlog drains over the next ticks instead.
 */
import type { Log } from '../_shared/log.ts';
import { IDLE_MS } from './handler.ts';
import type { ChatStore } from './store.ts';
import type { EdgeHandler } from './tools.ts';
import type { StoredMessage } from './turn.ts';

/** The roles whose conversations go to the Support tab: the FAQ chat and the procedures chat, as Base44's logSupportChat did for both. */
export const SHEET_LOGGED_ROLES: readonly string[] = ['support', 'procedures'];
/**
 * Past the handler's idle close. The handler reads last_message_at, checks it
 * against IDLE_MS and only then claims the turn; a sweep cutting at exactly
 * IDLE_MS could claim the conversation inside that window, and the turn would
 * run on a row already logged. Five minutes is far longer than the window.
 */
export const SHEET_LOG_MARGIN_MS = 5 * 60 * 1000;
/** A conversation is logged only once no message can extend it. */
export const SHEET_LOG_IDLE_MS = IDLE_MS + SHEET_LOG_MARGIN_MS;
/** A sheet append is one token fetch and one append, each up to 10 s but usually well under one. */
export const SHEET_LOG_BATCH = 10;
const TOPIC_LIMIT = 200;
/**
 * log-support-chat's redact() keeps the first 2,000 characters of the
 * transcript and drops the rest — usually the end, where the outcome was
 * decided. Its markers can lengthen the text, so the row is fitted well under
 * that: the opening and the close, with a marker where the middle was.
 */
export const TRANSCRIPT_LIMIT = 1_800;
const TRANSCRIPT_HEAD = 600;
const CUT = '\n[…]\n';

/** The outcomes log-support-chat knows (its OUTCOMES); anything else is filed as unknown. */
export const SHEET_OUTCOMES = ['answered', 'escalated', 'referred_to_interview', 'abandoned'] as const;
export type SheetOutcome = (typeof SHEET_OUTCOMES)[number];

export interface SheetRow {
  topic: string;
  transcript: string;
  outcome: SheetOutcome;
  messageCount: number;
}

/** The interview link the support prompt gives, as Markdown: `[…](/#start)`. */
const INTERVIEW_LINK = '](/#start)';

/**
 * One conversation as the Support tab's row: the visitor's first question as
 * the topic, what each side said (tool rows left out), and the outcome. Null
 * when the visitor never wrote, which leaves nothing to log.
 */
export function sheetRow(messages: StoredMessage[], escalated: boolean): SheetRow | null {
  const said = messages.filter((x) => x.role === 'user' || x.role === 'assistant');
  const firstQuestion = said.find((x) => x.role === 'user');
  if (!firstQuestion) return null;
  const last = said[said.length - 1];
  const outcome: SheetOutcome = escalated
    ? 'escalated'
    : last.role === 'user'
      ? 'abandoned'
      : said.some((x) => x.role === 'assistant' && x.content.includes(INTERVIEW_LINK))
        ? 'referred_to_interview'
        : 'answered';
  return {
    topic: firstQuestion.content.trim().slice(0, TOPIC_LIMIT),
    transcript: fitTranscript(said.map((x) => `${x.role === 'user' ? 'מבקר' : 'עוזר'}: ${x.content}`).join('\n')),
    outcome,
    messageCount: said.length,
  };
}

/** At most TRANSCRIPT_LIMIT characters (code points, so no emoji is split): the head and the tail when it is longer. */
export function fitTranscript(text: string): string {
  const chars = [...text];
  if (chars.length <= TRANSCRIPT_LIMIT) return text;
  const tail = TRANSCRIPT_LIMIT - TRANSCRIPT_HEAD - CUT.length;
  return chars.slice(0, TRANSCRIPT_HEAD).join('') + CUT + chars.slice(-tail).join('');
}

export interface SheetLogSweepDeps {
  store: Pick<ChatStore, 'claimSheetLogs' | 'listMessages'>;
  logSupportChat: EdgeHandler;
  /** Whether log-support-chat has a sheet to write to (SHEET_ID). Without one nothing is claimed. */
  sheetConfigured(): boolean;
  now(): number;
  log: Log;
}

/** One tick: claim a batch of idle support conversations and log each. Resolves to how many reached the sheet. */
export function createSheetLogSweep(deps: SheetLogSweepDeps): (rid: string) => Promise<number> {
  // A bare `log(`, so the logging contract's scan reads these lines too.
  const { log } = deps;
  return async function sweep(rid: string): Promise<number> {
    // log-support-chat answers ok without a sheet, so a claim now would mark
    // rows logged that no sheet holds. They wait for one instead.
    if (!deps.sheetConfigured()) {
      log('warn', 'sweep.sheet_unconfigured', { rid });
      return 0;
    }
    const now = deps.now();
    const claimed = await deps.store.claimSheetLogs(
      SHEET_LOGGED_ROLES,
      new Date(now - SHEET_LOG_IDLE_MS).toISOString(),
      new Date(now).toISOString(),
      SHEET_LOG_BATCH,
    );
    let logged = 0;
    for (const conversation of claimed) {
      try {
        const row = sheetRow(await deps.store.listMessages(conversation.id), Boolean(conversation.escalated_at));
        if (!row) {
          log('info', 'sweep.nothing_to_log', { rid, conversation: conversation.id });
          continue;
        }
        const res = await deps.logSupportChat(
          new Request('https://chat.internal/functions/v1/log-support-chat', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ channel: 'site', ...row }),
          }),
        );
        // log-support-chat answers 200 with warnings when the append itself
        // failed (it must not fail the chat it logs), and 4xx/5xx otherwise.
        // Its rid names its own lines (support.logged, sheet.append_failed): one search finds both sides.
        const answer = (await res.json().catch(() => null)) as { rid?: unknown; warnings?: unknown } | null;
        const logRid = typeof answer?.rid === 'string' ? answer.rid.slice(0, 16) : '';
        if (!res.ok || (Array.isArray(answer?.warnings) && answer.warnings.length > 0)) {
          log('warn', 'sweep.not_logged', { rid, conversation: conversation.id, logRid, status: res.status, outcome: row.outcome });
          continue;
        }
        log('info', 'sweep.logged', { rid, conversation: conversation.id, logRid, outcome: row.outcome });
        logged += 1;
      } catch (e) {
        log('error', 'sweep.log_failed', { rid, conversation: conversation.id, err: String((e as Error)?.message ?? e).slice(0, 200) });
      }
    }
    log('info', 'sweep.done', { rid, claimed: claimed.length, logged });
    return logged;
  };
}
