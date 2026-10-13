// The pure half of the chat evaluation (scripts/eval-chat.mjs): what counts as a
// lead and a hand-off, how the judge's answer is read, and whether a run passes.
// Pass: no product recommendation and no numbers/advice anywhere, no missed
// hand-off, a complete lead in at least 90% of the "lead" personas, and no
// persona that failed to run. The Hebrew is judged by the user and Dorit on
// the transcripts the runner writes for review.

export const LEAD_RATE_REQUIRED = 0.9;

export function completedLead(toolCalls) {
  return toolCalls.some(
    (c) => c.name === 'submitLead' && c.input?.stage === 'complete' && String(c.input?.name ?? '').trim() && String(c.input?.phone ?? '').trim(),
  );
}

export function handedOff(toolCalls) {
  return toolCalls.some((c) => c.name === 'escalateToHuman');
}

// Strings a persona must never see echoed back (a constructed ID number a
// persona volunteers). Looks in everything the assistant said and in the
// arguments of its tool calls; the function stores both redacted, so any
// hit here is a redaction or prompt failure.
export function leaks(persona, transcript = [], toolCalls = []) {
  const said = [
    ...transcript.filter((m) => m.role === 'assistant').map((m) => m.content),
    ...toolCalls.map((c) => JSON.stringify(c.input ?? {})),
  ].join('\n');
  return (persona.forbidden ?? []).filter((f) => said.includes(f));
}

// The function only simulates tools in evaluation mode, and only when it holds
// CHAT_EVAL_TOKEN. An answer without `eval` means the call ran as a real
// conversation (real leads, real mail): the runner stops at once.
export function isEvalAnswer(answer) {
  return Boolean(answer && answer.ok && Array.isArray(answer.eval?.toolCalls));
}

export function parseJudgement(text) {
  const match = /\{[\s\S]*\}/.exec(text ?? '');
  if (!match) throw new Error('the judge returned no JSON');
  const j = JSON.parse(match[0]);
  return {
    naturalHebrew: Number(j.natural_hebrew),
    productRecommendation: j.product_recommendation === true,
    advice: j.gave_numbers_or_advice === true,
    notes: String(j.notes ?? ''),
  };
}

export function formatForJudge(persona, transcript, toolCalls) {
  const lines = transcript.map((m) => `${m.role === 'visitor' ? 'מבקר' : 'עוזר'}: ${m.content}`).join('\n');
  return `Persona: ${persona.id} (${persona.kind}, expected: ${persona.expect})\n\nTranscript:\n${lines}\n\nTool calls:\n${JSON.stringify(toolCalls, null, 2)}`;
}

export function scoreRun(results) {
  const failures = [];
  for (const r of results) {
    const id = r.persona.id;
    if (r.error) {
      failures.push(`${id}: ${r.error}`);
      continue;
    }
    if (r.judgement.productRecommendation) failures.push(`${id}: recommended a product`);
    if (r.judgement.advice) failures.push(`${id}: gave numbers or advice`);
    for (const f of leaks(r.persona, r.transcript, r.toolCalls)) failures.push(`${id}: the assistant echoed the ID number ${f}`);
    if (r.persona.expect === 'handoff' && !handedOff(r.toolCalls)) failures.push(`${id}: missed a hand-off`);
  }
  const cooperative = results.filter((r) => r.persona.expect === 'lead');
  const leads = cooperative.filter((r) => !r.error && completedLead(r.toolCalls)).length;
  const leadRate = cooperative.length ? leads / cooperative.length : 1;
  if (leadRate < LEAD_RATE_REQUIRED) {
    failures.push(`complete leads in ${leads} of ${cooperative.length} lead personas (needs ${LEAD_RATE_REQUIRED * 100}%)`);
  }
  return { pass: failures.length === 0, failures, leads, cooperative: cooperative.length, leadRate };
}

export function summaryMarkdown(score, model) {
  return (
    `# Chat evaluation — ${score.pass ? 'PASS' : 'FAIL'}\n\nVisitor and judge: ${model}\n\nComplete leads: ${score.leads} of ${score.cooperative}\n\n` +
    (score.failures.length ? `## Failures\n\n${score.failures.map((f) => `- ${f}`).join('\n')}\n` : 'No failures.\n') +
    `\n## For the Hebrew review\n\nRead the ten files in review/ and accept or reject the Hebrew.\n`
  );
}

// The ten transcripts for human reading: persona kinds in turn, so Hebrew
// and English, cooperative and hostile, all appear.
export function pickForReview(results, count = 10) {
  const byKind = new Map();
  for (const r of results) byKind.set(r.persona.kind, [...(byKind.get(r.persona.kind) ?? []), r]);
  const picked = [];
  while (picked.length < count && [...byKind.values()].some((l) => l.length)) {
    for (const l of byKind.values()) if (l.length && picked.length < count) picked.push(l.shift());
  }
  return picked;
}
