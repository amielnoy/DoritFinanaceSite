// The Hebrew evaluation of the chat function — the gate before launch.
// docs/superpowers/specs/2026-10-13-chat-off-base44-design.md, "Testing".
//
// A Sonnet model plays each persona in tests/eval/chat/personas.json against
// the deployed function, in evaluation mode (x-chat-eval: tools are simulated,
// nothing reaches Dorit, the rows are purged within a day). A second Sonnet
// call scores each transcript with tests/eval/chat/rubric.md, or
// rubric-support.md for a persona of the FAQ chat (`"agent": "support_agent"`).
//
//   CHAT_EVAL_URL      https://<ref>.supabase.co/functions/v1/chat
//   CHAT_EVAL_TOKEN    the function secret of the same name
//   ANTHROPIC_API_KEY  for the visitor and the judge
//   EVAL_MODEL         default claude-sonnet-5-5
//   EVAL_ONLY          optional comma-separated persona ids
//
// Writes eval-results/chat-<time>/{results.json,summary.md,review/*.md} and
// exits 1 when the run does not pass. About $3 a run.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { agentFor, assertEvalFirstTurn, chatBody, completedLead, maxVisitorTurns, turnStats, EvalStop, formatForJudge, handedOff, isEvalAnswer, parseJudgement, pickForReview, rubricFor, runAll, scoreRun, summaryMarkdown } from './eval-chat-lib.mjs';

const env = process.env;
const missing = ['CHAT_EVAL_URL', 'CHAT_EVAL_TOKEN', 'ANTHROPIC_API_KEY'].filter((k) => !env[k]);
if (missing.length) {
  console.error(`Missing ${missing.join(', ')}. See README, "The Hebrew evaluation of the chat function".`);
  process.exit(2);
}

const MODEL = env.EVAL_MODEL || 'claude-sonnet-5-5';
const MAX_VISITOR_TURNS = maxVisitorTurns(env.EVAL_MAX_TURNS);
const only = env.EVAL_ONLY ? new Set(env.EVAL_ONLY.split(',').map((s) => s.trim())) : null;
const personas = JSON.parse(readFileSync('tests/eval/chat/personas.json', 'utf8')).filter((p) => !only || only.has(p.id));
const rubrics = {
  interview: readFileSync('tests/eval/chat/rubric.md', 'utf8'),
  support: readFileSync('tests/eval/chat/rubric-support.md', 'utf8'),
  procedures: readFileSync('tests/eval/chat/rubric-procedures.md', 'utf8'),
};

async function claude(system, messages, maxTokens = 600) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODEL, max_tokens: maxTokens, system, messages }),
  });
  if (!res.ok) throw new Error(`anthropic answered ${res.status}`);
  const json = await res.json();
  return json.content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
}

async function chat(body) {
  const headers = { 'content-type': 'application/json', 'x-chat-eval': env.CHAT_EVAL_TOKEN };
  if (env.VITE_SUPABASE_PUBLISHABLE_KEY) headers.apikey = env.VITE_SUPABASE_PUBLISHABLE_KEY;
  const res = await fetch(env.CHAT_EVAL_URL, { method: 'POST', headers, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  return { httpStatus: res.status, ...json };
}

// The FAQ and procedures chats save no lead, so their visitor also leaves once answered.
const visitorSystem = (p) =>
  `את/ה משחק/ת מבקר/ת באתר של מתכננת פיננסית וסוכנת ביטוח בישראל, ומשוחח/ת עם העוזר האוטומטי שלה.\n` +
  `הדמות: ${p.brief}\n` +
  `כתוב/י רק את ההודעה הבאה של הדמות — קצרה וטבעית, בשפה של הדמות. אל תצא/י מהדמות ואל תסביר/י. ` +
  (['support_agent', 'procedures_agent'].includes(agentFor(p))
    ? `כשהשיחה הסתיימה מבחינת הדמות (קיבלה תשובה לשאלתה, הועברה לאדם, או שהדמות הייתה עוזבת) — כתוב/י בדיוק [END].`
    : `כשהשיחה הסתיימה מבחינת הדמות (העוזר אישר שהפרטים נשמרו, העביר לאדם, או שהדמות הייתה עוזבת) — כתוב/י בדיוק [END].`);

async function runPersona(p) {
  const transcript = [];
  const toolCalls = [];
  let conversationId = null;
  let token = null;
  for (let turn = 0; turn < MAX_VISITOR_TURNS; turn++) {
    const view = transcript.map((m) => ({ role: m.role === 'visitor' ? 'assistant' : 'user', content: m.content }));
    const next = await claude(visitorSystem(p), [{ role: 'user', content: 'התחל/י את השיחה.' }, ...view]);
    if (next.includes('[END]')) break;
    transcript.push({ role: 'visitor', content: next });
    const answer = await chat(chatBody(p, next, conversationId ? { id: conversationId, token } : null));
    if (!conversationId) assertEvalFirstTurn(answer);
    if (!isEvalAnswer(answer)) {
      if (answer.ok) throw new EvalStop('a later answer was not in evaluation mode; stopping');
      return { persona: p, transcript, toolCalls, error: `chat answered ${answer.httpStatus} ${answer.code ?? ''}`.trim() };
    }
    conversationId = answer.conversationId;
    token = answer.token ?? token;
    toolCalls.push(...(answer.eval?.toolCalls ?? []));
    transcript.push({ role: 'assistant', content: answer.reply });
    if (answer.leadSaved) break;
  }
  const verdict = await claude(rubricFor(p, rubrics), [{ role: 'user', content: formatForJudge(p, transcript, toolCalls) }], 800);
  return { persona: p, transcript, toolCalls, judgement: parseJudgement(verdict) };
}

let results;
try {
  results = await runAll({
    personas,
    chat,
    runPersona,
    log: (id) => process.stdout.write(`${id} … `),
  });
} catch (e) {
  if (!(e instanceof EvalStop)) throw e;
  console.error(`\n${e.message}`);
  process.exit(3);
}
for (const r of results) console.log(`${r.persona.id}: ${r.error ?? `${completedLead(r.toolCalls) ? 'lead' : handedOff(r.toolCalls) ? 'handoff' : 'none'} · hebrew ${r.judgement.naturalHebrew}`}`);

const score = scoreRun(results);
const dir = join('eval-results', `chat-${new Date().toISOString().replace(/[:.]/g, '-')}`);
mkdirSync(join(dir, 'review'), { recursive: true });
writeFileSync(join(dir, 'results.json'), JSON.stringify({ model: MODEL, score, results }, null, 2));
writeFileSync(join(dir, 'summary.md'), summaryMarkdown({ ...score, turns: turnStats(results), turnCap: MAX_VISITOR_TURNS }, MODEL));
for (const r of pickForReview(results)) {
  writeFileSync(join(dir, 'review', `${r.persona.id}.md`), `# ${r.persona.id}\n\n${formatForJudge(r.persona, r.transcript, r.toolCalls)}\n`);
}
console.log(`\n${score.pass ? 'PASS' : 'FAIL'} — ${dir}/summary.md`);
process.exit(score.pass ? 0 : 1);
