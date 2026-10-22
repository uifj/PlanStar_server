#!/bin/sh
#
# Restore a backup produced by backup.sh.
#
#   ./restore.sh /path/to/backups/harness-20260101T000000Z [--yes]
#
# Order matters: the api is stopped first (pg_restore --clean drops objects, which fails while a
# client holds them), then the database is restored, then the data volume is unpacked, then the api
# is started and polled. A refusal to continue without --yes is deliberate — this deletes data.

set -eu
. "$(dirname "$0")/lib.sh"

require_podman

SRC=${1:-}
[ -n "$SRC" ] || die "usage: restore.sh <backup-dir> [--yes]"
[ -d "$SRC" ] || die "backup directory $SRC not found"
[ -f "$SRC/db.dump" ] || die "$SRC/db.dump is missing"
[ -f "$SRC/appdata.tar.gz" ] || die "$SRC/appdata.tar.gz is missing"

if [ "${2:-}" != "--yes" ]; then
	printf 'This will REPLACE the database and /data with %s.\nType "restore" to continue: ' "$SRC"
	read -r answer
	[ "$answer" = "restore" ] || die "aborted"
fi

PG=$(container_of postgres) || die "postgres container is not running"
APP_VOL=$(volume_of appdata)
API=$(container_of api 2>/dev/null || true)

if [ -n "${API:-}" ]; then
	log "stopping api"
	if is_compose "$API"; then
		compose stop api
	elif is_systemd; then
		systemctl stop harness-api.service
	else
		podman stop "$API" >/dev/null
	fi
fi

log "restoring database"
podman exec -i "$PG" pg_restore -U harness -d harness --clean --if-exists --no-owner <"$SRC/db.dump"

log "restoring /data"
podman run --rm -i --volume "$APP_VOL:/dst" "$HELPER_IMAGE" tar xzf - -C /dst <"$SRC/appdata.tar.gz"

log "starting api"
if [ -n "${API:-}" ]; then
	if is_compose "$API"; then
		compose start api
	elif is_systemd; then
		systemctl start harness-api.service
	else
		podman start "$API" >/dev/null
	fi
fi

if wait_ready 120; then
	printf '\nrestore complete; /api/ready is healthy\n'
else
	die "restore finished but /api/ready did not come back within 120 s — check: podman logs $(container_of api || echo harness-api)"
fi
