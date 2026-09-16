import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { MAILER_URL, invokeFunction } from '../helpers/base44-function';

const names = ['submitLead', 'submitClaim', 'escalateToHuman'];
const payload = { name: 'Test', phone: '0501234567', source: 'contact', reason: 'uncertain', claimType: 'רכב' };

describe.each(names)('%s — external agency email', (name) => {
  it('posts finished mail to the mailer, for every recipient, with the shared token', async () => {
    const r = await invokeFunction(name, { ...payload, to: 'attacker@example.com', from: 'attacker@example.com' });
    expect(r.status).toBe(200);
    // Every staff copy now goes this way, not just the agency's: Base44's own
    // mailer delivers to registered users only, so the second operations mailbox
    // and every visitor confirmation were failing silently.
    const calls = r.callsTo(MAILER_URL);
    expect(calls.length).toBeGreaterThanOrEqual(3);
    const recipients = calls.map(c => (c.body as { to: string }).to);
    for (const to of ['dorit@govari-fin.co.il', 'amielnoy@gmail.com', 'amielnoy@outlook.com']) {
      expect(recipients, `${to} was not sent to`).toContain(to);
    }
    // The caller cannot choose the sender or steer a copy to itself.
    expect(recipients).not.toContain('attacker@example.com');
    const [call] = calls;
    expect(call.method).toBe('POST');
    // The token is what stops the endpoint being an open relay; the sender
    // identity and the Resend key live in the mailer's own environment, not here.
    expect(call.headers.Authorization).toBe('Bearer test-only-token');
    expect(call.body).toMatchObject({ type: 'rendered' });
    expect(call.body).not.toHaveProperty('from');
    expect((call.body as { text: string }).text).toContain('Test');
    expect(r.json.warnings).toEqual([]);
  });

  it.each([{}, { MAILER_URL }, { MAILER_TOKEN: 'test-only-token' }])('reports missing configuration without losing the record', async (env) => {
    const r = await invokeFunction(name, payload, { env });
    expect(r.status).toBe(200);
    expect(r.leads).toHaveLength(1);
    expect(r.callsTo(MAILER_URL)).toHaveLength(0);
    // And nothing falls back to Base44, which is the point: a fallback that
    // reaches one registered mailbox out of three looks like success and is not.
    // Misconfiguration now costs every notification, loudly, and never the record.
    expect(r.emails).toHaveLength(0);
    expect(r.json.warnings).not.toEqual([]);
  });

  it.each([401, 403, 429, 500])('handles provider HTTP %s without dropping other recipients', async (resendStatus) => {
    const r = await invokeFunction(name, payload, { resendStatus });
    expect(r.status).toBe(200);
    expect(r.leads).toHaveLength(1);
    // Each recipient is its own attempt, so a rejected send costs one message
    // rather than the rest of the list.
    expect(r.callsTo(MAILER_URL).length).toBeGreaterThanOrEqual(3);
    expect(r.json.warnings).not.toEqual([]);
    expect(JSON.stringify(r.json)).not.toContain('test-only-key');
  });

  it('rejects a success response without a message id', async () => {
    const r = await invokeFunction(name, payload, { resendResponse: {} });
    expect(r.json.warnings).not.toEqual([]);
  });

  it('handles a network failure and still saves the enquiry', async () => {
    const r = await invokeFunction(name, payload, { failFetch: true });
    expect(r.status).toBe(200);
    expect(r.leads).toHaveLength(1);
    expect(r.json.warnings).not.toEqual([]);
  });
});

it('keeps the mail transport identical in all isolated entry points', () => {
  const helpers = names.map(name => {
    const source = readFileSync(`base44/functions/${name}/entry.ts`, 'utf8');
    return source.match(/async function sendMail\([\s\S]*?\n\}/)?.[0];
  });
  expect(helpers[0]).toBeTruthy();
  expect(new Set(helpers).size).toBe(1);
});
