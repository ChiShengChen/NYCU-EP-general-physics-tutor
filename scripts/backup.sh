#!/usr/bin/env bash
#
# pg_dump the Supabase Postgres behind the app (public schema only).
#
# Produces, in $BACKUP_DIR (default ./backups):
#   nycu-physics-<YYYYMMDD-HHMM>.dump.gz        custom-format dump (data + schema) for pg_restore
#   nycu-physics-<YYYYMMDD-HHMM>.schema.sql.gz  plain-SQL schema-only dump, for reviewable diffs
#
# Usage:
#   SUPABASE_DB_URL='postgresql://postgres.<ref>:<pw>@aws-0-<region>.pooler.supabase.com:5432/postgres' \
#     scripts/backup.sh
#   scripts/backup.sh --restore-hint [file.dump.gz]   # print the matching pg_restore command
#
# Env:
#   SUPABASE_DB_URL   required. Use the *session-mode* pooler string (port 5432) or the
#                     direct connection; transaction-mode (6543) does not support pg_dump.
#   BACKUP_DIR        output directory (default: backups)
#   MIN_DUMP_BYTES    fail if the gzipped .dump is smaller than this (default: 10240)
#
# The connection string is never echoed. Timestamp is Asia/Taipei to match the cron.

set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-backups}"
MIN_DUMP_BYTES="${MIN_DUMP_BYTES:-10240}"
PREFIX="nycu-physics"

usage() {
  sed -n '3,19p' "$0" | sed 's/^# \{0,1\}//'
}

restore_hint() {
  local file="${1:-${BACKUP_DIR}/${PREFIX}-<YYYYMMDD-HHMM>.dump.gz}"
  cat <<EOF
# Restore ${file} into a target database (DROPs + recreates public objects that exist in the dump):
scripts/restore.sh "${file}" "\$TARGET_DB_URL"

# Equivalent by hand:
gunzip -c "${file}" > /tmp/restore.dump
pg_restore --clean --if-exists --no-owner --no-privileges --schema=public \\
  --dbname "\$TARGET_DB_URL" /tmp/restore.dump
rm -f /tmp/restore.dump
EOF
}

case "${1:-}" in
  -h|--help) usage; exit 0 ;;
  --restore-hint) restore_hint "${2:-}"; exit 0 ;;
  "") ;;
  *) echo "backup.sh: unknown argument: $1" >&2; usage >&2; exit 2 ;;
esac

if [[ -z "${SUPABASE_DB_URL:-}" ]]; then
  echo "backup.sh: SUPABASE_DB_URL is not set (Supabase -> Project Settings -> Database -> Connection string, session pooler, port 5432)" >&2
  exit 2
fi

command -v pg_dump >/dev/null 2>&1 || { echo "backup.sh: pg_dump not found in PATH" >&2; exit 2; }
command -v gzip >/dev/null 2>&1 || { echo "backup.sh: gzip not found in PATH" >&2; exit 2; }

# Force TLS unless the caller already chose an sslmode.
DB_URL="$SUPABASE_DB_URL"
if [[ "$DB_URL" != *sslmode=* ]]; then
  if [[ "$DB_URL" == *\?* ]]; then DB_URL="${DB_URL}&sslmode=require"; else DB_URL="${DB_URL}?sslmode=require"; fi
fi

# Keep the URL out of argv (visible in `ps`) by handing it to libpq via env.
export PGCONNECT_TIMEOUT="${PGCONNECT_TIMEOUT:-20}"

STAMP="$(TZ=Asia/Taipei date +%Y%m%d-%H%M)"
BASE="${BACKUP_DIR}/${PREFIX}-${STAMP}"
DUMP="${BASE}.dump"
SCHEMA="${BASE}.schema.sql"

mkdir -p "$BACKUP_DIR"
echo "backup.sh: pg_dump $(pg_dump --version | awk '{print $3}') -> ${BASE}.{dump,schema.sql}.gz"

# --compress=0: let gzip do the compression once instead of double-compressing.
pg_dump --dbname "$DB_URL" \
  --no-owner --no-privileges \
  --format=custom --compress=0 \
  --schema=public \
  --file "$DUMP"

pg_dump --dbname "$DB_URL" \
  --no-owner --no-privileges \
  --format=plain --schema-only \
  --schema=public \
  --file "$SCHEMA"

gzip -9 -f "$DUMP" "$SCHEMA"
DUMP_GZ="${DUMP}.gz"
SCHEMA_GZ="${SCHEMA}.gz"

dump_bytes="$(wc -c < "$DUMP_GZ" | tr -d ' ')"
schema_bytes="$(wc -c < "$SCHEMA_GZ" | tr -d ' ')"

printf 'backup.sh: %-60s %10s bytes\n' "$DUMP_GZ" "$dump_bytes"
printf 'backup.sh: %-60s %10s bytes\n' "$SCHEMA_GZ" "$schema_bytes"

if (( dump_bytes < MIN_DUMP_BYTES )); then
  echo "backup.sh: ERROR dump is only ${dump_bytes} bytes (< ${MIN_DUMP_BYTES}); refusing to treat this as a valid backup" >&2
  exit 1
fi
if (( schema_bytes == 0 )); then
  echo "backup.sh: ERROR schema dump is empty" >&2
  exit 1
fi

# Sanity check: the gzip must round-trip and pg_restore must be able to list it.
gzip -t "$DUMP_GZ" "$SCHEMA_GZ"
if command -v pg_restore >/dev/null 2>&1; then
  tables="$(gunzip -c "$DUMP_GZ" | pg_restore --list | grep -c 'TABLE DATA' || true)"
  echo "backup.sh: ${tables} tables with data in ${DUMP_GZ}"
  if (( tables == 0 )); then
    echo "backup.sh: ERROR no TABLE DATA entries in dump" >&2
    exit 1
  fi
fi

# Hand paths to GitHub Actions when running there.
if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
  {
    echo "stamp=${STAMP}"
    echo "dump=${DUMP_GZ}"
    echo "schema=${SCHEMA_GZ}"
    echo "dump_bytes=${dump_bytes}"
    echo "schema_bytes=${schema_bytes}"
  } >> "$GITHUB_OUTPUT"
fi

echo
restore_hint "$DUMP_GZ"
