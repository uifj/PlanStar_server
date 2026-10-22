#!/bin/sh
#
# Runtime entrypoint for the API image.
#
# Two jobs, both of which need to happen before `node dist/index.js` reads `process.env`:
#
#  1. Read file-backed secrets (`*_FILE`) into the matching env var. Podman secrets and compose
#     `secrets:` are mounted as files; the app only knows env vars, so the translation lives here
#     and the compose/quadlet files stay declarative.
#  2. Assemble `DATABASE_URL` from parts when it was not given. Compose cannot compose strings, so
#     a production stack that keeps the DB password in a secret would otherwise have to hardcode
#     the URL (with the password in it) in `.env.production`.
#
# POSIX `sh` on purpose: the image is alpine and has no bash.

set -eu

read_secret() {
	# $1 = env var name, $2 = path to the secret file
	var="$1"
	path="$2"
	if [ -f "$path" ]; then
		# `tr -d '\n'` strips the trailing newline `printf '%s\n' > file` leaves behind; a stray
		# newline inside a password is an unexplainable auth failure at 3am.
		value=$(tr -d '\n' < "$path")
		eval "export $var=\$value"
	fi
}

# File-backed secrets, in the order the app needs them.
if [ -n "${BETTER_AUTH_SECRET_FILE:-}" ]; then
	read_secret BETTER_AUTH_SECRET "$BETTER_AUTH_SECRET_FILE"
fi
if [ -n "${POSTGRES_PASSWORD_FILE:-}" ]; then
	read_secret POSTGRES_PASSWORD "$POSTGRES_PASSWORD_FILE"
fi
if [ -n "${DESKTOP_LOG_READ_TOKEN_FILE:-}" ]; then
	read_secret DESKTOP_LOG_READ_TOKEN "$DESKTOP_LOG_READ_TOKEN_FILE"
fi
if [ -n "${GEMINI_API_KEY_FILE:-}" ]; then
	read_secret GEMINI_API_KEY "$GEMINI_API_KEY_FILE"
fi
if [ -n "${DEEPSEEK_API_KEY_FILE:-}" ]; then
	read_secret DEEPSEEK_API_KEY "$DEEPSEEK_API_KEY_FILE"
fi

# Assemble DATABASE_URL from parts when it is not set explicitly.
if [ -z "${DATABASE_URL:-}" ] && [ -n "${POSTGRES_PASSWORD:-}" ]; then
	: "${POSTGRES_USER:=harness}"
	: "${POSTGRES_DB:=harness}"
	POSTGRES_HOST="${POSTGRES_HOST:-postgres}"
	POSTGRES_PORT="${POSTGRES_PORT:-5432}"
	DATABASE_URL="postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@${POSTGRES_HOST}:${POSTGRES_PORT}/${POSTGRES_DB}"
	export DATABASE_URL
fi

if [ -z "${DATABASE_URL:-}" ]; then
	echo "entrypoint: DATABASE_URL is unset and POSTGRES_PASSWORD(_FILE) was not provided" >&2
	exit 1
fi

# `/data` is the only persistent mount; keep the write roots under it unless the operator
# overrode them. Creating them here (as the node user) is what makes `read_only: true` + a
# volume mount work without a pre-chown step on the host.
: "${FILE_STORAGE_ROOT:=/data/files}"
: "${FILE_UPLOAD_STAGING_ROOT:=/data/uploads}"
: "${EXPORT_ROOT:=/data/exports}"
: "${DESKTOP_DATA_ROOT:=/data/desktop}"
export FILE_STORAGE_ROOT FILE_UPLOAD_STAGING_ROOT EXPORT_ROOT DESKTOP_DATA_ROOT
mkdir -p "$FILE_STORAGE_ROOT" "$FILE_UPLOAD_STAGING_ROOT" "$EXPORT_ROOT" \
	"$DESKTOP_DATA_ROOT" "${DESKTOP_LOG_ROOT:-$DESKTOP_DATA_ROOT/logs}" \
	"$DESKTOP_DATA_ROOT/releases" "$DESKTOP_DATA_ROOT/crash" "$DESKTOP_DATA_ROOT/feedback"

exec "$@"
