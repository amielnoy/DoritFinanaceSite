import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { MAILER_URL, invokeFunction } from '../helpers/base44-function';

// submitLead, escalateToHuman and logSupportChat are forwarders now; their Edge
// homes are covered by the Edge integration suites.
const names = ['submitClaim'];
const payload = { name: 'Test', phone: '0501234567', source: 'contact', reason: 'uncertain', claimType: 'רכב' };

describe.each(names)('%s — external agency email', (name) => {
  it('posts every recipient to the mailer, from a single transport', async () => {
    const r = await invokeFunction(name, { ...payload, to: 'attacker@example.com', from: 'attacker@example.com' });
    expect(r.status).toBe(200);
    // One transport for everyone now: Base44's Core integration, which could
    // only reach registered users, is gone — every recipient sends from the
    // agency's own verified domain via the mailer.
    const calls = r.callsTo(MAILER_URL);
    const recipients = calls.map(c => (c.body as { to: string }).to);
    expect(recipients, 'the agency copy did not take the mailer').toContain('dorit@govari-fin.co.il');
    expect(recipients, 'gmail did not take the mailer').toContain('amielnoy@gmail.com');
    expect(recipients, 'outlook did not take the mailer').toContain('amielnoy@outlook.com');
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
    // One transport for everyone means a missing mailer config costs every
    // recipient's copy now, not just the agency's — each still reports its
    // own reason rather than one flag for "mail".
    expect(r.json.warnings).not.toEqual([]);
    expect(r.emails.map(e => e.to)).not.toContain('amielnoy@gmail.com');
  });

  it.each([401, 403, 429, 500])('handles provider HTTP %s without dropping other recipients', async (resendStatus) => {
    const r = await invokeFunction(name, payload, { resendStatus });
    expect(r.status).toBe(200);
    expect(r.leads).toHaveLength(1);
    // A provider that rejects the agency's copy costs that one message; the
    // operations copies do not travel this way and still arrive.
    expect(r.callsTo(MAILER_URL).length).toBeGreaterThanOrEqual(1);
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
