// Every migration in the repository is in production's history — or the run
// stops before the functions that may depend on it are deployed (Architecture
// N-05). Migrations are applied by hand; this is the check that the hand did it.
//
// Reads the output of `supabase migration list --linked` (Local | Remote | Time):
//   - a version only on the left (in the repository, not in production) fails;
//   - a version only on the right (in production, not in the repository) warns —
//     history that came from somewhere else, worth knowing, not worth blocking on.
//
// Usage: supabase migration list --linked > list.txt && node scripts/check-migrations.mjs list.txt
import { readFileSync } from "node:fs";

/** The versions on each side of the listing, by row. */
export function migrationDrift(listing) {
  const missingInProduction = [];
  const unknownToRepository = [];
  let rows = 0;
  for (const line of listing.split("\n")) {
    const m = /^\s*(\d{14})?\s*\|\s*(\d{14})?\s*\|/.exec(line);
    if (!m || (!m[1] && !m[2])) continue;
    rows += 1;
    if (m[1] && !m[2]) missingInProduction.push(m[1]);
    if (!m[1] && m[2]) unknownToRepository.push(m[2]);
  }
  return { rows, missingInProduction, unknownToRepository };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const file = process.argv[2];
  const { rows, missingInProduction, unknownToRepository } = migrationDrift(readFileSync(file, "utf8"));
  if (rows === 0) {
    console.log("::warning::The migration listing had no rows — production's history was not checked.");
    process.exit(0);
  }
  for (const v of unknownToRepository) console.log(`::warning::Production has migration ${v}, which the repository does not.`);
  if (missingInProduction.length) {
    console.log(
      `::error::${missingInProduction.length} migration(s) in the repository are not applied in production: ${missingInProduction.join(", ")}. ` +
        "Apply each with psql, then `supabase migration repair --status applied <version> --linked` (README), and re-run.",
    );
    process.exit(1);
  }
  console.log(`All ${rows} migrations in the repository are applied in production.`);
}
