import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CONTACT } from '../../src/config/contact';
import { SITE_URL } from '../../src/lib/seo';
import { INTAKE_LABELS, isStaffLeadsOn, NOTICE_LABELS, STAFF_INTAKE_NOTICE, STAFF_STATUS_LABELS } from '../../src/config/staff-leads';

const extract = (path: string): string => {
  const src = readFileSync(path, 'utf8');
  const m = src.match(/export const STAFF_INTAKE_NOTICE\s*=\s*`([^`]*)`/);
  if (!m) throw new Error(`no STAFF_INTAKE_NOTICE template literal in ${path}`);
  return m[1];
};

const serverSrc = readFileSync('supabase/functions/create-lead/notice.ts', 'utf8');
const client = extract('src/config/staff-leads.ts');
const server = extract('supabase/functions/create-lead/notice.ts');

describe('staff intake notice', () => {
  it('has one text in both copies', () => {
    expect(server).toBe(client);
    expect(STAFF_INTAKE_NOTICE).toBe(client.replace('${CONTACT.email}', CONTACT.email).replace('${SITE_URL}', SITE_URL));
  });
  it('says who, why, how long, rights and where the policy is', () => {
    expect(client).toContain('דורית גוב ארי');
    expect(client).toContain('L-00107009');
    expect(client).toContain('24 חודשים');
    expect(client).toContain('לראות');
    expect(client).toContain('לתקן');
    expect(client).toContain('למחוק');
    expect(STAFF_INTAKE_NOTICE).toContain(CONTACT.email);
    expect(STAFF_INTAKE_NOTICE).toContain(`${SITE_URL}/privacy`);
    expect(CONTACT.email).toBe('dorit@govari-fin.co.il');
    expect(serverSrc).toContain("email: 'dorit@govari-fin.co.il'");
    expect(serverSrc).toContain("SITE_URL = 'https://govari-fin.co.il'");
  });
  it('is at most 8 lines', () => {
    expect(client.trim().split('\n').length).toBeLessThanOrEqual(8);
  });
  it('reads the flag like the other switches', () => {
    expect(isStaffLeadsOn('true')).toBe(true);
    expect(isStaffLeadsOn(' true ')).toBe(true);
    expect(isStaffLeadsOn(undefined)).toBe(false);
    expect(isStaffLeadsOn('1')).toBe(false);
  });
  it('pins the labels the forms show', () => {
    expect(NOTICE_LABELS).toEqual({ verbal: 'בעל פה', email: 'במייל', whatsapp: 'בוואטסאפ' });
    expect(INTAKE_LABELS).toEqual({
      phone: 'שיחת טלפון',
      in_person: 'פגישה',
      referral: 'הפניה',
      event: 'אירוע',
      existing_client: 'לקוח/ה קיים/ת',
      other: 'אחר',
    });
    expect(STAFF_STATUS_LABELS).toEqual({ new: 'חדשה', contacted: 'נוצר קשר', client: 'נסגר (לקוח/ה)' });
  });
});

// Staff-added clients: their own notice (staff-client-v1), product list and switch.
const extractNamed = (path: string, name: string): string => {
  const m = readFileSync(path, 'utf8').match(new RegExp(`export const ${name}\\s*=\\s*\`([^\`]*)\``));
  if (!m) throw new Error(`no ${name} template literal in ${path}`);
  return m[1];
};
const labelsIn = (path: string): Record<string, string> => {
  const m = readFileSync(path, 'utf8').match(/export const PRODUCT_LABELS[^=]*=\s*\{([^}]*)\}/);
  if (!m) throw new Error(`no PRODUCT_LABELS in ${path}`);
  return Object.fromEntries([...m[1].matchAll(/(\w+):\s*['"]([^'"]+)['"]/g)].map((x) => [x[1], x[2]]));
};

describe('staff client notice', () => {
  const clientCopy = extractNamed('src/config/staff-clients.ts', 'STAFF_CLIENT_NOTICE');
  const serverCopy = extractNamed('supabase/functions/create-lead/notice.ts', 'STAFF_CLIENT_NOTICE');

  it('has one text in both copies', async () => {
    expect(serverCopy).toBe(clientCopy);
    const { STAFF_CLIENT_NOTICE } = await import('../../src/config/staff-clients');
    expect(STAFF_CLIENT_NOTICE).toBe(clientCopy.replace('${CONTACT.email}', CONTACT.email).replace('${SITE_URL}', SITE_URL));
  });
  it("speaks of the engagement, not an enquiry's 24 months", () => {
    expect(clientCopy).toContain('סוכנות דורית גוב ארי');
    expect(clientCopy).toContain('הסכם ההתקשרות');
    expect(clientCopy).toContain('כנדרש על-פי דין');
    expect(clientCopy).not.toContain('24 חודשים');
    for (const right of ['לראות', 'לתקן', 'למחוק']) expect(clientCopy).toContain(right);
    expect(clientCopy).toContain('${SITE_URL}/privacy');
    expect(clientCopy.trim().split('\n').length).toBeLessThanOrEqual(6);
  });
  it('is the letter for a client, and the lead letter is unchanged', () => {
    expect(serverSrc).toContain("export const STAFF_CLIENT_VERSION = 'staff-client-v1'");
    expect(serverSrc).toMatch(/noticeMail\(kind: 'lead' \| 'client' = 'lead'\)/);
    expect(serverSrc).toContain("(kind === 'client' ? STAFF_CLIENT_NOTICE : STAFF_INTAKE_NOTICE)");
  });
  it('names the same products, with the same labels, as the migration allows', async () => {
    const client = labelsIn('src/config/staff-clients.ts');
    const server = labelsIn('supabase/functions/_shared/staff-clients.ts');
    expect(server).toEqual(client);
    const sql = readFileSync('supabase/migrations/20261113000000_staff_clients.sql', 'utf8').replace(/\s+/g, ' ');
    const allowed = sql.match(/products <@ array\[([^\]]*)\]::text\[\]/)?.[1].match(/'(\w+)'/g)?.map((s) => s.slice(1, -1));
    expect(Object.keys(client)).toEqual(allowed);
    const { PRODUCT_LABELS, PRODUCTS } = await import('../../src/config/staff-clients');
    expect(PRODUCTS).toEqual(allowed);
    expect(PRODUCT_LABELS.health).toBe('בריאות וסיעוד');
  });
  it('offers "בהסכם ההתקשרות" first to a client, never to an enquiry', async () => {
    const { CLIENT_NOTICE_METHODS, CLIENT_NOTICE_LABELS } = await import('../../src/config/staff-clients');
    expect(CLIENT_NOTICE_METHODS).toEqual(['agreement', 'verbal', 'email', 'whatsapp']);
    expect(CLIENT_NOTICE_LABELS.agreement).toBe('בהסכם ההתקשרות');
    expect(Object.keys(NOTICE_LABELS)).not.toContain('agreement');
  });
  it('reads the switch like the other switches, on both sides', async () => {
    const { isStaffClientsOn } = await import('../../src/config/staff-clients');
    expect(isStaffClientsOn(' true ')).toBe(true);
    expect(isStaffClientsOn('1')).toBe(false);
    expect(isStaffClientsOn(undefined)).toBe(false);
    expect(readFileSync('supabase/functions/_shared/staff-clients.ts', 'utf8')).toContain(
      "(Deno.env.get('STAFF_CLIENTS') || '').trim() === 'true'",
    );
  });
});
