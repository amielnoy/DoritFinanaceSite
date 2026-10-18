// The e2e build: `npm run build:prerender` with e2e/build-env.ts over the
// process environment.
//
// The bundle the suite tests is sealed at build time — Vite inlines every
// `import.meta.env.VITE_*` — so the environment has to be right *here*, not
// on the preview server or the test runner. It used to be spelled out in
// playwright.config.ts and scripts/run-tests.sh and left out of CI's build
// job, and each copy could drift from the others. Now all three run this.
//
// The pinned values win over the process environment, so a shell or CI
// variable cannot quietly turn the e2e bundle back into another one. Only
// PRERENDER_REQUIRED comes from the caller: CI sets it, a local run may not.

import { spawnSync } from 'node:child_process'
import { E2E_BUILD_ENV } from '../e2e/build-env.ts'

if (process.env.VERCEL === '1' || process.env.VERCEL_ENV) {
  console.error('::error::build:e2e is the test bundle, pointed at a Supabase that does not exist. Not in a Vercel build.')
  process.exit(1)
}

const result = spawnSync('npm', ['run', 'build:prerender'], {
  stdio: 'inherit',
  env: { ...process.env, ...E2E_BUILD_ENV },
  shell: process.platform === 'win32',
})
process.exit(result.status ?? 1)
