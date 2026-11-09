#!/usr/bin/env bash
# Production's migration history against the repository's migrations
# (Architecture N-05), shared by the two CI jobs that ask:
#   - "Migrations applied in production" on a PR, so "Safe to merge?" says no
#     before a migration reaches main without being applied (#316 did, and
#     froze production deploys until it was);
#   - the Supabase deploy job on main, the last stop before functions go out.
#
# The Management API, not `supabase link`: link also reads the project's API
# keys (service_role included); this needs database_migrations_read only.
# A listing that cannot be read warns rather than blocking on a read failure;
# drift fails.
#
# Env: SUPABASE_ACCESS_TOKEN, SUPABASE_PROJECT_REF.
set -euo pipefail

status=$(curl -sS --max-time 30 -o remote.json -w '%{http_code}' \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  "https://api.supabase.com/v1/projects/$SUPABASE_PROJECT_REF/database/migrations") || status=000
if [ "$status" != 200 ]; then
  echo "::warning::Could not read production's migration history (HTTP $status) — not checked. A scoped token needs database_migrations_read; set SUPABASE_MIGRATIONS_TOKEN to one that has it."
  cat remote.json 2>/dev/null || true
  exit 0
fi
node scripts/check-migrations.mjs remote.json supabase/migrations
