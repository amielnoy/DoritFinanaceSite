import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { MAILER_URL, invokeFunction } from '../helpers/base44-function';

const names = ['submitLead', 'submitClaim', 'escalateToHuman'];
const payload = { name: 'Test', phone: '0501234567', source: 'contact', reason: 'uncertain', claimType: 'רכב' };

describe.each(names)('%s — external agency email', (name) => {
  it('posts the agency copy to the mailer, and the operations copies elsewhere', async () => {
    const r = await invokeFunction(name, { ...payload, to: 'attacker@example.com', from: 'attacker@example.com' });
    expect(r.status).toBe(200);
    // Two transports, split by recipient. The agency goes through the mailer so
    // her copy arrives from her own domain; the operations mailboxes go through
    // Base44's Core integration, which can only reach registered users.
    const calls = r.callsTo(MAILER_URL);
    const recipients = calls.map(c => (c.body as { to: string }).to);
    expect(recipients, 'the agency copy did not take the mailer').toContain('dorit@govari-fin.co.il');
    expect(recipients, 'gmail is Core-reachable and should not take the mailer').not.toContain('amielnoy@gmail.com');
    // outlook is not a registered Base44 user, so Core cannot deliver to it —
    // it goes the same way as the agency rather than failing quietly.
    expect(recipients, 'outlook did not take the mailer').toContain('amielnoy@outlook.com');
    // The caller cannot choose the sender or steer a copy to itself.
    expect(recipients).not.toContain('attacker@example.com');
    // And the operations mailboxes were still told, by the other transport.
    expect(r.emails.map(e => e.to), 'operations was not told').toContain('amielnoy@gmail.com');
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
    // The agency's copy is lost and says so. The operations copies ride a
    // different transport and are unaffected — which is the point of reporting
    // each failure with its own reason rather than one flag for "mail".
    expect(r.json.warnings).not.toEqual([]);
    expect(r.emails.map(e => e.to)).toContain('amielnoy@gmail.com');
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

/**
 * What Base44's own mailer is handed.
 *
 * `Core.SendEmail` treats `html` and `body` as alternatives, not companions.
 * Passing both makes it reject the call with "SendEmail accepts only …" — a
 * *validation* error, not a delivery failure, so the enquiry is still saved and
 * a warning is recorded and nobody is told. Leads kept arriving in the database
 * while the operations mailbox went quiet, which is a hard failure to notice.
 *
 * Nothing pinned the shape of that payload, so the split that introduced `body`
 * alongside `html` looked correct in every test.
 */
describe('the Core payload', () => {
  const lead = { name: 'יעל', phone: '0521234567', source: 'quick', message: 'שלום' };

  it('never sends html and body together', async () => {
    const r = await invokeFunction('submitLead', lead);
    const core = r.emails.filter(e => e.to === 'amielnoy@gmail.com');
    expect(core.length, 'the operations copy did not take the Core path').toBeGreaterThan(0);
    for (const mail of core) {
      expect(
        Boolean(mail.html) && Boolean(mail.body),
        'html and body together — Base44 rejects this as a validation error',
      ).toBe(false);
    }
  });

  it('still carries a readable message whichever shape it takes', async () => {
    // Rejecting the combination must not become dropping the content.
    const r = await invokeFunction('submitLead', lead);
    const mail = r.emails.find(e => e.to === 'amielnoy@gmail.com')!;
    expect(`${mail.html ?? ''}${mail.text ?? ''}${mail.body ?? ''}`).toContain('יעל');
  });

  it('falls back to body when there is no html to send', async () => {
    // submitClaim notifies in plain text; that path must not send an empty
    // `body` alongside an absent `html`.
    const r = await invokeFunction('submitClaim', {
      name: 'רונית', phone: '0536667788', claimType: 'תאונת דרכים', description: 'נזק',
    });
    const mail = r.emails.find(e => e.to === 'amielnoy@gmail.com')!;
    expect(mail.body ?? mail.text).toContain('רונית');
  });
});
