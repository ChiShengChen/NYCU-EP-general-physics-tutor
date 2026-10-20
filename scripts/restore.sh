#!/usr/bin/env bash
#
# Restore a backup made by scripts/backup.sh into a target Postgres.
#
# Usage:
#   scripts/restore.sh <nycu-physics-*.dump[.gz]> <TARGET_DB_URL> [--yes] [--jobs N]
#
#   --yes      skip the interactive confirmation (CI / scripted use)
#   --jobs N   parallel restore workers (pg_restore -j); default 1
#
# Runs:  pg_restore --clean --if-exists --no-owner --no-privileges --schema=public
# i.e. every public-schema object present in the dump is DROPped and recreated on the
# target. Objects that exist only on the target are left alone. Supabase's auth/storage
# schemas are not touched (they were never in the dump).
#
# TARGET_DB_URL: session-mode pooler (port 5432) or direct connection, never 6543.

set -euo pipefail

usage() {
  sed -n '3,16p' "$0" | sed 's/^# \{0,1\}//'
}

DUMP=""
TARGET=""
YES=0
JOBS=1

while (( $# )); do
  case "$1" in
    -h|--help) usage; exit 0 ;;
    --yes|-y) YES=1 ;;
    --jobs|-j) JOBS="${2:?--jobs needs a number}"; shift ;;
    --jobs=*) JOBS="${1#--jobs=}" ;;
    -*) echo "restore.sh: unknown option: $1" >&2; usage >&2; exit 2 ;;
    *)
      if [[ -z "$DUMP" ]]; then DUMP="$1"
      elif [[ -z "$TARGET" ]]; then TARGET="$1"
      else echo "restore.sh: unexpected argument: $1" >&2; usage >&2; exit 2
      fi ;;
  esac
  shift
done

if [[ -z "$DUMP" || -z "$TARGET" ]]; then
  usage >&2
  exit 2
fi
[[ -f "$DUMP" ]] || { echo "restore.sh: no such file: $DUMP" >&2; exit 2; }
command -v pg_restore >/dev/null 2>&1 || { echo "restore.sh: pg_restore not found in PATH" >&2; exit 2; }

if [[ "$TARGET" == *:6543/* ]]; then
  echo "restore.sh: refusing to use the transaction-mode pooler (port 6543); use the session pooler (5432) or direct connection" >&2
  exit 2
fi

if [[ "$TARGET" != *sslmode=* ]]; then
  if [[ "$TARGET" == *\?* ]]; then TARGET="${TARGET}&sslmode=require"; else TARGET="${TARGET}?sslmode=require"; fi
fi

# Show host/db but never the password.
masked="$(printf '%s' "$TARGET" | sed -E 's#(://[^:/@]+):[^@]*@#\1:***@#')"

# Decompress to a temp file if needed; pg_restore cannot read gzip.
TMP=""
# shellcheck disable=SC2329  # invoked via trap
cleanup() { [[ -n "$TMP" ]] && rm -f "$TMP"; }
trap cleanup EXIT
if [[ "$DUMP" == *.gz ]]; then
  TMP="$(mktemp -t nycu-restore.XXXXXX)"
  gunzip -c "$DUMP" > "$TMP"
  SRC="$TMP"
else
  SRC="$DUMP"
fi

tables="$(pg_restore --list "$SRC" | grep -c 'TABLE DATA' || true)"

cat >&2 <<EOF
restore.sh: about to restore
  dump   : ${DUMP}  (${tables} tables with data)
  target : ${masked}
  mode   : pg_restore --clean --if-exists --no-owner --no-privileges --schema=public -j ${JOBS}

This DROPs and recreates every public-schema object in the dump on the target.
EOF

if (( ! YES )); then
  if [[ ! -t 0 ]]; then
    echo "restore.sh: stdin is not a TTY; pass --yes to confirm non-interactively" >&2
    exit 2
  fi
  read -r -p "Type 'restore' to continue: " answer
  if [[ "$answer" != "restore" ]]; then
    echo "restore.sh: aborted" >&2
    exit 1
  fi
fi

set +e
pg_restore \
  --clean --if-exists \
  --no-owner --no-privileges \
  --schema=public \
  --jobs "$JOBS" \
  --dbname "$TARGET" \
  "$SRC"
rc=$?
set -e

if (( rc == 0 )); then
  echo "restore.sh: done (exit 0)"
else
  # pg_restore exits 1 if *any* statement failed but keeps going; check the log above.
  echo "restore.sh: pg_restore finished with exit code ${rc}; review the errors above" >&2
fi
exit "$rc"
