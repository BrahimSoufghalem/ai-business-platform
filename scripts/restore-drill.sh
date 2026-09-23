#!/usr/bin/env bash
set -euo pipefail

: "${BACKUP_DATABASE_URL:?BACKUP_DATABASE_URL is required}"
: "${RESTORE_DATABASE_URL:?RESTORE_DATABASE_URL is required}"

if [[ "${RESTORE_DRILL_CONFIRM:-}" != "ERASE_RESTORE_DATABASE" ]]; then
  echo "Set RESTORE_DRILL_CONFIRM=ERASE_RESTORE_DATABASE to run the destructive drill." >&2
  exit 1
fi
if [[ "$BACKUP_DATABASE_URL" == "$RESTORE_DATABASE_URL" ]]; then
  echo "The restore target must differ from the source database." >&2
  exit 1
fi

restore_without_query="${RESTORE_DATABASE_URL%%\?*}"
restore_database="${restore_without_query##*/}"
if [[ "$restore_database" != *restore* && "${RESTORE_DRILL_ALLOW_ANY_DATABASE:-}" != "true" ]]; then
  echo "The restore database name must contain 'restore'." >&2
  exit 1
fi

command -v psql >/dev/null || {
  echo "psql is required." >&2
  exit 1
}
command -v pg_restore >/dev/null || {
  echo "pg_restore is required." >&2
  exit 1
}

temporary_backup=""
if [[ -n "${BACKUP_OUTPUT:-}" ]]; then
  backup_file="$BACKUP_OUTPUT"
else
  temporary_backup="$(mktemp "${TMPDIR:-/tmp}/ai-business-restore-XXXXXX.dump")"
  backup_file="$temporary_backup"
fi
trap '[[ -n "$temporary_backup" ]] && rm -f "$temporary_backup"' EXIT

bash "$(dirname "$0")/backup.sh" "$backup_file" >/dev/null

psql "$RESTORE_DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL' >/dev/null
drop schema if exists drizzle cascade;
drop schema if exists public cascade;
create schema public;
SQL

pg_restore \
  --exit-on-error \
  --no-owner \
  --no-acl \
  --dbname="$RESTORE_DATABASE_URL" \
  "$backup_file"

source_tables="$(psql "$BACKUP_DATABASE_URL" -At -v ON_ERROR_STOP=1 -c \
  "select count(*) from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'")"
restored_tables="$(psql "$RESTORE_DATABASE_URL" -At -v ON_ERROR_STOP=1 -c \
  "select count(*) from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'")"
source_migrations="$(psql "$BACKUP_DATABASE_URL" -At -v ON_ERROR_STOP=1 -c \
  "select count(*) from drizzle.__drizzle_migrations")"
restored_migrations="$(psql "$RESTORE_DATABASE_URL" -At -v ON_ERROR_STOP=1 -c \
  "select count(*) from drizzle.__drizzle_migrations")"

if [[ "$source_tables" != "$restored_tables" || "$source_migrations" != "$restored_migrations" ]]; then
  echo "Restore verification failed: source and target counts differ." >&2
  exit 1
fi

printf '{"event":"restore_drill_passed","tables":%s,"migrations":%s}\n' \
  "$restored_tables" \
  "$restored_migrations"