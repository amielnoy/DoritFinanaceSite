// Job success alone is not proof of a publish: missing credentials skip its step.
// Production is the Vercel promotion this run made (since 2026-10-17 nothing is
// published to Base44): a preview, or a deploy step that never ran, means
// PRODUCTION_URL still serves an earlier release.
const production = new URL(process.env.PRODUCTION_URL).origin;
const published = process.env.VERCEL_DEPLOYED === 'true' && process.env.VERCEL_KIND === 'production';

if (!published) {
  console.error(`::error::Vercel did not promote production this run. Check its deployment credentials and test gates; a preview does not update production. PRODUCTION_URL (${production}) still serves an earlier release. Smoke tests for this checkout cannot validate that release.`);
  process.exitCode = 1;
} else {
  console.log(`Production publisher confirmed for ${production}; running smoke tests.`);
}
