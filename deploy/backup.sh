#!/bin/sh
set -eu
: "${DATABASE_URL:?DATABASE_URL is required}"
: "${BACKUP_S3_BUCKET:?BACKUP_S3_BUCKET is required}"
: "${BACKUP_S3_ENDPOINT:?BACKUP_S3_ENDPOINT is required}"

stamp=$(date -u +%Y-%m-%dT%H-%M-%SZ)
file="/tmp/abastobot-${stamp}.dump.gz"
media_file="/tmp/abastobot-media-${stamp}.tar.gz"
media_key=""
run_id="$(psql "$DATABASE_URL" -Atq -c "INSERT INTO backup_runs (kind,status,metadata) VALUES ('logical','running',jsonb_build_object('tool','pg_dump')) RETURNING id" | head -n 1)"
case "$run_id" in
  ????????-????-????-????-????????????) ;;
  *) echo "No se pudo registrar el inicio del backup lógico." >&2; exit 1 ;;
esac
failed() {
  printf '%s\n' "UPDATE backup_runs SET status='failed', completed_at=now(), error='Logical backup failed' WHERE id=:'run_id'" \
    | psql "$DATABASE_URL" -v run_id="$run_id" >/dev/null 2>&1 || true
}
trap failed INT TERM HUP EXIT
pg_dump "$DATABASE_URL" | gzip > "$file"
test -s "$file"
aws --endpoint-url "$BACKUP_S3_ENDPOINT" s3 cp "$file" "s3://${BACKUP_S3_BUCKET}/abastobot/daily/${stamp}.dump.gz"

# When media already lives in object storage, uploading the local cache again would
# duplicate every attachment in each daily backup. Only archive the media volume
# for installations that still use local filesystem storage.
if [ "${MEDIA_STORAGE_DRIVER:-local}" != "s3" ]; then
  media_key="abastobot/daily/${stamp}.media.tar.gz"
  tar -czf "$media_file" -C "${MEDIA_STORAGE_PATH:-/app/storage/media}" .
  tar -tzf "$media_file" >/dev/null
  aws --endpoint-url "$BACKUP_S3_ENDPOINT" s3 cp "$media_file" "s3://${BACKUP_S3_BUCKET}/${media_key}"
fi

if [ "$(date -u +%u)" = "7" ]; then
  aws --endpoint-url "$BACKUP_S3_ENDPOINT" s3 cp "$file" "s3://${BACKUP_S3_BUCKET}/abastobot/weekly/${stamp}.dump.gz"
  if [ -n "$media_key" ]; then
    aws --endpoint-url "$BACKUP_S3_ENDPOINT" s3 cp "$media_file" "s3://${BACKUP_S3_BUCKET}/abastobot/weekly/${stamp}.media.tar.gz"
  fi
fi

if [ -n "$media_key" ]; then
  printf '%s\n' "UPDATE backup_runs SET status='succeeded', completed_at=now(), object_key=:'key', metadata=jsonb_build_object('tool','pg_dump','mediaKey',:'media_key') WHERE id=:'run_id'" \
    | psql "$DATABASE_URL" -v run_id="$run_id" -v key="abastobot/daily/${stamp}.dump.gz" -v media_key="$media_key" >/dev/null
else
  printf '%s\n' "UPDATE backup_runs SET status='succeeded', completed_at=now(), object_key=:'key', metadata=jsonb_build_object('tool','pg_dump','mediaStoredSeparately',true,'mediaPrefix',:'media_prefix') WHERE id=:'run_id'" \
    | psql "$DATABASE_URL" -v run_id="$run_id" -v key="abastobot/daily/${stamp}.dump.gz" -v media_prefix="${MEDIA_S3_PREFIX:-abastobot/media}" >/dev/null
fi
trap - INT TERM HUP EXIT
rm -f "$file" "$media_file"
echo "Backup diario subido correctamente; el domingo también se creó el semanal."
