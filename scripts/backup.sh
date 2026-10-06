#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
backup_dir="${1:?Zielverzeichnis für das Backup angeben}"
mkdir -p "$backup_dir"
umask 077
backup_path="$backup_dir/databasedoc-$(date -u +%Y%m%dT%H%M%SZ).sql.gz"
backup_temp="$(mktemp "$backup_dir/.databasedoc-backup.XXXXXX")"
trap 'rm -f "$backup_temp"' EXIT
docker compose exec -T mariadb sh -c 'exec mariadb-dump -udatatlas -p"$MARIADB_PASSWORD" --single-transaction --skip-lock-tables --no-tablespaces datatlas' | gzip > "$backup_temp"
mv "$backup_temp" "$backup_path"
printf 'Backup erstellt: %s\n' "$backup_path"
