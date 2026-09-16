import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT } from '../helpers/entity-schema';

function check(env: Record<string, string>) {
  return spawnSync(process.execPath, ['scripts/check-production-publish.mjs'], {
    cwd: REPO_ROOT, encoding: 'utf8', env,
  });
}
const base44 = 'https://safe-arch-plan.base44.app';
const vercel = 'https://govari-fin.co.il';

describe('production publish preflight', () => {
  it('reports missing Base44 publishing credentials even when Vercel deployed', () => {
    const r = check({ PRODUCTION_URL: base44, VERCEL_DEPLOYED: 'true', VERCEL_KIND: 'production' });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('BASE44_API_KEY');
    expect(r.stderr).toContain('still serves an earlier release');
  });
  it.each([base44, `${base44}/`])('accepts a Base44 publish at %s without needing Vercel', (url) => {
    expect(check({ PRODUCTION_URL: url, BASE44_PUBLISHED: 'true' }).status).toBe(0);
  });
  it('recognises a configured Base44 origin', () => {
    expect(check({ PRODUCTION_URL: 'https://other.base44.app/', BASE44_URL: 'https://other.base44.app', BASE44_PUBLISHED: 'true' }).status).toBe(0);
  });
  it('does not accept a Base44 publish in place of a Vercel production deploy', () => {
    const r = check({ PRODUCTION_URL: vercel, BASE44_PUBLISHED: 'true' });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('Vercel did not promote production');
  });
  it('does not count previews as production', () => {
    expect(check({ PRODUCTION_URL: vercel, VERCEL_DEPLOYED: 'true', VERCEL_KIND: 'preview' }).status).toBe(1);
  });
  it('does not count selecting production as deploying it', () => {
    expect(check({ PRODUCTION_URL: vercel, VERCEL_KIND: 'production' }).status).toBe(1);
  });
  it('accepts an actual Vercel production deploy', () => {
    expect(check({ PRODUCTION_URL: vercel, VERCEL_DEPLOYED: 'true', VERCEL_KIND: 'production' }).status).toBe(0);
  });
});
