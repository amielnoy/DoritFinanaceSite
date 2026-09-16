import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { invokeFunction } from '../helpers/base44-function';

const names = ['submitLead', 'submitClaim', 'escalateToHuman'];
const payload = { name: 'Test', phone: '0501234567', source: 'contact', reason: 'uncertain', claimType: 'רכב' };

describe.each(names)('%s — external agency email', (name) => {
  it('uses Resend with a server-controlled recipient and verified sender', async () => {
    const r = await invokeFunction(name, { ...payload, to: 'attacker@example.com', from: 'attacker@example.com' });
    expect(r.status).toBe(200);
    const [call] = r.callsTo('api.resend.com');
    expect(r.callsTo('api.resend.com')).toHaveLength(1);
    expect(call.method).toBe('POST');
    expect(call.headers.Authorization).toBe('Bearer test-only-key');
    expect(call.body).toMatchObject({
      from: 'Notifications <notifications@mail.example.com>',
      to: ['dorit@govari-fin.co.il'], reply_to: 'dorit@govari-fin.co.il',
    });
    expect((call.body as { text: string }).text).toContain('Test');
    expect(r.json.warnings).toEqual([]);
  });

  it.each([{}, { RESEND_API_KEY: 'test-only-key' }, { RESEND_FROM_EMAIL: 'mail@example.com' }])('reports missing configuration without losing the record', async (env) => {
    const r = await invokeFunction(name, payload, { env });
    expect(r.status).toBe(200);
    expect(r.leads).toHaveLength(1);
    expect(r.callsTo('api.resend.com')).toHaveLength(0);
    expect(r.emails.map(e => e.to)).not.toContain('dorit@govari-fin.co.il');
    expect(r.emails.map(e => e.to)).toContain('amielnoy@gmail.com');
    expect(r.json.warnings).not.toEqual([]);
  });

  it.each([401, 403, 429, 500])('handles provider HTTP %s without dropping other recipients', async (resendStatus) => {
    const r = await invokeFunction(name, payload, { resendStatus });
    expect(r.status).toBe(200);
    expect(r.leads).toHaveLength(1);
    expect(r.emails.map(e => e.to)).toContain('amielnoy@gmail.com');
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

it('keeps the Resend transport identical in all isolated entry points', () => {
  const helpers = names.map(name => {
    const source = readFileSync(`base44/functions/${name}/entry.ts`, 'utf8');
    return source.match(/async function sendDoritEmail\([\s\S]*?\n\}/)?.[0];
  });
  expect(helpers[0]).toBeTruthy();
  expect(new Set(helpers).size).toBe(1);
});
