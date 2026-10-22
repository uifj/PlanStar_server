#!/bin/sh
#
# Back up the stack: the Postgres database and the /data volume, into one timestamped directory.
#
#   ./backup.sh [backup-root]        # default: ./backups (next to the compose file)
#
# What is in a backup:
#   db.dump        pg_dump --format=custom (restorable with pg_restore, unlike plain SQL)
#   appdata.tar.gz /data minus desktop/logs
#   meta.txt       image ids + volume names, for a restore that spans an upgrade
#
# `desktop/logs` is excluded on purpose: it is uplink intake with a 14 day retention window, it is
# by far the largest and fastest-growing part of /data, and restoring it would resurrect log files
# the retention sweep is about to delete anyway. Everything else under /data (files, uploads,
# exports, desktop/releases, crash, feedback) is included.
#
# Backups run against a *live* stack: pg_dump takes a consistent snapshot on its own, and the data
# volume is mounted read-only into a throwaway container.

set -eu
. "$(dirname "$0")/lib.sh"

require_podman

BACKUP_ROOT=${1:-$COMPOSE_DIR/backups}
KEEP=${BACKUP_KEEP:-7}
STAMP=$(stamp)
OUT="$BACKUP_ROOT/harness-$STAMP"

[ -f "$COMPOSE_DIR/.env.production" ] || warn "no .env.production — is this the right host?"

PG=$(container_of postgres) || die "postgres container is not running; start the stack first"
APP_VOL=$(volume_of appdata)

mkdir -p "$OUT"

log "dumping database"
podman exec "$PG" pg_dump -U harness -d harness --format=custom >"$OUT/db.dump"
[ -s "$OUT/db.dump" ] || die "pg_dump produced an empty dump"

log "archiving /data (excluding desktop/logs)"
podman run --rm --volume "$APP_VOL:/src:ro" "$HELPER_IMAGE" \
	tar czf - -C /src --exclude='./desktop/logs' --exclude='./desktop/logs/*' . >"$OUT/appdata.tar.gz"
[ -s "$OUT/appdata.tar.gz" ] || die "archive produced an empty file"

log "recording image versions"
{
	printf 'created=%s\n' "$STAMP"
	printf 'appdata_volume=%s\n' "$APP_VOL"
	for svc in api web; do
		id=$(container_of "$svc" 2>/dev/null || true)
		if [ -n "${id:-}" ]; then
			printf '%s_image=%s\n' "$svc" "$(podman inspect --format '{{.ImageName}}' "$id")"
		fi
	done
} >"$OUT/meta.txt"

# Prune oldest, matching only directories this script created (never a user's own directory).
count=$(ls -1d "$BACKUP_ROOT"/harness-* 2>/dev/null | wc -l | tr -d ' ')
if [ "$count" -gt "$KEEP" ]; then
	log "pruning to $KEEP backups"
	ls -1d "$BACKUP_ROOT"/harness-* | sort | head -n "$((count - KEEP))" |
		while read -r old; do
			case $old in
			"$BACKUP_ROOT"/harness-*)
				printf '    removing %s\n' "$old"
				rm -rf -- "$old"
				;;
			esac
		done
fi

printf '\nbackup complete: %s\n' "$OUT"
du -sh "$OUT" 2>/dev/null || true
