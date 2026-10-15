// Every migration in the repository is in production's history — or the run
// stops before the functions that may depend on it are deployed (Architecture
// N-05). Migrations are applied by hand; this is the check that the hand did it.
//
// Production's history comes from the Management API
// (GET /v1/projects/{ref}/database/migrations, an array of { version, name }),
// which a scoped token reads with database_migrations_read alone. `supabase link`
// would also need the project's API keys, service_role included.
//   - a version only in the repository (not in production) fails;
//   - a version only in production (not in the repository) warns —
//     history that came from somewhere else, worth knowing, not worth blocking on.
//
// Usage: node scripts/check-migrations.mjs remote.json supabase/migrations
import { readFileSync, readdirSync } from "node:fs";

/** The versions of the repository's migration files, `<version>_<name>.sql`. */
export function localVersions(files) {
  return files.map((f) => /^(\d{14})_.+\.sql$/.exec(f)?.[1]).filter(Boolean);
}

/** The versions in the API's answer, or null when the answer is not a list. */
export function remoteVersions(body) {
  if (!Array.isArray(body)) return null;
  return body.map((row) => row?.version).filter((v) => typeof v === "string" && /^\d{14}$/.test(v));
}

/** What each side has that the other does not. */
export function migrationDrift(local, remote) {
  const inRemote = new Set(remote);
  const inLocal = new Set(local);
  return {
    rows: new Set([...local, ...remote]).size,
    missingInProduction: [...inLocal].filter((v) => !inRemote.has(v)).sort(),
    unknownToRepository: [...inRemote].filter((v) => !inLocal.has(v)).sort(),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [file, dir] = process.argv.slice(2);
  let remote;
  try {
    remote = remoteVersions(JSON.parse(readFileSync(file, "utf8")));
  } catch {
    remote = null;
  }
  if (!remote) {
    console.log("::warning::Production's migration history was not a list — not checked.");
    process.exit(0);
  }
  if (remote.length === 0) {
    console.log("::warning::Production's migration history had no rows — not checked.");
    process.exit(0);
  }
  const { rows, missingInProduction, unknownToRepository } = migrationDrift(localVersions(readdirSync(dir)), remote);
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
