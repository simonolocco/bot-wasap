#!/bin/sh
set -eu

: "${DATABASE_URL:?DATABASE_URL is required}"
: "${WALG_S3_PREFIX:?WALG_S3_PREFIX is required}"
: "${PGDATA:?PGDATA is required}"

run_id="$(psql "$DATABASE_URL" -Atc "INSERT INTO backup_runs (kind,status,metadata) VALUES ('physical','running',jsonb_build_object('tool','wal-g')) RETURNING id")"

failed() {
  psql "$DATABASE_URL" -v run_id="$run_id" -c "UPDATE backup_runs SET status='failed', completed_at=now(), error='WAL-G backup-push failed' WHERE id=:'run_id'" >/dev/null 2>&1 || true
}
trap failed INT TERM HUP EXIT

wal-g backup-push "$PGDATA"
wal-g delete retain FULL "${WALG_RETAIN_FULL_BACKUPS:-2}" --confirm
psql "$DATABASE_URL" -v run_id="$run_id" -v key="$WALG_S3_PREFIX" -c "UPDATE backup_runs SET status='succeeded', completed_at=now(), object_key=:'key', metadata=jsonb_build_object('tool','wal-g') WHERE id=:'run_id'" >/dev/null

trap - INT TERM HUP EXIT
echo "WAL-G physical backup completed."
