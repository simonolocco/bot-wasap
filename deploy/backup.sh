#!/bin/sh
set -eu
: "${DATABASE_URL:?DATABASE_URL is required}"
: "${BACKUP_S3_BUCKET:?BACKUP_S3_BUCKET is required}"
: "${BACKUP_S3_ENDPOINT:?BACKUP_S3_ENDPOINT is required}"

stamp=$(date -u +%Y-%m-%dT%H-%M-%SZ)
file="/tmp/abastobot-${stamp}.dump.gz"
media_file="/tmp/abastobot-media-${stamp}.tar.gz"
pg_dump "$DATABASE_URL" | gzip > "$file"
test -s "$file"
tar -czf "$media_file" -C "${MEDIA_STORAGE_PATH:-/app/storage/media}" .
tar -tzf "$media_file" >/dev/null
aws --endpoint-url "$BACKUP_S3_ENDPOINT" s3 cp "$file" "s3://${BACKUP_S3_BUCKET}/abastobot/daily/${stamp}.dump.gz"
aws --endpoint-url "$BACKUP_S3_ENDPOINT" s3 cp "$media_file" "s3://${BACKUP_S3_BUCKET}/abastobot/daily/${stamp}.media.tar.gz"
if [ "$(date -u +%u)" = "7" ]; then
  aws --endpoint-url "$BACKUP_S3_ENDPOINT" s3 cp "$file" "s3://${BACKUP_S3_BUCKET}/abastobot/weekly/${stamp}.dump.gz"
  aws --endpoint-url "$BACKUP_S3_ENDPOINT" s3 cp "$media_file" "s3://${BACKUP_S3_BUCKET}/abastobot/weekly/${stamp}.media.tar.gz"
fi
rm -f "$file" "$media_file"
echo "Backup diario subido correctamente; el domingo también se creó el semanal."
