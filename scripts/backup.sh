#!/usr/bin/env bash
set -euo pipefail

: "${BACKUP_DATABASE_URL:?BACKUP_DATABASE_URL is required}"

output="${1:-${BACKUP_OUTPUT:-./.backups/ai-business-$(date -u +%Y%m%dT%H%M%SZ).dump}}"
mkdir -p "$(dirname "$output")"
umask 077

command -v pg_dump >/dev/null || {
  echo "pg_dump is required." >&2
  exit 1
}
command -v pg_restore >/dev/null || {
  echo "pg_restore is required." >&2
  exit 1
}

pg_dump \
  --format=custom \
  --compress=6 \
  --no-owner \
  --no-acl \
  --file="$output" \
  "$BACKUP_DATABASE_URL"

pg_restore --list "$output" >/dev/null
printf '{"event":"backup_verified","path":"%s","bytes":%s}\n' \
  "$output" \
  "$(wc -c < "$output" | tr -d ' ')"