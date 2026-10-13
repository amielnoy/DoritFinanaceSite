/**
 * A forwarder. The Base44 chat agents can only call Base44 functions, so this
 * one stays as their tool until the agents move (Phase 3). The work is done by
 * the Supabase Edge Function EDGE; this passes the request through and the
 * answer back. See docs/superpowers/specs/2026-10-12-connectors-off-base44-design.md.
 */
const FN = 'logSupportChat';
const EDGE = 'log-support-chat';

function log(level, event, fields) {
  console[level === 'error' ? 'error' : 'log'](JSON.stringify({ t: new Date().toISOString(), level, fn: FN, event, ...fields }));
}

export default async function (req) {
  const url = (Deno.env.get('SUPABASE_URL') || '').trim();
  if (!url) {
    log('error', 'forward.unconfigured', {});
    return Response.json({ error: 'השירות אינו זמין כרגע. אפשר לפנות לדורית ישירות.' }, { status: 503 });
  }
  const body = await req.text();
  try {
    const res = await fetch(`${url}/functions/v1/${EDGE}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'user-agent': req.headers.get('user-agent') || '' },
      body,
      signal: AbortSignal.timeout(25000),
    });
    const answer = await res.json().catch(() => ({ error: 'תשובה לא תקינה מהשרת.' }));
    return Response.json(answer, { status: res.status });
  } catch (e) {
    log('error', 'forward.failed', { err: String(e?.message ?? e).slice(0, 200) });
    return Response.json({ error: 'השמירה נכשלה. אפשר לנסות שוב, או לפנות לדורית ישירות.' }, { status: 502 });
  }
}
