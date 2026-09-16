// Job success alone is not proof of a publish: missing credentials skip its step.
// In this repository Base44 owns BASE44_URL; the custom production domain moves
// to Vercel. Compare origins so a trailing slash cannot select the wrong host.
const production = new URL(process.env.PRODUCTION_URL).origin;
const base44 = new URL(process.env.BASE44_URL || 'https://safe-arch-plan.base44.app').origin;
const usesBase44 = production === base44;
const published = usesBase44
  ? process.env.BASE44_PUBLISHED === 'true'
  : process.env.VERCEL_DEPLOYED === 'true' && process.env.VERCEL_KIND === 'production';

if (!published) {
  const remedy = usesBase44
    ? 'Base44 did not publish this run. Configure BASE44_API_KEY and BASE44_APP_ID, and check the Publish to Base44 job.'
    : 'Vercel did not promote production this run. Check its deployment credentials and test gates; a preview does not update production.';
  console.error(`::error::${remedy} PRODUCTION_URL (${production}) still serves an earlier release. Smoke tests for this checkout cannot validate that release.`);
  process.exitCode = 1;
} else {
  console.log(`Production publisher confirmed for ${production}; running smoke tests.`);
}
