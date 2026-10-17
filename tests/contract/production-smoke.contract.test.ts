import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT } from '../helpers/entity-schema';

function check(env: Record<string, string>) {
  return spawnSync(process.execPath, ['scripts/check-production-publish.mjs'], {
    cwd: REPO_ROOT, encoding: 'utf8', env,
  });
}
const vercel = 'https://govari-fin.co.il';

describe('production publish preflight', () => {
  it('refuses a run that published only to Base44 — production is Vercel', () => {
    const r = check({ PRODUCTION_URL: vercel, BASE44_PUBLISHED: 'true' });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('Vercel did not promote production');
    expect(r.stderr).toContain('still serves an earlier release');
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
