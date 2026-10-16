#!/usr/bin/env bash
# Grant or revoke site admin (public.profiles.role) on the production project.
#
#   scripts/set-site-admin.sh <email> [admin|user]     (default: admin)
#
# Site admin is the admin menu, AdminRoute and _shared/admin.ts. It is not the
# organization roles (owner/agent/staff) that "הוספת משתמש" assigns.
# The account is matched on auth.users.email; profiles.email is a historical
# copy. A profile exists only after the person's first sign-in.
set -euo pipefail

EMAIL="$(printf '%s' "${1:-}" | tr '[:upper:]' '[:lower:]')"
ROLE="${2:-admin}"
PROJECT_REF="hjowdyiwjjrqceumkvgt" # DoritFinanaceSite, not HomeEconomyStabilation

if [[ -z "$EMAIL" || "$EMAIL" != *@* ]]; then
  echo "usage: $0 <email> [admin|user]" >&2
  exit 64
fi
if [[ "$ROLE" != "admin" && "$ROLE" != "user" ]]; then
  echo "role must be admin or user, got: $ROLE" >&2
  exit 64
fi

ENV_FILE="$(cd "$(dirname "$0")/.." && pwd)/.env.local"
PGPASSWORD="$(grep -E '^DB_SUPABASE_PASSWORD=' "$ENV_FILE" | head -1 | cut -d= -f2- | sed -E 's/^["'\'']|["'\'']$//g')"
if [[ -z "$PGPASSWORD" ]]; then
  echo "DB_SUPABASE_PASSWORD is missing from $ENV_FILE" >&2
  exit 1
fi
export PGPASSWORD

result="$(psql "host=db.${PROJECT_REF}.supabase.co port=5432 dbname=postgres user=postgres sslmode=require" \
  -X -q -t -A -F ' | ' -v ON_ERROR_STOP=1 -v email="$EMAIL" -v role="$ROLE" <<'SQL'
update public.profiles p
   set role = :'role'
  from auth.users u
 where u.id = p.id
   and lower(u.email) = :'email'
returning u.email, p.role;
SQL
)"
result="$(printf '%s\n' "$result" | grep -v '^UPDATE ' || true)"

if [[ -z "$result" ]]; then
  echo "No account for $EMAIL yet. Ask them to sign in once at govari-fin.co.il with Google, then run this again." >&2
  exit 2
fi
echo "$result"
