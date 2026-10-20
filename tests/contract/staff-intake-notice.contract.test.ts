import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CONTACT } from '../../src/config/contact';
import { SITE_URL } from '../../src/lib/seo';
import { isStaffLeadsOn, STAFF_INTAKE_NOTICE } from '../../src/config/staff-leads';

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
});
