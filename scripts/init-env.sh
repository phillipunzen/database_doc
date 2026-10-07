#!/usr/bin/env bash
# Generate first-installation secrets with Bash, OpenSSL and Debian coreutils.
set -euo pipefail
umask 077

project_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
env_path="$project_dir/.env"

if [[ -e "$env_path" || -L "$env_path" ]]; then
  printf '%s\n' '.env already exists; nothing was overwritten.' >&2
  exit 1
fi
if ! command -v openssl >/dev/null 2>&1; then
  printf '%s\n' 'OpenSSL is required. On Debian, run: apt-get install openssl' >&2
  exit 1
fi

env_temp="$(mktemp "$project_dir/.env.tmp.XXXXXX")"
trap 'rm -f -- "$env_temp"' EXIT
generated=0
while IFS= read -r line || [[ -n "$line" ]]; do
  case "$line" in
    APP_DB_PASSWORD=*|MARIADB_ROOT_PASSWORD=*|SESSION_SECRET=*|ADMIN_PASSWORD=*)
      line="${line%%=*}=$(openssl rand -hex 32)"
      generated=$((generated + 1))
      ;;
    ENCRYPTION_KEY=*)
      # Fernet requires URL-safe Base64 of exactly 32 random bytes, with padding.
      line="ENCRYPTION_KEY=$(openssl rand -base64 32 | tr '/+' '_-')"
      generated=$((generated + 1))
      ;;
  esac
  printf '%s\n' "$line"
done < "$project_dir/.env.example" > "$env_temp"

if [[ "$generated" -ne 5 ]]; then
  printf '%s\n' 'The template must contain all five required secret settings.' >&2
  exit 1
fi
# Publishing by hard link also refuses an .env created concurrently.
if ! ln -T -- "$env_temp" "$env_path"; then
  printf '%s\n' 'Could not create .env; any existing file was preserved.' >&2
  exit 1
fi
printf '%s\n' '.env created with private permissions and individual secrets. Set APP_URL before starting.'
